/**
 * TypeScript MCP client for the Quill runtime.
 *
 * Port of the Python `quill.mcp` integration, built on the official
 * `@langchain/mcp-adapters` (the JS counterpart of `langchain-mcp-adapters`).
 * It reads the `mcp.mcp_servers` config, connects to each enabled MCP server
 * (stdio / sse / http transports), and returns the server tools as LangChain
 * `StructuredTool`s tagged as MCP-sourced so the rest of Quill can recognise
 * them.
 *
 * A single failing server never aborts startup (`throwOnLoadError: false`).
 *
 * Wired-in capabilities (ported from Python):
 *   - OAuth via `OAuthClientProvider` for HTTP/SSE servers that require it.
 *   - Custom before/after tool-call hooks loaded from `mcpInterceptors`.
 *   - Path rewriting: local filesystem references in tool output are mapped to
 *     sandbox virtual paths (`/mnt/user-data/...`) so agents can chain MCP
 *     tool output into sandbox file tools.
 */

import type { StructuredToolInterface } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

import type { McpOAuthConfig } from "../config/extensions_config.js";
import { tagMcpTool, type ToolLike } from "../tools/mcp_metadata.js";
import {
  OAuthTokenManager,
  buildMcpOAuthProvider,
} from "./oauth.js";
import {
  buildMcpInterceptors,
  composeBeforeHooks,
  composeAfterHooks,
} from "./interceptors.js";
import { rewriteMcpContent } from "./path_rewrite.js";

export type McpTransport = "stdio" | "sse" | "http" | "streamable_http";

/** Per-server MCP config (mirrors the Python `MCPServerConfig` shape). */
export interface McpServerConfig {
  type?: McpTransport;
  transport?: McpTransport;
  enabled?: boolean;
  description?: string;
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // sse / http
  url?: string;
  headers?: Record<string, string>;
  /** OAuth configuration (parsed from extensions_config.json). */
  oauth?: McpOAuthConfig | null;
  /** Extra fields allowed (Pydantic extra="allow"). */
  [key: string]: unknown;
}

export interface McpConfig {
  mcp_servers?: Record<string, McpServerConfig>;
  /** camelCase variant produced by the config loader's key normalization. */
  mcpServers?: Record<string, McpServerConfig>;
}

export interface LoadedMcp {
  tools: StructuredToolInterface[];
  client: MultiServerMCPClient | null;
  /** Server names whose tools were loaded. */
  servers: string[];
}

/**
 * Options controlling how MCP tools are loaded.
 *
 * Passed through from higher-level orchestrators (`cache.ts`, gateway init)
 * to wire in OAuth, custom interceptors, and output transforms.
 */
export interface LoadMcpToolsOptions {
  /** Pre-built OAuth manager (avoids re-parsing config if already available). */
  oauthManager?: OAuthTokenManager;
  /** Hook objects loaded from `mcpInterceptors` config. */
  interceptors?: Awaited<ReturnType<typeof buildMcpInterceptors>>;
  /**
   * When true (default), each MCP tool's `_call` is wrapped to rewrite local
   * filesystem references in its output to sandbox virtual paths.
   */
  enablePathRewrite?: boolean;
}

/** All inheritable string env vars (so a stdio subprocess keeps PATH, tokens, …). */
function inheritedEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function resolveTransport(cfg: McpServerConfig): McpTransport {
  return cfg.transport ?? cfg.type ?? (cfg.url ? "http" : "stdio");
}

/**
 * Build MCP tools from the configured servers. Disabled servers and
 * mis-configured entries are skipped with a warning rather than throwing.
 *
 * The optional `options` argument wires in the ported-Python capabilities.
 * When omitted the call is fully backward-compatible (no OAuth, no hooks, no
 * path rewrite) — the caller gets plain MCP tools.
 */
