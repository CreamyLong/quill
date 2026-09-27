/**
 * Dynamic Workflow Journal — append-only event log enabling crash-resume
 * and amend-with-warm-cache.
 *
 * Ported from ZCode's `SqliteDwfJournalStore` (`dwf_run` + `dwf_event`
 * tables), pragmatically scoped to a JSONL file per run (atomic appends,
 * no native deps). Every engine action is journaled; replaying the journal
 * rebuilds the `ImportedRunCache` (settled ask results keyed by site +
 * args hash) that `resume` and `amend` import so finished work is never
 * re-paid for.
 *
 * @module workflows/dynamic/journal
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Run lifecycle status (mirrors upstream `dwf_run.status`). */
export type WorkflowRunStatus =
  | "running"
  | "completed"
  | "errored"
  | "stopped"
  | "superseded";

/** One journaled event. */
export interface WorkflowEvent {
  /** Monotonic sequence number within the run. */
  seq: number;
  /** ISO timestamp. */
  time: string;
  /** Event type. */
  type:
    | "run_started"
    | "actor_spawned"
    | "ask_started"
    | "ask_settled"
    | "escalation_raised"
    | "escalation_resolved"
    | "log"
    | "run_superseded"
    | "run_settled";
  /** Event payload. */
  data: Record<string, unknown>;
}

/** Header record for a run (upstream `dwf_run` row). */
export interface WorkflowRunRecord {
  id: string;
  /** Session/thread that submitted the run. */
  parentSessionId: string | null;
  scriptText: string;
  scriptHash: string;
  status: WorkflowRunStatus;
  /** Settled result JSON when terminal. */
  resultJson: string | null;
  created_at: string;
  updated_at: string;
  /** Run this run superseded (amend chain). */
  superseded_from: string | null;
  /** Run this run was resumed from. */
  resumed_from: string | null;
}

/** Cache of finished ask results imported from a journal (upstream `ImportedRunCache`). */
export interface ImportedRunCache {
  /** askKey → settled result. */
  entries: Map<string, unknown>;
  /** Ask keys that were in flight (not settled) at the cut point. */
  inFlight: Set<string>;
}

/** Stable cache key for one ask (site label + args hash). */
export function askCacheKey(label: string, args: unknown): string {
  const argsHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(args ?? null))
    .digest("hex")
    .slice(0, 16);
  return `${label}:${argsHash}`;
}

/**
 * File-backed journal: one JSONL file per run, first line = run record,
 * subsequent lines = events. Appends are atomic (single write call).
 */
export class WorkflowJournal {
  private readonly file: string;

  constructor(
    readonly runId: string,
    dir: string,
  ) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `${runId}.jsonl`);
  }

  /** Create the journal with a `run_started` header event. */
  start(record: Omit<WorkflowRunRecord, "updated_at">): void {
    const header: WorkflowRunRecord = { ...record, updated_at: record.created_at };
    fs.writeFileSync(this.file, `${JSON.stringify({ run: header })}\n`);
  }

  /** Append one event; returns it with its assigned seq. */
  append(type: WorkflowEvent["type"], data: Record<string, unknown> = {}): WorkflowEvent {
    const events = this.readEvents();
    const event: WorkflowEvent = {
      seq: events.length + 1,
      time: new Date().toISOString(),
      type,
      data,
    };
    fs.appendFileSync(this.file, `${JSON.stringify(event)}\n`);
    return event;
  }

  /** Persist the terminal status + result (upstream settlement write). */
  settle(status: WorkflowRunStatus, resultJson: string | null): void {
    const record = this.readRecord();
    if (record === null) {
      return;
    }
    record.status = status;
    record.resultJson = resultJson;
    record.updated_at = new Date().toISOString();
    const events = this.readEvents();
    const lines = [JSON.stringify({ run: record }), ...events.map((e) => JSON.stringify(e))];
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, lines.join("\n") + "\n");
    fs.renameSync(tmp, this.file);
    this.append("run_settled", { status, result: resultJson });
  }

  /** Read the run record (first line). */
  readRecord(): WorkflowRunRecord | null {
    try {
      const first = fs
        .readFileSync(this.file, "utf-8")
        .split("\n")
        .find((l) => l.trim() !== "");
      if (first === undefined) {
        return null;
      }
      const parsed = JSON.parse(first) as { run?: WorkflowRunRecord };
      return parsed.run ?? null;
    } catch {
      return null;
    }
  }

  /** Read all events (skipping the header line). */
  readEvents(): WorkflowEvent[] {
    try {
      const lines = fs.readFileSync(this.file, "utf-8").split("\n");
      const events: WorkflowEvent[] = [];
      for (const line of lines.slice(1)) {
        if (line.trim() === "") {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as WorkflowEvent;
          if (typeof parsed.seq === "number" && typeof parsed.type === "string") {
            events.push(parsed);
          }
        } catch {
          // Tolerate a torn final line (crash mid-append).
        }
      }
      return events;
    } catch {
      return [];
    }
  }

  /**
   * Rebuild the imported-run cache from the journal: every settled ask is a
   * warm-cache entry; every started-but-unsettled ask is in-flight.
   */
  buildCache(): ImportedRunCache {
    const entries = new Map<string, unknown>();
    const inFlight = new Set<string>();
    for (const event of this.readEvents()) {
      const key = typeof event.data.key === "string" ? event.data.key : null;
      if (key === null) {
        continue;
      }
      if (event.type === "ask_started") {
        inFlight.add(key);
      } else if (event.type === "ask_settled") {
        inFlight.delete(key);
        entries.set(key, event.data.result);
      }
    }
    return { entries, inFlight };
  }
}

/** List all run records in a journal directory (newest first). */
export function listRunRecords(dir: string): WorkflowRunRecord[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => new WorkflowJournal(f.replace(/\.jsonl$/, ""), dir).readRecord())
      .filter((r): r is WorkflowRunRecord => r !== null)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  } catch {
    return [];
  }
}
