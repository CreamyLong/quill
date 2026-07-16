/**
 * Configuration for automatic follow-up suggestions.
 */
export interface SuggestionsConfig {
  /** Whether to enable follow-up question suggestions at the end of an AI response */
  enabled: boolean;
}

let _suggestionsConfig: SuggestionsConfig | null = null;

/**
 * Get suggestions config, loading from environment if available.
 */
export function getSuggestionsConfig(): SuggestionsConfig {
  if (_suggestionsConfig === null) {
    _suggestionsConfig = {
      enabled: process.env.SUGGESTIONS_ENABLED !== "false",
    };
  }
  return _suggestionsConfig;
}
