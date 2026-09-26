/**
 * Durable Kanban Task Board — crash-recovering shared task queue.
 *
 * Ported from Hermes Agent's kanban system: a SQLite-backed board there, a
 * file-backed board here (atomic JSON writes, no native deps) with the same
 * three interfaces sharing one truth source — the agent toolset
 * (show/list/complete/block), the gateway API, and dashboards. A long-lived
 * Dispatcher inside the gateway reclaims stale claims, reaps crashed workers,
 * promotes ready tasks and spawns assigned profiles.
 *
 * Task lifecycle: backlog → ready → claimed → in_review → done
 *                                       ↘ blocked (with reason) → ready
 *
 * @module multi_agent/kanban
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KanbanStatus = "backlog" | "ready" | "claimed" | "in_review" | "done" | "blocked";

export type KanbanPriority = "low" | "normal" | "high" | "urgent";

/** Where a task runs: scratch space, a directory, or a git worktree. */
export type KanbanWorkspace =
  | { kind: "scratch" }
  | { kind: "dir"; path: string }
  | { kind: "worktree"; branch: string };

export interface KanbanTask {
  id: string;
  title: string;
  description?: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  /** Agent profile assigned to run this task (dispatcher spawns it). */
  assignee?: string;
  /** Workspace the task runs in. */
  workspace: KanbanWorkspace;
  labels: string[];
  /** Who claimed the task and when (set on claim, cleared on release). */
  claimedBy?: string;
  claimedAt?: string;
  /** Lease deadline — expired claims are reclaimed by the dispatcher. */
  leaseExpiresAt?: string;
  /** How many times this task has been reclaimed after a crash. */
  attempts: number;
  /** Why the task is blocked (required for status=blocked). */
  blockedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AddTaskInput {
  title: string;
  description?: string;
  priority?: KanbanPriority;
  assignee?: string;
  workspace?: KanbanWorkspace;
  labels?: string[];
}

export interface KanbanBoardOptions {
  /** File path for durable storage. When omitted the board is in-memory. */
  dbPath?: string;
  /** Claim lease duration (ms). Default 10 minutes. */
  leaseMs?: number;
  /** Max reclaim attempts before a task is parked as blocked. Default 3. */
  maxAttempts?: number;
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

/**
 * KanbanBoard — durable task board. All mutations persist atomically
 * (write-to-temp + rename) so a gateway crash never corrupts the board.
 */
export class KanbanBoard {
  private tasks = new Map<string, KanbanTask>();
  private readonly dbPath?: string;
  readonly leaseMs: number;
  readonly maxAttempts: number;
  private loaded = false;

