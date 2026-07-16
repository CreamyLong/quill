/**
 * ThreadDataMiddleware — compute (and optionally create) per-thread data
 * directories and inject their paths into state.
 *
 * Faithful port of Python `ThreadDataMiddleware`, adapted to the TS runtime.
 *
 * Deviations (noted in report):
 * - Python's `before_agent` hook receives a `runtime` and reads `thread_id`
 *   (and `run_id`) from `runtime.context` / `get_config()`. The TS middleware
 *   hooks receive only `state`, so `threadId`/`userId`/`runId` are supplied via
 *   constructor options. When `threadId` is omitted the middleware is a no-op
 *   (Python would raise; raising here would break every run without a runtime).
 * - There is no `before_agent` node in the TS factory; `beforeModel` is used as
 *   the closest analogue.
 * - `get_effective_user_id()` (quill.runtime.user_context) is not ported;
 *   pass `userId` explicitly if per-user isolation is needed.
 */

import { HumanMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition } from "../factory.js";
import type { ThreadDataState, ThreadState } from "../thread_state.js";
import { Paths, getPaths } from "../../config/paths.js";
import { runtimeHome } from "../../config/runtime_paths.js";
import { getWorkspaceOverrideResolver } from "../../sandbox/local/provider.js";

export interface ThreadDataMiddlewareOptions {
  /** Base directory for thread data. Defaults to Paths resolution. */
  baseDir?: string | null;
  /** If true (default), defer directory creation until needed. */
  lazyInit?: boolean;
  /** Thread ID (normally sourced from runtime context in Python). */
  threadId?: string | null;
  /** Optional user ID for per-user path isolation. */
  userId?: string | null;
  /** Optional run ID, stamped onto the last human message. */
  runId?: string | null;
}

function getThreadPaths(
  paths: Paths,
  threadId: string,
  userId: string | null
): ThreadDataState {
  return {
    workspace_path: paths.sandboxWorkDir(threadId, userId),
    uploads_path: paths.sandboxUploadsDir(threadId, userId),
    outputs_path: paths.sandboxOutputsDir(threadId, userId),
  };
}

/** Create per-thread data directories and inject their paths into state. */
export function threadDataMiddleware(
  options: ThreadDataMiddlewareOptions = {}
): MiddlewareDefinition {
  const paths = options.baseDir ? new Paths(options.baseDir) : getPaths();
  const lazyInit = options.lazyInit ?? true;
  const threadId = options.threadId ?? null;
  const userId = options.userId ?? null;
  const runId = options.runId ?? null;

  return {
    name: "ThreadDataMiddleware",
    beforeModel: (state: ThreadState) => {
      let data: ThreadDataState;
      if (threadId !== null) {
        if (lazyInit) {
          data = getThreadPaths(paths, threadId, userId);
        } else {
          paths.ensureThreadDirs(threadId, userId);
          data = getThreadPaths(paths, threadId, userId);
          console.debug(`Created thread data directories for thread ${threadId}`);
        }
        // If a workspace_directory override is registered for this thread,
        // reflect it in the injected thread_data so tooling sees the custom path.
        const override = getWorkspaceOverrideResolver()?.(threadId);
        if (override) {
          data = { ...data, workspace_path: override };
        }
      } else {
        // No runtime thread id available; fall back to a process-wide default
        // workspace so downstream middlewares (e.g. tool_output_budget) still
        // have an outputs directory.
        const home = runtimeHome();
        data = {
          workspace_path: home,
          uploads_path: `${home}/uploads`,
          outputs_path: `${home}/outputs`,
        };
      }

      const messages = (state.messages ?? []).slice();
      const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

      if (lastMessage && lastMessage instanceof HumanMessage && threadId !== null) {
        messages[messages.length - 1] = new HumanMessage({
          content: lastMessage.content,
          id: lastMessage.id,
          name: lastMessage.name || "user-input",
          additional_kwargs: {
            ...(lastMessage.additional_kwargs ?? {}),
            run_id: runId,
            timestamp: new Date().toISOString(),
          },
        });
      }

      return {
        thread_data: { ...data },
        messages,
      };
    },
  };
}
