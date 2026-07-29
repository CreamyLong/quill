/**
 * SQLite-backed RunEventStore implementation (node:sqlite).
 *
 * Persists events to the `run_events` table. Trace content is truncated at
 * `maxTraceContent` bytes to avoid bloating the database.
 *
 * NOTE (TS port): The Python implementation is backed by SQLAlchemy and takes an
 * async `session_factory`. This port uses Node's built-in `node:sqlite`
 * (`DatabaseSync`) directly — the caller injects a shared `DatabaseSync`
 * connection instead of a session factory (see `backend/scripts/sqlite_store.mjs`
 * for the same pattern). WAL mode + the SQLite busy timeout are expected to be
 * configured on the shared connection by the caller.
 */

import type { DatabaseSync, StatementSync } from "node:sqlite";

import { coerceIso } from "../../../utils/time.js";
import { AUTO, getCurrentUser, resolveUserId, type AutoSentinel } from "../../user_context.js";
import {
  RunEventStore,
  sanitizeLegacyCommandRepr,
  type ListEventsOptions,
  type ListMessagesOptions,
  type PutEventArgs,
  type RunEventRecord,
  type UserScopedOptions,
} from "./base.js";

const logger = {
  debug: (...a: unknown[]) => console.debug(...a),
};

type Row = Record<string, unknown>;

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS run_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id      TEXT NOT NULL,
    run_id         TEXT NOT NULL,
    user_id        TEXT,
    event_type     TEXT NOT NULL,
    category       TEXT NOT NULL,
    content        TEXT DEFAULT '',
    event_metadata TEXT DEFAULT '{}',
    seq            INTEGER NOT NULL,
    created_at     TEXT NOT NULL,
    CONSTRAINT uq_events_thread_seq UNIQUE (thread_id, seq)
  );
