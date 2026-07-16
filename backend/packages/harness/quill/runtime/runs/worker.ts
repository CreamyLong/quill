/**
 * Background agent execution.
 *
 * Runs an agent graph, publishing events to a {@link StreamBridge} as they are
 * produced.
 *
 * Uses `graph.astream(stream_mode=[...])` which gives correct full-state
 * snapshots for `values` mode, proper `{node: writes}` for `updates`, and
 * `(chunk, metadata)` tuples for `messages` mode.
 *
 * Note: `events` mode is not supported through the gateway — it requires
 * `graph.astream_events()` which cannot simultaneously produce `values`
 * snapshots.
 *
 * NOTE (TS port): Several dependencies have no TS analogue yet and are handled
 * per the port rules:
 * - `langgraph.runtime.Runtime` is not constructed; a plain object holding
 *   `{ context, store }` is assigned to `config.configurable.__pregel_runtime`.
 * - Python inspects the agent-factory signature for an `app_config` parameter;
 *   this port uses the function arity (`>= 2`) as the heuristic.
 * - The agent object is driven through a minimal `AgentLike.astream` interface
 *   mirroring the Python `graph.astream(...)` call.
 */

import { emptyCheckpoint } from "@langchain/langgraph";

import type { AppConfig } from "../../config/app_config.js";
import type { RunEventsConfig } from "../../config/run_events_config.js";
import { serialize } from "../serialization.js";
import type { StreamBridge } from "../stream_bridge/index.js";
import { getEffectiveUserId } from "../user_context.js";
import type { RunEventStore } from "../events/store/base.js";
import { RunManager, RunRecord } from "./manager.js";
import { resolveRootRunName } from "./naming.js";
import { RunStatus } from "./schemas.js";
import { injectLangfuseMetadata } from "../../tracing/metadata.js";

const logger = {
  info: (...a: unknown[]) => console.info(...a),
  warning: (...a: unknown[]) => console.warn(...a),
  debug: (...a: unknown[]) => console.debug(...a),
  error: (...a: unknown[]) => console.error(...a),
};

// Valid stream_mode values for LangGraph's graph.astream()
const _VALID_LG_MODES = new Set(["values", "updates", "checkpoints", "tasks", "debug", "messages", "custom"]);

/** Minimal view of a compiled agent graph, mirroring the Python `agent` object. */
export interface AgentLike {
  astream(
    input: unknown,
    options: { config: unknown; stream_mode?: string | string[]; subgraphs?: boolean }
  ): AsyncIterable<unknown>;
  metadata?: Record<string, unknown> | null;
  checkpointer?: unknown;
  store?: unknown;
  interrupt_before_nodes?: unknown;
  interrupt_after_nodes?: unknown;
  [key: string]: unknown;
}

export type AgentFactory = (config: unknown, appConfig?: AppConfig) => AgentLike;

/** Minimal checkpointer surface used by the worker (subset of BaseCheckpointSaver). */
export type CheckpointerLike = Record<string, any>;

/** Minimal thread-store surface used by the worker. */
export interface ThreadStoreLike {
  updateDisplayName?(threadId: string, title: string): Promise<void> | void;
  updateStatus?(threadId: string, status: string): Promise<void> | void;
  [key: string]: unknown;
}

/**
 * Infrastructure dependencies for a single agent run.
 *
 * Groups checkpointer, store, and persistence-related singletons so that
 * {@link runAgent} receives one object instead of a growing list of arguments.
 */
export interface RunContext {
  checkpointer: CheckpointerLike | null;
  store?: unknown | null;
  eventStore?: RunEventStore | null;
  runEventsConfig?: RunEventsConfig | null;
  threadStore?: ThreadStoreLike | null;
  appConfig?: AppConfig | null;
}

/**
 * Build the object that becomes `ToolRuntime.context` for the run.
 *
 * Always includes `thread_id` and `run_id`. Additional keys from the caller's
 * `config['context']` are merged in but never override `thread_id`/`run_id`. The
 * resolved `AppConfig` is added by the worker so tools can consume it without
 * ambient global lookups.
 */
function _buildRuntimeContext(
  threadId: string,
  runId: string,
  callerContext: unknown,
  appConfig: AppConfig | null = null
): Record<string, unknown> {
  const runtimeCtx: Record<string, unknown> = { thread_id: threadId, run_id: runId };
  if (callerContext !== null && typeof callerContext === "object" && !Array.isArray(callerContext)) {
    for (const [key, value] of Object.entries(callerContext as Record<string, unknown>)) {
      if (!(key in runtimeCtx)) {
        runtimeCtx[key] = value;
      }
    }
  }
  if (appConfig !== null) {
    runtimeCtx["app_config"] = appConfig;
  }
  return runtimeCtx;
}

