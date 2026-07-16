/**
 * Abstract interface for run event storage.
 *
 * RunEventStore is the unified storage interface for run event streams.
 * Messages (frontend display) and execution traces (debugging/audit) go through
 * the same interface, distinguished by the `category` field.
 *
 * Implementations:
 * - MemoryRunEventStore: in-memory dict (development, tests)
 * - JsonlRunEventStore: append-only JSONL files
 * - DbRunEventStore: node:sqlite-backed store
 */

import type { AutoSentinel } from "../../user_context.js";

/** Event content — a string, a structured object, or any serialisable value. */
export type EventContent = unknown;

/** Complete run-event record, as returned by store reads/writes. */
export interface RunEventRecord {
  thread_id: string;
  run_id: string;
  event_type: string;
  category: string;
  content: EventContent;
  metadata: Record<string, unknown>;
  seq: number;
  created_at: string;
  [key: string]: unknown;
}

/** Arguments accepted by {@link RunEventStore.put} and per-item batch writes. */
export interface PutEventArgs {
  thread_id: string;
  run_id: string;
  event_type: string;
  category: string;
  content?: EventContent;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  user_id?: string | null;
}

export interface ListMessagesOptions {
  limit?: number;
  before_seq?: number | null;
  after_seq?: number | null;
  user_id?: string | null | AutoSentinel;
}

export interface ListEventsOptions {
  event_types?: string[] | null;
  limit?: number;
  user_id?: string | null | AutoSentinel;
  /**
   * When set, only return events whose `metadata.task_id` equals this value.
   * Backs the subtask-card backfill query (`GET …/events?task_id=<id>`).
   */
  task_id?: string | null;
  /**
   * Forward cursor: only return events whose `seq` is strictly greater than
   * this value. Combined with ascending ordering this lets a client page
   * through a subagent's step history without being capped by the run limit.
   */
  after_seq?: number | null;
  /**
   * Filter by `category` (e.g. `"subagent"` to keep step timeline events out
   * of the `/messages` view). When null, all categories are returned.
   */
  category?: string | null;
}

export interface UserScopedOptions {
  user_id?: string | null | AutoSentinel;
}

/**
 * Run event stream storage interface.
 *
 * All implementations must guarantee:
 * 1. put() events are retrievable in subsequent queries
 * 2. seq is strictly increasing within the same thread
 * 3. listMessages() only returns category="message" events
 * 4. listEvents() returns all events for the specified run
 * 5. Returned records match the RunEvent field structure
 */
export abstract class RunEventStore {
  /** Write an event, auto-assign seq, return the complete record. */
  abstract put(args: PutEventArgs): Promise<RunEventRecord>;

  /**
   * Batch-write events. Used by RunJournal flush buffer.
   *
   * Each item's keys match put()'s arguments. Returns complete records with seq
   * assigned.
   */
  abstract putBatch(events: PutEventArgs[]): Promise<RunEventRecord[]>;

  /**
   * Return displayable messages (category=message) for a thread, ordered by seq
   * ascending.
   *
   * Supports bidirectional cursor pagination:
   * - before_seq: return the last `limit` records with seq < before_seq (ascending)
   * - after_seq: return the first `limit` records with seq > after_seq (ascending)
   * - neither: return the latest `limit` records (ascending)
   */
  abstract listMessages(threadId: string, options?: ListMessagesOptions): Promise<RunEventRecord[]>;

  /**
   * Return the full event stream for a run, ordered by seq ascending.
   *
   * Optionally filter by event_types.
   */
  abstract listEvents(threadId: string, runId: string, options?: ListEventsOptions): Promise<RunEventRecord[]>;

  /**
   * Return displayable messages (category=message) for a specific run, ordered
   * by seq ascending.
   *
   * Supports bidirectional cursor pagination:
   * - after_seq: return the first `limit` records with seq > after_seq (ascending)
   * - before_seq: return the last `limit` records with seq < before_seq (ascending)
   * - neither: return the latest `limit` records (ascending)
   */
  abstract listMessagesByRun(threadId: string, runId: string, options?: ListMessagesOptions): Promise<RunEventRecord[]>;

  /** Count displayable messages (category=message) in a thread. */
  abstract countMessages(threadId: string, options?: UserScopedOptions): Promise<number>;

  /** Delete all events for a thread. Return the number of deleted events. */
  abstract deleteByThread(threadId: string, options?: UserScopedOptions): Promise<number>;

  /** Delete all events for a specific run. Return the number of deleted events. */
  abstract deleteByRun(threadId: string, runId: string, options?: UserScopedOptions): Promise<number>;
}
