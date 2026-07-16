/**
 * SSE event shapes emitted to the frontend's live subtask cards by the poller.
 *
 * These mirror the events the Gateway's `custom` SSE channel already forwards
 * (see `gateway.ts` `handleRunStream` → `custom`). The poller takes an injected
 * `emitEvent` so it stays transport-agnostic — the gateway wires it to
 * LangGraph's `getWriter`, tests wire it to a collector.
 */

import type { SubagentFinalResult, SubagentStep } from "./result.js";

export interface TaskStartedEvent {
  type: "task_started";
  task_id: string;
  description: string;
}

export interface TaskRunningEvent {
  type: "task_running";
  task_id: string;
  message: Record<string, unknown>;
  message_index: number;
  total_messages: number;
}

export interface TaskCompletedEvent {
  type: "task_completed";
  task_id: string;
  result: string | null;
  token_usage?: Array<Record<string, unknown>>;
}

export interface TaskFailedEvent {
  type: "task_failed";
  task_id: string;
  error: string;
}

export interface TaskCancelledEvent {
  type: "task_cancelled";
  task_id: string;
  error: string;
}

export interface TaskTimedOutEvent {
  type: "task_timed_out";
  task_id: string;
  error: string;
}

export type SubagentSseEvent =
  | TaskStartedEvent
  | TaskRunningEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TaskCancelledEvent
  | TaskTimedOutEvent;

export type SubagentSseEmitter = (event: SubagentSseEvent) => void;

/** Human-readable description for the `task_started` event. */
export function describeSubagent(subagentType: string, label: string, fallback?: string): string {
  const text = (label ?? "").trim();
  return text ? text : fallback ?? `${subagentType} subagent`;
}

/** Build the `task_running` SSE message payload for a captured step. */
export function stepToMessageEvent(
  taskId: string,
  step: SubagentStep,
  totalMessages: number,
): TaskRunningEvent {
  const message: Record<string, unknown> =
    step.kind === "tool"
      ? { type: "tool", content: step.text, name: step.tool_name }
      : { type: "ai", content: step.text, tool_calls: step.tool_calls ?? [] };
  return {
    type: "task_running",
    task_id: taskId,
    message,
    message_index: step.message_index,
    total_messages: totalMessages,
  };
}

/** Translate a final result into the terminal SSE event. */
export function finalizeToEvent(taskId: string, final: SubagentFinalResult): SubagentSseEvent {
  switch (final.status) {
    case "completed":
      return { type: "task_completed", task_id: taskId, result: final.result, token_usage: final.tokenUsageRecords };
    case "cancelled":
      return { type: "task_cancelled", task_id: taskId, error: final.error ?? "Cancelled by user" };
    case "timed_out":
      return { type: "task_timed_out", task_id: taskId, error: final.error ?? "Timed out" };
    case "polling_timed_out":
      return { type: "task_timed_out", task_id: taskId, error: final.error ?? "Polling timed out" };
    case "failed":
    default:
      return { type: "task_failed", task_id: taskId, error: final.error ?? "Subagent failed" };
  }
}