function _installRuntimeContext(config: Record<string, any>, runtimeContext: Record<string, unknown>): void {
  const existingContext = config["context"];
  if (existingContext !== null && typeof existingContext === "object" && !Array.isArray(existingContext)) {
    if (!("thread_id" in existingContext)) {
      existingContext["thread_id"] = runtimeContext["thread_id"];
    }
    if (!("run_id" in existingContext)) {
      existingContext["run_id"] = runtimeContext["run_id"];
    }
    if ("app_config" in runtimeContext) {
      existingContext["app_config"] = runtimeContext["app_config"];
    }
    return;
  }
  config["context"] = { ...runtimeContext };
}

const _appConfigSupportCache = new WeakMap<object, boolean>();

function _computeAgentFactorySupportsAppConfig(agentFactory: AgentFactory): boolean {
  // Python inspects the signature for an `app_config` parameter. TS cannot read
  // parameter names, so we approximate with the function arity (accepts a second
  // positional argument).
  return agentFactory.length >= 2;
}

function _agentFactorySupportsAppConfig(agentFactory: AgentFactory): boolean {
  const cached = _appConfigSupportCache.get(agentFactory);
  if (cached !== undefined) {
    return cached;
  }
  const result = _computeAgentFactorySupportsAppConfig(agentFactory);
  _appConfigSupportCache.set(agentFactory, result);
  return result;
}

