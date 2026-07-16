/**
 * OIDC / SSO authentication configuration models.
 *
 * Mirrors `quill.config.auth_config` from the Python backend.
 */

export type TokenEndpointAuthMethod = "client_secret_post" | "client_secret_basic" | "none";

export interface OIDCProviderConfig {
  /** Human-readable name shown on the login button */
  displayName: string;
  /** OIDC issuer URL */
  issuer: string;
  /** OAuth2 client ID assigned by the provider */
  clientId: string;
  /** OAuth2 client secret ($ENV_VAR references supported) */
  clientSecret: string | null;
  /** Callback URL the provider will redirect to after auth */
  redirectUri: string | null;
  /** OIDC scopes to request (must include openid) */
  scopes: string[];
  /** How the client authenticates at the token endpoint */
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
  /** Automatically create a Quill user on first SSO login */
  autoCreateUsers: boolean;
  /** Reject authentication if the provider does not report the email as verified */
  requireVerifiedEmail: boolean;
  /** If non-empty, only allow users whose email domain is in this list */
  allowedEmailDomains: string[];
  /** Users with these email addresses are automatically granted the admin role */
  adminEmails: string[];
  /** Enable PKCE (S256) for the authorization code flow */
  pkceEnabled: boolean;
  /** Include and validate the nonce claim in ID tokens */
  nonceEnabled: boolean;
  /** Non-standard authorization endpoint override */
  authorizationEndpoint: string | null;
  /** Non-standard token endpoint override */
  tokenEndpoint: string | null;
  /** Non-standard userinfo endpoint override */
  userinfoEndpoint: string | null;
  /** Non-standard JWKS URI override */
  jwksUri: string | null;
}

export interface OIDCAuthConfig {
  /** Enable OIDC SSO authentication */
  enabled: boolean;
  /** Base URL of the frontend (used for callback redirects when behind a reverse proxy) */
  frontendBaseUrl: string | null;
  /** Map of provider IDs to their configuration */
  providers: Record<string, OIDCProviderConfig>;
}

export interface AuthAppConfig {
  /** OIDC SSO authentication settings */
  oidc: OIDCAuthConfig;
}

export function buildOIDCProviderConfig(input: Partial<OIDCProviderConfig> = {}): OIDCProviderConfig {
  return {
    displayName: input.displayName ?? "",
    issuer: input.issuer ?? "",
    clientId: input.clientId ?? "",
    clientSecret: input.clientSecret ?? null,
    redirectUri: input.redirectUri ?? null,
    scopes: input.scopes ?? ["openid", "email", "profile"],
    tokenEndpointAuthMethod: input.tokenEndpointAuthMethod ?? "client_secret_post",
    autoCreateUsers: input.autoCreateUsers ?? true,
    requireVerifiedEmail: input.requireVerifiedEmail ?? true,
    allowedEmailDomains: input.allowedEmailDomains ?? [],
    adminEmails: input.adminEmails ?? [],
    pkceEnabled: input.pkceEnabled ?? true,
    nonceEnabled: input.nonceEnabled ?? true,
    authorizationEndpoint: input.authorizationEndpoint ?? null,
    tokenEndpoint: input.tokenEndpoint ?? null,
    userinfoEndpoint: input.userinfoEndpoint ?? null,
    jwksUri: input.jwksUri ?? null,
  };
}

export function buildOIDCAuthConfig(input: Partial<OIDCAuthConfig> = {}): OIDCAuthConfig {
  return {
    enabled: input.enabled ?? false,
    frontendBaseUrl: input.frontendBaseUrl ?? null,
    providers: input.providers ?? {},
  };
}

export function buildAuthAppConfig(input: Partial<AuthAppConfig> = {}): AuthAppConfig {
  return {
    oidc: input.oidc ? buildOIDCAuthConfig(input.oidc) : buildOIDCAuthConfig(),
  };
}
