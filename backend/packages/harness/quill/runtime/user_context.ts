/**
 * Request-scoped user context for user-based authorization.
 *
 * This module holds the current authenticated user (set by the gateway's auth
 * middleware after a successful authentication). Repository methods read the
 * current user via a sentinel default parameter, letting routers stay free of
 * `user_id` boilerplate.
 *
 * Three-state semantics for the repository `user_id` parameter (the consumer
 * side of this module lives in `quill.persistence.*`):
 *
 * - `AUTO` (module sentinel, default): read from the current user; throw a
 *   `RuntimeError`-equivalent if unset.
 * - Explicit `string`: use the provided value, overriding the current user.
 * - Explicit `null`: no WHERE clause — used only by migration scripts and admin
 *   CLIs that intentionally bypass isolation.
 *
 * Dependency direction
 * --------------------
 * `persistence` (lower layer) reads from this module; `gateway.auth` (higher
 * layer) writes to it. `CurrentUser` is defined here as a structural type so
 * that `persistence` never needs to import the concrete `User` class. Any
 * object with an `.id: string` attribute structurally satisfies it.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Structural type for the current authenticated user.
 *
 * Any object with an `.id: string` attribute satisfies this type. Concrete
 * implementations live in `app.gateway.auth.models.User`.
 */
export interface CurrentUser {
  id: string;
}

/** Reset token returned by {@link setCurrentUser}. */
export interface Token {
  previous: CurrentUser | null;
}

const asyncLocalStorage = new AsyncLocalStorage<CurrentUser | null>();

// Synchronous fallback for code paths that call setCurrentUser outside an
// AsyncLocalStorage run (tests, CLI tools, migration scripts).
let _currentUser: CurrentUser | null = null;

/**
 * Set the current user.
 *
 * Returns a reset token that should be passed to {@link resetCurrentUser} in a
 * `finally` block to restore the previous context.
 */
export function setCurrentUser(user: CurrentUser): Token {
  const token: Token = { previous: _currentUser };
  _currentUser = user;
  return token;
}

/** Restore the context to the state captured by `token`. */
export function resetCurrentUser(token: Token): void {
  _currentUser = token.previous;
}

/**
 * Run `fn` with `user` bound as the current user for the duration of the call.
 *
 * This uses Node's `AsyncLocalStorage`, so the user context survives async
 * boundaries (HTTP handlers, graph streams, awaited tool calls). Falls back to
 * the module-global current user when called outside `runWithUser`.
 */
export function runWithUser<T>(user: CurrentUser | null, fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(asyncLocalStorage.run(user, fn));
}

/**
 * Return the current user, or `null` if unset.
 *
 * Safe to call in any context. Used by code paths that can proceed without a
 * user (e.g. migration scripts, public endpoints).
 */
export function getCurrentUser(): CurrentUser | null {
  return asyncLocalStorage.getStore() ?? _currentUser;
}

/**
 * Return the current user, or throw.
 *
 * Used by repository code that must not be called outside a request-authenticated
 * context. The error message is phrased so that a caller debugging a stack trace
 * can locate the offending code path.
 */
export function requireCurrentUser(): CurrentUser {
  const user = getCurrentUser();
  if (user === null) {
    throw new Error("repository accessed without user context");
  }
  return user;
}

// ---------------------------------------------------------------------------
// Effective user_id helpers (filesystem isolation)
// ---------------------------------------------------------------------------

export const DEFAULT_USER_ID = "default";

/**
 * Return the current user's id as a string, or DEFAULT_USER_ID if unset.
 *
 * Unlike {@link requireCurrentUser} this never throws — it is designed for
 * filesystem-path resolution where a valid user bucket is always needed.
 */
export function getEffectiveUserId(): string {
  const user = getCurrentUser();
  if (user === null) {
    return DEFAULT_USER_ID;
  }
  return String(user.id);
}

/**
 * Single source of truth for a tool/middleware's effective user_id.
 *
 * Resolution order (most authoritative first):
 *   1. `runtime.context["user_id"]` — set by `inject_authenticated_user_context`
 *      in the gateway from the auth-validated `request.state.user`. This is the
 *      only source that survives boundaries where the current user may have been
 *      lost (background tasks scheduled outside the request task, worker pools,
 *      future cross-process drivers).
 *   2. The current user — set by the auth middleware at request entry.
 *   3. `DEFAULT_USER_ID` — last-resort fallback so unauthenticated
 *      CLI / migration / test paths keep working without raising.
 *
 * Tools that persist user-scoped state (custom agents, memory, uploads) MUST
 * call this instead of {@link getEffectiveUserId} directly so they benefit from
 * the runtime.context channel that `setupAgent` already relies on.
 */
export function resolveRuntimeUserId(runtime: unknown): string {
  const context = (runtime as { context?: unknown } | null | undefined)?.context;
  if (context !== null && typeof context === "object" && !Array.isArray(context)) {
    const ctxUserId = (context as Record<string, unknown>)["user_id"];
    if (ctxUserId) {
      return String(ctxUserId);
    }
  }
  return getEffectiveUserId();
}

// ---------------------------------------------------------------------------
// Sentinel-based user_id resolution
// ---------------------------------------------------------------------------
//
// Repository methods accept a `user_id` argument that defaults to `AUTO`. The
// three possible values drive distinct behaviours; see the docstring on
// `resolveUserId`.

/** Singleton marker meaning 'resolve user_id from the current user'. */
export class AutoSentinel {
  private static _instance: AutoSentinel | null = null;

  private constructor() {}

  static get instance(): AutoSentinel {
    if (AutoSentinel._instance === null) {
      AutoSentinel._instance = new AutoSentinel();
    }
    return AutoSentinel._instance;
  }

  toString(): string {
    return "<AUTO>";
  }
}

export const AUTO: AutoSentinel = AutoSentinel.instance;

/**
 * Resolve the user_id parameter passed to a repository method.
 *
 * Three-state semantics:
 *
 * - {@link AUTO} (default): read from the current user; throw if no user is in
 *   context. This is the common case for request-scoped calls.
 * - Explicit `string`: use the provided id verbatim, overriding any current
 *   user. Useful for tests and admin-override flows.
 * - Explicit `null`: no filter — the repository should skip the user_id WHERE
 *   clause entirely. Reserved for migration scripts and CLI tools that
 *   intentionally bypass isolation.
 */
export function resolveUserId(
  value: string | null | AutoSentinel,
  { methodName = "repository method" }: { methodName?: string } = {}
): string | null {
  if (value instanceof AutoSentinel) {
    const user = getCurrentUser();
    if (user === null) {
      throw new Error(
        `${methodName} called with user_id=AUTO but no user context is set; pass an explicit user_id, set the current user via auth middleware, or opt out with user_id=null for migration/CLI paths.`
      );
    }
    // Coerce to string at the boundary, honouring the documented return type.
    return String(user.id);
  }
  return value;
}
