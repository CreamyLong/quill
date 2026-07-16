/**
 * Middleware to detect and break repetitive tool-call loops.
 *
 * Faithful port of Python `LoopDetectionMiddleware`. Two detection layers:
 *   1. Hash-based: identical tool-call sets within a sliding window.
 *   2. Frequency-based: the same tool *type* called too many times.
 * A warning is queued at `afterModel` and injected as a HumanMessage at the
 * next model call (`wrapModelCall`) so assistant tool_calls → tool responses
 * pairing stays intact. Reaching the hard limit strips tool_calls to force a
 * final answer.
 *
 * Deviations (noted in report):
 * - Python scopes state per (thread_id, run_id) from `runtime.context`. The TS
 *   hooks receive no runtime, so a single fixed scope ("default") is used;
 *   cross-thread isolation is therefore not available.
 * - `threading.Lock` is dropped — JS is single-threaded.
 * - `before_agent` maps to `beforeModel` (no dedicated node in the TS factory).
 */

import { createHash } from "node:crypto";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition, ModelRequest } from "../factory.js";
import type { ThreadState } from "../thread_state.js";
import {
  buildLoopDetectionConfig,
  type LoopDetectionConfig,
} from "../../config/loop_detection_config.js";
import {
  cloneAiMessageWithToolCalls,
  type MessageLike,
} from "./tool_call_metadata.js";

const WARNING_MSG =
  "[LOOP DETECTED] You are repeating the same tool calls. Stop calling tools and produce your final answer now. If you cannot complete the task, summarize what you accomplished so far.";

const TOOL_FREQ_WARNING_MSG = (toolName: string, count: number): string =>
  `[LOOP DETECTED] You have called ${toolName} ${count} times without producing a final answer. Stop calling tools and produce your final answer now. If you cannot complete the task, summarize what you accomplished so far.`;

const HARD_STOP_MSG =
  "[FORCED STOP] Repeated tool calls exceeded the safety limit. Producing final answer with results collected so far.";

const TOOL_FREQ_HARD_STOP_MSG = (toolName: string, count: number): string =>
  `[FORCED STOP] Tool ${toolName} called ${count} times — exceeded the per-tool safety limit. Producing final answer with results collected so far.`;

const MAX_PENDING_WARNINGS_PER_RUN = 4;

/** Deterministic JSON with recursively sorted object keys (Python sort_keys). */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Normalize tool call args to a dict plus an optional fallback key. */
function normalizeToolCallArgs(rawArgs: unknown): [Record<string, unknown>, string | null] {
  if (rawArgs !== null && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    return [rawArgs as Record<string, unknown>, null];
  }
  if (typeof rawArgs === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawArgs);
    } catch {
      return [{}, rawArgs];
    }
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return [parsed as Record<string, unknown>, null];
    }
    return [{}, stableStringify(parsed)];
  }
  if (rawArgs === null || rawArgs === undefined) {
    return [{}, null];
  }
  return [{}, stableStringify(rawArgs)];
}

/** Derive a stable key from salient args without overfitting to noise. */
function stableToolKey(
  name: string,
  args: Record<string, unknown>,
  fallbackKey: string | null
): string {
  if (name === "read_file" && fallbackKey === null) {
    const path = (args["path"] as string) || "";
    const bucketSize = 200;
    let startLine = toInt(args["start_line"], 1);
    let endLine = toInt(args["end_line"], startLine);
    if (startLine > endLine) {
      [startLine, endLine] = [endLine, startLine];
    }
    let bucketStart = Math.max(startLine, 1);
    let bucketEnd = Math.max(endLine, 1);
    bucketStart = Math.floor((bucketStart - 1) / bucketSize);
    bucketEnd = Math.floor((bucketEnd - 1) / bucketSize);
    return `${path}:${bucketStart}-${bucketEnd}`;
  }

  if (name === "write_file" || name === "str_replace") {
    if (fallbackKey !== null) {
      return fallbackKey;
    }
    return stableStringify(args);
  }

  const salientFields = ["path", "url", "query", "command", "pattern", "glob", "cmd"];
  const stableArgs: Record<string, unknown> = {};
  for (const field of salientFields) {
    if (args[field] !== null && args[field] !== undefined) {
      stableArgs[field] = args[field];
    }
  }
  if (Object.keys(stableArgs).length > 0) {
    return stableStringify(stableArgs);
  }
  if (fallbackKey !== null) {
    return fallbackKey;
  }
  return stableStringify(args);
}

