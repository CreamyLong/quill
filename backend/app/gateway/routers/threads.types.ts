/**
 * Thread API request/response contracts for the gateway threads router.
 *
 * These types mirror the FastAPI/Pydantic models in
 * `app/gateway/routers/threads.py` and are the JSON wire contract consumed by
 * the frontend.
 */

export interface ThreadDeleteResponse {
  success: boolean;
  message: string;
}

export interface ThreadResponse {
  /** Unique thread identifier */
  thread_id: string;
  /** Thread status: idle, busy, interrupted, error */
  status: string;
  /** ISO timestamp */
  created_at: string;
  /** ISO timestamp */
  updated_at: string;
  /** Thread metadata */
  metadata: Record<string, unknown>;
  /** Current state channel values */
  values: Record<string, unknown>;
  /** Pending interrupts */
  interrupts: Record<string, unknown>;
}

export interface ThreadCreateRequest {
  /** Optional thread ID (auto-generated if omitted) */
  thread_id?: string | null;
  /** Associate thread with an assistant */
  assistant_id?: string | null;
  /** Initial metadata */
  metadata?: Record<string, unknown>;
}

export interface ThreadSearchRequest {
  /** Metadata filter (exact match) */
  metadata?: Record<string, unknown>;
  /** Maximum results */
  limit?: number;
  /** Pagination offset */
  offset?: number;
  /** Filter by thread status */
  status?: string | null;
}

export interface ThreadStateResponse {
  /** Current channel values */
  values: Record<string, unknown>;
  /** Next tasks to execute */
  next: string[];
  /** Checkpoint metadata */
  metadata: Record<string, unknown>;
  /** Checkpoint info */
  checkpoint: Record<string, unknown>;
  /** Current checkpoint ID */
  checkpoint_id: string | null;
  /** Parent checkpoint ID */
  parent_checkpoint_id: string | null;
  /** Checkpoint timestamp */
  created_at: string | null;
  /** Interrupted task details */
  tasks: Array<Record<string, unknown>>;
}

export interface ThreadPatchRequest {
  /** Metadata to merge */
  metadata?: Record<string, unknown>;
}

export interface ThreadStateUpdateRequest {
  /** Channel values to merge */
  values?: Record<string, unknown> | null;
  /** Checkpoint to branch from */
  checkpoint_id?: string | null;
  /** Full checkpoint object */
  checkpoint?: Record<string, unknown> | null;
  /** Node identity for the update */
  as_node?: string | null;
}

export interface HistoryEntry {
  checkpoint_id: string;
  parent_checkpoint_id?: string | null;
  metadata?: Record<string, unknown>;
  values?: Record<string, unknown>;
  created_at?: string | null;
  next?: string[];
}

export interface ThreadHistoryRequest {
  /** Maximum entries */
  limit?: number;
  /** Cursor for pagination */
  before?: string | null;
}

export interface ThreadHistoryResponse {
  entries: HistoryEntry[];
  next_cursor?: string | null;
}

/** Goal state for persistent multi-turn objective tracking. */
export interface GoalState {
  objective: string;
  status: "active" | "satisfied" | "abandoned" | "paused";
  created_at: string;
  updated_at: string;
  continuation_count: number;
  max_continuations: number;
  no_progress_count: number;
  max_no_progress_continuations: number;
  last_evaluation?: {
    satisfied: boolean;
    blocker: string;
    reason: string;
    evidence_summary?: string;
    run_id?: string;
    evaluated_at?: string;
    progress_key?: string;
    stand_down_reason?: string;
  };
}

/** Request to fork a thread. */
export interface ThreadForkRequest {
  /** Optional checkpoint ID to fork from (omit for latest). */
  checkpoint_id?: string | null;
}

/** Response from fork operation. */
export interface ThreadForkResponse {
  thread_id: string;
  source_thread_id: string;
  status: string;
  created_at: string;
}

/** Request to set a goal. */
export interface GoalSetRequest {
  objective: string;
  max_continuations?: number;
  max_no_progress_continuations?: number;
}

/** Response from goal operations. */
export interface GoalResponse {
  ok: boolean;
  goal?: GoalState;
  message?: string;
}

/** Full-text search request. */
export interface FullTextSearchRequest {
  query: string;
  limit?: number;
}

/** Search result entry. */
export interface SearchResultEntry {
  thread_id: string;
  title: string;
  snippet: string;
  score: number;
}

/** Full-text search response. */
export interface FullTextSearchResponse {
  results: SearchResultEntry[];
  query: string;
}

/** Metadata keys that the server controls; clients are not allowed to set them. */
export const SERVER_RESERVED_METADATA_KEYS: readonly string[] = ["owner_id", "user_id"];

/** Return metadata with server-controlled keys removed. */
export function stripReservedMetadata(
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!metadata) {
    return {};
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!SERVER_RESERVED_METADATA_KEYS.includes(key)) {
      result[key] = value;
    }
  }
  return result;
}
