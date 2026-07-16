/**
 * Auth provider abstraction.
 */

export interface User {
  id: string;
  // Additional user fields are added by concrete implementations.
  [key: string]: unknown;
}

export interface AuthCredentials {
  [key: string]: unknown;
}

/**
 * Abstract base class for authentication providers.
 */
export abstract class AuthProvider {
  /**
   * Authenticate user with given credentials.
   * Returns User if authentication succeeds, null otherwise.
   */
  abstract authenticate(credentials: AuthCredentials): Promise<User | null>;

  /** Retrieve user by ID. */
  abstract getUser(userId: string): Promise<User | null>;
}
