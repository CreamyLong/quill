/**
 * Middleware to filter deferred tool schemas from model binding.
 *
 * Faithful port of Python `DeferredToolFilterMiddleware`. When tool_search is
 * enabled, deferred (MCP) tools stay registered for execution but their schemas
 * must not be sent to the LLM until promoted via tool_search. Promotion state is
 * read from graph state (`state.promoted`), scoped by catalog hash.
 *
 * Deviation (noted in report): Python's `wrap_model_call` filters
 * `request.tools` using `request.state`. The TS `ModelRequest` carries neither
 * `tools` nor `state` (tools are bound at graph build time and the request only
 * holds `messages`), so the schema-filtering path can only act on an extended
 * request shape; when those fields are absent it is a safe passthrough. The
 * `wrapToolCall` blocking path is fully functional (its request carries `state`).
 */

import { ToolMessage } from "@langchain/core/messages";

import type { StructuredToolInterface } from "@langchain/core/tools";

import type {
  MiddlewareDefinition,
  ModelRequest,
  ToolCallRequest,
} from "../factory.js";
import type { PromotedTools, ThreadState } from "../thread_state.js";

/**
 * Extended model request shape used only when a caller threads `tools`/`state`
 * through the wrapper. The base TS `ModelRequest` has neither.
 */
interface DeferredModelRequest extends ModelRequest {
  tools?: StructuredToolInterface[];
  state?: ThreadState;
}

function promotedNames(
  state: ThreadState | undefined,
  catalogHash: string | null
): Set<string> {
  const promoted = (state ?? {}).promoted as PromotedTools | null | undefined;
  if (promoted && promoted.catalog_hash === catalogHash) {
    return new Set(promoted.names ?? []);
  }
  return new Set();
}

function hiddenNames(
  deferred: ReadonlySet<string>,
  state: ThreadState | undefined,
  catalogHash: string | null
): Set<string> {
  const promoted = promotedNames(state, catalogHash);
  const hidden = new Set<string>();
  for (const name of deferred) {
    if (!promoted.has(name)) {
      hidden.add(name);
    }
  }
  return hidden;
}

function filterTools(
  request: DeferredModelRequest,
  deferred: ReadonlySet<string>,
  catalogHash: string | null
): DeferredModelRequest {
  if (deferred.size === 0 || request.tools === undefined) {
    return request;
  }
  const hide = hiddenNames(deferred, request.state, catalogHash);
  if (hide.size === 0) {
    return request;
  }
  const active = request.tools.filter((t) => !hide.has(t.name));
  if (active.length < request.tools.length) {
    console.debug(
      `Filtered ${request.tools.length - active.length} deferred tool schema(s) from model binding`
    );
  }
  return { ...request, tools: active };
}

function blockedToolMessage(
  request: ToolCallRequest,
  deferred: ReadonlySet<string>,
  catalogHash: string | null
): ToolMessage | null {
  if (deferred.size === 0) {
    return null;
  }
  const name = request.name || "";
  if (!name || !hiddenNames(deferred, request.state, catalogHash).has(name)) {
    return null;
  }
  const toolCallId = request.tool_call_id || "missing_tool_call_id";
  return new ToolMessage({
    content: `Error: Tool '${name}' is deferred and has not been promoted yet. Call tool_search first to expose and promote this tool's schema, then retry.`,
    tool_call_id: toolCallId,
    name,
    status: "error",
  });
}

/** Hide deferred tool schemas from the bound model until promoted. */
export function deferredToolFilterMiddleware(
  deferredNames: ReadonlySet<string> | Iterable<string>,
  catalogHash: string | null
): MiddlewareDefinition {
  const deferred = new Set(deferredNames);
  return {
    name: "DeferredToolFilterMiddleware",
    wrapModelCall: async (request, handler) => {
      return handler(filterTools(request as DeferredModelRequest, deferred, catalogHash));
    },
    wrapToolCall: async (request, handler) => {
      const blocked = blockedToolMessage(request, deferred, catalogHash);
      if (blocked !== null) {
        return blocked;
      }
      return handler(request);
    },
  };
}
