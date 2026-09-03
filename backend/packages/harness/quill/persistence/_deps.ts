/**
 * Local stubs for cross-layer dependencies not yet ported to TypeScript.
 *
 * The persistence layer's Python code imports three things from modules that
 * live outside this package and have no TypeScript port yet:
 *
 *   - ``quill.runtime.user_context`` — the request-scoped user contextvar
 *     plus the ``AUTO`` / ``resolve_user_id`` three-state resolution helper.
 *   - ``quill.runtime.runs.store.base.RunStore`` — the abstract run-store
 *     interface that ``RunRepository`` implements.
 *   - ``langgraph.store.base.BaseStore`` — the in-memory key/value store that
 *     ``MemoryThreadMetaStore`` wraps (defined in ``thread_meta/memory.ts``).
 *
 * These are re-declared here as minimal typed shims so the persistence port
 * compiles standalone. Once the real modules are ported, repoint the imports
 * (see the porting report for the exact swap) and delete this file.
 */

// ---------------------------------------------------------------------------
// runtime/user_context.py — three-state user_id resolution
// ---------------------------------------------------------------------------

export {
  type CurrentUser,
  type Token,
  setCurrentUser,
  resetCurrentUser,
  getCurrentUser,
  getEffectiveUserId,
  resolveRuntimeUserId,
  AutoSentinel,
  AUTO,
  resolveUserId,
  runWithUser,
} from "../runtime/user_context.js";

/** Three-state value accepted by every repository ``userId`` parameter. */
export type UserIdParam = string | null | import("../runtime/user_context.js").AutoSentinel;

// ---------------------------------------------------------------------------
// runtime/runs/store/base.py — abstract RunStore interface
// ---------------------------------------------------------------------------

/** Options accepted by ``RunStore.put``. */
export interface RunPutOptions {
  thread_id: string;
  assistant_id?: string | null;
  user_id?: UserIdParam;
  model_name?: string | null;
  status?: string;
  multitask_strategy?: string;
  metadata?: Record<string, unknown> | null;
  kwargs?: Record<string, unknown> | null;
  error?: string | null;
  created_at?: string | null;
  follow_up_to_run_id?: string | null;
}

/** Token-usage + convenience fields written on run completion. */
export interface RunCompletionOptions {
  status: string;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_tokens?: number;
  llm_call_count?: number;
  lead_agent_tokens?: number;
  subagent_tokens?: number;
  middleware_tokens?: number;
  token_usage_by_model?: Record<string, Record<string, number>> | null;
  message_count?: number;
  last_ai_message?: string | null;
  first_human_message?: string | null;
  error?: string | null;
}

/** Token-usage + convenience fields written while a run is still active. */
export interface RunProgressOptions {
  total_input_tokens?: number | null;
  total_output_tokens?: number | null;
  total_tokens?: number | null;
  llm_call_count?: number | null;
  lead_agent_tokens?: number | null;
  subagent_tokens?: number | null;
  middleware_tokens?: number | null;
  token_usage_by_model?: Record<string, Record<string, number>> | null;
  message_count?: number | null;
  last_ai_message?: string | null;
  first_human_message?: string | null;
}

/**
 * Abstract interface for run metadata storage.
 *
 * Mirrors ``quill.runtime.runs.store.base.RunStore``. ``RunManager`` depends
 * on this interface; the SQL-backed implementation is ``RunRepository``.
 */
export interface RunStore {
  put(runId: string, opts: RunPutOptions): Promise<void>;
  get(runId: string, opts?: { user_id?: UserIdParam }): Promise<Record<string, unknown> | null>;
  listByThread(threadId: string, opts?: { user_id?: UserIdParam; limit?: number }): Promise<Array<Record<string, unknown>>>;
  updateStatus(runId: string, status: string, opts?: { error?: string | null }): Promise<boolean | null>;
  delete(runId: string, opts?: { user_id?: UserIdParam }): Promise<void>;
  updateModelName(runId: string, modelName: string | null): Promise<void>;
  updateRunCompletion(runId: string, opts: RunCompletionOptions): Promise<boolean | null>;
  updateRunProgress(runId: string, opts: RunProgressOptions): Promise<void>;
  listPending(opts?: { before?: string | Date | null }): Promise<Array<Record<string, unknown>>>;
  listInflight(opts?: { before?: string | Date | null }): Promise<Array<Record<string, unknown>>>;
  aggregateTokensByThread(threadId: string, opts?: { include_active?: boolean }): Promise<Record<string, unknown>>;
}
