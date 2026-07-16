/**
 * SKILL.md front-matter parser.
 *
 * Mirrors `quill.skills.parser` from the Python backend.
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import { SKILL_MD_FILE, type Skill, type SkillCategory } from "./types.js";

interface YamlErrorLike {
  message?: string;
  linePos?: Array<{ line: number; col: number }>;
  code?: string;
}

/** Render a developer-friendly explanation of a YAML front-matter error. */
function formatYamlError(skillFile: string, exc: unknown, source: string): string {
  const err = (exc ?? {}) as YamlErrorLike;
  const message = err.message ?? String(exc);
  const lines = [`Invalid YAML front-matter in ${skillFile}: ${message}`];

  const linePos = err.linePos && err.linePos.length > 0 ? err.linePos[0] : null;
  const sourceLines = source.split("\n");
  // yaml's linePos.line is 1-based within the front-matter body.
  const markLine = linePos ? linePos.line - 1 : -1;
  if (markLine >= 0 && markLine < sourceLines.length) {
    const offending = sourceLines[markLine];

    // +1 to make it 1-based, +1 more for the leading `---` fence the
    // front-matter regex strips before parsing. Matches the editor line.
    const fileLineNumber = markLine + 2;
    lines.push(`  line ${fileLineNumber}: ${offending}`);

    if (message.includes("mapping values are not allowed") && offending.includes(":")) {
      const idx = offending.indexOf(":");
      const key = offending.slice(0, idx);
      const value = offending.slice(idx + 1).trim();
      if (value && !['"', "'", "|", ">", "[", "{"].includes(value[0])) {
        const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        lines.push(`  hint: values containing ":" must be quoted, e.g. ${key}: "${escaped}"`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Parse the optional allowed-tools front-matter field.
 *
 * Returns null when the field is omitted. Returns a list when the field is a
 * YAML sequence of strings, including an empty list for explicit no-tool skills.
 * Also accepts a space-separated string (e.g. "Read Write Edit Bash") for
 * compatibility with skill files that use plain scalar syntax.
 * Throws for malformed values.
 */
export function parseAllowedTools(raw: unknown, skillFile: string): string[] | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  // Accept a plain string and split on whitespace.
  if (typeof raw === "string") {
    const tools = raw.trim().split(/\s+/).filter(Boolean);
    if (tools.length === 0) {
      throw new Error(`allowed-tools in ${skillFile} cannot be an empty string`);
    }
    return tools;
  }

  if (!Array.isArray(raw)) {
    throw new Error(`allowed-tools in ${skillFile} must be a list of strings`);
  }

  const allowedTools: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      throw new Error(`allowed-tools in ${skillFile} must contain only strings`);
    }
    const toolName = item.trim();
    if (!toolName) {
      throw new Error(`allowed-tools in ${skillFile} cannot contain empty tool names`);
    }
    allowedTools.push(toolName);
  }
  return allowedTools;
}

/**
 * Parse a SKILL.md file and extract metadata.
 *
 * Returns a Skill object if parsing succeeds, null otherwise.
 */
export function parseSkillFile(skillFile: string, category: SkillCategory, relativePath?: string | null): Skill | null {
  if (!fs.existsSync(skillFile) || path.basename(skillFile) !== SKILL_MD_FILE) {
    return null;
  }

  try {
    const content = fs.readFileSync(skillFile, "utf-8");

    // Extract YAML front-matter block between leading `---` fences.
    const frontMatterMatch = /^---\s*\n([\s\S]*?)\n---\s*\n/.exec(content);
    if (!frontMatterMatch) {
      return null;
    }

    const frontMatterText = frontMatterMatch[1];

    let metadata: unknown;
    try {
      metadata = YAML.parse(frontMatterText);
    } catch (exc) {
      console.error(formatYamlError(skillFile, exc, frontMatterText));
      return null;
    }

    if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
      console.error(`Front-matter in ${skillFile} is not a YAML mapping`);
      return null;
    }

    const meta = metadata as Record<string, unknown>;

    // Extract required fields. Both must be non-empty strings.
    const rawName = meta.name;
    const rawDescription = meta.description;

    if (!rawName || typeof rawName !== "string") {
      return null;
    }
    if (!rawDescription || typeof rawDescription !== "string") {
      return null;
    }

    const name = rawName.trim();
    const description = rawDescription.trim();

    if (!name || !description) {
      return null;
    }

    let licenseText: string | null = null;
    const rawLicense = meta.license;
    if (rawLicense !== null && rawLicense !== undefined) {
      licenseText = String(rawLicense).trim() || null;
    }

    let allowedTools: string[] | null;
    try {
      allowedTools = parseAllowedTools(meta["allowed-tools"], skillFile);
    } catch (exc) {
      console.error(`Invalid allowed-tools in ${skillFile}: ${String(exc)}`);
      return null;
    }

    const skillDir = path.dirname(skillFile);
    return {
      name,
      description,
      license: licenseText,
      skillDir,
      skillFile,
      relativePath: relativePath ?? path.basename(skillDir),
      category,
      allowedTools,
      enabled: true, // Actual state comes from the extensions config file.
    };
  } catch (e) {
    console.error(`Unexpected error parsing skill file ${skillFile}: ${String(e)}`);
    return null;
  }
}