/** Execute an agent in the background, publishing events to *bridge*. */
export async function runAgent(
  bridge: StreamBridge,
  runManager: RunManager,
  record: RunRecord,
  options: {
    ctx: RunContext;
    agentFactory: AgentFactory;
    graphInput: Record<string, unknown>;
    config: Record<string, any>;
    streamModes?: string[] | null;
    streamSubgraphs?: boolean;
    interruptBefore?: string[] | "*" | null;
    interruptAfter?: string[] | "*" | null;
  }
): Promise<void> {
  const {
    ctx,
    agentFactory,
    graphInput,
    config,
    streamModes = null,
    streamSubgraphs = false,
    interruptBefore = null,
    interruptAfter = null,
  } = options;

  // Unpack infrastructure dependencies from RunContext.
  const checkpointer = ctx.checkpointer;
  const store = ctx.store ?? null;
  const eventStore = ctx.eventStore ?? null;
  const runEventsConfig = ctx.runEventsConfig ?? null;
  const threadStore = ctx.threadStore ?? null;

  const runId = record.run_id;
  const threadId = record.thread_id;
  const requestedModes = new Set<string>(streamModes ?? ["values"]);
  let preRunCheckpointId: string | null = null;
  let preRunSnapshot: Record<string, unknown> | null = null;
  let snapshotCaptureFailed = false;
  let llmErrorFallbackMessage: string | null = null;

  let journal: import("../journal.js").RunJournal | null = null;

  if (requestedModes.has("events")) {
    logger.info(
      "Run %s: 'events' stream_mode not supported in gateway (requires astream_events + checkpoint callbacks). Skipping.",
      runId
    );
  }

  try {
    // Initialize RunJournal + write human_message event.
    if (eventStore !== null) {
      const { RunJournal } = await import("../journal.js");
      journal = new RunJournal({
        runId,
        threadId,
        eventStore,
        trackTokenUsage: runEventsConfig?.trackTokenUsage ?? true,
        progressReporter: (snapshot) => runManager.updateRunProgress(runId, snapshot),
      });
    }

    // 1. Mark running
    await runManager.setStatus(runId, RunStatus.RUNNING);

    // Snapshot the latest pre-run checkpoint so rollback can restore it.
    if (checkpointer !== null) {
      try {
        const configForCheck = { configurable: { thread_id: threadId, checkpoint_ns: "" } };
        const ckptTuple = await _callCheckpointerMethod(checkpointer, "getTuple", "getTuple", configForCheck);
        if (ckptTuple !== null && ckptTuple !== undefined) {
          const ckptConfig = ((ckptTuple as Record<string, any>)["config"] ?? {})["configurable"] ?? {};
          preRunCheckpointId = ckptConfig["checkpoint_id"] ?? null;
          preRunSnapshot = {
            checkpoint_ns: ckptConfig["checkpoint_ns"] ?? "",
            checkpoint: structuredCloneSafe((ckptTuple as Record<string, any>)["checkpoint"] ?? {}),
            metadata: structuredCloneSafe((ckptTuple as Record<string, any>)["metadata"] ?? {}),
            pending_writes: structuredCloneSafe((ckptTuple as Record<string, any>)["pendingWrites"] ?? []),
          };
        }
      } catch {
        snapshotCaptureFailed = true;
        logger.warning("Could not capture pre-run checkpoint snapshot for run %s", runId);
      }
    }

    // 2. Publish metadata — useStream needs both run_id AND thread_id
    await bridge.publish(runId, "metadata", { run_id: runId, thread_id: threadId });

    // 3. Build the agent — inject runtime context so middlewares and tools can
    // access thread-level data.
    const runtimeCtx = _buildRuntimeContext(threadId, runId, config["context"], ctx.appConfig ?? null);
    // Expose the run-scoped journal under a sentinel key so middleware can write
    // audit events. Double-underscore prefix marks it as a runtime-internal
    // channel; user code must not depend on the key name.
    if (journal !== null) {
      runtimeCtx["__run_journal"] = journal;
    }
    _installRuntimeContext(config, runtimeCtx);
    // NOTE (TS port): a plain object stands in for langgraph's Runtime class.
    const runtime = { context: runtimeCtx, store };
    (config["configurable"] ??= {})["__pregel_runtime"] = runtime;

    // Inject RunJournal as a callback handler.
    if (journal !== null) {
      (config["callbacks"] ??= []).push(journal);
    }

    // Inject Langfuse trace-attribute metadata (no-op when Langfuse is disabled).
    injectLangfuseMetadata({
      config,
      threadId,
      userId: getEffectiveUserId(),
      assistantId: record.assistant_id,
      modelName: record.model_name,
      environment: process.env["QUILL_ENV"] ?? process.env["ENVIRONMENT"] ?? null,
    });

    // Resolve after runtime context installation.
    config["run_name"] ??= resolveRootRunName(config, record.assistant_id);
    const runnableConfig = config;
    let agent: AgentLike;
    if (ctx.appConfig != null && _agentFactorySupportsAppConfig(agentFactory)) {
      agent = agentFactory(runnableConfig, ctx.appConfig);
    } else {
      agent = agentFactory(runnableConfig);
    }

    // Capture the effective (resolved) model name from the agent's metadata.
    if (record.model_name !== null) {
      const resolved = agent.metadata ?? {};
      if (resolved !== null && typeof resolved === "object") {
        const effective = (resolved as Record<string, unknown>)["model_name"];
        if (effective && effective !== record.model_name) {
          await runManager.updateModelName(record.run_id, effective as string);
        }
      }
    }

    // 4. Attach checkpointer and store
    if (checkpointer !== null) {
      agent.checkpointer = checkpointer;
    }
    if (store !== null) {
      agent.store = store;
    }

    // 5. Set interrupt nodes
    if (interruptBefore) {
      agent.interrupt_before_nodes = interruptBefore;
    }
    if (interruptAfter) {
      agent.interrupt_after_nodes = interruptAfter;
    }

    // 6. Build LangGraph stream_mode list
    const lgModesRaw: string[] = [];
    for (const m of requestedModes) {
      if (m === "messages-tuple") {
        lgModesRaw.push("messages");
      } else if (m === "events") {
        continue;
      } else if (_VALID_LG_MODES.has(m)) {
        lgModesRaw.push(m);
      }
    }
    let lgModes = lgModesRaw.length > 0 ? lgModesRaw : ["values"];

    // Deduplicate while preserving order
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const m of lgModes) {
      if (!seen.has(m)) {
        seen.add(m);
        deduped.push(m);
      }
    }
    lgModes = deduped;

    logger.info("Run %s: streaming with modes %o (requested: %o)", runId, lgModes, [...requestedModes]);

    // 7. Stream using graph.astream
    if (lgModes.length === 1 && !streamSubgraphs) {
      const singleMode = lgModes[0]!;
      for await (const chunk of agent.astream(graphInput, { config: runnableConfig, stream_mode: singleMode })) {
        if (record.abort_event.isSet()) {
          logger.info("Run %s abort requested — stopping", runId);
          break;
        }
        llmErrorFallbackMessage = llmErrorFallbackMessage || _extractLlmErrorFallbackMessage(chunk);
        const sseEvent = _lgModeToSseEvent(singleMode);
        await bridge.publish(runId, sseEvent, serialize(chunk, { mode: singleMode }));
      }
    } else {
      for await (const item of agent.astream(graphInput, {
        config: runnableConfig,
        stream_mode: lgModes,
        subgraphs: streamSubgraphs,
      })) {
        if (record.abort_event.isSet()) {
          logger.info("Run %s abort requested — stopping", runId);
          break;
        }
        const [mode, chunk] = _unpackStreamItem(item, lgModes, streamSubgraphs);
        if (mode === null) {
          continue;
        }
        llmErrorFallbackMessage = llmErrorFallbackMessage || _extractLlmErrorFallbackMessage(chunk);
        const sseEvent = _lgModeToSseEvent(mode);
        await bridge.publish(runId, sseEvent, serialize(chunk, { mode }));
      }
    }

    // 8. Final status
    if (record.abort_event.isSet()) {
      const action = record.abort_action;
      if (action === "rollback") {
        await runManager.setStatus(runId, RunStatus.ERROR, { error: "Rolled back by user" });
        try {
          await _rollbackToPreRunCheckpoint({
            checkpointer,
            threadId,
            runId,
            preRunCheckpointId,
            preRunSnapshot,
            snapshotCaptureFailed,
          });
          logger.info("Run %s rolled back to pre-run checkpoint %s", runId, preRunCheckpointId);
        } catch {
          logger.warning("Failed to rollback checkpoint for run %s", runId);
        }
      } else {
        await runManager.setStatus(runId, RunStatus.INTERRUPTED);
      }
    } else if (llmErrorFallbackMessage || (journal !== null && journal.hadLlmErrorFallback)) {
      let errorMsg = llmErrorFallbackMessage;
      if (errorMsg === null && journal !== null) {
        errorMsg = journal.llmErrorFallbackMessage;
      }
      errorMsg = errorMsg || "LLM provider failed after retries";
      await runManager.setStatus(runId, RunStatus.ERROR, { error: errorMsg });
    } else {
      await runManager.setStatus(runId, RunStatus.SUCCESS);
    }
  } catch (exc) {
    const errorMsg = `${describeError(exc)}`;
    logger.error("Run %s failed: %s", runId, errorMsg);
    await runManager.setStatus(runId, RunStatus.ERROR, { error: errorMsg });
    await bridge.publish(runId, "error", { message: errorMsg, name: errorName(exc) });
  } finally {
    // Flush any buffered journal events and persist completion data
    if (journal !== null) {
      try {
        await journal.flush();
      } catch {
        logger.warning("Failed to flush journal for run %s", runId);
      }

      try {
        const completion = journal.getCompletionData();
        await runManager.updateRunCompletion(runId, { status: record.status, ...completion });
      } catch {
        logger.warning("Failed to persist run completion for %s (non-fatal)", runId);
      }
    }

    // Sync title from checkpoint to threads_meta.display_name
    if (checkpointer !== null && threadStore !== null) {
      try {
        const ckptConfig = { configurable: { thread_id: threadId, checkpoint_ns: "" } };
        const ckptTuple = await _callCheckpointerMethod(checkpointer, "getTuple", "getTuple", ckptConfig);
        if (ckptTuple !== null && ckptTuple !== undefined) {
          const ckpt = ((ckptTuple as Record<string, any>)["checkpoint"] ?? {}) as Record<string, any>;
          const title = (ckpt["channel_values"] ?? {})["title"];
          if (title && threadStore.updateDisplayName) {
            await threadStore.updateDisplayName(threadId, title);
          }
        }
      } catch {
        logger.debug("Failed to sync title for thread %s (non-fatal)", threadId);
      }
    }

    // Update threads_meta status based on run outcome
    if (threadStore !== null && threadStore.updateStatus) {
      try {
        const finalStatus = record.status === RunStatus.SUCCESS ? "idle" : record.status;
        await threadStore.updateStatus(threadId, finalStatus);
      } catch {
        logger.debug("Failed to update thread_meta status for %s (non-fatal)", threadId);
      }
    }

    await bridge.publishEnd(runId);
    void bridge.cleanup(runId, { delay: 60 });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function structuredCloneSafe<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.constructor.name;
  }
  return typeof error;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Call a checkpointer method, supporting async and sync variants. */