export async function loadMcpTools(
  config: McpConfig | null | undefined,
  options: LoadMcpToolsOptions = {},
): Promise<LoadedMcp> {
  const servers = config?.mcp_servers ?? config?.mcpServers ?? {};
  const { enablePathRewrite = true } = options;

  // Separate enabled vs disabled, build transport configs, collect OAuth needs.
  const mcpServers: Record<string, Record<string, unknown>> = {};
  const oauthServerNames = new Set<string>();
  const oauthByServer = new Map<string, McpOAuthConfig>();
  const enabledNames: string[] = [];

  for (const [name, cfg] of Object.entries(servers)) {
    if (cfg.enabled === false) continue;
    const transport = resolveTransport(cfg);

    if (transport === "stdio") {
      if (!cfg.command) {
        console.warn(`[mcp] server '${name}' uses stdio but has no 'command'; skipping`);
        continue;
      }
      mcpServers[name] = {
        transport: "stdio",
        command: cfg.command,
        args: cfg.args ?? [],
        // Merge parent env (PATH, tokens, …) then overlay the server's own env.
        env: { ...inheritedEnv(), ...(cfg.env ?? {}) },
      };
    } else {
      if (!cfg.url) {
        console.warn(`[mcp] server '${name}' uses ${transport} but has no 'url'; skipping`);
        continue;
      }
      mcpServers[name] = {
        transport: transport === "sse" ? "sse" : "http",
        url: cfg.url,
        headers: cfg.headers ?? {},
      };
      if (cfg.oauth?.enabled && cfg.oauth.tokenUrl) {
        oauthServerNames.add(name);
        oauthByServer.set(name, cfg.oauth);
      }
    }
    enabledNames.push(name);
  }

  const names = Object.keys(mcpServers);
  if (names.length === 0) {
    return { tools: [], client: null, servers: [] };
  }

  // --- OAuth wiring -------------------------------------------------------
  // Per-server `authProvider` for servers with OAuth config. The MCP SDK calls
  // `provider.tokens()` / `provider.saveTokens()` around each tool invocation.
  let oauthManager = options.oauthManager;
  if (oauthServerNames.size > 0 && !oauthManager) {
    oauthManager = OAuthTokenManager.fromMap(oauthByServer);
  }
  const oauthProviders = new Map<string, ReturnType<typeof buildMcpOAuthProvider>>();
  if (oauthManager) {
    for (const serverName of oauthServerNames) {
      oauthProviders.set(serverName, buildMcpOAuthProvider(serverName, oauthManager));
    }
  }

  // --- Interceptor wiring -------------------------------------------------
  // Compose per-server or global before/after tool-call hooks. Each hook runs
  // in declaration order and may mutate the request/response.
  const interceptors = options.interceptors ?? [];
  const beforeHook = composeBeforeHooks(interceptors);
  const afterHook = composeAfterHooks(interceptors);

  // The SDK accepts `authProvider` per-server inside `mcpServers`. We overlay
  // it onto each server's config when an OAuth provider was built for it.
  if (oauthProviders.size > 0) {
    for (const [name, provider] of oauthProviders) {
      if (mcpServers[name]) {
        (mcpServers[name] as Record<string, unknown>).authProvider = provider;
      }
    }
  }

  // The SDK accepts `beforeToolCall` / `afterToolCall` at the top level of
  // ClientConfig (constructor), NOT in getTools(). They apply to every tool
  // call made through this client.
  //
  // IMPORTANT: load each server independently (one MultiServerMCPClient per
  // server) so a transport-level failure (bad URL, dead host, 404) on one
  // server does NOT abort the whole batch. This mirrors Python's per-server
  // `asyncio.gather` + `load_server_tools` behavior. The SDK's
  // `throwOnLoadError: false` only isolates *tool-schema* errors, NOT
  // transport-connection errors — hence the manual isolation here.
  const allTools: StructuredToolInterface[] = [];
  const loadedServers: string[] = [];
  let combinedClient: MultiServerMCPClient | null = null;

  for (const name of names) {
    const cfg = mcpServers[name];
    const serverConfig = { [name]: cfg };
    // Per-server OAuth provider (if any).
    const perServerOAuth = oauthProviders.get(name);
    try {
      const serverClient = new MultiServerMCPClient({
        mcpServers: serverConfig as never,
        throwOnLoadError: false,
        prefixToolNameWithServerName: true,
        additionalToolNamePrefix: "",
        useStandardContentBlocks: true,
        ...(perServerOAuth ? { authProvider: perServerOAuth } : {}),
        ...(beforeHook ? { beforeToolCall: beforeHook } : {}),
        ...(afterHook ? { afterToolCall: afterHook } : {}),
      } as never);

      const serverTools = await serverClient.getTools();
      normalizeMcpToolNames(serverTools, [name]);
      for (const tool of serverTools) {
        tagMcpTool(tool as unknown as ToolLike);
      }
      allTools.push(...(serverTools as StructuredToolInterface[]));
      loadedServers.push(name);
      // Keep the last client as the combined handle; subagent/reload paths
      // use `client` for session teardown. For multi-server the SDK docs
      // recommend one client per connection, but we expose one for backward
      // compatibility (close() is best-effort).
      combinedClient = serverClient;
    } catch (err) {
      console.warn(
        `[mcp] ⚠️  server '${name}' failed to load — skipping. ` +
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const tools = allTools;
  const client = combinedClient;

  // --- Post-load diagnostics ------------------------------------------------
  // Emit a warning if some servers failed to load (caught in the per-server
  // try/catch above). `loadedServers` is the subset of `names` that succeeded.
  const failedCount = names.length - loadedServers.length;
  if (failedCount > 0) {
    const failed = names.filter((n) => !loadedServers.includes(n));
    console.warn(
      `[mcp] ⚠️  ${failedCount}/${names.length} MCP server(s) failed to load: ${failed.join(", ")}. ` +
      `${tools.length} tool(s) loaded from: ${loadedServers.join(", ") || "none"}`,
    );
  }

  // --- Path-rewrite wrapping ----------------------------------------------
  // After each MCP tool call, scan the result for local filesystem references
  // (bare paths, `file://` URIs) and rewrite any that resolve to the thread's
  // workspace back to `/mnt/user-data/...` virtual paths. Mirrors Python's
  // `_convert_call_tool_result` → `_rewrite_local_paths_in_text`.
  //
  // The thread_id is extracted from LangGraph's RunnableConfig.configurable.
  const wrappedTools = enablePathRewrite
    ? tools.map((tool) => wrapToolWithPathRewrite(tool))
    : tools;

  return { tools: wrappedTools as StructuredToolInterface[], client, servers: loadedServers };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize MCP tool names from the JS adapter's `serverName__toolName`
 * convention to Python's `serverName_toolName` convention.
 *
 * We know the configured server names, so we can reliably split the prefix
 * even when the original MCP tool name itself contains `__`.
 */
function normalizeMcpToolNames(
  tools: StructuredToolInterface[],
  serverNames: string[],
): void {
  const serverSet = new Set(serverNames);
  const sep = "__";
  for (const tool of tools) {
    const idx = tool.name.indexOf(sep);
    if (idx <= 0) continue;
    const prefix = tool.name.slice(0, idx);
    if (!serverSet.has(prefix)) continue;
    const originalName = tool.name.slice(idx + sep.length);
    (tool as unknown as Record<string, unknown>).name = `${prefix}_${originalName}`;
  }
}

/**
 * Wrap a single MCP tool so its output passes through `rewriteMcpContent`
 * before being returned to the agent. The `threadId` is read from the
 * LangGraph `RunnableConfig` that the SDK passes to `invoke`.
 *
 * We override `invoke` (the public LangChain tool API) rather than the
 * internal `_call`, which doesn't exist on `StructuredToolInterface`.
 */
function wrapToolWithPathRewrite(tool: StructuredToolInterface): StructuredToolInterface {
  const originalInvoke = tool.invoke.bind(tool);
  tool.invoke = (async (input: unknown, config?: unknown) => {
    const result = await originalInvoke(input, config as Parameters<typeof originalInvoke>[1]);
    const threadId = extractThreadId(config);
    if (!threadId) return result;
    return rewriteMcpContent(result, threadId);
  }) as typeof tool.invoke;
  return tool;
}

/**
 * Extract `threadId` from a LangGraph `RunnableConfig`-like object.
 *
 * Mirrors Python's `_extract_thread_id` which checks `runtime.context`,
 * `runtime.config.configurable`, and `get_config()`.
 */
function extractThreadId(config: unknown): string | null {
  if (!config || typeof config !== "object") return null;
  const c = config as Record<string, unknown>;

  // RunnableConfig.configurable.threadId (LangGraph's per-run scoping).
  const configurable = c.configurable as Record<string, unknown> | undefined;
  if (configurable && typeof configurable.threadId === "string") {
    return configurable.threadId;
  }

  // Fallback for direct metadata access.
  if (typeof c.threadId === "string") return c.threadId;

  return null;
}
