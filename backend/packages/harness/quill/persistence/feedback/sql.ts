/**
 * SQLite-backed feedback storage (``node:sqlite`` port).
 *
 * Ports ``quill.persistence.feedback.sql``. Mirrors the SQLAlchemy
 * repository's query and owner-filtering logic against a shared ``DatabaseSync``
 * handle. Note the ``upsert`` / ``deleteByRun`` paths compare ``user_id``
 * against the resolved value directly (so ``userId=null`` matches ``IS NULL``
 * rows), matching the Python ``col == None`` → ``IS NULL`` behaviour.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { AUTO, resolveUserId, type UserIdParam } from "../_deps.js";
import { coerceIso, nowIso } from "../../utils/time.js";
import { FEEDBACK_TABLE } from "./model.js";

type RawRow = Record<string, unknown>;

export class FeedbackRepository {
  private readonly _db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this._db = db;
  }

  private static _rowToDict(row: RawRow): Record<string, unknown> {
    const d: Record<string, unknown> = { ...row };
    const val = d.created_at;
    if (typeof val === "string" || val instanceof Date) {
      d.created_at = coerceIso(val);
    }
    return d;
  }

  private _get(feedbackId: string): RawRow | undefined {
    return this._db.prepare(`SELECT * FROM ${FEEDBACK_TABLE} WHERE feedback_id = ?`).get(feedbackId);
  }

  /** Create a feedback record. ``rating`` must be +1 or -1. */
  async create(opts: {
    run_id: string;
    thread_id: string;
    rating: number;
    user_id?: UserIdParam;
    message_id?: string | null;
    comment?: string | null;
  }): Promise<Record<string, unknown>> {
    if (opts.rating !== 1 && opts.rating !== -1) {
      throw new Error(`rating must be +1 or -1, got ${opts.rating}`);
    }
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "FeedbackRepository.create" });
    const feedbackId = randomUUID();
    this._db
      .prepare(
        `INSERT INTO ${FEEDBACK_TABLE}
           (feedback_id, run_id, thread_id, user_id, message_id, rating, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(feedbackId, opts.run_id, opts.thread_id, resolvedUserId, opts.message_id ?? null, opts.rating, opts.comment ?? null, nowIso());
    return FeedbackRepository._rowToDict(this._get(feedbackId) as RawRow);
  }

  async get(feedbackId: string, opts: { user_id?: UserIdParam } = {}): Promise<Record<string, unknown> | null> {
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "FeedbackRepository.get" });
    const row = this._get(feedbackId);
    if (row === undefined) {
      return null;
    }
    if (resolvedUserId !== null && row.user_id !== resolvedUserId) {
      return null;
    }
    return FeedbackRepository._rowToDict(row);
  }

  async listByRun(
    threadId: string,
    runId: string,
    opts: { limit?: number; user_id?: UserIdParam } = {},
  ): Promise<Array<Record<string, unknown>>> {
    const limit = opts.limit ?? 100;
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "FeedbackRepository.list_by_run" });
    const where = ["thread_id = ?", "run_id = ?"];
    const params: SQLInputValue[] = [threadId, runId];
    if (resolvedUserId !== null) {
      where.push("user_id = ?");
      params.push(resolvedUserId);
    }
    params.push(limit);
    const rows = this._db
      .prepare(`SELECT * FROM ${FEEDBACK_TABLE} WHERE ${where.join(" AND ")} ORDER BY created_at ASC LIMIT ?`)
      .all(...params);
    return rows.map((r) => FeedbackRepository._rowToDict(r));
  }

  async listByThread(threadId: string, opts: { limit?: number; user_id?: UserIdParam } = {}): Promise<Array<Record<string, unknown>>> {
    const limit = opts.limit ?? 100;
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "FeedbackRepository.list_by_thread" });
    const where = ["thread_id = ?"];
    const params: SQLInputValue[] = [threadId];
    if (resolvedUserId !== null) {
      where.push("user_id = ?");
      params.push(resolvedUserId);
    }
    params.push(limit);
    const rows = this._db
      .prepare(`SELECT * FROM ${FEEDBACK_TABLE} WHERE ${where.join(" AND ")} ORDER BY created_at ASC LIMIT ?`)
      .all(...params);
    return rows.map((r) => FeedbackRepository._rowToDict(r));
  }

  async delete(feedbackId: string, opts: { user_id?: UserIdParam } = {}): Promise<boolean> {
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "FeedbackRepository.delete" });
    const row = this._get(feedbackId);
    if (row === undefined) {
      return false;
    }
    if (resolvedUserId !== null && row.user_id !== resolvedUserId) {
      return false;
    }
    this._db.prepare(`DELETE FROM ${FEEDBACK_TABLE} WHERE feedback_id = ?`).run(feedbackId);
    return true;
  }

  /** Create or update feedback for (thread_id, run_id, user_id). ``rating`` must be +1 or -1. */
  async upsert(opts: {
    run_id: string;
    thread_id: string;
    rating: number;
    user_id?: UserIdParam;
    comment?: string | null;
  }): Promise<Record<string, unknown>> {
    if (opts.rating !== 1 && opts.rating !== -1) {
      throw new Error(`rating must be +1 or -1, got ${opts.rating}`);
    }
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "FeedbackRepository.upsert" });
    const userClause = resolvedUserId === null ? "user_id IS NULL" : "user_id = ?";
    const selParams: SQLInputValue[] = [opts.thread_id, opts.run_id];
    if (resolvedUserId !== null) {
      selParams.push(resolvedUserId);
    }
    const row = this._db
      .prepare(`SELECT * FROM ${FEEDBACK_TABLE} WHERE thread_id = ? AND run_id = ? AND ${userClause}`)
      .get(...selParams);

    if (row !== undefined) {
      const feedbackId = row.feedback_id as string;
      this._db
        .prepare(`UPDATE ${FEEDBACK_TABLE} SET rating = ?, comment = ?, created_at = ? WHERE feedback_id = ?`)
        .run(opts.rating, opts.comment ?? null, nowIso(), feedbackId);
      return FeedbackRepository._rowToDict(this._get(feedbackId) as RawRow);
    }
    const feedbackId = randomUUID();
    this._db
      .prepare(
        `INSERT INTO ${FEEDBACK_TABLE}
           (feedback_id, run_id, thread_id, user_id, message_id, rating, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(feedbackId, opts.run_id, opts.thread_id, resolvedUserId, null, opts.rating, opts.comment ?? null, nowIso());
    return FeedbackRepository._rowToDict(this._get(feedbackId) as RawRow);
  }

  /** Delete the current user's feedback for a run. Returns true if a record was deleted. */
  async deleteByRun(opts: { thread_id: string; run_id: string; user_id?: UserIdParam }): Promise<boolean> {
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "FeedbackRepository.delete_by_run" });
    const userClause = resolvedUserId === null ? "user_id IS NULL" : "user_id = ?";
    const params: SQLInputValue[] = [opts.thread_id, opts.run_id];
    if (resolvedUserId !== null) {
      params.push(resolvedUserId);
    }
    const row = this._db
      .prepare(`SELECT feedback_id FROM ${FEEDBACK_TABLE} WHERE thread_id = ? AND run_id = ? AND ${userClause}`)
      .get(...params);
    if (row === undefined) {
      return false;
    }
    this._db.prepare(`DELETE FROM ${FEEDBACK_TABLE} WHERE feedback_id = ?`).run(row.feedback_id as string);
    return true;
  }

  /** Return feedback grouped by run_id for a thread: {run_id: feedback_dict}. */
  async listByThreadGrouped(threadId: string, opts: { user_id?: UserIdParam } = {}): Promise<Record<string, Record<string, unknown>>> {
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "FeedbackRepository.list_by_thread_grouped" });
    const where = ["thread_id = ?"];
    const params: SQLInputValue[] = [threadId];
    if (resolvedUserId !== null) {
      where.push("user_id = ?");
      params.push(resolvedUserId);
    }
    const rows = this._db.prepare(`SELECT * FROM ${FEEDBACK_TABLE} WHERE ${where.join(" AND ")}`).all(...params);
    const out: Record<string, Record<string, unknown>> = {};
    for (const row of rows) {
      out[row.run_id as string] = FeedbackRepository._rowToDict(row);
    }
    return out;
  }

  /** Aggregate feedback stats for a run using database-side counting. */
  async aggregateByRun(threadId: string, runId: string): Promise<Record<string, unknown>> {
    const row = this._db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END), 0) AS positive,
                COALESCE(SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END), 0) AS negative
         FROM ${FEEDBACK_TABLE} WHERE thread_id = ? AND run_id = ?`,
      )
      .get(threadId, runId) as RawRow;
    const num = (v: unknown): number => (typeof v === "bigint" ? Number(v) : ((v as number) ?? 0));
    return {
      run_id: runId,
      total: num(row.total),
      positive: num(row.positive),
      negative: num(row.negative),
    };
  }
}
