/**
 * Normalized subagent result + status vocabulary for the runtime layer.
 *
 * Mirrors `quill.subagents.runtime.result` from the Python backend: the
 * polling loop ({@link runSubagentPolled}) consumes the raw
 * {@link SubagentExecutor} lifecycle but hands the rest of the system — the
 * `task` tool body, the SSE emitter, and the structured `ToolMessage` stamper
 * — a small, stable, serializable shape decoupled from the executor.
 */

import { SubagentStatus } from "../executor.js";
import type { SubagentStatusValue } from "../status_contract.js";

/** Normalised terminal status → the structured status vocabulary. */
const STATUS_TO_CONTRACT: Record<SubagentStatus, SubagentStatusValue> = {
  [SubagentStatus.PENDING]: "failed", // should never be terminal; defence only
  [SubagentStatus.RUNNING]: "failed", // "
  [SubagentStatus.COMPLETED]: "completed",
  [SubagentStatus.FAILED]: "failed",
  [SubagentStatus.CANCELLED]: "cancelled",
  [SubagentStatus.TIMED_OUT]: "timed_out",
};

export interface SubagentFinalResult {
  taskId: string;
  status: SubagentStatusValue;
  result: string | null;
  error: string | null;
  tokenUsageRecords: Array<Record<string, unknown>>;
  /** Captured steps (AI + Tool) in stream order — populated by the executor. */
  steps: SubagentStep[];
}

export type SubagentStepKind = "ai" | "tool";

export interface SubagentStep {
  /** Monotone per-subagent index (1-based) used both for SSE and persistence. */
  message_index: number;
  kind: SubagentStepKind;
  /** AI reasoning text, or the tool-call display label. */
  text: string;
  /** tool name for tool-kind steps. */
  tool_name?: string;
  /** Tool call requests carried by an AI step. */
  tool_calls?: Array<{ name?: string; args?: unknown }>;
  /** Set when `text` was truncated to `SUBAGENT_STEP_MAX_CHARS`. */
  truncated?: boolean;
}

/** Map the executor's enum to the structured contract value. */
export function toContractStatus(status: SubagentStatus): SubagentStatusValue {
  return STATUS_TO_CONTRACT[status] ?? "failed";
}

/**
 * Truncate oversized step content — mirrors Python's `build_subagent_step`
 * `SUBAGENT_STEP_MAX_CHARS` cap so a single tool dump can't balloon the wire
 * payload or the event store.
 */
export const SUBAGENT_STEP_MAX_CHARS = 4000;

export function clampStepText(text: string): { text: string; truncated: boolean } {
  if (text.length <= SUBAGENT_STEP_MAX_CHARS) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, SUBAGENT_STEP_MAX_CHARS)}…[truncated]`,
    truncated: true,
  };
}

/**
 * Persisted event types for the subagent timeline. Walked back via
 * `GET …/events?event_types=subagent.start,subagent.step,subagent.end` and
 * by `task_id` for card backfill.
 */
export const SUBAGENT_EVENT_TYPES = {
  start: "subagent.start",
  step: "subagent.step",
  end: "subagent.end",
} as const;

export const SUBAGENT_CATEGORY = "subagent" as const;
