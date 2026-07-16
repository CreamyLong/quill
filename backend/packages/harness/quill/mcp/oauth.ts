/**
 * OAuth token management and OAuthClientProvider implementation for MCP servers.
 *
 * Port of the Python `quill.mcp.oauth` module. Implements a minimal but correct
 * subset of the MCP SDK's `OAuthClientProvider` interface
 * (`@modelcontextprotocol/sdk/client/auth.js`) sufficient for machine-to-machine
 * grants (`client_credentials`, `refresh_token`) that MCP servers actually use.
 *
 * The implementation intentionally leaves interactive flows (authorization code)
 * unsupported: returning `undefined` from `redirectUrl` signals that to the SDK,
 * which will surface a clear error if a server unexpectedly requires user redirect.
 */

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

import type { McpOAuthConfig } from "../config/extensions_config.js";
import type { ExtensionsConfig } from "../config/extensions_config.js";

/** Minimum fields we rely on from OAuthTokens. The SDK type is broader. */
interface StoredTokens {
  access_token: string;
  token_type: string;
  expires_at: number; // epoch ms — absolute expiry, not relative
  refresh_token?: string;
  scope?: string;
}

/**
 * Per-server OAuth token manager.
 *
 * Caches one token per server and refreshes automatically when the token is
 * within `refreshSkewSeconds` of expiry (matching the Python version's
 * `_is_expiring` + `_fetch_token` behavior).
 */
export class OAuthTokenManager {
  private readonly servers = new Map<string, McpOAuthConfig>();
  private readonly tokens = new Map<string, StoredTokens>();

  private constructor(oauthByServer: Map<string, McpOAuthConfig>) {
    for (const [name, cfg] of oauthByServer) {
      this.servers.set(name, cfg);
    }
  }

  /** Build a manager directly from a pre-parsed `(name → oauth)` map. */
  static fromMap(oauthByServer: Map<string, McpOAuthConfig>): OAuthTokenManager {
    return new OAuthTokenManager(oauthByServer);
  }

  /** Build a manager from the extensions config, keeping only enabled OAuth servers. */
  static fromExtensionsConfig(extensionsConfig: ExtensionsConfig): OAuthTokenManager {
    const oauthByServer = new Map<string, McpOAuthConfig>();
    for (const [name, server] of Object.entries(extensionsConfig.mcpServers)) {
      const oauth = server.oauth;
      if (oauth?.enabled && oauth.tokenUrl) {
        oauthByServer.set(name, oauth);
      }
    }
    return new OAuthTokenManager(oauthByServer);
  }

  get hasOAuthServers(): boolean {
    return this.servers.size > 0;
  }

  get serverNames(): string[] {
    return [...this.servers.keys()];
  }

  /** Returns `true` if this server has OAuth configured (by exact name). */
  hasServer(serverName: string): boolean {
    return this.servers.has(serverName);
  }

  /**
   * Returns an `"Authorization: <token_type> <access_token>"` header value for
   * the named server, fetching or refreshing the token if needed.
   */
  async getAuthorizationHeader(serverName: string): Promise<string | null> {
    const oauth = this.servers.get(serverName);
    if (!oauth) return null;

    const stored = this.tokens.get(serverName);
    if (stored && !isExpiring(stored, oauth.refreshSkewSeconds)) {
      return `${stored.token_type} ${stored.access_token}`;
    }

    const fetched = await this.fetchToken(oauth);
    // Carry over a previous refresh_token if the server omits a new one.
    const refreshToken = fetched.refresh_token ?? stored?.refresh_token;
    const toStore: StoredTokens = {
      access_token: fetched.access_token,
      token_type: fetched.token_type,
      expires_at: fetched.expires_at,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      ...(fetched.scope ? { scope: fetched.scope } : {}),
    };
    this.tokens.set(serverName, toStore);
    return `${toStore.token_type} ${toStore.access_token}`;
  }

