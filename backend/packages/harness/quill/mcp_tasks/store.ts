/**
 * Durable MCP Task Store — persistence layer for long-running MCP tasks.
 *
 * In-memory implementation with atomic operations. The interface is designed
 * to be backed by a database in production (the database is the source of
 * truth in DeerFlow 2.0).
 */

import type {
  CreateMcpTaskOptions,
  McpTask,
  McpTaskStatus,
} from "./types.js";

/** Generate a unique task ID. */
function generateTaskId(): string {
  return `mcp_task_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * In-memory store for durable MCP tasks.
 *
 * Thread-safe within Node.js's single-threaded event loop. All methods are
 * synchronous but return fresh copies to prevent external mutation.
 */
export class McpTaskStore {
  private tasks = new Map<string, McpTask>();

  /**
   * Create a new durable MCP task.
   */
  create(options: CreateMcpTaskOptions): McpTask {
    const now = Date.now();
    const task: McpTask = {
      id: generateTaskId(),
      serverName: options.serverName,
      toolName: options.toolName,
      args: options.args,
      status: "pending",
      workerId: null,
      leaseExpiresAt: null,
      createdAt: now,
      updatedAt: now,
      result: null,
      error: null,
      attemptCount: 0,
      maxAttempts: options.maxAttempts ?? 3,
      threadId: options.threadId ?? null,
      runId: options.runId ?? null,
      userId: options.userId ?? null,
      metadata: options.metadata ?? {},
    };
    this.tasks.set(task.id, task);
    return { ...task };
  }

  /**
   * Get a task by ID.
   */
  get(id: string): McpTask | null {
    const task = this.tasks.get(id);
    return task ? { ...task } : null;
  }

  /**
   * Get all tasks matching a status.
   */
  getByStatus(status: McpTaskStatus): McpTask[] {
    return [...this.tasks.values()]
      .filter((t) => t.status === status)
      .map((t) => ({ ...t }));
  }

  /**
   * Get all tasks for a specific thread.
   */
  getByThread(threadId: string): McpTask[] {
    return [...this.tasks.values()]
      .filter((t) => t.threadId === threadId)
      .map((t) => ({ ...t }));
  }

  /**
   * Get all tasks for a specific user.
   */
  getByUser(userId: string): McpTask[] {
    return [...this.tasks.values()]
      .filter((t) => t.userId === userId)
      .map((t) => ({ ...t }));
  }

  /**
   * Get all tasks claimed by a specific worker.
   */
  getByWorker(workerId: string): McpTask[] {
    return [...this.tasks.values()]
      .filter((t) => t.workerId === workerId)
      .map((t) => ({ ...t }));
  }

  /**
   * Update a task's status and optionally other fields.
   */
  update(
    id: string,
    updates: Partial<Omit<McpTask, "id" | "createdAt">>,
  ): McpTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;

    const updated: McpTask = {
      ...task,
      ...updates,
      id: task.id, // immutable
      createdAt: task.createdAt, // immutable
      updatedAt: Date.now(),
    };
    this.tasks.set(id, updated);
    return { ...updated };
  }

  /**
   * Claim a pending task for execution.
   * Returns the updated task or null if claim failed.
   */
  claim(id: string, workerId: string, leaseExpiresAt: number): McpTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (task.status !== "pending" && task.status !== "claimed") return null;
    if (
      task.status === "claimed" &&
      task.leaseExpiresAt &&
      task.leaseExpiresAt > Date.now()
    ) {
      // Another worker holds a valid lease.
      return null;
    }

    const updated: McpTask = {
      ...task,
      status: "claimed",
      workerId,
      leaseExpiresAt,
      attemptCount: task.attemptCount + 1,
      updatedAt: Date.now(),
    };
    this.tasks.set(id, updated);
    return { ...updated };
  }

  /**
   * Release a task's lease (back to pending for retry, or keep claimed).
   */
  releaseLease(id: string): McpTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;

    const updated: McpTask = {
      ...task,
      status: "pending",
      workerId: null,
      leaseExpiresAt: null,
      updatedAt: Date.now(),
    };
    this.tasks.set(id, updated);
    return { ...updated };
  }

  /**
   * Mark a task as completed with a result.
   */
  complete(id: string, result: unknown): McpTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;

    const updated: McpTask = {
      ...task,
      status: "completed",
      result,
      error: null,
      updatedAt: Date.now(),
    };
    this.tasks.set(id, updated);
    return { ...updated };
  }

  /**
   * Mark a task as failed with an error.
   */
  fail(id: string, error: string): McpTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;

    const newStatus: McpTaskStatus =
      task.attemptCount >= task.maxAttempts ? "failed" : "pending";
    const updated: McpTask = {
      ...task,
      status: newStatus,
      error,
      workerId: newStatus === "pending" ? null : task.workerId,
      leaseExpiresAt: newStatus === "pending" ? null : task.leaseExpiresAt,
      updatedAt: Date.now(),
    };
    this.tasks.set(id, updated);
    return { ...updated };
  }

  /**
   * Cancel a task.
   */
  cancel(id: string): McpTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (task.status === "completed" || task.status === "failed") return null;

    const updated: McpTask = {
      ...task,
      status: "cancelled",
      updatedAt: Date.now(),
    };
    this.tasks.set(id, updated);
    return { ...updated };
  }

  /**
   * Mark timed-out tasks as pending for retry.
   * Returns the number of tasks reclaimed.
   */
  reapExpiredLeases(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, task] of this.tasks) {
      if (
        (task.status === "claimed" || task.status === "running") &&
        task.leaseExpiresAt &&
        task.leaseExpiresAt <= now
      ) {
        if (task.attemptCount >= task.maxAttempts) {
          this.fail(id, "Task timed out: max attempts exceeded");
        } else {
          this.releaseLease(id);
        }
        count++;
      }
    }
    return count;
  }

  /**
   * Delete a task permanently.
   */
  delete(id: string): boolean {
    return this.tasks.delete(id);
  }

  /**
   * Get all tasks (for admin/debugging).
   */
  getAll(): McpTask[] {
    return [...this.tasks.values()].map((t) => ({ ...t }));
  }

  /**
   * Clear all tasks (for testing).
   */
  clear(): void {
    this.tasks.clear();
  }

  /**
   * Get count of tasks by status.
   */
  countByStatus(): Record<McpTaskStatus, number> {
    const counts: Record<McpTaskStatus, number> = {
      pending: 0,
      claimed: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      timed_out: 0,
    };
    for (const task of this.tasks.values()) {
      counts[task.status]++;
    }
    return counts;
  }
}

/** Singleton store instance. */
let _store: McpTaskStore | null = null;

export function getTaskStore(): McpTaskStore {
  if (!_store) {
    _store = new McpTaskStore();
  }
  return _store;
}

export function resetTaskStore(): void {
  _store = null;
}
