/**
 * Async checkpointer factory.
 *
 * Provides an async factory for long-running servers that need proper resource
 * cleanup.
 *
 * Supported backends: memory, sqlite, postgres.
 *
 * Usage (e.g. server lifespan)::
 *
 *     const { checkpointer, close } = await makeCheckpointer();
 *     // ... use checkpointer ...
 *     await close();
 *
 * For the sync variant see `quill.runtime.checkpointer.provider`.
 *
 * NOTE (TS port): Node has no sync/async split for these backends, and the
 * Python `@asynccontextmanager` has no direct analogue, so this returns
 * `{ checkpointer, close }`; the caller invokes `close()` in a `finally`.
 * The `sqlite` backend uses {@link SqliteCheckpointSaver} (node:sqlite) and the
 * `postgres` backend has no TS analogue (throws {@link POSTGRES_INSTALL}).
 */

import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";

import { getAppConfig, type AppConfig } from "../../config/app_config.js";
import type { DatabaseConfig } from "../../config/database_config.js";
import { sqlitePath } from "../../config/database_config.js";
import { ensureSqliteParentDir } from "../store/_sqlite_utils.js";
import {
  buildCheckpointer,
  POSTGRES_INSTALL,
  SqliteCheckpointSaver,
  type CheckpointerConfig,
  type CheckpointerType,
} from "./provider.js";

const logger = {
  info: (...a: unknown[]) => console.info(...a),
};

export interface CheckpointerHandle {
  checkpointer: BaseCheckpointSaver;
  close: () => Promise<void> | void;
}

function parseCheckpointerConfig(raw: Record<string, unknown>): CheckpointerConfig {
  return {
    type: (raw["type"] as CheckpointerType) ?? "memory",
    connection_string:
      (raw["connection_string"] as string | null | undefined) ??
      (raw["connectionString"] as string | null | undefined) ??
      null,
  };
}

/** Construct a checkpointer from the unified DatabaseConfig. */
function buildCheckpointerFromDatabase(dbConfig: DatabaseConfig): CheckpointerHandle {
  if (dbConfig.backend === "memory") {
    return { checkpointer: new MemorySaver(), close: () => {} };
  }

  if (dbConfig.backend === "sqlite") {
    const connStr = sqlitePath(dbConfig);
    ensureSqliteParentDir(connStr);
    const saver = new SqliteCheckpointSaver(connStr);
    saver.setup();
    logger.info("Checkpointer: using SqliteCheckpointSaver (%s)", connStr);
    return { checkpointer: saver, close: () => saver.close() };
  }

  if (dbConfig.backend === "postgres") {
    if (!dbConfig.postgresUrl) {
      throw new Error("database.postgres_url is required for the postgres backend");
    }
    // No TS analogue for langgraph's AsyncPostgresSaver.
    throw new Error(POSTGRES_INSTALL);
  }

  throw new Error(`Unknown database backend: ${JSON.stringify(dbConfig.backend)}`);
}

/**
 * Async factory that yields a checkpointer for the caller's lifetime.
 *
 * Returns a `MemorySaver` when no checkpointer is configured in config.yaml.
 *
 * Priority:
 * 1. Legacy `checkpointer:` config section (backward compatible)
 * 2. Unified `database:` config section
 * 3. Default MemorySaver
 */
export async function makeCheckpointer(appConfig: AppConfig | null = null): Promise<CheckpointerHandle> {
  const config = appConfig ?? getAppConfig();

  // Legacy: standalone checkpointer config takes precedence.
  // An empty object ({}) means "no legacy config" — section() returns {} for
  // missing keys, so we must also check that the object actually has fields.
  if (
    config.checkpointer !== null &&
    config.checkpointer !== undefined &&
    Object.keys(config.checkpointer).length > 0
  ) {
    return buildCheckpointer(parseCheckpointerConfig(config.checkpointer));
  }

  // Unified database config.
  const dbConfig = config.database;
  if (dbConfig !== null && dbConfig !== undefined && dbConfig.backend !== "memory") {
    return buildCheckpointerFromDatabase(dbConfig);
  }

  // Default: in-memory.
  return { checkpointer: new MemorySaver(), close: () => {} };
}
