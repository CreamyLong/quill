/**
 * SQLite-backed custom-agents store for the Quill gateway.
 *
 * Persists custom agents (config + SOUL.md content) so the frontend Agents
 * panel's list/get/create/update/delete flows work against the TypeScript
 * gateway. Mirrors the AgentResponse shape in `app/gateway/routers/agents.py`
 * (name, description, model, tool_groups, skills, soul).
 *
 * `tool_groups` and `skills` are nullable lists (null = "inherit all", [] =
 * "none"); they are stored as JSON text or SQL NULL to preserve that tri-state.
 *
 * Uses Node's built-in `node:sqlite` (no native compilation).
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

function nowIso() {
  return new Date().toISOString();
}

function parseList(raw) {
  if (raw === null || raw === undefined) return null;
  try {
    const val = JSON.parse(raw);
    return Array.isArray(val) ? val : null;
  } catch {
    return null;
  }
}

function serializeList(val) {
  return val === null || val === undefined ? null : JSON.stringify(val);
}

export function createAgentsStore(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      name        TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      model       TEXT,
      tool_groups TEXT,
      skills      TEXT,
      soul        TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL
    );
  `);

  const getStmt = db.prepare("SELECT * FROM agents WHERE name = ?");
  const allStmt = db.prepare("SELECT * FROM agents ORDER BY name");
  const upsertStmt = db.prepare(
    `INSERT INTO agents (name, description, model, tool_groups, skills, soul, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET description = excluded.description,
       model = excluded.model, tool_groups = excluded.tool_groups,
       skills = excluded.skills, soul = excluded.soul`,
  );
  const deleteStmt = db.prepare("DELETE FROM agents WHERE name = ?");

  function toRecord(row) {
    if (!row) return null;
    return {
      name: row.name,
      description: row.description ?? "",
      model: row.model ?? null,
      tool_groups: parseList(row.tool_groups),
      skills: parseList(row.skills),
      soul: row.soul ?? "",
    };
  }

  return {
    list() {
      return allStmt.all().map(toRecord);
    },
    get(name) {
      return toRecord(getStmt.get(name));
    },
    exists(name) {
      return getStmt.get(name) !== undefined;
    },
    /** Upsert an agent record (create or overwrite). */
    save(agent) {
      const existing = getStmt.get(agent.name);
      const createdAt = existing ? existing.created_at : nowIso();
      upsertStmt.run(
        agent.name,
        agent.description ?? "",
        agent.model ?? null,
        serializeList(agent.tool_groups),
        serializeList(agent.skills),
        agent.soul ?? "",
        createdAt,
      );
      return this.get(agent.name);
    },
    delete(name) {
      if (getStmt.get(name) === undefined) return false;
      deleteStmt.run(name);
      return true;
    },
    close() {
      db.close();
    },
  };
}
