/**
 * Tracing configuration for supported providers (LangSmith, Langfuse).
 *
 * Mirrors `quill.config.tracing_config` from the Python backend.
 */

export interface LangSmithTracingConfig {
  enabled: boolean;
  apiKey: string | null;
  project: string;
  endpoint: string;
}

export interface LangfuseTracingConfig {
  enabled: boolean;
  publicKey: string | null;
  secretKey: string | null;
  host: string;
}

export interface TracingConfig {
  langsmith: LangSmithTracingConfig;
  langfuse: LangfuseTracingConfig;
}

export function isLangSmithConfigured(config: LangSmithTracingConfig): boolean {
  return config.enabled && Boolean(config.apiKey);
}

export function validateLangSmith(config: LangSmithTracingConfig): void {
  if (config.enabled && !config.apiKey) {
    throw new Error("LangSmith tracing is enabled but LANGSMITH_API_KEY (or LANGCHAIN_API_KEY) is not set.");
  }
}

export function isLangfuseConfigured(config: LangfuseTracingConfig): boolean {
  return config.enabled && Boolean(config.publicKey) && Boolean(config.secretKey);
}

export function validateLangfuse(config: LangfuseTracingConfig): void {
  if (!config.enabled) {
    return;
  }
  const missing: string[] = [];
  if (!config.publicKey) {
    missing.push("LANGFUSE_PUBLIC_KEY");
  }
  if (!config.secretKey) {
    missing.push("LANGFUSE_SECRET_KEY");
  }
  if (missing.length > 0) {
    throw new Error(`Langfuse tracing is enabled but required settings are missing: ${missing.join(", ")}`);
  }
}

export function tracingIsConfigured(config: TracingConfig): boolean {
  return enabledProviders(config).length > 0;
}

export function explicitlyEnabledProviders(config: TracingConfig): string[] {
  const enabled: string[] = [];
  if (config.langsmith.enabled) {
    enabled.push("langsmith");
  }
  if (config.langfuse.enabled) {
    enabled.push("langfuse");
  }
  return enabled;
}

export function enabledProviders(config: TracingConfig): string[] {
  const enabled: string[] = [];
  if (isLangSmithConfigured(config.langsmith)) {
    enabled.push("langsmith");
  }
  if (isLangfuseConfigured(config.langfuse)) {
    enabled.push("langfuse");
  }
  return enabled;
}

export function validateEnabled(config: TracingConfig): void {
  validateLangSmith(config.langsmith);
  validateLangfuse(config.langfuse);
}

let _tracingConfig: TracingConfig | null = null;

const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

/** Return the boolean value of the first env var that is present and non-empty. */
function envFlagPreferred(...names: string[]): boolean {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value.trim()) {
      return TRUTHY_VALUES.has(value.trim().toLowerCase());
    }
  }
  return false;
}

/** Return the first non-empty environment value from candidate names. */
function firstEnvValue(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

/** Get the current tracing configuration from environment variables. */
export function getTracingConfig(): TracingConfig {
  if (_tracingConfig !== null) {
    return _tracingConfig;
  }
  _tracingConfig = {
    langsmith: {
      enabled: envFlagPreferred("LANGSMITH_TRACING", "LANGCHAIN_TRACING_V2", "LANGCHAIN_TRACING"),
      apiKey: firstEnvValue("LANGSMITH_API_KEY", "LANGCHAIN_API_KEY"),
      project: firstEnvValue("LANGSMITH_PROJECT", "LANGCHAIN_PROJECT") ?? "quill",
      endpoint: firstEnvValue("LANGSMITH_ENDPOINT", "LANGCHAIN_ENDPOINT") ?? "https://api.smith.langchain.com",
    },
    langfuse: {
      enabled: envFlagPreferred("LANGFUSE_TRACING"),
      publicKey: firstEnvValue("LANGFUSE_PUBLIC_KEY"),
      secretKey: firstEnvValue("LANGFUSE_SECRET_KEY"),
      host: firstEnvValue("LANGFUSE_BASE_URL") ?? "https://cloud.langfuse.com",
    },
  };
  return _tracingConfig;
}

/** Return the configured tracing providers that are enabled and complete. */
export function getEnabledTracingProviders(): string[] {
  return enabledProviders(getTracingConfig());
}

/** Return tracing providers explicitly enabled by config, even if incomplete. */
export function getExplicitlyEnabledTracingProviders(): string[] {
  return explicitlyEnabledProviders(getTracingConfig());
}

/** Validate that any explicitly enabled providers are fully configured. */
export function validateEnabledTracingProviders(): void {
  validateEnabled(getTracingConfig());
}

/** Check if any tracing provider is enabled and fully configured. */
export function isTracingEnabled(): boolean {
  return tracingIsConfigured(getTracingConfig());
}

/** Discard the cached TracingConfig so the next call rebuilds it. */
export function resetTracingConfig(): void {
  _tracingConfig = null;
}
