/**
 * Abstract SkillStorage base class with template-method flows.
 *
 * Mirrors `quill.skills.storage.skill_storage` from the Python backend.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ExtensionsConfig } from "../../config/extensions_config.js";
import { runAsyncInstall } from "../installer.js";
import { parseSkillFile } from "../parser.js";
import { SKILL_MD_FILE, SkillCategory, type Skill } from "../types.js";
import { validateSkillFrontmatter } from "../validation.js";

export { SKILL_MD_FILE };

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Abstract base for skill storage backends.
 *
 * Subclasses implement a small set of storage-medium-specific atomic operations;
 * this base class provides template-method flows (loadSkills, history
 * serialisation, path helpers, validation) that compose them.
 */
export abstract class SkillStorage {
  protected readonly containerRoot: string;

  constructor(containerPath = "/mnt/skills") {
    this.containerRoot = containerPath;
  }

  // ------------------------------------------------------------------
  // Static protocol helpers (not storage-specific)
  // ------------------------------------------------------------------

  /** Validate and normalise a skill name; return the normalised form. */
  static validateSkillName(name: string): string {
    const normalized = name.trim();
    if (!SKILL_NAME_PATTERN.test(normalized)) {
      throw new Error("Skill name must be hyphen-case using lowercase letters, digits, and hyphens only.");
    }
    if (normalized.length > 64) {
      throw new Error("Skill name must be 64 characters or fewer.");
    }
    return normalized;
  }

  /**
   * Validate `relativePath` against `baseDir` and return the resolved target.
   *
   * @throws Error if the resolved target does not lie within `baseDir`.
   */
  static validateRelativePath(relativePath: string, baseDir: string): string {
    if (!relativePath) {
      throw new Error("relative_path must not be empty.");
    }
    const resolvedBase = path.resolve(baseDir);
    const target = path.resolve(path.join(resolvedBase, relativePath));
    const rel = path.relative(resolvedBase, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("relative_path must resolve within the skill directory.");
    }
    return target;
  }

