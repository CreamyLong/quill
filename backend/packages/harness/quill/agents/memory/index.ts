export {
  type ConversationContext,
  type QueueKey,
  type MemoryUpdateQueue,
  queueKey,
} from "./queue.js";

export {
  type MessageLike,
  extractMessageText,
  filterMessagesForMemory,
  detectCorrection,
  detectReinforcement,
} from "./message_processing.js";

export {
  createEmptyMemory,
  utcNowIsoZ,
  FileMemoryStorage,
  getMemoryStorage,
  resetMemoryStorage,
  type MemoryStorage,
} from "./storage.js";

export {
  MemoryUpdateQueueImpl,
  type ProcessQueueCallback,
  getMemoryQueue,
  resetMemoryQueue,
} from "./queue_impl.js";

export {
  MEMORY_UPDATE_PROMPT,
  FACT_EXTRACTION_PROMPT,
  formatMemoryForInjection,
  formatConversationForUpdate,
  charBasedTokenEstimate,
  countTokens,
} from "./prompt.js";

export {
  MemoryUpdater,
  updateMemoryFromConversation,
  getMemoryContext,
  type MemoryUpdaterOptions,
} from "./updater.js";

// Memory diagnostics and repair (v0.5.0)
export {
  type MemoryFact,
  type MemoryHealthScore,
  type MemoryHealthIssue,
  type MemoryHealthReport,
  type FactGraphNode,
  type FactGraphEdge,
  type FactGraph,
  type RepairAction,
  type MemoryRepair,
  type RepairReport,
  type MemoryDiagnosticsConfig,
  DEFAULT_DIAGNOSTICS_CONFIG,
} from "./health_types.js";

export {
  MemoryDiagnostics,
  buildFactGraph,
} from "./diagnostics.js";

export {
  MemoryRepairEngine,
} from "./repair.js";
