/**
 * Test script for LocalSandboxProvider workspace_directory override.
 *
 * Run: node --experimental-vm-modules scripts/local_provider_workspace_override_test.mjs
 *
 * Tests:
 *   1. Default workspace when no override is registered
 *   2. Custom directory when override resolver returns an absolute path
 *   3. Throws on relative path override
 *   4. Throws on file (non-directory) override
 *   5. Creates directory if it does not exist
 *   6. Caches sandbox per thread (same instance returned)
 *   7. Different threads get different sandboxes
 *   8. Override resolver returning undefined falls back to default
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { LocalSandboxProvider } from "../dist/packages/harness/quill/sandbox/local/provider.js";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertThrows(fn, message) {
  try {
    fn();
    failed++;
    console.error(`  ✗ ${message} (did not throw)`);
  } catch {
    passed++;
    console.log(`  ✓ ${message}`);
  }
}

// Temp dirs for testing
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "quill-ws-test-"));
const customDir = path.join(tmpBase, "custom-workspace");
const anotherDir = path.join(tmpBase, "another-workspace");
const filePath = path.join(tmpBase, "not-a-dir.txt");
fs.writeFileSync(filePath, "I am a file, not a directory");

try {
  // --- Test 1: Default workspace when no override ---
  console.log("\nTest 1: Default workspace (no override)");
  {
    const provider = new LocalSandboxProvider(tmpBase);
    const sandbox = provider.acquire("thread-default");
    assert(
      sandbox.workspaceDir.includes("thread-default"),
      `workspace includes thread id: ${sandbox.workspaceDir}`,
    );
    assert(
      sandbox.workspaceDir.includes("user-data"),
      `workspace includes user-data: ${sandbox.workspaceDir}`,
    );
  }

  // --- Test 2: Custom directory override ---
  console.log("\nTest 2: Custom directory override");
  {
    const provider = new LocalSandboxProvider(tmpBase);
    provider.setWorkspaceOverrideResolver(() => customDir);
    const sandbox = provider.acquire("thread-custom");
    assert(
      sandbox.workspaceDir === path.resolve(customDir),
      `workspace is custom dir: ${sandbox.workspaceDir}`,
    );
  }

  // --- Test 3: Throws on relative path ---
  console.log("\nTest 3: Throws on relative path");
  {
    const provider = new LocalSandboxProvider(tmpBase);
    provider.setWorkspaceOverrideResolver(() => "relative/path");
    assertThrows(
      () => provider.acquire("thread-relative"),
      "relative path throws",
    );
  }

  // --- Test 4: Throws on file (non-directory) ---
  console.log("\nTest 4: Throws on file (non-directory)");
  {
    const provider = new LocalSandboxProvider(tmpBase);
    provider.setWorkspaceOverrideResolver(() => filePath);
    assertThrows(
      () => provider.acquire("thread-file"),
      "file path throws",
    );
  }

  // --- Test 5: Creates directory if it does not exist ---
  console.log("\nTest 5: Creates directory if it does not exist");
  {
    const nonExistent = path.join(tmpBase, "does-not-exist-yet");
    const provider = new LocalSandboxProvider(tmpBase);
    provider.setWorkspaceOverrideResolver(() => nonExistent);
    const sandbox = provider.acquire("thread-create");
    assert(
      fs.existsSync(nonExistent),
      "directory was created",
    );
    assert(
      sandbox.workspaceDir === path.resolve(nonExistent),
      `workspace is the created dir: ${sandbox.workspaceDir}`,
    );
  }

  // --- Test 6: Caches sandbox per thread ---
  console.log("\nTest 6: Caches sandbox per thread");
  {
    const provider = new LocalSandboxProvider(tmpBase);
    provider.setWorkspaceOverrideResolver(() => customDir);
    const sb1 = provider.acquire("thread-cache");
    const sb2 = provider.acquire("thread-cache");
    assert(sb1 === sb2, "same thread returns cached sandbox");
  }

  // --- Test 7: Different threads get different sandboxes ---
  console.log("\nTest 7: Different threads get different sandboxes");
  {
    const provider = new LocalSandboxProvider(tmpBase);
    provider.setWorkspaceOverrideResolver((tid) =>
      tid === "t-a" ? customDir : anotherDir,
    );
    const sbA = provider.acquire("t-a");
    const sbB = provider.acquire("t-b");
    assert(sbA !== sbB, "different threads get different sandboxes");
    assert(
      sbA.workspaceDir === path.resolve(customDir),
      "t-a uses customDir",
    );
    assert(
      sbB.workspaceDir === path.resolve(anotherDir),
      "t-b uses anotherDir",
    );
  }

  // --- Test 8: Override returning undefined falls back to default ---
  console.log("\nTest 8: Override returning undefined falls back to default");
  {
    const provider = new LocalSandboxProvider(tmpBase);
    provider.setWorkspaceOverrideResolver(() => undefined);
    const sandbox = provider.acquire("thread-fallback");
    assert(
      sandbox.workspaceDir.includes("thread-fallback"),
      `falls back to default: ${sandbox.workspaceDir}`,
    );
  }

  // --- Test 9: Empty string override falls back to default ---
  console.log("\nTest 9: Empty string override falls back to default");
  {
    const provider = new LocalSandboxProvider(tmpBase);
    provider.setWorkspaceOverrideResolver(() => "");
    const sandbox = provider.acquire("thread-empty");
    assert(
      sandbox.workspaceDir.includes("thread-empty"),
      `empty string falls back to default: ${sandbox.workspaceDir}`,
    );
  }

  // --- Summary ---
  console.log(`\n${"=".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(40)}`);

  if (failed > 0) {
    process.exit(1);
  }
} finally {
  // Clean up temp dirs
  fs.rmSync(tmpBase, { recursive: true, force: true });
}
