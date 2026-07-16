/**
 * In-memory RunStore. Used when database.backend=memory (default) and in tests.
 *
 * Equivalent to the original RunManager._runs dict behavior.
 */

import { nowIso } from "../../../utils/time.js";
import {
  RunStore,
  type AggregateTokensResult,
  type PutRunArgs,
  type RunRow,
  type UpdateRunCompletionArgs,
  type UpdateRunProgressArgs,
} from "./base.js";

export class MemoryRunStore extends RunStore {
  private _runs: Map<string, RunRow> = new Map();
  // Secondary index: thread_id -> insertion-ordered run_id set (a Map is used as
  // an ordered set), maintained in lockstep with `_runs` so per-thread queries
  // avoid O(total in-memory runs) full scans.
  private _runsByThread: Map<string, Map<string, null>> = new Map();

  private _indexRun(runId: string, threadId: string): void {
    let bucket = this._runsByThread.get(threadId);
    if (bucket === undefined) {
      bucket = new Map();
      this._runsByThread.set(threadId, bucket);
    }
    bucket.set(runId, null);
  }

  private _unindexRun(runId: string, threadId: string): void {
    const bucket = this._runsByThread.get(threadId);
    if (bucket !== undefined) {
      bucket.delete(runId);
      if (bucket.size === 0) {
        this._runsByThread.delete(threadId);
      }
    }
  }

  async put(runId: string, args: PutRunArgs): Promise<void> {
    const now = nowIso();
    this._runs.set(runId, {
      run_id: runId,
      thread_id: args.thread_id,
      assistant_id: args.assistant_id ?? null,
      user_id: args.user_id ?? null,
      model_name: args.model_name ?? null,
      status: args.status ?? "pending",
      multitask_strategy: args.multitask_strategy ?? "reject",
      metadata: args.metadata ?? {},
      kwargs: args.kwargs ?? {},
      error: args.error ?? null,
      created_at: args.created_at ?? now,
      updated_at: now,
    });
    this._indexRun(runId, args.thread_id);
  }

  async get(runId: string, options: { user_id?: string | null } = {}): Promise<RunRow | null> {
    const { user_id = null } = options;
    const run = this._runs.get(runId);
    if (run === undefined) {
      return null;
    }
    if (user_id !== null && user_id !== undefined && run["user_id"] !== user_id) {
      return null;
    }
    return run;
  }

  async listByThread(
    threadId: string,
    options: { user_id?: string | null; limit?: number } = {}
  ): Promise<RunRow[]> {
    const { user_id = null, limit = 100 } = options;
    // Use the thread index for an O(runs-in-thread) lookup instead of scanning
    // every run. `_runs.get` is defense-in-depth: it drops a stale id still in
    // the index but already gone from `_runs`.
    const runIds = this._runsByThread.get(threadId);
    if (runIds === undefined || runIds.size === 0) {
      return [];
    }
    const results: RunRow[] = [];
    for (const runId of runIds.keys()) {
      const run = this._runs.get(runId);
      if (run !== undefined && (user_id === null || user_id === undefined || run["user_id"] === user_id)) {
        results.push(run);
      }
    }
    results.sort((a, b) => compareCreatedAtDesc(a, b));
    return results.slice(0, limit);
  }

  async updateStatus(runId: string, status: string, options: { error?: string | null } = {}): Promise<boolean | null> {
    const { error = null } = options;
    const run = this._runs.get(runId);
    if (run !== undefined) {
      run["status"] = status;
      if (error !== null && error !== undefined) {
        run["error"] = error;
      }
      run["updated_at"] = nowIso();
      return true;
    }
    return false;
  }

  async updateModelName(runId: string, modelName: string | null): Promise<void> {
    const run = this._runs.get(runId);
    if (run !== undefined) {
      run["model_name"] = modelName;
      run["updated_at"] = nowIso();
    }
  }

  async delete(runId: string): Promise<void> {
    const run = this._runs.get(runId);
    if (run !== undefined) {
      this._runs.delete(runId);
      this._unindexRun(runId, run.thread_id);
    }
  }

