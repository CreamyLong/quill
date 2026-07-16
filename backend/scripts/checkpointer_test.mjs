/**
 * Test the ported runtime checkpointer.
 *
 * Run: cd backend && npm run build && node --experimental-vm-modules scripts/checkpointer_test.mjs
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeCheckpointer } from "../dist/packages/harness/quill/runtime/checkpointer/index.js";

const tmpDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".scitops-test");
const dbPath = path.join(tmpDir, "checkpoints-test.db");

async function main() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const appConfig = {
    checkpointer: { type: "sqlite", connection_string: dbPath },
    database: null,
    models: [],
  };

  const { checkpointer, close } = await makeCheckpointer(appConfig);
  assert.strictEqual(checkpointer.constructor.name, "SqliteCheckpointSaver", "expected SqliteCheckpointSaver");

  // put / get round-trip
  const putConfig = { configurable: { thread_id: "t1" } };
  const checkpoint = { id: "cp1", ts: "2024-01-01T00:00:00Z", channel_values: {}, channel_versions: {} };
  const meta = { source: "test" };
  const saved = await checkpointer.put(putConfig, checkpoint, meta, {});
  assert.strictEqual(saved.configurable?.checkpoint_id, "cp1");

  const retrieved = await checkpointer.getTuple({ configurable: { thread_id: "t1" } });
  assert.ok(retrieved, "expected to retrieve checkpoint");
  assert.strictEqual(retrieved.checkpoint.id, "cp1");
  assert.strictEqual(retrieved.metadata.source, "test");

  // deleteThread
  await checkpointer.deleteThread("t1");
  const afterDelete = await checkpointer.getTuple({ configurable: { thread_id: "t1" } });
  assert.strictEqual(afterDelete, undefined, "expected checkpoint deleted");

  await close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log("✓ SqliteCheckpointSaver put/get/delete round-trip works");
  console.log("\nCheckpointer test passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