`;

const CREATE_INDEXES_SQL = [
  "CREATE INDEX IF NOT EXISTS ix_events_user ON run_events (user_id);",
  "CREATE INDEX IF NOT EXISTS ix_events_thread_cat_seq ON run_events (thread_id, category, seq);",
  "CREATE INDEX IF NOT EXISTS ix_events_run ON run_events (thread_id, run_id, seq);",
];

export class DbRunEventStore extends RunEventStore {
  private _db: DatabaseSync;
  private _maxTraceContent: number;

  constructor(db: DatabaseSync, { maxTraceContent = 10240 }: { maxTraceContent?: number } = {}) {
    super();
    this._db = db;
    this._maxTraceContent = maxTraceContent;
    this._db.exec(CREATE_TABLE_SQL);
    for (const stmt of CREATE_INDEXES_SQL) {
      this._db.exec(stmt);
    }
  }

  private _prepare(sql: string): StatementSync {
    return this._db.prepare(sql);
  }

  private static _rowToDict(row: Row, maxTraceContent: number): RunEventRecord {
    void maxTraceContent;
    const metadataRaw = row["event_metadata"];
    let metadata: Record<string, unknown> = {};
    if (typeof metadataRaw === "string" && metadataRaw) {
      try {
        metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
      } catch {
        metadata = {};
      }
    } else if (metadataRaw !== null && typeof metadataRaw === "object") {
      metadata = metadataRaw as Record<string, unknown>;
    }

    let content: unknown = row["content"] ?? "";
    // Restore structured content that was JSON-serialized on write.
    if (typeof content === "string" && (metadata["content_is_json"] || metadata["content_is_dict"])) {
      try {
        content = JSON.parse(content);
      } catch {
        logger.debug("Failed to deserialize content as JSON for event seq=%s", row["seq"]);
      }
    }

    return {
      thread_id: String(row["thread_id"]),
      run_id: String(row["run_id"]),
      user_id: (row["user_id"] as string | null) ?? null,
      event_type: String(row["event_type"]),
      category: String(row["category"]),
      content: sanitizeLegacyCommandRepr(content),
      metadata,
      seq: Number(row["seq"]),
      // SQLite stores created_at as an ISO string; coerceIso normalizes it.
      created_at: coerceIso(row["created_at"]),
    };
  }

  private _truncateTrace(
    category: string,
    content: unknown,
    metadata: Record<string, unknown> | null
  ): [unknown, Record<string, unknown>] {
    let resultContent = content;
    let resultMeta = metadata ?? {};
    if (category === "trace") {
      const text = typeof content === "string" ? content : JSON.stringify(content);
      const encoded = Buffer.from(text ?? "", "utf-8");
      if (encoded.length > this._maxTraceContent) {
        // Truncate by bytes, then decode back (may cut a multi-byte char).
        resultContent = encoded.subarray(0, this._maxTraceContent).toString("utf-8");
        resultMeta = { ...(metadata ?? {}), content_truncated: true, original_byte_length: encoded.length };
      }
    }
    return [resultContent, resultMeta];
  }

  private static _contentToDb(
    content: unknown,
    metadata: Record<string, unknown> | null
  ): [string, Record<string, unknown>] {
    let meta = metadata ?? {};
    if (typeof content === "string") {
      return [content, meta];
    }
    const dbContent = JSON.stringify(content);
    meta = { ...meta, content_is_json: true };
    if (content !== null && typeof content === "object" && !Array.isArray(content)) {
      meta["content_is_dict"] = true;
    }
    return [dbContent, meta];
  }

  /**
   * Soft read of user_id from the current user for write paths.
   *
   * Returns `null` (no filter / no stamp) if unset, which is the expected case
   * for background worker writes. HTTP request writes will have the current user
   * set by auth middleware and get their user_id stamped automatically.
   */
  private static _userIdFromContext(): string | null {
    const user = getCurrentUser();
    return user !== null ? String(user.id) : null;
  }

  private _maxSeqForThread(threadId: string): number | null {
    const stmt = this._prepare("SELECT MAX(seq) AS max_seq FROM run_events WHERE thread_id = ?");
    const row = stmt.get(threadId) as Row | undefined;
    const value = row?.["max_seq"];
    return value === null || value === undefined ? null : Number(value);
  }

  async put(args: PutEventArgs): Promise<RunEventRecord> {
    const [truncated, metaAfterTruncate] = this._truncateTrace(
      args.category,
      args.content ?? "",
      args.metadata ?? null
    );
    const [dbContent, metadata] = DbRunEventStore._contentToDb(truncated, metaAfterTruncate);
    const userId = DbRunEventStore._userIdFromContext();

    const maxSeq = this._maxSeqForThread(args.thread_id);
    const seq = (maxSeq ?? 0) + 1;
    const createdAt = args.created_at ? args.created_at : new Date().toISOString();
    this._prepare(
      `INSERT INTO run_events
         (thread_id, run_id, user_id, event_type, category, content, event_metadata, seq, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      args.thread_id,
      args.run_id,
      userId,
      args.event_type,
      args.category,
      dbContent,
      JSON.stringify(metadata),
      seq,
      createdAt
    );
    return DbRunEventStore._rowToDict(
      {
        thread_id: args.thread_id,
        run_id: args.run_id,
        user_id: userId,
        event_type: args.event_type,
        category: args.category,
        content: dbContent,
        event_metadata: JSON.stringify(metadata),
        seq,
        created_at: createdAt,
      },
      this._maxTraceContent
    );
  }

  async putBatch(events: PutEventArgs[]): Promise<RunEventRecord[]> {
    if (events.length === 0) {
      return [];
    }
    const threadIds = new Set(events.map((e) => e.thread_id));
    if (threadIds.size > 1) {
      throw new Error(
        `putBatch requires all events to belong to the same thread; got ${JSON.stringify([...threadIds])}`
      );
    }
    const userId = DbRunEventStore._userIdFromContext();
    const threadId = events[0]!.thread_id;
    const maxSeq = this._maxSeqForThread(threadId);
    let seq = maxSeq ?? 0;
    const insert = this._prepare(
      `INSERT INTO run_events
         (thread_id, run_id, user_id, event_type, category, content, event_metadata, seq, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const records: RunEventRecord[] = [];
    for (const e of events) {
      seq += 1;
      const category = e.category ?? "trace";
      const [truncated, metaAfterTruncate] = this._truncateTrace(category, e.content ?? "", e.metadata ?? null);
      const [dbContent, metadata] = DbRunEventStore._contentToDb(truncated, metaAfterTruncate);
      const rowUserId = e.user_id !== undefined ? e.user_id : userId;
      const createdAt = e.created_at ? e.created_at : new Date().toISOString();
      insert.run(
        e.thread_id,
        e.run_id,
        rowUserId,
        e.event_type,
        category,
        dbContent,
        JSON.stringify(metadata),
        seq,
        createdAt
      );
      records.push(
        DbRunEventStore._rowToDict(
          {
            thread_id: e.thread_id,
            run_id: e.run_id,
            user_id: rowUserId,
            event_type: e.event_type,
            category,
            content: dbContent,
            event_metadata: JSON.stringify(metadata),
            seq,
            created_at: createdAt,
          },
          this._maxTraceContent
        )
      );
    }
    return records;
  }

  async listMessages(threadId: string, options: ListMessagesOptions = {}): Promise<RunEventRecord[]> {
    const { limit = 50, before_seq = null, after_seq = null, user_id = AUTO } = options;
    const resolvedUserId = resolveUserId(user_id, { methodName: "DbRunEventStore.listMessages" });
    const conditions = ["thread_id = ?", "category = 'message'"];
    const params: (string | number)[] = [threadId];
    if (resolvedUserId !== null) {
      conditions.push("user_id = ?");
      params.push(resolvedUserId);
    }
    if (before_seq !== null && before_seq !== undefined) {
      conditions.push("seq < ?");
      params.push(before_seq);
    }
    if (after_seq !== null && after_seq !== undefined) {
      conditions.push("seq > ?");
      params.push(after_seq);
    }
    const where = conditions.join(" AND ");
    if (after_seq !== null && after_seq !== undefined) {
      // Forward pagination: first `limit` records after cursor.
      const rows = this._prepare(
        `SELECT * FROM run_events WHERE ${where} ORDER BY seq ASC LIMIT ?`
      ).all(...params, limit) as Row[];
      return rows.map((r) => DbRunEventStore._rowToDict(r, this._maxTraceContent));
    }
    // before_seq or default (latest): take last `limit`, return ascending.
    const rows = this._prepare(
      `SELECT * FROM run_events WHERE ${where} ORDER BY seq DESC LIMIT ?`
    ).all(...params, limit) as Row[];
    return rows.reverse().map((r) => DbRunEventStore._rowToDict(r, this._maxTraceContent));
  }

  async listEvents(
    threadId: string,
    runId: string,
    options: ListEventsOptions = {}
  ): Promise<RunEventRecord[]> {
    const {
      event_types = null,
      limit = 500,
      user_id = AUTO,
      task_id = null,
      after_seq = null,
      category = null,
    } = options;
    const resolvedUserId = resolveUserId(user_id, { methodName: "DbRunEventStore.listEvents" });
    const conditions = ["thread_id = ?", "run_id = ?"];
    const params: (string | number)[] = [threadId, runId];
    if (resolvedUserId !== null) {
      conditions.push("user_id = ?");
      params.push(resolvedUserId);
    }
    if (event_types && event_types.length > 0) {
      conditions.push(`event_type IN (${event_types.map(() => "?").join(", ")})`);
      params.push(...event_types);
    }
    if (category !== null && category !== undefined) {
      conditions.push("category = ?");
      params.push(category);
    }
    if (after_seq !== null && after_seq !== undefined) {
      conditions.push("seq > ?");
      params.push(after_seq);
    }
    // `task_id` lives inside the JSON `event_metadata` blob, so filter it with
    // SQLite's json_extract. The subagent.timeline backfill depends on this.
    if (task_id !== null && task_id !== undefined) {
      conditions.push("json_extract(event_metadata, '$.task_id') = ?");
      params.push(task_id);
    }
    const where = conditions.join(" AND ");
    const rows = this._prepare(
      `SELECT * FROM run_events WHERE ${where} ORDER BY seq ASC LIMIT ?`
    ).all(...params, limit) as Row[];
    return rows.map((r) => DbRunEventStore._rowToDict(r, this._maxTraceContent));
  }

  async listMessagesByRun(threadId: string, runId: string, options: ListMessagesOptions = {}): Promise<RunEventRecord[]> {
    const { limit = 50, before_seq = null, after_seq = null, user_id = AUTO } = options;
    const resolvedUserId = resolveUserId(user_id, { methodName: "DbRunEventStore.listMessagesByRun" });
    const conditions = ["thread_id = ?", "run_id = ?", "category = 'message'"];
    const params: (string | number)[] = [threadId, runId];
    if (resolvedUserId !== null) {
      conditions.push("user_id = ?");
      params.push(resolvedUserId);
    }
    if (before_seq !== null && before_seq !== undefined) {
      conditions.push("seq < ?");
      params.push(before_seq);
    }
    if (after_seq !== null && after_seq !== undefined) {
      conditions.push("seq > ?");
      params.push(after_seq);
    }
    const where = conditions.join(" AND ");
    if (after_seq !== null && after_seq !== undefined) {
      const rows = this._prepare(
        `SELECT * FROM run_events WHERE ${where} ORDER BY seq ASC LIMIT ?`
      ).all(...params, limit) as Row[];
      return rows.map((r) => DbRunEventStore._rowToDict(r, this._maxTraceContent));
    }
    const rows = this._prepare(
      `SELECT * FROM run_events WHERE ${where} ORDER BY seq DESC LIMIT ?`
    ).all(...params, limit) as Row[];
    return rows.reverse().map((r) => DbRunEventStore._rowToDict(r, this._maxTraceContent));
  }

  async countMessages(threadId: string, options: UserScopedOptions = {}): Promise<number> {
    const { user_id = AUTO } = options;
    const resolvedUserId = resolveUserId(user_id, { methodName: "DbRunEventStore.countMessages" });
    const conditions = ["thread_id = ?", "category = 'message'"];
    const params: (string | number)[] = [threadId];
    if (resolvedUserId !== null) {
      conditions.push("user_id = ?");
      params.push(resolvedUserId);
    }
    const row = this._prepare(
      `SELECT COUNT(*) AS cnt FROM run_events WHERE ${conditions.join(" AND ")}`
    ).get(...params) as Row | undefined;
    return Number(row?.["cnt"] ?? 0);
  }

  async deleteByThread(threadId: string, options: UserScopedOptions = {}): Promise<number> {
    const { user_id = AUTO } = options;
    const resolvedUserId = resolveUserId(user_id, { methodName: "DbRunEventStore.deleteByThread" });
    const conditions = ["thread_id = ?"];
    const params: (string | number)[] = [threadId];
    if (resolvedUserId !== null) {
      conditions.push("user_id = ?");
      params.push(resolvedUserId);
    }
    const where = conditions.join(" AND ");
    const countRow = this._prepare(`SELECT COUNT(*) AS cnt FROM run_events WHERE ${where}`).get(...params) as
      | Row
      | undefined;
    const count = Number(countRow?.["cnt"] ?? 0);
    if (count > 0) {
      this._prepare(`DELETE FROM run_events WHERE ${where}`).run(...params);
    }
    return count;
  }

  async deleteByRun(threadId: string, runId: string, options: UserScopedOptions = {}): Promise<number> {
    const { user_id = AUTO } = options;
    const resolvedUserId = resolveUserId(user_id, { methodName: "DbRunEventStore.deleteByRun" });
    const conditions = ["thread_id = ?", "run_id = ?"];
    const params: (string | number)[] = [threadId, runId];
    if (resolvedUserId !== null) {
      conditions.push("user_id = ?");
      params.push(resolvedUserId);
    }
    const where = conditions.join(" AND ");
    const countRow = this._prepare(`SELECT COUNT(*) AS cnt FROM run_events WHERE ${where}`).get(...params) as
      | Row
      | undefined;
    const count = Number(countRow?.["cnt"] ?? 0);
    if (count > 0) {
      this._prepare(`DELETE FROM run_events WHERE ${where}`).run(...params);
    }
    return count;
  }
}
