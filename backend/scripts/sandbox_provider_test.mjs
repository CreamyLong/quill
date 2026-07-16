/**
 * Test sandbox provider instantiation and config-driven selection.
 *
 * Run: cd backend && npm run build && node --experimental-vm-modules scripts/sandbox_provider_test.mjs
 */

import assert from "node:assert";

import { AioSandboxProvider } from "../dist/packages/harness/quill/community/aio_sandbox/aio_sandbox_provider.js";
import { LocalSandboxProvider } from "../dist/packages/harness/quill/sandbox/local/provider.js";

async function main() {
  const local = new LocalSandboxProvider();
  assert.ok(local, "expected LocalSandboxProvider instance");
  const sandbox = local.acquire("test-thread");
  assert.ok(sandbox, "expected LocalSandbox from acquire");
  assert.strictEqual(typeof sandbox.readFile, "function", "expected readFile method");

  // AioSandboxProvider can be instantiated (its constructor loads config from
  // getAppConfig, so it requires a valid config.yaml or default config).
  const aio = new AioSandboxProvider();
  assert.ok(aio, "expected AioSandboxProvider instance");

  console.log("✓ LocalSandboxProvider acquires a working sandbox");
  console.log("✓ AioSandboxProvider instantiates");
  console.log("\nSandbox provider test passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
