/**
 * Configuration for the subagent system.
 *
 * Mirrors `quill.config.subagents_config` from the Python backend.
 */

export interface SubagentOverrideConfig {
  /** Timeout in seconds for this subagent (null = use global default) */
  timeoutSeconds: number | null;
  /** Maximum turns for this subagent (null = use global or builtin default) */
  maxTurns: number | null;
  /** Model name for this subagent (null = inherit from parent agent) */
  model: string | null;
  /** Skill names whitelist (null = inherit all enabled skills, [] = no skills) */
  skills: string[] | null;
}

export interface CustomSubagentConfig {
  /** When the lead agent should delegate to this subagent */
  description: string;
  /** System prompt that guides the subagent's behavior */
  systemPrompt: string;
  /** Tool names whitelist (null = inherit all tools from parent) */
  tools: string[] | null;
  /** Tool names to deny */
  disallowedTools: string[];
  /** Skill names whitelist (null = inherit all enabled skills, [] = no skills) */
  skills: string[] | null;
  /** Model to use - 'inherit' uses parent's model */
  model: string;
  /** Maximum number of agent turns before stopping */
  maxTurns: number;
  /** Maximum execution time in seconds */
  timeoutSeconds: number;
}

export interface SubagentsAppConfig {
  /** Master switch — when false, no `task` tool is mounted and no subagents run. */
  enabled: boolean;
  /** Default timeout in seconds for built-in subagents */
  timeoutSeconds: number;
  /** Optional default max-turn override for all subagents */
  maxTurns: number | null;
  /** Per-agent configuration overrides keyed by agent name */
  agents: Record<string, SubagentOverrideConfig>;
  /** User-defined subagent types keyed by agent name */
  customAgents: Record<string, CustomSubagentConfig>;
}

let _subagentsConfig: SubagentsAppConfig = {
  enabled: true,
  timeoutSeconds: 1800,
  maxTurns: null,
  agents: {},
  customAgents: {},
};

/** Get the current subagents configuration. */
export function getSubagentsAppConfig(): SubagentsAppConfig {
  return _subagentsConfig;
}

/** Is the subagent system enabled (master switch). */
export function isSubagentsEnabled(config: SubagentsAppConfig = _subagentsConfig): boolean {
  return config.enabled !== false;
}

/** Load subagents configuration from a partial dictionary. */
export function loadSubagentsConfigFromDict(configDict: Partial<SubagentsAppConfig>): void {
  // `enabled` is read from both camelCase and snake_case for config.yaml parity.
  const enabled = configDict.enabled ?? configDict.enabled ?? true;
  _subagentsConfig = {
    enabled: enabled !== false,
    timeoutSeconds: configDict.timeoutSeconds ?? 1800,
    maxTurns: configDict.maxTurns ?? null,
    agents: configDict.agents ?? {},
    customAgents: configDict.customAgents ?? {},
  };
}

export function getTimeoutFor(config: SubagentsAppConfig, agentName: string): number {
  const override = config.agents[agentName];
  if (override?.timeoutSeconds !== null && override?.timeoutSeconds !== undefined) {
    return override.timeoutSeconds;
  }
  return config.timeoutSeconds;
}

export function getModelFor(config: SubagentsAppConfig, agentName: string): string | null {
  return config.agents[agentName]?.model ?? null;
}

export function getMaxTurnsFor(config: SubagentsAppConfig, agentName: string, builtinDefault: number): number {
  const override = config.agents[agentName];
  if (override?.maxTurns !== null && override?.maxTurns !== undefined) {
    return override.maxTurns;
  }
  if (config.maxTurns !== null) {
    return config.maxTurns;
  }
  return builtinDefault;
}

export function getSkillsFor(config: SubagentsAppConfig, agentName: string): string[] | null {
  return config.agents[agentName]?.skills ?? null;
}
