/**
 * Sync Store factory.
 *
 * Provides a sync singleton and a one-shot factory for CLI tools and the
 * embedded client. The backend mirrors the configured checkpointer so that both
 * always use the same persistence technology. Supported backends: memory,
 * sqlite, postgres.
 *
 * NOTE (TS port):
 * - The Python code instantiates LangGraph's built-in `SqliteStore`. There is no
 *   equivalent TS package installed, so the `sqlite` backend is served by
 *   {@link SqliteStore}, a node:sqlite-backed `BaseStore` implementation defined
 *   here (see `backend/scripts/sqlite_store.mjs` for the JSON-blob pattern).
 * - The `postgres` backend has no TS analogue and throws {@link POSTGRES_STORE_INSTALL}.
 * - Store config mirrors the checkpointer config, read via the checkpointer
 *   provider's `getCheckpointerConfig()`.
 * - Node has no sync/async split, so the factory returns `{ store, close }`.
 */

import { DatabaseSync, type StatementSync } from "node:sqlite";

import {
  BaseStore,
  InMemoryStore,
  type GetOperation,
  type Item,
  type ListNamespacesOperation,
  type MatchCondition,
  type Operation,
  type OperationResults,
  type PutOperation,
  type SearchItem,
  type SearchOperation,
} from "@langchain/langgraph-checkpoint";

import { getAppConfig } from "../../config/app_config.js";
import { resolvePath } from "../../config/paths.js";
import type { DatabaseConfig } from "../../config/database_config.js";
import { sqlitePath } from "../../config/database_config.js";
import { ensureConfigLoaded, getCheckpointerConfig, type CheckpointerConfig } from "../checkpointer/provider.js";
import { ensureSqliteParentDir, resolveSqliteConnStr } from "./_sqlite_utils.js";

export { ensureSqliteParentDir, resolveSqliteConnStr } from "./_sqlite_utils.js";

const logger = {
  info: (...a: unknown[]) => console.info(...a),
  warning: (...a: unknown[]) => console.warn(...a),
};

// ---------------------------------------------------------------------------
// Error message constants
// ---------------------------------------------------------------------------

export const SQLITE_STORE_INSTALL =
  "langgraph-checkpoint-sqlite is required for the SQLite store. Install it with: uv add langgraph-checkpoint-sqlite";
export const POSTGRES_STORE_INSTALL =
  "langgraph-checkpoint-postgres is required for the PostgreSQL store. Install the package extra with: pip install 'quill-harness[postgres]' (or use: uv sync --all-packages --extra postgres when developing locally)";
export const POSTGRES_CONN_REQUIRED = "checkpointer.connection_string is required for the postgres backend";

const NS_SEP = "\x1f";
type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// node:sqlite-backed BaseStore
// ---------------------------------------------------------------------------

/**
 * A `BaseStore` backed by Node's built-in `node:sqlite`.
 *
 * Items are persisted as JSON blobs keyed by (namespace, key). Vector/semantic
 * search is not supported (matching the metadata-filter path of langgraph's
 * SqliteStore); `query` in a SearchOperation is ignored.
 */
export class SqliteStore extends BaseStore {
  private _db: DatabaseSync;

  constructor(connStr: string) {
    super();
    this._db = new DatabaseSync(connStr);
    if (connStr !== ":memory:") {
      try {
        this._db.exec("PRAGMA journal_mode = WAL;");
      } catch {
        // Non-fatal on filesystems that reject WAL.
      }
    }
    this._db.exec("PRAGMA busy_timeout = 5000;");
  }

