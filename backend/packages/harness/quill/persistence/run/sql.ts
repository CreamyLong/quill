/**
 * SQLite-backed RunStore implementation (``node:sqlite`` port).
 *
 * Ports ``quill.persistence.run.sql``. Each method mirrors the SQLAlchemy
 * repository's query and owner-filtering logic against a shared ``DatabaseSync``
 * handle. JSON columns are stored as TEXT and (de)serialized at the boundary;
 * datetimes are stored as ISO strings (lexicographically ordered/compared).
 */

import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import {
  AUTO,
  resolveUserId,
  type RunCompletionOptions,
  type RunProgressOptions,
  type RunPutOptions,
  type RunStore,
  type UserIdParam,
} from "../_deps.js";
import { coerceIso, nowIso } from "../../utils/time.js";
import { RUNS_TABLE } from "./model.js";

type RawRow = Record<string, unknown>;

export class RunRepository implements RunStore {
  private readonly _db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this._db = db;
  }

  /** Normalize model_name for storage: strip whitespace, truncate to 128 chars. */
  private static _normalizeModelName(modelName: string | null | undefined): string | null {
    if (modelName === null || modelName === undefined) {
      return null;
    }
    let normalized = (typeof modelName === "string" ? modelName : String(modelName)).trim();
    if (normalized.length > 128) {
      normalized = normalized.slice(0, 128);
    }
    return normalized;
  }

  /** Ensure obj is JSON-serializable. Falls back to String(). */
  private static _safeJson(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
      return null;
    }
    const t = typeof obj;
    if (t === "string" || t === "number" || t === "boolean" || t === "bigint") {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((v) => RunRepository._safeJson(v));
    }
    if (t === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        out[k] = RunRepository._safeJson(v);
      }
      return out;
    }
    try {
      JSON.stringify(obj);
      return obj;
    } catch {
      return String(obj);
    }
  }

  /** ``_safe_json(value) or {}`` — coalesce null to an empty object for storage. */
  private static _jsonOrEmpty(obj: unknown): Record<string, unknown> {
    const safe = RunRepository._safeJson(obj);
    if (safe === null || typeof safe !== "object" || Array.isArray(safe)) {
      return {};
    }
    return safe as Record<string, unknown>;
  }

  private static _parseJson(value: unknown): Record<string, unknown> {
    if (value === null || value === undefined || value === "") {
      return {};
    }
    if (typeof value === "string") {
      try {
        return (JSON.parse(value) as Record<string, unknown>) || {};
      } catch {
        return {};
      }
    }
    if (typeof value === "object") {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private static _num(value: unknown): number {
    if (typeof value === "bigint") {
      return Number(value);
    }
    if (typeof value === "number") {
      return value;
    }
    return 0;
  }

  private static _rowToDict(row: RawRow): Record<string, unknown> {
    const d: Record<string, unknown> = { ...row };
    // Remap JSON columns to match the RunStore interface.
    d.metadata = RunRepository._parseJson(d.metadata_json);
    delete d.metadata_json;
    d.kwargs = RunRepository._parseJson(d.kwargs_json);
    delete d.kwargs_json;
    d.token_usage_by_model = RunRepository._parseJson(d.token_usage_by_model);
    // Convert datetime strings to normalized ISO for consistency.
    for (const key of ["created_at", "updated_at"]) {
      const val = d[key];
      if (typeof val === "string" || val instanceof Date) {
        d[key] = coerceIso(val);
      }
    }
    return d;
  }

  private static _toIso(before: string | Date | null | undefined): string {
    if (before === null || before === undefined) {
      return nowIso();
    }
    if (before instanceof Date) {
      return before.toISOString();
    }
    return before;
  }

  private _get(runId: string): RawRow | undefined {
    return this._db.prepare(`SELECT * FROM ${RUNS_TABLE} WHERE run_id = ?`).get(runId);
  }

  /**
   * Insert or update a run row (idempotent).
   *
   * ``RunManager`` retries ``put`` after transient SQLite failures; making this
   * idempotent prevents a successful-but-unacknowledged first commit from
   * turning the retry into a primary-key failure.
   */
  async put(runId: string, opts: RunPutOptions): Promise<void> {
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "RunRepository.put" });
    const now = nowIso();
    const created = opts.created_at ? opts.created_at : now;
    const existing = this._get(runId);
    const metadataJson = JSON.stringify(RunRepository._jsonOrEmpty(opts.metadata ?? null));
    const kwargsJson = JSON.stringify(RunRepository._jsonOrEmpty(opts.kwargs ?? null));
    const values = {
      thread_id: opts.thread_id,
      assistant_id: opts.assistant_id ?? null,
      user_id: resolvedUserId,
      model_name: RunRepository._normalizeModelName(opts.model_name),
      status: opts.status ?? "pending",
      multitask_strategy: opts.multitask_strategy ?? "reject",
      metadata_json: metadataJson,
      kwargs_json: kwargsJson,
      error: opts.error ?? null,
      follow_up_to_run_id: opts.follow_up_to_run_id ?? null,
      updated_at: now,
    };
    if (existing === undefined) {
      this._db
        .prepare(
          `INSERT INTO ${RUNS_TABLE}
             (run_id, thread_id, assistant_id, user_id, status, model_name, multitask_strategy,
              metadata_json, kwargs_json, error, follow_up_to_run_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          values.thread_id,
          values.assistant_id,
          values.user_id,
          values.status,
          values.model_name,
          values.multitask_strategy,
          values.metadata_json,
          values.kwargs_json,
          values.error,
          values.follow_up_to_run_id,
          created,
          values.updated_at,
        );
    } else {
      this._db
        .prepare(
          `UPDATE ${RUNS_TABLE} SET
             thread_id = ?, assistant_id = ?, user_id = ?, status = ?, model_name = ?,
             multitask_strategy = ?, metadata_json = ?, kwargs_json = ?, error = ?,
             follow_up_to_run_id = ?, updated_at = ?
           WHERE run_id = ?`,
        )
        .run(
          values.thread_id,
          values.assistant_id,
          values.user_id,
          values.status,
          values.model_name,
          values.multitask_strategy,
          values.metadata_json,
          values.kwargs_json,
          values.error,
          values.follow_up_to_run_id,
          values.updated_at,
          runId,
        );
    }
  }

  async get(runId: string, opts: { user_id?: UserIdParam } = {}): Promise<Record<string, unknown> | null> {
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "RunRepository.get" });
    const row = this._get(runId);
    if (row === undefined) {
      return null;
    }
    if (resolvedUserId !== null && row.user_id !== resolvedUserId) {
      return null;
    }
    return RunRepository._rowToDict(row);
  }

  async listByThread(threadId: string, opts: { user_id?: UserIdParam; limit?: number } = {}): Promise<Array<Record<string, unknown>>> {
    const limit = opts.limit ?? 100;
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "RunRepository.list_by_thread" });
    const where = ["thread_id = ?"];
    const params: SQLInputValue[] = [threadId];
    if (resolvedUserId !== null) {
      where.push("user_id = ?");
      params.push(resolvedUserId);
    }
    params.push(limit);
    const sql = `SELECT * FROM ${RUNS_TABLE} WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`;
    const rows = this._db.prepare(sql).all(...params);
    return rows.map((r) => RunRepository._rowToDict(r));
  }

  async updateStatus(runId: string, status: string, opts: { error?: string | null } = {}): Promise<boolean> {
    const sets = ["status = ?", "updated_at = ?"];
    const params: SQLInputValue[] = [status, nowIso()];
    if (opts.error !== undefined && opts.error !== null) {
      sets.push("error = ?");
      params.push(opts.error);
    }
    params.push(runId);
    const result = this._db.prepare(`UPDATE ${RUNS_TABLE} SET ${sets.join(", ")} WHERE run_id = ?`).run(...params);
    return RunRepository._num(result.changes) !== 0;
  }

  async updateModelName(runId: string, modelName: string | null): Promise<void> {
    this._db
      .prepare(`UPDATE ${RUNS_TABLE} SET model_name = ?, updated_at = ? WHERE run_id = ?`)
      .run(RunRepository._normalizeModelName(modelName), nowIso(), runId);
  }

  async delete(runId: string, opts: { user_id?: UserIdParam } = {}): Promise<void> {
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "RunRepository.delete" });
    const row = this._get(runId);
    if (row === undefined) {
      return;
    }
    if (resolvedUserId !== null && row.user_id !== resolvedUserId) {
      return;
    }
    this._db.prepare(`DELETE FROM ${RUNS_TABLE} WHERE run_id = ?`).run(runId);
  }

  async listPending(opts: { before?: string | Date | null } = {}): Promise<Array<Record<string, unknown>>> {
    const before = RunRepository._toIso(opts.before);
    const rows = this._db
      .prepare(`SELECT * FROM ${RUNS_TABLE} WHERE status = 'pending' AND created_at <= ? ORDER BY created_at ASC`)
      .all(before);
    return rows.map((r) => RunRepository._rowToDict(r));
  }

  /** Return persisted active runs for startup recovery. */
  async listInflight(opts: { before?: string | Date | null } = {}): Promise<Array<Record<string, unknown>>> {
    const before = RunRepository._toIso(opts.before);
    const rows = this._db
      .prepare(`SELECT * FROM ${RUNS_TABLE} WHERE status IN ('pending', 'running') AND created_at <= ? ORDER BY created_at ASC`)
      .all(before);
    return rows.map((r) => RunRepository._rowToDict(r));
  }

  /**
   * Update status + token usage + convenience fields on run completion.
   *
   * Returns ``false`` when no run row matched the requested ``runId``.
   */
  async updateRunCompletion(runId: string, opts: RunCompletionOptions): Promise<boolean> {
    const sets: string[] = [
      "status = ?",
      "total_input_tokens = ?",
      "total_output_tokens = ?",
      "total_tokens = ?",
      "llm_call_count = ?",
      "lead_agent_tokens = ?",
      "subagent_tokens = ?",
      "middleware_tokens = ?",
      "token_usage_by_model = ?",
      "message_count = ?",
      "updated_at = ?",
    ];
    const params: SQLInputValue[] = [
      opts.status,
      opts.total_input_tokens ?? 0,
      opts.total_output_tokens ?? 0,
      opts.total_tokens ?? 0,
      opts.llm_call_count ?? 0,
      opts.lead_agent_tokens ?? 0,
      opts.subagent_tokens ?? 0,
      opts.middleware_tokens ?? 0,
      JSON.stringify(RunRepository._jsonOrEmpty(opts.token_usage_by_model ?? null)),
      opts.message_count ?? 0,
      nowIso(),
    ];
    if (opts.last_ai_message !== undefined && opts.last_ai_message !== null) {
      sets.push("last_ai_message = ?");
      params.push(opts.last_ai_message.slice(0, 2000));
    }
    if (opts.first_human_message !== undefined && opts.first_human_message !== null) {
      sets.push("first_human_message = ?");
      params.push(opts.first_human_message.slice(0, 2000));
    }
    if (opts.error !== undefined && opts.error !== null) {
      sets.push("error = ?");
      params.push(opts.error);
    }
    params.push(runId);
    const result = this._db.prepare(`UPDATE ${RUNS_TABLE} SET ${sets.join(", ")} WHERE run_id = ?`).run(...params);
    return RunRepository._num(result.changes) !== 0;
  }

  /** Update token usage + convenience fields while a run is still active. */
  async updateRunProgress(runId: string, opts: RunProgressOptions): Promise<void> {
    const sets = ["updated_at = ?"];
    const params: SQLInputValue[] = [nowIso()];
    const optionalCounters: Array<[string, number | null | undefined]> = [
      ["total_input_tokens", opts.total_input_tokens],
      ["total_output_tokens", opts.total_output_tokens],
      ["total_tokens", opts.total_tokens],
      ["llm_call_count", opts.llm_call_count],
      ["lead_agent_tokens", opts.lead_agent_tokens],
      ["subagent_tokens", opts.subagent_tokens],
      ["middleware_tokens", opts.middleware_tokens],
      ["message_count", opts.message_count],
    ];
    for (const [key, value] of optionalCounters) {
      if (value !== undefined && value !== null) {
        sets.push(`${key} = ?`);
        params.push(value);
      }
    }
    if (opts.token_usage_by_model !== undefined && opts.token_usage_by_model !== null) {
      sets.push("token_usage_by_model = ?");
      params.push(JSON.stringify(RunRepository._jsonOrEmpty(opts.token_usage_by_model)));
    }
    if (opts.last_ai_message !== undefined && opts.last_ai_message !== null) {
      sets.push("last_ai_message = ?");
      params.push(opts.last_ai_message.slice(0, 2000));
    }
    if (opts.first_human_message !== undefined && opts.first_human_message !== null) {
      sets.push("first_human_message = ?");
      params.push(opts.first_human_message.slice(0, 2000));
    }
    params.push(runId);
    this._db.prepare(`UPDATE ${RUNS_TABLE} SET ${sets.join(", ")} WHERE run_id = ? AND status = 'running'`).run(...params);
  }

  /**
   * Aggregate token usage for a thread.
   *
   * ``by_model`` is reduced from each row's ``token_usage_by_model`` JSON so
   * subagent / middleware tokens land on the model that produced them. Rows
   * written before that column existed fall back to ``model_name`` +
   * ``total_tokens``.
   */
  async aggregateTokensByThread(threadId: string, opts: { include_active?: boolean } = {}): Promise<Record<string, unknown>> {
    const includeActive = opts.include_active ?? false;
    const statuses = includeActive ? ["success", "error", "running"] : ["success", "error"];
    const placeholders = statuses.map(() => "?").join(", ");
    const sql =
      `SELECT model_name, total_tokens, total_input_tokens, total_output_tokens,` +
      ` lead_agent_tokens, subagent_tokens, middleware_tokens, token_usage_by_model` +
      ` FROM ${RUNS_TABLE} WHERE thread_id = ? AND status IN (${placeholders})`;
    const rows = this._db.prepare(sql).all(threadId, ...statuses);

    let totalTokens = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalRuns = 0;
    let leadAgent = 0;
    let subagent = 0;
    let middleware = 0;
    const byModel: Record<string, { tokens: number; runs: number }> = {};

    for (const r of rows) {
      totalRuns += 1;
      totalTokens += RunRepository._num(r.total_tokens);
      totalInput += RunRepository._num(r.total_input_tokens);
      totalOutput += RunRepository._num(r.total_output_tokens);
      leadAgent += RunRepository._num(r.lead_agent_tokens);
      subagent += RunRepository._num(r.subagent_tokens);
      middleware += RunRepository._num(r.middleware_tokens);

      const usageByModel = RunRepository._parseJson(r.token_usage_by_model);
      if (Object.keys(usageByModel).length > 0) {
        for (const [model, usage] of Object.entries(usageByModel)) {
          const entry = (byModel[model] ??= { tokens: 0, runs: 0 });
          entry.tokens += RunRepository._num((usage as Record<string, unknown>)?.total_tokens);
          entry.runs += 1;
        }
      } else {
        const model = (r.model_name as string | null) || "unknown";
        const entry = (byModel[model] ??= { tokens: 0, runs: 0 });
        entry.tokens += RunRepository._num(r.total_tokens);
        entry.runs += 1;
      }
    }

    return {
      total_tokens: totalTokens,
      total_input_tokens: totalInput,
      total_output_tokens: totalOutput,
      total_runs: totalRuns,
      by_model: byModel,
      by_caller: {
        lead_agent: leadAgent,
        subagent,
        middleware,
      },
    };
  }
}
