/**
 * SQLite-backed repository for user-owned IM channel connections (``node:sqlite`` port).
 *
 * Ports ``quill.persistence.channel_connections.sql``. Mirrors the SQLAlchemy
 * repository's query logic, transactions, and the single-active-owner
 * invariant, executed against a shared ``DatabaseSync`` handle.
 *
 * ``ChannelCredentialCipher`` reproduces the Python ``cryptography.fernet``
 * behaviour with ``node:crypto`` primitives (AES-128-CBC + HMAC-SHA256, the
 * Fernet v0x80 token layout), so no third-party dependency is required. The
 * same ``sha256(key)`` → Fernet-key derivation and ``fernet:v1:`` envelope are
 * preserved, giving wire-compatible ciphertext with the Python side.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { coerceIso } from "../../utils/time.js";
import { closeEngine } from "../engine.js";
import {
  CHANNEL_CONNECTIONS_TABLE,
  CHANNEL_CONVERSATIONS_TABLE,
  CHANNEL_CREDENTIALS_TABLE,
  CHANNEL_OAUTH_STATES_TABLE,
} from "./model.js";

type RawRow = Record<string, unknown>;

// Bounded retries for upsertConnection when a conflicting row is committed
// first (same owner identity, or the same active external identity guarded by
// the partial unique index).
const UPSERT_MAX_ATTEMPTS = 3;

/** Raised when a Fernet token fails authentication or decryption. */
export class InvalidTokenError extends Error {
  constructor(message = "invalid Fernet token") {
    super(message);
    this.name = "InvalidTokenError";
  }
}

/**
 * Minimal Fernet implementation over ``node:crypto``.
 *
 * Token = base64url( 0x80 || timestamp(8, big-endian) || IV(16) || AES-128-CBC
 * ciphertext || HMAC-SHA256(32) ). Reproduces ``cryptography.fernet.Fernet``.
 */
class Fernet {
  private readonly signingKey: Buffer;
  private readonly encryptionKey: Buffer;

  /** @param key32 32-byte key material (signing = first 16, encryption = last 16). */
  constructor(key32: Buffer) {
    if (key32.length !== 32) {
      throw new Error("Fernet key must be 32 bytes");
    }
    this.signingKey = key32.subarray(0, 16);
    this.encryptionKey = key32.subarray(16, 32);
  }

  encrypt(data: Buffer): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-128-cbc", this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    const timestamp = Buffer.alloc(8);
    timestamp.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));
    const version = Buffer.from([0x80]);
    const preHmac = Buffer.concat([version, timestamp, iv, ciphertext]);
    const hmac = createHmac("sha256", this.signingKey).update(preHmac).digest();
    return Buffer.concat([preHmac, hmac]).toString("base64url");
  }

  decrypt(token: string): Buffer {
    let data: Buffer;
    try {
      data = Buffer.from(token, "base64url");
    } catch {
      throw new InvalidTokenError();
    }
    if (data.length < 1 + 8 + 16 + 32 || data[0] !== 0x80) {
      throw new InvalidTokenError();
    }
    const hmac = data.subarray(data.length - 32);
    const preHmac = data.subarray(0, data.length - 32);
    const expected = createHmac("sha256", this.signingKey).update(preHmac).digest();
    if (hmac.length !== expected.length || !timingSafeEqual(hmac, expected)) {
      throw new InvalidTokenError();
    }
    const iv = data.subarray(9, 25);
    const ciphertext = data.subarray(25, data.length - 32);
    try {
      const decipher = createDecipheriv("aes-128-cbc", this.encryptionKey, iv);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new InvalidTokenError();
    }
  }
}

/** Encrypts provider credentials before they are persisted. */
export class ChannelCredentialCipher {
  private readonly _fernet: Fernet;

  constructor(fernet: Fernet) {
    this._fernet = fernet;
  }

  static fromKey(key: string): ChannelCredentialCipher {
    const digest = createHash("sha256").update(key, "utf-8").digest();
    return new ChannelCredentialCipher(new Fernet(digest));
  }

  encryptText(value: string | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    return "fernet:v1:" + this._fernet.encrypt(Buffer.from(value, "utf-8"));
  }

  decryptText(value: string | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    const token = value.startsWith("fernet:v1:") ? value.slice("fernet:v1:".length) : value;
    return this._fernet.decrypt(token).toString("utf-8");
  }
}