function toInt(value: unknown, fallback: number): number {
  if (value === null || value === undefined) {
    return fallback;
  }
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isNaN(n) ? fallback : Math.trunc(n);
}

/** Deterministic, order-independent hash of a set of tool calls. */
function hashToolCalls(toolCalls: Array<Record<string, unknown>>): string {
  const normalized: string[] = [];
  for (const tc of toolCalls) {
    const name = (tc["name"] as string) ?? "";
    const [args, fallbackKey] = normalizeToolCallArgs(tc["args"] ?? {});
    const key = stableToolKey(name, args, fallbackKey);
    normalized.push(`${name}:${key}`);
  }
  normalized.sort();
  const blob = JSON.stringify(normalized);
  return createHash("md5").update(blob).digest("hex").slice(0, 12);
}

/** Append text to AIMessage content, handling str, list, and null. */
function appendText(content: unknown, text: string): string | unknown[] {
  if (content === null || content === undefined) {
    return text;
  }
  if (Array.isArray(content)) {
    return [...content, { type: "text", text: `\n\n${text}` }];
  }
  if (typeof content === "string") {
    return content + `\n\n${text}`;
  }
  return String(content) + `\n\n${text}`;
}

const FIXED_THREAD_ID = "default";
const FIXED_RUN_ID = "default";

/** Detects and breaks repetitive tool call loops. */
export class LoopDetectionMiddleware {
  readonly warnThreshold: number;
  readonly hardLimit: number;
  readonly windowSize: number;
  readonly maxTrackedThreads: number;
  readonly toolFreqWarn: number;
  readonly toolFreqHardLimit: number;
  private readonly _toolFreqOverrides: Record<string, [number, number]>;

  private readonly _history = new Map<string, string[]>();
  private readonly _warned = new Map<string, Set<string>>();
  private readonly _toolFreq = new Map<string, Map<string, number>>();
  private readonly _toolFreqWarned = new Map<string, Set<string>>();
  private readonly _pendingWarnings = new Map<string, string[]>();
  private readonly _pendingWarningTouchOrder = new Map<string, null>();
  private readonly _maxPendingWarningKeys: number;

  constructor(config: Partial<LoopDetectionConfig> = {}) {
    const cfg = buildLoopDetectionConfig(config);
    this.warnThreshold = cfg.warnThreshold;
    this.hardLimit = cfg.hardLimit;
    this.windowSize = cfg.windowSize;
    this.maxTrackedThreads = cfg.maxTrackedThreads;
    this.toolFreqWarn = cfg.toolFreqWarn;
    this.toolFreqHardLimit = cfg.toolFreqHardLimit;
    this._toolFreqOverrides = {};
    for (const [n, o] of Object.entries(cfg.toolFreqOverrides)) {
      this._toolFreqOverrides[n] = [o.warn, o.hardLimit];
    }
    this._maxPendingWarningKeys = Math.max(1, this.maxTrackedThreads * 2);
  }

  static fromConfig(config: LoopDetectionConfig): LoopDetectionMiddleware {
    return new LoopDetectionMiddleware(config);
  }

  private _pendingKey(): string {
    return `${FIXED_THREAD_ID}\u0000${FIXED_RUN_ID}`;
  }

  private _evictIfNeeded(): void {
    while (this._history.size > this.maxTrackedThreads) {
      const evictedId = this._history.keys().next().value as string | undefined;
      if (evictedId === undefined) {
        break;
      }
      this._history.delete(evictedId);
      this._warned.delete(evictedId);
      this._toolFreq.delete(evictedId);
      this._toolFreqWarned.delete(evictedId);
      for (const key of [...this._pendingWarnings.keys()]) {
        if (key.split("\u0000")[0] === evictedId) {
          this._dropPendingWarningKey(key);
        }
      }
    }
  }

