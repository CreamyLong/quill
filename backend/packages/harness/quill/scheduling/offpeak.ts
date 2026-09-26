/**
 * Off-Peak Tasks — deferred execution with server-admitted tickets.
 *
 * Ported from ZCode's Off-Peak runtime ("闲时任务"): users queue expensive
 * tasks to run while the system is idle (off-peak hours), instead of burning
 * peak-time compute. Admission is ticket-based — a task must hold an ACTIVE
 * ticket before it may start, and tickets expire if not used in time. Expired
 * tickets are detected automatically and re-issued without losing the task.
 *
 * Two cooperating state machines:
 * - Task (client-facing): queued → paused? → running → completed | failed | cancelled
 *   A running task may pause for permission/elicitation and resume.
 * - Ticket (server admission): queued → ready → active → settled | expired
 *
 * This module provides:
 * - OffPeakTaskStore: durable task records with history
 * - TicketAdmission: server-side ticket lifecycle with TTL and re-ticket
 * - OffPeakScheduler: tick loop that admits + dispatches tasks when the
 *   system is idle (injectable predicate) and concurrency allows
 *
 * @module scheduling/offpeak
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OffPeakTaskStatus =
  | "queued"
  | "paused"
  | "running"
  | "permission"
  | "elicitation"
  | "completed"
  | "failed"
  | "cancelled";

export type TicketState = "queued" | "ready" | "active" | "settled" | "expired";

export interface OffPeakTicket {
  /** Ticket ID (one per admission attempt). */
  id: string;
  /** Current admission state. */
  state: TicketState;
  /** When the ticket was requested. */
  requestedAt: string;
  /** When the server marked it ready (eligible to run). */
  readyAt?: string;
  /** When the task holding the ticket started running. */
  activatedAt?: string;
  /** When the ticket was settled (task finished) or expired. */
  closedAt?: string;
  /** Attempt number — 1 for the first ticket, 2+ after re-ticket. */
  attempt: number;
}

export interface OffPeakTask {
  /** Unique task ID. */
  id: string;
  /** Thread the task will run in. */
  threadId: string;
  /** The prompt to execute when admitted. */
  prompt: string;
  /** Optional model override for the deferred run. */
  model?: string;
  /** Current task status. */
  status: OffPeakTaskStatus;
  /** Why the task is in its current status (pause reason, failure detail…). */
  statusDetail?: string;
  /** Admission tickets issued for this task (history of attempts). */
  tickets: OffPeakTicket[];
  /** Number of re-tickets after expiry. */
  reticketCount: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Result summary after completion. */
  result?: string;
  /** Error message after failure. */
  error?: string;
}

export interface OffPeakConfig {
  /** How long the system must be idle before off-peak tasks are admitted (ms). */
  idleThresholdMs: number;
  /** Ticket lifetime once READY (ms) — unused tickets expire and are re-issued. */
  ticketTtlMs: number;
  /** Maximum off-peak tasks running concurrently. */
  maxConcurrent: number;
  /** Scheduler tick interval (ms). */
  tickMs: number;
  /** Maximum re-ticket attempts before a task fails. */
  maxRetickets: number;
}

export const DEFAULT_OFFPEAK_CONFIG: OffPeakConfig = {
  idleThresholdMs: 60_000,
  ticketTtlMs: 10 * 60_000,
  maxConcurrent: 1,
  tickMs: 5_000,
  maxRetickets: 3,
};

// ---------------------------------------------------------------------------
// Ticket admission (server-side state machine)
// ---------------------------------------------------------------------------

/**
 * TicketAdmission — the server side of the off-peak protocol. Tasks request a
 * ticket; the server moves it through queued → ready → active → settled, or
 * expires it if the task never activates within the TTL.
 */
export class TicketAdmission {
  private readonly ttlMs: number;
  private readonly maxRetickets: number;

  constructor(config: Pick<OffPeakConfig, "ticketTtlMs" | "maxRetickets"> = DEFAULT_OFFPEAK_CONFIG) {
    this.ttlMs = config.ticketTtlMs;
    this.maxRetickets = config.maxRetickets;
  }

  /** Issue a fresh queued ticket for a task. */
  issue(task: OffPeakTask): OffPeakTicket {
    const ticket: OffPeakTicket = {
      id: randomUUID(),
      state: "queued",
      requestedAt: new Date().toISOString(),
      attempt: task.tickets.length + 1,
    };
    task.tickets.push(ticket);
    task.updatedAt = new Date().toISOString();
    return ticket;
  }

  /** Mark a queued ticket as ready — the task is eligible to run. */
  markReady(task: OffPeakTask): OffPeakTicket | undefined {
    const ticket = this.current(task);
    if (!ticket || ticket.state !== "queued") return undefined;
    ticket.state = "ready";
    ticket.readyAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    return ticket;
  }

