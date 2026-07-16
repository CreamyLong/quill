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
