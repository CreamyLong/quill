/**
 * SKILL.md front-matter validation utilities.
 *
 * Mirrors `quill.skills.validation` from the Python backend.
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import { parseAllowedTools } from "./parser.js";
import { SKILL_MD_FILE } from "./types.js";

// Allowed properties in SKILL.md frontmatter.
export const ALLOWED_FRONTMATTER_PROPERTIES: ReadonlySet<string> = new Set([
  "name",
  "description",
  "license",
  "allowed-tools",
  "metadata",
  "compatibility",
  "version",
  "author",
]);

/** Best-effort Python-style type name for validation error messages. */
function pyTypeName(value: unknown): string {
  if (value === null) {
    return "NoneType";
  }
  if (Array.isArray(value)) {
    return "list";
  }
  switch (typeof value) {
    case "string":
      return "str";
    case "boolean":
      return "bool";
    case "number":
      return Number.isInteger(value) ? "int" : "float";
    case "object":
      return "dict";
    default:
      return typeof value;
  }
}

export type FrontmatterValidationResult = [boolean, string, string | null];

/**
 * Validate a skill directory's SKILL.md frontmatter.
 *
 * Returns a tuple of [isValid, message, skillName].
 */
export function validateSkillFrontmatter(skillDir: string): FrontmatterValidationResult {
  const skillMd = path.join(skillDir, SKILL_MD_FILE);
  if (!fs.existsSync(skillMd)) {
    return [false, `${SKILL_MD_FILE} not found`, null];
  }

  const content = fs.readFileSync(skillMd, "utf-8");
  if (!content.startsWith("---")) {
    return [false, "No YAML frontmatter found", null];
  }

  // Extract frontmatter.
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) {
    return [false, "Invalid frontmatter format", null];
  }

  const frontmatterText = match[1];

  // Parse YAML frontmatter.
  let frontmatter: unknown;
  try {
    frontmatter = YAML.parse(frontmatterText);
  } catch (e) {
    return [false, `Invalid YAML in frontmatter: ${String(e)}`, null];
  }
  if (frontmatter === null || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    return [false, "Frontmatter must be a YAML dictionary", null];
  }

  const meta = frontmatter as Record<string, unknown>;

  // Check for unexpected properties.
  const unexpectedKeys = Object.keys(meta).filter((key) => !ALLOWED_FRONTMATTER_PROPERTIES.has(key));
  if (unexpectedKeys.length > 0) {
    return [false, `Unexpected key(s) in SKILL.md frontmatter: ${unexpectedKeys.sort().join(", ")}`, null];
  }

  // Check required fields.
  if (!("name" in meta)) {
    return [false, "Missing 'name' in frontmatter", null];
  }
  if (!("description" in meta)) {
    return [false, "Missing 'description' in frontmatter", null];
  }

  // Validate name.
  const rawName = meta.name ?? "";
  if (typeof rawName !== "string") {
    return [false, `Name must be a string, got ${pyTypeName(rawName)}`, null];
  }
  const name = rawName.trim();
  if (!name) {
    return [false, "Name cannot be empty", null];
  }

  // Check naming convention (hyphen-case: lowercase with hyphens).
  if (!/^[a-z0-9-]+$/.test(name)) {
    return [false, `Name '${name}' should be hyphen-case (lowercase letters, digits, and hyphens only)`, null];
  }
  if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
    return [false, `Name '${name}' cannot start/end with hyphen or contain consecutive hyphens`, null];
  }
  if (name.length > 64) {
    return [false, `Name is too long (${name.length} characters). Maximum is 64 characters.`, null];
  }

  // Validate description.
  const rawDescription = meta.description ?? "";
  if (typeof rawDescription !== "string") {
    return [false, `Description must be a string, got ${pyTypeName(rawDescription)}`, null];
  }
  const description = rawDescription.trim();
  if (description) {
    if (description.includes("<") || description.includes(">")) {
      return [false, "Description cannot contain angle brackets (< or >)", null];
    }
    if (description.length > 1024) {
      return [false, `Description is too long (${description.length} characters). Maximum is 1024 characters.`, null];
    }
  }

  try {
    parseAllowedTools(meta["allowed-tools"], skillMd);
  } catch (e) {
    const messageText = e instanceof Error ? e.message : String(e);
    return [false, messageText.split(skillMd).join(SKILL_MD_FILE), null];
  }

  return [true, "Skill is valid!", name];
}
