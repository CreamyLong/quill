/**
 * Configuration for per-run token budget enforcement.
 */
export interface TokenBudgetConfig {
  /** Whether to enable per-run token budget enforcement. */
  enabled: boolean;
  /** Maximum total tokens (input + output) allowed per run. */
  maxTokens: number;
  /** Optional separate limit for input tokens only. */
  maxInputTokens: number | null;
  /** Optional separate limit for output tokens only. */
  maxOutputTokens: number | null;
  /** Fraction of max_tokens at which a soft warning is injected. */
  warnThreshold: number;
  /** Fraction of max_tokens at which tool calls are stripped and the agent is forced to produce a final answer. */
  hardStopThreshold: number;
}

/** Validate token budget thresholds. */
export function validateTokenBudgetThresholds(config: TokenBudgetConfig): void {
  if (config.hardStopThreshold < config.warnThreshold) {
    throw new Error("hard_stop_threshold must be >= warn_threshold");
  }
}

/** Build a TokenBudgetConfig from partial input with defaults and validation. */
export function buildTokenBudgetConfig(input: Partial<TokenBudgetConfig> = {}): TokenBudgetConfig {
  const config: TokenBudgetConfig = {
    enabled: input.enabled ?? false,
    maxTokens: input.maxTokens ?? 200000,
    maxInputTokens: input.maxInputTokens ?? null,
    maxOutputTokens: input.maxOutputTokens ?? null,
    warnThreshold: input.warnThreshold ?? 0.8,
    hardStopThreshold: input.hardStopThreshold ?? 1.0,
  };
  validateTokenBudgetThresholds(config);
  return config;
}
