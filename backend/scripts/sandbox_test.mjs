/**
 * Unit test for the ported LocalSandbox (host-filesystem backend).
 *
 * Exercises the round-trip file API, directory listing, glob, grep, str_replace,
 * shell execution, and — critically — the path-traversal / workspace-escape
 * guard. Prints ✓ lines and exits non-zero on the first failure.
 *
 * Run: cd backend && npm run build && node --experimental-vm-modules scripts/sandbox_test.mjs
 */

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { LocalSandbox } from "../dist/packages/harness/quill/sandbox/local_sandbox.js";

function ok(msg) {
  console.log(`\u2713 ${msg}`);
}

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "quill-sandbox-"));
  const sandbox = new LocalSandbox(workspace);

  try {
    // --- writeFile -> readFile round-trip ---
    sandbox.writeFile("/mnt/user-data/notes.txt", "hello");
    const readBack = sandbox.readFile("/mnt/user-data/notes.txt");
    assert.strictEqual(readBack, "hello", `round-trip mismatch: ${JSON.stringify(readBack)}`);
    assert.ok(
      fs.existsSync(path.join(workspace, "notes.txt")),
      "notes.txt not created on host under workspace",
    );
    ok("writeFile -> readFile round-trip returns 'hello'");

    // --- readFile with offset/limit ---
    sandbox.writeFile("/mnt/user-data/lines.txt", "l1\nl2\nl3\nl4");
    const slice = sandbox.readFile("/mnt/user-data/lines.txt", { offset: 2, limit: 2 });
    assert.strictEqual(slice, "l2\nl3", `offset/limit slice mismatch: ${JSON.stringify(slice)}`);
    ok("readFile({offset,limit}) returns the requested line range");

    // --- nested write for glob/grep/listDir ---
    sandbox.writeFile("/mnt/user-data/sub/app.py", "print('hello world')\nx = 1\n");

    // --- listDir ---
    const listing = sandbox.listDir("/mnt/user-data");
    assert.ok(
      listing.some((e) => e === "/mnt/user-data/notes.txt"),
      `listDir missing notes.txt: ${JSON.stringify(listing)}`,
    );
    assert.ok(
      listing.some((e) => e === "/mnt/user-data/sub/"),
      `listDir missing sub/ dir marker: ${JSON.stringify(listing)}`,
    );
    assert.ok(
      listing.some((e) => e === "/mnt/user-data/sub/app.py"),
      `listDir missing nested app.py: ${JSON.stringify(listing)}`,
    );
    ok("listDir returns virtual paths with dir markers, up to depth 2");

    // --- glob ---
    const globbed = sandbox.glob("/mnt/user-data", "**/*.py");
    assert.deepStrictEqual(globbed.paths, ["/mnt/user-data/sub/app.py"], `glob mismatch: ${JSON.stringify(globbed)}`);
    assert.strictEqual(globbed.truncated, false, "glob should not be truncated");
    ok("glob('**/*.py') finds the nested python file");

    // --- grep ---
    const grepped = sandbox.grep("hello", "/mnt/user-data");
    assert.ok(grepped.matches.length >= 2, `grep expected >=2 matches, got ${grepped.matches.length}`);
    const grepPaths = new Set(grepped.matches.map((m) => m.path));
    assert.ok(grepPaths.has("/mnt/user-data/notes.txt"), "grep missing notes.txt hit");
    assert.ok(grepPaths.has("/mnt/user-data/sub/app.py"), "grep missing app.py hit");
    for (const m of grepped.matches) {
      assert.ok(m.path.startsWith("/mnt/user-data/"), `grep leaked host path: ${m.path}`);
    }
    ok("grep('hello') matches both files and returns virtual paths + line numbers");

    // --- grep with glob filter ---
    const greppedPy = sandbox.grep("hello", "/mnt/user-data", { glob: "**/*.py" });
    assert.deepStrictEqual(
      greppedPy.matches.map((m) => m.path),
      ["/mnt/user-data/sub/app.py"],
      `grep glob-filter mismatch: ${JSON.stringify(greppedPy)}`,
    );
    ok("grep with glob filter restricts to matching files");

    // --- strReplace ---
    const outcome = sandbox.strReplace("/mnt/user-data/notes.txt", "hello", "world");
    assert.strictEqual(outcome, "ok", `strReplace outcome: ${outcome}`);
    assert.strictEqual(sandbox.readFile("/mnt/user-data/notes.txt"), "world", "strReplace did not apply");
    const missing = sandbox.strReplace("/mnt/user-data/notes.txt", "nope", "x");
    assert.strictEqual(missing, "not_found", `strReplace missing-substring outcome: ${missing}`);
    ok("strReplace replaces text and reports not_found for absent substrings");

    // --- executeCommand ---
    const echo = await sandbox.executeCommand("echo hi");
    assert.ok(echo.includes("hi"), `executeCommand('echo hi') output: ${JSON.stringify(echo)}`);
    ok("executeCommand('echo hi') returns 'hi'");

    // executeCommand runs in the workspace cwd and reverse-resolves host paths.
    const pwdOut = await sandbox.executeCommand("pwd");
    assert.ok(
      pwdOut.includes("/mnt/user-data"),
      `executeCommand('pwd') should reverse-resolve to /mnt/user-data, got: ${JSON.stringify(pwdOut)}`,
    );
    ok("executeCommand cwd is the workspace (pwd reverse-resolves to /mnt/user-data)");

    // --- traversal / escape guards MUST throw ---
    const denials = [
      ["/mnt/user-data/../../etc/passwd", "readFile", () => sandbox.readFile("/mnt/user-data/../../etc/passwd")],
      ["../escape.txt", "readFile relative escape", () => sandbox.readFile("../escape.txt")],
      ["/etc/passwd", "readFile absolute-outside", () => sandbox.readFile("/etc/passwd")],
      ["/mnt/user-data/../secret", "writeFile traversal", () => sandbox.writeFile("/mnt/user-data/../secret", "x")],
      ["/mnt/user-data/../../tmp", "listDir traversal", () => sandbox.listDir("/mnt/user-data/../../tmp")],
    ];
    for (const [p, label, fn] of denials) {
      let threw = false;
      try {
        fn();
      } catch (err) {
        threw = true;
        assert.ok(
          err && err.name && err.name.includes("Permission"),
          `${label} threw wrong error type: ${err && err.name}`,
        );
      }
      assert.ok(threw, `${label} did NOT throw for path ${p}`);
    }
    ok("path traversal / workspace-escape attempts are denied (5 cases)");

    // Confirm nothing escaped onto the real filesystem.
    assert.ok(!fs.existsSync(path.join(workspace, "..", "secret")), "escape write leaked outside workspace");

    console.log("\nAll sandbox tests passed.");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\u2717 ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
