/**
 * File operation lock manager for sandbox paths.
 *
 * Mirrors `quill.sandbox.file_operation_lock` from the Python backend.
 */

import { EventEmitter } from "node:events";

export interface SandboxLike {
  id?: string;
  [key: string]: unknown;
}

type LockKey = string;

class AsyncLock {
  private locked = false;
  private waiters: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

const fileOperationLocks = new Map<LockKey, AsyncLock>();

function getFileOperationLockKey(sandbox: SandboxLike, targetPath: string): string {
  const sandboxId = sandbox.id ?? `instance:${String(sandbox)}`;
  return `${sandboxId}:${targetPath}`;
}

/**
 * Return an async lock for the given sandbox/path pair.
 */
export function getFileOperationLock(sandbox: SandboxLike, targetPath: string): AsyncLock {
  const key = getFileOperationLockKey(sandbox, targetPath);
  let lock = fileOperationLocks.get(key);
  if (lock === undefined) {
    lock = new AsyncLock();
    fileOperationLocks.set(key, lock);
  }
  return lock;
}

/**
 * Execute `fn` while holding the file operation lock for `sandbox/path`.
 */
export async function withFileOperationLock<T>(
  sandbox: SandboxLike,
  targetPath: string,
  fn: () => T | Promise<T>
): Promise<T> {
  const lock = getFileOperationLock(sandbox, targetPath);
  await lock.acquire();
  try {
    return await fn();
  } finally {
    lock.release();
  }
}
