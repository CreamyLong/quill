/**
 * Configuration for deferred tool loading via tool_search.
 *
 * When enabled, MCP tools are not loaded into the agent's context directly.
 * Instead, they are listed by name in the system prompt and discoverable
 * via the tool_search tool at runtime.
 */

export interface ToolSearchConfig {
  /** Defer tools and enable tool_search */
  enabled: boolean;
}

let _toolSearchConfig: ToolSearchConfig | null = null;

/** Get the tool search config, loading from AppConfig if needed. */
export function getToolSearchConfig(): ToolSearchConfig {
  if (_toolSearchConfig === null) {
    _toolSearchConfig = { enabled: false };
  }
  return _toolSearchConfig;
}

/** Load tool search config from a dict (called during AppConfig loading). */
export function loadToolSearchConfigFromDict(data: Partial<ToolSearchConfig>): ToolSearchConfig {
  _toolSearchConfig = {
    enabled: data.enabled ?? false,
  };
  return _toolSearchConfig;
}
