/**
 * ScheduledTaskScheduler — drives due-task firing on a fixed tick interval.
 *
 * Design notes:
 * - The scheduler is deliberately framework-agnostic: it receives a store of
 *   task definitions and a `fireRun` callback that the gateway implements
 *   (the callback knows how to create/reuse a thread and stream the graph).
 * - The clock is injectable so tests can advance time deterministically.
 * - An in-flight guard prevents a task from firing a second run while its
 *   previous run has not yet completed.
 */

import type { ScheduledTask, ScheduledRunStatus } from "./types.js";
import { nextCronRun } from "./cron.js";

/** Minimal contract the scheduler needs from a task store. */
export interface ScheduledTaskStore {
  list(): ScheduledTask[];
  get(id: string): ScheduledTask | null;
  save(task: ScheduledTask): void;
  delete(id: string): boolean;
}

/** Terminal outcome of a fired scheduled run. */
export interface ScheduledFireResult {
  status: ScheduledRunStatus;
  /** Thread the run executed in (new or pinned). */
  threadId?: string;
  /** Run id of the fired run (absent when skipped). */
  runId?: string;
}

export interface SchedulerOptions {
  store: ScheduledTaskStore;
  /**
   * Fire one scheduled run for a due task.
   * Resolves with the terminal outcome (status + thread/run identifiers).
   */
  fireRun: (task: ScheduledTask) => Promise<ScheduledFireResult>;
  /** Tick interval in milliseconds. Default: 30_000. */
  tickMs?: number;
  /** Injectable clock; default is `() => new Date()`. */
  now?: () => Date;
  /** Optional log sink. */
  logger?: (message: string) => void;
}

/**
 * Compute the next run time for a task given the time its previous run
 * finished (or `after` = now for a freshly created task).
 *
 * Returns an ISO-8601 string, or `null` for disabled tasks / cron
 * expressions that never match within the scan window.
 */
export function computeNextRun(task: ScheduledTask, after: Date): string | null {
  if (!task.enabled) {
    return null;
  }
  const s = task.schedule;
  if (s.kind === "interval") {
    return new Date(after.getTime() + s.everySeconds * 1000).toISOString();
  }
  const next = nextCronRun(s.expression, after);
  return next ? next.toISOString() : null;
}

export class ScheduledTaskScheduler {
  private readonly store: ScheduledTaskStore;
  private readonly fireRun: SchedulerOptions["fireRun"];
  private readonly tickMs: number;
  private readonly now: () => Date;
  private readonly logger: (message: string) => void;
  private timer: NodeJS.Timeout | null = null;
  /** Task ids that have a run currently in flight. */
  private inFlight: Set<string> = new Set();

  constructor(options: SchedulerOptions) {
    this.store = options.store;
    this.fireRun = options.fireRun;
    this.tickMs = options.tickMs ?? 30_000;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? (() => {});
  }

  /** Start the periodic tick. The timer is unref'd so it never keeps the
   *  Node.js event loop alive (important in tests and REPL contexts). */
  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger(`[scheduler] tick error: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, this.tickMs);
    this.timer.unref?.();
    this.logger(`[scheduler] started (tick every ${this.tickMs} ms)`);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Single tick: find all due tasks, fire them sequentially, and persist the
   * resulting bookkeeping. Sequential firing keeps resource usage bounded;
   * high-throughput use can swap to a bounded-concurrency queue.
   */
  async tick(now: Date = this.now()): Promise<void> {
    const tasks = this.store.list();
    for (const task of tasks) {
      if (!task.enabled) continue;
      if (task.next_run_at === null) continue;
      if (now.getTime() < new Date(task.next_run_at).getTime()) continue;
      if (this.inFlight.has(task.id)) continue;

      this.inFlight.add(task.id);
      this.logger(`[scheduler] firing task '${task.name}' (${task.id})`);
      let result: ScheduledFireResult;
      try {
        result = await this.fireRun(task);
      } catch (err) {
        result = { status: "error" };
        this.logger(
          `[scheduler] fireRun threw for '${task.name}': ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        this.inFlight.delete(task.id);
      }

      // Re-read from the store so we never clobber concurrent updates.
      const fresh = this.store.get(task.id) ?? task;
      const finishedAt = now;
      const updated: ScheduledTask = {
        ...fresh,
        last_run_at: finishedAt.toISOString(),
        last_status: result.status,
        last_run_id: result.status === "skipped" ? fresh.last_run_id : (result.runId ?? null),
        updated_at: finishedAt.toISOString(),
        run_count: fresh.run_count + (result.status === "skipped" ? 0 : 1),
      };
      updated.next_run_at = computeNextRun(updated, finishedAt);
      this.store.save(updated);
    }
  }

  /** Whether a task currently has a run in progress. */
  isInFlight(id: string): boolean {
    return this.inFlight.has(id);
  }
}
