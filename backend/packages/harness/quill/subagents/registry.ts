/**
 * Subagent registry for managing available subagents.
 *
 * Mirrors `quill.subagents.registry` from the Python backend.
 */

import type { AppConfig } from "../config/app_config.js";
import {
  getModelFor,
  getSkillsFor,
  getSubagentsAppConfig,
  type SubagentsAppConfig,
} from "../config/subagents_config.js";
import { isHostBashAllowed, type AppConfigLike } from "../sandbox/security.js";
import { BUILTIN_SUBAGENTS } from "./builtins/index.js";
import {
  createSubagentConfig,
  replaceSubagentConfig,
  type SubagentConfig,
} from "./config.js";

/** Either a full {@link AppConfig} or a bare {@link SubagentsAppConfig}. */
export type SubagentsConfigSource = AppConfig | SubagentsAppConfig | null | undefined;

function _resolveSubagentsAppConfig(appConfig?: SubagentsConfigSource): SubagentsAppConfig {
  if (appConfig === null || appConfig === undefined) {
    return getSubagentsAppConfig();
  }
  if ("subagents" in appConfig && appConfig.subagents !== undefined) {
    return (appConfig as AppConfig).subagents;
  }
  return appConfig as SubagentsAppConfig;
}

/** Compare two skill whitelists by value (mirrors Python list equality). */
function _skillsEqual(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

/**
 * Build a {@link SubagentConfig} from the config.yaml `custom_agents` section.
 *
 * Returns `null` when `name` is not present in `custom_agents`.
 */
function _buildCustomSubagentConfig(
  name: string,
  options: { appConfig?: SubagentsConfigSource } = {}
): SubagentConfig | null {
  const subagentsConfig = _resolveSubagentsAppConfig(options.appConfig);
  const custom = subagentsConfig.customAgents[name];
  if (custom === undefined) {
    return null;
  }

  return createSubagentConfig({
    name,
    description: custom.description,
    systemPrompt: custom.systemPrompt,
    tools: custom.tools,
    disallowedTools: custom.disallowedTools,
    skills: custom.skills,
    model: custom.model,
    maxTurns: custom.maxTurns,
    timeoutSeconds: custom.timeoutSeconds,
  });
}

/**
 * Get a subagent configuration by name, with config.yaml overrides applied.
 *
 * Resolution order (mirrors Codex's config layering):
 * 1. Built-in subagents (general-purpose, bash)
 * 2. Custom subagents from config.yaml custom_agents section
 * 3. Per-agent overrides from config.yaml agents section (timeout, max_turns, model, skills)
 *
 * Returns `null` when the subagent is not found.
 */
export function getSubagentConfig(
  name: string,
  options: { appConfig?: SubagentsConfigSource } = {}
): SubagentConfig | null {
  // Step 1: Look up built-in, then fall back to custom_agents.
  let config: SubagentConfig | null = BUILTIN_SUBAGENTS[name] ?? null;
  if (config === null) {
    config = _buildCustomSubagentConfig(name, options);
  }
  if (config === null) {
    return null;
  }

  // Step 2: Apply per-agent overrides from config.yaml agents section.
  // Only explicit per-agent overrides are applied here. Global defaults
  // (timeout_seconds, max_turns at the top level) apply to built-in agents
  // but must NOT override custom agents' own values — custom agents define
  // their own defaults in the custom_agents section.
  const subagentsConfig = _resolveSubagentsAppConfig(options.appConfig);
  const isBuiltin = name in BUILTIN_SUBAGENTS;
  const agentOverride = subagentsConfig.agents[name];

  const overrides: Partial<SubagentConfig> = {};

  // Timeout: per-agent override > global default (builtins only) > config's own value.
  if (agentOverride !== undefined && agentOverride.timeoutSeconds !== null) {
    if (agentOverride.timeoutSeconds !== config.timeoutSeconds) {
      console.debug(
        `Subagent '${name}': timeout overridden (${config.timeoutSeconds}s -> ${agentOverride.timeoutSeconds}s)`
      );
      overrides.timeoutSeconds = agentOverride.timeoutSeconds;
    }
  } else if (isBuiltin && subagentsConfig.timeoutSeconds !== config.timeoutSeconds) {
    console.debug(
      `Subagent '${name}': timeout from global default (${config.timeoutSeconds}s -> ${subagentsConfig.timeoutSeconds}s)`
    );
    overrides.timeoutSeconds = subagentsConfig.timeoutSeconds;
  }

  // Max turns: per-agent override > global default (builtins only) > config's own value.
  if (agentOverride !== undefined && agentOverride.maxTurns !== null) {
    if (agentOverride.maxTurns !== config.maxTurns) {
      console.debug(
        `Subagent '${name}': max_turns overridden (${config.maxTurns} -> ${agentOverride.maxTurns})`
      );
      overrides.maxTurns = agentOverride.maxTurns;
    }
  } else if (
    isBuiltin &&
    subagentsConfig.maxTurns !== null &&
    subagentsConfig.maxTurns !== config.maxTurns
  ) {
    console.debug(
      `Subagent '${name}': max_turns from global default (${config.maxTurns} -> ${subagentsConfig.maxTurns})`
    );
    overrides.maxTurns = subagentsConfig.maxTurns;
  }

  // Model: per-agent override only (no global default for model).
  const effectiveModel = getModelFor(subagentsConfig, name);
  if (effectiveModel !== null && effectiveModel !== config.model) {
    console.debug(`Subagent '${name}': model overridden (${config.model} -> ${effectiveModel})`);
    overrides.model = effectiveModel;
  }

  // Skills: per-agent override only (no global default for skills).
  const effectiveSkills = getSkillsFor(subagentsConfig, name);
  if (effectiveSkills !== null && !_skillsEqual(effectiveSkills, config.skills)) {
    console.debug(
      `Subagent '${name}': skills overridden (${JSON.stringify(config.skills)} -> ${JSON.stringify(effectiveSkills)})`
    );
    overrides.skills = effectiveSkills;
  }

  if (Object.keys(overrides).length > 0) {
    config = replaceSubagentConfig(config, overrides);
  }

  return config;
}

/**
 * List all available subagent configurations (with config.yaml overrides applied).
 */
export function listSubagents(
  options: { appConfig?: SubagentsConfigSource } = {}
): SubagentConfig[] {
  const configs: SubagentConfig[] = [];
  for (const name of getSubagentNames(options)) {
    const config = getSubagentConfig(name, options);
    if (config !== null) {
      configs.push(config);
    }
  }
  return configs;
}

/**
 * Get all available subagent names (built-in + custom).
 */
export function getSubagentNames(
  options: { appConfig?: SubagentsConfigSource } = {}
): string[] {
  const names = Object.keys(BUILTIN_SUBAGENTS);

  // Merge custom_agents from config.yaml.
  const subagentsConfig = _resolveSubagentsAppConfig(options.appConfig);
  for (const customName of Object.keys(subagentsConfig.customAgents)) {
    if (!names.includes(customName)) {
      names.push(customName);
    }
  }

  return names;
}

/**
 * Get subagent names that should be exposed to the active runtime.
 *
 * Returns the subagent names visible to the current sandbox configuration.
 */
export function getAvailableSubagentNames(
  options: { appConfig?: SubagentsConfigSource } = {}
): string[] {
  let names = getSubagentNames(options);
  const appConfig = options.appConfig;
  let hostBashAllowed: boolean;
  try {
    if (appConfig && "sandbox" in appConfig) {
      hostBashAllowed = isHostBashAllowed(appConfig as AppConfigLike);
    } else {
      hostBashAllowed = isHostBashAllowed();
    }
  } catch {
    console.debug("Could not determine host bash availability; exposing all subagents");
    return names;
  }

  if (!hostBashAllowed) {
    names = names.filter((name) => name !== "bash");
  }
  return names;
}
