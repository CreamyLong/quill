/**
 * In-memory ThreadMetaStore backed by a LangGraph ``BaseStore``.
 *
 * Ports ``quill.persistence.thread_meta.memory``. Used when
 * database.backend=memory. Delegates to the store's ``("threads",)`` namespace —
 * the same namespace the Gateway router uses for thread records.
 *
 * The LangGraph ``BaseStore`` has no TypeScript port yet, so a minimal
 * structural interface for the async methods this file uses ({@link BaseStore})
 * is declared locally; repoint it once the real store is ported.
 */

import { AUTO, resolveUserId, type UserIdParam } from "../_deps.js";
import { coerceIso, nowIso } from "../../utils/time.js";
import { ThreadMetaStore, type ThreadMetaCreateOptions, type ThreadMetaSearchOptions } from "./base.js";

/** A stored item as returned by the LangGraph store. */
export interface StoreItem {
  key: string;
  value: Record<string, unknown>;
}

/** Minimal structural stub for ``langgraph.store.base.BaseStore``. */
export interface BaseStore {
  aget(namespace: readonly string[], key: string): Promise<StoreItem | null>;
  aput(namespace: readonly string[], key: string, value: Record<string, unknown>): Promise<void>;
  adelete(namespace: readonly string[], key: string): Promise<void>;
  asearch(
    namespace: readonly string[],
    opts?: { filter?: Record<string, unknown> | null; limit?: number; offset?: number },
  ): Promise<StoreItem[]>;
}

export const THREADS_NS: readonly string[] = ["threads"];

export class MemoryThreadMetaStore extends ThreadMetaStore {
  private readonly _store: BaseStore;

  constructor(store: BaseStore) {
    super();
    this._store = store;
  }

  /** Fetch a record and verify ownership. Returns a mutable copy, or null. */
  private async _getOwnedRecord(
    threadId: string,
    userId: UserIdParam,
    methodName: string,
  ): Promise<Record<string, unknown> | null> {
    const resolved = resolveUserId(userId, { methodName });
    const item = await this._store.aget(THREADS_NS, threadId);
    if (item === null) {
      return null;
    }
    const record: Record<string, unknown> = { ...item.value };
    if (resolved !== null && record.user_id !== resolved) {
      return null;
    }
    return record;
  }

  async create(threadId: string, opts: ThreadMetaCreateOptions = {}): Promise<Record<string, unknown>> {
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "MemoryThreadMetaStore.create" });
    const now = nowIso();
    const record: Record<string, unknown> = {
      thread_id: threadId,
      assistant_id: opts.assistant_id ?? null,
      user_id: resolvedUserId,
      display_name: opts.display_name ?? null,
      status: "idle",
      metadata: opts.metadata ?? {},
      values: {},
      created_at: now,
      updated_at: now,
    };
    await this._store.aput(THREADS_NS, threadId, record);
    return record;
  }

  async get(threadId: string, opts: { user_id?: UserIdParam } = {}): Promise<Record<string, unknown> | null> {
    return this._getOwnedRecord(threadId, opts.user_id ?? AUTO, "MemoryThreadMetaStore.get");
  }

  async search(opts: ThreadMetaSearchOptions = {}): Promise<Array<Record<string, unknown>>> {
    const { metadata, status, limit = 100, offset = 0 } = opts;
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "MemoryThreadMetaStore.search" });
    const filterDict: Record<string, unknown> = {};
    if (metadata) {
      Object.assign(filterDict, metadata);
    }
    if (status) {
      filterDict.status = status;
    }
    if (resolvedUserId !== null) {
      filterDict.user_id = resolvedUserId;
    }

    const items = await this._store.asearch(THREADS_NS, {
      filter: Object.keys(filterDict).length > 0 ? filterDict : null,
      limit,
      offset,
    });
    return items.map((item) => MemoryThreadMetaStore._itemToDict(item));
  }

  async checkAccess(threadId: string, userId: string, opts: { require_existing?: boolean } = {}): Promise<boolean> {
    const requireExisting = opts.require_existing ?? false;
    const item = await this._store.aget(THREADS_NS, threadId);
    if (item === null) {
      return !requireExisting;
    }
    const recordUserId = item.value.user_id;
    if (recordUserId === null || recordUserId === undefined) {
      return true;
    }
    return recordUserId === userId;
  }

  async updateDisplayName(threadId: string, displayName: string, opts: { user_id?: UserIdParam } = {}): Promise<void> {
    const record = await this._getOwnedRecord(threadId, opts.user_id ?? AUTO, "MemoryThreadMetaStore.update_display_name");
    if (record === null) {
      return;
    }
    record.display_name = displayName;
    record.updated_at = nowIso();
    await this._store.aput(THREADS_NS, threadId, record);
  }

  async updateStatus(threadId: string, status: string, opts: { user_id?: UserIdParam } = {}): Promise<void> {
    const record = await this._getOwnedRecord(threadId, opts.user_id ?? AUTO, "MemoryThreadMetaStore.update_status");
    if (record === null) {
      return;
    }
    record.status = status;
    record.updated_at = nowIso();
    await this._store.aput(THREADS_NS, threadId, record);
  }

  async updateMetadata(threadId: string, metadata: Record<string, unknown>, opts: { user_id?: UserIdParam } = {}): Promise<void> {
    const record = await this._getOwnedRecord(threadId, opts.user_id ?? AUTO, "MemoryThreadMetaStore.update_metadata");
    if (record === null) {
      return;
    }
    const merged = { ...((record.metadata as Record<string, unknown>) ?? {}), ...metadata };
    record.metadata = merged;
    record.updated_at = nowIso();
    await this._store.aput(THREADS_NS, threadId, record);
  }

  async updateOwner(threadId: string, ownerUserId: string, opts: { user_id?: UserIdParam } = {}): Promise<void> {
    const record = await this._getOwnedRecord(threadId, opts.user_id ?? AUTO, "MemoryThreadMetaStore.update_owner");
    if (record === null) {
      return;
    }
    record.user_id = ownerUserId;
    record.updated_at = nowIso();
    await this._store.aput(THREADS_NS, threadId, record);
  }

  async delete(threadId: string, opts: { user_id?: UserIdParam } = {}): Promise<void> {
    const record = await this._getOwnedRecord(threadId, opts.user_id ?? AUTO, "MemoryThreadMetaStore.delete");
    if (record === null) {
      return;
    }
    await this._store.adelete(THREADS_NS, threadId);
  }

  /** Convert a Store item to the dict format expected by callers. */
  private static _itemToDict(item: StoreItem): Record<string, unknown> {
    const val = item.value;
    return {
      thread_id: item.key,
      assistant_id: val.assistant_id ?? null,
      user_id: val.user_id ?? null,
      display_name: val.display_name ?? null,
      status: val.status ?? "idle",
      metadata: val.metadata ?? {},
      // ``coerceIso`` heals legacy unix-second values written by earlier
      // Gateway versions that called ``str(time.time())``.
      created_at: coerceIso(val.created_at ?? ""),
      updated_at: coerceIso(val.updated_at ?? ""),
    };
  }
}
