/**
 * Tracing callback factory for supported providers (LangSmith, Langfuse).
 *
 * Mirrors `quill.tracing.factory` from the Python backend.
 *
 * LangSmith uses `LangChainTracer` from `@langchain/core` (no extra dependency)
 * and authenticates via the standard LangSmith env vars. Langfuse uses the
 * optional `langfuse-langchain` package, resolved lazily — it throws only when
 * Langfuse tracing is actually enabled but the package is missing.
 */

import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";

import {
  getEnabledTracingProviders,
  getTracingConfig,
  validateEnabledTracingProviders,
  type LangSmithTracingConfig,
  type LangfuseTracingConfig,
} from "../config/tracing_config.js";

/**
 * Build a real LangSmith tracer callback (from @langchain/core, no extra dep).
 * The tracer reads its endpoint/api key from the standard LangSmith env vars
 * (LANGSMITH_API_KEY / LANGCHAIN_API_KEY, LANGSMITH_ENDPOINT). We surface the
 * configured project name so runs land in the right LangSmith project.
 */
function createLangsmithTracer(config: LangSmithTracingConfig): unknown {
  const projectName =
    (config as { project?: string; projectName?: string }).project ??
    (config as { projectName?: string }).projectName ??
    process.env.LANGSMITH_PROJECT ??
    process.env.LANGCHAIN_PROJECT;
  // LangSmith auth comes from env; make sure the configured key is exported.
  const apiKey = (config as { apiKey?: string }).apiKey;
  if (apiKey && !process.env.LANGSMITH_API_KEY && !process.env.LANGCHAIN_API_KEY) {
    process.env.LANGSMITH_API_KEY = apiKey;
  }
  return new LangChainTracer(projectName ? { projectName } : {});
}

/**
 * Build a Langfuse callback handler. The Langfuse JS SDK (`langfuse-langchain`)
 * is an optional dependency; if it is not installed this throws (only when
 * Langfuse tracing is actually enabled), matching the Python behavior.
 */
function createLangfuseHandler(config: LangfuseTracingConfig): unknown {
  // Optional dep: resolved lazily via require so it is not a hard dependency.
  let CallbackHandler: (new (opts: Record<string, unknown>) => unknown) | undefined;
  try {
    const mod = (
      globalThis as { require?: (id: string) => { CallbackHandler?: typeof CallbackHandler } }
    ).require?.("langfuse-langchain");
    CallbackHandler = mod?.CallbackHandler;
  } catch {
    CallbackHandler = undefined;
  }
  if (!CallbackHandler) {
    throw new Error(
      "Langfuse tracing is enabled but the 'langfuse-langchain' package is not installed. Run `npm install langfuse-langchain`.",
    );
  }
  const c = config as { publicKey?: string; secretKey?: string; host?: string };
  return new CallbackHandler({ publicKey: c.publicKey, secretKey: c.secretKey, baseUrl: c.host });
}

/** Build callbacks for all explicitly enabled tracing providers. */
export function buildTracingCallbacks(): unknown[] {
  validateEnabledTracingProviders();
  const enabledProviders = getEnabledTracingProviders();
  if (enabledProviders.length === 0) {
    return [];
  }

  const tracingConfig = getTracingConfig();
  const callbacks: unknown[] = [];

  for (const provider of enabledProviders) {
    if (provider === "langsmith") {
      try {
        callbacks.push(createLangsmithTracer(tracingConfig.langsmith));
      } catch (exc) {
        throw new Error(`LangSmith tracing initialization failed: ${String(exc)}`);
      }
    } else if (provider === "langfuse") {
      try {
        callbacks.push(createLangfuseHandler(tracingConfig.langfuse));
      } catch (exc) {
        throw new Error(`Langfuse tracing initialization failed: ${String(exc)}`);
      }
    }
  }

  return callbacks;
}
