/**
 * Table model for the ``users`` table.
 *
 * Ports ``quill.persistence.user.model``. The Python ORM class is
 * represented here as the row data shape plus its ``CREATE TABLE`` DDL. The row
 * lives in the harness persistence package so it is created alongside
 * ``threads_meta``, ``runs``, ``run_events``, and ``feedback`` by one schema
 * bootstrap over a single database.
 */

/** Row shape of the ``users`` table. */
export interface UserRow {
  /** UUIDs are stored as 36-char strings for cross-backend portability. */
  id: string;
  email: string;
  password_hash: string | null;
  /** "admin" | "user" — plain string to avoid ALTER TABLE pain on new roles. */
  system_role: string;
  created_at: string;
  // OAuth linkage (optional).
  oauth_provider: string | null;
  oauth_id: string | null;
  // Auth lifecycle flags.
  needs_setup: boolean;
  token_version: number;
}

export const USERS_TABLE = "users";

export const USERS_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id             VARCHAR(36) PRIMARY KEY,
  email          VARCHAR(320) NOT NULL UNIQUE,
  password_hash  VARCHAR(128),
  system_role    VARCHAR(16) NOT NULL DEFAULT 'user',
  created_at     DATETIME NOT NULL,
  oauth_provider VARCHAR(32),
  oauth_id       VARCHAR(128),
  needs_setup    BOOLEAN NOT NULL DEFAULT 0,
  token_version  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_users_email ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth_identity
  ON users (oauth_provider, oauth_id)
  WHERE oauth_provider IS NOT NULL AND oauth_id IS NOT NULL;
`;
