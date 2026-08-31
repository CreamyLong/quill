/**
 * Durable MCP Task Runtime — lease-based execution engine.
 *
 * Port of DeerFlow 2.0's `mcp_tasks` runtime. Manages the full lifecycle of
 * long-running MCP tasks: claim → execute → poll → cancel/complete.
 *
 * The runtime is designed to be embedded in the Gateway process. It uses
 * the in-memory store by default but can be backed by a database for
 * multi-worker deployments.
 */

import { randomUUID } from "node:crypto";

import type {
  ClaimResult,
  CreateMcpTaskOptions,
  McpTask,
  McpTaskProjection,
  McpTaskRuntimeConfig,
  McpTaskStatus,
} from "./types.js";
import { DEFAULT_MCP_TASK_CONFIG } from "./types.js";
import { getTaskStore } from "./store.js";

/** Callback invoked to execute a claimed task. */
export type TaskExecutor = (task: McpTask) => Promise<unknown>;

/** Callback invoked on task status changes. */
export type TaskStatusCallback = (task: McpTask, previousStatus: McpTaskStatus) => void;

/**
 * Durable MCP Task Runtime.
 *
 * Manages long-running MCP work that would otherwise block the agent loop.
 * Tasks are lease-based: a worker claims a task, executes it asynchronously,
 * and the result is polled or streamed back to the agent.
 */
export class McpTaskRuntime {
  private config: McpTaskRuntimeConfig;
  private workerId: string;
  private executor: TaskExecutor | null = null;
  private statusCallbacks: TaskStatusCallback[] = [];
  private reaperTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(config: Partial<McpTaskRuntimeConfig> = {}) {
    this.config = { ...DEFAULT_MCP_TASK_CONFIG, ...config };
    this.workerId = `worker_${randomUUID().slice(0, 8)}`;
  }

  /**
   * Start the runtime: begin the lease reaper background loop.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.startReaper();
    console.log(`[mcp_tasks] Runtime started (worker: ${this.workerId})`);
  }

  /**
   * Stop the runtime: halt the lease reaper.
   */
  stop(): void {
    this.running = false;
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
    console.log(`[mcp_tasks] Runtime stopped (worker: ${this.workerId})`);
  }

  /**
   * Set the executor function that runs claimed tasks.
   */
  setExecutor(executor: TaskExecutor): void {
    this.executor = executor;
  }

  /**
   * Register a status change callback.
   */
  onStatusChange(callback: TaskStatusCallback): void {
    this.statusCallbacks.push(callback);
  }

  /**
   * Create a new durable MCP task.
   */
  createTask(options: CreateMcpTaskOptions): McpTask {
    const store = getTaskStore();
    const task = store.create({
      ...options,
      maxAttempts: options.maxAttempts ?? this.config.maxAttempts,
    });
    console.log(`[mcp_tasks] Created task ${task.id} (${options.serverName}.${options.toolName})`);
    return task;
  }

  /**
   * Claim a pending task for execution.
   */
  claimTask(taskId: string): ClaimResult {
    const store = getTaskStore();
    const task = store.get(taskId);

    if (!task) {
      return { success: false, task: null, reason: "Task not found" };
    }
    if (task.status !== "pending") {
      return {
        success: false,
        task: null,
        reason: `Task is ${task.status}, not pending`,
      };
    }

    // Check concurrent task limit.
    const workerTasks = store.getByWorker(this.workerId);
    const activeCount = workerTasks.filter(
      (t) => t.status === "claimed" || t.status === "running",
    ).length;
    if (activeCount >= this.config.maxConcurrentPerWorker) {
      return {
        success: false,
        task: null,
        reason: `Worker at capacity (${activeCount}/${this.config.maxConcurrentPerWorker})`,
      };
    }

    const leaseExpiresAt = Date.now() + this.config.defaultLeaseMs;
    const claimed = store.claim(taskId, this.workerId, leaseExpiresAt);

    if (!claimed) {
      return { success: false, task: null, reason: "Claim failed (race)" };
    }

    this.notifyStatusChange(claimed, task.status);
    console.log(`[mcp_tasks] Claimed task ${taskId} (worker: ${this.workerId})`);
    return { success: true, task: claimed };
  }

