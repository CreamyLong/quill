/**
 * Sync checkpointer factory.
 *
 * Provides a sync singleton and a one-shot factory for LangGraph graph
 * compilation and CLI tools.
 *
 * Supported backends: memory, sqlite, postgres.
 *
 * NOTE (TS port):
 * - The Python code instantiates LangGraph's built-in `SqliteSaver`. There is no
 *   equivalent TS package installed, so the `sqlite` backend is served by
 *   {@link SqliteCheckpointSaver}, a node:sqlite-backed `BaseCheckpointSaver`
 *   implementation defined here (checkpoints + writes stored as JSON blobs).
 * - The `postgres` backend has no TS analogue and throws {@link POSTGRES_INSTALL}.
 * - `quill.config.checkpointer_config` is not ported; config is read from
 *   `getAppConfig().checkpointer`.
 * - Node has no sync/async split for these backends, so the "sync" naming is
 *   preserved for parity but the factory returns `{ checkpointer, close }`.
 */

import { DatabaseSync, type StatementSync } from "node:sqlite";

import type { RunnableConfig } from "@langchain/core/runnables";
import { BaseCheckpointSaver, MemorySaver } from "@langchain/langgraph";
import type {
  ChannelVersions,
  Checkpoint,
  CheckpointListOptions,
  CheckpointMetadata,
  CheckpointPendingWrite,
  CheckpointTuple,
  PendingWrite,
} from "@langchain/langgraph-checkpoint";

import { getAppConfig } from "../../config/app_config.js";
import { resolvePath } from "../../config/paths.js";
import { ensureSqliteParentDir, resolveSqliteConnStr } from "../store/_sqlite_utils.js";

const logger = {
  info: (...a: unknown[]) => console.info(...a),
  warning: (...a: unknown[]) => console.warn(...a),
};

// ---------------------------------------------------------------------------
// Error message constants — imported by async_provider too
// ---------------------------------------------------------------------------

export const SQLITE_INSTALL =
  "langgraph-checkpoint-sqlite is required for the SQLite checkpointer. Install it with: uv add langgraph-checkpoint-sqlite";
export const POSTGRES_INSTALL =
  "langgraph-checkpoint-postgres is required for the PostgreSQL checkpointer. Install the package extra with: pip install 'quill-harness[postgres]' (or use: uv sync --all-packages --extra postgres when developing locally)";
export const POSTGRES_CONN_REQUIRED = "checkpointer.connection_string is required for the postgres backend";

export type CheckpointerType = "memory" | "sqlite" | "postgres";

/** Minimal local view of the checkpointer config section. */
export interface CheckpointerConfig {
  type: CheckpointerType;
  connection_string?: string | null;
}

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// node:sqlite-backed checkpoint saver
// ---------------------------------------------------------------------------

/**
 * A `BaseCheckpointSaver` backed by Node's built-in `node:sqlite`.
 *
 * Checkpoints and pending writes are persisted as JSON blobs. This is the TS
 * analogue of LangGraph's `SqliteSaver` (which has no installed TS package).
 */
export class SqliteCheckpointSaver extends BaseCheckpointSaver {
  private _db: DatabaseSync;

  constructor(connStr: string) {
    super();
    this._db = new DatabaseSync(connStr);
    if (connStr !== ":memory:") {
      try {
        this._db.exec("PRAGMA journal_mode = WAL;");
      } catch {
        // Some filesystems / URIs reject WAL — non-fatal.
      }
    }
    this._db.exec("PRAGMA busy_timeout = 5000;");
  }