  /**
   * Fetch a fresh token from the server's token endpoint.
   * Supports `client_credentials` and `refresh_token` grant types.
   */
  async fetchToken(oauth: McpOAuthConfig): Promise<StoredTokens> {
    const body = new URLSearchParams();
    body.set("grant_type", oauth.grantType);

    if (oauth.grantType === "client_credentials") {
      if (oauth.clientId) body.set("client_id", oauth.clientId);
      if (oauth.clientSecret) body.set("client_secret", oauth.clientSecret);
      if (oauth.scope) body.set("scope", oauth.scope);
      if (oauth.audience) body.set("audience", oauth.audience);
    } else if (oauth.grantType === "refresh_token") {
      if (!oauth.refreshToken) {
        throw new Error("refresh_token grant requires a refresh_token in the config");
      }
      body.set("refresh_token", oauth.refreshToken);
      if (oauth.clientId) body.set("client_id", oauth.clientId);
      if (oauth.clientSecret) body.set("client_secret", oauth.clientSecret);
    }

    for (const [k, v] of Object.entries(oauth.extraTokenParams)) {
      body.set(k, v);
    }

    const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
    if (oauth.clientId && oauth.clientSecret) {
      // Many servers accept HTTP Basic auth for client authentication.
      headers.set("Authorization", `Basic ${base64url(`${oauth.clientId}:${oauth.clientSecret}`)}`);
    }

    let res: Response;
    try {
      res = await fetch(oauth.tokenUrl, { method: "POST", headers, body });
    } catch (e) {
      throw new Error(`OAuth token request failed for ${oauth.tokenUrl}: ${e instanceof Error ? e.message : e}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OAuth token endpoint returned ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const accessToken = data[oauth.tokenField] as string | undefined;
    if (!accessToken) {
      throw new Error(`Token response missing "${oauth.tokenField}" field`);
    }

    const tokenType = (data[oauth.tokenTypeField] as string | undefined) ?? oauth.defaultTokenType;
    const expiresIn = data[oauth.expiresInField] as number | undefined;
    const expiresAt = Date.now() + (expiresIn ?? 3600) * 1000;

    return {
      access_token: accessToken,
      token_type: tokenType,
      expires_at: expiresAt,
      refresh_token: data.refresh_token as string | undefined,
      scope: data.scope as string | undefined,
    };
  }
}

/**
 * Build a minimal `OAuthClientProvider` for a single MCP server with OAuth config.
 *
 * The SDK uses this to obtain tokens and client metadata during tool calls.
 * We implement only the non-interactive subset (`client_credentials` /
 * `refresh_token`) and signal that by returning `undefined` from `redirectUrl`.
 */
export function buildMcpOAuthProvider(
  serverName: string,
  manager: OAuthTokenManager,
): OAuthClientProvider {
  // Captured token cache — the provider owns the in-memory copy so the SDK can
  // read (`tokens`) and write (`saveTokens`) without knowing about our manager.
  let captured: OAuthTokens | undefined;

  const provider: OAuthClientProvider = {
    redirectUrl: undefined,

    clientMetadata: {
      redirect_uris: [],
      token_endpoint_auth_method: "client_secret_post",
    } satisfies OAuthClientMetadata,

    async clientInformation() {
      // We rely on the manager's config, not dynamic registration.
      return undefined;
    },

    async tokens() {
      return captured;
    },

    async saveTokens(tokens: OAuthTokens) {
      captured = tokens;
      void serverName; // referenced by manager for scoped lookups
    },

    async redirectToAuthorization() {
      // Non-interactive grants (client_credentials / refresh_token) never
      // redirect. This is a no-op stub to satisfy the interface contract.
    },

    async saveCodeVerifier() {
      // PKCE code verifier — only needed for authorization_code grants, which
      // we don't support. No-op stub.
    },

    async codeVerifier() {
      // PKCE code verifier — only needed for authorization_code grants, which
      // we don't support. Return empty string as a safe default.
      return "";
    },
  };

  return provider;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns `true` if `stored` expires within `skewSeconds` from now. */
function isExpiring(stored: StoredTokens, skewSeconds: number): boolean {
  return stored.expires_at <= Date.now() + Math.max(skewSeconds, 0) * 1000;
}

/** Base64-encode a string in a UTF-8 safe way (works in Node & browser). */
function base64url(input: string): string {
  return Buffer.from(input, "utf-8").toString("base64");
}
