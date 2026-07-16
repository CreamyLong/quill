/**
 * Abstract interface for thread metadata storage.
 *
 * Ports ``quill.persistence.thread_meta.base``. Implementations:
 * - ``ThreadMetaRepository``: SQL-backed (``node:sqlite``).
 * - ``MemoryThreadMetaStore``: wraps a LangGraph ``BaseStore`` (memory mode).
 *
 * All mutating and querying methods accept a ``userId`` parameter with
 * three-state semantics (see {@link resolveUserId}):
 * - ``AUTO`` (default): resolve from the current user context.
 * - Explicit ``string``: use the provided value verbatim.
 * - Explicit ``null``: bypass owner filtering (migration/CLI only).
 */

import type { UserIdParam } from "../_deps.js";

/** Raised when all client-supplied metadata filter keys are rejected. */
export class InvalidMetadataFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMetadataFilterError";
  }
}

/** Options for {@link ThreadMetaStore.create}. */
export interface ThreadMetaCreateOptions {
  assistant_id?: string | null;
  user_id?: UserIdParam;
  display_name?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Options for {@link ThreadMetaStore.search}. */
export interface ThreadMetaSearchOptions {
  metadata?: Record<string, unknown> | null;
  status?: string | null;
  limit?: number;
  offset?: number;
  user_id?: UserIdParam;
}

export abstract class ThreadMetaStore {
  abstract create(threadId: string, opts?: ThreadMetaCreateOptions): Promise<Record<string, unknown>>;

  abstract get(threadId: string, opts?: { user_id?: UserIdParam }): Promise<Record<string, unknown> | null>;

  abstract search(opts?: ThreadMetaSearchOptions): Promise<Array<Record<string, unknown>>>;

  abstract updateDisplayName(threadId: string, displayName: string, opts?: { user_id?: UserIdParam }): Promise<void>;

  abstract updateStatus(threadId: string, status: string, opts?: { user_id?: UserIdParam }): Promise<void>;

  /**
   * Merge ``metadata`` into the thread's metadata field.
   *
   * Existing keys are overwritten by the new values; keys absent from
   * ``metadata`` are preserved. No-op if the thread does not exist or the owner
   * check fails.
   */
  abstract updateMetadata(threadId: string, metadata: Record<string, unknown>, opts?: { user_id?: UserIdParam }): Promise<void>;

  /**
   * Move a thread metadata row to a new owner.
   *
   * Intended for trusted internal repair/migration paths. No-op if the row does
   * not exist or the caller fails the owner check.
   */
  abstract updateOwner(threadId: string, ownerUserId: string, opts?: { user_id?: UserIdParam }): Promise<void>;

  /** Check if ``userId`` has access to ``threadId``. */
  abstract checkAccess(threadId: string, userId: string, opts?: { require_existing?: boolean }): Promise<boolean>;

  abstract delete(threadId: string, opts?: { user_id?: UserIdParam }): Promise<void>;
}
