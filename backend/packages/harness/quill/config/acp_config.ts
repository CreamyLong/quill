/**
 * ACP (Agent Client Protocol) agent configuration loaded from config.yaml.
 *
 * Mirrors `quill.config.acp_config` from the Python backend.
 */

/** Configuration for a single ACP-compatible agent. */
export interface ACPAgentConfig {
  /** Command to launch the ACP agent subprocess. */
  command: string;
  /** Additional command arguments. */
  args: string[];
  /** Environment variables to inject into the agent subprocess. */
  env: Record<string, string>;
  /** Description of the agent's capabilities (shown in tool description). */
  description: string;
  /** Model hint passed to the agent (optional). */
  model: string | null;
  /** When true, Quill automatically approves all ACP permission requests. */
  autoApprovePermissions: boolean;
}

export function buildACPAgentConfig(input: Partial<ACPAgentConfig> & { command: string; description: string }): ACPAgentConfig {
  return {
    command: input.command,
    args: input.args ?? [],
    env: input.env ?? {},
    description: input.description,
    model: input.model ?? null,
    autoApprovePermissions: input.autoApprovePermissions ?? false,
  };
}

let _acpAgents: Record<string, ACPAgentConfig> = {};

/**
 * Get the currently configured ACP agents.
 *
 * Returns a mapping of agent name -> ACPAgentConfig. Empty object if no ACP
 * agents are configured.
 */
export function getAcpAgents(): Record<string, ACPAgentConfig> {
  return _acpAgents;
}

/**
 * Load ACP agent configuration from a dictionary (typically from config.yaml).
 */
export function loadAcpConfigFromDict(
  configDict: Record<string, Partial<ACPAgentConfig> & { command: string; description: string }> | null | undefined
): void {
  const source = configDict ?? {};
  const agents: Record<string, ACPAgentConfig> = {};
  for (const [name, cfg] of Object.entries(source)) {
    agents[name] = buildACPAgentConfig(cfg);
  }
  _acpAgents = agents;
  console.info(`ACP config loaded: ${Object.keys(_acpAgents).length} agent(s): ${JSON.stringify(Object.keys(_acpAgents))}`);
}
