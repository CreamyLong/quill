/** Runtime-resolved model capabilities. */
export interface ModelCapabilities {
  reasoning: boolean;
  reasoning_effort: boolean;
  vision: boolean;
  attachments: boolean;
  tools: boolean;
  max_tokens: number;
  max_output_tokens: number;
}

/** A configured model with full details and runtime-resolved capabilities. */
export interface Model {
  name: string;
  model: string;
  use: string;
  display_name: string;
  description?: string | null;
  base_url?: string | null;
  supports_thinking?: boolean;
  supports_vision?: boolean;
  supports_reasoning_effort?: boolean;
  /** Runtime-resolved capabilities from the provider. */
  capabilities?: ModelCapabilities;
  /** Whether the model has credentials configured. */
  has_credentials: boolean;
  /** Validation warnings. */
  warnings: string[];
}

export interface TokenUsageSettings {
  enabled: boolean;
}

export interface ModelsResponse {
  models: Model[];
  token_usage: TokenUsageSettings;
}

/** A provider plugin available for model configuration. */
export interface ProviderPlugin {
  id: string;
  name: string;
  logo?: string | null;
  auth_methods: string[];
  config_fields: ProviderConfigField[];
  default_capabilities: {
    reasoning: boolean;
    vision: boolean;
    attachments: boolean;
    tools: boolean;
  };
  class_path: string;
}

export interface ProviderConfigField {
  key: string;
  label: string;
  type: "string" | "password" | "url" | "boolean" | "number";
  required: boolean;
  placeholder?: string;
  help_text?: string;
}

export interface ProvidersResponse {
  providers: ProviderPlugin[];
}