  private _dropPendingWarningKey(key: string): void {
    this._pendingWarnings.delete(key);
    this._pendingWarningTouchOrder.delete(key);
  }

  private _touchPendingWarningKey(key: string): void {
    this._pendingWarningTouchOrder.delete(key);
    this._pendingWarningTouchOrder.set(key, null);
  }

  private _prunePendingWarningState(protectedKey: string): void {
    const overflow = this._pendingWarningTouchOrder.size - this._maxPendingWarningKeys;
    if (overflow <= 0) {
      return;
    }
    const candidates = [...this._pendingWarningTouchOrder.keys()].filter(
      (key) => key !== protectedKey
    );
    for (const key of candidates.slice(0, overflow)) {
      this._dropPendingWarningKey(key);
    }
  }

  private _queuePendingWarning(warning: string): void {
    const pendingKey = this._pendingKey();
    const warnings = this._pendingWarnings.get(pendingKey) ?? [];
    if (!warnings.includes(warning)) {
      warnings.push(warning);
    }
    if (warnings.length > MAX_PENDING_WARNINGS_PER_RUN) {
      warnings.splice(0, warnings.length - MAX_PENDING_WARNINGS_PER_RUN);
    }
    this._pendingWarnings.set(pendingKey, warnings);
    this._touchPendingWarningKey(pendingKey);
    this._prunePendingWarningState(pendingKey);
  }

  private _trackAndCheck(state: ThreadState): [string | null, boolean] {
    const messages = state.messages ?? [];
    if (messages.length === 0) {
      return [null, false];
    }
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.getType() !== "ai") {
      return [null, false];
    }
    const toolCalls = ((lastMsg as AIMessage).tool_calls ?? []) as Array<Record<string, unknown>>;
    if (toolCalls.length === 0) {
      return [null, false];
    }

    const threadId = FIXED_THREAD_ID;
    const callHash = hashToolCalls(toolCalls);

    // Touch / create history entry (move to end for LRU).
    if (this._history.has(threadId)) {
      const existing = this._history.get(threadId)!;
      this._history.delete(threadId);
      this._history.set(threadId, existing);
    } else {
      this._history.set(threadId, []);
      this._evictIfNeeded();
    }

    const history = this._history.get(threadId)!;
    history.push(callHash);
    if (history.length > this.windowSize) {
      history.splice(0, history.length - this.windowSize);
    }

    const warnedHashes = this._warned.get(threadId);
    if (warnedHashes !== undefined) {
      for (const h of [...warnedHashes]) {
        if (!history.includes(h)) {
          warnedHashes.delete(h);
        }
      }
      if (warnedHashes.size === 0) {
        this._warned.delete(threadId);
      }
    }

    const count = history.filter((h) => h === callHash).length;

    // --- Layer 1: hash-based (identical call sets) ---
    if (count >= this.hardLimit) {
      console.error("Loop hard limit reached — forcing stop");
      return [HARD_STOP_MSG, true];
    }

    if (count >= this.warnThreshold) {
      const warned = this._warned.get(threadId) ?? new Set<string>();
      this._warned.set(threadId, warned);
      if (!warned.has(callHash)) {
        warned.add(callHash);
        console.warn("Repetitive tool calls detected — injecting warning");
        return [WARNING_MSG, false];
      }
    }

    // --- Layer 2: per-tool-type frequency ---
    const freq = this._toolFreq.get(threadId) ?? new Map<string, number>();
    this._toolFreq.set(threadId, freq);
    for (const tc of toolCalls) {
      const name = (tc["name"] as string) ?? "";
      if (!name) {
        continue;
      }
      const tcCount = (freq.get(name) ?? 0) + 1;
      freq.set(name, tcCount);

      const override = this._toolFreqOverrides[name];
      const effWarn = override ? override[0] : this.toolFreqWarn;
      const effHard = override ? override[1] : this.toolFreqHardLimit;

      if (tcCount >= effHard) {
        console.error("Tool frequency hard limit reached — forcing stop");
        return [TOOL_FREQ_HARD_STOP_MSG(name, tcCount), true];
      }

      if (tcCount >= effWarn) {
        const warned = this._toolFreqWarned.get(threadId) ?? new Set<string>();
        this._toolFreqWarned.set(threadId, warned);
        if (!warned.has(name)) {
          warned.add(name);
          console.warn("Tool frequency warning — too many calls to same tool type");
          return [TOOL_FREQ_WARNING_MSG(name, tcCount), false];
        }
      }
    }

