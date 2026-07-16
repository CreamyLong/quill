/**
 * In-memory run registry with optional persistent RunStore backing.
 */

import { randomUUID } from "node:crypto";

import { nowIso } from "../../utils/time.js";
import { DisconnectMode, RunStatus } from "./schemas.js";
import type { RunStore, UpdateRunCompletionArgs, UpdateRunProgressArgs } from "./store/base.js";

const logger = {
  debug: (...a: unknown[]) => console.debug(...a),
  info: (...a: unknown[]) => console.info(...a),
  warning: (...a: unknown[]) => console.warn(...a),
};

const _RETRYABLE_SQLITE_MESSAGES = ["database is locked", "database table is locked", "database is busy"];

/**
 * Return true for transient SQLite persistence failures.
 *
 * NOTE (TS port): The Python implementation also inspects `sqlite3` error codes
 * (`SQLITE_BUSY`/`SQLITE_LOCKED`) and chained exceptions. `node:sqlite` surfaces
 * generic `Error`s, so this port matches on the message text only.
 */
function _isRetryablePersistenceError(exc: unknown): boolean {
  const pending: unknown[] = [exc];
  const seen = new Set<unknown>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    const message = String((current as { message?: unknown })?.message ?? current).toLowerCase();
    if (_RETRYABLE_SQLITE_MESSAGES.some((fragment) => message.includes(fragment))) {
      return true;
    }
    const chained = (current as { cause?: unknown })?.cause;
    if (chained !== null && chained !== undefined) {
      pending.push(chained);
    }
  }
  return false;
}

/** Bounded retry policy for short run-store writes. */
export interface PersistenceRetryPolicy {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

export const DEFAULT_PERSISTENCE_RETRY_POLICY: PersistenceRetryPolicy = {
  maxAttempts: 5,
  initialDelay: 0.05,
  maxDelay: 1.0,
  backoffFactor: 2.0,
};

/** A simple settable event, mirroring asyncio.Event's set/is_set surface. */
export class AbortEvent {
  private _set = false;
  set(): void {
    this._set = true;
  }
  isSet(): boolean {
    return this._set;
  }
}

/**
 * Handle to a background run task.
 *
 * NOTE (TS port): Node has no cancellable task primitive equivalent to
 * `asyncio.Task`. The gateway/worker supplies this handle so the manager can
 * observe completion and request cancellation (via the abort event + `cancel`).
 */
export interface RunTask {
  done(): boolean;
  cancelled(): boolean;
  cancel(): void;
  exception(): unknown;
  wait(): Promise<void>;
}

/** Simple async mutex mirroring asyncio.Lock semantics. */
class AsyncLock {
  private _tail: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this._tail;
    let release!: () => void;
    this._tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const monotonic = (): number => Date.now() / 1000;
const sleep = (seconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds * 1000)));

class TimeoutError extends Error {}

/** Await `promise`, rejecting with {@link TimeoutError} after `seconds`. */
function withTimeout<T>(promise: Promise<T>, seconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError("timed out")), Math.max(0, seconds * 1000));
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export interface RunRecordInit {
  run_id: string;
  thread_id: string;
  assistant_id: string | null;
  status: RunStatus;
  on_disconnect: DisconnectMode;
  multitask_strategy?: string;
  metadata?: Record<string, unknown>;
  kwargs?: Record<string, unknown>;
  user_id?: string | null;
  created_at?: string;
  updated_at?: string;
  model_name?: string | null;
  store_only?: boolean;
  error?: string | null;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_tokens?: number;
  llm_call_count?: number;
  lead_agent_tokens?: number;
  subagent_tokens?: number;
  middleware_tokens?: number;
  token_usage_by_model?: Record<string, Record<string, number>>;
  message_count?: number;
  last_ai_message?: string | null;
  first_human_message?: string | null;
}

