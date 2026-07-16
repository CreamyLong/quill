/**
 * Shared upload management logic.
 *
 * Mirrors `quill.uploads.manager` from the Python backend. Pure business
 * logic — no HTTP dependencies.
 */

import fs from "node:fs";
import path from "node:path";

import { VIRTUAL_PATH_PREFIX, getPaths } from "../config/paths.js";

export { VIRTUAL_PATH_PREFIX };
import { getEffectiveUserId } from "../runtime/user_context.js";

/** Raised when a path escapes its allowed base directory. */
export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathTraversalError";
  }
}

/** Raised when an upload destination is not a safe regular file path. */
export class UnsafeUploadPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUploadPathError";
  }
}

// thread_id must be alphanumeric, hyphens, underscores, or dots only.
const SAFE_THREAD_ID = /^[a-zA-Z0-9._-]+$/;

/** Reject thread IDs containing characters unsafe for filesystem paths. */
export function validateThreadId(threadId: string): void {
  if (!threadId || !SAFE_THREAD_ID.test(threadId)) {
    throw new Error(`Invalid thread_id: ${JSON.stringify(threadId)}`);
  }
}

/** Return the uploads directory path for a thread (no side effects). */
export function getUploadsDir(threadId: string, userId: string | null = null): string {
  validateThreadId(threadId);
  return getPaths().sandboxUploadsDir(threadId, userId || getEffectiveUserId());
}

/** Return the uploads directory for a thread, creating it if needed. */
export function ensureUploadsDir(threadId: string, userId: string | null = null): string {
  const base = getUploadsDir(threadId, userId);
  fs.mkdirSync(base, { recursive: true });
  return base;
}

/**
 * Sanitize a filename by extracting its basename.
 *
 * @throws Error If filename is empty or resolves to a traversal pattern.
 */
export function normalizeFilename(filename: string): string {
  if (!filename) {
    throw new Error("Filename is empty");
  }
  const safe = path.basename(filename);
  if (!safe || safe === "." || safe === "..") {
    throw new Error(`Filename is unsafe: ${JSON.stringify(filename)}`);
  }
  // Reject backslashes — on Linux Path.name keeps them as literal chars, but
  // they indicate a Windows-style path that should be stripped or rejected.
  if (safe.includes("\\")) {
    throw new Error(`Filename contains backslash: ${JSON.stringify(filename)}`);
  }
  if (Buffer.byteLength(safe, "utf-8") > 255) {
    throw new Error(`Filename too long: ${safe.length} chars`);
  }
  return safe;
}

/**
 * Generate a unique filename by appending `_N` suffix on collision.
 *
 * Automatically adds the returned name to `seen`.
 */
export function claimUniqueFilename(name: string, seen: Set<string>): string {
  if (!seen.has(name)) {
    seen.add(name);
    return name;
  }
  const suffix = path.extname(name);
  const stem = path.basename(name, suffix);
  let counter = 1;
  let candidate = `${stem}_${counter}${suffix}`;
  while (seen.has(candidate)) {
    counter += 1;
    candidate = `${stem}_${counter}${suffix}`;
  }
  seen.add(candidate);
  return candidate;
}

/**
 * Verify that `p` is inside `base`.
 *
 * @throws PathTraversalError If a path traversal is detected.
 */
export function validatePathTraversal(p: string, base: string): void {
  const resolved = path.resolve(p);
  const resolvedBase = path.resolve(base);
  const rel = path.relative(resolvedBase, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PathTraversalError("Path traversal detected");
  }
}

const UNSAFE_OPEN_CODES = new Set(["ELOOP", "EISDIR", "ENOTDIR", "ENXIO", "EAGAIN"]);
const UNSAFE_OPEN_CODES_WINDOWS = new Set(["EISDIR", "ENOTDIR", "ENXIO", "EAGAIN"]);

/**
 * Open an upload destination for safe streaming writes.
 *
 * Rejects symlink destinations using `O_NOFOLLOW` on POSIX. On Windows (which
 * lacks `O_NOFOLLOW`) it uses dual `lstat` checks and `fstat` validation after
 * `open()` to reduce the TOCTOU window. Returns `[dest, fd]`; the caller owns
 * closing the file descriptor.
 */
