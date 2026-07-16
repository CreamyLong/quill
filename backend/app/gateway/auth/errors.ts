/**
 * Typed error definitions for auth module.
 */

export enum AuthErrorCode {
  INVALID_CREDENTIALS = "invalid_credentials",
  TOKEN_EXPIRED = "token_expired",
  TOKEN_INVALID = "token_invalid",
  USER_NOT_FOUND = "user_not_found",
  EMAIL_ALREADY_EXISTS = "email_already_exists",
  PROVIDER_NOT_FOUND = "provider_not_found",
  NOT_AUTHENTICATED = "not_authenticated",
  SYSTEM_ALREADY_INITIALIZED = "system_already_initialized",
}

export enum TokenError {
  EXPIRED = "expired",
  INVALID_SIGNATURE = "invalid_signature",
  MALFORMED = "malformed",
}

export interface AuthErrorResponse {
  code: AuthErrorCode;
  message: string;
}

/** Map TokenError to AuthErrorCode — single source of truth. */
export function tokenErrorToCode(err: TokenError): AuthErrorCode {
  if (err === TokenError.EXPIRED) {
    return AuthErrorCode.TOKEN_EXPIRED;
  }
  return AuthErrorCode.TOKEN_INVALID;
}
