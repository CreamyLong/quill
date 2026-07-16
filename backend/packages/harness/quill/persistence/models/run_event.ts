/**
 * Table model for run events.
 *
 * Ports ``quill.persistence.models.run_event``. The Python original is a
 * SQLAlchemy ORM class; here we keep the row data shape as a TypeScript
 * interface plus the ``CREATE TABLE`` DDL (the same columns, indexes, and
 * unique constraint the ORM model declared).
 *
 * ``RunEventRow``'s storage implementation lives in the events store, not in an
 * entity directory, which is why it stays under ``persistence/models``.
 */

/** Row shape of the ``run_events`` table (JSON columns already parsed). */
export interface RunEventRow {
  id: number;
  thread_id: string;
  run_id: string;
  /**
   * Owner of the conversation this event belongs to. Nullable for data created
   * before auth was introduced; populated by auth middleware on new writes and
   * by the boot-time orphan migration on existing rows.
   */
  user_id: string | null;
  event_type: string;
  /** "message" | "trace" | "lifecycle" */
  category: string;
  content: string;
  event_metadata: Record<string, unknown>;
  seq: number;
  created_at: string;
}

export const RUN_EVENTS_TABLE = "run_events";

export const RUN_EVENTS_DDL = `
CREATE TABLE IF NOT EXISTS run_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id      VARCHAR(64) NOT NULL,
  run_id         VARCHAR(64) NOT NULL,
  user_id        VARCHAR(64),
  event_type     VARCHAR(32) NOT NULL,
  category       VARCHAR(16) NOT NULL,
  content        TEXT DEFAULT '',
  event_metadata JSON DEFAULT '{}',
  seq            INTEGER NOT NULL,
  created_at     DATETIME,
  CONSTRAINT uq_events_thread_seq UNIQUE (thread_id, seq)
);
CREATE INDEX IF NOT EXISTS ix_run_events_user_id ON run_events (user_id);
CREATE INDEX IF NOT EXISTS ix_events_thread_cat_seq ON run_events (thread_id, category, seq);
CREATE INDEX IF NOT EXISTS ix_events_run ON run_events (thread_id, run_id, seq);
`;