async function _callCheckpointerMethod(
  checkpointer: CheckpointerLike,
  asyncName: string,
  syncName: string,
  ...args: unknown[]
): Promise<unknown> {
  const method = (checkpointer[asyncName] ?? checkpointer[syncName]) as
    | ((...a: unknown[]) => unknown)
    | undefined;
  if (method === undefined) {
    throw new Error(`Missing checkpointer method: ${asyncName}/${syncName}`);
  }
  const result = method.apply(checkpointer, args);
  if (result !== null && typeof result === "object" && typeof (result as { then?: unknown }).then === "function") {
    return await (result as Promise<unknown>);
  }
  return result;
}

/** Restore thread state to the checkpoint snapshot captured before run start. */
async function _rollbackToPreRunCheckpoint(options: {
  checkpointer: CheckpointerLike | null;
  threadId: string;
  runId: string;
  preRunCheckpointId: string | null;
  preRunSnapshot: Record<string, unknown> | null;
  snapshotCaptureFailed: boolean;
}): Promise<void> {
  const { checkpointer, threadId, runId, preRunCheckpointId, preRunSnapshot, snapshotCaptureFailed } = options;
  if (checkpointer === null) {
    logger.info("Run %s rollback requested but no checkpointer is configured", runId);
    return;
  }

  if (snapshotCaptureFailed) {
    logger.warning("Run %s rollback skipped: pre-run checkpoint snapshot capture failed", runId);
    return;
  }

  if (preRunSnapshot === null) {
    await _callCheckpointerMethod(checkpointer, "deleteThread", "deleteThread", threadId);
    logger.info("Run %s rollback reset thread %s to empty state", runId, threadId);
    return;
  }

  const checkpoint = preRunSnapshot["checkpoint"];
  if (checkpoint === null || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    logger.warning("Run %s rollback skipped: invalid pre-run checkpoint snapshot", runId);
    return;
  }
  let checkpointToRestore = checkpoint as Record<string, any>;
  if (checkpointToRestore["id"] === null || checkpointToRestore["id"] === undefined) {
    if (preRunCheckpointId !== null) {
      checkpointToRestore = { ...checkpointToRestore, id: preRunCheckpointId };
    }
  }
  if (checkpointToRestore["id"] === null || checkpointToRestore["id"] === undefined) {
    logger.warning("Run %s rollback skipped: pre-run checkpoint has no checkpoint id", runId);
    return;
  }
  const restoreMarker = _newCheckpointMarker();
  checkpointToRestore = { ...checkpointToRestore, id: restoreMarker.id, ts: restoreMarker.ts };
  const metadata = preRunSnapshot["metadata"];
  const metadataToRestore =
    metadata !== null && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const rawCheckpointNs = preRunSnapshot["checkpoint_ns"];
  const checkpointNs = typeof rawCheckpointNs === "string" ? rawCheckpointNs : "";

  const channelVersions = checkpointToRestore["channel_versions"];
  const newVersions =
    channelVersions !== null && typeof channelVersions === "object" && !Array.isArray(channelVersions)
      ? { ...(channelVersions as Record<string, unknown>) }
      : {};

  const restoreConfig = { configurable: { thread_id: threadId, checkpoint_ns: checkpointNs } };
  const restoredConfig = await _callCheckpointerMethod(
    checkpointer,
    "put",
    "put",
    restoreConfig,
    checkpointToRestore,
    metadataToRestore,
    newVersions
  );
  if (restoredConfig === null || typeof restoredConfig !== "object") {
    throw new Error(`Run ${runId} rollback restore returned invalid config: expected object`);
  }
  const restoredConfigurable = (restoredConfig as Record<string, any>)["configurable"] ?? {};
  if (restoredConfigurable === null || typeof restoredConfigurable !== "object") {
    throw new Error(`Run ${runId} rollback restore returned invalid config payload`);
  }
  const restoredCheckpointId = (restoredConfigurable as Record<string, any>)["checkpoint_id"];
  if (!restoredCheckpointId) {
    throw new Error(`Run ${runId} rollback restore did not return checkpoint_id`);
  }

  const pendingWrites = (preRunSnapshot["pending_writes"] ?? []) as unknown[];
  if (!pendingWrites || pendingWrites.length === 0) {
    return;
  }

  const writesByTask = new Map<string, Array<[string, unknown]>>();
  for (const item of pendingWrites) {
    if (!Array.isArray(item) || item.length !== 3) {
      throw new Error(`Run ${runId} rollback failed: pending_write is not a 3-tuple: ${JSON.stringify(item)}`);
    }
    const [taskId, channel, value] = item as [unknown, unknown, unknown];
    if (typeof channel !== "string") {
      throw new Error(
        `Run ${runId} rollback failed: pending_write has non-string channel: task_id=${JSON.stringify(taskId)}, channel=${JSON.stringify(channel)}`
      );
    }
    const key = String(taskId);
    let bucket = writesByTask.get(key);
    if (bucket === undefined) {
      bucket = [];
      writesByTask.set(key, bucket);
    }
    bucket.push([channel, value]);
  }

  for (const [taskId, writes] of writesByTask.entries()) {
    await _callCheckpointerMethod(checkpointer, "putWrites", "putWrites", restoreConfig, writes, taskId);
  }
}

