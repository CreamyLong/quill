/**
 * RunEventStore factory + public exports.
 */

import type { DatabaseSync } from "node:sqlite";

import type { RunEventsConfig } from "../../../config/run_events_config.js";
import { RunEventStore } from "./base.js";
import { MemoryRunEventStore } from "./memory.js";
import { JsonlRunEventStore } from "./jsonl.js";
import { DbRunEventStore } from "./db.js";

export { RunEventStore } from "./base.js";
export type {
  EventContent,
  ListEventsOptions,
  ListMessagesOptions,
  PutEventArgs,
  RunEventRecord,
  UserScopedOptions,
} from "./base.js";
export { MemoryRunEventStore } from "./memory.js";
export { JsonlRunEventStore } from "./jsonl.js";
export { DbRunEventStore } from "./db.js";

/**
 * Options for {@link makeRunEventStore}.
 *
 * NOTE (TS port): The Python factory resolves an async SQLAlchemy session
 * factory from `quill.persistence.engine` for the `db` backend. That layer is
 * not yet ported, so the caller instead injects a shared `node:sqlite`
 * `DatabaseSync` connection via `db`. When the backend is `db` but no connection
 * is supplied, this falls back to `MemoryRunEventStore` — mirroring the Python
 * behaviour when `get_session_factory()` returns `None`.
 */
export interface MakeRunEventStoreOptions {
  db?: DatabaseSync | null;
}

/** Create a RunEventStore based on run_events.backend configuration. */
export function makeRunEventStore(
  config: RunEventsConfig | null = null,
  options: MakeRunEventStoreOptions = {}
): RunEventStore {
  if (config === null || config.backend === "memory") {
    return new MemoryRunEventStore();
  }
  if (config.backend === "db") {
    const db = options.db ?? null;
    if (db === null) {
      // database.backend=memory but run_events.backend=db -> fallback
      return new MemoryRunEventStore();
    }
    return new DbRunEventStore(db, { maxTraceContent: config.maxTraceContent });
  }
  if (config.backend === "jsonl") {
    return new JsonlRunEventStore();
  }
  throw new Error(`Unknown run_events backend: ${JSON.stringify(config.backend)}`);
}
