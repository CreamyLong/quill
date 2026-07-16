/**
 * Quill application persistence layer (``node:sqlite`` port).
 *
 * Ports ``quill.persistence.__init__``. This layer manages Quill's own
 * application data — runs metadata, thread ownership, feedback, users, channel
 * connections. It is separate from LangGraph's checkpointer.
 *
 * The Python module re-exports the async SQLAlchemy engine lifecycle
 * (``init_engine`` / ``close_engine`` / ``get_engine`` / ``get_session_factory``).
 * The ``node:sqlite`` port exposes the equivalent handle-based lifecycle
 * (``initEngine`` / ``closeEngine`` / ``getDatabase``); ``getDatabase`` returns
 * the shared connection where the Python code returned a session factory.
 */

export {
  closeEngine,
  getDatabase,
  initEngine,
  initEngineFromConfig,
  type DatabaseBackend,
  type DatabaseConfigLike,
  type InitEngineOptions,
} from "./engine.js";
export { bootstrapSchema, ALL_SCHEMA_DDL } from "./bootstrap.js";
export { toDict, type Row } from "./base.js";
export { jsonMatch, validateMetadataFilterKey, validateMetadataFilterValue, type SqlFragment } from "./json_compat.js";