  /** Create the backing tables. Idempotent. */
  setup(): void {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id            TEXT NOT NULL,
        checkpoint_ns        TEXT NOT NULL DEFAULT '',
        checkpoint_id        TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        checkpoint           TEXT NOT NULL,
        metadata             TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      );
    `);
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoint_writes (
        thread_id     TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id       TEXT NOT NULL,
        idx           INTEGER NOT NULL,
        channel       TEXT NOT NULL,
        value         TEXT,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
      );
    `);
  }

  private _prepare(sql: string): StatementSync {
    return this._db.prepare(sql);
  }

  private _loadPendingWrites(
    threadId: string,
    checkpointNs: string,
    checkpointId: string
  ): CheckpointPendingWrite[] {
    const rows = this._prepare(
      `SELECT task_id, channel, value FROM checkpoint_writes
       WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
       ORDER BY task_id, idx`
    ).all(threadId, checkpointNs, checkpointId) as Row[];
    return rows.map((r) => {
      const value = typeof r["value"] === "string" ? safeJsonParse(r["value"] as string) : r["value"];
      return [String(r["task_id"]), String(r["channel"]), value] as CheckpointPendingWrite;
    });
  }

  private _rowToTuple(row: Row): CheckpointTuple {
    const threadId = String(row["thread_id"]);
    const checkpointNs = String(row["checkpoint_ns"] ?? "");
    const checkpointId = String(row["checkpoint_id"]);
    const checkpoint = safeJsonParse(String(row["checkpoint"])) as Checkpoint;
    const metadata = safeJsonParse(String(row["metadata"] ?? "{}")) as CheckpointMetadata;
    const parentCheckpointId = (row["parent_checkpoint_id"] as string | null) ?? null;
    const tuple: CheckpointTuple = {
      config: { configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: checkpointId } },
      checkpoint,
      metadata,
      pendingWrites: this._loadPendingWrites(threadId, checkpointNs, checkpointId),
    };
    if (parentCheckpointId) {
      tuple.parentConfig = {
        configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: parentCheckpointId },
      };
    }
    return tuple;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const configurable = (config.configurable ?? {}) as Record<string, unknown>;
    const threadId = String(configurable["thread_id"]);
    const checkpointNs = String(configurable["checkpoint_ns"] ?? "");
    const checkpointId = configurable["checkpoint_id"] as string | undefined;

    let row: Row | undefined;
    if (checkpointId) {
      row = this._prepare(
        `SELECT * FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`
      ).get(threadId, checkpointNs, checkpointId) as Row | undefined;
    } else {
      row = this._prepare(
        `SELECT * FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ? ORDER BY rowid DESC LIMIT 1`
      ).get(threadId, checkpointNs) as Row | undefined;
    }
    if (row === undefined) {
      return undefined;
    }
    return this._rowToTuple(row);
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const configurable = (config.configurable ?? {}) as Record<string, unknown>;
    const threadId = configurable["thread_id"] as string | undefined;
    const checkpointNs = configurable["checkpoint_ns"] as string | undefined;

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (threadId !== undefined) {
      conditions.push("thread_id = ?");
      params.push(threadId);
    }
    if (checkpointNs !== undefined) {
      conditions.push("checkpoint_ns = ?");
      params.push(checkpointNs);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    let rows = this._prepare(`SELECT * FROM checkpoints ${where} ORDER BY rowid DESC`).all(...params) as Row[];

    // `before` cursor: only checkpoints created before the given id.
    const beforeId = ((options?.before?.configurable ?? {}) as Record<string, unknown>)["checkpoint_id"] as
      | string
      | undefined;
    if (beforeId) {
      const idx = rows.findIndex((r) => String(r["checkpoint_id"]) === beforeId);
      if (idx >= 0) {
        rows = rows.slice(idx + 1);
      }
    }

    const filter = options?.filter;
    let count = 0;
    for (const row of rows) {
      const tuple = this._rowToTuple(row);
      if (filter && !metadataMatches(tuple.metadata, filter)) {
        continue;
      }
      yield tuple;
      count += 1;
      if (options?.limit !== undefined && count >= options.limit) {
        return;
      }
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    const configurable = (config.configurable ?? {}) as Record<string, unknown>;
    const threadId = String(configurable["thread_id"]);
    const checkpointNs = String(configurable["checkpoint_ns"] ?? "");
    const checkpointId = checkpoint.id;
    const parentCheckpointId = (configurable["checkpoint_id"] as string | undefined) ?? null;

    this._prepare(
      `INSERT INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(thread_id, checkpoint_ns, checkpoint_id)
       DO UPDATE SET parent_checkpoint_id = excluded.parent_checkpoint_id,
                     checkpoint = excluded.checkpoint,
                     metadata = excluded.metadata`
    ).run(
      threadId,
      checkpointNs,
      checkpointId,
      parentCheckpointId,
      JSON.stringify(checkpoint),
      JSON.stringify(metadata ?? {})
    );

    return { configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: checkpointId } };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const configurable = (config.configurable ?? {}) as Record<string, unknown>;
    const threadId = String(configurable["thread_id"]);
    const checkpointNs = String(configurable["checkpoint_ns"] ?? "");
    const checkpointId = String(configurable["checkpoint_id"]);

    const insert = this._prepare(
      `INSERT INTO checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, value)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
       DO UPDATE SET channel = excluded.channel, value = excluded.value`
    );
    for (let idx = 0; idx < writes.length; idx++) {
      const [channel, value] = writes[idx]!;
      insert.run(threadId, checkpointNs, checkpointId, taskId, idx, String(channel), JSON.stringify(value));
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    this._prepare("DELETE FROM checkpoints WHERE thread_id = ?").run(threadId);
    this._prepare("DELETE FROM checkpoint_writes WHERE thread_id = ?").run(threadId);
  }

  /** Close the underlying database connection. */
  close(): void {
    this._db.close();
  }
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function parseCheckpointerConfig(raw: Record<string, unknown>): CheckpointerConfig {
  return {
    type: (raw["type"] as CheckpointerType) ?? "memory",
    connection_string:
      (raw["connection_string"] as string | null | undefined) ??
      (raw["connectionString"] as string | null | undefined) ??
      null,
  };
}

/** Get the current checkpointer configuration, or null if not configured. */
export function getCheckpointerConfig(): CheckpointerConfig | null {
  const raw = getAppConfig().checkpointer;
  if (raw === null || raw === undefined) {
    return null;
  }
  return parseCheckpointerConfig(raw);
}

/** Lazily load app config when checkpointer config has not been initialized. */
export function ensureConfigLoaded(): void {
  // getAppConfig() loads lazily in the TS port; nothing to do here.
}

// ---------------------------------------------------------------------------
// Sync factory
// ---------------------------------------------------------------------------

/** Build a checkpointer + its cleanup callback from a resolved config. */
export function buildCheckpointer(config: CheckpointerConfig): {
  checkpointer: BaseCheckpointSaver;
  close: () => void;
} {
  if (config.type === "memory") {
    logger.info("Checkpointer: using MemorySaver (in-process, not persistent)");
    return { checkpointer: new MemorySaver(), close: () => {} };
  }

  if (config.type === "sqlite") {
    const connStr = resolveSqliteConnStr(config.connection_string || "store.db", resolvePath);
    ensureSqliteParentDir(connStr);
    const saver = new SqliteCheckpointSaver(connStr);
    saver.setup();
    logger.info("Checkpointer: using SqliteCheckpointSaver (%s)", connStr);
    return { checkpointer: saver, close: () => saver.close() };
  }

  if (config.type === "postgres") {
    if (!config.connection_string) {
      throw new Error(POSTGRES_CONN_REQUIRED);
    }
    // No TS analogue for langgraph's PostgresSaver.
    throw new Error(POSTGRES_INSTALL);
  }

  throw new Error(`Unknown checkpointer type: ${JSON.stringify(config.type)}`);
}

// ---------------------------------------------------------------------------
// Sync singleton
// ---------------------------------------------------------------------------

let _checkpointer: BaseCheckpointSaver | null = null;
let _checkpointerClose: (() => void) | null = null;

/**
 * Return the global checkpointer singleton, creating it on first call.
 *
 * Returns a `MemorySaver` when no checkpointer is configured in config.yaml.
 */
export function getCheckpointer(): BaseCheckpointSaver {
  if (_checkpointer !== null) {
    return _checkpointer;
  }
  ensureConfigLoaded();

  const config = getCheckpointerConfig();
  if (config === null) {
    logger.info("Checkpointer: using MemorySaver (in-process, not persistent)");
    _checkpointer = new MemorySaver();
    return _checkpointer;
  }

  const { checkpointer, close } = buildCheckpointer(config);
  _checkpointer = checkpointer;
  _checkpointerClose = close;
  return _checkpointer;
}

/**
 * Reset the singleton, forcing recreation on the next call.
 *
 * Closes any open backend connections and clears the cached instance.
 */
export function resetCheckpointer(): void {
  if (_checkpointerClose !== null) {
    try {
      _checkpointerClose();
    } catch {
      logger.warning("Error during checkpointer cleanup");
    }
    _checkpointerClose = null;
  }
  _checkpointer = null;
}

// ---------------------------------------------------------------------------
// One-shot factory (context-manager analogue)
// ---------------------------------------------------------------------------

/**
 * Create a fresh checkpointer and its cleanup callback.
 *
 * Unlike {@link getCheckpointer}, this does not cache the instance — each call
 * builds and returns a new connection plus a `close()` the caller must invoke.
 * Returns a `MemorySaver` when no checkpointer is configured in config.yaml.
 */
export function checkpointerContext(): { checkpointer: BaseCheckpointSaver; close: () => void } {
  const raw = getAppConfig().checkpointer;
  if (raw === null || raw === undefined) {
    return { checkpointer: new MemorySaver(), close: () => {} };
  }
  return buildCheckpointer(parseCheckpointerConfig(raw));
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function metadataMatches(metadata: CheckpointMetadata | undefined, filter: Record<string, unknown>): boolean {
  if (metadata === undefined) {
    return false;
  }
  const meta = metadata as Record<string, unknown>;
  for (const [key, value] of Object.entries(filter)) {
    if (JSON.stringify(meta[key]) !== JSON.stringify(value)) {
      return false;
    }
  }
  return true;
}
