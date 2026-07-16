/**
 * Runtime path resolution for standalone harness usage.
 */

import path from "node:path";
import fs from "node:fs";

/**
 * Return the caller project root for runtime-owned files.
 */
export function projectRoot(): string {
  const envRoot = process.env.QUILL_PROJECT_ROOT;
  if (envRoot) {
    const root = path.resolve(envRoot);
    if (!fs.existsSync(root)) {
      throw new Error(
        `QUILL_PROJECT_ROOT is set to '${envRoot}', but the resolved path '${root}' does not exist.`
      );
    }
    if (!fs.statSync(root).isDirectory()) {
      throw new Error(
        `QUILL_PROJECT_ROOT is set to '${envRoot}', but the resolved path '${root}' is not a directory.`
      );
    }
    return root;
  }
  return process.cwd();
}

/**
 * Return the writable Quill state directory.
 */
export function runtimeHome(): string {
  const envHome = process.env.QUILL_HOME;
  if (envHome) {
    return path.resolve(envHome);
  }
  return path.join(projectRoot(), ".scitops");
}

/**
 * Resolve absolute paths as-is and relative paths against the project root.
 */
export function resolvePath(value: string, base?: string): string {
  const p = path.normalize(value);
  if (path.isAbsolute(p)) {
    return path.resolve(p);
  }
  return path.resolve(base ?? projectRoot(), p);
}

/**
 * Return the first existing named file under the project root.
 */
export function existingProjectFile(names: readonly string[]): string | null {
  const root = projectRoot();
  for (const name of names) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}
