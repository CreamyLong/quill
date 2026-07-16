/**
 * Suggestions API request/response contracts.
 */

export interface SuggestionMessage {
  role: string;
  content: string;
}

export interface SuggestionsRequest {
  /** Recent conversation messages */
  messages: SuggestionMessage[];
  /** Number of suggestions to generate */
  n?: number;
  /** Optional model override */
  model_name?: string | null;
}

export interface SuggestionsResponse {
  /** Suggested follow-up questions */
  suggestions: string[];
}

export interface SuggestionsConfigResponse {
  /** Whether follow-up suggestions are enabled globally */
  enabled: boolean;
}