  constructor(options: KanbanBoardOptions = {}) {
    this.dbPath = options.dbPath;
    this.leaseMs = options.leaseMs ?? 10 * 60_000;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  // ------------------------------------------------------------------
  // Persistence
  // ------------------------------------------------------------------

  /** Load the board from disk (no-op for in-memory boards / missing files). */
  async load(): Promise<void> {
    if (!this.dbPath || this.loaded) return;
    try {
      const raw = await fs.readFile(this.dbPath, "utf8");
      const data = JSON.parse(raw) as { tasks: KanbanTask[] };
      for (const task of data.tasks ?? []) this.tasks.set(task.id, task);
    } catch {
      // Missing or corrupt file → start empty (durable writes will recreate).
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    if (!this.dbPath) return;
    const payload = JSON.stringify({ tasks: [...this.tasks.values()] }, null, 2);
    const tmp = `${this.dbPath}.${randomUUID().slice(0, 6)}.tmp`;
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    await fs.writeFile(tmp, payload, "utf8");
    await fs.rename(tmp, this.dbPath);
  }

  // ------------------------------------------------------------------
  // CRUD
  // ------------------------------------------------------------------

  /** Add a task (starts in backlog unless it has an assignee → ready). */
  async addTask(input: AddTaskInput): Promise<KanbanTask> {
    const now = new Date().toISOString();
    const task: KanbanTask = {
      id: `kb_${randomUUID().slice(0, 8)}`,
      title: input.title,
      description: input.description,
      status: input.assignee ? "ready" : "backlog",
      priority: input.priority ?? "normal",
      assignee: input.assignee,
      workspace: input.workspace ?? { kind: "scratch" },
      labels: input.labels ?? [],
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    await this.persist();
    return task;
  }

  get(taskId: string): KanbanTask | undefined {
    return this.tasks.get(taskId);
  }

  /** All tasks, optionally filtered by status. */
  list(status?: KanbanStatus): KanbanTask[] {
    const all = [...this.tasks.values()];
    const filtered = status ? all.filter((t) => t.status === status) : all;
    return filtered.sort(
      (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || a.createdAt.localeCompare(b.createdAt),
    );
  }

  /** Board summary per column (for kanban_show). */
  columns(): Record<KanbanStatus, number> {
    const out = { backlog: 0, ready: 0, claimed: 0, in_review: 0, done: 0, blocked: 0 };
    for (const task of this.tasks.values()) out[task.status] += 1;
    return out;
  }

  // ------------------------------------------------------------------
  // Claim / complete / block
  // ------------------------------------------------------------------

  /** Claim the highest-priority ready task (or a specific one) with a lease. */
  async claim(claimant: string, taskId?: string): Promise<KanbanTask | undefined> {
    const task = taskId
      ? this.tasks.get(taskId)
      : this.list("ready")[0];
    if (!task || task.status !== "ready") return undefined;

    task.status = "claimed";
    task.claimedBy = claimant;
    task.claimedAt = new Date().toISOString();
    task.leaseExpiresAt = new Date(Date.now() + this.leaseMs).toISOString();
    task.updatedAt = task.claimedAt;
    await this.persist();
    return task;
  }

  /** Mark a claimed task done. */
  async complete(taskId: string): Promise<KanbanTask | undefined> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "claimed") return undefined;
    this.finish(task, "done");
    await this.persist();
    return task;
  }

  /** Move a claimed task to review. */
  async submitReview(taskId: string): Promise<KanbanTask | undefined> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "claimed") return undefined;
    this.finish(task, "in_review");
    await this.persist();
    return task;
  }

  /** Block a task with a reason (any non-terminal status). */
  async block(taskId: string, reason: string): Promise<KanbanTask | undefined> {
    const task = this.tasks.get(taskId);
    if (!task || task.status === "done") return undefined;
    task.status = "blocked";
    task.blockedReason = reason;
    this.clearClaim(task);
    task.updatedAt = new Date().toISOString();
    await this.persist();
    return task;
  }

  /** Unblock a task back to ready. */
  async unblock(taskId: string): Promise<KanbanTask | undefined> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "blocked") return undefined;
    task.status = "ready";
    task.blockedReason = undefined;
    task.updatedAt = new Date().toISOString();
    await this.persist();
    return task;
  }

