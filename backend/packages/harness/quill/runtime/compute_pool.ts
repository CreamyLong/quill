/**
 * Compute Worker Pool — resource-aware task execution.
 *
 * Inspired by OpenClaw's WorkerTaskPool and the awesome-harness-engineering
 * compute resource management pattern.
 *
 * A shared worker pool with CPU admission control, task queuing, and overload
 * handling. Tasks are scheduled based on available CPU resources rather than
 * being spawned unbounded.
 *
 * Key features:
 *   - CPU admission limit: max(1, availableParallelism() - 1)
 *   - Bounded pending queue (128 tasks default)
 *   - Overload handling with structured error response
 *   - Task priority (high / normal / low)
 *   - Graceful degradation under load
 *
 * Source patterns:
 * - OpenClaw: WorkerTaskPool with CPU admission limit
 * - awesome-harness-engineering: Compute resource management
 * - Codex CLI: Cloud tasks for parallel sub-agent work
 */

import { availableParallelism } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Task priority levels.
 */
export type TaskPriority = "high" | "normal" | "low";

/**
 * A unit of compute work.
 */
export interface ComputeTask<TInput = unknown, TOutput = unknown> {
  id: string;
  name: string;
  priority: TaskPriority;
  input: TInput;
  execute: (input: TInput) => Promise<TOutput>;
  /** Task timeout in milliseconds. */
  timeoutMs?: number;
}

/**
 * Task submission result.
 */
export interface TaskSubmission<TOutput> {
  taskId: string;
  /** Promise that resolves with the task output. */
  promise: Promise<TOutput>;
  /** Current position in the queue (0 = running). */
  queuePosition: number;
}

/**
 * Task execution error.
 */
export interface TaskError {
  code: "overloaded" | "timeout" | "execution_error" | "cancelled";
  message: string;
  taskId?: string;
}

/**
 * Pool statistics.
 */
export interface PoolStats {
  /** Number of workers (max concurrent tasks). */
  maxWorkers: number;
  /** Currently running tasks. */
  running: number;
  /** Tasks waiting in queue. */
  pending: number;
  /** Total tasks completed. */
  completed: number;
  /** Total tasks failed. */
  failed: number;
  /** Total tasks rejected (overloaded). */
  rejected: number;
  /** Whether the pool is currently overloaded. */
  overloaded: boolean;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ComputePoolOptions {
  /** Maximum concurrent workers. Default: max(1, availableParallelism() - 1). */
  maxWorkers?: number;
  /** Maximum pending tasks in queue. Default: 128. */
  maxPending?: number;
  /** Default task timeout in milliseconds. Default: 300000 (5 min). */
  defaultTimeoutMs?: number;
}

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

// ---------------------------------------------------------------------------
// Compute Pool
// ---------------------------------------------------------------------------

/**
 * Shared compute worker pool with admission control.
 */
export class ComputeWorkerPool {
  private maxWorkers: number;
  private maxPending: number;
  private defaultTimeoutMs: number;

  private running = 0;
  private queue: Array<{
    task: ComputeTask;
    resolve: (value: unknown) => void;
    reject: (err: TaskError) => void;
    submittedAt: number;
  }> = [];
  private completed = 0;
  private failed = 0;
  private rejected = 0;
  private shutdown_ = false;

  constructor(options: ComputePoolOptions = {}) {
    this.maxWorkers =
      options.maxWorkers ?? Math.max(1, availableParallelism() - 1);
    this.maxPending = options.maxPending ?? 128;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 300_000;
  }

  /**
   * Submit a task for execution.
   *
   * Returns a promise that resolves with the task output. If the queue is
   * full, the task is rejected with an "overloaded" error.
   */
  submit<TInput, TOutput>(
    task: ComputeTask<TInput, TOutput>,
  ): TaskSubmission<TOutput> {
    if (this.shutdown_) {
      throw {
        code: "overloaded",
        message: "Pool is shutting down",
        taskId: task.id,
      } satisfies TaskError;
    }

    const queuePosition = this.queue.length + (this.running < this.maxWorkers ? 0 : 1);

    // Check if queue is full
    if (this.queue.length >= this.maxPending) {
      this.rejected++;
      throw {
        code: "overloaded",
        message: `Queue full (${this.maxPending} pending tasks). Retry later.`,
        taskId: task.id,
      } satisfies TaskError;
    }

    const promise = new Promise<TOutput>((resolve, reject) => {
      this.queue.push({
        task: task as ComputeTask,
        resolve: resolve as (value: unknown) => void,
        reject,
        submittedAt: Date.now(),
      });
    });

    // Sort queue by priority (high first, then insertion order)
    this.queue.sort((a, b) => {
      const pa = PRIORITY_WEIGHT[a.task.priority];
      const pb = PRIORITY_WEIGHT[b.task.priority];
      if (pa !== pb) return pa - pb;
      return a.submittedAt - b.submittedAt;
    });

    // Try to schedule immediately
    this.scheduleNext();

    return {
      taskId: task.id,
      promise,
      queuePosition,
    };
  }

  /**
   * Get current pool statistics.
   */
  getStats(): PoolStats {
    return {
      maxWorkers: this.maxWorkers,
      running: this.running,
      pending: this.queue.length,
      completed: this.completed,
      failed: this.failed,
      rejected: this.rejected,
      overloaded: this.queue.length >= this.maxPending * 0.8,
    };
  }

  /**
   * Gracefully shut down the pool.
   *
   * Stops accepting new tasks. Running tasks continue; queued tasks are
   * rejected with "overloaded".
   */
  async shutdown(): Promise<void> {
    this.shutdown_ = true;

    // Reject all queued tasks
    for (const entry of this.queue) {
      entry.reject({
        code: "cancelled",
        message: "Pool shutting down",
        taskId: entry.task.id,
      });
    }
    this.queue = [];

    // Wait for running tasks (with a grace period)
    const gracePeriod = 30_000;
    const start = Date.now();
    while (this.running > 0 && Date.now() - start < gracePeriod) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // ------------------------------------------------------------------
  // Scheduling
  // ------------------------------------------------------------------

  private scheduleNext(): void {
    if (this.running >= this.maxWorkers) return;
    if (this.queue.length === 0) return;

    const entry = this.queue.shift();
    if (!entry) return;

    this.running++;

    this.executeTask(entry.task)
      .then((result) => {
        this.completed++;
        entry.resolve(result);
      })
      .catch((err: TaskError) => {
        this.failed++;
        entry.reject(err);
      })
      .finally(() => {
        this.running--;
        // Schedule next task
        this.scheduleNext();
      });

    // Try to schedule more workers
    this.scheduleNext();
  }

  private async executeTask(task: ComputeTask): Promise<unknown> {
    const timeout = task.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject({
          code: "timeout",
          message: `Task "${task.name}" timed out after ${timeout}ms`,
          taskId: task.id,
        } satisfies TaskError);
      }, timeout);

      task
        .execute(task.input)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject({
            code: "execution_error",
            message: err instanceof Error ? err.message : String(err),
            taskId: task.id,
          } satisfies TaskError);
        });
    });
  }
}

// ---------------------------------------------------------------------------
// Global Pool Instance
// ---------------------------------------------------------------------------

let globalPool: ComputeWorkerPool | null = null;

/**
 * Get the global compute worker pool, creating it if necessary.
 */
export function getComputePool(options?: ComputePoolOptions): ComputeWorkerPool {
  if (!globalPool) {
    globalPool = new ComputeWorkerPool(options);
  }
  return globalPool;
}

/**
 * Reset the global compute pool (for testing).
 */
export function resetComputePool(): void {
  globalPool = null;
}
