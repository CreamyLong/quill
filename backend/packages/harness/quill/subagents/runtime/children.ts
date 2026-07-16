/**
 * Active-child registry — tracks which background subagent tasks belong to
 * which parent run, so a user cancel / client disconnect / parent termination
 * can cancel every child cooperatively.
 *
 * Mirrors `quill.subagents.runtime.active_children` from the Python backend.
 * The primitive is a `Map<parentRunId, Set<childTaskId>>`; cancellation is
 * cooperative (each child's `CancelEvent` is set — see
 * `executor.ts::requestCancelBackgroundTask`), there is no Python-style thread
 * pool. Promises + the event loop do the scheduling.
 *
 * Registration is keyed by PARENT run id so an SSE-driven client that loses
 * and regains its connection can still find the children that need cancelling.
 */

import { requestCancelBackgroundTask } from "../executor.js";

/**
 * Register a child task under its parent run. Idempotent — registering the same
 * child twice is a no-op.
 */
export function registerChild(parentRunId: string, childTaskId: string): void {
  if (!parentRunId) {
    return;
  }
  let children = _activeChildren.get(parentRunId);
  if (children === undefined) {
    children = new Set<string>();
    _activeChildren.set(parentRunId, children);
  }
  children.add(childTaskId);
}

/** Deregister a child task (e.g. after it reaches a terminal state). */
export function deregisterChild(parentRunId: string, childTaskId: string): void {
  if (!parentRunId) {
    return;
  }
  const children = _activeChildren.get(parentRunId);
  if (children === undefined) {
    return;
  }
  children.delete(childTaskId);
  if (children.size === 0) {
    _activeChildren.delete(parentRunId);
  }
}

/** The child task ids currently registered under `parentRunId` (may be empty). */
export function childrenOf(parentRunId: string): string[] {
  const children = _activeChildren.get(parentRunId);
  return children ? [...children] : [];
}

/** True when the parent run has at least one live child. */
export function hasChildren(parentRunId: string): boolean {
  return _activeChildren.has(parentRunId);
}

/**
 * Cooperatively cancel every child currently registered under `parentRunId`.
 * Returns the number of children a cancel was requested for. Each child's
 * `CancelEvent` is set — actual termination happens at the next stream
 * iteration boundary inside the executor (`_aexecute`).
 */
export function cancelChildren(parentRunId: string): number {
  const children = _activeChildren.get(parentRunId);
  if (children === undefined || children.size === 0) {
    return 0;
  }
  let count = 0;
  for (const childTaskId of children) {
    try {
      requestCancelBackgroundTask(childTaskId);
      count += 1;
    } catch (err) {
      console.warn(
        `[activeChildren] cancel request failed for child ${childTaskId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  _activeChildren.delete(parentRunId);
  return count;
}

/** Count of parents with at least one live child (diagnostics). */
export function size(): number {
  return _activeChildren.size;
}

const _activeChildren = new Map<string, Set<string>>();
