/**
 * SQLite-backed skills store for the Quill gateway.
 *
 * Public skills are read (read-only) from the repo's `skills/public/` tree by
 * parsing each `SKILL.md` frontmatter; custom skills are authored/edited/
 * deleted through this store and persisted in SQLite together with an edit
 * history so the frontend Skills panel's custom-skill CRUD + rollback works.
 *
 * Mirrors the shapes in `app/gateway/routers/skills.py` (SkillResponse,
 * CustomSkillContentResponse, history entries). Enabled/disabled state is an
 * override table so it survives a restart for both public and custom skills.
 *
 * Uses Node built-ins only (`node:sqlite`, `node:fs`) — no native deps and no
 * YAML dependency (frontmatter values here are single-line `key: value`).
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

function nowIso() {
  return new Date().toISOString();
}

/** Parse the leading `--- ... ---` YAML frontmatter for name/description/license. */
function parseFrontmatter(content) {
  const out = { name: "", description: "", license: null };
  const text = String(content ?? "");
  if (!text.startsWith("---")) return out;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return out;
  const block = text.slice(3, end);
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key === "name") out.name = val;
    else if (key === "description") out.description = val;
    else if (key === "license") out.license = val || null;
  }
  return out;
}

export function createSkillsStore(dbPath, publicSkillsDir) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_skills (
      name        TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      license     TEXT,
      content     TEXT NOT NULL DEFAULT '',
      enabled     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skill_states (
      name    TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skill_history (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL,
      entry TEXT NOT NULL
    );
  `);

  // Resolve custom skills directory (sibling of public skills dir).
  const customSkillsDir = publicSkillsDir
    ? path.resolve(publicSkillsDir, "..", "custom")
    : null;

  const getCustomStmt = db.prepare("SELECT * FROM custom_skills WHERE name = ?");
  const allCustomStmt = db.prepare("SELECT * FROM custom_skills ORDER BY name");
  const upsertCustomStmt = db.prepare(
    `INSERT INTO custom_skills (name, description, license, content, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET description = excluded.description,
       license = excluded.license, content = excluded.content`,
  );
  const setCustomEnabledStmt = db.prepare("UPDATE custom_skills SET enabled = ? WHERE name = ?");
  const deleteCustomStmt = db.prepare("DELETE FROM custom_skills WHERE name = ?");
  const getStateStmt = db.prepare("SELECT enabled FROM skill_states WHERE name = ?");
  const upsertStateStmt = db.prepare(
    `INSERT INTO skill_states (name, enabled) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled`,
  );
  const appendHistoryStmt = db.prepare("INSERT INTO skill_history (name, entry) VALUES (?, ?)");
  const readHistoryStmt = db.prepare("SELECT entry FROM skill_history WHERE name = ? ORDER BY id");

  function stateEnabled(name, fallback) {
    const row = getStateStmt.get(name);
    if (!row) return fallback;
    return row.enabled !== 0;
  }

  /** Recursively walk a directory tree and yield SKILL.md paths. */
  function walkForSkillMd(rootDir) {
    const results = [];
    let entries;
    try {
      entries = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch {
      return results;
    }
    // Check if this directory itself contains a SKILL.md.
    const skillMd = path.join(rootDir, "SKILL.md");
    if (fs.existsSync(skillMd) && !fs.statSync(skillMd).isDirectory()) {
      results.push(skillMd);
    }
    // Recurse into subdirectories (skip hidden).
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (!entry.isDirectory()) continue;
      // Skip the "references" and "scripts" directories common in skill dirs.
      if (entry.name === "references" || entry.name === "scripts" || entry.name === "assets" || entry.name === "tests") continue;
      results.push(...walkForSkillMd(path.join(rootDir, entry.name)));
    }
    return results;
  }

  function skillsFromDir(dir, category) {
    if (!dir || !fs.existsSync(dir)) return [];
    const out = [];
    for (const skillMd of walkForSkillMd(dir)) {
      let meta;
      try {
        meta = parseFrontmatter(fs.readFileSync(skillMd, "utf-8"));
      } catch {
        continue;
      }
      const dirName = path.basename(path.dirname(skillMd));
      const name = meta.name || dirName;
      out.push({
        name,
        description: meta.description ?? "",
        license: meta.license ?? null,
        category,
        enabled: stateEnabled(name, true),
      });
    }
    return out;
  }

  function publicSkills() {
    return skillsFromDir(publicSkillsDir, "public");
  }

  /** Read custom skills from the filesystem (skills/custom/ tree). */
  function filesystemCustomSkills() {
    return skillsFromDir(customSkillsDir, "custom");
  }

  function dbCustomSkills() {
    return allCustomStmt.all().map((row) => ({
      name: row.name,
      description: row.description ?? "",
      license: row.license ?? null,
      category: "custom",
      enabled: row.enabled !== 0,
    }));
  }

  function customSkills() {
    // Merge filesystem custom skills with DB-stored custom skills.
    // DB skills (created via the UI) take precedence over filesystem skills
    // with the same name, since they are user-authored overrides.
    const fsSkills = filesystemCustomSkills();
    const dbSkills = dbCustomSkills();
    const dbNames = new Set(dbSkills.map((s) => s.name));
    return [...fsSkills.filter((s) => !dbNames.has(s.name)), ...dbSkills];
  }

  function appendHistory(name, entry) {
    appendHistoryStmt.run(name, JSON.stringify({ ts: nowIso(), ...entry }));
  }

  function customContent(name) {
    const row = getCustomStmt.get(name);
    if (!row) return null;
    return {
      name: row.name,
      description: row.description ?? "",
      license: row.license ?? null,
      category: "custom",
      enabled: row.enabled !== 0,
      content: row.content ?? "",
    };
  }

  return {
    list() {
      return [...publicSkills(), ...customSkills()];
    },
    get(name) {
      return this.list().find((s) => s.name === name) ?? null;
    },
    listCustom() {
      return customSkills();
    },
    getCustom(name) {
      return customContent(name);
    },
    setEnabled(name, enabled) {
      const existing = this.get(name);
      if (!existing) return null;
      if (existing.category === "custom") {
        setCustomEnabledStmt.run(enabled ? 1 : 0, name);
      } else {
        upsertStateStmt.run(name, enabled ? 1 : 0);
      }
      return this.get(name);
    },
    /** Create-or-edit a custom skill from raw SKILL.md content (records history). */
    saveCustom(name, content) {
      const text = String(content ?? "");
      const meta = parseFrontmatter(text);
      const existing = getCustomStmt.get(name);
      const prevContent = existing ? existing.content : null;
      const enabled = existing ? existing.enabled : 1;
      const createdAt = existing ? existing.created_at : nowIso();
      upsertCustomStmt.run(name, meta.description ?? "", meta.license ?? null, text, enabled, createdAt);
      appendHistory(name, {
        action: existing ? "human_edit" : "human_create",
        author: "human",
        thread_id: null,
        file_path: "SKILL.md",
        prev_content: prevContent,
        new_content: text,
        scanner: { decision: "allow", reason: "No scanner configured for the TS gateway." },
      });
      return customContent(name);
    },
    deleteCustom(name) {
      const existing = getCustomStmt.get(name);
      if (!existing) return false;
      deleteCustomStmt.run(name);
      appendHistory(name, {
        action: "human_delete",
        author: "human",
        thread_id: null,
        file_path: "SKILL.md",
        prev_content: existing.content,
        new_content: null,
        scanner: { decision: "allow", reason: "Deletion requested." },
      });
      return true;
    },
    history(name) {
      return readHistoryStmt.all(name).map((row) => {
        try {
          return JSON.parse(row.entry);
        } catch {
          return {};
        }
      });
    },
    hasHistory(name) {
      return readHistoryStmt.all(name).length > 0;
    },
    rollback(name, historyIndex) {
      const history = this.history(name);
      if (history.length === 0) {
        const err = new Error(`Custom skill '${name}' has no history`);
        err.code = "no_history";
        throw err;
      }
      const idx = historyIndex < 0 ? history.length + historyIndex : historyIndex;
      const record = history[idx];
      if (!record) {
        const err = new Error("history_index is out of range");
        err.code = "out_of_range";
        throw err;
      }
      const target = record.prev_content;
      if (target === null || target === undefined) {
        const err = new Error("Selected history entry has no previous content to roll back to");
        err.code = "no_prev";
        throw err;
      }
      const existing = getCustomStmt.get(name);
      const prevContent = existing ? existing.content : null;
      const meta = parseFrontmatter(target);
      const enabled = existing ? existing.enabled : 1;
      const createdAt = existing ? existing.created_at : nowIso();
      upsertCustomStmt.run(name, meta.description ?? "", meta.license ?? null, target, enabled, createdAt);
      appendHistory(name, {
        action: "rollback",
        author: "human",
        thread_id: null,
        file_path: "SKILL.md",
        prev_content: prevContent,
        new_content: target,
        rollback_from_ts: record.ts ?? null,
        scanner: { decision: "allow", reason: "No scanner configured for the TS gateway." },
      });
      return customContent(name);
    },
    close() {
      db.close();
    },
  };
}
