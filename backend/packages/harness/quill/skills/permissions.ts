/**
 * Filesystem permission helpers for installed skill trees.
 *
 * Mirrors `quill.skills.permissions` from the Python backend.
 */

import fs from "node:fs";
import path from "node:path";

function makeSkillPathSandboxReadable(targetPath: string): void {
  const stats = fs.lstatSync(targetPath);
  if (stats.isSymbolicLink()) {
    return;
  }
  const mode = stats.mode & 0o7777;
  const withoutSandboxWrite = mode & ~(0o020 | 0o002);
  if (stats.isDirectory()) {
    fs.chmodSync(targetPath, withoutSandboxWrite | 0o555);
  } else if (stats.isFile()) {
    fs.chmodSync(targetPath, withoutSandboxWrite | 0o444);
  }
}

/**
 * Recursively make a skill tree read-only from the sandbox perspective.
 */
export function makeSkillTreeSandboxReadable(target: string): void {
  makeSkillPathSandboxReadable(target);
  for (const entry of fs.readdirSync(target, { withFileTypes: true, recursive: true })) {
    makeSkillPathSandboxReadable(path.join(entry.parentPath, entry.name));
  }
}

/**
 * Make a path under a skill root sandbox-readable, including parent dirs up to
 * the root.
 */
export function makeSkillWrittenPathSandboxReadable(
  skillRoot: string,
  target: string
): void {
  const resolvedRoot = path.resolve(skillRoot);
  const resolvedTarget = path.resolve(target);
  // Ensures target is within root; throws otherwise.
  path.relative(resolvedRoot, resolvedTarget);

  makeSkillPathSandboxReadable(resolvedRoot);
  let current = resolvedRoot;
  const relativeParts = path.relative(resolvedRoot, path.dirname(resolvedTarget)).split(path.sep).filter(Boolean);
  for (const part of relativeParts) {
    current = path.join(current, part);
    makeSkillPathSandboxReadable(current);
  }
  makeSkillPathSandboxReadable(resolvedTarget);
}
