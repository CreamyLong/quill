import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LocalSandboxProvider } from "../local/provider.ts";
import { LocalSandbox } from "../local_sandbox.ts";

/**
 * End-to-end验证: 前端选择 workspace_directory → 后端存储到 thread metadata →
 * sandbox override resolver 返回该路径 → LocalSandbox 在该目录工作。
 */
describe("workspace_directory override end-to-end", () => {
  let tmpRoot: string;
  let provider: LocalSandboxProvider;
  let customWorkspace: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), "quill-ws-"));
    customWorkspace = path.join(tmpRoot, "my-project");
    // Simulate the custom workspace existing on disk (user-selected folder).
    provider = new LocalSandboxProvider(undefined, undefined);
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("override resolver returns the custom workspace for a thread", () => {
    // Simulates the gateway wiring:
    //   sandboxProvider.setWorkspaceOverrideResolver((threadId) => {
    //     const meta = getThreadMetadata(threadId);
    //     return meta?.workspace_directory;
    //   });
    provider.setWorkspaceOverrideResolver((threadId) => {
      if (threadId === "thread-with-custom-ws") {
        return customWorkspace;
      }
      return undefined;
    });

    const sandbox = provider.acquire("thread-with-custom-ws");
    expect(sandbox).toBeInstanceOf(LocalSandbox);
    expect(sandbox.workspaceDir).toBe(customWorkspace);
  });

  it("agent file operations land in the custom workspace", () => {
    const sandbox = provider.acquire("thread-with-custom-ws");
    // Simulate the agent writing a file via the write_file tool.
    sandbox.writeFile("/mnt/user-data/hello.txt", "Hello from custom workspace!");
    const hostFile = path.join(customWorkspace, "hello.txt");
    expect(existsSync(hostFile)).toBe(true);
    expect(readFileSync(hostFile, "utf-8")).toBe("Hello from custom workspace!");
  });

  it("agent reads files from the custom workspace", () => {
    const sandbox = provider.acquire("thread-with-custom-ws");
    // Pre-create a file in the host workspace (simulating an existing project file).
    const existingFile = path.join(customWorkspace, "existing.md");
    writeFileSync(existingFile, "# Existing Project\n");
    const content = sandbox.readFile("/mnt/user-data/existing.md");
    expect(content).toContain("# Existing Project");
  });

  it("bash commands run with cwd = custom workspace", async () => {
    const sandbox = provider.acquire("thread-with-custom-ws");
    const output = await sandbox.executeCommand("pwd");
    // The output is reverse-resolved to virtual path, but the real cwd is the
    // custom workspace. Verify by creating a file via bash and reading it back.
    await sandbox.executeCommand('echo "bash-was-here" > bash_created.txt');
    const hostFile = path.join(customWorkspace, "bash_created.txt");
    expect(existsSync(hostFile)).toBe(true);
    expect(readFileSync(hostFile, "utf-8").trim()).toBe("bash-was-here");
  });

  it("threads without an override use the default per-thread workspace", () => {
    const sandbox = provider.acquire("thread-no-override");
    expect(sandbox.workspaceDir).not.toBe(customWorkspace);
    // Default workspace should still work for file ops.
    sandbox.writeFile("/mnt/user-data/default.txt", "default");
    expect(sandbox.readFile("/mnt/user-data/default.txt")).toBe("default");
  });

  it("ls lists files in the custom workspace", () => {
    const sandbox = provider.acquire("thread-with-custom-ws");
    // Write a couple files we know exist from prior tests.
    const entries = sandbox.listDir("/mnt/user-data", 1);
    // Entries are virtual paths under /mnt/user-data/.
    expect(entries.some((e) => e.includes("hello.txt"))).toBe(true);
    expect(entries.some((e) => e.includes("existing.md"))).toBe(true);
  });
});
