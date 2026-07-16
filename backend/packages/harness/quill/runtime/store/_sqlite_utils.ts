/**
 * Shared SQLite connection utilities for store and checkpointer providers.
 */

import path from "node:path";
import fs from "node:fs";

export type ResolvePath = (p: string) => string;

/**
 * Return a SQLite connection string ready for use with store/checkpointer backends.
 *
 * SQLite special strings (":memory:" and `file:` URIs) are returned unchanged.
 * Plain filesystem paths — relative or absolute — are resolved to an absolute
 * string via `resolvePath`.
 */
export function resolveSqliteConnStr(raw: string, resolvePath: ResolvePath): string {
  if (raw === ":memory:" || raw.startsWith("file:")) {
    return raw;
  }
  return path.resolve(resolvePath(raw));
}

/**
 * Create parent directory for a SQLite filesystem path.
 *
 * No-op for in-memory databases (":memory:") and `file:` URIs.
 */
export function ensureSqliteParentDir(connStr: string): void {
  if (connStr !== ":memory:" && !connStr.startsWith("file:")) {
    fs.mkdirSync(path.dirname(connStr), { recursive: true });
  }
}
