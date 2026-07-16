/**
 * Subagent polling loop — replaces the inline poll-and-SSE block that used to
 * live in `gateway_server.mjs::runSubagent`.
 *
 * Mirrors Python `task_tool`: runs a background subagent, polls it every 5s,
 * streams freshly captured steps as `task_running` events, and on a terminal
 * status emits the matching completion / failure / timeout event. When an
 * event store is supplied it also persists `subagent.{start,step,end}` events
 * so historical runs can backfill the subtask card after a reload.
 *
 * Transport-agnostic: the poller takes an injected `emitEvent` (the gateway
 * wires LangGraph's `getWriter`; tests wire a collector) and an optional
 * `RunEventStore`. It does not import either.
 */

import {
  cleanupBackgroundTask,
  getBackgroundTaskResult,
  type SubagentExecutor,
  type SubagentResult,
  type SubagentExecutorOptions,
} from "../executor.js";
import type { SubagentConfig } from "../config.js";
import type { RunEventStore } from "../../runtime/events/store/base.js";
import {
  SUBAGENT_CATEGORY,
  SUBAGENT_EVENT_TYPES,
  toContractStatus,
  type SubagentFinalResult,
} from "./result.js";
import {
  describeSubagent,
  stepToMessageEvent,
  type SubagentSseEmitter,
} from "./sse.js";

const POLL_INTERVAL_MS = 5000;
const POLL_GRACE_SECONDS = 60;

export interface SubagentPollerOptions {
  executor: SubagentExecutor;
  taskId: string;
  subagentConfig: SubagentConfig;
  description: string;
  emitEvent: SubagentSseEmitter;
  /** Persist `subagent.{start,step,end}` timeline events (optional). */
  eventStore?: RunEventStore | null;
  /** Parent run/thread the events belong to (optional; for persistence). */
  parentThreadId?: string | null;
  parentRunId?: string | null;
}

/**
 * Run the poll loop to completion and return the normalised result. Throws on
 * a non-completed terminal status (mirrors Python `task_tool`, which raises
 * into `TaskErrorHandlingMiddleware`).
 */
export async function runSubagentPolled(options: SubagentPollerOptions): Promise<SubagentFinalResult> {
  const {
    executor,
    taskId,
    subagentConfig,
    description,
    emitEvent,
    eventStore = null,
    parentThreadId = null,
    parentRunId = null,
  } = options;

  const emit: SubagentSseEmitter = emitEvent;

  // --- task_started ---
  emit({
    type: "task_started",
    task_id: taskId,
    description: describeSubagent(subagentConfig.name, description),
  });
  await persistEvent(eventStore, {
    thread_id: parentThreadId,
    run_id: parentRunId,
    event_type: SUBAGENT_EVENT_TYPES.start,
    category: SUBAGENT_CATEGORY,
    metadata: { task_id: taskId, subagent: subagentConfig.name, description },
  });

  // Persisted steps, ordered, for the end-event summary + cursor paging.
  const steps: SubagentFinalResult["steps"] = [];
  let lastCapturedCount = 0;
  const maxPolls = Math.max(1, Math.ceil((subagentConfig.timeoutSeconds + POLL_GRACE_SECONDS) / (POLL_INTERVAL_MS / 1000)));

  let pollCount = 0;
  try {
    for (;;) {
      const result = getBackgroundTaskResult(taskId);
      if (result === null) {
        const error = `Task ${taskId} disappeared from background tasks`;
        emit({ type: "task_failed", task_id: taskId, error });
        throw new Error(error);
      }

      // Stream newly captured steps since the last poll (AI + Tool).
      const captured = capturedSteps(result);
      if (captured.length > lastCapturedCount) {
        for (let i = lastCapturedCount; i < captured.length; i++) {
          const step = captured[i];
          steps.push(step);
          emit(stepToMessageEvent(taskId, step, captured.length));
          await persistEvent(eventStore, {
            thread_id: parentThreadId,
            run_id: parentRunId,
            event_type: SUBAGENT_EVENT_TYPES.step,
            category: SUBAGENT_CATEGORY,
            metadata: { task_id: taskId, message_index: step.message_index },
            content: step,
          });
        }
        lastCapturedCount = captured.length;
      }

      switch (result.status) {
        case "completed": {
          const final = buildFinalResult(taskId, result, steps);
          emit({
            type: "task_completed",
            task_id: taskId,
            result: final.result,
            token_usage: result.tokenUsageRecords ?? undefined,
          });
          await persistTerminal(eventStore, parentThreadId, parentRunId, taskId, final);
          return final;
        }
        case "failed": {
          const error = result.error || "Subagent failed";
          emit({ type: "task_failed", task_id: taskId, error });
          const final = buildFinalResult(taskId, result, steps);
          await persistTerminal(eventStore, parentThreadId, parentRunId, taskId, final);
          return final;
        }
        case "cancelled": {
          const error = result.error || "Cancelled by user";
          emit({ type: "task_cancelled", task_id: taskId, error });
          throw new Error(error);
        }
        case "timed_out": {
          const error = result.error || "Subagent timed out";
          emit({ type: "task_timed_out", task_id: taskId, error });
          throw new Error(error);
        }
        default:
          break;
      }

      await sleep(POLL_INTERVAL_MS);
      pollCount += 1;
      if (pollCount > maxPolls) {
        const timeoutMinutes = Math.floor(subagentConfig.timeoutSeconds / 60);
        const error = `Task polling timed out after ${timeoutMinutes} minutes`;
        emit({ type: "task_timed_out", task_id: taskId, error });
        throw new Error(error);
      }
    }
  } finally {
    // Best-effort cleanup of the background-tool entry so it doesn't leak in
    // the module-level registry.
    cleanupBackgroundTask(taskId);
  }
}

