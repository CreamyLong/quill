/**
 * Tool error handling middleware.
 *
 * Faithful port of Python `ToolErrorHandlingMiddleware`: converts tool
 * exceptions into error ToolMessages so the run can continue, and stamps the
 * structured subagent status on `task` tool results.
 *
 * Deviations / dependency notes (report):
 * - The Python module also defines `_build_runtime_middlewares`,
 *   `build_lead_runtime_middlewares`, and `build_subagent_runtime_middlewares`.
 *   Those are wiring/assembly helpers that depend on many unported modules
 *   (AppConfig, guardrails, sandbox, reflection, ...) and are NOT ported here.
 * - The status-contract helpers `extract_subagent_status` /
 *   `make_subagent_additional_kwargs` live in `quill.subagents.status_contract`,
 *   which has no TS port yet; the small pure logic is inlined below.
 */

import { ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { GraphBubbleUp } from "@langchain/langgraph";

import { STATE_UPDATE, type MiddlewareDefinition, type ToolCallRequest } from "../factory.js";
import type { ThreadState } from "../thread_state.js";

const MISSING_TOOL_CALL_ID = "missing_tool_call_id";
const TASK_TOOL_NAME = "task";

// ---------------------------------------------------------------------------
// Inlined subagent status contract (quill.subagents.status_contract)
// ---------------------------------------------------------------------------

const SUBAGENT_STATUS_KEY = "subagent_status";
const SUBAGENT_ERROR_KEY = "subagent_error";

type SubagentStatusValue =
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "polling_timed_out";

const SUBAGENT_STATUS_VALUES: readonly SubagentStatusValue[] = [
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "polling_timed_out",
];

// Ordered most-specific-first (some prefixes are substrings of others).
const PREFIX_TO_STATUS: ReadonlyArray<[string, SubagentStatusValue]> = [
  ["Task Succeeded. Result:", "completed"],
  ["Task polling timed out", "polling_timed_out"],
  ["Task timed out", "timed_out"],
  ["Task cancelled by user", "cancelled"],
  ["Task failed.", "failed"],
  ["Error", "failed"],
];

/** Infer the structured status for a `task` tool result string, or null. */
function extractSubagentStatus(content: string): SubagentStatusValue | null {
  const trimmed = content.trim();
  for (const [prefix, status] of PREFIX_TO_STATUS) {
    if (trimmed.startsWith(prefix)) {
      return status;
    }
  }
  return null;
}

/** Build the `additional_kwargs` payload the middleware stamps. */
function makeSubagentAdditionalKwargs(
  status: SubagentStatusValue,
  error?: string | null
): Record<string, string> {
  if (!SUBAGENT_STATUS_VALUES.includes(status)) {
    throw new Error(
      `invalid subagent status ${JSON.stringify(status)}; expected one of ${SUBAGENT_STATUS_VALUES.join(", ")}`
    );
  }
  const payload: Record<string, string> = { [SUBAGENT_STATUS_KEY]: status };
  if (error && error.trim()) {
    payload[SUBAGENT_ERROR_KEY] = error.trim();
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Stamping
// ---------------------------------------------------------------------------

/** Centralised stamping of `additional_kwargs.subagent_status`. No-op for non-task tools. */
function stampTaskSubagentStatus(
  message: ToolMessage,
  toolName: string,
  error?: string | null
): ToolMessage {
  if (toolName !== TASK_TOOL_NAME) {
    return message;
  }
  const content = typeof message.content === "string" ? message.content : "";
  const status = extractSubagentStatus(content);
  if (status === null) {
    // Non-terminal streaming chunks / unrecognised shapes leave the field unset.
    console.log(`[stampTaskSubagentStatus] no status extracted for task tool content prefix: ${content.slice(0, 60)}`);
    return message;
  }
  const stamp = makeSubagentAdditionalKwargs(status, error);
  message.additional_kwargs = { ...(message.additional_kwargs ?? {}), ...stamp };
  console.log(`[stampTaskSubagentStatus] stamped task tool ${message.tool_call_id} with ${JSON.stringify(stamp)}`);
  return message;
}

function buildErrorMessage(request: ToolCallRequest, exc: unknown): ToolMessage {
  const toolName = request.name || "unknown_tool";
  const toolCallId = request.tool_call_id || MISSING_TOOL_CALL_ID;
  const excName = exc instanceof Error ? exc.constructor.name : "Error";
  let detail = (exc instanceof Error ? exc.message : String(exc)).trim() || excName;
  if (detail.length > 500) {
    detail = detail.slice(0, 497) + "...";
  }

  const content = `Error: Tool '${toolName}' failed with ${excName}: ${detail}. Continue with available context, or choose an alternative tool.`;
  const message = new ToolMessage({
    content,
    tool_call_id: toolCallId,
    name: toolName,
    status: "error",
  });
  const structuredError = `${excName}: ${detail}`;
  return stampTaskSubagentStatus(message, toolName, structuredError);
}

/** Apply the subagent stamp to successful task tool returns. */
function maybeStamp(result: BaseMessage, request: ToolCallRequest): BaseMessage {
  if (!(result instanceof ToolMessage)) {
    return result;
  }
  return stampTaskSubagentStatus(result, request.name || "");
}

/** Convert tool exceptions into error ToolMessages so the run can continue. */
export function toolErrorHandlingMiddleware(): MiddlewareDefinition {
  return {
    name: "ToolErrorHandlingMiddleware",
    wrapToolCall: async (request, handler) => {
      console.log(`[ToolErrorHandlingMiddleware] wrapToolCall invoked: name=${request.name} id=${request.tool_call_id}`);
      let result: BaseMessage | Partial<ThreadState>;
      try {
        result = await handler(request);
      } catch (exc) {
        // Preserve LangGraph control-flow signals (interrupt/pause/resume).
        if (exc instanceof GraphBubbleUp) {
          throw exc;
        }
        console.error(
          `Tool execution failed: name=${request.name} id=${request.tool_call_id}`
        );
        return buildErrorMessage(request, exc);
      }
      // Middleware tools may return a raw state update (e.g. write_todos); pass
      // those through untouched so the tools node can merge them.
      if (
        result !== null &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        (STATE_UPDATE in result || (result as Record<symbol, unknown>)[STATE_UPDATE] === true)
      ) {
        return result as Partial<ThreadState>;
      }
      const stamped = maybeStamp(result as BaseMessage, request);
      if (stamped instanceof ToolMessage) {
        console.log(`[ToolErrorHandlingMiddleware] stamped result for ${request.name}: additional_kwargs=${JSON.stringify(stamped.additional_kwargs)}`);
      }
      return stamped;
    },
  };
}
