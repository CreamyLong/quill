/**
 * Test persistence ORM schema initialization.
 *
 * Run: cd backend && npm run build && node --experimental-vm-modules scripts/persistence_test.mjs
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initEngineFromConfig, getDatabase } from "../dist/packages/harness/quill/persistence/engine.js";

const tmpDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".scitops-test");
const dbPath = path.join(tmpDir, "quill-test.db");

async function main() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  initEngineFromConfig({ backend: "sqlite", sqlite_path: dbPath });
  const db = getDatabase();
  assert.ok(db, "expected database handle");

  const expectedTables = [
    "users",
    "threads_meta",
    "runs",
    "run_events",
    "feedback",
    "channel_connections",
    "channel_credentials",
    "channel_conversations",
  ];
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name)
    .filter(Boolean);

  for (const t of expectedTables) {
    assert.ok(tables.includes(t), `expected table '${t}' to exist`);
  }

  console.log(`✓ persistence ORM tables created: ${expectedTables.join(", ")}`);
  console.log("\nPersistence ORM test passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