export function openUploadFileNoSymlink(baseDir: string, filename: string): [string, number] {
  const safeName = normalizeFilename(filename);
  const dest = path.join(baseDir, safeName);

  let st: fs.Stats | null;
  try {
    st = fs.lstatSync(dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      st = null;
    } else {
      throw e;
    }
  }

  if (st !== null && !st.isFile()) {
    throw new UnsafeUploadPathError(`Upload destination is not a regular file: ${safeName}`);
  }

  validatePathTraversal(dest, baseDir);

  const hasNoFollow = "O_NOFOLLOW" in fs.constants;

  if (hasNoFollow) {
    // POSIX: O_NOFOLLOW makes open() fail with ELOOP if dest is a symlink.
    let flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW;
    if ("O_NONBLOCK" in fs.constants) {
      flags |= fs.constants.O_NONBLOCK;
    }

    let fd: number;
    try {
      fd = fs.openSync(dest, flags, 0o600);
    } catch (exc) {
      if (UNSAFE_OPEN_CODES.has((exc as NodeJS.ErrnoException).code ?? "")) {
        throw new UnsafeUploadPathError(`Unsafe upload destination: ${safeName}`);
      }
      throw exc;
    }

    let shouldClose = true;
    try {
      const openedStat = fs.fstatSync(fd);
      if (!openedStat.isFile() || openedStat.nlink !== 1) {
        throw new UnsafeUploadPathError(`Upload destination is not an exclusive regular file: ${safeName}`);
      }
      fs.ftruncateSync(fd, 0);
      shouldClose = false;
      return [dest, fd];
    } finally {
      if (shouldClose) {
        fs.closeSync(fd);
      }
    }
  }

  // Windows: no O_NOFOLLOW available. Uses a second lstat immediately before
  // open() to narrow the TOCTOU window, then fstat after open() as a defence.
  if (st !== null && st.nlink > 1) {
    throw new UnsafeUploadPathError(`Upload destination has multiple links: ${safeName}`);
  }

  let flags = fs.constants.O_WRONLY | fs.constants.O_CREAT;
  if ("O_BINARY" in fs.constants) {
    flags |= (fs.constants as unknown as { O_BINARY: number }).O_BINARY;
  }

  let preOpenSt: fs.Stats | null;
  try {
    preOpenSt = fs.lstatSync(dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      preOpenSt = null;
    } else {
      throw e;
    }
  }

  if (preOpenSt !== null && !preOpenSt.isFile()) {
    throw new UnsafeUploadPathError(`Upload destination is not a regular file: ${safeName}`);
  }
  if (preOpenSt !== null && preOpenSt.nlink > 1) {
    throw new UnsafeUploadPathError(`Upload destination has multiple links: ${safeName}`);
  }

  let fd: number;
  try {
    fd = fs.openSync(dest, flags, 0o600);
  } catch (exc) {
    if (UNSAFE_OPEN_CODES_WINDOWS.has((exc as NodeJS.ErrnoException).code ?? "")) {
      throw new UnsafeUploadPathError(`Unsafe upload destination: ${safeName}`);
    }
    throw exc;
  }

  let shouldClose = true;
  try {
    const openedStat = fs.fstatSync(fd);
    if (!openedStat.isFile() || openedStat.nlink > 1) {
      throw new UnsafeUploadPathError(`Upload destination is not an exclusive regular file: ${safeName}`);
    }
    fs.ftruncateSync(fd, 0);
    shouldClose = false;
    return [dest, fd];
  } finally {
    if (shouldClose) {
      fs.closeSync(fd);
    }
  }
}

/** Write upload bytes without following a pre-existing destination symlink. */
export function writeUploadFileNoSymlink(baseDir: string, filename: string, data: Buffer | Uint8Array): string {
  const [dest, fd] = openUploadFileNoSymlink(baseDir, filename);
  try {
    fs.writeSync(fd, data);
  } finally {
    fs.closeSync(fd);
  }
  return dest;
}

export interface UploadFileEntry {
  filename: string;
  size: number;
  path: string;
  extension: string;
  modified: number;
  virtual_path?: string;
  artifact_url?: string;
}

export interface FileListing {
  files: UploadFileEntry[];
  count: number;
}

/**
 * List files (not directories) in `directory`.
 *
 * Each file entry has `size` as an int (bytes). Call `enrichFileListing` to add
 * virtual / artifact URLs.
 */
export function listFilesInDir(directory: string): FileListing {
  let stat: fs.Stats | null;
  try {
    stat = fs.statSync(directory);
  } catch {
    stat = null;
  }
  if (stat === null || !stat.isDirectory()) {
    return { files: [], count: 0 };
  }

  const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const files: UploadFileEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    const st = fs.lstatSync(fullPath);
    files.push({
      filename: entry.name,
      size: st.size,
      path: fullPath,
      extension: path.extname(entry.name),
      modified: st.mtimeMs / 1000,
    });
  }
  return { files, count: files.length };
}

/**
 * Delete a file inside `baseDir` after path-traversal validation.
 *
 * If `convertibleExtensions` is provided and the file's extension matches, the
 * companion `.md` file is also removed (if it exists).
 *
 * @throws Error If the file does not exist.
 * @throws PathTraversalError If path traversal is detected.
 */
export function deleteFileSafe(baseDir: string, filename: string, convertibleExtensions: Set<string> | null = null): { success: boolean; message: string } {
  const filePath = path.resolve(path.join(baseDir, filename));
  validatePathTraversal(filePath, baseDir);

  let stat: fs.Stats | null;
  try {
    stat = fs.statSync(filePath);
  } catch {
    stat = null;
  }
  if (stat === null || !stat.isFile()) {
    throw new Error(`File not found: ${filename}`);
  }

  fs.unlinkSync(filePath);

  // Clean up companion markdown generated during upload conversion.
  if (convertibleExtensions && convertibleExtensions.has(path.extname(filePath).toLowerCase())) {
    const companion = path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}.md`);
    try {
      fs.unlinkSync(companion);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        throw e;
      }
    }
  }

  return { success: true, message: `Deleted ${filename}` };
}

/** Percent-encode a component the way Python's `urllib.parse.quote(safe="")` does. */
function quoteAll(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Build the artifact URL for a file in a thread's uploads directory. */
export function uploadArtifactUrl(threadId: string, filename: string): string {
  return `/api/threads/${threadId}/artifacts${VIRTUAL_PATH_PREFIX}/uploads/${quoteAll(filename)}`;
}

/** Build the virtual path for a file in the uploads directory. */
export function uploadVirtualPath(filename: string): string {
  return `${VIRTUAL_PATH_PREFIX}/uploads/${filename}`;
}

/**
 * Add virtual paths and artifact URLs on a listing result.
 *
 * Mutates `result` in place and returns it for convenience.
 */
export function enrichFileListing(result: FileListing, threadId: string): FileListing {
  for (const f of result.files) {
    const filename = f.filename;
    f.virtual_path = uploadVirtualPath(filename);
    f.artifact_url = uploadArtifactUrl(threadId, filename);
  }
  return result;
}
