/**
 * MCP tool interceptor (hook) loading.
 *
 * Port of the Python `quill.mcp.tools` `mcpInterceptors` loading logic. Reads
 * `extensions_config.json`'s `mcpInterceptors` field — an array of import paths
 * in `"pkg.module:builder_func"` format — dynamically loads each builder, and
 * composes the resulting before/after hooks into the shape expected by the
 * `MultiServerMCPClient` constructor.
 *
 * A single broken interceptor is skipped with a warning rather than aborting
 * the whole chain (matching the Python version's `try / except` per-item).
 */

import { resolveVariable } from "../reflection/resolvers.js";
import type { ExtensionsConfig } from "../config/extensions_config.js";

/**
 * Minimal type mirroring the SDK's `ToolHooks["beforeToolCall"]`.
 * Defined locally to avoid depending on the SDK's internal `./hooks.js` path
 * (which is not in the package's `exports` map).
 */
export type BeforeToolCallHook = (
  request: { serverName: string; name: string; args?: unknown },
  state: unknown,
  config: unknown,
) => Promise<{ headers?: Record<string, string>; args?: unknown } | void> | { headers?: Record<string, string>; args?: unknown } | void;

/** Minimal type mirroring the SDK's `ToolHooks["afterToolCall"]`. */
export type AfterToolCallHook = (
  result: { serverName: string; name: string; args?: unknown; result: unknown },
  state: unknown,
  config: unknown,
) => Promise<unknown> | unknown;

/** A single interceptor's hooks. */
export interface McpToolHooks {
  beforeToolCall?: BeforeToolCallHook;
  afterToolCall?: AfterToolCallHook;
}

/**
 * Load custom MCP tool interceptors declared in the extensions config.
 *
 * Each entry in `mcpInterceptors` is a dotted path `"pkg.module:builder_func"`.
 * The builder is called with no arguments and should return an object with
 * optional `beforeToolCall` / `afterToolCall` hook functions.
 */
export async function buildMcpInterceptors(extCfg: ExtensionsConfig): Promise<McpToolHooks[]> {
  // `mcpInterceptors` lives in the `extra` bag (top-level keys beyond
  // mcpServers/skills are collected there by `ExtensionsConfig.modelValidate`).
  const rawPaths = (extCfg.extra?.mcpInterceptors as string[] | undefined) ?? [];
  if (rawPaths.length === 0) return [];

  const hooks: McpToolHooks[] = [];
  for (const path of rawPaths) {
    try {
      const builder = await resolveVariable<() => McpToolHooks | Promise<McpToolHooks>>(path);
      const result = typeof builder === "function" ? await builder() : builder;
      if (result && typeof result === "object" && (result.beforeToolCall || result.afterToolCall)) {
        hooks.push({
          ...(result.beforeToolCall ? { beforeToolCall: result.beforeToolCall } : {}),
          ...(result.afterToolCall ? { afterToolCall: result.afterToolCall } : {}),
        });
        console.log(`[mcp] loaded interceptor: ${path}`);
      } else {
        console.warn(`[mcp] interceptor "${path}" returned no usable hooks; skipping`);
      }
    } catch (e) {
      console.warn(`[mcp] failed to load interceptor "${path}": ${e instanceof Error ? e.message : e}`);
    }
  }
  return hooks;
}

/**
 * Compose an array of hook objects into a single chained `beforeToolCall`.
 * Each hook runs in order; any hook can modify the request by returning a
 * replacement, or return `void` to pass through unchanged.
 */
export function composeBeforeHooks(hooks: McpToolHooks[]): BeforeToolCallHook | undefined {
  const fns = hooks.map((h) => h.beforeToolCall).filter((h): h is BeforeToolCallHook => Boolean(h));
  if (fns.length === 0) return undefined;
  return async (request: { serverName: string; name: string; args?: unknown }, state: unknown, config: unknown) => {
    let current = request;
    for (const fn of fns) {
      const result = await fn(current, state, config);
      if (result !== undefined && result !== null) {
        current = { ...current, ...result };
      }
    }
    return current;
  };
}

/**
 * Compose an array of hook objects into a single chained `afterToolCall`.
 * Each hook runs in order with the (possibly modified) result.
 */
export function composeAfterHooks(hooks: McpToolHooks[]): AfterToolCallHook | undefined {
  const fns = hooks.map((h) => h.afterToolCall).filter((h): h is AfterToolCallHook => Boolean(h));
  if (fns.length === 0) return undefined;
  return async (result: { serverName: string; name: string; args?: unknown; result: unknown }, state: unknown, config: unknown) => {
    let current = result;
    for (const fn of fns) {
      const next = await fn(current, state, config);
      if (next !== undefined && next !== null) {
        current = next as typeof current;
      }
    }
    return current;
  };
}
