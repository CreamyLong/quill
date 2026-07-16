/**
 * Configuration for a guardrail provider.
 */
export interface GuardrailProviderConfig {
  /** Class path (e.g. 'quill.guardrails.builtin:AllowlistProvider') */
  use: string;
  /** Provider-specific settings passed as kwargs */
  config: Record<string, unknown>;
}

/**
 * Configuration for pre-tool-call authorization.
 */
export interface GuardrailsConfig {
  /** Enable guardrail middleware */
  enabled: boolean;
  /** Block tool calls if provider errors */
  failClosed: boolean;
  /** OAP passport path or hosted agent ID */
  passport: string | null;
  /** Guardrail provider configuration */
  provider: GuardrailProviderConfig | null;
}

let _guardrailsConfig: GuardrailsConfig | null = null;

/** Get the guardrails config, returning defaults if not loaded. */
export function getGuardrailsConfig(): GuardrailsConfig {
  if (_guardrailsConfig === null) {
    _guardrailsConfig = {
      enabled: false,
      failClosed: true,
      passport: null,
      provider: null,
    };
  }
  return _guardrailsConfig;
}

/** Load guardrails config from a dict (called during AppConfig loading). */
export function loadGuardrailsConfigFromDict(data: Partial<GuardrailsConfig>): GuardrailsConfig {
  _guardrailsConfig = {
    enabled: data.enabled ?? false,
    failClosed: data.failClosed ?? true,
    passport: data.passport ?? null,
    provider: data.provider ?? null,
  };
  return _guardrailsConfig;
}

/** Reset the cached config instance. Used in tests to prevent singleton leaks. */
export function resetGuardrailsConfig(): void {
  _guardrailsConfig = null;
}
