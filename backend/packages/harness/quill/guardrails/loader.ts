/**
 * Guardrail provider resolution.
 *
 * The `guardrails.provider.use` config entry is a class path. For the two
 * built-in providers we use a static registry (no dynamic import needed,
 * which keeps the lazy-resolution path fast and avoids ESM specifier issues
 * in the compiled `dist/` layout). Unknown paths fall back to
 * `resolveVariable()` (async ESM import), mirroring how models and tools
 * resolve their `use` entries.
 *
 * Because the graph factory (`_makeLeadAgent`) is synchronous, we wrap the
 * resolved provider in a {@link LazyGuardrailProvider} that resolves the real
 * provider on the first tool-call evaluation and caches it for the rest of
 * the run.
 */

import {
  AllowlistProvider,
  CommandPolicyProvider,
  type AllowlistProviderOptions,
  type CommandPolicyProviderOptions,
} from "./builtin.js";
import type { GuardrailDecision, GuardrailProvider, GuardrailRequest } from "./provider.js";
import { guardrailMiddleware, type GuardrailMiddlewareOptions } from "./middleware.js";
import { resolveVariable, ValueError } from "../reflection/resolvers.js";
import type { GuardrailsConfig } from "../config/guardrails_config.js";

/**
 * Static registry of built-in provider class paths.
 *
 * Keys are the Python-style class paths kept for config compatibility
 * (e.g. `quill.guardrails.builtin:AllowlistProvider`).
 */
const BUILTIN_PROVIDERS: Record<string, new (config: Record<string, unknown>) => GuardrailProvider> = {
  "quill.guardrails.builtin:AllowlistProvider": AllowlistProvider as unknown as new (
    config: Record<string, unknown>
  ) => GuardrailProvider,
  "quill.guardrails.builtin:CommandPolicyProvider": CommandPolicyProvider as unknown as new (
    config: Record<string, unknown>
  ) => GuardrailProvider,
};

type ProviderCtor = new (config: Record<string, unknown>) => GuardrailProvider;

/**
 * Resolve a guardrail provider from its `use` class path.
 *
 * @param use - Class path, e.g. `quill.guardrails.builtin:CommandPolicyProvider`.
 * @param config - Provider-specific config (already camelCased by the config
 *   loader; keys such as `rules`, `targetField`, `defaultDecision`, etc.).
 * @throws {Error} When the path is unknown or the resolved value is not a
 *   provider constructor.
 */
export async function resolveGuardrailProvider(use: string, config: Record<string, unknown> = {}): Promise<GuardrailProvider> {
  const builtin = BUILTIN_PROVIDERS[use];
  if (builtin) {
    return new builtin(config);
  }

  // External provider: ESM specifier, e.g. "aport_guardrails/providers/generic.js:OAPGuardrailProvider"
  const resolved = await resolveVariable<unknown>(use);
  if (typeof resolved !== "function") {
    throw new ValueError(`${use} is not a guardrail provider constructor`);
  }
  const ctor = resolved as unknown as ProviderCtor;
  return new ctor(config);
}

/**
 * A GuardrailProvider that lazily resolves the real provider on first use.
 *
 * Needed because the graph factory is synchronous while external providers
 * require an async `import()`. The resolution promise is created on
 * construction and cached; subsequent calls await the same promise.
 */
export class LazyGuardrailProvider implements GuardrailProvider {
  readonly name = "lazy-guardrail";
  private readonly providerPromise: Promise<GuardrailProvider>;

  constructor(use: string, config: Record<string, unknown>) {
    this.providerPromise = resolveGuardrailProvider(use, config).catch((err) => {
      // Surface the error on first aevaluate rather than at construction time.
      throw err;
    });
  }

  evaluate(_request: GuardrailRequest): GuardrailDecision {
    // Synchronous evaluation is not possible with a lazy provider; the
    // middleware always uses `aevaluate`.
    throw new Error(
      "LazyGuardrailProvider requires asynchronous evaluation (aevaluate)"
    );
  }

  async aevaluate(request: GuardrailRequest): Promise<GuardrailDecision> {
    const provider = await this.providerPromise;
    return provider.aevaluate(request);
  }
}

/**
 * Build the guardrail MiddlewareDefinition from a loaded `GuardrailsConfig`.
 *
 * Returns `null` when guardrails are disabled or no provider is configured,
 * so the middleware chain can simply spread the result.
 */
export function createGuardrailMiddleware(
  config: GuardrailsConfig,
  options: GuardrailMiddlewareOptions = {},
): ReturnType<typeof guardrailMiddleware> | null {
  if (!config.enabled || !config.provider) {
    return null;
  }
  const { use, config: providerConfig } = config.provider;
  const lazy = new LazyGuardrailProvider(use, providerConfig ?? {});
  return guardrailMiddleware(lazy, {
    failClosed: options.failClosed ?? config.failClosed,
    passport: options.passport ?? config.passport,
  });
}

// Re-export for convenience.
export type { AllowlistProviderOptions, CommandPolicyProviderOptions };
export { AllowlistProvider, CommandPolicyProvider };
