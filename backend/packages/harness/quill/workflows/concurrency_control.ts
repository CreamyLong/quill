/**
 * Workflow Runtime Concurrency Control — adjust running workflow concurrency.
 *
 * Inspired by ZCode v3.14.3: "The concurrency limit of a running workflow can
 * now be adjusted directly, without stopping the task."
 *
 * This module provides a concurrency governor that:
 * - Tracks active node executions per workflow run
 * - Allows runtime adjustment of the concurrency limit
 * - Queues excess nodes when concurrency is reduced
 * - Releases queued nodes when concurrency headroom opens
 * - Emits events for UI real-time status display
 */

export interface ConcurrencyGovernorOptions {
  /** Initial concurrency limit. */
  initialLimit: number;
  /** Minimum allowed concurrency. */
  minLimit: number;
  /** Maximum allowed concurrency. */
  maxLimit: number;
}

export interface RunningNode {
  nodeId: string;
  startedAt: string;
  status: "running" | "queued";
}

export interface ConcurrencyStatus {
  /** Current concurrency limit. */
  limit: number;
  /** Currently executing nodes. */
  running: RunningNode[];
  /** Queued nodes waiting for concurrency headroom. */
  queued: string[];
  /** Total nodes completed. */
  completedCount: number;
  /** Total nodes failed. */
  failedCount: number;
}

export interface ConcurrencyEvent {
  type: "limit_changed" | "node_started" | "node_completed" | "node_queued" | "node_released";
  timestamp: string;
  nodeId?: string;
  oldLimit?: number;
  newLimit?: number;
}

export class ConcurrencyGovernor {
  private limit: number;
  private readonly minLimit: number;
  private readonly maxLimit: number;
  private running = new Map<string, RunningNode>();
  private queued: string[] = [];
  private completedCount = 0;
  private failedCount = 0;
  private listeners: Array<(event: ConcurrencyEvent) => void> = [];

  constructor(options: ConcurrencyGovernorOptions) {
    this.limit = Math.max(options.minLimit, Math.min(options.maxLimit, options.initialLimit));
    this.minLimit = options.minLimit;
    this.maxLimit = options.maxLimit;
  }

  /** Get the current concurrency limit. */
  getLimit(): number {
    return this.limit;
  }

  /**
   * Adjust the concurrency limit at runtime.
   *
   * If the new limit is higher than the current, queued nodes are released
   * to fill the headroom. If lower, new nodes will be queued until capacity
   * becomes available.
   */
  setLimit(newLimit: number): void {
    const clamped = Math.max(this.minLimit, Math.min(this.maxLimit, newLimit));
    if (clamped === this.limit) return;

    const oldLimit = this.limit;
    this.limit = clamped;

    this.emit({
      type: "limit_changed",
      timestamp: new Date().toISOString(),
      oldLimit,
      newLimit: clamped,
    });

    // If limit increased, release queued nodes to fill headroom.
    if (clamped > oldLimit) {
      this.releaseQueued(clamped - oldLimit);
    }
  }

  /**
   * Attempt to acquire a concurrency slot for a node.
   *
   * @returns true if the node can start, false if it was queued.
   */
  acquire(nodeId: string): boolean {
    if (this.running.size < this.limit) {
      this.running.set(nodeId, {
        nodeId,
        startedAt: new Date().toISOString(),
        status: "running",
      });
      this.emit({
        type: "node_started",
        timestamp: new Date().toISOString(),
        nodeId,
      });
      return true;
    }

    // Queue the node.
    if (!this.queued.includes(nodeId)) {
      this.queued.push(nodeId);
      this.emit({
        type: "node_queued",
        timestamp: new Date().toISOString(),
        nodeId,
      });
    }
    return false;
  }

  /** Release a completed/failed node and potentially dequeue the next. */
  release(nodeId: string, failed = false): void {
    this.running.delete(nodeId);
    if (failed) {
      this.failedCount++;
    } else {
      this.completedCount++;
    }

    this.emit({
      type: "node_completed",
      timestamp: new Date().toISOString(),
      nodeId,
    });

    // Dequeue the next node if any.
    this.releaseQueued(1);
  }

  /** Get current status snapshot. */
  getStatus(): ConcurrencyStatus {
    return {
      limit: this.limit,
      running: Array.from(this.running.values()),
      queued: [...this.queued],
      completedCount: this.completedCount,
      failedCount: this.failedCount,
    };
  }

  /** Subscribe to concurrency events. */
  onEvent(listener: (event: ConcurrencyEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private releaseQueued(count: number): void {
    for (let i = 0; i < count && this.queued.length > 0 && this.running.size < this.limit; i++) {
      const nodeId = this.queued.shift()!;
      this.running.set(nodeId, {
        nodeId,
        startedAt: new Date().toISOString(),
        status: "running",
      });
      this.emit({
        type: "node_released",
        timestamp: new Date().toISOString(),
        nodeId,
      });
    }
  }

  private emit(event: ConcurrencyEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Swallow listener errors — don't break the governor.
      }
    }
  }
}

/** Factory function for creating a governor with sensible defaults. */
export function createConcurrencyGovernor(
  initialLimit = 3,
  minLimit = 1,
  maxLimit = 10,
): ConcurrencyGovernor {
  return new ConcurrencyGovernor({ initialLimit, minLimit, maxLimit });
}