function _newCheckpointMarker(): { id: string; ts: string } {
  const marker = emptyCheckpoint();
  return { id: marker.id, ts: marker.ts };
}

/**
 * Map LangGraph internal stream_mode name to SSE event name.
 *
 * All LG modes map 1:1 to SSE event names — "messages" stays "messages".
 */
function _lgModeToSseEvent(mode: string): string {
  return mode;
}

function _errorFallbackMessageFromMetadata(metadata: Record<string, any>, content: unknown): string {
  const detail = metadata["error_detail"];
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }
  const reason = metadata["error_reason"];
  if (typeof reason === "string" && reason.trim()) {
    return reason.trim();
  }
  if (typeof content === "string" && content.trim()) {
    return content.trim().slice(0, 2000);
  }
  return "LLM provider failed after retries";
}

/** Try to extract fallback marker from a single message object or dict. */
function _tryExtractFromMessage(obj: unknown): string | null {
  const additionalKwargs = (obj as { additional_kwargs?: unknown } | null)?.additional_kwargs;
  if (additionalKwargs !== null && typeof additionalKwargs === "object" && (additionalKwargs as Record<string, any>)["quill_error_fallback"]) {
    return _errorFallbackMessageFromMetadata(
      additionalKwargs as Record<string, any>,
      (obj as { content?: unknown }).content
    );
  }

  if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
    const nestedKwargs = (obj as Record<string, any>)["additional_kwargs"];
    if (nestedKwargs !== null && typeof nestedKwargs === "object" && nestedKwargs["quill_error_fallback"]) {
      return _errorFallbackMessageFromMetadata(nestedKwargs, (obj as Record<string, any>)["content"]);
    }
  }
  return null;
}

