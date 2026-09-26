/**
 * Tests for GitCheckpointService (ZCode sync).
 *
 * Uses real git on temp workspaces: snapshot → mutate → rewind (file & all),
 * plus checkpoint listing and cleanup.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GitCheckpointService } from "../checkpoints.js";

const hasGit = await import("node:child_process")
  .then(({ execFile }) =>
    new Promise<boolean>((resolve) => {
      execFile("git", ["--version"], (err) => resolve(!err));
    }),
  )
  .catch(() => false);

const run = describe.skipIf(!hasGit)("GitCheckpointService", () => {
  let workspace: string;
  let service: GitCheckpointService;
  const dirs: string[] = [];

  beforeAll(() => {
    workspace = mkdtempSync(path.join(os.tmpdir(), "quill-cp-"));
    dirs.push(workspace);
    service = new GitCheckpointService();
  });

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  it("creates a checkpoint capturing workspace files", async () => {
    writeFileSync(path.join(workspace, "README.md"), "# v1\n");
    mkdirSync(path.join(workspace, "src"));
    writeFileSync(path.join(workspace, "src", "app.ts"), "export const v = 1;\n");

    const cp = await service.createCheckpoint(workspace, { label: "initial" });
    expect(cp.id).toMatch(/^cp_/);
    expect(cp.label).toBe("initial");
    expect(cp.fileCount).toBe(2);
    expect(cp.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("rewinds a single modified file to the checkpoint state", async () => {
    const [cp] = await service.listCheckpoints(workspace);
    writeFileSync(path.join(workspace, "src", "app.ts"), "export const v = 999;\n");

    const result = await service.rewindFile(workspace, cp.id, "src/app.ts");
    expect(result.restored).toBe(true);
    expect(readFileSync(path.join(workspace, "src", "app.ts"), "utf8")).toBe(
      "export const v = 1;\n",
    );
  });

  it("removes files created after the checkpoint when rewinding them", async () => {
    const [cp] = await service.listCheckpoints(workspace);
    writeFileSync(path.join(workspace, "src", "new-file.ts"), "late addition\n");

    await service.rewindFile(workspace, cp.id, "src/new-file.ts");
    expect(existsSync(path.join(workspace, "src", "new-file.ts"))).toBe(false);
  });

  it("reads file content at a checkpoint without restoring", async () => {
    const [cp] = await service.listCheckpoints(workspace);
    writeFileSync(path.join(workspace, "README.md"), "# changed\n");

    const content = await service.readFileAt(workspace, cp.id, "README.md");
    expect(content).toBe("# v1\n");
    // Worktree untouched.
    expect(readFileSync(path.join(workspace, "README.md"), "utf8")).toBe("# changed\n");
  });

  it("rewinds the whole workspace (modified + created files)", async () => {
    const [cp] = await service.listCheckpoints(workspace);
    writeFileSync(path.join(workspace, "README.md"), "# totally different\n");
    writeFileSync(path.join(workspace, "extra.txt"), "extra\n");

    await service.rewindAll(workspace, cp.id);
    expect(readFileSync(path.join(workspace, "README.md"), "utf8")).toBe("# v1\n");
    expect(existsSync(path.join(workspace, "extra.txt"))).toBe(false);
  });

  it("lists checkpoints newest-first with labels", async () => {
    writeFileSync(path.join(workspace, "README.md"), "# v2\n");
    await service.createCheckpoint(workspace, { label: "second" });

    const list = await service.listCheckpoints(workspace);
    expect(list).toHaveLength(2);
    expect(list[0].label).toBe("second");
    expect(list[1].label).toBe("initial");
  });

  it("ignores .git, node_modules and .quill by default", async () => {
    mkdirSync(path.join(workspace, "node_modules"), { recursive: true });
    writeFileSync(path.join(workspace, "node_modules", "pkg.js"), "junk");
    mkdirSync(path.join(workspace, ".git"), { recursive: true });
    writeFileSync(path.join(workspace, ".git", "config"), "junk");

    const cp = await service.createCheckpoint(workspace, { label: "filtered" });
    expect(cp.fileCount).toBe(2); // README.md + src/app.ts only
  });

  it("throws on unknown checkpoint ids and invalid paths", async () => {
    await expect(service.rewindFile(workspace, "cp_nope", "README.md")).rejects.toThrow(
      /Unknown checkpoint/,
    );
    await expect(service.readFileAt(workspace, "cp_nope", "../escape.ts")).rejects.toThrow();
  });

  it("clear removes the hidden repository", async () => {
    await service.clear(workspace);
    expect(await service.listCheckpoints(workspace)).toEqual([]);
  });
});

void run;
