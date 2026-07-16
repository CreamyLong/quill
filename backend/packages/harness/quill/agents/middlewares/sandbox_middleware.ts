/**
 * SandboxMiddleware — AIO container lifecycle management.
 *
 * Mirrors the Python `SandboxMiddleware` lifecycle behavior: acquire a sandbox
 * container per thread on the first model call (`beforeModel`) and release it
 * when the agent step completes (`afterAgent`). The provider's warm pool handles
 * reuse, so a released container may be re-acquired by a later turn without
 * being destroyed.
 *
 * When no provider is injected (the default local-filesystem backend), this
 * middleware is a no-op: the local backend needs no container lifecycle.
 *
 * The provider is injected at startup via `setSandboxMiddlewareProvider` from
 * `gateway_server.mjs` (only when the AIO container backend is selected).
 */

import type { RunnableConfig } from "@langchain/core/runnables";

import type { MiddlewareDefinition } from "../factory.js";
import type { ThreadState } from "../thread_state.js";

/**
 * Minimal provider interface for sandbox lifecycle management.
 *
 * This is a structural subset of `AioSandboxProvider` — only the two methods
 * the middleware actually calls. Keeping it structural avoids importing the
 * full provider class (and its Node `child_process` / HTTP dependencies) into
 * the middleware layer.
 */
export interface SandboxLifecycleProvider {
  acquire(
    threadId?: string | null,
    opts?: { userId?: string | null },
  ): Promise<string>;
  release(sandboxId: string): void;
}

/** Options for {@link sandboxMiddleware}. */
export interface SandboxMiddlewareOptions {
  /** Optional user id passed directly to the lifecycle provider. */
  userId?: string | null;
  /** Optional callback that resolves the current user id at runtime. */
  getUserId?: () => string | null;
}

// The currently registered lifecycle provider. `null` means no container
// lifecycle management (local backend) — the middleware becomes a no-op.
let lifecycleProvider: SandboxLifecycleProvider | null = null;

/**
 * Inject the AIO sandbox provider for per-thread container lifecycle
 * management. Called once at gateway startup when the AIO backend is selected.
 */
export function setSandboxMiddlewareProvider(
  provider: SandboxLifecycleProvider | null,
): void {
  lifecycleProvider = provider;
}

/** Internal scratchpad key under `state.internal` for the acquired sandbox id. */
const SANDBOX_ID_KEY = "sandbox_middleware_sandbox_id";

function readThreadId(config?: RunnableConfig): string | null {
  const configurable = config?.configurable as
    | { thread_id?: unknown }
    | undefined;
  if (configurable && typeof configurable.thread_id === "string") {
    return configurable.thread_id;
  }
  return null;
}

/** Read the run's configurable context to resolve a fallback user id. */
function readUserIdFromConfig(config?: RunnableConfig): string | null {
  const configurable = config?.configurable as { user_id?: unknown } | undefined;
  if (configurable && typeof configurable.user_id === "string") {
    return configurable.user_id;
  }
  return null;
}

/**
 * Sandbox lifecycle middleware.
 *
 * - `beforeModel`: if a provider is registered, acquire a sandbox for the
 *   current thread (reusing a warm-pool container when available). The
 *   returned sandbox id is stashed in `state.internal` so `afterAgent` can
 *   release it.
 * - `afterAgent`: release the acquired sandbox back to the warm pool.
 *
 * When no provider is set (local backend), both hooks are no-ops.
 */
export function sandboxMiddleware(options: SandboxMiddlewareOptions = {}): MiddlewareDefinition {
  const { userId: staticUserId, getUserId } = options;

  const resolveUserId = (config?: RunnableConfig): string | null => {
    return staticUserId ?? getUserId?.() ?? readUserIdFromConfig(config) ?? null;
  };

  return {
    name: "SandboxMiddleware",
    beforeModel: async (
      state: ThreadState,
      config?: RunnableConfig,
    ): Promise<Partial<ThreadState>> => {
      if (lifecycleProvider === null) return {};
      const threadId = readThreadId(config);
      const internal = (state.internal ?? {}) as Record<string, unknown>;
      // Skip if a sandbox was already acquired for this thread (e.g. a
      // previous beforeModel in the same run already acquired one).
      if (typeof internal[SANDBOX_ID_KEY] === "string") return {};
      try {
        const sandboxId = await lifecycleProvider.acquire(threadId, {
          userId: resolveUserId(config),
        });
        return {
          internal: { ...internal, [SANDBOX_ID_KEY]: sandboxId },
        };
      } catch (err) {
        // Acquire failure is non-fatal: the tools will surface the error
        // when they try to use the sandbox. Log and continue.
        console.warn(
          `[SandboxMiddleware] acquire failed for thread ${threadId ?? "(no-id)"}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return {};
    },
    afterAgent: (state: ThreadState): Partial<ThreadState> => {
      if (lifecycleProvider === null) return {};
      const internal = (state.internal ?? {}) as Record<string, unknown>;
      const sandboxId = internal[SANDBOX_ID_KEY];
      if (typeof sandboxId !== "string") return {};
      try {
        lifecycleProvider.release(sandboxId);
      } catch (err) {
        console.warn(
          `[SandboxMiddleware] release failed for sandbox ${sandboxId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // Clear the stashed id so the next run acquires a fresh sandbox.
      const nextInternal = { ...internal };
      delete nextInternal[SANDBOX_ID_KEY];
      return { internal: nextInternal };
    },
  };
}
