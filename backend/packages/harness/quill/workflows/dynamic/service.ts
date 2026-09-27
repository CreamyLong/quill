/**
 * Dynamic Workflow Service — submit / amend / resume lifecycle over the
 * engine + journal.
 *
 * Ported from ZCode's `DynamicWorkflowRunService` with its explicit
 * invariants, adapted to the JSONL journal:
 *
 * 1. The engine exclusively settles runs (the service only launches).
 * 2. Compile exactly once per submit — the service computes the scriptHash.
 * 3. "No journal, no service" — a run without a journal file is not
 *    resumable and not amendable.
 * 4. Orphaned `running` rows (crashed process) are reconciled to
 *    `stopped(interrupted)` on startup.
 * 5. `amend` supersedes the predecessor *before* launching the successor
 *    and imports its finished asks as a warm cache.
 * 6. `resume` rebuilds the cache from the run's own journal and launches
 *    with a `resumed_from` pointer.
 * 7. `stop` aborts in-flight runs with `stopped` and waits for the
 *    engine-written settlement.
 *
 * @module workflows/dynamic/service
 */

import crypto from "node:crypto";
import path from "node:path";

import { projectRoot } from "../../config/runtime_paths.js";
import { compileWorkflowScript, WorkflowCompileError } from "./compiler.js";
import {
  WorkflowJournal,
  listRunRecords,
  type WorkflowRunRecord,
  type WorkflowRunStatus,
} from "./journal.js";
import {
  respondToParkedEscalation,
  runWorkflowScript,
  type RunningWorkflow,
  type WorkflowDriver,
} from "./engine.js";

/** Live handle registered while a run is executing. */
interface LiveRun {
  running: RunningWorkflow;
  /** Settles when the engine writes its terminal journal event. */
  settlement: Promise<void>;
}

export interface DynamicWorkflowServiceOptions {
  /** Directory for journal files (default `<projectRoot>/.scitops/dynamic-workflows`). */
  journalDir?: string;
  /** Driver providing side effects (required for launches). */
  driver: WorkflowDriver;
  /** Max concurrent asks per run. Default 4. */
  maxConcurrency?: number;
}

export interface SubmitOptions {
  /** Session/thread that submitted the run (for listing / ownership). */
  parentSessionId?: string | null;
}

/** Public view of a run (no script body). */
export type WorkflowRunView = Omit<WorkflowRunRecord, "scriptText">;

/**
 * Lifecycle service for dynamic workflow runs. One instance per process;
 * the gateway constructs it with a driver wired to the subagent runtime.
 */
export class DynamicWorkflowService {
  private readonly journalDir: string;
  private readonly driver: WorkflowDriver;
  private readonly maxConcurrency: number;
  private readonly live = new Map<string, LiveRun>();

  constructor(options: DynamicWorkflowServiceOptions) {
    // Resolve against the project root, never cwd — GUI apps (Tauri) launch
    // with cwd = "/" and `/.scitops` is unwritable.
    this.journalDir =
      options.journalDir ?? path.join(projectRoot(), ".scitops", "dynamic-workflows");
    this.driver = options.driver;
    this.maxConcurrency = options.maxConcurrency ?? 4;
    this.reconcileOrphanedRuns();
  }

  /**
   * Invariant 4: runs left `running` by a crashed process are reconciled to
   * `stopped(interrupted)` — for this session only (we cannot know what
   * another live process owns).
   */
  private reconcileOrphanedRuns(): void {
    for (const record of listRunRecords(this.journalDir)) {
      if (record.status === "running") {
        const journal = new WorkflowJournal(record.id, this.journalDir);
        journal.settle("stopped", JSON.stringify({ interrupted: true }));
      }
    }
  }

  /**
   * Submit a new workflow script. Compiles exactly once (invariant 2),
   * journals `run_started`, and launches the engine.
   */
  submit(script: string, options: SubmitOptions = {}): { runId: string } {
    const compiled = compileWorkflowScript(script);
    const runId = crypto.randomUUID();
    const now = new Date().toISOString();
    const journal = new WorkflowJournal(runId, this.journalDir);
    journal.start({
      id: runId,
      parentSessionId: options.parentSessionId ?? null,
      scriptText: script,
      scriptHash: compiled.scriptHash,
      status: "running",
      resultJson: null,
      created_at: now,
      superseded_from: null,
      resumed_from: null,
    });
    journal.append("run_started", { scriptHash: compiled.scriptHash, sites: compiled.sites });
    this.launch(runId, compiled, journal);
    return { runId };
  }

