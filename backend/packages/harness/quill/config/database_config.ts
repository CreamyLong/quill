/**
 * Unified database backend configuration.
 *
 * Mirrors `quill.config.database_config` from the Python backend.
 */

import path from "node:path";

export type DatabaseBackend = "memory" | "sqlite" | "postgres";

export interface DatabaseConfig {
  /** Storage backend for both checkpointer and application data. */
  backend: DatabaseBackend;
  /** Directory for the SQLite database file. */
  sqliteDir: string;
  /** PostgreSQL connection URL. */
  postgresUrl: string;
  /** Echo SQL statements to log. */
  echoSql: boolean;
  /** Connection pool size for postgres. */
  poolSize: number;
}

export function buildDatabaseConfig(input: Partial<DatabaseConfig> = {}): DatabaseConfig {
  return {
    backend: input.backend ?? "memory",
    sqliteDir: input.sqliteDir ?? ".scitops/data",
    postgresUrl: input.postgresUrl ?? "",
    echoSql: input.echoSql ?? false,
    poolSize: input.poolSize ?? 5,
  };
}

/**
 * Resolve sqlite_dir to an absolute path.
 */
export function resolveSqliteDir(config: DatabaseConfig): string {
  return path.resolve(config.sqliteDir);
}

/**
 * Unified SQLite file path shared by checkpointer and app.
 */
export function sqlitePath(config: DatabaseConfig): string {
  return path.join(resolveSqliteDir(config), "quill.db");
}

/**
 * SQLAlchemy-style async URL for the application ORM engine.
 */
export function appSqlalchemyUrl(config: DatabaseConfig): string {
  if (config.backend === "sqlite") {
    return `sqlite+aiosqlite:///${sqlitePath(config)}`;
  }
  if (config.backend === "postgres") {
    let url = config.postgresUrl;
    if (url.startsWith("postgresql://")) {
      url = url.replace("postgresql://", "postgresql+asyncpg://");
    }
    return url;
  }
  throw new Error(`No SQLAlchemy URL for backend=${config.backend}`);
}
