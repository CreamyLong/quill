/**
 * Run event capture via LangChain callbacks.
 *
 * RunJournal sits between LangChain's callback mechanism and the pluggable
 * RunEventStore. It standardizes callback data into RunEvent records and handles
 * token usage accumulation.
 *
 * Key design decisions:
 * - onLlmNewToken is NOT implemented -- only complete messages via onLlmEnd
 * - onChatModelStart captures structured prompts as llm_request and extracts the
 *   first human message for run.input, because it is more reliable than
 *   onChainStart (fires on every node) — messages here are fully structured.
 * - onChainStart with parentRunId=null emits a run.start trace marking root
 *   invocation.
 * - onLlmEnd emits llm_response in the message shape.
 * - Token usage accumulated in memory, written to RunRow on run completion.
 * - Caller identification via tags injection (lead_agent / subagent:{name} /
 *   middleware:{name}).
 *
 * NOTE (TS port): The Python class subclasses LangChain's
 * `BaseCallbackHandler`. The JS callback-handler method signatures differ, so
 * this port keeps the same method names and logic but does NOT extend the JS
 * `BaseCallbackHandler`. Wiring it as an actual LangChain JS callback requires an
 * adapter mapping the JS `handleXxx` hooks onto these `onXxx` methods. The
 * event-buffer, token accumulation, progress-flush, and completion-data logic
 * are ported faithfully.
 */

import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";

import { messageToText } from "../utils/messages.js";
import { serializeLcObject } from "./serialization.js";
import type { PutEventArgs, RunEventStore } from "./events/store/base.js";

const logger = {
  debug: (...a: unknown[]) => console.debug(...a),
  warning: (...a: unknown[]) => console.warn(...a),
};

/** Loosely-typed message shape — attributes accessed dynamically. */
type AnyMessage = BaseMessage | Record<string, any>;

/** Monotonic-ish clock in seconds. */
function monotonic(): number {
  return Date.now() / 1000;
}

export interface ExternalUsageRecord {
  source_run_id?: string;
  caller?: string;
  model_name?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  [key: string]: unknown;
}

export interface RunJournalOptions {
  runId: string;
  threadId: string;
  eventStore: RunEventStore;
  trackTokenUsage?: boolean;
  flushThreshold?: number;
  progressReporter?: ((snapshot: Record<string, unknown>) => Promise<void> | void) | null;
  progressFlushInterval?: number;
}

export class RunJournal {
  runId: string;
  threadId: string;
  private _store: RunEventStore;
  private _trackTokens: boolean;
  private _flushThreshold: number;
  private _progressReporter: ((snapshot: Record<string, unknown>) => Promise<void> | void) | null;
  private _progressFlushInterval: number;

  // Write buffer
  private _buffer: PutEventArgs[] = [];
  private _pendingFlushTasks: Set<Promise<void>> = new Set();
  private _pendingProgressTask: Promise<void> | null = null;
  private _pendingProgressDelayed = false;
  private _progressDirty = false;
  private _lastProgressFlush = 0.0;
  private _delayTimer: ReturnType<typeof setTimeout> | null = null;
  private _delayResolve: (() => void) | null = null;

  // Token accumulators
  private _totalInputTokens = 0;
  private _totalOutputTokens = 0;
  private _totalTokens = 0;
  private _llmCallCount = 0;

  // Caller-bucketed token accumulators
  private _leadAgentTokens = 0;
  private _subagentTokens = 0;
  private _middlewareTokens = 0;

  // Per-model token accumulator
  private _tokensByModel: Map<string, { input_tokens: number; output_tokens: number; total_tokens: number }> =
    new Map();

  // Dedup: LangChain may fire onLlmEnd multiple times for the same run_id
  private _countedLlmRunIds: Set<string> = new Set();
  private _countedExternalSourceIds: Set<string> = new Set();
  private _countedMessageLlmRunIds: Set<string> = new Set();

  // Convenience fields
  private _lastAiMsg: string | null = null;
  private _firstHumanMsg: string | null = null;
  private _msgCount = 0;
  private _hadLlmErrorFallback = false;
  private _llmErrorFallbackMessage: string | null = null;

