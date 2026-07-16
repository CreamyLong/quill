/**
 * Configuration for the custom agents management API.
 */
export interface AgentsApiConfig {
  /** Whether to expose the custom-agent management API over HTTP. */
  enabled: boolean;
}

let _agentsApiConfig: AgentsApiConfig = { enabled: false };

/** Get the current agents API configuration. */
export function getAgentsApiConfig(): AgentsApiConfig {
  return _agentsApiConfig;
}

/** Set the agents API configuration. */
export function setAgentsApiConfig(config: AgentsApiConfig): void {
  _agentsApiConfig = config;
}

/** Load agents API configuration from a dictionary. */
export function loadAgentsApiConfigFromDict(configDict: Partial<AgentsApiConfig>): void {
  _agentsApiConfig = {
    enabled: configDict.enabled ?? false,
  };
}