  /** Validate SKILL.md content: parse frontmatter and check the name matches. */
  static validateSkillMarkdownContent(name: string, content: string): void {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quill-skill-"));
    try {
      const tempSkillDir = path.join(tmpDir, SkillStorage.validateSkillName(name));
      fs.mkdirSync(tempSkillDir, { recursive: true });
      fs.writeFileSync(path.join(tempSkillDir, SKILL_MD_FILE), content, { encoding: "utf-8" });
      const [isValid, message, parsedName] = validateSkillFrontmatter(tempSkillDir);
      if (!isValid) {
        throw new Error(message);
      }
      if (parsedName !== name) {
        throw new Error(`Frontmatter name '${parsedName}' must match requested skill name '${name}'.`);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /** Validate and return the resolved absolute path for a support file. */
  ensureSafeSupportPath(name: string, relativePath: string): string {
    const ALLOWED_SUPPORT_SUBDIRS = new Set(["references", "templates", "scripts", "assets"]);
    const skillDir = path.resolve(this.getCustomSkillDir(SkillStorage.validateSkillName(name)));
    if (!relativePath || relativePath.endsWith("/")) {
      throw new Error("Supporting file path must include a filename.");
    }
    if (path.isAbsolute(relativePath)) {
      throw new Error("Supporting file path must be relative.");
    }
    const parts = relativePath.split("/");
    if (parts.some((part) => part === ".." || part === "")) {
      throw new Error("Supporting file path must not contain parent-directory traversal.");
    }
    const topLevel = parts.length > 0 ? parts[0] : "";
    if (!ALLOWED_SUPPORT_SUBDIRS.has(topLevel)) {
      throw new Error(`Supporting files must live under one of: ${[...ALLOWED_SUPPORT_SUBDIRS].sort().join(", ")}.`);
    }
    const target = path.resolve(path.join(skillDir, relativePath));
    const allowedRoot = path.resolve(path.join(skillDir, topLevel));
    const rel = path.relative(allowedRoot, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Supporting file path must stay within the selected support directory.");
    }
    return target;
  }

  // ------------------------------------------------------------------
  // Abstract atomic operations (storage-medium specific)
  // ------------------------------------------------------------------

  /** Absolute host path to the skills root, used for sandbox mounts. */
  abstract getSkillsRootPath(): string;

  /** Yield `[category, categoryRoot, skillMdPath]` for every SKILL.md. */
  protected abstract iterSkillFiles(): Iterable<[SkillCategory, string, string]>;

  /** Read SKILL.md content for a custom skill. */
  abstract readCustomSkill(name: string): string;

  /** Atomically write a text file under `custom/<name>/<relativePath>`. */
  abstract writeCustomSkill(name: string, relativePath: string, content: string): void;

  /** Async install of a skill from a `.skill` ZIP archive. */
  abstract ainstallSkillFromArchive(archivePath: string): Promise<Record<string, unknown>>;

  /**
   * Install a skill from a `.skill` archive.
   *
   * Python exposes a blocking sync wrapper; TypeScript cannot block on a
   * promise, so this returns a promise like the async variant.
   */
  installSkillFromArchive(archivePath: string): Promise<Record<string, unknown>> {
    return runAsyncInstall(this.ainstallSkillFromArchive(archivePath));
  }

  /** Delete a custom skill (validation + optional history + directory removal). */
  abstract deleteCustomSkill(name: string, historyMeta?: Record<string, unknown> | null): void;

  abstract customSkillExists(name: string): boolean;

  abstract publicSkillExists(name: string): boolean;

  /** Append a JSONL history entry for `name`. */
  abstract appendHistory(name: string, record: Record<string, unknown>): void;

  /** Return all history records for `name`, oldest first. */
  abstract readHistory(name: string): Array<Record<string, unknown>>;

  // ------------------------------------------------------------------
  // Concrete path helpers (layout is part of the SKILL.md protocol)
  // ------------------------------------------------------------------

  getContainerRoot(): string {
    return this.containerRoot;
  }

  /** Path to `custom/<name>`. Does not create the directory. */
  getCustomSkillDir(name: string): string {
    const normalizedName = SkillStorage.validateSkillName(name);
    return path.join(this.getSkillsRootPath(), SkillCategory.CUSTOM, normalizedName);
  }

  /** Path to `custom/<name>/SKILL.md`. */
  getCustomSkillFile(name: string): string {
    const normalizedName = SkillStorage.validateSkillName(name);
    return path.join(this.getCustomSkillDir(normalizedName), SKILL_MD_FILE);
  }

  /** Path to `custom/.history/<name>.jsonl`. Does not create parents. */
  getSkillHistoryFile(name: string): string {
    const normalizedName = SkillStorage.validateSkillName(name);
    return path.join(this.getSkillsRootPath(), SkillCategory.CUSTOM, ".history", `${normalizedName}.jsonl`);
  }

  // ------------------------------------------------------------------
  // Final template-method flows
  // ------------------------------------------------------------------

  /** Discover all skills, merge enabled state, sort and optionally filter. */
  loadSkills(enabledOnly = false): Skill[] {
    const skillsByName = new Map<string, Skill>();
    for (const [category, categoryRoot, mdPath] of this.iterSkillFiles()) {
      const relativePath = path.relative(categoryRoot, path.dirname(mdPath)).split(path.sep).join("/");
      const skill = parseSkillFile(mdPath, category, relativePath);
      if (skill) {
        skillsByName.set(skill.name, skill);
      }
    }

    let skills = [...skillsByName.values()];

    // Merge enabled state from extensions config (re-read every call so
    // changes made by another process are picked up immediately).
    try {
      const extensionsConfig = ExtensionsConfig.fromFile();
      for (const skill of skills) {
        skill.enabled = extensionsConfig.isSkillEnabled(skill.name, skill.category);
      }
    } catch (e) {
      console.warn(`Failed to load extensions config: ${String(e)}`);
    }

    if (enabledOnly) {
      skills = skills.filter((s) => s.enabled);
    }

    skills.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return skills;
  }

  ensureCustomSkillIsEditable(name: string): void {
    if (this.customSkillExists(name)) {
      return;
    }
    if (this.publicSkillExists(name)) {
      throw new Error(
        `'${name}' is a built-in skill. To customise it, create a new skill with the same name under skills/custom/.`
      );
    }
    throw new Error(`Custom skill '${name}' not found.`);
  }
}