/** Persistence facade for channel connections, credentials, and conversations. */
export class ChannelConnectionRepository {
  private readonly db: DatabaseSync;
  private readonly _cipher: ChannelCredentialCipher | null;

  constructor(db: DatabaseSync, opts: { cipher?: ChannelCredentialCipher | null } = {}) {
    this.db = db;
    this._cipher = opts.cipher ?? null;
  }

  async close(): Promise<void> {
    closeEngine();
  }

  private static _newId(): string {
    return randomUUID().replaceAll("-", "");
  }

  private static _normalizeOptionalIdentity(value: string | null | undefined): string {
    return value || "";
  }

  private static _coerceDatetime(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "string" || value instanceof Date) {
      return coerceIso(value);
    }
    return null;
  }

  private static _parseObject(value: unknown): Record<string, unknown> {
    if (typeof value === "string" && value !== "") {
      try {
        return (JSON.parse(value) as Record<string, unknown>) || {};
      } catch {
        return {};
      }
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private static _parseArray(value: unknown): unknown[] {
    if (typeof value === "string" && value !== "") {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return Array.isArray(value) ? value : [];
  }

  private _encryptOptionalSecret(value: string | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (this._cipher === null) {
      throw new Error("channel connection encryption key is required");
    }
    return this._cipher.encryptText(value);
  }

  private static _connectionToDict(row: RawRow): Record<string, unknown> {
    const data: Record<string, unknown> = { ...row };
    data.external_account_id = data.external_account_id || null;
    data.workspace_id = data.workspace_id || null;
    data.scopes = ChannelConnectionRepository._parseArray(data.scopes_json);
    delete data.scopes_json;
    data.capabilities = ChannelConnectionRepository._parseObject(data.capabilities_json);
    delete data.capabilities_json;
    data.metadata = ChannelConnectionRepository._parseObject(data.metadata_json);
    delete data.metadata_json;
    for (const key of ["created_at", "updated_at", "last_seen_at", "last_error_at"]) {
      const value = data[key];
      if (typeof value === "string" || value instanceof Date) {
        data[key] = coerceIso(value);
      }
    }
    return data;
  }

  private _getConnection(id: string): RawRow | undefined {
    return this.db.prepare(`SELECT * FROM ${CHANNEL_CONNECTIONS_TABLE} WHERE id = ?`).get(id);
  }

  async upsertConnection(opts: {
    owner_user_id: string;
    provider: string;
    external_account_id?: string | null;
    external_account_name?: string | null;
    workspace_id?: string | null;
    workspace_name?: string | null;
    bot_user_id?: string | null;
    scopes?: string[] | null;
    capabilities?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    status?: string;
  }): Promise<Record<string, unknown>> {
    const status = opts.status ?? "connected";
    const externalAccountId = ChannelConnectionRepository._normalizeOptionalIdentity(opts.external_account_id);
    const workspaceId = ChannelConnectionRepository._normalizeOptionalIdentity(opts.workspace_id);
    const scopesJson = JSON.stringify(opts.scopes ?? []);
    const capabilitiesJson = JSON.stringify(opts.capabilities ?? {});
    const metadataJson = JSON.stringify(opts.metadata ?? {});

    const revokeOtherActiveOwners = (): void => {
      if (status !== "connected") {
        return;
      }
      const rows = this.db
        .prepare(
          `SELECT id FROM ${CHANNEL_CONNECTIONS_TABLE}
           WHERE provider = ? AND external_account_id = ? AND workspace_id = ?
             AND owner_user_id != ? AND status != 'revoked'`,
        )
        .all(opts.provider, externalAccountId, workspaceId, opts.owner_user_id);
      const transferredIds = rows.map((r) => r.id as string);
      if (transferredIds.length === 0) {
        return;
      }
      const placeholders = transferredIds.map(() => "?").join(", ");
      this.db.prepare(`UPDATE ${CHANNEL_CONNECTIONS_TABLE} SET status = 'revoked' WHERE id IN (${placeholders})`).run(...transferredIds);
      this.db.prepare(`DELETE FROM ${CHANNEL_CREDENTIALS_TABLE} WHERE connection_id IN (${placeholders})`).run(...transferredIds);
    };

    let lastError: unknown = null;
    for (let attempt = 0; attempt < UPSERT_MAX_ATTEMPTS; attempt += 1) {
      try {
        this.db.exec("BEGIN");
        const existing = this.db
          .prepare(
            `SELECT * FROM ${CHANNEL_CONNECTIONS_TABLE}
             WHERE owner_user_id = ? AND provider = ? AND external_account_id = ? AND workspace_id = ?`,
          )
          .get(opts.owner_user_id, opts.provider, externalAccountId, workspaceId);
        // Revoke other owners' active rows *before* our connected row is
        // written so the partial unique index is satisfied at commit time.
        revokeOtherActiveOwners();
        const now = coerceIso(new Date());
        let id: string;
        if (existing === undefined) {
          id = ChannelConnectionRepository._newId();
          this.db
            .prepare(
              `INSERT INTO ${CHANNEL_CONNECTIONS_TABLE}
                 (id, owner_user_id, provider, status, external_account_id, external_account_name,
                  workspace_id, workspace_name, bot_user_id, scopes_json, capabilities_json,
                  metadata_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              id,
              opts.owner_user_id,
              opts.provider,
              status,
              externalAccountId,
              opts.external_account_name ?? null,
              workspaceId,
              opts.workspace_name ?? null,
              opts.bot_user_id ?? null,
              scopesJson,
              capabilitiesJson,
              metadataJson,
              now,
              now,
            );
        } else {
          id = existing.id as string;
          this.db
            .prepare(
              `UPDATE ${CHANNEL_CONNECTIONS_TABLE} SET
                 status = ?, external_account_name = ?, workspace_name = ?, bot_user_id = ?,
                 scopes_json = ?, capabilities_json = ?, metadata_json = ?, updated_at = ?
               WHERE id = ?`,
            )
            .run(
              status,
              opts.external_account_name ?? null,
              opts.workspace_name ?? null,
              opts.bot_user_id ?? null,
              scopesJson,
              capabilitiesJson,
              metadataJson,
              now,
              id,
            );
        }
        this.db.exec("COMMIT");
        return ChannelConnectionRepository._connectionToDict(this._getConnection(id) as RawRow);
      } catch (exc) {
        lastError = exc;
        try {
          this.db.exec("ROLLBACK");
        } catch {
          /* no active transaction */
        }
      }
    }
    throw lastError;
  }

  async listConnections(ownerUserId: string): Promise<Array<Record<string, unknown>>> {
    const rows = this.db
      .prepare(
        `SELECT * FROM ${CHANNEL_CONNECTIONS_TABLE} WHERE owner_user_id = ? ORDER BY updated_at DESC, id DESC`,
      )
      .all(ownerUserId);
    return rows.map((r) => ChannelConnectionRepository._connectionToDict(r));
  }

  async disconnectConnection(opts: { connection_id: string; owner_user_id: string }): Promise<boolean> {
    const row = this._getConnection(opts.connection_id);
    if (row === undefined || row.owner_user_id !== opts.owner_user_id) {
      return false;
    }
    this.db.prepare(`UPDATE ${CHANNEL_CONNECTIONS_TABLE} SET status = 'revoked' WHERE id = ?`).run(opts.connection_id);
    this.db.prepare(`DELETE FROM ${CHANNEL_CREDENTIALS_TABLE} WHERE connection_id = ?`).run(opts.connection_id);
    return true;
  }

  /** Revoke all active user connections for an instance-wide provider removal. */
  async disconnectProviderConnections(opts: { provider: string }): Promise<number> {
    const rows = this.db
      .prepare(`SELECT id FROM ${CHANNEL_CONNECTIONS_TABLE} WHERE provider = ? AND status != 'revoked'`)
      .all(opts.provider);
    const connectionIds = rows.map((r) => r.id as string);
    if (connectionIds.length === 0) {
      return 0;
    }
    const placeholders = connectionIds.map(() => "?").join(", ");
    this.db.prepare(`UPDATE ${CHANNEL_CONNECTIONS_TABLE} SET status = 'revoked' WHERE id IN (${placeholders})`).run(...connectionIds);
    this.db.prepare(`DELETE FROM ${CHANNEL_CREDENTIALS_TABLE} WHERE connection_id IN (${placeholders})`).run(...connectionIds);
    return connectionIds.length;
  }

  async storeCredentials(
    connectionId: string,
    opts: {
      access_token: string | null;
      refresh_token?: string | null;
      token_type?: string | null;
      expires_at?: Date | string | null;
      refresh_expires_at?: Date | string | null;
      extra?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    if (this._cipher === null) {
      throw new Error("channel connection encryption key is required");
    }
    const existing = this.db.prepare(`SELECT * FROM ${CHANNEL_CREDENTIALS_TABLE} WHERE connection_id = ?`).get(connectionId);
    const encAccess = this._cipher.encryptText(opts.access_token);
    const encRefresh = this._cipher.encryptText(opts.refresh_token ?? null);
    const encExtra = this._cipher.encryptText(JSON.stringify(opts.extra ?? {}));
    const expiresAt = ChannelConnectionRepository._coerceDatetime(opts.expires_at);
    const refreshExpiresAt = ChannelConnectionRepository._coerceDatetime(opts.refresh_expires_at);
    const now = coerceIso(new Date());
    if (existing === undefined) {
      this.db
        .prepare(
          `INSERT INTO ${CHANNEL_CREDENTIALS_TABLE}
             (connection_id, encrypted_access_token, encrypted_refresh_token, token_type,
              expires_at, refresh_expires_at, encrypted_extra_json, version, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(connectionId, encAccess, encRefresh, opts.token_type ?? null, expiresAt, refreshExpiresAt, encExtra, 1, now);
    } else {
      const prevVersion = typeof existing.version === "bigint" ? Number(existing.version) : ((existing.version as number) || 0);
      this.db
        .prepare(
          `UPDATE ${CHANNEL_CREDENTIALS_TABLE} SET
             encrypted_access_token = ?, encrypted_refresh_token = ?, token_type = ?,
             expires_at = ?, refresh_expires_at = ?, encrypted_extra_json = ?, version = ?, updated_at = ?
           WHERE connection_id = ?`,
        )
        .run(encAccess, encRefresh, opts.token_type ?? null, expiresAt, refreshExpiresAt, encExtra, prevVersion + 1, now, connectionId);
    }
  }

  async getCredentials(connectionId: string): Promise<Record<string, unknown> | null> {
    if (this._cipher === null) {
      return null;
    }
    const row = this.db.prepare(`SELECT * FROM ${CHANNEL_CREDENTIALS_TABLE} WHERE connection_id = ?`).get(connectionId);
    if (row === undefined) {
      return null;
    }
    try {
      const extraRaw = this._cipher.decryptText(row.encrypted_extra_json as string | null);
      return {
        connection_id: row.connection_id,
        access_token: this._cipher.decryptText(row.encrypted_access_token as string | null),
        refresh_token: this._cipher.decryptText(row.encrypted_refresh_token as string | null),
        token_type: row.token_type,
        expires_at: ChannelConnectionRepository._coerceDatetime(row.expires_at),
        refresh_expires_at: ChannelConnectionRepository._coerceDatetime(row.refresh_expires_at),
        extra: extraRaw ? (JSON.parse(extraRaw) as Record<string, unknown>) : {},
      };
    } catch {
      console.warn("Unable to decrypt channel connection credentials; treating credentials as unavailable");
      return null;
    }
  }

  static hashState(state: string): string {
    return createHash("sha256").update(state, "utf-8").digest("hex");
  }

  async createOauthState(opts: {
    owner_user_id: string;
    provider: string;
    state: string;
    expires_at: Date | string;
    code_verifier?: string | null;
    nonce_hash?: string | null;
    redirect_after?: string | null;
    requested_scopes?: string[] | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO ${CHANNEL_OAUTH_STATES_TABLE}
           (state_hash, owner_user_id, provider, code_verifier_encrypted, nonce_hash, redirect_after,
            requested_scopes_json, metadata_json, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ChannelConnectionRepository.hashState(opts.state),
        opts.owner_user_id,
        opts.provider,
        this._encryptOptionalSecret(opts.code_verifier),
        opts.nonce_hash ?? null,
        opts.redirect_after ?? null,
        JSON.stringify(opts.requested_scopes ?? []),
        JSON.stringify(opts.metadata ?? {}),
        ChannelConnectionRepository._coerceDatetime(opts.expires_at),
        coerceIso(new Date()),
      );
  }

  /**
   * Atomically enforce the per-(owner, provider) pending cap, then insert.
   *
   * Returns ``true`` when the row was inserted, ``false`` when the cap is
   * already reached.
   */
  async createOauthStateWithinCap(opts: {
    owner_user_id: string;
    provider: string;
    state: string;
    expires_at: Date | string;
    max_pending: number;
    now?: Date | string | null;
    code_verifier?: string | null;
    nonce_hash?: string | null;
    redirect_after?: string | null;
    requested_scopes?: string[] | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<boolean> {
    const currentTime = ChannelConnectionRepository._coerceDatetime(opts.now ?? null) ?? coerceIso(new Date());
    this.db.exec("BEGIN");
    try {
      this._serializeOauthOwnerScope(opts.owner_user_id, opts.provider);
      // Prune only this owner/provider's expired codes (the ones affecting this
      // cap). Issuing this write first also takes the SQLite write lock.
      this.db
        .prepare(
          `DELETE FROM ${CHANNEL_OAUTH_STATES_TABLE}
           WHERE owner_user_id = ? AND provider = ? AND expires_at < ?`,
        )
        .run(opts.owner_user_id, opts.provider, currentTime);
      const pending = this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM ${CHANNEL_OAUTH_STATES_TABLE}
           WHERE owner_user_id = ? AND provider = ? AND consumed_at IS NULL AND expires_at >= ?`,
        )
        .get(opts.owner_user_id, opts.provider, currentTime) as RawRow;
      const pendingCount = typeof pending.n === "bigint" ? Number(pending.n) : (pending.n as number);
      if (pendingCount >= opts.max_pending) {
        this.db.exec("ROLLBACK");
        return false;
      }
      this.db
        .prepare(
          `INSERT INTO ${CHANNEL_OAUTH_STATES_TABLE}
             (state_hash, owner_user_id, provider, code_verifier_encrypted, nonce_hash, redirect_after,
              requested_scopes_json, metadata_json, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ChannelConnectionRepository.hashState(opts.state),
          opts.owner_user_id,
          opts.provider,
          this._encryptOptionalSecret(opts.code_verifier),
          opts.nonce_hash ?? null,
          opts.redirect_after ?? null,
          JSON.stringify(opts.requested_scopes ?? []),
          JSON.stringify(opts.metadata ?? {}),
          ChannelConnectionRepository._coerceDatetime(opts.expires_at),
          coerceIso(new Date()),
        );
      this.db.exec("COMMIT");
      return true;
    } catch (exc) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* no active transaction */
      }
      throw exc;
    }
  }

  /**
   * Serialize concurrent pending-cap transactions for one (owner, provider).
   *
   * On PostgreSQL this takes a transaction-scoped advisory lock. Under
   * ``node:sqlite`` the backend is always SQLite, where the leading DELETE
   * already holds the database write lock, so this is a no-op.
   */
  private _serializeOauthOwnerScope(ownerUserId: string, provider: string): void {
    const dialect: string = "sqlite"; // node:sqlite is always sqlite
    if (dialect === "postgresql") {
      // Unreachable under node:sqlite; kept for parity with the Python source.
      void ChannelConnectionRepository._oauthScopeLockKey(ownerUserId, provider);
    }
  }

  private static _oauthScopeLockKey(ownerUserId: string, provider: string): bigint {
    const digest = createHash("sha256").update(`${ownerUserId}\x00${provider}`, "utf-8").digest();
    // 63-bit non-negative key for pg_advisory_xact_lock(bigint).
    return digest.readBigUInt64BE(0) & 0x7fffffffffffffffn;
  }

  async deleteExpiredOauthStates(opts: { now?: Date | string | null } = {}): Promise<number> {
    const currentTime = ChannelConnectionRepository._coerceDatetime(opts.now ?? null) ?? coerceIso(new Date());
    const result = this.db.prepare(`DELETE FROM ${CHANNEL_OAUTH_STATES_TABLE} WHERE expires_at < ?`).run(currentTime);
    return typeof result.changes === "bigint" ? Number(result.changes) : (result.changes as number) || 0;
  }

  async countOauthStates(opts: {
    owner_user_id: string;
    provider: string;
    active_only?: boolean;
    now?: Date | string | null;
  }): Promise<number> {
    const currentTime = ChannelConnectionRepository._coerceDatetime(opts.now ?? null) ?? coerceIso(new Date());
    const conditions = ["owner_user_id = ?", "provider = ?"];
    const params: SQLInputValue[] = [opts.owner_user_id, opts.provider];
    if (opts.active_only) {
      conditions.push("consumed_at IS NULL", "expires_at >= ?");
      params.push(currentTime);
    }
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM ${CHANNEL_OAUTH_STATES_TABLE} WHERE ${conditions.join(" AND ")}`)
      .get(...params) as RawRow;
    return typeof row.n === "bigint" ? Number(row.n) : (row.n as number);
  }

  async consumeOauthState(opts: {
    provider: string;
    state: string;
    now?: Date | string | null;
  }): Promise<Record<string, unknown> | null> {
    const currentTime = ChannelConnectionRepository._coerceDatetime(opts.now ?? null) ?? coerceIso(new Date());
    const stateHash = ChannelConnectionRepository.hashState(opts.state);
    this.db.prepare(`DELETE FROM ${CHANNEL_OAUTH_STATES_TABLE} WHERE expires_at < ?`).run(currentTime);
    const row = this.db.prepare(`SELECT * FROM ${CHANNEL_OAUTH_STATES_TABLE} WHERE state_hash = ?`).get(stateHash);
    if (row === undefined || row.provider !== opts.provider || row.consumed_at !== null) {
      return null;
    }
    const expiresAt = ChannelConnectionRepository._coerceDatetime(row.expires_at);
    if (expiresAt !== null && expiresAt < currentTime) {
      return null;
    }
    // Conditional UPDATE so two concurrent workers cannot both consume the same
    // binding code: only the writer that flips consumed_at from NULL wins.
    const result = this.db
      .prepare(`UPDATE ${CHANNEL_OAUTH_STATES_TABLE} SET consumed_at = ? WHERE state_hash = ? AND consumed_at IS NULL`)
      .run(currentTime, stateHash);
    const changes = typeof result.changes === "bigint" ? Number(result.changes) : (result.changes as number);
    if (changes !== 1) {
      return null;
    }
    return {
      owner_user_id: row.owner_user_id,
      provider: row.provider,
      requested_scopes: ChannelConnectionRepository._parseArray(row.requested_scopes_json),
      metadata: ChannelConnectionRepository._parseObject(row.metadata_json),
      redirect_after: row.redirect_after,
    };
  }

  async findConnectionByExternalIdentity(opts: {
    provider: string;
    external_account_id: string;
    workspace_id?: string | null;
  }): Promise<Record<string, unknown> | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM ${CHANNEL_CONNECTIONS_TABLE}
         WHERE provider = ? AND external_account_id = ? AND workspace_id = ? AND status = 'connected'
         ORDER BY updated_at DESC, id DESC LIMIT 1`,
      )
      .get(
        opts.provider,
        ChannelConnectionRepository._normalizeOptionalIdentity(opts.external_account_id),
        ChannelConnectionRepository._normalizeOptionalIdentity(opts.workspace_id),
      );
    return row !== undefined ? ChannelConnectionRepository._connectionToDict(row) : null;
  }

  async setThreadId(opts: {
    connection_id: string;
    owner_user_id: string;
    provider: string;
    external_conversation_id: string;
    thread_id: string;
    external_topic_id?: string | null;
  }): Promise<void> {
    const topicId = opts.external_topic_id || "";
    const existing = this.db
      .prepare(
        `SELECT * FROM ${CHANNEL_CONVERSATIONS_TABLE}
         WHERE connection_id = ? AND external_conversation_id = ? AND external_topic_id = ?`,
      )
      .get(opts.connection_id, opts.external_conversation_id, topicId);
    const now = coerceIso(new Date());
    if (existing === undefined) {
      this.db
        .prepare(
          `INSERT INTO ${CHANNEL_CONVERSATIONS_TABLE}
             (id, connection_id, owner_user_id, provider, external_conversation_id, external_topic_id,
              thread_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          ChannelConnectionRepository._newId(),
          opts.connection_id,
          opts.owner_user_id,
          opts.provider,
          opts.external_conversation_id,
          topicId,
          opts.thread_id,
          now,
          now,
        );
    } else {
      this.db
        .prepare(
          `UPDATE ${CHANNEL_CONVERSATIONS_TABLE} SET thread_id = ?, owner_user_id = ?, provider = ?, updated_at = ? WHERE id = ?`,
        )
        .run(opts.thread_id, opts.owner_user_id, opts.provider, now, existing.id as string);
    }
  }

  async getThreadId(
    connectionId: string,
    externalConversationId: string,
    externalTopicId: string | null = null,
  ): Promise<string | null> {
    const row = this.db
      .prepare(
        `SELECT thread_id FROM ${CHANNEL_CONVERSATIONS_TABLE}
         WHERE connection_id = ? AND external_conversation_id = ? AND external_topic_id = ?`,
      )
      .get(connectionId, externalConversationId, externalTopicId || "");
    if (row === undefined) {
      return null;
    }
    return (row.thread_id as string | null) ?? null;
  }
}