  /** Create the backing table. Idempotent. */
  setup(): void {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS store (
        namespace  TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (namespace, key)
      );
    `);
  }

  private _prepare(sql: string): StatementSync {
    return this._db.prepare(sql);
  }

  private static _nsKey(namespace: string[]): string {
    return namespace.join(NS_SEP);
  }

  private static _nsFromKey(nsKey: string): string[] {
    return nsKey === "" ? [] : nsKey.split(NS_SEP);
  }

  private static _rowToItem(row: Row): Item {
    return {
      value: safeJsonParse(String(row["value"])) as Record<string, unknown>,
      key: String(row["key"]),
      namespace: SqliteStore._nsFromKey(String(row["namespace"])),
      createdAt: new Date(String(row["created_at"])),
      updatedAt: new Date(String(row["updated_at"])),
    };
  }

  private _get(op: GetOperation): Item | null {
    const row = this._prepare("SELECT * FROM store WHERE namespace = ? AND key = ?").get(
      SqliteStore._nsKey(op.namespace),
      op.key
    ) as Row | undefined;
    return row === undefined ? null : SqliteStore._rowToItem(row);
  }

  private _put(op: PutOperation): void {
    const nsKey = SqliteStore._nsKey(op.namespace);
    if (op.value === null) {
      this._prepare("DELETE FROM store WHERE namespace = ? AND key = ?").run(nsKey, op.key);
      return;
    }
    const now = new Date().toISOString();
    this._prepare(
      `INSERT INTO store (namespace, key, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(namespace, key)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(nsKey, op.key, JSON.stringify(op.value), now, now);
  }

  private _search(op: SearchOperation): SearchItem[] {
    const prefixKey = SqliteStore._nsKey(op.namespacePrefix);
    let rows: Row[];
    if (prefixKey === "") {
      rows = this._prepare("SELECT * FROM store").all() as Row[];
    } else {
      rows = this._prepare("SELECT * FROM store WHERE namespace = ? OR namespace LIKE ?").all(
        prefixKey,
        `${prefixKey}${NS_SEP}%`
      ) as Row[];
    }
    let items = rows.map((r) => SqliteStore._rowToItem(r));
    if (op.filter) {
      items = items.filter((item) => matchesFilter(item.value, op.filter as Record<string, unknown>));
    }
    const offset = op.offset ?? 0;
    const limit = op.limit ?? 10;
    return items.slice(offset, offset + limit) as SearchItem[];
  }

  private _listNamespaces(op: ListNamespacesOperation): string[][] {
    const rows = this._prepare("SELECT DISTINCT namespace FROM store").all() as Row[];
    const seen = new Set<string>();
    let namespaces: string[][] = [];
    for (const row of rows) {
      let ns = SqliteStore._nsFromKey(String(row["namespace"]));
      if (op.maxDepth !== undefined && op.maxDepth !== null) {
        ns = ns.slice(0, op.maxDepth);
      }
      const key = ns.join(NS_SEP);
      if (!seen.has(key)) {
        seen.add(key);
        namespaces.push(ns);
      }
    }
    if (op.matchConditions && op.matchConditions.length > 0) {
      namespaces = namespaces.filter((ns) =>
        (op.matchConditions as MatchCondition[]).every((cond) => matchesCondition(ns, cond))
      );
    }
    const offset = op.offset ?? 0;
    const limit = op.limit ?? namespaces.length;
    return namespaces.slice(offset, offset + limit);
  }

  async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    const results: unknown[] = [];
    for (const op of operations) {
      if ("value" in op) {
        this._put(op as PutOperation);
        results.push(undefined);
      } else if ("namespacePrefix" in op) {
        results.push(this._search(op as SearchOperation));
      } else if ("key" in op && "namespace" in op) {
        results.push(this._get(op as GetOperation));
      } else {
        results.push(this._listNamespaces(op as ListNamespacesOperation));
      }
    }
    return results as OperationResults<Op>;
  }

  /** Close the underlying database connection. */
  close(): void {
    this._db.close();
  }
}

// ---------------------------------------------------------------------------
// Sync factory
// ---------------------------------------------------------------------------

export interface StoreHandle {
  store: BaseStore;
  close: () => void;
}

/** Build a Store + its cleanup callback from a resolved (checkpointer) config. */
export function buildStore(config: CheckpointerConfig): StoreHandle {
  if (config.type === "memory") {
    logger.info("Store: using InMemoryStore (in-process, not persistent)");
    return { store: new InMemoryStore(), close: () => {} };
  }

  if (config.type === "sqlite") {
    const connStr = resolveSqliteConnStr(config.connection_string || "store.db", resolvePath);
    ensureSqliteParentDir(connStr);
    const store = new SqliteStore(connStr);
    store.setup();
    logger.info("Store: using SqliteStore (%s)", connStr);
    return { store, close: () => store.close() };
  }

  if (config.type === "postgres") {
    if (!config.connection_string) {
      throw new Error(POSTGRES_CONN_REQUIRED);
    }
    // No TS analogue for langgraph's PostgresStore.
    throw new Error(POSTGRES_STORE_INSTALL);
  }

  throw new Error(`Unknown store backend type: ${JSON.stringify(config.type)}`);
}

// ---------------------------------------------------------------------------
// Sync singleton
// ---------------------------------------------------------------------------

let _store: BaseStore | null = null;
let _storeClose: (() => void) | null = null;

const NO_CHECKPOINTER_WARNING =
  "No 'checkpointer' section in config.yaml — using InMemoryStore for the store. Thread list will be lost on server restart. Configure a sqlite or postgres backend for persistence.";