  // Latency tracking
  private _llmStartTimes: Map<string, number> = new Map(); // langchain run_id -> start time

  // LLM request/response tracking
  private _llmCallIndex = 0;
  private _seenLlmStarts: Set<string> = new Set();

  constructor(options: RunJournalOptions) {
    this.runId = options.runId;
    this.threadId = options.threadId;
    this._store = options.eventStore;
    this._trackTokens = options.trackTokenUsage ?? true;
    this._flushThreshold = options.flushThreshold ?? 20;
    this._progressReporter = options.progressReporter ?? null;
    this._progressFlushInterval = options.progressFlushInterval ?? 5.0;
  }

  // -- Lifecycle callbacks --

  private static _messageText(message: AnyMessage): string {
    return messageToText(message, { textAttributeFallback: true });
  }

  private _recordMessageSummary(message: AnyMessage, caller: string | null = null): void {
    this._msgCount += 1;

    // `lastAiMessage` should represent the lead agent's user-facing answer.
    // Middleware/subagent model calls and empty tool-call-only AI messages must
    // not overwrite the last useful assistant text.
    const isAiMessage = message instanceof AIMessage || (message as Record<string, unknown>)["type"] === "ai";
    if (isAiMessage && (caller === null || caller === "lead_agent")) {
      const text = RunJournal._messageText(message).trim();
      if (text) {
        this._lastAiMsg = text.slice(0, 2000);
      }
    }
  }

  onChainStart(
    serialized: Record<string, any> | null,
    _inputs: Record<string, any>,
    options: { runId: string; parentRunId?: string | null; tags?: string[] | null; metadata?: Record<string, any> | null }
  ): void {
    const caller = this._identifyCaller(options.tags ?? null);
    if (options.parentRunId === null || options.parentRunId === undefined) {
      // Root graph invocation — emit a single trace event for the run start.
      const chainName = (serialized ?? {})["name"] ?? "unknown";
      this._put({
        eventType: "run.start",
        category: "trace",
        content: { chain: chainName },
        metadata: { caller, ...(options.metadata ?? {}) },
      });
    }
  }

  onChainEnd(outputs: unknown, options: { runId: string; parentRunId?: string | null }): void {
    // Nested chain ends fire for internal graph nodes; only the root chain
    // represents the user-visible run lifecycle.
    if (options.parentRunId !== null && options.parentRunId !== undefined) {
      return;
    }
    this._put({ eventType: "run.end", category: "outputs", content: outputs, metadata: { status: "success" } });
    this._flushSync();
  }

  onChainError(error: unknown): void {
    this._put({
      eventType: "run.error",
      category: "error",
      content: String(error),
      metadata: { error_type: errorName(error) },
    });
    this._flushSync();
  }

  // -- LLM callbacks --

