/**
 * In-memory RunEventStore. Used when run_events.backend=memory (default) and in tests.
 *
 * Safe for single-process async usage (no locks needed since all mutations
 * happen within the same event loop).
 */

import { nowIso } from "../../../utils/time.js";
import {
  RunEventStore,
  sanitizeLegacyCommandRepr,
  type ListEventsOptions,
  type ListMessagesOptions,
  type PutEventArgs,
  type RunEventRecord,
  type UserScopedOptions,
} from "./base.js";

/** Return the leftmost index at which `seq` could be inserted keeping order. */
function bisectLeft(events: RunEventRecord[], seq: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid]!.seq < seq) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/** Return the rightmost index at which `seq` could be inserted keeping order. */
function bisectRight(events: RunEventRecord[], seq: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (seq < events[mid]!.seq) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

export class MemoryRunEventStore extends RunEventStore {
  private _events: Map<string, RunEventRecord[]> = new Map(); // thread_id -> seq-sorted event list
  // Messages-only projection of `_events` (same record objects, no copies),
  // kept in seq order so message pagination is O(log m + page) via bisect.
  private _messages: Map<string, RunEventRecord[]> = new Map();
  // Run-keyed projections of the two lists above (same record objects, no
  // copies), kept in seq order so per-run reads cost O(events-in-run).
  private _eventsByRun: Map<string, Map<string, RunEventRecord[]>> = new Map();
  private _messagesByRun: Map<string, Map<string, RunEventRecord[]>> = new Map();
  private _seqCounters: Map<string, number> = new Map();

  private _nextSeq(threadId: string): number {
    const current = this._seqCounters.get(threadId) ?? 0;
    const nextVal = current + 1;
    this._seqCounters.set(threadId, nextVal);
    return nextVal;
  }

  private _putOne(args: PutEventArgs): RunEventRecord {
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
    getOrCreateList(this._events, args.thread_id).push(record);
    getOrCreateNested(this._eventsByRun, args.thread_id, args.run_id).push(record);
    if (args.category === "message") {
      getOrCreateList(this._messages, args.thread_id).push(record);
      getOrCreateNested(this._messagesByRun, args.thread_id, args.run_id).push(record);
    }
    return record;
  }

  async put(args: PutEventArgs): Promise<RunEventRecord> {
    return this._putOne(args);
  }

  async putBatch(events: PutEventArgs[]): Promise<RunEventRecord[]> {
    const results: RunEventRecord[] = [];
    for (const ev of events) {
      results.push(this._putOne(ev));
    }
    return results;
  }

  async listMessages(threadId: string, options: ListMessagesOptions = {}): Promise<RunEventRecord[]> {
    const { limit = 50, before_seq = null, after_seq = null } = options;
    // `messages` is messages-only and seq-sorted, so the seq window is a
    // contiguous slice located with bisect (O(log m)) rather than a full scan.
    const messages = this._messages.get(threadId) ?? [];

    let result: RunEventRecord[];
    if (before_seq !== null && before_seq !== undefined) {
      // Records with seq < before_seq, then the last `limit` of them.
      const hi = bisectLeft(messages, before_seq);
      result = messages.slice(Math.max(0, hi - limit), hi);
    } else if (after_seq !== null && after_seq !== undefined) {
      // Records with seq > after_seq, then the first `limit` of them.
      const lo = bisectRight(messages, after_seq);
      result = messages.slice(lo, lo + limit);
    } else {
      // Return the latest `limit` records, ascending.
      result = messages.slice(Math.max(0, messages.length - limit));
    }
    return result.map((r) => ({ ...r, content: sanitizeLegacyCommandRepr(r.content) }));
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
    // `_eventsByRun` is already scoped to this run and seq-ordered, so we touch
    // only this run's events instead of scanning the whole thread. Apply the
    // optional `after_seq` forward cursor before slicing so a subagent's step
    // history can page past the run-wide limit.
    let runEvents = this._eventsByRun.get(threadId)?.get(runId) ?? [];
    if (after_seq !== null && after_seq !== undefined) {
      const lo = bisectRight(runEvents, after_seq);
      runEvents = runEvents.slice(lo);
    }
    if (event_types !== null && event_types !== undefined) {
      runEvents = runEvents.filter((e) => event_types.includes(e.event_type));
    }
    if (category !== null && category !== undefined) {
      runEvents = runEvents.filter((e) => e.category === category);
    }
    if (task_id !== null && task_id !== undefined) {
      runEvents = runEvents.filter((e) => e.metadata?.task_id === task_id);
    }
    return runEvents.slice(0, limit).map((r) => ({ ...r, content: sanitizeLegacyCommandRepr(r.content) }));
  }

  async listMessagesByRun(threadId: string, runId: string, options: ListMessagesOptions = {}): Promise<RunEventRecord[]> {
    const { limit = 50, before_seq = null, after_seq = null } = options;
    // Per-run, messages-only, seq-sorted: the seq window is a contiguous slice
    // located with bisect over only this run's messages.
    const messages = this._messagesByRun.get(threadId)?.get(runId) ?? [];
    const lo = after_seq === null || after_seq === undefined ? 0 : bisectRight(messages, after_seq);
    const hi = before_seq === null || before_seq === undefined ? messages.length : bisectLeft(messages, before_seq);
    const window = messages.slice(lo, hi);
    const sliced =
      // An `after_seq` cursor pages forward (first `limit`); otherwise return the
      // last `limit` (the latest page, or the page ending just before `before_seq`).
      after_seq !== null && after_seq !== undefined
        ? window.slice(0, limit)
        : window.slice(Math.max(0, window.length - limit));
    return sliced.map((r) => ({ ...r, content: sanitizeLegacyCommandRepr(r.content) }));
  }

  async countMessages(threadId: string, _options: UserScopedOptions = {}): Promise<number> {
    return (this._messages.get(threadId) ?? []).length;
  }

  async deleteByThread(threadId: string, _options: UserScopedOptions = {}): Promise<number> {
    const events = this._events.get(threadId) ?? [];
    this._events.delete(threadId);
    this._messages.delete(threadId);
    this._eventsByRun.delete(threadId);
    this._messagesByRun.delete(threadId);
    this._seqCounters.delete(threadId);
    return events.length;
  }

  async deleteByRun(threadId: string, runId: string, _options: UserScopedOptions = {}): Promise<number> {
    const allEvents = this._events.get(threadId) ?? [];
    if (allEvents.length === 0) {
      return 0;
    }
    const remaining = allEvents.filter((e) => e.run_id !== runId);
    const removed = allEvents.length - remaining.length;
    this._events.set(threadId, remaining);
    // Keep the message projection in lockstep (same surviving record objects).
    this._messages.set(
      threadId,
      remaining.filter((e) => e.category === "message")
    );
    // Drop the deleted run from the run-keyed projections.
    this._eventsByRun.get(threadId)?.delete(runId);
    this._messagesByRun.get(threadId)?.delete(runId);
    return removed;
  }
}

function getOrCreateList(map: Map<string, RunEventRecord[]>, key: string): RunEventRecord[] {
  let list = map.get(key);
  if (list === undefined) {
    list = [];
    map.set(key, list);
  }
  return list;
}

function getOrCreateNested(
  map: Map<string, Map<string, RunEventRecord[]>>,
  outer: string,
  inner: string
): RunEventRecord[] {
  let nested = map.get(outer);
  if (nested === undefined) {
    nested = new Map();
    map.set(outer, nested);
  }
  return getOrCreateList(nested, inner);
}
