/**
 * User Pydantic models for authentication.
 */

export interface User {
  /** Primary key */
  id: string;
  /** Unique email address */
  email: string;
  /** bcrypt hash, nullable for OAuth users */
  passwordHash: string | null;
  systemRole: "admin" | "user";
  createdAt: Date;

  /** OAuth linkage (optional) */
  oauthProvider: string | null;
  oauthId: string | null;

  /** True when a reset account must complete setup */
  needsSetup: boolean;
  /** Incremented on password change to invalidate old JWTs */
  tokenVersion: number;
}

export interface UserResponse {
  id: string;
  email: string;
  systemRole: "admin" | "user";
  needsSetup: boolean;
  /** OAuth/SSO provider ID if the user logged in via SSO */
  oauthProvider: string | null;
}
