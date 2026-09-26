/**
 * Git Checkpoints & Rewind — workspace snapshots with per-file restore.
 *
 * Ported from ZCode's gitCheckpointService: before risky edits the agent (or
 * the user) creates a checkpoint of the workspace; afterwards any file can be
 * rewound to that snapshot, or the whole workspace restored. Checkpoints live
 * in a hidden git repository (`.quill/checkpoints.git`) inside the workspace,
 * so the user's own git history is never touched.
 *
 * This module provides:
 * - GitCheckpointService: create/list checkpoints, rewind single files or
 *   the whole workspace, read file content at a checkpoint without restoring
 *
 * @module runtime/checkpoints
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Where the hidden checkpoint repository lives inside a workspace. */
export const CHECKPOINT_GIT_DIR = path.join(".quill", "checkpoints.git");

export interface Checkpoint {
  /** Unique checkpoint ID. */
  id: string;
  /** Human label (e.g. "before refactor"). */
  label: string;
  /** Commit hash in the hidden checkpoint repository. */
  commit: string;
  /** Number of files captured in the snapshot. */
  fileCount: number;
  /** When the checkpoint was created. */
  createdAt: string;
  /** Thread that requested the checkpoint, if known. */
  threadId?: string;
}

export interface CreateCheckpointOptions {
  label?: string;
  threadId?: string;
  /** Extra paths to ignore (gitignore syntax), besides the defaults. */
  ignore?: string[];
}

/** Paths never captured by checkpoints. */
const DEFAULT_IGNORE = [".git", "node_modules", ".quill", ".DS_Store", "__pycache__", ".venv"];

export class GitCheckpointService {
  private readonly git: string;
  /** Cached checkpoint metadata per workspace (absolute dir → checkpoints). */
  private cache = new Map<string, Checkpoint[]>();

  constructor(options: { gitBinary?: string } = {}) {
    this.git = options.gitBinary ?? "git";
  }

  // ------------------------------------------------------------------
  // Repository management
  // ------------------------------------------------------------------

  /** Absolute path of the hidden checkpoint repository for a workspace. */
  private gitDir(workspaceDir: string): string {
    return path.join(workspaceDir, CHECKPOINT_GIT_DIR);
  }

  /** Ensure the hidden checkpoint repository exists for the workspace. */
  private async ensureRepo(workspaceDir: string): Promise<string> {
    const gitDir = this.gitDir(workspaceDir);
    await fs.mkdir(gitDir, { recursive: true });
    const gitDirExists = await fs
      .stat(path.join(gitDir, "HEAD"))
      .then(() => true)
      .catch(() => false);
    if (!gitDirExists) {
      // `git init` rejects --work-tree, so run it with --git-dir only.
      await execFileAsync(this.git, ["init", "--bare", "--quiet", gitDir], {
        maxBuffer: 32 * 1024 * 1024,
      });
    }
    return gitDir;
  }

