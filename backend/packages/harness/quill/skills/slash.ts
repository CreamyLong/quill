/**
 * Slash-skill command parsing and resolution.
 *
 * Mirrors `quill.skills.slash` from the Python backend.
 */

import { getContainerFilePath, type Skill } from "./types.js";

export const RESERVED_SLASH_SKILL_NAMES: ReadonlySet<string> = new Set([
  "bootstrap",
  "help",
  "memory",
  "models",
  "new",
  "status",
]);

const SLASH_SKILL_RE = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+|$)/;

/** Parsed slash-skill command with the skill name and remaining task text. */
export interface SlashSkillReference {
  name: string;
  remainingText: string;
}

/** Slash-skill activation resolved against enabled runtime-visible skills. */
export interface ResolvedSlashSkill {
  skill: Skill;
  remainingText: string;
  containerFilePath: string;
}

/** Parse strict `/skill-name task` syntax, ignoring reserved control commands. */
export function parseSlashSkillReference(text: string): SlashSkillReference | null {
  const match = SLASH_SKILL_RE.exec(text);
  if (!match) {
    return null;
  }
  const name = match[1];
  if (RESERVED_SLASH_SKILL_NAMES.has(name)) {
    return null;
  }
  return {
    name,
    remainingText: text.slice(match[0].length).replace(/^\s+/, ""),
  };
}

export interface ResolveSlashSkillOptions {
  availableSkills?: Set<string> | null;
  containerBasePath?: string;
}

/** Resolve text into an enabled, whitelisted skill activation if possible. */
export function resolveSlashSkill(text: string, skills: Skill[], options: ResolveSlashSkillOptions = {}): ResolvedSlashSkill | null {
  const availableSkills = options.availableSkills ?? null;
  const containerBasePath = options.containerBasePath ?? "/mnt/skills";

  const reference = parseSlashSkillReference(text);
  if (reference === null) {
    return null;
  }
  if (availableSkills !== null && !availableSkills.has(reference.name)) {
    return null;
  }

  const skill = skills.find((candidate) => candidate.name === reference.name && candidate.enabled);
  if (skill === undefined) {
    return null;
  }

  return {
    skill,
    remainingText: reference.remainingText,
    containerFilePath: getContainerFilePath(skill, containerBasePath),
  };
}
