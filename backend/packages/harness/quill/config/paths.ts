/**
 * Centralized path configuration for Quill application data.
 *
 * Mirrors `quill.config.paths` from the Python backend.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { runtimeHome } from "./runtime_paths.js";

export const VIRTUAL_PATH_PREFIX = "/mnt/user-data";
export const SKILLS_VIRTUAL_PATH_PREFIX = "/mnt/skills";

const SAFE_THREAD_ID_RE = /^[A-Za-z0-9_\-]+$/;
const SAFE_USER_ID_RE = /^[A-Za-z0-9_\-]+$/;
const UNSAFE_USER_ID_CHAR_RE = /[^A-Za-z0-9_\-]/g;
const SAFE_USER_ID_DIGEST_HEX_LEN = 16;

function defaultLocalBaseDir(): string {
  return runtimeHome();
}

function validateThreadId(threadId: string): string {
  if (!SAFE_THREAD_ID_RE.test(threadId)) {
    throw new Error(`Invalid thread_id ${threadId}: only alphanumeric characters, hyphens, and underscores are allowed.`);
  }
  return threadId;
}

function validateUserId(userId: string): string {
  if (!SAFE_USER_ID_RE.test(userId)) {
    throw new Error(`Invalid user_id ${userId}: only alphanumeric characters, hyphens, and underscores are allowed.`);
  }
  return userId;
}

/**
 * Normalize an external identity into the user-id charset.
 */
export function makeSafeUserId(raw: string): string {
  if (!raw) {
    throw new Error("user_id must be a non-empty string.");
  }
  const sanitized = raw.replace(UNSAFE_USER_ID_CHAR_RE, "-");
  if (sanitized === raw) {
    return raw;
  }
  const digest = crypto.createHash("sha256").update(raw, "utf-8").digest("hex").slice(0, SAFE_USER_ID_DIGEST_HEX_LEN);
  return `${sanitized}-${digest}`;
}

function joinHostPath(base: string, ...parts: string[]): string {
  if (parts.length === 0) {
    return base;
  }
  if (/^[A-Za-z]:[\\/]/.test(base) || base.startsWith("\\\\") || base.includes("\\")) {
    let result = base;
    for (const part of parts) {
      result = result.replace(/\\$/, "") + "\\" + part;
    }
    return result;
  }
  return path.join(base, ...parts);
}

export { joinHostPath };

export class Paths {
  private _baseDir: string | null;

  constructor(baseDir?: string) {
    this._baseDir = baseDir ?? null;
  }

  get hostBaseDir(): string {
    const envHost = process.env.QUILL_HOST_BASE_DIR;
    if (envHost) {
      return envHost;
    }
    return this.baseDir;
  }

  private hostBaseDirStr(): string {
    return process.env.QUILL_HOST_BASE_DIR ?? this.baseDir;
  }

  get baseDir(): string {
    if (this._baseDir !== null) {
      return path.resolve(this._baseDir);
    }
    const envHome = process.env.QUILL_HOME;
    if (envHome) {
      return path.resolve(envHome);
    }
    return defaultLocalBaseDir();
  }

  get memoryFile(): string {
    return path.join(this.baseDir, "memory.json");
  }

  get userMdFile(): string {
    return path.join(this.baseDir, "USER.md");
  }

  get agentsDir(): string {
    return path.join(this.baseDir, "agents");
  }

  agentDir(name: string): string {
    return path.join(this.agentsDir, name.toLowerCase());
  }

  agentMemoryFile(name: string): string {
    return path.join(this.agentDir(name), "memory.json");
  }

  userDir(userId: string): string {
    return path.join(this.baseDir, "users", validateUserId(userId));
  }

  userMemoryFile(userId: string): string {
    return path.join(this.userDir(userId), "memory.json");
  }

  userAgentsDir(userId: string): string {
    return path.join(this.userDir(userId), "agents");
  }

  userAgentDir(userId: string, agentName: string): string {
    return path.join(this.userAgentsDir(userId), agentName.toLowerCase());
  }

  userAgentMemoryFile(userId: string, agentName: string): string {
    return path.join(this.userAgentDir(userId, agentName), "memory.json");
  }