/** Extract captured steps from a poll snapshot (no-op pass-through). */
function capturedSteps(result: SubagentResult): SubagentFinalResult["steps"] {
  return (result.steps as unknown as SubagentFinalResult["steps"]) ?? [];
}

function buildFinalResult(taskId: string, result: SubagentResult, steps: SubagentFinalResult["steps"]): SubagentFinalResult {
  // Only a `completed` run carries a result body; every other terminal state
  // reports through `error`. Mirrors Python's `build_subagent_result`.
  const isCompleted = result.status === "completed";
  return {
    taskId,
    status: toContractStatus(result.status),
    result: isCompleted ? result.result : null,
    error: isCompleted ? null : result.error,
    tokenUsageRecords: result.tokenUsageRecords ?? [],
    steps,
  };
}

async function persistTerminal(
  eventStore: RunEventStore | null,
  parentThreadId: string | null,
  parentRunId: string | null,
  taskId: string,
  final: SubagentFinalResult,
): Promise<void> {
  await persistEvent(eventStore, {
    thread_id: parentThreadId,
    run_id: parentRunId,
    event_type: SUBAGENT_EVENT_TYPES.end,
    category: SUBAGENT_CATEGORY,
    metadata: { task_id: taskId, status: final.status },
    content: { status: final.status, result: final.result, error: final.error },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** No-op persist when no store is supplied; best-effort otherwise. */
async function persistEvent(
  eventStore: RunEventStore | null,
  args: {
    thread_id: string | null;
    run_id: string | null;
    event_type: string;
    category: string;
    metadata?: Record<string, unknown>;
    content?: unknown;
  },
): Promise<void> {
  if (eventStore === null || eventStore === undefined) {
    return;
  }
  if (!args.thread_id || !args.run_id) {
    return;
  }
  try {
    await eventStore.put({
      thread_id: args.thread_id,
      run_id: args.run_id,
      event_type: args.event_type,
      category: args.category,
      content: args.content ?? null,
      metadata: args.metadata ?? null,
    });
  } catch (err) {
    console.warn(`[poller] failed to persist ${args.event_type}: ${err instanceof Error ? err.message : err}`);
  }
}

// Re-exported for the factory / gateway to construct executors with one import.
export type { SubagentExecutor, SubagentExecutorOptions };
