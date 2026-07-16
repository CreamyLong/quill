/**
 * JSONL file-backed RunEventStore implementation.
 *
 * Each run's events are stored in a single file:
 * `.scitops/threads/{thread_id}/runs/{run_id}.jsonl`
 *
 * All categories (message, trace, lifecycle) are in the same file. This backend
 * is suitable for lightweight single-node deployments.
 *
 * **Single-process guarantee**: the in-memory seq counter is process-local.
 * Multi-process deployments sharing the same directory will produce duplicate or
 * non-monotonic seq values. Use `DbRunEventStore` for multi-process or
 * high-concurrency deployments.
 *
 * Per-thread async mutexes serialise writes within a single process to prevent
 * interleaved JSONL lines.
 *
 * Known trade-off: `listMessages()` must scan all run files for a thread since
 * messages from multiple runs need unified seq ordering. `listEvents()` reads
 * only one file — the fast path.
 */

import fs from "node:fs";
import path from "node:path";

import { nowIso } from "../../../utils/time.js";
import {
  RunEventStore,
  type ListEventsOptions,
  type ListMessagesOptions,
  type PutEventArgs,
  type RunEventRecord,
  type UserScopedOptions,
} from "./base.js";

const logger = {
  debug: (...a: unknown[]) => console.debug(...a),
};

const _SAFE_ID_PATTERN = /^[A-Za-z0-9_\-]+$/;

/** Simple per-key async mutex — serialises coroutines touching one thread. */
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

export class JsonlRunEventStore extends RunEventStore {
  private _baseDir: string;
  private _seqCounters: Map<string, number> = new Map(); // thread_id -> current max seq
  private _writeLocks: Map<string, AsyncLock> = new Map();

  constructor(baseDir?: string) {
    super();
    this._baseDir = baseDir ? baseDir : ".scitops";
  }

  private _getWriteLock(threadId: string): AsyncLock {
    let lock = this._writeLocks.get(threadId);
    if (lock === undefined) {
      lock = new AsyncLock();
      this._writeLocks.set(threadId, lock);
    }
    return lock;
  }

  private static _validateId(value: string, label: string): string {
    if (!value || !_SAFE_ID_PATTERN.test(value)) {
      throw new Error(`Invalid ${label}: must be alphanumeric/dash/underscore, got ${JSON.stringify(value)}`);
    }
    return value;
  }

  private _threadDir(threadId: string): string {
    JsonlRunEventStore._validateId(threadId, "thread_id");
    return path.join(this._baseDir, "threads", threadId, "runs");
  }

  private _runFile(threadId: string, runId: string): string {
    JsonlRunEventStore._validateId(runId, "run_id");
    return path.join(this._threadDir(threadId), `${runId}.jsonl`);
  }

  private _nextSeq(threadId: string): number {
    const next = (this._seqCounters.get(threadId) ?? 0) + 1;
    this._seqCounters.set(threadId, next);
    return next;
  }

  /** Scan all run files for a thread and return the current max seq. */
  private _computeMaxSeq(threadId: string): number {
    let maxSeq = 0;
    const threadDir = this._threadDir(threadId);
    if (fs.existsSync(threadDir)) {
      for (const f of this._jsonlFiles(threadDir)) {
        for (const line of fs.readFileSync(f, "utf-8").trim().split(/\r?\n/)) {
          if (!line) {
            continue;
          }
          try {
            const record = JSON.parse(line) as Record<string, unknown>;
            maxSeq = Math.max(maxSeq, (record["seq"] as number) ?? 0);
          } catch {
            logger.debug("Skipping malformed JSONL line in %s", f);
          }
        }
      }
    }
    return maxSeq;
  }

  private async _ensureSeqLoaded(threadId: string): Promise<void> {
    if (this._seqCounters.has(threadId)) {
      return;
    }
    const maxSeq = this._computeMaxSeq(threadId);
    this._seqCounters.set(threadId, maxSeq);
  }