  /** Release a claim (task returns to ready, attempt counted). */
  async release(taskId: string, reason = "released"): Promise<KanbanTask | undefined> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "claimed") return undefined;
    task.attempts += 1;
    if (task.attempts >= this.maxAttempts) {
      task.status = "blocked";
      task.blockedReason = `released ${task.attempts}× (${reason}); attempts exhausted`;
    } else {
      task.status = "ready";
    }
    this.clearClaim(task);
    task.updatedAt = new Date().toISOString();
    await this.persist();
    return task;
  }

  // ------------------------------------------------------------------
  // Dispatcher helpers
  // ------------------------------------------------------------------

  /** Reclaim tasks whose claim lease has expired. Returns the reclaimed tasks. */
  async reclaimStale(now = Date.now()): Promise<KanbanTask[]> {
    const reclaimed: KanbanTask[] = [];
    for (const task of this.tasks.values()) {
      if (task.status !== "claimed" || !task.leaseExpiresAt) continue;
      if (new Date(task.leaseExpiresAt).getTime() > now) continue;

      task.attempts += 1;
      if (task.attempts >= this.maxAttempts) {
        task.status = "blocked";
        task.blockedReason = `worker crashed/stalled ${task.attempts}×; attempts exhausted`;
      } else {
        task.status = "ready";
      }
      this.clearClaim(task);
      task.updatedAt = new Date().toISOString();
      reclaimed.push(task);
    }
    if (reclaimed.length) await this.persist();
    return reclaimed;
  }

  /** Promote backlog tasks to ready while ready is starved. */
  async promoteReady(threshold = 1): Promise<KanbanTask[]> {
    const promoted: KanbanTask[] = [];
    while (this.list("ready").length < threshold) {
      const next = this.list("backlog")[0];
      if (!next) break;
      next.status = "ready";
      next.updatedAt = new Date().toISOString();
      promoted.push(next);
    }
    if (promoted.length) await this.persist();
    return promoted;
  }

  /** Remove terminal tasks older than the retention window. */
  async pruneDone(olderThanMs: number): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const [id, task] of this.tasks) {
      if (task.status !== "done") continue;
      if (new Date(task.updatedAt).getTime() < cutoff) {
        this.tasks.delete(id);
        removed += 1;
      }
    }
    if (removed) await this.persist();
    return removed;
  }

  private finish(task: KanbanTask, status: KanbanStatus): void {
    task.status = status;
    this.clearClaim(task);
    task.updatedAt = new Date().toISOString();
  }

  private clearClaim(task: KanbanTask): void {
    task.claimedBy = undefined;
    task.claimedAt = undefined;
    task.leaseExpiresAt = undefined;
  }
}

const PRIORITY_RANK: Record<KanbanPriority, number> = { urgent: 3, high: 2, normal: 1, low: 0 };

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export interface KanbanDispatcherOptions {
  board: KanbanBoard;
  /** Spawn a worker for a ready task with an assignee. */
  spawnWorker: (task: KanbanTask) => Promise<void>;
  /** Tick interval (ms). Default 5s. */
  tickMs?: number;
  /** Timer injection for tests. */
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  logger?: (message: string) => void;
}

/**
 * KanbanDispatcher — the long-lived loop inside the gateway. Each tick:
 * 1. Reclaims expired claims (crashed/stalled workers).
 * 2. Promotes backlog tasks when ready is starved.
 * 3. Spawns workers for assigned ready tasks (one per tick per assignee).
 */
export class KanbanDispatcher {
  private readonly board: KanbanBoard;
  private readonly spawnWorker: (task: KanbanTask) => Promise<void>;
  private readonly tickMs: number;
  private readonly log: (message: string) => void;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private timer: ReturnType<typeof setInterval> | null = null;
  private spawning = new Set<string>();

  constructor(options: KanbanDispatcherOptions) {
    this.board = options.board;
    this.spawnWorker = options.spawnWorker;
    this.tickMs = options.tickMs ?? 5_000;
    this.log = options.logger ?? (() => {});
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  start(): void {
    if (this.timer) return;
    this.timer = this.setIntervalFn(() => void this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.timer) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
  }

  /** One dispatcher pass (exposed for deterministic tests). */
  async tick(): Promise<void> {
    // 1. Reclaim stale claims.
    const reclaimed = await this.board.reclaimStale();
    for (const task of reclaimed) {
      this.log(`[kanban] reclaimed ${task.id} (attempt ${task.attempts})`);
    }

    // 2. Keep the ready column fed.
    await this.board.promoteReady();

    // 3. Spawn workers for assigned ready tasks not already spawning. The
    // dispatcher claims the task on the assignee's behalf first, so a failed
    // spawn can release (and count) the attempt.
    for (const task of this.board.list("ready")) {
      if (!task.assignee || this.spawning.has(task.id)) continue;
      this.spawning.add(task.id);
      try {
        const claimed = await this.board.claim(task.assignee, task.id);
        if (!claimed) continue; // someone else claimed it mid-tick
        await this.spawnWorker(task);
        this.log(`[kanban] spawned ${task.assignee} for ${task.id}`);
      } catch (err) {
        this.log(`[kanban] spawn failed for ${task.id}: ${err instanceof Error ? err.message : String(err)}`);
        await this.board.release(task.id, "spawn failed");
      } finally {
        this.spawning.delete(task.id);
      }
    }
  }
}
