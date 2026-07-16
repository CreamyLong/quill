/**
 * Database lifecycle management (``node:sqlite`` port).
 *
 * Ports ``quill.persistence.engine``. The Python original manages an async
 * SQLAlchemy engine + session factory. Under ``node:sqlite`` the shared handle
 * is a single synchronous ``DatabaseSync`` connection, so this module exposes
 * that handle where the Python code exposed a session factory:
 *
 *   - ``initEngine`` opens the connection, applies the SQLite PRAGMAs the Python
 *     engine wired via a ``connect`` event listener (WAL, ``synchronous=NORMAL``,
 *     ``foreign_keys=ON``, ``busy_timeout=30000``), then bootstraps the schema.
 *   - ``getDatabase`` returns the handle repositories use, or ``null`` when the
 *     backend is ``memory`` (the caller must fall back to in-memory stores).
 *   - ``closeEngine`` closes the connection.
 *
 * The ``postgres`` backend has no ``node:sqlite`` analogue and is rejected.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { bootstrapSchema } from "./bootstrap.js";

export type DatabaseBackend = "memory" | "sqlite" | "postgres";

/** Minimal shape of the config object accepted by ``initEngineFromConfig``. */
export interface DatabaseConfigLike {
  backend: DatabaseBackend;
  /** Filesystem directory for the SQLite database file. */
  sqlite_dir?: string;
  /** Explicit SQLite file path; overrides ``sqlite_dir`` when provided. */
  sqlite_path?: string;
  echo_sql?: boolean;
  pool_size?: number;
}

export interface InitEngineOptions {
  /** SQLite database file path (required for the ``sqlite`` backend). */
  path?: string;
  /** Directory ensured to exist before opening the SQLite file. */
  sqliteDir?: string;
}

let _db: DatabaseSync | null = null;

/**
 * Apply the per-connection PRAGMAs the Python engine set on every new SQLite
 * connection. WAL gives concurrent reads with a single writer; ``synchronous=
 * NORMAL`` fsyncs only at checkpoint boundaries; ``foreign_keys=ON`` enables the
 * ``ON DELETE CASCADE`` behaviour the channel tables rely on; the 30s
 * ``busy_timeout`` widens the default so a contended writer waits instead of
 * failing fast.
 */
function applySqlitePragmas(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA synchronous=NORMAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec("PRAGMA busy_timeout=30000;");
}

/**
 * Open the database connection and bootstrap the schema.
 *
 * When ``backend`` is ``"memory"`` this is a no-op and {@link getDatabase}
 * keeps returning ``null`` — repositories must check for ``null`` and fall back
 * to in-memory implementations.
 */
export function initEngine(backend: DatabaseBackend, opts: InitEngineOptions = {}): void {
  if (backend === "memory") {
    return;
  }
  if (backend === "postgres") {
    throw new Error("database.backend='postgres' is not supported by the node:sqlite persistence port; use 'sqlite' or 'memory'.");
  }
  if (backend !== "sqlite") {
    throw new Error(`Unknown persistence backend: ${JSON.stringify(backend)}`);
  }

  const dbPath = opts.path ?? path.join(opts.sqliteDir ?? ".", "quill.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  _db = new DatabaseSync(dbPath);
  applySqlitePragmas(_db);
  bootstrapSchema(_db);
}

/** Convenience: initialize the engine from a ``DatabaseConfig``-like object. */
export function initEngineFromConfig(config: DatabaseConfigLike): void {
  if (config.backend === "memory") {
    initEngine("memory");
    return;
  }
  initEngine(config.backend, {
    path: config.sqlite_path,
    sqliteDir: config.backend === "sqlite" ? config.sqlite_dir : undefined,
  });
}

/** Return the shared database handle, or ``null`` when backend=memory. */
export function getDatabase(): DatabaseSync | null {
  return _db;
}

/** Close the connection and release the handle. */
export function closeEngine(): void {
  if (_db !== null) {
    _db.close();
  }
  _db = null;
}