  /**
   * Amend: pre-flight (invariant 3 — journal must exist and be readable),
   * mint a new runId, supersede the predecessor, import its finished asks
   * as a warm cache, and launch the successor with the updated script.
   */
  amend(runId: string, newScript: string): { runId: string } {
    const predecessor = this.getRecordOrThrow(runId);
    const compiled = compileWorkflowScript(newScript);
    const predecessorJournal = new WorkflowJournal(runId, this.journalDir);
    const cache = predecessorJournal.buildCache();

    // Supersede before launching (invariant 5): stop the live run if any,
    // then journal the supersession on the predecessor.
    const live = this.live.get(runId);
    if (live !== undefined) {
      live.running.stop();
    }
    predecessorJournal.settle("superseded", null);
    predecessorJournal.append("run_superseded", { by: "amend" });

    const newRunId = crypto.randomUUID();
    const now = new Date().toISOString();
    const journal = new WorkflowJournal(newRunId, this.journalDir);
    journal.start({
      id: newRunId,
      parentSessionId: predecessor.parentSessionId,
      scriptText: newScript,
      scriptHash: compiled.scriptHash,
      status: "running",
      resultJson: null,
      created_at: now,
      superseded_from: runId,
      resumed_from: null,
    });
    journal.append("run_started", {
      scriptHash: compiled.scriptHash,
      superseded_from: runId,
      imported_cache_entries: cache.entries.size,
    });
    this.launch(newRunId, compiled, journal, cache);
    return { runId: newRunId };
  }

  /**
   * Resume an interrupted run: rebuild the cache from its own journal
   * (invariant 6) and relaunch with a `resumed_from` pointer.
   */
  resume(runId: string): { runId: string } {
    const record = this.getRecordOrThrow(runId);
    if (record.status === "running" && this.live.has(runId)) {
      throw new Error(`run ${runId} is already running`);
    }
    const journal = new WorkflowJournal(runId, this.journalDir);
    const cache = journal.buildCache();
    const compiled = compileWorkflowScript(record.scriptText);

    const newRunId = crypto.randomUUID();
    const now = new Date().toISOString();
    const newJournal = new WorkflowJournal(newRunId, this.journalDir);
    newJournal.start({
      id: newRunId,
      parentSessionId: record.parentSessionId,
      scriptText: record.scriptText,
      scriptHash: record.scriptHash,
      status: "running",
      resultJson: null,
      created_at: now,
      superseded_from: null,
      resumed_from: runId,
    });
    newJournal.append("run_started", {
      scriptHash: record.scriptHash,
      resumed_from: runId,
      imported_cache_entries: cache.entries.size,
    });
    this.launch(newRunId, compiled, newJournal, cache);
    return { runId: newRunId };
  }

  /** Launch is the single registration point (invariant 6 upstream: trackSettlement). */
  private launch(
    runId: string,
    compiled: ReturnType<typeof compileWorkflowScript>,
    journal: WorkflowJournal,
    cache?: Parameters<typeof runWorkflowScript>[1]["cache"],
  ): void {
    const running = runWorkflowScript(compiled, {
      journal,
      driver: this.driver,
      cache,
      maxConcurrency: this.maxConcurrency,
    });
    const settlement = running.completion.then(
      () => undefined,
      () => undefined,
    );
    this.live.set(runId, { running, settlement });
    void settlement.then(() => {
      if (this.live.get(runId)?.running === running) {
        this.live.delete(runId);
      }
    });
  }

  /** Resolve a parked escalation (main-agent answer to a workflow question). */
  resolveQuestion(runId: string, escalationId: string, answer: string): boolean {
    const live = this.live.get(runId);
    if (live === undefined) {
      return false;
    }
    const parked = live.running.escalations.get(escalationId);
    if (parked === undefined) {
      return false;
    }
    const journal = new WorkflowJournal(runId, this.journalDir);
    respondToParkedEscalation(journal, parked, answer);
    return true;
  }

  /** List parked escalations for a live run. */
  listEscalations(runId: string): Array<{ id: string; question: string }> {
    const live = this.live.get(runId);
    if (live === undefined) {
      return [];
    }
    return [...live.running.escalations.values()].map((e) => ({ id: e.id, question: e.question }));
  }

  /** Stop a live run; waits for the engine-written settlement (invariant 7). */
  async stop(runId: string): Promise<boolean> {
    const live = this.live.get(runId);
    if (live === undefined) {
      return false;
    }
    live.running.stop();
    await live.settlement;
    return true;
  }

  /** Public view of one run. */
  get(runId: string): WorkflowRunView | null {
    const record = new WorkflowJournal(runId, this.journalDir).readRecord();
    if (record === null) {
      return null;
    }
    const { scriptText: _scriptText, ...view } = record;
    return view;
  }

  /** Public views of all runs, newest first. */
  list(): WorkflowRunView[] {
    return listRunRecords(this.journalDir).map(({ scriptText: _s, ...view }) => view);
  }

  /** Events of one run (progress polling). */
  events(runId: string): unknown[] {
    return new WorkflowJournal(runId, this.journalDir).readEvents();
  }

  private getRecordOrThrow(runId: string): WorkflowRunRecord {
    const record = new WorkflowJournal(runId, this.journalDir).readRecord();
    if (record === null) {
      throw new Error(`run ${runId} not found (no journal — invariant 3)`);
    }
    return record;
  }
}

/** Re-exported for gateway wiring convenience. */
export { WorkflowCompileError };
export type { WorkflowRunStatus };
