/**
 * Table models for user-owned IM channel connections.
 *
 * Ports ``quill.persistence.channel_connections.model``. The four Python ORM
 * classes are represented here as row data shapes plus their ``CREATE TABLE``
 * DDL. The partial unique index that enforces the single-active-owner invariant
 * (``uq_channel_connection_active_identity``) is preserved.
 */

/** Row shape of the ``channel_connections`` table (JSON columns parsed). */
export interface ChannelConnectionRow {
  id: string;
  owner_user_id: string;
  provider: string;
  status: string;
  external_account_id: string;
  external_account_name: string | null;
  workspace_id: string;
  workspace_name: string | null;
  bot_user_id: string | null;
  scopes_json: unknown[];
  capabilities_json: Record<string, unknown>;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  last_error_at: string | null;
}

/** Row shape of the ``channel_credentials`` table. */
export interface ChannelCredentialRow {
  connection_id: string;
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  token_type: string | null;
  expires_at: string | null;
  refresh_expires_at: string | null;
  encrypted_extra_json: string | null;
  version: number;
  updated_at: string;
}

/** Row shape of the ``channel_oauth_states`` table (JSON columns parsed). */
export interface ChannelOAuthStateRow {
  state_hash: string;
  owner_user_id: string;
  provider: string;
  code_verifier_encrypted: string | null;
  nonce_hash: string | null;
  redirect_after: string | null;
  requested_scopes_json: unknown[];
  metadata_json: Record<string, unknown>;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

/** Row shape of the ``channel_conversations`` table. */
export interface ChannelConversationRow {
  id: string;
  connection_id: string;
  owner_user_id: string;
  provider: string;
  external_conversation_id: string;
  external_topic_id: string;
  thread_id: string;
  created_at: string;
  updated_at: string;
}

export const CHANNEL_CONNECTIONS_TABLE = "channel_connections";
export const CHANNEL_CREDENTIALS_TABLE = "channel_credentials";
export const CHANNEL_OAUTH_STATES_TABLE = "channel_oauth_states";
export const CHANNEL_CONVERSATIONS_TABLE = "channel_conversations";

export const CHANNEL_CONNECTIONS_DDL = `
CREATE TABLE IF NOT EXISTS channel_connections (
  id                    VARCHAR(64) PRIMARY KEY,
  owner_user_id         VARCHAR(64) NOT NULL,
  provider              VARCHAR(32) NOT NULL,
  status                VARCHAR(32) NOT NULL DEFAULT 'connected',
  external_account_id   VARCHAR(128) NOT NULL DEFAULT '',
  external_account_name VARCHAR(256),
  workspace_id          VARCHAR(128) NOT NULL DEFAULT '',
  workspace_name        VARCHAR(256),
  bot_user_id           VARCHAR(128),
  scopes_json           JSON DEFAULT '[]',
  capabilities_json     JSON DEFAULT '{}',
  metadata_json         JSON DEFAULT '{}',
  created_at            DATETIME NOT NULL,
  updated_at            DATETIME NOT NULL,
  last_seen_at          DATETIME,
  last_error_at         DATETIME,
  CONSTRAINT uq_channel_connection_owner_provider_identity
    UNIQUE (owner_user_id, provider, external_account_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS ix_channel_connections_owner_user_id ON channel_connections (owner_user_id);
CREATE INDEX IF NOT EXISTS ix_channel_connections_provider ON channel_connections (provider);
CREATE INDEX IF NOT EXISTS idx_channel_connections_event_lookup
  ON channel_connections (provider, workspace_id, bot_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_connection_active_identity
  ON channel_connections (provider, external_account_id, workspace_id)
  WHERE status != 'revoked';

CREATE TABLE IF NOT EXISTS channel_credentials (
  connection_id           VARCHAR(64) PRIMARY KEY
    REFERENCES channel_connections (id) ON DELETE CASCADE,
  encrypted_access_token  TEXT,
  encrypted_refresh_token TEXT,
  token_type              VARCHAR(32),
  expires_at              DATETIME,
  refresh_expires_at      DATETIME,
  encrypted_extra_json    TEXT,
  version                 INTEGER NOT NULL DEFAULT 1,
  updated_at              DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_oauth_states (
  state_hash              VARCHAR(128) PRIMARY KEY,
  owner_user_id           VARCHAR(64) NOT NULL,
  provider                VARCHAR(32) NOT NULL,
  code_verifier_encrypted TEXT,
  nonce_hash              VARCHAR(128),
  redirect_after          TEXT,
  requested_scopes_json   JSON DEFAULT '[]',
  metadata_json           JSON DEFAULT '{}',
  expires_at              DATETIME NOT NULL,
  consumed_at             DATETIME,
  created_at              DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_channel_oauth_states_owner_user_id ON channel_oauth_states (owner_user_id);
CREATE INDEX IF NOT EXISTS ix_channel_oauth_states_provider ON channel_oauth_states (provider);

CREATE TABLE IF NOT EXISTS channel_conversations (
  id                       VARCHAR(64) PRIMARY KEY,
  connection_id            VARCHAR(64) NOT NULL
    REFERENCES channel_connections (id) ON DELETE CASCADE,
  owner_user_id            VARCHAR(64) NOT NULL,
  provider                 VARCHAR(32) NOT NULL,
  external_conversation_id VARCHAR(128) NOT NULL,
  external_topic_id        VARCHAR(128) NOT NULL DEFAULT '',
  thread_id                VARCHAR(64) NOT NULL,
  created_at               DATETIME NOT NULL,
  updated_at               DATETIME NOT NULL,
  CONSTRAINT uq_channel_conversation_connection_external
    UNIQUE (connection_id, external_conversation_id, external_topic_id)
);
CREATE INDEX IF NOT EXISTS ix_channel_conversations_connection_id ON channel_conversations (connection_id);
CREATE INDEX IF NOT EXISTS ix_channel_conversations_owner_user_id ON channel_conversations (owner_user_id);
CREATE INDEX IF NOT EXISTS ix_channel_conversations_provider ON channel_conversations (provider);
CREATE INDEX IF NOT EXISTS ix_channel_conversations_thread_id ON channel_conversations (thread_id);
`;
