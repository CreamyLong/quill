/**
 * Skill domain model.
 *
 * Mirrors `quill.skills.types.Skill` from the Python backend.
 */

export const SKILL_MD_FILE = "SKILL.md";

export type SkillCategory = "public" | "custom";

export const SkillCategory = {
  PUBLIC: "public" as const,
  CUSTOM: "custom" as const,
};

export interface Skill {
  /** Unique skill name. */
  name: string;
  /** Short description. */
  description: string;
  /** Optional SPDX license identifier. */
  license: string | null;
  /** Absolute path to the skill directory. */
  skillDir: string;
  /** Absolute path to the skill's main file (SKILL.md). */
  skillFile: string;
  /** Relative path from category root to skill directory. */
  relativePath: string;
  /** Source category. */
  category: SkillCategory;
  /** Optional allow-list of tool names; null means legacy allow-all. */
  allowedTools: string[] | null;
  /** Whether the skill is enabled at runtime. */
  enabled: boolean;
}

/**
 * Return the relative path from the category root to the skill directory.
 * Returns an empty string when the skill lives directly under the category.
 */
export function skillPath(skill: Skill): string {
  return skill.relativePath === "." ? "" : skill.relativePath;
}

/**
 * Get the full path to this skill inside a container mount.
 */
export function getContainerPath(
  skill: Skill,
  containerBasePath = "/mnt/skills"
): string {
  const categoryBase = `${containerBasePath}/${skill.category}`;
  const sp = skillPath(skill);
  if (sp) {
    return `${categoryBase}/${sp}`;
  }
  return categoryBase;
}

/**
 * Get the full path to the skill's main file inside a container mount.
 */
export function getContainerFilePath(
  skill: Skill,
  containerBasePath = "/mnt/skills"
): string {
  return `${getContainerPath(skill, containerBasePath)}/${SKILL_MD_FILE}`;
}

export function skillRepr(skill: Skill): string {
  return `Skill(name=${JSON.stringify(skill.name)}, description=${JSON.stringify(
    skill.description
  )}, category=${JSON.stringify(skill.category)})`;
}
