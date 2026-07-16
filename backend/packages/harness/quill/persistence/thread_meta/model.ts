/**
 * Table model for thread metadata.
 *
 * Ports ``quill.persistence.thread_meta.model``. The Python ORM class is
 * represented here as the row data shape plus its ``CREATE TABLE`` DDL.
 */

/** Row shape of the ``threads_meta`` table (``metadata_json`` already parsed). */
export interface ThreadMetaRow {
  thread_id: string;
  assistant_id: string | null;
  user_id: string | null;
  display_name: string | null;
  status: string;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const THREADS_META_TABLE = "threads_meta";

export const THREADS_META_DDL = `
CREATE TABLE IF NOT EXISTS threads_meta (
  thread_id     VARCHAR(64) PRIMARY KEY,
  assistant_id  VARCHAR(128),
  user_id       VARCHAR(64),
  display_name  VARCHAR(256),
  status        VARCHAR(20) DEFAULT 'idle',
  metadata_json JSON DEFAULT '{}',
  created_at    DATETIME,
  updated_at    DATETIME
);
CREATE INDEX IF NOT EXISTS ix_threads_meta_assistant_id ON threads_meta (assistant_id);
CREATE INDEX IF NOT EXISTS ix_threads_meta_user_id ON threads_meta (user_id);
`;
