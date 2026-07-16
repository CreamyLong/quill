/**
 * Middleware to enforce maximum concurrent subagent tool calls per model
 * response.
 *
 * Faithful port of Python `SubagentLimitMiddleware`. When an LLM generates more
 * than `maxConcurrent` parallel `task` tool calls in one response, this keeps
 * only the first `maxConcurrent` and discards the rest.
 *
 * Dependency note (report): Python imports `MAX_CONCURRENT_SUBAGENTS` from
 * `quill.subagents.executor`, which is not yet ported to TS. The value (3) is
 * inlined here as the default.
 */

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition } from "../factory.js";
import type { ThreadState } from "../thread_state.js";
import {
  cloneAiMessageWithToolCalls,
  type MessageLike,
} from "./tool_call_metadata.js";

/** Inlined from `quill.subagents.executor.MAX_CONCURRENT_SUBAGENTS`. */
export const MAX_CONCURRENT_SUBAGENTS = 3;

// Valid range for max_concurrent_subagents.
const MIN_SUBAGENT_LIMIT = 2;
const MAX_SUBAGENT_LIMIT = 4;

/** Clamp subagent limit to valid range [2, 4]. */
function clampSubagentLimit(value: number): number {
  return Math.max(MIN_SUBAGENT_LIMIT, Math.min(MAX_SUBAGENT_LIMIT, value));
}

function truncateTaskCalls(state: ThreadState, maxConcurrent: number): Partial<ThreadState> | undefined {
  const messages = state.messages ?? [];
  if (messages.length === 0) {
    return;
  }

  const lastMsg = messages[messages.length - 1];
  if (lastMsg.getType() !== "ai") {
    return;
  }

  const toolCalls = ((lastMsg as AIMessage).tool_calls ?? []) as Array<Record<string, unknown>>;
  if (toolCalls.length === 0) {
    return;
  }

  // Count task tool calls.
  const taskIndices: number[] = [];
  toolCalls.forEach((tc, i) => {
    if (tc["name"] === "task") {
      taskIndices.push(i);
    }
  });
  if (taskIndices.length <= maxConcurrent) {
    return;
  }

  // Build set of indices to drop (excess task calls beyond the limit).
  const indicesToDrop = new Set<number>(taskIndices.slice(maxConcurrent));
  const truncatedToolCalls = toolCalls.filter((_tc, i) => !indicesToDrop.has(i));

  console.warn(
    `Truncated ${indicesToDrop.size} excess task tool call(s) from model response (limit: ${maxConcurrent})`
  );

  const updatedMsg = cloneAiMessageWithToolCalls(
    lastMsg as unknown as MessageLike,
    truncatedToolCalls
  );

  // Batch-guidance fix: inject a message telling the model that sub-tasks were
  // deferred so it can launch the next batch in the next turn (mirrors Python
  // `SubagentLimitMiddleware` behavior).
  const deferredCount = indicesToDrop.size;
  const guidance = new HumanMessage({
    content: `[Subagent scheduling] ${deferredCount} sub-task(s) deferred due to concurrency limit (${maxConcurrent} per turn). Launch the next batch now if you have more sub-tasks to run.`,
  });

  return { messages: [updatedMsg as unknown as BaseMessage, guidance] };
}

/** Truncate excess `task` tool calls from a single model response. */
export function subagentLimitMiddleware(
  maxConcurrent: number = MAX_CONCURRENT_SUBAGENTS
): MiddlewareDefinition {
  const limit = clampSubagentLimit(maxConcurrent);
  return {
    name: "SubagentLimitMiddleware",
    afterModel: (state: ThreadState) => truncateTaskCalls(state, limit) ?? {},
  };
}
