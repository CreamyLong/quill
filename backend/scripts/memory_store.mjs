/**
 * SQLite-backed global memory store for the Quill gateway.
 *
 * Mirrors the Python `quill.agents.memory.updater` semantics (empty-memory
 * shape, `fact_<8hex>` ids, manual `source`, confidence validation) so the
 * frontend Memory panel behaves the same against the TypeScript gateway.
 *
 * Uses Node's built-in `node:sqlite` (no native compilation). The whole memory
 * document is a single JSON blob keyed by user; this gateway runs single-user
 * (no-auth) so a fixed key is used, matching the Gateway's other stores.
 */

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const USER_KEY = "default";

function nowIso() {
  return new Date().toISOString();
}

/** Empty memory document — matches Python `create_empty_memory()`. */
function emptyMemory() {
  const blank = () => ({ summary: "", updatedAt: "" });
  return {
    version: "1.0",
    lastUpdated: nowIso(),
    user: { workContext: blank(), personalContext: blank(), topOfMind: blank() },
    history: {
      recentMonths: blank(),
      earlierContext: blank(),
      longTermBackground: blank(),
    },
    facts: [],
  };
}

function factId() {
  return `fact_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/** Throw a coded error the gateway maps to a 400 unless confidence is valid. */
function validateConfidence(confidence) {
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    const err = new Error("Invalid confidence value; must be between 0 and 1.");
    err.code = "confidence";
    throw err;
  }
  return confidence;
}

export function createMemoryStore(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      user_id TEXT PRIMARY KEY,
      data    TEXT NOT NULL
    );
  `);

  const readStmt = db.prepare("SELECT data FROM memory WHERE user_id = ?");
  const writeStmt = db.prepare(
    `INSERT INTO memory (user_id, data) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data`,
  );

  function read() {
    const row = readStmt.get(USER_KEY);
    if (!row) return emptyMemory();
    try {
      return { ...emptyMemory(), ...JSON.parse(row.data) };
    } catch {
      return emptyMemory();
    }
  }
  function write(mem) {
    const data = { ...mem, lastUpdated: nowIso() };
    writeStmt.run(USER_KEY, JSON.stringify(data));
    return data;
  }

  return {
    get() {
      return read();
    },
    clear() {
      return write(emptyMemory());
    },
    import(data) {
      // Fill any missing top-level sections from the empty shape so the
      // frontend always receives a well-formed document.
      return write({ ...emptyMemory(), ...(data ?? {}) });
    },
    createFact({ content, category = "context", confidence = 0.5 } = {}) {
      const normalized = String(content ?? "").trim();
      if (!normalized) {
        const err = new Error("Memory fact content cannot be empty.");
        err.code = "content";
        throw err;
      }
      const cat = String(category ?? "").trim() || "context";
      const conf = validateConfidence(confidence);
      const mem = read();
      const facts = Array.isArray(mem.facts) ? [...mem.facts] : [];
      facts.push({
        id: factId(),
        content: normalized,
        category: cat,
        confidence: conf,
        createdAt: nowIso(),
        source: "manual",
      });
      return write({ ...mem, facts });
    },
    updateFact(id, { content, category, confidence } = {}) {
      const mem = read();
      const facts = Array.isArray(mem.facts) ? mem.facts : [];
      let found = false;
      const updated = facts.map((fact) => {
        if (fact.id !== id) return fact;
        found = true;
        const next = { ...fact };
        if (content !== undefined && content !== null) {
          const nc = String(content).trim();
          if (!nc) {
            const err = new Error("Memory fact content cannot be empty.");
            err.code = "content";
            throw err;
          }
          next.content = nc;
        }
        if (category !== undefined && category !== null) {
          next.category = String(category).trim() || "context";
        }
        if (confidence !== undefined && confidence !== null) {
          next.confidence = validateConfidence(confidence);
        }
        return next;
      });
      if (!found) {
        const err = new Error(`Memory fact '${id}' not found.`);
        err.code = "not_found";
        throw err;
      }
      return write({ ...mem, facts: updated });
    },
    deleteFact(id) {
      const mem = read();
      const facts = Array.isArray(mem.facts) ? mem.facts : [];
      const updated = facts.filter((fact) => fact.id !== id);
      if (updated.length === facts.length) {
        const err = new Error(`Memory fact '${id}' not found.`);
        err.code = "not_found";
        throw err;
      }
      return write({ ...mem, facts: updated });
    },
    // Harness-compatible MemoryStorage interface so the agent's MemoryMiddleware
    // writes to the same SQLite-backed document that the Memory panel reads.
    load(_agentName, _userId) {
      return read();
    },
    save(memoryData, _agentName, _userId) {
      try {
        write({ ...emptyMemory(), ...(memoryData ?? {}) });
        return true;
      } catch (err) {
        console.error("Failed to save memory:", err);
        return false;
      }
    },
    close() {
      db.close();
    },
  };
}