/** Find LLM fallback markers in streamed LangGraph chunks. */
function _extractLlmErrorFallbackMessage(value: unknown): string | null {
  // Fast path: large state chunks produced by stream_mode="values" have a
  // top-level "messages" list. Scanning only that list avoids expensive deep
  // recursion into large state dicts.
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const messages = (value as Record<string, any>)["messages"];
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        const result = _tryExtractFromMessage(msg);
        if (result !== null) {
          return result;
        }
      }
      // Fallback marker is attached to an AI message in the messages channel; it
      // will never appear elsewhere in a values chunk.
      return null;
    }
    // No top-level "messages" — likely an "updates" chunk. Fall through to deep
    // walk, which is cheap for these payloads.
  }

  const seen = new Set<unknown>();

  const walk = (obj: unknown): string | null => {
    if (seen.has(obj)) {
      return null;
    }
    seen.add(obj);

    const result = _tryExtractFromMessage(obj);
    if (result !== null) {
      return result;
    }

    if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
      for (const item of Object.values(obj as Record<string, unknown>)) {
        const nested = walk(item);
        if (nested !== null) {
          return nested;
        }
      }
      return null;
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        const nested = walk(item);
        if (nested !== null) {
          return nested;
        }
      }
    }
    return null;
  };

  return walk(value);
}

/**
 * Unpack a multi-mode or subgraph stream item into (mode, chunk).
 *
 * Returns `[null, null]` if the item cannot be parsed.
 */
function _unpackStreamItem(
  item: unknown,
  lgModes: string[],
  streamSubgraphs: boolean
): [string | null, unknown] {
  if (streamSubgraphs) {
    if (Array.isArray(item) && item.length === 3) {
      const [, mode, chunk] = item as [unknown, unknown, unknown];
      return [String(mode), chunk];
    }
    if (Array.isArray(item) && item.length === 2) {
      const [mode, chunk] = item as [unknown, unknown];
      return [String(mode), chunk];
    }
    return [null, null];
  }

  if (Array.isArray(item) && item.length === 2) {
    const [mode, chunk] = item as [unknown, unknown];
    return [String(mode), chunk];
  }

  // Fallback: single-element output from first mode
  return [lgModes.length > 0 ? lgModes[0]! : null, item];
}
