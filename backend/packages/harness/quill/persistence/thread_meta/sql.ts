/**
 * SQLite-backed thread metadata repository (``node:sqlite`` port).
 *
 * Ports ``quill.persistence.thread_meta.sql``. Each method mirrors the
 * SQLAlchemy repository's query and owner-filtering logic, executed against a
 * shared ``DatabaseSync`` handle instead of an async session factory. JSON
 * columns are stored as TEXT and (de)serialized at the boundary.
 */

import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { AUTO, resolveUserId, type UserIdParam } from "../_deps.js";
import { coerceIso, nowIso } from "../../utils/time.js";
import { jsonMatch } from "../json_compat.js";
import {
  InvalidMetadataFilterError,
  ThreadMetaStore,
  type ThreadMetaCreateOptions,
  type ThreadMetaSearchOptions,
} from "./base.js";
import { THREADS_META_TABLE } from "./model.js";

/** Raw ``threads_meta`` row as returned by ``node:sqlite`` (JSON still TEXT). */
type RawRow = Record<string, unknown>;

export class ThreadMetaRepository extends ThreadMetaStore {
  private readonly _db: DatabaseSync;

  constructor(db: DatabaseSync) {
    super();
    this._db = db;
  }

  private static _parseJson(value: unknown): Record<string, unknown> {
    if (value === null || value === undefined || value === "") {
      return {};
    }
    if (typeof value === "string") {
      try {
        return (JSON.parse(value) as Record<string, unknown>) || {};
      } catch {
        return {};
      }
    }
    if (typeof value === "object") {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private static _rowToDict(row: RawRow): Record<string, unknown> {
    const d: Record<string, unknown> = { ...row };
    d.metadata = ThreadMetaRepository._parseJson(d.metadata_json) || {};
    delete d.metadata_json;
    for (const key of ["created_at", "updated_at"]) {
      const val = d[key];
      if (typeof val === "string" || val instanceof Date) {
        d[key] = coerceIso(val);
      }
    }
    return d;
  }

  private _get(threadId: string): RawRow | undefined {
    return this._db.prepare(`SELECT * FROM ${THREADS_META_TABLE} WHERE thread_id = ?`).get(threadId);
  }

  async create(threadId: string, opts: ThreadMetaCreateOptions = {}): Promise<Record<string, unknown>> {
    // Auto-resolve userId from context when AUTO; explicit null creates an
    // orphan row (used by migration scripts).
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "ThreadMetaRepository.create" });
    const now = nowIso();
    this._db
      .prepare(
        `INSERT INTO ${THREADS_META_TABLE}
           (thread_id, assistant_id, user_id, display_name, status, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        threadId,
        opts.assistant_id ?? null,
        resolvedUserId,
        opts.display_name ?? null,
        "idle",
        JSON.stringify(opts.metadata ?? {}),
        now,
        now,
      );
    return ThreadMetaRepository._rowToDict(this._get(threadId) as RawRow);
  }

  async get(threadId: string, opts: { user_id?: UserIdParam } = {}): Promise<Record<string, unknown> | null> {
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "ThreadMetaRepository.get" });
    const row = this._get(threadId);
    if (row === undefined) {
      return null;
    }
    // Enforce owner filter unless explicitly bypassed (userId=null).
    if (resolvedUserId !== null && row.user_id !== resolvedUserId) {
      return null;
    }
    return ThreadMetaRepository._rowToDict(row);
  }

  /**
   * Check if ``userId`` has access to ``threadId``.
   *
   * - ``require_existing=false`` (default, permissive): true for a missing row
   *   (untracked legacy thread), a null owner (shared/pre-auth data), or a
   *   matching owner.
   * - ``require_existing=true`` (strict): true only when the row exists AND
   *   (owner matches OR owner is null), closing the delete-idempotence
   *   cross-user gap.
   */
  async checkAccess(threadId: string, userId: string, opts: { require_existing?: boolean } = {}): Promise<boolean> {
    const requireExisting = opts.require_existing ?? false;
    const row = this._get(threadId);
    if (row === undefined) {
      return !requireExisting;
    }
    if (row.user_id === null) {
      return true;
    }
    return row.user_id === userId;
  }

  async search(opts: ThreadMetaSearchOptions = {}): Promise<Array<Record<string, unknown>>> {
    const { metadata, status, limit = 100, offset = 0 } = opts;
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "ThreadMetaRepository.search" });

    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (resolvedUserId !== null) {
      where.push("user_id = ?");
      params.push(resolvedUserId);
    }
    if (status) {
      where.push("status = ?");
      params.push(status);
    }

    if (metadata && Object.keys(metadata).length > 0) {
      let applied = 0;
      for (const [key, value] of Object.entries(metadata)) {
        try {
          const frag = jsonMatch("metadata_json", key, value);
          where.push(frag.sql);
          params.push(...frag.params);
          applied += 1;
        } catch (exc) {
          console.warn(`Skipping metadata filter key ${JSON.stringify(key)}: ${String(exc)}`);
        }
      }
      if (applied === 0) {
        const rejectedKeys = Object.keys(metadata)
          .map((k) => String(k))
          .sort()
          .join(", ");
        throw new InvalidMetadataFilterError(`All metadata filter keys were rejected as unsafe: ${rejectedKeys}`);
      }
    }

    const whereSql = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
    const sql = `SELECT * FROM ${THREADS_META_TABLE}${whereSql} ORDER BY updated_at DESC, thread_id DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    const rows = this._db.prepare(sql).all(...params);
    return rows.map((r) => ThreadMetaRepository._rowToDict(r));
  }

  /** Return true if the row exists and is owned (or the filter is bypassed). */
  private _checkOwnership(threadId: string, resolvedUserId: string | null): boolean {
    if (resolvedUserId === null) {
      return true; // explicit bypass
    }
    const row = this._get(threadId);
    return row !== undefined && row.user_id === resolvedUserId;
  }

  async updateDisplayName(threadId: string, displayName: string, opts: { user_id?: UserIdParam } = {}): Promise<void> {
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "ThreadMetaRepository.update_display_name" });
    if (!this._checkOwnership(threadId, resolvedUserId)) {
      return;
    }
    this._db
      .prepare(`UPDATE ${THREADS_META_TABLE} SET display_name = ?, updated_at = ? WHERE thread_id = ?`)
      .run(displayName, nowIso(), threadId);
  }

  async updateStatus(threadId: string, status: string, opts: { user_id?: UserIdParam } = {}): Promise<void> {
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "ThreadMetaRepository.update_status" });
    if (!this._checkOwnership(threadId, resolvedUserId)) {
      return;
    }
    this._db
      .prepare(`UPDATE ${THREADS_META_TABLE} SET status = ?, updated_at = ? WHERE thread_id = ?`)
      .run(status, nowIso(), threadId);
  }

  /**
   * Merge ``metadata`` into ``metadata_json``.
   *
   * Read-modify-write so concurrent callers see consistent state. No-op if the
   * row does not exist or the owner check fails.
   */
  async updateMetadata(threadId: string, metadata: Record<string, unknown>, opts: { user_id?: UserIdParam } = {}): Promise<void> {
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "ThreadMetaRepository.update_metadata" });
    const row = this._get(threadId);
    if (row === undefined) {
      return;
    }
    if (resolvedUserId !== null && row.user_id !== resolvedUserId) {
      return;
    }
    const merged = { ...ThreadMetaRepository._parseJson(row.metadata_json), ...metadata };
    this._db
      .prepare(`UPDATE ${THREADS_META_TABLE} SET metadata_json = ?, updated_at = ? WHERE thread_id = ?`)
      .run(JSON.stringify(merged), nowIso(), threadId);
  }

  /** Move a thread metadata row to ``ownerUserId``. */
  async updateOwner(threadId: string, ownerUserId: string, opts: { user_id?: UserIdParam } = {}): Promise<void> {
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "ThreadMetaRepository.update_owner" });
    if (!this._checkOwnership(threadId, resolvedUserId)) {
      return;
    }
    this._db
      .prepare(`UPDATE ${THREADS_META_TABLE} SET user_id = ?, updated_at = ? WHERE thread_id = ?`)
      .run(ownerUserId, nowIso(), threadId);
  }

  async delete(threadId: string, opts: { user_id?: UserIdParam } = {}): Promise<void> {
    const resolvedUserId = resolveUserId(opts.user_id ?? AUTO, { methodName: "ThreadMetaRepository.delete" });
    const row = this._get(threadId);
    if (row === undefined) {
      return;
    }
    if (resolvedUserId !== null && row.user_id !== resolvedUserId) {
      return;
    }
    this._db.prepare(`DELETE FROM ${THREADS_META_TABLE} WHERE thread_id = ?`).run(threadId);
  }
}
