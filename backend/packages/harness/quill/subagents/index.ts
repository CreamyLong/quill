/**
 * Subagents subsystem public API.
 *
 * Mirrors `quill.subagents.__init__` from the Python backend.
 */

export {
  type SubagentConfig,
  createSubagentConfig,
  replaceSubagentConfig,
  resolveSubagentModelName,
} from "./config.js";
export {
  SubagentExecutor,
  SubagentResult,
  SubagentStatus,
  isTerminalStatus,
  CancelEvent,
  MAX_CONCURRENT_SUBAGENTS,
  requestCancelBackgroundTask,
  getBackgroundTaskResult,
  listBackgroundTasks,
  cleanupBackgroundTask,
  type SubagentCapturedStep,
  type SubagentExecutorOptions,
  type DeferredToolSetup,
} from "./executor.js";
export {
  getAvailableSubagentNames,
  getSubagentConfig,
  getSubagentNames,
  listSubagents,
  type SubagentsConfigSource,
} from "./registry.js";
// Runtime layer (poller, normalised results, SSE vocabulary, children registry).
export * from "./runtime/index.js";
export * from "./runtime/children.js";