  /** Activate a ready ticket — the task is starting now. */
  activate(task: OffPeakTask): OffPeakTicket | undefined {
    const ticket = this.current(task);
    if (!ticket || ticket.state !== "ready") return undefined;
    ticket.state = "active";
    ticket.activatedAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    return ticket;
  }

  /** Settle the active ticket — the task finished (any terminal status). */
  settle(task: OffPeakTask): OffPeakTicket | undefined {
    const ticket = this.current(task);
    if (!ticket || ticket.state !== "active") return undefined;
    ticket.state = "settled";
    ticket.closedAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    return ticket;
  }

  /**
   * Detect and expire stale READY tickets. Returns the expired ticket, or
   * undefined. When the task still wants to run, a replacement ticket is
   * re-issued automatically (up to maxRetickets).
   */
  expireStale(task: OffPeakTask): { expired: OffPeakTicket; reticketed: boolean } | undefined {
    const ticket = this.current(task);
    if (!ticket || ticket.state !== "ready" || !ticket.readyAt) return undefined;

    const readyFor = Date.now() - new Date(ticket.readyAt).getTime();
    if (readyFor < this.ttlMs) return undefined;

    ticket.state = "expired";
    ticket.closedAt = new Date().toISOString();

    // Re-ticket automatically while the task still wants to run and attempts
    // remain. Exhausted attempts surface as a failed task.
    const wantsRun = task.status === "queued" || task.status === "paused";
    const attemptsLeft = task.reticketCount < this.maxRetickets;
    const reticketed = wantsRun && attemptsLeft;
    if (reticketed) {
      task.reticketCount += 1;
      this.issue(task);
    }
    task.updatedAt = new Date().toISOString();
    return { expired: ticket, reticketed };
  }

  /** The task's most recent (current) ticket. */
  current(task: OffPeakTask): OffPeakTicket | undefined {
    return task.tickets[task.tickets.length - 1];
  }
}

// ---------------------------------------------------------------------------
// Task store
// ---------------------------------------------------------------------------

/**
 * OffPeakTaskStore — in-memory task records with listener notifications.
 * The gateway keeps one store per process; persistence layers can subscribe
 * via onChange and mirror records to disk.
 */
export class OffPeakTaskStore {
  private tasks = new Map<string, OffPeakTask>();
  private listeners: Array<(task: OffPeakTask) => void> = [];

