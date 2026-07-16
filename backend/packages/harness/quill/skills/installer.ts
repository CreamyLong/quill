/**
 * Shared skill archive installation logic.
 *
 * Mirrors `quill.skills.installer` from the Python backend. Pure business
 * logic — no HTTP dependencies.
 *
 * NOTE: Python's `zipfile` module has no bundled TypeScript analogue and no zip
 * library is installed in this package. The ZIP-reading surface is modelled by
 * the minimal `ZipInfo` / `ZipFileLike` interfaces below; a future caller must
 * provide a concrete implementation (e.g. backed by `adm-zip`/`yauzl`). All
 * archive-handling *logic* is ported faithfully against those interfaces.
 */

import fs from "node:fs";
import path from "node:path";

import { makeSkillTreeSandboxReadable } from "./permissions.js";
import { scanSkillContent } from "./security_scanner.js";

const PROMPT_INPUT_DIRS = new Set(["references", "templates"]);
const PROMPT_INPUT_SUFFIXES = new Set([".json", ".markdown", ".md", ".rst", ".txt", ".yaml", ".yml"]);

/** Raised when a skill with the same name is already installed. */
export class SkillAlreadyExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillAlreadyExistsError";
  }
}

/** Raised when a skill archive fails security scanning. */
export class SkillSecurityScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillSecurityScanError";
  }
}

// ---------------------------------------------------------------------------
// Unported dependency stub: Python zipfile.ZipInfo / zipfile.ZipFile
// ---------------------------------------------------------------------------
export interface ZipInfo {
  /** Member name (may use "/" or "\\" separators). */
  filename: string;
  /** External attributes (high 16 bits carry the POSIX mode). */
  externalAttr: number;
  /** True when the member is a directory. */
  isDir(): boolean;
}

export interface ZipFileLike {
  /** Return all members. */
  infolist(): ZipInfo[];
  /** Read a member's full uncompressed bytes. */
  readMember(info: ZipInfo): Buffer;
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** Return True if the zip member path is absolute or attempts directory traversal. */
export function isUnsafeZipMember(info: ZipInfo): boolean {
  const name = info.filename;
  if (!name) {
    return false;
  }
  const normalized = name.replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    return true;
  }
  // Windows-absolute: drive-rooted (C:\ or C:/) or UNC (\\host\share).
  if (/^[A-Za-z]:[\\/]/.test(name) || name.startsWith("\\\\")) {
    return true;
  }
  const parts = normalized.split("/");
  if (parts.includes("..")) {
    return true;
  }
  return false;
}

/** Detect symlinks based on the external attributes stored in the ZipInfo. */
export function isSymlinkMember(info: ZipInfo): boolean {
  const mode = info.externalAttr >>> 16;
  return (mode & S_IFMT) === S_IFLNK;
}

/** Return True for macOS metadata dirs and dotfiles. */
export function shouldIgnoreArchiveEntry(name: string): boolean {
  return name.startsWith(".") || name === "__MACOSX";
}

/**
 * Locate the skill root directory from extracted archive contents.
 *
 * Filters out macOS metadata (__MACOSX) and dotfiles (.DS_Store).
 *
 * @throws Error If the archive is empty after filtering.
 */
export function resolveSkillDirFromArchive(tempPath: string): string {
  const entries = fs.readdirSync(tempPath, { withFileTypes: true }).filter((entry) => !shouldIgnoreArchiveEntry(entry.name));
  if (entries.length === 0) {
    throw new Error("Skill archive is empty");
  }
  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(tempPath, entries[0].name);
  }
  return tempPath;
}

/**
 * Safely extract a skill archive with security protections.
 *
 * Protections:
 * - Reject absolute paths and directory traversal (..).
 * - Skip symlink entries instead of materialising them.
 * - Enforce a hard limit on total uncompressed size (zip bomb defence).
 *
 * @throws Error If unsafe members or size limit exceeded.
 */