  /**
   * Execute a claimed task asynchronously.
   * The task must be claimed by this worker.
   */
  async executeTask(taskId: string): Promise<McpTask | null> {
    if (!this.executor) {
      console.error("[mcp_tasks] No executor set");
      return null;
    }

    const store = getTaskStore();
    const task = store.get(taskId);

    if (!task || task.workerId !== this.workerId) {
      console.error(`[mcp_tasks] Task ${taskId} not claimed by this worker`);
      return null;
    }

    // Mark as running.
    const previousStatus = task.status;
    store.update(taskId, { status: "running" });
    this.notifyStatusChange({ ...task, status: "running" }, previousStatus);

    try {
      const result = await this.executor(task);
      const completed = store.complete(taskId, result);
      if (completed) {
        this.notifyStatusChange(completed, "running");
        console.log(`[mcp_tasks] Completed task ${taskId}`);
      }
      return completed;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failed = store.fail(taskId, errorMessage);
      if (failed) {
        this.notifyStatusChange(failed, "running");
        console.error(`[mcp_tasks] Failed task ${taskId}: ${errorMessage}`);
      }
      return failed;
    }
  }

  /**
   * Poll a task's current status.
   */
  pollTask(taskId: string): McpTask | null {
    return getTaskStore().get(taskId);
  }

  /**
   * Cancel a task.
   */
  cancelTask(taskId: string): McpTask | null {
    const store = getTaskStore();
    const task = store.cancel(taskId);
    if (task) {
      this.notifyStatusChange(task, task.status);
      console.log(`[mcp_tasks] Cancelled task ${taskId}`);
    }
    return task;
  }

  /**
   * Get a bounded projection of a task for ThreadState.
   */
  getProjection(taskId: string): McpTaskProjection | null {
    const task = getTaskStore().get(taskId);
    if (!task) return null;
    return {
      id: task.id,
      status: task.status,
      serverName: task.serverName,
      toolName: task.toolName,
      createdAt: task.createdAt,
      result: task.result,
      error: task.error,
    };
  }

  /**
   * Get all projections for a thread.
   */
  getProjectionsByThread(threadId: string): McpTaskProjection[] {
    return getTaskStore()
      .getByThread(threadId)
      .map((t) => ({
        id: t.id,
        status: t.status,
        serverName: t.serverName,
        toolName: t.toolName,
        createdAt: t.createdAt,
        result: t.result,
        error: t.error,
      }));
  }

  /**
   * Auto-claim and execute the next pending task.
   * Returns the task ID if a task was claimed, null otherwise.
   */
  async autoExecuteNext(): Promise<string | null> {
    const store = getTaskStore();
    const pending = store.getByStatus("pending");
    if (pending.length === 0) return null;

    // Claim the oldest pending task.
    const oldest = pending.sort((a, b) => a.createdAt - b.createdAt)[0];
    const result = this.claimTask(oldest.id);

    if (result.success && result.task) {
      // Execute asynchronously (don't await — non-blocking).
      void this.executeTask(result.task.id);
      return result.task.id;
    }

    return null;
  }

  /**
   * Get runtime statistics.
   */
  getStats(): {
    workerId: string;
    running: boolean;
    config: McpTaskRuntimeConfig;
    taskCounts: Record<McpTaskStatus, number>;
  } {
    return {
      workerId: this.workerId,
      running: this.running,
      config: { ...this.config },
      taskCounts: getTaskStore().countByStatus(),
    };
  }

  /**
   * Start the lease reaper: periodically reclaim expired leases.
   */
  private startReaper(): void {
    this.reaperTimer = setInterval(() => {
      const count = getTaskStore().reapExpiredLeases();
      if (count > 0) {
        console.log(`[mcp_tasks] Reaper reclaimed ${count} expired task(s)`);
      }
    }, this.config.leaseReaperIntervalMs);

    // Don't block process exit.
    if (this.reaperTimer.unref) {
      this.reaperTimer.unref();
    }
  }

  /**
   * Notify all registered status callbacks.
   */
  private notifyStatusChange(task: McpTask, previousStatus: McpTaskStatus): void {
    for (const cb of this.statusCallbacks) {
      try {
        cb(task, previousStatus);
      } catch (err) {
        console.error("[mcp_tasks] Status callback error:", err);
      }
    }
  }
}

/** Singleton runtime instance. */
let _runtime: McpTaskRuntime | null = null;

export function getTaskRuntime(config?: Partial<McpTaskRuntimeConfig>): McpTaskRuntime {
  if (!_runtime) {
    _runtime = new McpTaskRuntime(config);
  }
  return _runtime;
}

export function resetTaskRuntime(): void {
  if (_runtime) {
    _runtime.stop();
  }
  _runtime = null;
}