  create(threadId: string, prompt: string, model?: string): OffPeakTask {
    const now = new Date().toISOString();
    const task: OffPeakTask = {
      id: `offpeak_${randomUUID().slice(0, 8)}`,
      threadId,
      prompt,
      model,
      status: "queued",
      tickets: [],
      reticketCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    this.notify(task);
    return task;
  }

  get(id: string): OffPeakTask | undefined {
    return this.tasks.get(id);
  }

  list(): OffPeakTask[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Terminal tasks (completed/failed/cancelled), newest first. */
  history(): OffPeakTask[] {
    return this.list().filter((t) => isTerminal(t));
  }

  /** Tasks that still want to run, in submission order. */
  pending(): OffPeakTask[] {
    return this.list()
      .filter((t) => t.status === "queued" || t.status === "paused")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Transition a task's status with an optional detail string. */
  setStatus(task: OffPeakTask, status: OffPeakTaskStatus, detail?: string): void {
    task.status = status;
    task.statusDetail = detail;
    task.updatedAt = new Date().toISOString();
    if (status === "running" && !task.startedAt) task.startedAt = task.updatedAt;
    if (isTerminal(task)) task.finishedAt = task.updatedAt;
    this.notify(task);
  }

  /** Record a completed task's result. */
  complete(task: OffPeakTask, result: string): void {
    task.result = result;
    this.setStatus(task, "completed");
  }

  /** Record a failed task's error. */
  fail(task: OffPeakTask, error: string): void {
    task.error = error;
    this.setStatus(task, "failed", error);
  }

  /** Cancel a task (only non-terminal tasks can be cancelled). */
  cancel(task: OffPeakTask): boolean {
    if (isTerminal(task)) return false;
    this.setStatus(task, "cancelled");
    return true;
  }

  /** Pause a queued/running task (e.g. waiting for permission). */
  pause(task: OffPeakTask, reason: string): boolean {
    if (task.status !== "queued" && task.status !== "running") return false;
    this.setStatus(task, "paused", reason);
    return true;
  }

  /** Resume a paused task back to the queue. */
  resume(task: OffPeakTask): boolean {
    if (task.status !== "paused") return false;
    this.setStatus(task, "queued");
    return true;
  }

  onChange(listener: (task: OffPeakTask) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(task: OffPeakTask): void {
    for (const listener of this.listeners) {
      try {
        listener(task);
      } catch {
        // listener errors must not break the state machine
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export interface OffPeakSchedulerOptions {
  store: OffPeakTaskStore;
  admission: TicketAdmission;
  config?: Partial<OffPeakConfig>;
  /** Returns true when the system is considered idle. */
  isSystemIdle: () => boolean;
  /** Start an admitted task. Resolve with a result summary, reject on error. */
  startTask: (task: OffPeakTask) => Promise<string>;
  /** Clock/timer injection for tests. */
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  /** Log sink. */
  logger?: (message: string) => void;
}

/**
 * OffPeakScheduler — one tick loop shared by all deferred tasks. On each tick:
 * 1. Expire stale READY tickets (auto re-ticket while attempts remain).
 * 2. When the system has been idle long enough and concurrency allows,
 *    mark the next pending task's ticket READY and activate it.
 * 3. Dispatch the activated task via startTask; settle its ticket on finish.
 */
export class OffPeakScheduler {
  private readonly store: OffPeakTaskStore;
  private readonly admission: TicketAdmission;
  private readonly config: OffPeakConfig;
  private readonly isSystemIdle: () => boolean;
  private readonly startTask: (task: OffPeakTask) => Promise<string>;
  private readonly log: (message: string) => void;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;

  private timer: ReturnType<typeof setInterval> | null = null;
  private idleSince: number | null = null;
  private activeCount = 0;
  private stopped = false;

  constructor(options: OffPeakSchedulerOptions) {
    this.store = options.store;
    this.admission = options.admission;
    this.config = { ...DEFAULT_OFFPEAK_CONFIG, ...options.config };
    this.isSystemIdle = options.isSystemIdle;
    this.startTask = options.startTask;
    this.log = options.logger ?? (() => {});
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  /** Start the tick loop. */
  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = this.setIntervalFn(() => this.tick(), this.config.tickMs);
  }

  /** Stop the tick loop. In-flight tasks keep running; queued tasks wait. */
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
  }

  /** True when the scheduler is currently dispatching at max concurrency. */
  get runningCount(): number {
    return this.activeCount;
  }

  /** Run one scheduler pass (exposed for deterministic tests). */
  async tick(): Promise<void> {
    if (this.stopped) return;

    // Phase 1 — expire stale tickets, re-ticketing where allowed.
    for (const task of this.store.pending()) {
      const outcome = this.admission.expireStale(task);
      if (outcome) {
        if (outcome.reticketed) {
          this.log(`[offpeak] ticket expired for ${task.id}; re-ticketed (attempt ${task.reticketCount + 1})`);
        } else if (!isTerminal(task)) {
          this.store.fail(task, `Ticket expired after ${task.reticketCount + 1} attempts`);
          this.log(`[offpeak] ${task.id} failed: ticket attempts exhausted`);
        }
      }
    }

    // Phase 2 — track idle streak.
    if (this.isSystemIdle()) {
      if (this.idleSince === null) this.idleSince = Date.now();
    } else {
      this.idleSince = null;
      return;
    }
    if (Date.now() - this.idleSince < this.config.idleThresholdMs) return;

    // Phase 3 — admit pending tasks while concurrency allows. Iterating a
    // snapshot (not a live find-loop) guarantees forward progress: a task
    // whose ticket cannot be activated is skipped for this pass instead of
    // spinning the loop.
    const candidates = this.store.pending().filter((t) => t.status === "queued");
    for (const task of candidates) {
      if (this.activeCount >= this.config.maxConcurrent) break;

      // Issue/move the ticket through ready → active.
      if (!this.admission.current(task)) this.admission.issue(task);
      if (this.admission.current(task)?.state === "queued") {
        this.admission.markReady(task);
      }
      if (!this.admission.activate(task)) continue;

      this.store.setStatus(task, "running");
      this.activeCount += 1;
      this.log(`[offpeak] admitted ${task.id} (ticket ${this.admission.current(task)?.id.slice(0, 8)})`);

      // Dispatch without awaiting so the loop stays responsive.
      void this.dispatch(task);
    }
  }

  private async dispatch(task: OffPeakTask): Promise<void> {
    try {
      const result = await this.startTask(task);
      this.store.complete(task, result);
    } catch (err) {
      this.store.fail(task, err instanceof Error ? err.message : String(err));
    } finally {
      this.admission.settle(task);
      this.activeCount -= 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when the task has reached a terminal status. */
export function isTerminal(task: OffPeakTask): boolean {
  return task.status === "completed" || task.status === "failed" || task.status === "cancelled";
}
