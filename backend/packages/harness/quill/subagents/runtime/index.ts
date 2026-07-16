/**
 * Subagent runtime layer — the polling loop, normalised result shapes, and SSE
 * event vocabulary that the `task` tool and the gateway's `runSubagent`
 * callback share.
 *
 * Mirrors `quill.subagents.runtime` from the Python backend.
 */

export {
  runSubagentPolled,
  type SubagentPollerOptions,
} from "./poller.js";
export {
  SUBAGENT_CATEGORY,
  SUBAGENT_EVENT_TYPES,
  clampStepText,
  toContractStatus,
  type SubagentFinalResult,
  type SubagentStep,
  type SubagentStepKind,
} from "./result.js";
export {
  describeSubagent,
  finalizeToEvent,
  stepToMessageEvent,
  type SubagentSseEmitter,
  type SubagentSseEvent,
  type TaskCancelledEvent,
  type TaskCompletedEvent,
  type TaskFailedEvent,
  type TaskRunningEvent,
  type TaskStartedEvent,
  type TaskTimedOutEvent,
} from "./sse.js";