  private async gitRun(
    workspaceDir: string,
    gitDir: string,
    args: string[],
  ): Promise<string> {
    const { stdout } = await execFileAsync(
      this.git,
      [
        "--git-dir",
        gitDir,
        "--work-tree",
        workspaceDir,
        "-c",
        "user.name=Quill Checkpoint",
        "-c",
        "user.email=checkpoint@quill.local",
        "-c",
        "core.hooksPath=", // never run user hooks from checkpoint operations
        ...args,
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    return stdout;
  }

  private ignoreArgs(ignore?: string[]): string[] {
    const patterns = [...DEFAULT_IGNORE, ...(ignore ?? [])];
    // `git add` has no --exclude flag; exclusion uses pathspec magic.
    return patterns.map((p) => `:(exclude)${p}`);
  }

  // ------------------------------------------------------------------
  // Checkpoints
  // ------------------------------------------------------------------

  /** Create a checkpoint (snapshot) of the workspace. */
  async createCheckpoint(
    workspaceDir: string,
    options: CreateCheckpointOptions = {},
  ): Promise<Checkpoint> {
    const gitDir = await this.ensureRepo(workspaceDir);

    // Stage everything except ignored paths (no-op when nothing changed).
    await this.gitRun(workspaceDir, gitDir, [
      "add",
      "--all",
      "--force",
      "--",
      ":/",
      ...this.ignoreArgs(options.ignore),
    ]);

    // `git write-tree` needs an index; `add` above built it. If the tree is
    // identical to HEAD (nothing changed) we still record a checkpoint that
    // points at the same tree so rewind targets stay valid.
    const tree = (await this.gitRun(workspaceDir, gitDir, ["write-tree"])).trim();
    const parentArgs: string[] = [];
    const headExists = await this.gitRun(workspaceDir, gitDir, ["rev-parse", "--verify", "HEAD"])
      .then((r) => r.trim())
      .catch(() => null);
    if (headExists) parentArgs.push("-p", headExists);

    const now = new Date().toISOString();
    const label = options.label ?? `checkpoint ${now}`;
    const commitMessage = `quill-checkpoint: ${label}`;
    const commit = (
      await this.gitRun(workspaceDir, gitDir, [
        "commit-tree",
        tree,
        ...parentArgs,
        "-m",
        commitMessage,
      ])
    ).trim();
    await this.gitRun(workspaceDir, gitDir, ["update-ref", "HEAD", commit]);

    // Count captured files at this commit.
    const ls = await this.gitRun(workspaceDir, gitDir, [
      "ls-tree",
      "-r",
      "--name-only",
      commit,
    ]);

    const checkpoint: Checkpoint = {
      id: `cp_${randomUUID().slice(0, 8)}`,
      label,
      commit,
      fileCount: ls ? ls.trim().split("\n").filter(Boolean).length : 0,
      createdAt: now,
      threadId: options.threadId,
    };
    this.remember(workspaceDir, checkpoint);
    return checkpoint;
  }

  /** List checkpoints for a workspace, newest first. */
  async listCheckpoints(workspaceDir: string): Promise<Checkpoint[]> {
    const gitDir = this.gitDir(workspaceDir);
    const exists = await fs
      .stat(path.join(gitDir, "HEAD"))
      .then(() => true)
      .catch(() => false);
    if (!exists) return [];

    // A bare init has a HEAD file but no commits yet — guard before log.
    const hasCommits = await this.gitRun(workspaceDir, gitDir, [
      "rev-parse",
      "--verify",
      "--quiet",
      "HEAD",
    ])
      .then((r) => r.trim().length > 0)
      .catch(() => false);
    if (!hasCommits) return [];

    // Walk HEAD's first-parent chain, decoding our checkpoint commits.
    const log = await this.gitRun(workspaceDir, gitDir, [
      "log",
      "--first-parent",
      "--format=%H%x1f%s%x1f%aI",
      "HEAD",
    ]);
    const checkpoints: Checkpoint[] = [];
    const cached = this.cache.get(path.resolve(workspaceDir)) ?? [];
    for (const line of log.trim().split("\n").filter(Boolean)) {
      const [commit, subject, authoredAt] = line.split("\x1f");
      if (!subject.startsWith("quill-checkpoint: ")) continue;
      const known = cached.find((c) => c.commit === commit);
      checkpoints.push(
        known ?? {
          id: `cp_${commit.slice(0, 8)}`,
          label: subject.slice("quill-checkpoint: ".length),
          commit,
          fileCount: 0,
          createdAt: authoredAt,
        },
      );
    }
    this.cache.set(path.resolve(workspaceDir), checkpoints);
    return checkpoints;
  }

  /** Read a file's content at a checkpoint without restoring it. */
  async readFileAt(
    workspaceDir: string,
    checkpointId: string,
    filePath: string,
  ): Promise<string> {
    const checkpoint = await this.resolve(workspaceDir, checkpointId);
    if (!checkpoint) throw new Error(`Unknown checkpoint: ${checkpointId}`);
    const normalized = normalizeRelative(filePath);
    return this.gitRun(workspaceDir, this.gitDir(workspaceDir), [
      "show",
      `${checkpoint.commit}:${normalized}`,
    ]);
  }

  /** Rewind a single file to its state at a checkpoint. */
  async rewindFile(
    workspaceDir: string,
    checkpointId: string,
    filePath: string,
  ): Promise<{ path: string; restored: boolean }> {
    const checkpoint = await this.resolve(workspaceDir, checkpointId);
    if (!checkpoint) throw new Error(`Unknown checkpoint: ${checkpointId}`);
    const normalized = normalizeRelative(filePath);

    // Does the file exist in the checkpoint?
    const exists = await this.gitRun(
      workspaceDir,
      this.gitDir(workspaceDir),
      ["cat-file", "-e", `${checkpoint.commit}:${normalized}`],
    )
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      // The file did not exist at checkpoint time → remove it (it was
      // created after the checkpoint).
      await fs.rm(path.join(workspaceDir, normalized), { force: true });
      return { path: normalized, restored: true };
    }

    await this.gitRun(workspaceDir, this.gitDir(workspaceDir), [
      "checkout",
      checkpoint.commit,
      "--",
      normalized,
    ]);
    return { path: normalized, restored: true };
  }

  /** Rewind the entire workspace to a checkpoint. */
  async rewindAll(
    workspaceDir: string,
    checkpointId: string,
  ): Promise<{ checkpoint: string; restored: true }> {
    const checkpoint = await this.resolve(workspaceDir, checkpointId);
    if (!checkpoint) throw new Error(`Unknown checkpoint: ${checkpointId}`);
    const gitDir = this.gitDir(workspaceDir);

    // Restore every tracked path from the checkpoint tree.
    await this.gitRun(workspaceDir, gitDir, [
      "checkout",
      checkpoint.commit,
      "--",
      ":/",
    ]);

    // Remove files created after the checkpoint. The index cannot be trusted
    // here (files created after the last add were never staged), so walk the
    // worktree directly.
    const atCheckpoint = new Set(
      (
        await this.gitRun(workspaceDir, gitDir, [
          "ls-tree",
          "-r",
          "--name-only",
          checkpoint.commit,
        ])
      )
        .trim()
        .split("\n")
        .filter(Boolean),
    );
    for (const file of await listWorktreeFiles(workspaceDir, DEFAULT_IGNORE)) {
      if (!atCheckpoint.has(file)) {
        await fs.rm(path.join(workspaceDir, file), { force: true });
      }
    }
    return { checkpoint: checkpoint.id, restored: true };
  }

  /** Drop all checkpoints for a workspace (removes the hidden repository). */
  async clear(workspaceDir: string): Promise<void> {
    const gitDir = this.gitDir(workspaceDir);
    await fs.rm(gitDir, { recursive: true, force: true });
    this.cache.delete(path.resolve(workspaceDir));
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private async resolve(
    workspaceDir: string,
    checkpointId: string,
  ): Promise<Checkpoint | undefined> {
    const all = await this.listCheckpoints(workspaceDir);
    return all.find((c) => c.id === checkpointId || c.commit.startsWith(checkpointId));
  }

  private remember(workspaceDir: string, checkpoint: Checkpoint): void {
    const key = path.resolve(workspaceDir);
    const existing = this.cache.get(key) ?? [];
    existing.unshift(checkpoint);
    this.cache.set(key, existing);
  }
}

/** Normalize a user-supplied path to a safe workspace-relative POSIX path. */
function normalizeRelative(filePath: string): string {
  const normalized = path
    .normalize(filePath)
    .split(path.sep)
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  if (!normalized || path.isAbsolute(filePath)) {
    throw new Error(`Invalid workspace-relative path: ${filePath}`);
  }
  return normalized;
}

/** Recursively list workspace files (POSIX-relative), skipping ignored names. */
async function listWorktreeFiles(root: string, ignore: string[]): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    const abs = rel ? path.join(root, rel) : root;
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignore.includes(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(childRel);
      } else if (entry.isFile()) {
        out.push(childRel);
      }
    }
  };
  await walk("");
  return out;
}
