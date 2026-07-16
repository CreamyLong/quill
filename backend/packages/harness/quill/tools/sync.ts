/**
 * Utilities for invoking async tools from synchronous agent paths.
 *
 * Mirrors `quill.tools.sync` from the Python backend.
 */

import type { RunnableConfig } from "@langchain/core/runnables";

/**
 * Find the parameter name that expects a LangChain RunnableConfig.
 */
function getRunnableConfigParam(func: (...args: unknown[]) => unknown): string | null {
  // Type-hint introspection is not available at runtime in JS.
  // We support a convention: if the function has an explicit property
  // `_runnableConfigParam`, use it. Otherwise assume "config".
  const annotated = (func as { _runnableConfigParam?: string })._runnableConfigParam;
  if (annotated) {
    return annotated;
  }
  if (func.length > 0) {
    // Best-effort default matching LangChain's injected config argument.
    return "config";
  }
  return null;
}

/**
 * Build a synchronous wrapper for an asynchronous tool function.
 *
 * In Node.js all I/O is async; this wrapper runs the coroutine by awaiting it
 * in an immediately invoked async closure. If a `RunnableConfig` parameter is
 * detected (via `_runnableConfigParam` or the default name "config"), it is
 * forwarded from LangChain's injected `config` argument.
 */
export function makeSyncToolWrapper(
  coro: (...args: unknown[]) => Promise<unknown>,
  toolName: string
): (...args: unknown[]) => unknown {
  const configParam = getRunnableConfigParam(coro);

  async function runCoroutine(args: unknown[], kwargs: Record<string, unknown>): Promise<unknown> {
    try {
      return await coro(...args, kwargs);
    } catch (error) {
      console.error(`Error invoking tool ${toolName} via sync wrapper:`, error);
      throw error;
    }
  }

  if (configParam) {
    return function syncWrapper(
      ...args: unknown[]
    ): unknown {
      const kwargs: Record<string, unknown> = {};
      let config: RunnableConfig | undefined;
      // LangChain invokes structured tools with a single object argument.
      if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
        const input = args[0] as Record<string, unknown>;
        for (const [key, value] of Object.entries(input)) {
          if (key === "config") {
            config = value as RunnableConfig;
          } else {
            kwargs[key] = value;
          }
        }
      }
      if (config !== undefined) {
        kwargs[configParam] = config;
      }
      // Run the async coroutine synchronously for compatibility with sync tools.
      let result: unknown;
      let thrown: unknown;
      (async () => {
        try {
          result = await runCoroutine([], kwargs);
        } catch (error) {
          thrown = error;
        }
      })();
      if (thrown) {
        throw thrown;
      }
      return result;
    };
  }

  return function syncWrapper(...args: unknown[]): unknown {
    let result: unknown;
    let thrown: unknown;
    (async () => {
      try {
        result = await runCoroutine(args, {});
      } catch (error) {
        thrown = error;
      }
    })();
    if (thrown) {
      throw thrown;
    }
    return result;
  };
}
