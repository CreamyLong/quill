/**
 * Skill-based tool allow-list filtering.
 *
 * Mirrors `quill.skills.tool_policy` from the Python backend.
 */

import type { Skill } from "./types.js";

export interface NamedTool {
  name: string;
  [key: string]: unknown;
}

/**
 * Return the union of explicit skill allowed-tools declarations.
 *
 * `null` means legacy allow-all behavior: it is returned only when no loaded
 * skill declares allowed-tools. Once any skill declares the field, legacy
 * skills without the field contribute no tools instead of disabling the
 * explicit restrictions from other skills.
 */
export function allowedToolNamesForSkills(skills: Skill[]): Set<string> | null {
  if (skills.length === 0) {
    return null;
  }

  const allowed = new Set<string>();
  let hasExplicitDeclaration = false;
  for (const skill of skills) {
    if (skill.allowedTools === null) {
      continue;
    }
    hasExplicitDeclaration = true;
    if (skill.allowedTools.length === 0) {
      console.info(`Skill ${skill.name} declared empty allowed-tools`);
    }
    for (const name of skill.allowedTools) {
      allowed.add(name);
    }
  }

  if (!hasExplicitDeclaration) {
    return null;
  }
  return allowed;
}

/**
 * Filter a tool list by skill allow-lists.
 */
export function filterToolsBySkillAllowedTools<T extends NamedTool>(
  tools: T[],
  skills: Skill[]
): T[] {
  const allowed = allowedToolNamesForSkills(skills);
  if (allowed === null) {
    return tools;
  }
  return tools.filter((tool) => allowed.has(tool.name));
}
