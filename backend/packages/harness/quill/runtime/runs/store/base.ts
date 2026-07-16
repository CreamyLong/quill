/**
 * Abstract interface for run metadata storage.
 *
 * RunManager depends on this interface. Implementations:
 * - MemoryRunStore: in-memory dict (development, tests)
 * - Future: node:sqlite-backed RunRepository
 *
 * All methods accept an optional user_id for user isolation. When user_id is
 * null, no user filtering is applied (single-user mode).
 */

/** Serialized run row, as stored and returned by RunStore implementations. */
export interface RunRow {
  run_id: string;
  thread_id: string;
  assistant_id?: string | null;
  user_id?: string | null;
  model_name?: string | null;
  status?: string;
  multitask_strategy?: string;
  metadata?: Record<string, unknown>;
  kwargs?: Record<string, unknown>;
  error?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface PutRunArgs {
  thread_id: string;
  assistant_id?: string | null;
  user_id?: string | null;
  model_name?: string | null;
  status?: string;
  multitask_strategy?: string;
  metadata?: Record<string, unknown> | null;
  kwargs?: Record<string, unknown> | null;
  error?: string | null;
  created_at?: string | null;
}

export interface TokenUsageByModel {
  [model: string]: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

export interface UpdateRunCompletionArgs {
  status: string;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_tokens?: number;
  llm_call_count?: number;
  lead_agent_tokens?: number;
  subagent_tokens?: number;
  middleware_tokens?: number;
  token_usage_by_model?: TokenUsageByModel | null;
  message_count?: number;
  last_ai_message?: string | null;
  first_human_message?: string | null;
  error?: string | null;
  [key: string]: unknown;
}

export interface UpdateRunProgressArgs {
  total_input_tokens?: number | null;
  total_output_tokens?: number | null;
  total_tokens?: number | null;
  llm_call_count?: number | null;
  lead_agent_tokens?: number | null;
  subagent_tokens?: number | null;
  middleware_tokens?: number | null;
  token_usage_by_model?: TokenUsageByModel | null;
  message_count?: number | null;
  last_ai_message?: string | null;
  first_human_message?: string | null;
  [key: string]: unknown;
}

export interface AggregateTokensResult {
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_runs: number;
  by_model: Record<string, { tokens: number; runs: number }>;
  by_caller: { lead_agent: number; subagent: number; middleware: number };
}

export abstract class RunStore {
  abstract put(runId: string, args: PutRunArgs): Promise<void>;

  abstract get(runId: string, options?: { user_id?: string | null }): Promise<RunRow | null>;

  abstract listByThread(
    threadId: string,
    options?: { user_id?: string | null; limit?: number }
  ): Promise<RunRow[]>;

  /**
   * Update a run status.
   *
   * Returns `false` when the store can prove no row was updated. Older or
   * lightweight stores may return `null` when they cannot report rowcount.
   */
  abstract updateStatus(runId: string, status: string, options?: { error?: string | null }): Promise<boolean | null>;

  abstract delete(runId: string): Promise<void>;

  /** Update the model_name field for an existing run. */
  abstract updateModelName(runId: string, modelName: string | null): Promise<void>;

  /**
   * Persist final completion fields.
   *
   * Returns `false` when the store can prove no row was updated.
   */
  abstract updateRunCompletion(runId: string, args: UpdateRunCompletionArgs): Promise<boolean | null>;

  /** Persist a best-effort running snapshot without changing run status. */
  async updateRunProgress(_runId: string, _args: UpdateRunProgressArgs): Promise<void> {
    return undefined;
  }

  abstract listPending(options?: { before?: string | null }): Promise<RunRow[]>;

  /** Return persisted runs that are still `pending` or `running`. */
  abstract listInflight(options?: { before?: string | null }): Promise<RunRow[]>;

  /**
   * Aggregate token usage for completed runs in a thread.
   *
   * Returns a dict with keys: total_tokens, total_input_tokens,
   * total_output_tokens, total_runs, by_model (model_name → {tokens, runs}),
   * by_caller ({lead_agent, subagent, middleware}).
   */
  abstract aggregateTokensByThread(
    threadId: string,
    options?: { include_active?: boolean }
  ): Promise<AggregateTokensResult>;
}