  async updateRunCompletion(runId: string, args: UpdateRunCompletionArgs): Promise<boolean | null> {
    const run = this._runs.get(runId);
    if (run !== undefined) {
      run["status"] = args.status;
      for (const [key, value] of Object.entries(args)) {
        if (key === "status") {
          continue;
        }
        if (value !== null && value !== undefined) {
          run[key] = value;
        }
      }
      run["updated_at"] = nowIso();
      return true;
    }
    return false;
  }

  override async updateRunProgress(runId: string, args: UpdateRunProgressArgs): Promise<void> {
    const run = this._runs.get(runId);
    if (run !== undefined && run["status"] === "running") {
      for (const [key, value] of Object.entries(args)) {
        if (value !== null && value !== undefined) {
          run[key] = value;
        }
      }
      run["updated_at"] = nowIso();
    }
  }

  async listPending(options: { before?: string | null } = {}): Promise<RunRow[]> {
    const now = options.before ?? nowIso();
    const results = [...this._runs.values()].filter(
      (r) => r["status"] === "pending" && (r.created_at ?? "") <= now
    );
    results.sort((a, b) => compareCreatedAtAsc(a, b));
    return results;
  }

  async listInflight(options: { before?: string | null } = {}): Promise<RunRow[]> {
    const now = options.before ?? nowIso();
    const results = [...this._runs.values()].filter(
      (r) => (r["status"] === "pending" || r["status"] === "running") && (r.created_at ?? "") <= now
    );
    results.sort((a, b) => compareCreatedAtAsc(a, b));
    return results;
  }

  async aggregateTokensByThread(
    threadId: string,
    options: { include_active?: boolean } = {}
  ): Promise<AggregateTokensResult> {
    const { include_active = false } = options;
    const statuses = include_active ? ["success", "error", "running"] : ["success", "error"];
    // Use the thread index for an O(runs-in-thread) lookup (mirrors listByThread).
    const runIds = this._runsByThread.get(threadId);
    const completed: RunRow[] = [];
    if (runIds !== undefined) {
      for (const runId of runIds.keys()) {
        const run = this._runs.get(runId);
        if (run !== undefined && statuses.includes(String(run["status"]))) {
          completed.push(run);
        }
      }
    }
    const byModel: Record<string, { tokens: number; runs: number }> = {};
    for (const r of completed) {
      const usageByModel = (r["token_usage_by_model"] as Record<string, { total_tokens?: number }> | undefined) ?? {};
      if (Object.keys(usageByModel).length > 0) {
        for (const [model, usage] of Object.entries(usageByModel)) {
          const entry = (byModel[model] ??= { tokens: 0, runs: 0 });
          entry.tokens += usage?.total_tokens ?? 0;
          entry.runs += 1;
        }
      } else {
        // Fallback for rows written before per-model accounting landed: attribute
        // the whole run to its single `model_name`.
        const model = (r["model_name"] as string | null) || "unknown";
        const entry = (byModel[model] ??= { tokens: 0, runs: 0 });
        entry.tokens += (r["total_tokens"] as number) ?? 0;
        entry.runs += 1;
      }
    }
    return {
      total_tokens: sumField(completed, "total_tokens"),
      total_input_tokens: sumField(completed, "total_input_tokens"),
      total_output_tokens: sumField(completed, "total_output_tokens"),
      total_runs: completed.length,
      by_model: byModel,
      by_caller: {
        lead_agent: sumField(completed, "lead_agent_tokens"),
        subagent: sumField(completed, "subagent_tokens"),
        middleware: sumField(completed, "middleware_tokens"),
      },
    };
  }
}

function sumField(rows: RunRow[], field: string): number {
  return rows.reduce((acc, r) => acc + ((r[field] as number) ?? 0), 0);
}

function compareCreatedAtAsc(a: RunRow, b: RunRow): number {
  const av = a.created_at ?? "";
  const bv = b.created_at ?? "";
  return av < bv ? -1 : av > bv ? 1 : 0;
}

function compareCreatedAtDesc(a: RunRow, b: RunRow): number {
  return -compareCreatedAtAsc(a, b);
}