  /**
   * Capture structured prompt messages for the llm_request event.
   *
   * This is also the canonical place to extract the first human message:
   * messages are fully structured here, it fires only on real LLM calls, and the
   * content is never compressed by checkpoint trimming.
   */
  onChatModelStart(
    _serialized: Record<string, any>,
    messages: AnyMessage[][],
    options: { runId: string; tags?: string[] | null }
  ): void {
    const rid = String(options.runId);
    this._llmStartTimes.set(rid, monotonic());
    this._llmCallIndex += 1;
    this._seenLlmStarts.add(rid);

    logger.debug(
      "onChatModelStart %s: tags=%s num_batches=%d",
      options.runId,
      options.tags,
      messages.length
    );

    // Capture the first user message sent to the lead agent in this run.
    const caller = this._identifyCaller(options.tags ?? null);
    if (caller === "lead_agent" && !this._firstHumanMsg && messages.length > 0) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const batch = messages[i]!;
        for (let j = batch.length - 1; j >= 0; j--) {
          const m = batch[j]! as Record<string, any>;
          const hideFromUi = m["additional_kwargs"]?.["hide_from_ui"];
          if (m instanceof HumanMessage && m["name"] !== "summary" && hideFromUi !== true) {
            this.setFirstHumanMessage(RunJournal._messageText(m));
            this._put({
              eventType: "llm.human.input",
              category: "message",
              content: serializeLcObject(m),
              metadata: { caller },
            });
            this._recordMessageSummary(m, caller);
            break;
          }
        }
        if (this._firstHumanMsg) {
          break;
        }
      }
    }
  }

  onLlmStart(_serialized: Record<string, any>, _prompts: string[], options: { runId: string }): void {
    // Fallback: onChatModelStart is preferred. This just tracks latency.
    this._llmStartTimes.set(String(options.runId), monotonic());
  }

  onLlmEnd(response: any, options: { runId: string; tags?: string[] | null }): void {
    const messages: AnyMessage[] = [];
    logger.debug("onLlmEnd %s: tags=%s", options.runId, options.tags);
    for (const generation of response?.generations ?? []) {
      for (const gen of generation ?? []) {
        if (gen && Object.prototype.hasOwnProperty.call(gen, "message")) {
          messages.push(gen.message);
        } else {
          logger.warning(`onLlmEnd ${options.runId}: generation has no message attribute`);
        }
      }
    }

    for (const message of messages) {
      const msg = message as Record<string, any>;
      const caller = this._identifyCaller(options.tags ?? null);

      // Latency
      const rid = String(options.runId);
      const start = this._llmStartTimes.get(rid);
      this._llmStartTimes.delete(rid);
      const latencyMs = start !== undefined ? Math.floor((monotonic() - start) * 1000) : null;

      // Token usage from message
      const usage = msg["usage_metadata"];
      const usageDict: Record<string, any> = usage ? { ...usage } : {};
      const additionalKwargs: Record<string, any> = msg["additional_kwargs"] ?? {};
      if (additionalKwargs && additionalKwargs["quill_error_fallback"]) {
        this._hadLlmErrorFallback = true;
        const detail = additionalKwargs["error_detail"];
        const reason = additionalKwargs["error_reason"];
        const fallbackText = RunJournal._messageText(message).trim();
        if (typeof detail === "string" && detail.trim()) {
          this._llmErrorFallbackMessage = detail.trim();
        } else if (typeof reason === "string" && reason.trim()) {
          this._llmErrorFallbackMessage = reason.trim();
        } else if (fallbackText) {
          this._llmErrorFallbackMessage = fallbackText.slice(0, 2000);
        }
      }

      // Resolve call index
      let callIndex = this._llmCallIndex;
      if (!this._seenLlmStarts.has(rid)) {
        // Fallback: onChatModelStart was not called
        this._llmCallIndex += 1;
        callIndex = this._llmCallIndex;
        this._seenLlmStarts.add(rid);
      }

      // Trace event: llm_response
      this._put({
        eventType: "llm.ai.response",
        category: "message",
        content: serializeLcObject(message),
        metadata: {
          caller,
          usage: usageDict,
          latency_ms: latencyMs,
          llm_call_index: callIndex,
        },
      });
      if (!this._countedMessageLlmRunIds.has(rid)) {
        this._recordMessageSummary(message, caller);
      }

      // Token accumulation (dedup by langchain run_id to avoid double-counting).
      if (this._trackTokens) {
        const inputTk = usageDict["input_tokens"] ?? 0;
        const outputTk = usageDict["output_tokens"] ?? 0;
        let totalTk = usageDict["total_tokens"] ?? 0;
        if (totalTk === 0) {
          totalTk = inputTk + outputTk;
        }
        if (totalTk > 0 && !this._countedLlmRunIds.has(rid)) {
          this._countedLlmRunIds.add(rid);
          this._totalInputTokens += inputTk;
          this._totalOutputTokens += outputTk;
          this._totalTokens += totalTk;
          this._llmCallCount += 1;

          if (caller.startsWith("subagent:")) {
            this._subagentTokens += totalTk;
          } else if (caller.startsWith("middleware:")) {
            this._middlewareTokens += totalTk;
          } else {
            this._leadAgentTokens += totalTk;
          }

          // Per-model bucket
          const responseMetadata: Record<string, any> = msg["response_metadata"] ?? {};
          let perCallModel: string | null = null;
          if (responseMetadata && typeof responseMetadata === "object") {
            perCallModel = responseMetadata["model_name"] ?? responseMetadata["model"] ?? null;
          }
          this._recordModelUsage(perCallModel, inputTk, outputTk, totalTk);

          this._scheduleProgressFlush();
        }
      }
    }

    if (messages.length > 0) {
      this._countedMessageLlmRunIds.add(String(options.runId));
    }
  }

  onLlmError(error: unknown, options: { runId: string }): void {
    this._llmStartTimes.delete(String(options.runId));
    this._put({ eventType: "llm.error", category: "trace", content: String(error) });
  }

  onToolStart(
    _serialized: unknown,
    _inputStr: unknown,
    options: { runId: string; tags?: string[] | null }
  ): void {
    const toolCallId = String(options.runId);
    logger.debug("Tool start for node %s, tool_call_id=%s, tags=%s", options.runId, toolCallId, options.tags);
  }

  onToolEnd(output: unknown, options: { runId: string }): void {
    try {
      if (output instanceof ToolMessage) {
        this._put({ eventType: "llm.tool.result", category: "message", content: serializeLcObject(output) });
        this._recordMessageSummary(output);
      } else if (output instanceof Command) {
        const update = (output as { update?: any }).update ?? {};
        const messages: unknown[] = update?.["messages"] ?? [];
        for (const message of messages) {
          if (isBaseMessageLike(message)) {
            this._put({ eventType: "llm.tool.result", category: "message", content: serializeLcObject(message) });
            this._recordMessageSummary(message as AnyMessage);
          } else {
            logger.warning(`onToolEnd ${options.runId}: command update message is not BaseMessage`);
          }
        }
      } else {
        logger.warning(`onToolEnd ${options.runId}: output is not ToolMessage`);
      }
    } finally {
      logger.debug("Tool end for node %s", options.runId);
    }
  }

  // -- Internal methods --

  private _put(args: {
    eventType: string;
    category: string;
    content?: string | Record<string, unknown> | unknown;
    metadata?: Record<string, unknown> | null;
  }): void {
    this._buffer.push({
      thread_id: this.threadId,
      run_id: this.runId,
      event_type: args.eventType,
      category: args.category,
      content: args.content ?? "",
      metadata: args.metadata ?? {},
      created_at: new Date().toISOString(),
    });
    if (this._buffer.length >= this._flushThreshold) {
      this._flushSync();
    }
  }

  /**
   * Best-effort flush of buffer to RunEventStore.
   *
   * Skips if a flush is already in flight — avoids concurrent writes to the same
   * SQLite file from multiple fire-and-forget tasks.
   */
  private _flushSync(): void {
    if (this._buffer.length === 0) {
      return;
    }
    if (this._pendingFlushTasks.size > 0) {
      return;
    }
    const batch = [...this._buffer];
    this._buffer.length = 0;
    const task = this._flushAsync(batch);
    this._pendingFlushTasks.add(task);
    void task.then(
      () => this._onFlushDone(task),
      (exc) => {
        this._onFlushDone(task);
        logger.warning("Journal flush task failed: %s", exc);
      }
    );
  }

  private async _flushAsync(batch: PutEventArgs[]): Promise<void> {
    try {
      await this._store.putBatch(batch);
    } catch {
      logger.warning("Failed to flush %d events for run %s — returning to buffer", batch.length, this.runId);
      // Return failed events to buffer for retry on next flush.
      this._buffer = batch.concat(this._buffer);
    }
  }

  private _onFlushDone(task: Promise<void>): void {
    this._pendingFlushTasks.delete(task);
  }

  private _identifyCaller(tags: string[] | null): string {
    const _tags = tags ?? [];
    for (const tag of _tags) {
      if (typeof tag === "string" && (tag.startsWith("subagent:") || tag.startsWith("middleware:") || tag === "lead_agent")) {
        return tag;
      }
    }
    // Default to lead_agent: the main agent graph does not inject callback tags,
    // while subagents and middleware explicitly tag themselves.
    return "lead_agent";
  }

  /**
   * Add a single LLM call's token usage to the per-model accumulator.
   *
   * Missing / empty `modelName` collapses into a shared `"unknown"` bucket.
   */
  private _recordModelUsage(
    modelName: string | null,
    inputTokens: number,
    outputTokens: number,
    totalTokens: number
  ): void {
    if (totalTokens <= 0) {
      return;
    }
    const key = modelName || "unknown";
    let bucket = this._tokensByModel.get(key);
    if (bucket === undefined) {
      bucket = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
      this._tokensByModel.set(key, bucket);
    }
    bucket.input_tokens += Math.trunc(inputTokens || 0);
    bucket.output_tokens += Math.trunc(outputTokens || 0);
    bucket.total_tokens += Math.trunc(totalTokens);
  }

  // -- Public methods (called by worker) --

  /**
   * Record token usage from external sources (e.g., subagents).
   *
   * Each record should contain: source_run_id, caller, model_name, input_tokens,
   * output_tokens, total_tokens.
   */
  recordExternalLlmUsageRecords(records: ExternalUsageRecord[]): void {
    if (!this._trackTokens) {
      return;
    }
    for (const record of records) {
      const sourceId = String(record["source_run_id"] ?? "");
      if (!sourceId) {
        continue;
      }
      if (this._countedExternalSourceIds.has(sourceId)) {
        continue;
      }

      let totalTk = record["total_tokens"] ?? 0;
      if (totalTk <= 0) {
        const inputTkTmp = record["input_tokens"] ?? 0;
        const outputTkTmp = record["output_tokens"] ?? 0;
        totalTk = inputTkTmp + outputTkTmp;
      }
      if (totalTk <= 0) {
        continue;
      }

      const inputTk = record["input_tokens"] ?? 0;
      const outputTk = record["output_tokens"] ?? 0;

      this._countedExternalSourceIds.add(sourceId);
      this._totalInputTokens += inputTk;
      this._totalOutputTokens += outputTk;
      this._totalTokens += totalTk;

      const caller = String(record["caller"] ?? "");
      if (caller.startsWith("subagent:")) {
        this._subagentTokens += totalTk;
      } else if (caller.startsWith("middleware:")) {
        this._middlewareTokens += totalTk;
      } else {
        this._leadAgentTokens += totalTk;
      }

      this._recordModelUsage(record["model_name"] ?? null, inputTk, outputTk, totalTk);

      this._scheduleProgressFlush();
    }
  }

  /** Record the first human message for convenience fields. */
  setFirstHumanMessage(content: string): void {
    this._firstHumanMsg = content ? content.slice(0, 2000) : null;
  }

  /**
   * Record a middleware state-change event.
   *
   * Called by middleware implementations when they perform a meaningful state
   * change (e.g., title generation, summarization, HITL approval). Pure-observation
   * middleware should not call this.
   */
  recordMiddleware(
    tag: string,
    options: { name: string; hook: string; action: string; changes: Record<string, unknown> }
  ): void {
    this._put({
      eventType: `middleware:${tag}`,
      category: "middleware",
      content: { name: options.name, hook: options.hook, action: options.action, changes: options.changes },
    });
  }

  /** Force flush remaining buffer. Called in worker's finally block. */
  async flush(): Promise<void> {
    if (this._pendingFlushTasks.size > 0) {
      await Promise.allSettled([...this._pendingFlushTasks]);
    }
    while (this._pendingProgressTask !== null) {
      if (this._pendingProgressDelayed) {
        // Cancel the in-flight delayed progress snapshot.
        this._cancelDelay();
        await Promise.allSettled([this._pendingProgressTask]);
        this._progressDirty = false;
        this._pendingProgressDelayed = false;
        break;
      }
      await Promise.allSettled([this._pendingProgressTask]);
    }

    while (this._buffer.length > 0) {
      const batch = this._buffer.slice(0, this._flushThreshold);
      this._buffer.splice(0, this._flushThreshold);
      try {
        await this._store.putBatch(batch);
      } catch (err) {
        this._buffer = batch.concat(this._buffer);
        throw err;
      }
    }
  }

  /** Best-effort throttled progress snapshot for active run visibility. */
  private _scheduleProgressFlush(): void {
    if (this._progressReporter === null) {
      return;
    }
    const now = monotonic();
    const elapsed = now - this._lastProgressFlush;
    if (elapsed < this._progressFlushInterval) {
      this._progressDirty = true;
      this._scheduleDelayedProgressFlush(this._progressFlushInterval - elapsed);
      return;
    }
    if (this._pendingProgressTask !== null) {
      this._progressDirty = true;
      return;
    }
    this._progressDirty = false;
    this._pendingProgressTask = this._flushProgressAsync({ snapshot: this.getCompletionData() });
  }

  private _scheduleDelayedProgressFlush(delay: number): void {
    if (this._pendingProgressTask !== null) {
      return;
    }
    const d = Math.max(0.0, delay);
    this._pendingProgressDelayed = d > 0;
    this._pendingProgressTask = this._flushProgressAsync({ delay: d });
  }

  private _cancelDelay(): void {
    if (this._delayTimer !== null) {
      clearTimeout(this._delayTimer);
      this._delayTimer = null;
    }
    if (this._delayResolve !== null) {
      const resolve = this._delayResolve;
      this._delayResolve = null;
      resolve();
    }
  }

  private _sleep(seconds: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this._delayResolve = resolve;
      this._delayTimer = setTimeout(() => {
        this._delayTimer = null;
        this._delayResolve = null;
        resolve();
      }, Math.max(0, seconds * 1000));
    });
  }

  private async _flushProgressAsync(options: { snapshot?: Record<string, unknown>; delay?: number }): Promise<void> {
    const { snapshot, delay = 0.0 } = options;
    if (this._progressReporter === null) {
      this._pendingProgressTask = null;
      return;
    }
    if (delay > 0) {
      this._pendingProgressDelayed = true;
      await this._sleep(delay);
      this._pendingProgressDelayed = false;
    }
    const dirtyBeforeWrite = this._progressDirty;
    this._progressDirty = false;
    const snapshotToWrite = snapshot ?? this.getCompletionData();
    try {
      await this._progressReporter(snapshotToWrite);
      this._lastProgressFlush = monotonic();
    } catch {
      logger.warning("Failed to persist progress snapshot for run %s", this.runId);
    }
    if (dirtyBeforeWrite || this._progressDirty) {
      this._progressDirty = false;
      this._pendingProgressTask = null;
      this._scheduleDelayedProgressFlush(this._progressFlushInterval);
      return;
    }
    this._pendingProgressTask = null;
  }

  /** Return accumulated token and message data for run completion. */
  getCompletionData(): Record<string, unknown> {
    const tokenUsageByModel: Record<string, Record<string, number>> = {};
    for (const [model, usage] of this._tokensByModel.entries()) {
      tokenUsageByModel[model] = { ...usage };
    }
    return {
      total_input_tokens: this._totalInputTokens,
      total_output_tokens: this._totalOutputTokens,
      total_tokens: this._totalTokens,
      llm_call_count: this._llmCallCount,
      lead_agent_tokens: this._leadAgentTokens,
      subagent_tokens: this._subagentTokens,
      middleware_tokens: this._middlewareTokens,
      token_usage_by_model: tokenUsageByModel,
      message_count: this._msgCount,
      last_ai_message: this._lastAiMsg,
      first_human_message: this._firstHumanMsg,
    };
  }

  get hadLlmErrorFallback(): boolean {
    return this._hadLlmErrorFallback;
  }

  get llmErrorFallbackMessage(): string | null {
    return this._llmErrorFallbackMessage;
  }
}

function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.constructor.name;
  }
  return typeof error;
}

function isBaseMessageLike(value: unknown): boolean {
  return value !== null && typeof value === "object" && "content" in (value as Record<string, unknown>);
}
