/**
 * Configuration for token usage tracking.
 */
export interface TokenUsageConfig {
  /** Enable token usage tracking middleware */
  enabled: boolean;
}

let _tokenUsageConfig: TokenUsageConfig | null = null;

/**
 * Get token usage config, loading from environment if available.
 */
export function getTokenUsageConfig(): TokenUsageConfig {
  if (_tokenUsageConfig === null) {
    _tokenUsageConfig = {
      enabled: process.env.TOKEN_USAGE_ENABLED !== "false",
    };
  }
  return _tokenUsageConfig;
}
