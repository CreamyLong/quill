/**
 * Configuration and loaders for custom agents.
 *
 * Mirrors `quill.config.agents_config` from the Python backend.
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import { getPaths } from "./paths.js";
import { getEffectiveUserId } from "../runtime/user_context.js";

export const SOUL_FILENAME = "SOUL.md";
export const AGENT_NAME_PATTERN = /^[A-Za-z0-9-]+$/;

export function validateAgentName(name: string | null | undefined): string | null {
  if (name === null || name === undefined) {
    return null;
  }
  if (typeof name !== "string") {
    throw new Error("Invalid agent name. Expected a string or None.");
  }
  if (!AGENT_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid agent name '${name}'. Must match pattern: ${AGENT_NAME_PATTERN.source}`);
  }
  return name;
}

export interface AgentConfig {
  /** Agent name. */
  name: string;
  /** Short description. */
  description: string;
  /** Optional model override. */
  model: string | null;
  /** Optional tool group allow-list. */
  toolGroups: string[] | null;
  /** Optional skill allow-list. */
  skills: string[] | null;
}

/**
 * Return the on-disk directory for an agent, preferring per-user layout.
 */
export function resolveAgentDir(name: string, userId?: string | null): string {
  const paths = getPaths();
  const effectiveUser = userId ?? getEffectiveUserId();
  const userPath = paths.userAgentDir(effectiveUser, name);
  if (fs.existsSync(userPath) && fs.existsSync(path.join(userPath, "config.yaml"))) {
    return userPath;
  }
  const legacyPath = paths.agentDir(name);
  if (fs.existsSync(legacyPath) && fs.existsSync(path.join(legacyPath, "config.yaml"))) {
    return legacyPath;
  }
  return userPath;
}

/**
 * Load a custom agent's config from its directory.
 */
export function loadAgentConfig(name: string | null | undefined, userId?: string | null): AgentConfig | null {
  if (name === null || name === undefined) {
    return null;
  }
  const validated = validateAgentName(name);
  if (validated === null) {
    return null;
  }
  const agentDir = resolveAgentDir(validated, userId);
  const configFile = path.join(agentDir, "config.yaml");

  if (!fs.existsSync(agentDir)) {
    throw new Error(`Agent directory not found: ${agentDir}`);
  }
  if (!fs.existsSync(configFile)) {
    throw new Error(`Agent config not found: ${configFile}`);
  }

  const data = YAML.parse(fs.readFileSync(configFile, "utf-8")) as Record<string, unknown> | null | undefined;
  const cfg = data ?? {};
  if (!("name" in cfg)) {
    cfg.name = validated;
  }

  return {
    name: String(cfg.name ?? validated),
    description: String(cfg.description ?? ""),
    model: (cfg.model ?? null) as string | null,
    toolGroups: (cfg.tool_groups ?? cfg.toolGroups ?? null) as string[] | null,
    skills: (cfg.skills ?? null) as string[] | null,
  };
}

/**
 * Read the SOUL.md file for a custom agent, if it exists.
 */
export function loadAgentSoul(agentName: string | null | undefined, userId?: string | null): string | null {
  const paths = getPaths();
  let agentDir: string;
  if (agentName) {
    agentDir = resolveAgentDir(agentName, userId);
  } else {
    agentDir = paths.baseDir;
  }
  const soulPath = path.join(agentDir, SOUL_FILENAME);
  if (!fs.existsSync(soulPath)) {
    return null;
  }
  const content = fs.readFileSync(soulPath, "utf-8").trim();
  return content || null;
}

/**
 * Scan the agents directory and return all valid custom agents.
 */
export function listCustomAgents(userId?: string | null): AgentConfig[] {
  const paths = getPaths();
  const effectiveUser = userId ?? getEffectiveUserId();
  const seen = new Set<string>();
  const agents: AgentConfig[] = [];

  const userRoot = paths.userAgentsDir(effectiveUser);
  const legacyRoot = paths.agentsDir;

  for (const root of [userRoot, legacyRoot]) {
    if (!fs.existsSync(root)) {
      continue;
    }
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (seen.has(entry.name)) {
        continue;
      }
      const configFile = path.join(root, entry.name, "config.yaml");
      if (!fs.existsSync(configFile)) {
        continue;
      }
      try {
        const agentCfg = loadAgentConfig(entry.name, effectiveUser);
        if (agentCfg !== null) {
          agents.push(agentCfg);
          seen.add(entry.name);
        }
      } catch (error) {
        console.warn(`Skipping agent '${entry.name}':`, error);
      }
    }
  }

  agents.sort((a, b) => a.name.localeCompare(b.name));
  return agents;
}