  private _jsonlFiles(threadDir: string, sorted = false): string[] {
    if (!fs.existsSync(threadDir)) {
      return [];
    }
    const files = fs
      .readdirSync(threadDir)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => path.join(threadDir, name));
    return sorted ? files.sort() : files;
  }

  private _writeRecord(record: RunEventRecord): void {
    const filePath = this._runFile(record.thread_id, record.run_id);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8");
  }

  /** Read all events for a thread, sorted by seq. */
  private _readThreadEvents(threadId: string): RunEventRecord[] {
    const events: RunEventRecord[] = [];
    const threadDir = this._threadDir(threadId);
    if (!fs.existsSync(threadDir)) {
      return events;
    }
    for (const f of this._jsonlFiles(threadDir, true)) {
      for (const line of fs.readFileSync(f, "utf-8").trim().split(/\r?\n/)) {
        if (!line) {
          continue;
        }
        try {
          events.push(JSON.parse(line) as RunEventRecord);
        } catch {
          logger.debug("Skipping malformed JSONL line in %s", f);
        }
      }
    }
    events.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    return events;
  }

  /** Read events for a specific run file. */
  private _readRunEvents(threadId: string, runId: string): RunEventRecord[] {
    const filePath = this._runFile(threadId, runId);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const events: RunEventRecord[] = [];
    for (const line of fs.readFileSync(filePath, "utf-8").trim().split(/\r?\n/)) {
      if (!line) {
        continue;
      }
      try {
        events.push(JSON.parse(line) as RunEventRecord);
      } catch {
        logger.debug("Skipping malformed JSONL line in %s", filePath);
      }
    }
    events.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    return events;
  }

  private _deleteThreadFiles(threadId: string): void {
    const threadDir = this._threadDir(threadId);
    if (fs.existsSync(threadDir)) {
      for (const f of this._jsonlFiles(threadDir)) {
        fs.rmSync(f);
      }
    }
  }

  private _deleteRunFile(threadId: string, runId: string): void {
    const filePath = this._runFile(threadId, runId);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath);
    }
  }

  async put(args: PutEventArgs): Promise<RunEventRecord> {
    return this._getWriteLock(args.thread_id).run(async () => {
      await this._ensureSeqLoaded(args.thread_id);
      const seq = this._nextSeq(args.thread_id);
      const record: RunEventRecord = {
        thread_id: args.thread_id,
        run_id: args.run_id,
        event_type: args.event_type,
        category: args.category,
        content: args.content ?? "",
        metadata: args.metadata ?? {},
        seq,
        created_at: args.created_at ?? nowIso(),
      };
      this._writeRecord(record);
      return record;
    });
  }

  async putBatch(events: PutEventArgs[]): Promise<RunEventRecord[]> {
    if (events.length === 0) {
      return [];
    }
    const results: RunEventRecord[] = [];
    for (const ev of events) {
      results.push(await this.put(ev));
    }
    return results;
  }

  async listMessages(threadId: string, options: ListMessagesOptions = {}): Promise<RunEventRecord[]> {
    const { limit = 50, before_seq = null, after_seq = null } = options;
    const allEvents = this._readThreadEvents(threadId);
    let messages = allEvents.filter((e) => e.category === "message");

    if (before_seq !== null && before_seq !== undefined) {
      messages = messages.filter((e) => e.seq < before_seq);
      return messages.slice(Math.max(0, messages.length - limit));
    } else if (after_seq !== null && after_seq !== undefined) {
      messages = messages.filter((e) => e.seq > after_seq);
      return messages.slice(0, limit);
    } else {
      return messages.slice(Math.max(0, messages.length - limit));
    }
  }

  async listEvents(
    threadId: string,
    runId: string,
    options: ListEventsOptions = {}
  ): Promise<RunEventRecord[]> {
    const {
      event_types = null,
      limit = 500,
      task_id = null,
      after_seq = null,
      category = null,
    } = options;
    let events = this._readRunEvents(threadId, runId);
    if (after_seq !== null && after_seq !== undefined) {
      events = events.filter((e) => (e.seq ?? 0) > after_seq);
    }
    if (event_types !== null && event_types !== undefined) {
      events = events.filter((e) => event_types.includes(e.event_type));
    }
    if (category !== null && category !== undefined) {
      events = events.filter((e) => e.category === category);
    }
    if (task_id !== null && task_id !== undefined) {
      events = events.filter((e) => e.metadata?.task_id === task_id);
    }
    return events.slice(0, limit);
  }

  async listMessagesByRun(threadId: string, runId: string, options: ListMessagesOptions = {}): Promise<RunEventRecord[]> {
    const { limit = 50, before_seq = null, after_seq = null } = options;
    const events = this._readRunEvents(threadId, runId);
    let filtered = events.filter((e) => e.category === "message");
    if (before_seq !== null && before_seq !== undefined) {
      filtered = filtered.filter((e) => (e.seq ?? 0) < before_seq);
    }
    if (after_seq !== null && after_seq !== undefined) {
      filtered = filtered.filter((e) => (e.seq ?? 0) > after_seq);
    }
    if (after_seq !== null && after_seq !== undefined) {
      return filtered.slice(0, limit);
    } else {
      return filtered.length > limit ? filtered.slice(filtered.length - limit) : filtered;
    }
  }

  async countMessages(threadId: string, _options: UserScopedOptions = {}): Promise<number> {
    const allEvents = this._readThreadEvents(threadId);
    return allEvents.reduce((acc, e) => (e.category === "message" ? acc + 1 : acc), 0);
  }

  async deleteByThread(threadId: string, _options: UserScopedOptions = {}): Promise<number> {
    return this._getWriteLock(threadId).run(async () => {
      const allEvents = this._readThreadEvents(threadId);
      const count = allEvents.length;
      this._deleteThreadFiles(threadId);
      this._seqCounters.delete(threadId);
      this._writeLocks.delete(threadId);
      return count;
    });
  }

  async deleteByRun(threadId: string, runId: string, _options: UserScopedOptions = {}): Promise<number> {
    return this._getWriteLock(threadId).run(async () => {
      const events = this._readRunEvents(threadId, runId);
      const count = events.length;
      this._deleteRunFile(threadId, runId);
      return count;
    });
  }
}