/** Mutable record for a single run. */
export class RunRecord {
  run_id: string;
  thread_id: string;
  assistant_id: string | null;
  status: RunStatus;
  on_disconnect: DisconnectMode;
  multitask_strategy: string;
  metadata: Record<string, unknown>;
  kwargs: Record<string, unknown>;
  user_id: string | null;
  created_at: string;
  updated_at: string;
  task: RunTask | null = null;
  abort_event: AbortEvent = new AbortEvent();
  abort_action = "interrupt";
  error: string | null;
  model_name: string | null;
  store_only: boolean;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  llm_call_count: number;
  lead_agent_tokens: number;
  subagent_tokens: number;
  middleware_tokens: number;
  token_usage_by_model: Record<string, Record<string, number>>;
  message_count: number;
  last_ai_message: string | null;
  first_human_message: string | null;
  [key: string]: unknown;

  constructor(init: RunRecordInit) {
    this.run_id = init.run_id;
    this.thread_id = init.thread_id;
    this.assistant_id = init.assistant_id;
    this.status = init.status;
    this.on_disconnect = init.on_disconnect;
    this.multitask_strategy = init.multitask_strategy ?? "reject";
    this.metadata = init.metadata ?? {};
    this.kwargs = init.kwargs ?? {};
    this.user_id = init.user_id ?? null;
    this.created_at = init.created_at ?? "";
    this.updated_at = init.updated_at ?? "";
    this.error = init.error ?? null;
    this.model_name = init.model_name ?? null;
    this.store_only = init.store_only ?? false;
    this.total_input_tokens = init.total_input_tokens ?? 0;
    this.total_output_tokens = init.total_output_tokens ?? 0;
    this.total_tokens = init.total_tokens ?? 0;
    this.llm_call_count = init.llm_call_count ?? 0;
    this.lead_agent_tokens = init.lead_agent_tokens ?? 0;
    this.subagent_tokens = init.subagent_tokens ?? 0;
    this.middleware_tokens = init.middleware_tokens ?? 0;
    this.token_usage_by_model = init.token_usage_by_model ?? {};
    this.message_count = init.message_count ?? 0;
    this.last_ai_message = init.last_ai_message ?? null;
    this.first_human_message = init.first_human_message ?? null;
  }
}

export class ConflictError extends Error {}

export class UnsupportedStrategyError extends Error {}

/**
 * In-memory run registry with optional persistent RunStore backing.
 *
 * All mutations are protected by an async lock. When a `store` is provided,
 * serializable metadata is also persisted so that run history survives process
 * restarts.
 */
export class RunManager {
  private _runs: Map<string, RunRecord> = new Map();
  // Secondary index: thread_id -> insertion-ordered run_id set.
  private _runsByThread: Map<string, Map<string, null>> = new Map();
  private _lock = new AsyncLock();
  private _store: RunStore | null;
  private _persistenceRetryPolicy: PersistenceRetryPolicy;

  constructor(store: RunStore | null = null, options: { persistenceRetryPolicy?: PersistenceRetryPolicy } = {}) {
    this._store = store;
    this._persistenceRetryPolicy = options.persistenceRetryPolicy ?? DEFAULT_PERSISTENCE_RETRY_POLICY;
  }

  private _indexRunLocked(record: RunRecord): void {
    let bucket = this._runsByThread.get(record.thread_id);
    if (bucket === undefined) {
      bucket = new Map();
      this._runsByThread.set(record.thread_id, bucket);
    }
    bucket.set(record.run_id, null);
  }

  private _unindexRunLocked(runId: string, threadId: string): void {
    const bucket = this._runsByThread.get(threadId);
    if (bucket !== undefined) {
      bucket.delete(runId);
      if (bucket.size === 0) {
        this._runsByThread.delete(threadId);
      }
    }
  }

  private _threadRecordsLocked(threadId: string): RunRecord[] {
    const runIds = this._runsByThread.get(threadId);
    if (runIds === undefined || runIds.size === 0) {
      return [];
    }
    const records: RunRecord[] = [];
    for (const runId of runIds.keys()) {
      const record = this._runs.get(runId);
      if (record !== undefined) {
        records.push(record);
      }
    }
    return records;
  }