    return [null, false];
  }

  private _apply(state: ThreadState): Partial<ThreadState> {
    const [warning, hardStop] = this._trackAndCheck(state);

    if (hardStop) {
      const messages = state.messages ?? [];
      const lastMsg = messages[messages.length - 1];
      const content = appendText(lastMsg.content, warning ?? HARD_STOP_MSG);
      const stripped = cloneAiMessageWithToolCalls(lastMsg as unknown as MessageLike, [], {
        content,
      });
      return { messages: [stripped as unknown as BaseMessage] };
    }

    if (warning) {
      // Defer injection to the next model call (see module docstring).
      this._queuePendingWarning(warning);
      return {};
    }

    return {};
  }

  private _clearOtherRunPendingWarnings(): void {
    const [threadId, currentRunId] = this._pendingKey().split("\u0000");
    for (const key of [...this._pendingWarnings.keys()]) {
      const [t, r] = key.split("\u0000");
      if (t === threadId && r !== currentRunId) {
        this._dropPendingWarningKey(key);
      }
    }
  }

  private _clearCurrentRunPendingWarnings(): void {
    this._dropPendingWarningKey(this._pendingKey());
  }

  private static _formatWarningMessage(warnings: string[]): string {
    const deduped = [...new Set(warnings)];
    return deduped.join("\n\n");
  }

  private _drainPendingWarnings(): string[] {
    const pendingKey = this._pendingKey();
    const warnings = this._pendingWarnings.get(pendingKey) ?? [];
    this._pendingWarnings.delete(pendingKey);
    this._pendingWarningTouchOrder.delete(pendingKey);
    return warnings;
  }

  private _augmentRequest(request: ModelRequest): ModelRequest {
    const warnings = this._drainPendingWarnings();
    if (warnings.length === 0) {
      return request;
    }
    const newMessages: BaseMessage[] = [
      ...request.messages,
      new HumanMessage({
        content: LoopDetectionMiddleware._formatWarningMessage(warnings),
        name: "loop_warning",
      }),
    ];
    return { messages: newMessages };
  }

  /** Clear tracking state. If thread_id given, clear only that thread. */
  reset(threadId?: string | null): void {
    if (threadId) {
      this._history.delete(threadId);
      this._warned.delete(threadId);
      this._toolFreq.delete(threadId);
      this._toolFreqWarned.delete(threadId);
      for (const key of [...this._pendingWarnings.keys()]) {
        if (key.split("\u0000")[0] === threadId) {
          this._dropPendingWarningKey(key);
        }
      }
    } else {
      this._history.clear();
      this._warned.clear();
      this._toolFreq.clear();
      this._toolFreqWarned.clear();
      this._pendingWarnings.clear();
      this._pendingWarningTouchOrder.clear();
    }
  }

  /** Build the MiddlewareDefinition bound to this instance. */
  definition(): MiddlewareDefinition {
    return {
      name: "LoopDetectionMiddleware",
      beforeModel: () => {
        this._clearOtherRunPendingWarnings();
        return {};
      },
      afterModel: (state: ThreadState) => this._apply(state),
      afterAgent: () => {
        this._clearCurrentRunPendingWarnings();
        return {};
      },
      wrapModelCall: async (request, handler) => handler(this._augmentRequest(request)),
    };
  }
}

/** Detect repetitive tool-call loops and force the agent to stop. */
export function loopDetectionMiddleware(
  config: Partial<LoopDetectionConfig> = {}
): MiddlewareDefinition {
  return new LoopDetectionMiddleware(config).definition();
}
