/**
 * Schema bootstrap for Quill's application tables (``node:sqlite`` port).
 *
 * The Python original (``quill.persistence.bootstrap``) runs a hybrid
 * ``create_all`` + Alembic state machine to reconcile empty / legacy / versioned
 * databases. Alembic has no ``node:sqlite`` analogue, so this port keeps only
 * the part that is portable and idempotent: it issues ``CREATE TABLE IF NOT
 * EXISTS`` / ``CREATE INDEX IF NOT EXISTS`` for every Quill-owned table.
 *
 * Because every statement is guarded by ``IF NOT EXISTS`` and the table shapes
 * already include the ``token_usage_by_model`` column that the Python
 * ``0002_runs_token_usage`` revision added, running this against a fresh or an
 * up-to-date database is a no-op past the first call. Column-level migrations
 * of pre-existing databases (the Alembic ``safe_add_column`` path) are out of
 * scope for this port.
 */

import type { DatabaseSync } from "node:sqlite";

import { CHANNEL_CONNECTIONS_DDL } from "./channel_connections/model.js";
import { FEEDBACK_DDL } from "./feedback/model.js";
import { RUN_EVENTS_DDL } from "./models/run_event.js";
import { RUNS_DDL } from "./run/model.js";
import { TASKS_DDL } from "./task/model.js";
import { THREADS_META_DDL } from "./thread_meta/model.js";

/**
 * Every Quill-owned table's DDL, in dependency order (parents before the
 * ``channel_credentials`` / ``channel_conversations`` children that reference
 * ``channel_connections`` via ``ON DELETE CASCADE``).
 */
export const ALL_SCHEMA_DDL: readonly string[] = [
  THREADS_META_DDL,
  TASKS_DDL,
  RUNS_DDL,
  RUN_EVENTS_DDL,
  FEEDBACK_DDL,
  CHANNEL_CONNECTIONS_DDL,
];

/**
 * Bring the schema for *db* to head by creating any missing tables / indexes.
 *
 * Idempotent: safe to call on every startup and on an already-provisioned
 * database. Mirrors ``bootstrap_schema`` semantically (schema reaches head),
 * without the Alembic version tracking that has no TypeScript analogue.
 */
export function bootstrapSchema(db: DatabaseSync): void {
  for (const ddl of ALL_SCHEMA_DDL) {
    db.exec(ddl);
  }
}