  private static _storePutPayload(record: RunRecord, error: string | null = null): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      thread_id: record.thread_id,
      assistant_id: record.assistant_id,
      status: record.status,
      multitask_strategy: record.multitask_strategy,
      metadata: record.metadata ?? {},
      kwargs: record.kwargs ?? {},
      error: error !== null ? error : record.error,
      created_at: record.created_at,
      model_name: record.model_name,
    };
    if (record.user_id !== null) {
      payload["user_id"] = record.user_id;
    }
    return payload;
  }

  private async _callStoreWithRetry<T>(
    operationName: string,
    runId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const policy = this._persistenceRetryPolicy;
    let attempt = 1;
    let delay = policy.initialDelay;
    for (;;) {
      try {
        return await operation();
      } catch (exc) {
        const retryable = _isRetryablePersistenceError(exc);
        if (attempt >= policy.maxAttempts || !retryable) {
          throw exc;
        }
        logger.warning(
          "Transient persistence failure during %s for run %s (attempt %d/%d); retrying",
          operationName,
          runId,
          attempt,
          policy.maxAttempts
        );
        if (delay > 0) {
          await sleep(delay);
        }
        delay = Math.min(policy.maxDelay, delay ? delay * policy.backoffFactor : policy.initialDelay);
        attempt += 1;
      }
    }
  }

  private async _persistSnapshotToStore(runId: string, payload: Record<string, unknown>): Promise<boolean> {
    if (this._store === null) {
      return true;
    }
    try {
      const store = this._store;
      await this._callStoreWithRetry("put", runId, () => Promise.resolve(store.put(runId, payload as never)));
      return true;
    } catch {
      logger.warning("Failed to persist run %s to store", runId);
      return false;
    }
  }

  private async _persistNewRunToStore(record: RunRecord): Promise<void> {
    if (this._store === null) {
      return;
    }
    const store = this._store;
    await this._callStoreWithRetry("put", record.run_id, () =>
      Promise.resolve(store.put(record.run_id, RunManager._storePutPayload(record) as never))
    );
  }

  private async _persistToStore(record: RunRecord, error: string | null = null): Promise<boolean> {
    return this._persistSnapshotToStore(record.run_id, RunManager._storePutPayload(record, error));
  }

  private async _persistStatus(record: RunRecord, status: RunStatus, error: string | null = null): Promise<boolean> {
    if (this._store === null) {
      return true;
    }
    const store = this._store;
    const rowRecoveryPayload = RunManager._storePutPayload(record, error);
    try {
      const updated = await this._callStoreWithRetry("update_status", record.run_id, () =>
        Promise.resolve(store.updateStatus(record.run_id, status, { error }))
      );
      if (updated === false) {
        return this._persistSnapshotToStore(record.run_id, rowRecoveryPayload);
      }
      return true;
    } catch {
      logger.warning("Failed to persist status update for run %s", record.run_id);
      return false;
    }
  }

  /**
   * Build a read-only runtime record from a serialized store row.
   *
   * NULL status/on_disconnect columns default to `pending` and `cancel`.
   */
  private static _recordFromStore(row: Record<string, unknown>): RunRecord {
    return new RunRecord({
      run_id: String(row["run_id"]),
      thread_id: String(row["thread_id"]),
      assistant_id: (row["assistant_id"] as string | null) ?? null,
      status: ((row["status"] as string) || RunStatus.PENDING) as RunStatus,
      on_disconnect: ((row["on_disconnect"] as string) || DisconnectMode.CANCEL) as DisconnectMode,
      multitask_strategy: (row["multitask_strategy"] as string) || "reject",
      metadata: (row["metadata"] as Record<string, unknown>) ?? {},
      kwargs: (row["kwargs"] as Record<string, unknown>) ?? {},
      created_at: (row["created_at"] as string) || "",
      updated_at: (row["updated_at"] as string) || "",
      user_id: (row["user_id"] as string | null) ?? null,
      error: (row["error"] as string | null) ?? null,
      model_name: (row["model_name"] as string | null) ?? null,
      store_only: true,
      total_input_tokens: (row["total_input_tokens"] as number) || 0,
      total_output_tokens: (row["total_output_tokens"] as number) || 0,
      total_tokens: (row["total_tokens"] as number) || 0,
      llm_call_count: (row["llm_call_count"] as number) || 0,
      lead_agent_tokens: (row["lead_agent_tokens"] as number) || 0,
      subagent_tokens: (row["subagent_tokens"] as number) || 0,
      middleware_tokens: (row["middleware_tokens"] as number) || 0,
      token_usage_by_model: (row["token_usage_by_model"] as Record<string, Record<string, number>>) ?? {},
      message_count: (row["message_count"] as number) || 0,
      last_ai_message: (row["last_ai_message"] as string | null) ?? null,
      first_human_message: (row["first_human_message"] as string | null) ?? null,
    });
  }

  /** Persist token usage and completion data to the backing store. */
  async updateRunCompletion(runId: string, args: UpdateRunCompletionArgs): Promise<void> {
    let rowRecoveryPayload: Record<string, unknown> | null = null;
    await this._lock.run(async () => {
      const record = this._runs.get(runId);
      if (record !== undefined) {
        for (const [key, value] of Object.entries(args)) {
          if (key === "status") {
            continue;
          }
          if (key in record && value !== null && value !== undefined) {
            (record as Record<string, unknown>)[key] = value;
          }
        }
        record.updated_at = nowIso();
        rowRecoveryPayload = RunManager._storePutPayload(record, (args["error"] as string | null) ?? null);
      }
    });
    if (this._store === null) {
      return;
    }
    const store = this._store;
    try {
      const updated = await this._callStoreWithRetry("update_run_completion", runId, () =>
        Promise.resolve(store.updateRunCompletion(runId, args))
      );
      if (updated === false) {
        if (rowRecoveryPayload === null) {
          logger.warning("Failed to recreate missing run %s for completion persistence", runId);
          return;
        }
        if (!(await this._persistSnapshotToStore(runId, rowRecoveryPayload))) {
          return;
        }
        const recovered = await this._callStoreWithRetry("update_run_completion", runId, () =>
          Promise.resolve(store.updateRunCompletion(runId, args))
        );
        if (recovered === false) {
          logger.warning("Run completion update for %s affected no rows after row recreation", runId);
        }
      }
    } catch {
      logger.warning("Failed to persist run completion for %s", runId);
    }
  }

  /** Persist a running token/message snapshot without changing status. */
  async updateRunProgress(runId: string, args: UpdateRunProgressArgs): Promise<void> {
    let shouldPersist = true;
    await this._lock.run(async () => {
      const record = this._runs.get(runId);
      if (record !== undefined) {
        shouldPersist = record.status === RunStatus.RUNNING;
      }
      if (record !== undefined && shouldPersist) {
        for (const [key, value] of Object.entries(args)) {
          if (key in record && value !== null && value !== undefined) {
            (record as Record<string, unknown>)[key] = value;
          }
        }
        record.updated_at = nowIso();
      }
    });
    if (shouldPersist && this._store !== null) {
      try {
        await this._store.updateRunProgress(runId, args);
      } catch {
        logger.warning("Failed to persist run progress for %s", runId);
      }
    }
  }

  /** Create a new pending run and register it. */
  async create(
    threadId: string,
    assistantId: string | null = null,
    options: {
      onDisconnect?: DisconnectMode;
      metadata?: Record<string, unknown> | null;
      kwargs?: Record<string, unknown> | null;
      multitaskStrategy?: string;
      userId?: string | null;
    } = {}
  ): Promise<RunRecord> {
    const {
      onDisconnect = DisconnectMode.CANCEL,
      metadata = null,
      kwargs = null,
      multitaskStrategy = "reject",
      userId = null,
    } = options;
    const runId = randomUUID();
    const now = nowIso();
    const record = new RunRecord({
      run_id: runId,
      thread_id: threadId,
      assistant_id: assistantId,
      status: RunStatus.PENDING,
      on_disconnect: onDisconnect,
      multitask_strategy: multitaskStrategy,
      metadata: metadata ?? {},
      kwargs: kwargs ?? {},
      user_id: userId,
      created_at: now,
      updated_at: now,
    });
    await this._lock.run(async () => {
      this._runs.set(runId, record);
      this._indexRunLocked(record);
      let persisted = false;
      try {
        await this._persistNewRunToStore(record);
        persisted = true;
      } finally {
        if (!persisted) {
          this._runs.delete(runId);
          this._unindexRunLocked(runId, record.thread_id);
        }
      }
    });
    logger.info("Run created: run_id=%s thread_id=%s", runId, threadId);
    return record;
  }

  /** Return a run record by ID, or `null`. */
  async get(runId: string, options: { user_id?: string | null } = {}): Promise<RunRecord | null> {
    let record = await this._lock.run(async () => this._runs.get(runId) ?? null);
    if (record !== null) {
      return record;
    }
    if (this._store === null) {
      return null;
    }
    let row: Record<string, unknown> | null;
    try {
      row = await this._store.get(runId, { user_id: options.user_id ?? null });
    } catch {
      logger.warning("Failed to hydrate run %s from store", runId);
      return null;
    }
    // Re-check after store await: a concurrent create() may have inserted the
    // in-memory record while the store call was in flight.
    record = await this._lock.run(async () => this._runs.get(runId) ?? null);
    if (record !== null) {
      return record;
    }
    if (row === null) {
      return null;
    }
    try {
      return RunManager._recordFromStore(row);
    } catch {
      logger.warning("Failed to map store row for run %s", runId);
      return null;
    }
  }

  /** Alias for {@link get} for backward compatibility. */
  async aget(runId: string, options: { user_id?: string | null } = {}): Promise<RunRecord | null> {
    return this.get(runId, options);
  }

  /** Return runs for a given thread, newest first, at most `limit` records. */
  async listByThread(
    threadId: string,
    options: { user_id?: string | null; limit?: number } = {}
  ): Promise<RunRecord[]> {
    const { user_id = null, limit = 100 } = options;
    const memoryRecords = await this._lock.run(async () => this._threadRecordsLocked(threadId));
    if (this._store === null) {
      return sortByCreatedAtDesc(memoryRecords).slice(0, limit);
    }
    const recordsById = new Map<string, RunRecord>();
    for (const record of memoryRecords) {
      recordsById.set(record.run_id, record);
    }
    const storeLimit = Math.max(0, limit - memoryRecords.length);
    let rows: Record<string, unknown>[];
    try {
      rows = await this._store.listByThread(threadId, { user_id, limit: storeLimit });
    } catch {
      logger.warning("Failed to hydrate runs for thread %s from store", threadId);
      return sortByCreatedAtDesc(memoryRecords).slice(0, limit);
    }
    for (const row of rows) {
      const runId = row["run_id"] as string | undefined;
      if (runId && !recordsById.has(runId)) {
        try {
          recordsById.set(runId, RunManager._recordFromStore(row));
        } catch {
          logger.warning("Failed to map store row for run %s", runId);
        }
      }
    }
    return sortByCreatedAtDesc([...recordsById.values()]).slice(0, limit);
  }

  /** Transition a run to a new status. */
  async setStatus(runId: string, status: RunStatus, options: { error?: string | null } = {}): Promise<void> {
    const { error = null } = options;
    const record = await this._lock.run(async () => {
      const rec = this._runs.get(runId);
      if (rec === undefined) {
        logger.warning("setStatus called for unknown run %s", runId);
        return null;
      }
      rec.status = status;
      rec.updated_at = nowIso();
      if (error !== null && error !== undefined) {
        rec.error = error;
      }
      return rec;
    });
    if (record === null) {
      return;
    }
    await this._persistStatus(record, status, error);
    logger.info("Run %s -> %s", runId, status);
  }

  private async _persistModelName(runId: string, modelName: string | null): Promise<void> {
    if (this._store === null) {
      return;
    }
    const store = this._store;
    try {
      await this._callStoreWithRetry("update_model_name", runId, () =>
        Promise.resolve(store.updateModelName(runId, modelName))
      );
    } catch {
      logger.warning("Failed to persist model_name update for run %s", runId);
    }
  }

  /** Update the model name for a run. */
  async updateModelName(runId: string, modelName: string | null): Promise<void> {
    const found = await this._lock.run(async () => {
      const record = this._runs.get(runId);
      if (record === undefined) {
        logger.warning("updateModelName called for unknown run %s", runId);
        return false;
      }
      record.model_name = modelName;
      record.updated_at = nowIso();
      return true;
    });
    if (!found) {
      return;
    }
    await this._persistModelName(runId, modelName);
    logger.info("Run %s model_name=%s", runId, modelName);
  }

  /**
   * Request cancellation of a run.
   *
   * Sets the abort event with the action reason and cancels the task. Returns
   * `true` if cancellation was initiated **or** the run was already interrupted
   * (idempotent). Returns `false` only when the run is unknown to this worker or
   * has reached a terminal state other than interrupted.
   */
  async cancel(runId: string, options: { action?: string } = {}): Promise<boolean> {
    const { action = "interrupt" } = options;
    const record = await this._lock.run(async () => {
      const rec = this._runs.get(runId);
      if (rec === undefined) {
        return { record: null, result: false as boolean };
      }
      if (rec.status === RunStatus.INTERRUPTED) {
        return { record: null, result: true as boolean };
      }
      if (rec.status !== RunStatus.PENDING && rec.status !== RunStatus.RUNNING) {
        return { record: null, result: false as boolean };
      }
      rec.abort_action = action;
      rec.abort_event.set();
      if (rec.task !== null && !rec.task.done()) {
        rec.task.cancel();
      }
      rec.status = RunStatus.INTERRUPTED;
      rec.updated_at = nowIso();
      return { record: rec, result: true as boolean };
    });
    if (record.record === null) {
      return record.result;
    }
    await this._persistStatus(record.record, RunStatus.INTERRUPTED);
    logger.info("Run %s cancelled (action=%s)", runId, action);
    return true;
  }

  /** Atomically check for inflight runs and create a new one. */
  async createOrReject(
    threadId: string,
    assistantId: string | null = null,
    options: {
      onDisconnect?: DisconnectMode;
      metadata?: Record<string, unknown> | null;
      kwargs?: Record<string, unknown> | null;
      multitaskStrategy?: string;
      modelName?: string | null;
      userId?: string | null;
    } = {}
  ): Promise<RunRecord> {
    const {
      onDisconnect = DisconnectMode.CANCEL,
      metadata = null,
      kwargs = null,
      multitaskStrategy = "reject",
      modelName = null,
      userId = null,
    } = options;
    const runId = randomUUID();
    const now = nowIso();

    const supportedStrategies = ["reject", "interrupt", "rollback"];
    const interruptedRecords: RunRecord[] = [];

    const record = await this._lock.run(async () => {
      if (!supportedStrategies.includes(multitaskStrategy)) {
        throw new UnsupportedStrategyError(
          `Multitask strategy '${multitaskStrategy}' is not yet supported. Supported strategies: ${supportedStrategies.join(", ")}`
        );
      }

      const inflight = this._threadRecordsLocked(threadId).filter(
        (r) => r.status === RunStatus.PENDING || r.status === RunStatus.RUNNING
      );

      if (multitaskStrategy === "reject" && inflight.length > 0) {
        throw new ConflictError(`Thread ${threadId} already has an active run`);
      }

      if ((multitaskStrategy === "interrupt" || multitaskStrategy === "rollback") && inflight.length > 0) {
        logger.info(
          "Preparing to cancel %d inflight run(s) on thread %s (strategy=%s)",
          inflight.length,
          threadId,
          multitaskStrategy
        );
      }

      const rec = new RunRecord({
        run_id: runId,
        thread_id: threadId,
        assistant_id: assistantId,
        status: RunStatus.PENDING,
        on_disconnect: onDisconnect,
        multitask_strategy: multitaskStrategy,
        metadata: metadata ?? {},
        kwargs: kwargs ?? {},
        user_id: userId,
        created_at: now,
        updated_at: now,
        model_name: modelName,
      });
      this._runs.set(runId, rec);
      this._indexRunLocked(rec);
      let persisted = false;
      try {
        await this._persistNewRunToStore(rec);
        persisted = true;
      } finally {
        if (!persisted) {
          this._runs.delete(runId);
          this._unindexRunLocked(runId, rec.thread_id);
        }
      }

      if ((multitaskStrategy === "interrupt" || multitaskStrategy === "rollback") && inflight.length > 0) {
        for (const r of inflight) {
          r.abort_action = multitaskStrategy;
          r.abort_event.set();
          if (r.task !== null && !r.task.done()) {
            r.task.cancel();
          }
          r.status = RunStatus.INTERRUPTED;
          r.updated_at = now;
          interruptedRecords.push(r);
        }
      }
      return rec;
    });

    for (const interruptedRecord of interruptedRecords) {
      await this._persistStatus(interruptedRecord, RunStatus.INTERRUPTED);
    }
    logger.info("Run created: run_id=%s thread_id=%s", runId, threadId);
    return record;
  }

  /** Mark persisted active runs as failed when no local task owns them. */
  async reconcileOrphanedInflightRuns(options: { error: string; before?: string | null }): Promise<RunRecord[]> {
    const { error, before = null } = options;
    if (this._store === null) {
      return [];
    }
    const store = this._store;
    let rows: Record<string, unknown>[];
    try {
      rows = await this._callStoreWithRetry("list_inflight", "*", () => Promise.resolve(store.listInflight({ before })));
    } catch {
      logger.warning("Failed to list orphaned inflight runs for reconciliation");
      return [];
    }

    const recovered: RunRecord[] = [];
    const now = nowIso();
    for (const row of rows) {
      let record: RunRecord;
      try {
        record = RunManager._recordFromStore(row);
      } catch {
        logger.warning("Failed to map orphaned run row during reconciliation");
        continue;
      }

      const skip = await this._lock.run(async () => {
        const liveRecord = this._runs.get(record.run_id);
        return (
          liveRecord !== undefined &&
          (liveRecord.status === RunStatus.PENDING || liveRecord.status === RunStatus.RUNNING)
        );
      });
      if (skip) {
        continue;
      }

      record.status = RunStatus.ERROR;
      record.error = error;
      record.updated_at = now;
      const persisted = await this._persistStatus(record, RunStatus.ERROR, error);
      if (!persisted) {
        logger.warning("Skipped orphaned run %s recovery because error status was not persisted", record.run_id);
        continue;
      }
      recovered.push(record);
    }

    if (recovered.length > 0) {
      logger.warning("Recovered %d orphaned inflight run(s) as error", recovered.length);
    }
    return recovered;
  }

  /** Return `true` if *threadId* has a pending or running run. */
  async hasInflight(threadId: string): Promise<boolean> {
    return this._lock.run(async () =>
      this._threadRecordsLocked(threadId).some(
        (r) => r.status === RunStatus.PENDING || r.status === RunStatus.RUNNING
      )
    );
  }

  /** Remove a run record after an optional delay. */
  async cleanup(runId: string, options: { delay?: number } = {}): Promise<void> {
    const { delay = 300 } = options;
    if (delay > 0) {
      await sleep(delay);
    }
    await this._lock.run(async () => {
      const record = this._runs.get(runId);
      if (record !== undefined) {
        this._runs.delete(runId);
        this._unindexRunLocked(runId, record.thread_id);
      }
    });
    logger.debug("Run record %s cleaned up", runId);
  }

  /** Cancel and bounded-await all in-flight runs on process shutdown. */
  async shutdown(options: { timeout?: number } = {}): Promise<void> {
    const { timeout = 5.0 } = options;
    const deadline = monotonic() + timeout;

    const inflight = await this._lock.run(async () => {
      const list = [...this._runs.values()].filter(
        (record) =>
          (record.status === RunStatus.PENDING || record.status === RunStatus.RUNNING) &&
          record.task !== null &&
          !record.task.done()
      );
      for (const record of list) {
        record.abort_action = "interrupt";
        record.abort_event.set();
        record.task!.cancel();
        // Status is decided AFTER the drain (below), not here.
      }
      return list;
    });

    if (inflight.length === 0) {
      return;
    }

    const tasks = inflight.map((record) => record.task!);
    const { pending } = await waitTasks(tasks, timeout);

    // Only mark/persist `interrupted` for runs that did not settle on their own.
    const toPersist: RunRecord[] = [];
    await this._lock.run(async () => {
      for (const record of inflight) {
        const task = record.task!;
        if (!pending.has(task) && !task.cancelled()) {
          // Completed on its own — retrieve any surfaced exception, keep status.
          task.exception();
          continue;
        }
        if (record.status === RunStatus.PENDING || record.status === RunStatus.RUNNING) {
          record.status = RunStatus.INTERRUPTED;
          record.updated_at = nowIso();
        }
        toPersist.push(record);
      }
    });

    if (toPersist.length > 0) {
      const remaining = deadline - monotonic();
      if (remaining <= 0) {
        logger.warning(
          "Run drain budget exhausted before persisting %d interrupted run(s) on shutdown",
          toPersist.length
        );
      } else {
        try {
          const results = await withTimeout(
            Promise.allSettled(toPersist.map((record) => this._persistStatus(record, RunStatus.INTERRUPTED))),
            remaining
          );
          for (let i = 0; i < toPersist.length; i++) {
            const record = toPersist[i]!;
            const result = results[i]!;
            if (result.status === "rejected") {
              logger.warning(
                "Unexpected error persisting interrupted status for run %s during shutdown: %o",
                record.run_id,
                result.reason
              );
            } else if (result.value === false) {
              logger.warning("Could not persist interrupted status for run %s during shutdown", record.run_id);
            }
          }
        } catch (err) {
          if (err instanceof TimeoutError) {
            logger.warning(
              "Run drain status persistence exceeded the %ss budget; %d record(s) may not be persisted",
              timeout,
              toPersist.length
            );
          } else {
            throw err;
          }
        }
      }
    }

    if (pending.size > 0) {
      logger.warning(
        "Run drain exceeded %ss on shutdown; %d run task(s) still active and may race checkpointer teardown",
        timeout,
        pending.size
      );
    }
    logger.info(
      "Drained %d in-flight run(s) on shutdown (%d settled within %ss)",
      inflight.length,
      inflight.length - pending.size,
      timeout
    );
  }
}

function sortByCreatedAtDesc(records: RunRecord[]): RunRecord[] {
  return [...records].sort((a, b) => {
    if (a.created_at < b.created_at) {
      return 1;
    }
    if (a.created_at > b.created_at) {
      return -1;
    }
    return 0;
  });
}

/** Await `tasks` up to `timeoutSeconds`, returning the still-pending set. */
async function waitTasks(
  tasks: RunTask[],
  timeoutSeconds: number
): Promise<{ done: Set<RunTask>; pending: Set<RunTask> }> {
  const timeoutPromise = new Promise<void>((resolve) =>
    setTimeout(resolve, Math.max(0, timeoutSeconds * 1000))
  );
  await Promise.race([
    Promise.allSettled(tasks.map((t) => t.wait())).then(() => undefined),
    timeoutPromise,
  ]);
  const done = new Set<RunTask>();
  const pending = new Set<RunTask>();
  for (const t of tasks) {
    if (t.done()) {
      done.add(t);
    } else {
      pending.add(t);
    }
  }
  return { done, pending };
}
