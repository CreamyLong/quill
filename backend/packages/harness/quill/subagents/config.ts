/**
 * Subagent configuration definitions.
 *
 * Mirrors `quill.subagents.config` from the Python backend.
 */

import type { AppConfig } from "../config/app_config.js";
import { getAppConfig } from "../config/app_config.js";

/**
 * Configuration for a subagent.
 *
 * Field notes (mirrors the Python dataclass docstring):
 * - `name`: Unique identifier for the subagent.
 * - `description`: When the lead agent should delegate to this subagent.
 * - `systemPrompt`: The system prompt that guides the subagent's behavior.
 * - `tools`: Optional list of tool names to allow. If null, inherits all tools.
 * - `disallowedTools`: Optional list of tool names to deny.
 * - `skills`: Optional list of skill names to load. If null, inherits all
 *   enabled skills. If an empty list, no skills are loaded.
 * - `model`: Model to use — 'inherit' uses parent's model.
 * - `maxTurns`: Maximum agent turns before stopping. Built-in agents use the
 *   value set here (general-purpose=150, bash=60) unless the global
 *   `subagents.max_turns` is set.
 * - `timeoutSeconds`: Bare fallback execution-time cap. For built-in agents the
 *   effective limit is the global `subagents.timeout_seconds` (default
 *   1800 = 30 min), layered on by the registry; this 900 only applies
 *   when no differing global value exists.
 */
export interface SubagentConfig {
  name: string;
  description: string;
  systemPrompt: string | null;
  tools: string[] | null;
  disallowedTools: string[] | null;
  skills: string[] | null;
  model: string;
  maxTurns: number;
  timeoutSeconds: number;
}

/** Fields required when constructing a {@link SubagentConfig}; the rest default. */
export type SubagentConfigInit = Partial<SubagentConfig> &
  Pick<SubagentConfig, "name" | "description">;

/**
 * Build a {@link SubagentConfig}, filling the same defaults as the Python
 * dataclass (`disallowed_tools=["task"]`, `model="inherit"`, `max_turns=50`,
 * `timeout_seconds=900`).
 */
export function createSubagentConfig(init: SubagentConfigInit): SubagentConfig {
  return {
    name: init.name,
    description: init.description,
    systemPrompt: init.systemPrompt ?? null,
    tools: init.tools ?? null,
    disallowedTools: init.disallowedTools ?? ["task"],
    skills: init.skills ?? null,
    model: init.model ?? "inherit",
    maxTurns: init.maxTurns ?? 50,
    timeoutSeconds: init.timeoutSeconds ?? 900,
  };
}

/** Return a shallow copy of `config` with `overrides` applied (mirrors `dataclasses.replace`). */
export function replaceSubagentConfig(
  config: SubagentConfig,
  overrides: Partial<SubagentConfig>
): SubagentConfig {
  return { ...config, ...overrides };
}

function _defaultModelName(appConfig: AppConfig): string {
  if (!appConfig.models || appConfig.models.length === 0) {
    throw new Error(
      "No chat models are configured. Please configure at least one model in config.yaml."
    );
  }
  return appConfig.models[0].name;
}

/** Resolve the effective model name a subagent should use. */
export function resolveSubagentModelName(
  config: SubagentConfig,
  parentModel: string | null,
  options: { appConfig?: AppConfig | null } = {}
): string {
  if (config.model !== "inherit") {
    return config.model;
  }

  if (parentModel !== null && parentModel !== undefined) {
    return parentModel;
  }

  const appConfig = options.appConfig ?? getAppConfig();
  return _defaultModelName(appConfig);
}
