/**
 * Model API response contracts for the gateway models router.
 */

export interface ModelResponse {
  /** Unique identifier for the model */
  name: string;
  /** Actual provider model identifier */
  model: string;
  /** Human-readable name */
  display_name?: string | null;
  /** Model description */
  description?: string | null;
  /** Whether model supports thinking mode */
  supports_thinking: boolean;
  /** Whether model supports reasoning effort */
  supports_reasoning_effort: boolean;
}

export interface TokenUsageResponse {
  /** Whether token usage display is enabled */
  enabled: boolean;
}

export interface ModelsListResponse {
  models: ModelResponse[];
  token_usage: TokenUsageResponse;
}