/**
 * Return the global Store singleton, creating it on first call.
 *
 * Returns an `InMemoryStore` when no checkpointer is configured in config.yaml.
 */
export function getStore(): BaseStore {
  if (_store !== null) {
    return _store;
  }
  ensureConfigLoaded();

  const config = resolveStoreConfig();
  if (config === null) {
    logger.warning(NO_CHECKPOINTER_WARNING);
    _store = new InMemoryStore();
    return _store;
  }

  const { store, close } = buildStore(config);
  _store = store;
  _storeClose = close;
  return _store;
}

/** Reset the singleton, forcing recreation on the next call. */
export function resetStore(): void {
  if (_storeClose !== null) {
    try {
      _storeClose();
    } catch {
      logger.warning("Error during store cleanup");
    }
    _storeClose = null;
  }
  _store = null;
}

// ---------------------------------------------------------------------------
// One-shot factory (context-manager analogue)
// ---------------------------------------------------------------------------

/**
 * Resolve the effective store backend config.
 *
 * Priority:
 * 1. Legacy `checkpointer:` section (if it has fields — section() returns {}
 *    for missing keys, which must NOT be treated as a real config).
 * 2. Unified `database:` section.
 * 3. null (caller falls back to InMemoryStore).
 */
function resolveStoreConfig(): CheckpointerConfig | null {
  const appConfig = getAppConfig();

  // Legacy checkpointer config — only trust it if it actually has fields.
  const cp = appConfig.checkpointer;
  if (cp !== null && cp !== undefined && Object.keys(cp).length > 0) {
    return {
      type: (cp["type"] as CheckpointerConfig["type"]) ?? "memory",
      connection_string:
        (cp["connection_string"] as string | null | undefined) ??
        (cp["connectionString"] as string | null | undefined) ??
        null,
    };
  }

  // Unified database config.
  const db = appConfig.database as DatabaseConfig | null | undefined;
  if (db !== null && db !== undefined && db.backend !== "memory") {
    if (db.backend === "sqlite") {
      return { type: "sqlite", connection_string: sqlitePath(db) };
    }
    if (db.backend === "postgres") {
      return { type: "postgres", connection_string: db.postgresUrl || null };
    }
  }

  return null;
}

/**
 * Create a fresh Store and its cleanup callback.
 *
 * Unlike {@link getStore}, this does not cache the instance — each call builds a
 * new connection plus a `close()` the caller must invoke. Returns an
 * `InMemoryStore` when no checkpointer is configured in config.yaml.
 */
export function storeContext(): StoreHandle {
  const config = resolveStoreConfig();
  if (config === null) {
    logger.warning(NO_CHECKPOINTER_WARNING);
    return { store: new InMemoryStore(), close: () => {} };
  }
  return buildStore(config);
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function matchesFilter(value: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    const actual = value[key];
    if (condition !== null && typeof condition === "object" && !Array.isArray(condition)) {
      for (const [op, operand] of Object.entries(condition as Record<string, unknown>)) {
        if (!compareOp(actual, op, operand)) {
          return false;
        }
      }
    } else if (JSON.stringify(actual) !== JSON.stringify(condition)) {
      return false;
    }
  }
  return true;
}

function compareOp(actual: unknown, op: string, operand: unknown): boolean {
  switch (op) {
    case "$eq":
      return JSON.stringify(actual) === JSON.stringify(operand);
    case "$ne":
      return JSON.stringify(actual) !== JSON.stringify(operand);
    case "$gt":
      return (actual as number) > (operand as number);
    case "$gte":
      return (actual as number) >= (operand as number);
    case "$lt":
      return (actual as number) < (operand as number);
    case "$lte":
      return (actual as number) <= (operand as number);
    default:
      return JSON.stringify(actual) === JSON.stringify(operand);
  }
}

function matchesCondition(namespace: string[], condition: MatchCondition): boolean {
  const path = condition.path;
  if (condition.matchType === "prefix") {
    if (namespace.length < path.length) {
      return false;
    }
    for (let i = 0; i < path.length; i++) {
      if (path[i] !== "*" && path[i] !== namespace[i]) {
        return false;
      }
    }
    return true;
  }
  // suffix
  if (namespace.length < path.length) {
    return false;
  }
  const offset = namespace.length - path.length;
  for (let i = 0; i < path.length; i++) {
    if (path[i] !== "*" && path[i] !== namespace[offset + i]) {
      return false;
    }
  }
  return true;
}
