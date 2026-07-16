/**
 * SQLite-backed thread persistence for the Quill gateway.
 *
 * Uses Node's built-in `node:sqlite` (no native compilation) so threads, runs,
 * messages, feedback and uploads survive a gateway restart. Each thread is one
 * row (thread_id + JSON blob), upserted on mutation.
 *
 * The gateway keeps its in-memory Map as a fast cache and writes through to this
 * store; on startup it rehydrates the cache from `loadAll()`.
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export function createSqliteThreadStore(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      thread_id  TEXT PRIMARY KEY,
      updated_at TEXT,
      data       TEXT NOT NULL
    );
  `);

  const upsertStmt = db.prepare(
    `INSERT INTO threads (thread_id, updated_at, data) VALUES (?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data`,
  );
  const deleteStmt = db.prepare("DELETE FROM threads WHERE thread_id = ?");
  const allStmt = db.prepare("SELECT data FROM threads ORDER BY updated_at DESC");

  return {
    loadAll() {
      const rows = allStmt.all();
      const out = [];
      for (const row of rows) {
        try {
          out.push(JSON.parse(row.data));
        } catch {
          /* skip corrupt row */
        }
      }
      return out;
    },
    saveThread(threadId, data) {
      upsertStmt.run(
        threadId,
        data?.updated_at ?? new Date().toISOString(),
        JSON.stringify(data),
      );
    },
    deleteThread(threadId) {
      deleteStmt.run(threadId);
    },
    close() {
      db.close();
    },
  };
}
