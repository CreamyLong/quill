/**
 * SQLite-backed task repository (``node:sqlite`` port).
 *
 * Stores work tasks — named contexts bound to a local folder, each grouping
 * multiple conversation threads.
 */

import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { AUTO, resolveUserId, type UserIdParam } from "../_deps.js";
import { coerceIso, nowIso } from "../../utils/time.js";
import { TASKS_TABLE } from "./model.js";

/** Raw ``tasks`` row as returned by ``node:sqlite``. */
type RawRow = Record<string, unknown>;

/** Options for creating a task. */
export interface TaskCreateOptions {
  name: string;
  folder_path: string;
  user_id?: UserIdParam;
}

/** Options for searching tasks. */
export interface TaskSearchOptions {
  folder_path?: string;
  limit?: number;
  offset?: number;
  user_id?: UserIdParam | string | null;
}

export class TaskRepository {
  private readonly _db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this._db = db;
  }

  /** Resolve user id: accept explicit string (from gateway) or resolve from context. */
  private static resolveUserId(userId: UserIdParam | string | null | undefined): string | null {
    if (typeof userId === "string") return userId;
    return resolveUserId(userId ?? AUTO, { methodName: "TaskRepository" });
  }

  private static _rowToDict(row: RawRow): Record<string, unknown> {
    const d: Record<string, unknown> = { ...row };
    for (const key of ["created_at", "updated_at"]) {
      const val = d[key];
      if (typeof val === "string" || val instanceof Date) {
        d[key] = coerceIso(val);
      }
    }
    return d;
  }

  private _get(taskId: string): RawRow | undefined {
    return this._db.prepare(`SELECT * FROM ${TASKS_TABLE} WHERE task_id = ?`).get(taskId);
  }

  async create(taskId: string, opts: TaskCreateOptions): Promise<Record<string, unknown>> {
    const resolvedUserId = TaskRepository.resolveUserId(opts.user_id);
    const now = nowIso();
    this._db
      .prepare(
        `INSERT INTO ${TASKS_TABLE} (task_id, name, folder_path, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(taskId, opts.name, opts.folder_path, resolvedUserId, now, now);
    return TaskRepository._rowToDict(this._get(taskId) as RawRow);
  }

  async get(taskId: string, opts: { user_id?: UserIdParam | string | null } = {}): Promise<Record<string, unknown> | null> {
    const resolvedUserId = TaskRepository.resolveUserId(opts.user_id);
    const row = this._get(taskId);
    if (row === undefined) {
      return null;
    }
    if (resolvedUserId !== null && row.user_id !== resolvedUserId) {
      return null;
    }
    return TaskRepository._rowToDict(row);
  }

  async search(opts: TaskSearchOptions = {}): Promise<Array<Record<string, unknown>>> {
    const { folder_path, limit = 100, offset = 0 } = opts;
    const resolvedUserId = TaskRepository.resolveUserId(opts.user_id);

    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (resolvedUserId !== null) {
      where.push("user_id = ?");
      params.push(resolvedUserId);
    }
    if (folder_path) {
      where.push("folder_path = ?");
      params.push(folder_path);
    }

    const whereSql = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
    const sql = `SELECT * FROM ${TASKS_TABLE}${whereSql} ORDER BY updated_at DESC, task_id DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    const rows = this._db.prepare(sql).all(...params);
    return rows.map((r) => TaskRepository._rowToDict(r));
  }

  /** Find a task by exact folder path (for dedup — one task per folder). */
  async findByFolderPath(folderPath: string, opts: { user_id?: UserIdParam | string | null } = {}): Promise<Record<string, unknown> | null> {
    const resolvedUserId = TaskRepository.resolveUserId(opts.user_id);
    const where = resolvedUserId !== null ? "WHERE folder_path = ? AND user_id = ?" : "WHERE folder_path = ? AND user_id IS NULL";
    const params: SQLInputValue[] = resolvedUserId !== null ? [folderPath, resolvedUserId] : [folderPath];
    const row = this._db.prepare(`SELECT * FROM ${TASKS_TABLE} ${where}`).get(...params);
    if (row === undefined) {
      return null;
    }
    return TaskRepository._rowToDict(row);
  }

  async rename(taskId: string, name: string, opts: { user_id?: UserIdParam | string | null } = {}): Promise<boolean> {
    const resolvedUserId = TaskRepository.resolveUserId(opts.user_id);
    const row = this._get(taskId);
    if (row === undefined) {
      return false;
    }
    if (resolvedUserId !== null && row.user_id !== resolvedUserId) {
      return false;
    }
    this._db.prepare(`UPDATE ${TASKS_TABLE} SET name = ?, updated_at = ? WHERE task_id = ?`).run(name, nowIso(), taskId);
    return true;
  }

  async delete(taskId: string, opts: { user_id?: UserIdParam | string | null } = {}): Promise<void> {
    const resolvedUserId = TaskRepository.resolveUserId(opts.user_id);
    const row = this._get(taskId);
    if (row === undefined) {
      return;
    }
    if (resolvedUserId !== null && row.user_id !== resolvedUserId) {
      return;
    }
    this._db.prepare(`DELETE FROM ${TASKS_TABLE} WHERE task_id = ?`).run(taskId);
  }
}