  threadDir(threadId: string, userId?: string | null): string {
    if (userId !== null && userId !== undefined) {
      return path.join(this.userDir(userId), "threads", validateThreadId(threadId));
    }
    return path.join(this.baseDir, "threads", validateThreadId(threadId));
  }

  sandboxWorkDir(threadId: string, userId?: string | null): string {
    return path.join(this.threadDir(threadId, userId), "user-data", "workspace");
  }

  sandboxUploadsDir(threadId: string, userId?: string | null): string {
    return path.join(this.threadDir(threadId, userId), "user-data", "uploads");
  }

  sandboxOutputsDir(threadId: string, userId?: string | null): string {
    return path.join(this.threadDir(threadId, userId), "user-data", "outputs");
  }

  acpWorkspaceDir(threadId: string, userId?: string | null): string {
    return path.join(this.threadDir(threadId, userId), "acp-workspace");
  }

  sandboxUserDataDir(threadId: string, userId?: string | null): string {
    return path.join(this.threadDir(threadId, userId), "user-data");
  }

  hostThreadDir(threadId: string, userId?: string | null): string {
    if (userId !== null && userId !== undefined) {
      return joinHostPath(this.hostBaseDirStr(), "users", validateUserId(userId), "threads", validateThreadId(threadId));
    }
    return joinHostPath(this.hostBaseDirStr(), "threads", validateThreadId(threadId));
  }

  hostSandboxUserDataDir(threadId: string, userId?: string | null): string {
    return joinHostPath(this.hostThreadDir(threadId, userId), "user-data");
  }

  hostSandboxWorkDir(threadId: string, userId?: string | null): string {
    return joinHostPath(this.hostSandboxUserDataDir(threadId, userId), "workspace");
  }

  hostSandboxUploadsDir(threadId: string, userId?: string | null): string {
    return joinHostPath(this.hostSandboxUserDataDir(threadId, userId), "uploads");
  }

  hostSandboxOutputsDir(threadId: string, userId?: string | null): string {
    return joinHostPath(this.hostSandboxUserDataDir(threadId, userId), "outputs");
  }

  hostAcpWorkspaceDir(threadId: string, userId?: string | null): string {
    return joinHostPath(this.hostThreadDir(threadId, userId), "acp-workspace");
  }

  ensureThreadDirs(threadId: string, userId?: string | null): void {
    for (const dir of [
      this.sandboxWorkDir(threadId, userId),
      this.sandboxUploadsDir(threadId, userId),
      this.sandboxOutputsDir(threadId, userId),
      this.acpWorkspaceDir(threadId, userId),
    ]) {
      fs.mkdirSync(dir, { recursive: true });
      try {
        fs.chmodSync(dir, 0o777);
      } catch {
        // Ignore permission errors on restricted filesystems.
      }
    }
  }

  deleteThreadDir(threadId: string, userId?: string | null): void {
    const dir = this.threadDir(threadId, userId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  resolveVirtualPath(threadId: string, virtualPath: string, userId?: string | null): string {
    const stripped = virtualPath.replace(/^\/+/, "");
    const prefix = VIRTUAL_PATH_PREFIX.replace(/^\/+/, "");
    if (stripped !== prefix && !stripped.startsWith(`${prefix}/`)) {
      throw new Error(`Path must start with /${prefix}`);
    }
    const relative = stripped.slice(prefix.length).replace(/^\/+/, "");
    const base = path.resolve(this.sandboxUserDataDir(threadId, userId));
    const actual = path.resolve(path.join(base, relative));
    const relativeToBase = path.relative(base, actual);
    if (relativeToBase.startsWith("..") || path.isAbsolute(relativeToBase)) {
      throw new Error("Access denied: path traversal detected");
    }
    return actual;
  }
}

let _paths: Paths | null = null;

export function getPaths(): Paths {
  if (_paths === null) {
    _paths = new Paths();
  }
  return _paths;
}

export function resetPaths(): void {
  _paths = null;
}

/**
 * Resolve a path relative to the application base directory.
 */
export function resolvePath(input: string): string {
  const p = path.normalize(input);
  if (path.isAbsolute(p)) {
    return path.resolve(p);
  }
  return path.resolve(path.join(getPaths().baseDir, p));
}
