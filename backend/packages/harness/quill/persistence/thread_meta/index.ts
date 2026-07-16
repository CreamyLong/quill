/**
 * Thread metadata persistence — models, abstract store, and implementations.
 *
 * Ports the public surface of ``quill.persistence.thread_meta.__init__``.
 */

import type { DatabaseSync } from "node:sqlite";

import { InvalidMetadataFilterError, ThreadMetaStore } from "./base.js";
import { MemoryThreadMetaStore, type BaseStore } from "./memory.js";
import { ThreadMetaRepository } from "./sql.js";

export { InvalidMetadataFilterError, ThreadMetaStore } from "./base.js";
export type { ThreadMetaCreateOptions, ThreadMetaSearchOptions } from "./base.js";
export { MemoryThreadMetaStore, THREADS_NS } from "./memory.js";
export type { BaseStore, StoreItem } from "./memory.js";
export { ThreadMetaRepository } from "./sql.js";
export { THREADS_META_TABLE, THREADS_META_DDL } from "./model.js";
export type { ThreadMetaRow } from "./model.js";

/**
 * Create the appropriate ThreadMetaStore based on the available backends.
 *
 * Returns a SQL-backed repository when a database handle is available, otherwise
 * falls back to the in-memory LangGraph-store implementation.
 */
export function makeThreadStore(db: DatabaseSync | null, store: BaseStore | null = null): ThreadMetaStore {
  if (db !== null) {
    return new ThreadMetaRepository(db);
  }
  if (store === null) {
    throw new Error("makeThreadStore requires either a db (SQL) or a store (memory)");
  }
  return new MemoryThreadMetaStore(store);
}
