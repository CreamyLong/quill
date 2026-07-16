/**
 * Configuration for the skills system.
 *
 * Mirrors `quill.config.skills_config` from the Python backend.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { projectRoot, resolvePath } from "./runtime_paths.js";

const DEFAULT_SKILL_STORAGE = "quill.skills.storage.local_skill_storage:LocalSkillStorage";
const DEFAULT_CONTAINER_PATH = "/mnt/skills";

/**
 * Find the Quill monorepo root by walking up from `startDir`.
 *
 * The backend package contains its own `config.yaml`, `AGENTS.md` and
 * `package.json`, so stopping at the first marker file lands us inside
 * `backend/` instead of the real repo root. We therefore identify the root by
 * the coexistence of repo-level landmarks: a `skills` directory together with
 * either a `backend` or `frontend` directory (or a `config.yaml` that sits next
 * to a `skills` directory). This works for both the source tree and the
 * compiled `dist/` layout.
 */
function findRepoRoot(startDir: string): string | null {
  let current = startDir;
  for (let i = 0; i < 12; i++) {
    const hasSkillsDir = fs.existsSync(path.join(current, "skills"));
    const hasBackendDir = fs.existsSync(path.join(current, "backend"));
    const hasFrontendDir = fs.existsSync(path.join(current, "frontend"));
    const hasConfigYaml = fs.existsSync(path.join(current, "config.yaml"));

    // Strong signal: a skills dir plus one of the monorepo modules.
    if (hasSkillsDir && (hasBackendDir || hasFrontendDir)) {
      return current;
    }
    // Accept a config.yaml only when it is next to a skills dir (repo root),
    // not the backend copy.
    if (hasConfigYaml && hasSkillsDir) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

/**
 * Return source-tree skills locations for monorepo compatibility.
 *
 * Walks up from this module file to the project root (looking for marker files)
 * and returns `<repo-root>/skills`. Falls back to the old fixed-parent heuristic
 * when no marker is found.
 */
function legacySkillsCandidates(): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(moduleDir);
  if (repoRoot) {
    return [path.join(repoRoot, "skills")];
  }
  // Last-resort fallback matching the original heuristic.
  const backendDir = path.resolve(moduleDir, "..", "..", "..", "..");
  return [path.join(path.dirname(backendDir), "skills")];
}

function isDir(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Configuration for skills system.
 */
export class SkillsConfig {
  /** Class path of the SkillStorage implementation. */
  use: string;
  /** Path to skills directory (null = default under the project root). */
  path: string | null;
  /** Path where skills are mounted in the sandbox container. */
  containerPath: string;

  constructor(input: Partial<{ use: string; path: string | null; containerPath: string }> = {}) {
    this.use = input.use ?? DEFAULT_SKILL_STORAGE;
    this.path = input.path ?? null;
    this.containerPath = input.containerPath ?? DEFAULT_CONTAINER_PATH;
  }

  /**
   * Get the resolved skills directory path.
   *
   * Resolution order:
   *   1. Explicit `path` field
   *   2. `QUILL_SKILLS_PATH` environment variable
   *   3. `skills` under the caller project root (`projectRoot()`)
   *   4. Legacy repo-root candidates for monorepo compatibility
   *
   * When none of (3) or (4) exist on disk, the project-root default is
   * returned so callers can still surface a stable "no skills" location
   * without raising.
   */
  getSkillsPath(): string {
    if (this.path) {
      return resolvePath(this.path);
    }
    const envPath = process.env.QUILL_SKILLS_PATH;
    if (envPath) {
      return resolvePath(envPath);
    }

    const projectDefault = path.join(projectRoot(), "skills");
    if (isDir(projectDefault)) {
      return projectDefault;
    }

    for (const candidate of legacySkillsCandidates()) {
      if (isDir(candidate)) {
        return candidate;
      }
    }

    return projectDefault;
  }

  /**
   * Get the full container path for a specific skill.
   */
  getSkillContainerPath(skillName: string, category = "public"): string {
    return `${this.containerPath}/${category}/${skillName}`;
  }
}