export function safeExtractSkillArchive(zipRef: ZipFileLike, destPath: string, maxTotalSize: number = 512 * 1024 * 1024): void {
  const destRoot = path.resolve(destPath);
  let totalWritten = 0;

  for (const info of zipRef.infolist()) {
    if (isUnsafeZipMember(info)) {
      throw new Error(`Archive contains unsafe member path: ${JSON.stringify(info.filename)}`);
    }

    if (isSymlinkMember(info)) {
      console.warn(`Skipping symlink entry in skill archive: ${info.filename}`);
      continue;
    }

    const normalizedName = info.filename.replace(/\\/g, "/");
    const parts = normalizedName.split("/").filter((part) => part !== "" && part !== ".");
    const memberPath = path.join(destRoot, ...parts);
    const rel = path.relative(destRoot, path.resolve(memberPath));
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Zip entry escapes destination: ${JSON.stringify(info.filename)}`);
    }
    fs.mkdirSync(path.dirname(memberPath), { recursive: true });

    if (info.isDir()) {
      fs.mkdirSync(memberPath, { recursive: true });
      continue;
    }

    const buffer = zipRef.readMember(info);
    const fd = fs.openSync(memberPath, "w");
    try {
      for (let offset = 0; offset < buffer.length; offset += 65536) {
        const chunk = buffer.subarray(offset, Math.min(offset + 65536, buffer.length));
        totalWritten += chunk.length;
        if (totalWritten > maxTotalSize) {
          throw new Error("Skill archive is too large or appears highly compressed.");
        }
        fs.writeSync(fd, chunk);
      }
    } finally {
      fs.closeSync(fd);
    }
  }
}

function isScriptSupportFile(relPath: string): boolean {
  const parts = relPath.split("/").filter(Boolean);
  return parts.length > 0 && parts[0] === "scripts";
}

function shouldScanSupportFile(relPath: string): boolean {
  if (isScriptSupportFile(relPath)) {
    return true;
  }
  const parts = relPath.split("/").filter(Boolean);
  const suffix = path.extname(relPath).toLowerCase();
  return parts.length > 0 && PROMPT_INPUT_DIRS.has(parts[0]) && PROMPT_INPUT_SUFFIXES.has(suffix);
}

/** Stage-and-move a validated skill into a freshly reserved target directory. */
export function moveStagedSkillIntoReservedTarget(stagingTarget: string, target: string): void {
  let installed = false;
  let reserved = false;
  try {
    try {
      fs.mkdirSync(target, { mode: 0o700 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") {
        throw new SkillAlreadyExistsError(`Skill '${path.basename(target)}' already exists`);
      }
      throw e;
    }
    reserved = true;
    for (const child of fs.readdirSync(stagingTarget)) {
      fs.renameSync(path.join(stagingTarget, child), path.join(target, child));
    }
    makeSkillTreeSandboxReadable(target);
    installed = true;
  } finally {
    if (reserved && !installed && fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
}

/** Decode a file as strict UTF-8, mirroring Python's read_text(encoding="utf-8"). */
function readTextUtf8Strict(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}

async function scanSkillFileOrRaise(skillDir: string, filePath: string, skillName: string, executable: boolean): Promise<void> {
  const relPath = path.relative(skillDir, filePath).split(path.sep).join("/");
  const location = `${skillName}/${relPath}`;

  let content: string;
  try {
    content = readTextUtf8Strict(filePath);
  } catch (e) {
    if (e instanceof TypeError || (e as Error).name === "TypeError") {
      throw new SkillSecurityScanError(`Security scan failed for skill '${skillName}': ${location} must be valid UTF-8`);
    }
    throw e;
  }

  let result: { decision?: unknown; reason?: unknown };
  try {
    result = await scanSkillContent(content, { executable, location });
  } catch (e) {
    throw new SkillSecurityScanError(`Security scan failed for ${location}: ${String(e)}`);
  }

  const decision = result.decision ?? null;
  const reason = String(result.reason || "No reason provided.");
  if (decision === "block") {
    if (relPath === "SKILL.md") {
      throw new SkillSecurityScanError(`Security scan blocked skill '${skillName}': ${reason}`);
    }
    throw new SkillSecurityScanError(`Security scan blocked ${location}: ${reason}`);
  }
  if (executable && decision !== "allow") {
    throw new SkillSecurityScanError(`Security scan rejected executable ${location}: ${reason}`);
  }
  if (decision !== "allow" && decision !== "warn") {
    throw new SkillSecurityScanError(`Security scan failed for ${location}: invalid scanner decision ${JSON.stringify(decision)}`);
  }
}

/** Enumerate archive files for scanning (sorted, files only). */
function collectScannableFiles(skillDir: string): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  };
  walk(skillDir);
  results.sort();
  return results;
}

/** Run the skill security scanner against all installable text and script files. */
export async function scanSkillArchiveContentsOrRaise(skillDir: string, skillName: string): Promise<void> {
  const skillMd = path.join(skillDir, "SKILL.md");
  await scanSkillFileOrRaise(skillDir, skillMd, skillName, false);

  for (const filePath of collectScannableFiles(skillDir)) {
    const relPath = path.relative(skillDir, filePath).split(path.sep).join("/");
    if (relPath === "SKILL.md") {
      continue;
    }
    if (path.basename(filePath) === "SKILL.md") {
      throw new SkillSecurityScanError(
        `Security scan failed for skill '${skillName}': nested SKILL.md is not allowed at ${skillName}/${relPath}`
      );
    }
    if (!shouldScanSupportFile(relPath)) {
      continue;
    }

    await scanSkillFileOrRaise(skillDir, filePath, skillName, isScriptSupportFile(relPath));
  }
}

/**
 * Run an install coroutine to completion.
 *
 * Python juggles the running/threaded asyncio event loop here; in the async
 * TypeScript runtime the caller simply awaits the returned promise.
 */
export function runAsyncInstall<T>(coro: Promise<T>): Promise<T> {
  return coro;
}
