/**
 * Local (host-filesystem) sandbox backend — TypeScript port.
 *
 * Mirrors the LOCAL backend of `quill.sandbox.local.local_sandbox` and the
 * abstract `quill.sandbox.sandbox.Sandbox` interface. The agent works with
 * VIRTUAL paths under `VIRTUAL_PATH_PREFIX` ("/mnt/user-data") which map onto a
 * single per-thread host workspace directory.
 *
 * SCOPE: this is a simplified single-workspace mapping (the whole virtual
 * `/mnt/user-data` tree maps to one host workspace dir) rather than Python's
 * multi-mapping model (separate workspace/uploads/outputs + skills + custom
 * mounts). The container / aio_sandbox backends (which need Docker) are OUT OF
 * SCOPE and are intentionally not ported here.
 *
 * SECURITY: `resolvePath` rejects `..` traversal segments and any resolved path
 * that escapes the workspace root, throwing `SandboxPermissionError`. This is a
 * best-effort local guard, NOT a secure isolation boundary (see security.ts /
 * the host-bash gating note) — it keeps file/glob/grep tools scoped to the
 * workspace, but host bash, when explicitly enabled, can still reach the host.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { SKILLS_VIRTUAL_PATH_PREFIX, VIRTUAL_PATH_PREFIX } from "../config/paths.js";
import { SandboxPermissionError } from "./exceptions.js";

/** A single grep hit. Mirrors Python `quill.sandbox.search.GrepMatch`. */
export interface GrepMatch {
  path: string;
  line_number: number;
  line: string;
}

export interface ReadFileOptions {
  /** 1-based starting line (inclusive). */
  offset?: number;
  /** Maximum number of lines to return from `offset`. */
  limit?: number;
}

export interface GlobOptions {
  includeDirs?: boolean;
  maxResults?: number;
}

export interface GlobResult {
  paths: string[];
  truncated: boolean;
}

export interface GrepOptions {
  glob?: string | null;
  literal?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
}

export interface GrepResult {
  matches: GrepMatch[];
  truncated: boolean;
}

export type StrReplaceOutcome = "ok" | "not_found";

/** Command execution timeout (brief-mandated 120s). */
const EXECUTE_TIMEOUT_MS = 120_000;
/** Hard cap on captured command output to avoid unbounded memory growth. */
const MAX_COMMAND_OUTPUT_CHARS = 1_000_000;
/** Skip files larger than this during grep. Mirrors Python DEFAULT_MAX_FILE_SIZE_BYTES. */
const DEFAULT_MAX_FILE_SIZE_BYTES = 1_000_000;
/** Per-line summary length for grep results. Mirrors Python DEFAULT_LINE_SUMMARY_LENGTH. */
const DEFAULT_LINE_SUMMARY_LENGTH = 200;

/**
 * Directory / file names ignored by list_dir, glob and grep tree walks.
 * Ported verbatim from `quill.sandbox.search.IGNORE_PATTERNS`.
 */
const IGNORE_PATTERNS = [
  ".git", ".svn", ".hg", ".bzr", "node_modules", "__pycache__", ".venv", "venv",
  ".env", "env", ".tox", ".nox", ".eggs", "*.egg-info", "site-packages", "dist",
  "build", ".next", ".nuxt", ".output", ".turbo", "target", "out", ".idea",
  ".vscode", "*.swp", "*.swo", "*~", ".project", ".classpath", ".settings",
  ".DS_Store", "Thumbs.db", "desktop.ini", "*.lnk", "*.log", "*.tmp", "*.temp",
  "*.bak", "*.cache", ".cache", "logs", ".coverage", "coverage", ".nyc_output",
  "htmlcov", ".pytest_cache", ".mypy_cache", ".ruff_cache",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Translate a single filename glob (no path separators) into an anchored regex. */
function fnmatchName(pattern: string): RegExp {
  let re = "^";
  for (const c of pattern) {
    if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else re += escapeRegExp(c);
  }
  re += "$";
  return new RegExp(re);
}

const EXACT_IGNORE_NAMES = new Set(IGNORE_PATTERNS.filter((p) => !/[*?[]/.test(p)));
const GLOB_IGNORE_RES = IGNORE_PATTERNS.filter((p) => /[*?[]/.test(p)).map(fnmatchName);

function shouldIgnoreName(name: string): boolean {
  if (EXACT_IGNORE_NAMES.has(name)) return true;
  return GLOB_IGNORE_RES.some((re) => re.test(name));
}

/**
 * Translate a glob path pattern into a regex source.
 *
 * Handles the double-star directory wildcard as "zero or more directories",
 * a single star as "any run of non-separator chars", and `?` as one
 * non-separator char.
 *
 * NOTE: this is a pragmatic matcher, not a byte-for-byte reimplementation of
 * Python's `PurePosixPath.match`. It handles the common agent patterns
 * (recursive `.py` search, `*.txt`, `sub/*.md`). Character classes (`[abc]`)
 * are treated literally.
 */
function globToRegExpSource(pattern: string): string {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }
  return re;
}

/** Mirror of Python `path_matches`: full match plus right-anchored (match-from-the-right). */
function pathMatches(pattern: string, relPath: string): boolean {
  const core = globToRegExpSource(pattern);
  if (new RegExp("^" + core + "$").test(relPath)) return true;
  // pathlib matches a relative pattern from the right — allow leading dirs.
  if (new RegExp("(?:^|/)" + core + "$").test(relPath)) return true;
  return false;
}

function truncateLine(line: string, maxChars = DEFAULT_LINE_SUMMARY_LENGTH): string {
  const trimmed = line.replace(/[\r\n]+$/, "");
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars - 3) + "...";
}

function isBinaryFile(filePath: string, sampleSize = 8192): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(sampleSize);
    const read = fs.readSync(fd, buf, 0, sampleSize, 0);
    return buf.subarray(0, read).includes(0);
  } catch {
    return true;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function makeError(code: string, message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

/** Detect an available POSIX shell (or the Windows command processor). */
function detectShell(): string {
  if (process.platform === "win32") {
    return process.env.ComSpec || "cmd.exe";
  }
  for (const candidate of ["/bin/zsh", "/bin/bash", "/bin/sh"]) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return "sh";
}

export class LocalSandbox {
  readonly id: string;
  private readonly workspace: string;
  private readonly skillsRoot: string | undefined;
  /**
   * Files written via `writeFile`. Only agent-authored content is
   * reverse-resolved on read (mirrors Python `_agent_written_paths`).
   */
  private readonly agentWrittenPaths = new Set<string>();

  constructor(workspaceHostDir: string, id?: string, skillsRoot?: string) {
    this.workspace = path.resolve(workspaceHostDir);
    this.id = id ?? `local:${this.workspace}`;
    this.skillsRoot = skillsRoot ? path.resolve(skillsRoot) : undefined;
  }

  /** Host workspace root this sandbox is scoped to. */
  get workspaceDir(): string {
    return this.workspace;
  }

  // --- path virtualization ---------------------------------------------------

  /**
   * Resolve a VIRTUAL path ("/mnt/user-data/..." or "/mnt/skills/...") to a
   * host path. The user-data prefix maps to the per-thread workspace; the skills
   * prefix maps to the read-only skills root. Rejects `..` traversal and any
   * path escaping the mapped root.
   */
  private resolvePath(virtualPath: string): string {
    const normalized = virtualPath.replace(/\\/g, "/");

    // Handle /mnt/skills prefix (read-only skills mount).
    const skillsPrefix = SKILLS_VIRTUAL_PATH_PREFIX;
    if (normalized === skillsPrefix || normalized.startsWith(skillsPrefix + "/")) {
      if (!this.skillsRoot) {
        throw new SandboxPermissionError(
          "Skills directory is not mounted in this sandbox",
          virtualPath,
        );
      }
      const relative = normalized === skillsPrefix ? "" : normalized.slice(skillsPrefix.length + 1);
      for (const segment of relative.split("/")) {
        if (segment === "..") {
          throw new SandboxPermissionError(
            "Access denied: path traversal detected",
            virtualPath,
          );
        }
      }
      const resolved = path.resolve(this.skillsRoot, relative);
      const rel = path.relative(this.skillsRoot, resolved);
      if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
        throw new SandboxPermissionError(
          "Access denied: path escapes the skills directory",
          virtualPath,
        );
      }
      return resolved;
    }

    const prefix = VIRTUAL_PATH_PREFIX;

    let relative: string;
    if (normalized === prefix) {
      relative = "";
    } else if (normalized.startsWith(prefix + "/")) {
      relative = normalized.slice(prefix.length + 1);
    } else if (normalized.startsWith("/")) {
      // Absolute path outside the virtual prefix — deny.
      throw new SandboxPermissionError(
        `Access denied: path must be under '${VIRTUAL_PATH_PREFIX}' or '${skillsPrefix}'`,
        virtualPath,
      );
    } else {
      // Relative path — treat as relative to the workspace root.
      relative = normalized.replace(/^\/+/, "");
    }

    // Reject explicit traversal segments before touching the filesystem.
    for (const segment of relative.split("/")) {
      if (segment === "..") {
        throw new SandboxPermissionError(
          "Access denied: path traversal detected",
          virtualPath,
        );
      }
    }

    const resolved = path.resolve(this.workspace, relative);
    const rel = path.relative(this.workspace, resolved);
    if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
      throw new SandboxPermissionError(
        "Access denied: path escapes the workspace",
        virtualPath,
      );
    }
    return resolved;
  }

  /** Reverse-resolve a host path inside a mapped root back to a VIRTUAL path. */
  private reverseResolvePath(hostPath: string): string {
    const resolved = path.resolve(hostPath.replace(/\\/g, "/"));
    if (this.skillsRoot) {
      const skillsResolved = path.resolve(this.skillsRoot);
      if (resolved === skillsResolved) return SKILLS_VIRTUAL_PATH_PREFIX;
      const skillsRel = path.relative(skillsResolved, resolved);
      if (skillsRel && skillsRel !== ".." && !skillsRel.startsWith(".." + path.sep) && !path.isAbsolute(skillsRel)) {
        return `${SKILLS_VIRTUAL_PATH_PREFIX}/${skillsRel.split(path.sep).join("/")}`;
      }
    }
    if (resolved === this.workspace) return VIRTUAL_PATH_PREFIX;
    const rel = path.relative(this.workspace, resolved);
    if (rel && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel)) {
      return `${VIRTUAL_PATH_PREFIX}/${rel.split(path.sep).join("/")}`;
    }
    return hostPath;
  }

  /** Replace host workspace paths with their virtual equivalents in command output. */
  private reverseResolvePathsInOutput(output: string): string {
    const escaped = escapeRegExp(this.workspace);
    const re = new RegExp(escaped + "(?:[/\\\\][^\\s\"';&|<>()]*)?", "g");
    return output.replace(re, (match) => this.reverseResolvePath(match));
  }

  /** Replace virtual path prefixes with host paths in a command string. */
  private resolvePathsInCommand(command: string): string {
    const escaped = escapeRegExp(VIRTUAL_PATH_PREFIX);
    const re = new RegExp(escaped + "(?=/|$|[\\s\"';&|<>()])(?:/[^\\s\"';&|<>()]*)?", "g");
    return command.replace(re, (match) => {
      try {
        return this.resolvePath(match);
      } catch {
        return match;
      }
    });
  }

  /** Replace virtual path prefixes with host paths in file content (forward slashes). */
  private resolvePathsInContent(content: string): string {
    const escaped = escapeRegExp(VIRTUAL_PATH_PREFIX);
    const re = new RegExp(escaped + "(?=/|$|[^\\w./-])(?:/[^\\s\"';&|<>()]*)?", "g");
    return content.replace(re, (match) => {
      try {
        return this.resolvePath(match).replace(/\\/g, "/");
      } catch {
        return match;
      }
    });
  }

  // --- command execution -----------------------------------------------------

  /**
   * Execute a shell command with cwd = workspace and a 120s timeout. Virtual
   * paths in the command are forward-resolved to host paths; host paths in the
   * output are reverse-resolved back to virtual paths.
   */
  executeCommand(command: string): Promise<string> {
    const resolvedCommand = this.resolvePathsInCommand(command);
    const shell = detectShell();
    const args = process.platform === "win32" ? ["/c", resolvedCommand] : ["-c", resolvedCommand];

    return new Promise<string>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const child = spawn(shell, args, { cwd: this.workspace });

      const cap = (target: string, chunk: string): string => {
        if (target.length >= MAX_COMMAND_OUTPUT_CHARS) return target;
        const remaining = MAX_COMMAND_OUTPUT_CHARS - target.length;
        return chunk.length > remaining ? target + chunk.slice(0, remaining) : target + chunk;
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, EXECUTE_TIMEOUT_MS);

      child.stdout?.on("data", (d: Buffer) => {
        stdout = cap(stdout, d.toString("utf-8"));
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr = cap(stderr, d.toString("utf-8"));
      });

      const finish = (value: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(this.reverseResolvePathsInOutput(value));
      };

      child.on("error", (err: Error) => {
        finish(`Std Error:\n${err.message}\nExit Code: 1`);
      });

      child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
        let output = stdout;
        if (stderr) {
          output += output ? `\nStd Error:\n${stderr}` : stderr;
        }
        const returnCode = code === null ? (signal ? 1 : 0) : code;
        if (returnCode !== 0) {
          output += `\nExit Code: ${returnCode}`;
        }
        if (timedOut) {
          output += `\nError: command timed out after ${EXECUTE_TIMEOUT_MS / 1000}s`;
        }
        finish(output ? output : "(no output)");
      });
    });
  }

  // --- file operations -------------------------------------------------------

  readFile(virtualPath: string, options?: ReadFileOptions): string {
    const host = this.resolvePath(virtualPath);
    let content = fs.readFileSync(host, "utf-8");
    if (this.agentWrittenPaths.has(host)) {
      content = this.reverseResolvePathsInOutput(content);
    }
    if (options && (options.offset !== undefined || options.limit !== undefined)) {
      const lines = content.split("\n");
      const start = Math.max(0, (options.offset ?? 1) - 1);
      const end = options.limit !== undefined ? start + options.limit : undefined;
      content = lines.slice(start, end).join("\n");
    }
    return content;
  }

  /** Read a file as a raw Buffer (for binary files such as images). */
  readFileBinary(virtualPath: string): Buffer {
    const host = this.resolvePath(virtualPath);
    return fs.readFileSync(host);
  }

  writeFile(virtualPath: string, content: string, append = false): void {
    const normalized = virtualPath.replace(/\\/g, "/");
    if (normalized === SKILLS_VIRTUAL_PATH_PREFIX || normalized.startsWith(SKILLS_VIRTUAL_PATH_PREFIX + "/")) {
      throw new SandboxPermissionError(
        "Skills directory is read-only",
        virtualPath,
      );
    }
    const host = this.resolvePath(virtualPath);
    const dir = path.dirname(host);
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const resolvedContent = this.resolvePathsInContent(content);
    if (append) {
      fs.appendFileSync(host, resolvedContent, "utf-8");
    } else {
      fs.writeFileSync(host, resolvedContent, "utf-8");
    }
    this.agentWrittenPaths.add(host);
  }

  /**
   * Replace a substring in a file. Returns "not_found" when `oldStr` is absent
   * (and the file is non-empty); "ok" otherwise. Read/replace/write mirrors the
   * Python `str_replace` tool body.
   */
  strReplace(virtualPath: string, oldStr: string, newStr: string, replaceAll = false): StrReplaceOutcome {
    const content = this.readFile(virtualPath);
    if (!content) return "ok";
    if (!content.includes(oldStr)) return "not_found";
    let updated: string;
    if (replaceAll) {
      updated = content.split(oldStr).join(newStr);
    } else {
      const idx = content.indexOf(oldStr);
      updated = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
    }
    this.writeFile(virtualPath, updated, false);
    return "ok";
  }

  listDir(virtualPath: string, maxDepth = 2): string[] {
    const root = this.resolvePath(virtualPath);
    const entries = this.listDirHost(root, maxDepth);
    return entries.map((entry) => {
      const isDir = entry.endsWith("/") || entry.endsWith("\\");
      const clean = isDir ? entry.replace(/[/\\]+$/, "") : entry;
      const reversed = this.reverseResolvePath(clean);
      return isDir && !reversed.endsWith("/") ? `${reversed}/` : reversed;
    });
  }

  private listDirHost(root: string, maxDepth: number): string[] {
    const rootResolved = path.resolve(root);
    let rootStat: fs.Stats;
    try {
      rootStat = fs.statSync(rootResolved);
    } catch {
      return [];
    }
    if (!rootStat.isDirectory()) return [];

    const result: string[] = [];
    const isWithinRoot = (candidate: string): boolean => {
      const rel = path.relative(rootResolved, candidate);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    };

    const traverse = (currentPath: string, currentDepth: number): void => {
      if (currentDepth > maxDepth) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentPath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (shouldIgnoreName(entry.name)) continue;
        const itemPath = path.join(currentPath, entry.name);

        if (entry.isSymbolicLink()) {
          let resolvedLink: string;
          try {
            resolvedLink = fs.realpathSync(itemPath);
          } catch {
            continue;
          }
          if (!isWithinRoot(resolvedLink)) continue;
          let linkIsDir = false;
          try {
            linkIsDir = fs.statSync(resolvedLink).isDirectory();
          } catch {
            linkIsDir = false;
          }
          result.push(linkIsDir ? `${resolvedLink}/` : resolvedLink);
          continue;
        }

        if (!isWithinRoot(itemPath)) continue;
        const isDir = entry.isDirectory();
        result.push(isDir ? `${itemPath}/` : itemPath);
        if (isDir && currentDepth < maxDepth) {
          traverse(itemPath, currentDepth + 1);
        }
      }
    };

    traverse(rootResolved, 1);
    return result.sort();
  }

  glob(virtualPath: string, pattern: string, options: GlobOptions = {}): GlobResult {
    const includeDirs = options.includeDirs ?? false;
    const maxResults = options.maxResults ?? 200;
    const root = this.resolvePath(virtualPath);
    const { matches, truncated } = this.findGlobMatches(root, pattern, includeDirs, maxResults);
    return { paths: matches.map((m) => this.reverseResolvePath(m)), truncated };
  }

  private findGlobMatches(
    root: string,
    pattern: string,
    includeDirs: boolean,
    maxResults: number,
  ): { matches: string[]; truncated: boolean } {
    const rootResolved = path.resolve(root);
    if (!fs.existsSync(rootResolved)) {
      throw makeError("ENOENT", `Directory not found: ${rootResolved}`);
    }
    if (!fs.statSync(rootResolved).isDirectory()) {
      throw makeError("ENOTDIR", `Not a directory: ${rootResolved}`);
    }

    const matches: string[] = [];
    let truncated = false;

    const walk = (dir: string, relDir: string): boolean => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return false;
      }
      const dirNames: string[] = [];
      const fileNames: string[] = [];
      for (const entry of entries) {
        if (shouldIgnoreName(entry.name)) continue;
        if (entry.isDirectory()) dirNames.push(entry.name);
        else fileNames.push(entry.name);
      }

      if (includeDirs) {
        for (const name of dirNames) {
          const rel = relDir ? `${relDir}/${name}` : name;
          if (pathMatches(pattern, rel)) {
            matches.push(path.join(dir, name));
            if (matches.length >= maxResults) {
              truncated = true;
              return true;
            }
          }
        }
      }

      for (const name of fileNames) {
        const rel = relDir ? `${relDir}/${name}` : name;
        if (pathMatches(pattern, rel)) {
          matches.push(path.join(dir, name));
          if (matches.length >= maxResults) {
            truncated = true;
            return true;
          }
        }
      }

      for (const name of dirNames) {
        const rel = relDir ? `${relDir}/${name}` : name;
        if (walk(path.join(dir, name), rel)) return true;
      }
      return false;
    };

    walk(rootResolved, "");
    return { matches, truncated };
  }

  grep(pattern: string, virtualPath: string, options: GrepOptions = {}): GrepResult {
    const root = this.resolvePath(virtualPath);
    const { matches, truncated } = this.findGrepMatches(root, pattern, options);
    return {
      matches: matches.map((m) => ({ ...m, path: this.reverseResolvePath(m.path) })),
      truncated,
    };
  }

  private findGrepMatches(
    root: string,
    pattern: string,
    options: GrepOptions,
  ): { matches: GrepMatch[]; truncated: boolean } {
    const rootResolved = path.resolve(root);
    if (!fs.existsSync(rootResolved)) {
      throw makeError("ENOENT", `Directory not found: ${rootResolved}`);
    }
    if (!fs.statSync(rootResolved).isDirectory()) {
      throw makeError("ENOTDIR", `Not a directory: ${rootResolved}`);
    }

    const globPattern = options.glob ?? null;
    const maxResults = options.maxResults ?? 100;
    const source = options.literal ? escapeRegExp(pattern) : pattern;
    // May throw SyntaxError for an invalid regex — surfaced to the grep tool.
    const regex = new RegExp(source, options.caseSensitive ? "" : "i");
    const maxLineChars = DEFAULT_LINE_SUMMARY_LENGTH * 10;

    const matches: GrepMatch[] = [];
    let truncated = false;

    const walk = (dir: string, relDir: string): boolean => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return false;
      }
      const dirNames: string[] = [];
      const fileNames: string[] = [];
      for (const entry of entries) {
        if (shouldIgnoreName(entry.name)) continue;
        if (entry.isDirectory()) dirNames.push(entry.name);
        else fileNames.push(entry.name);
      }

      for (const name of fileNames) {
        const rel = relDir ? `${relDir}/${name}` : name;
        if (globPattern !== null && !pathMatches(globPattern, rel)) continue;
        const fullPath = path.join(dir, name);
        try {
          if (fs.lstatSync(fullPath).isSymbolicLink()) continue;
          const stat = fs.statSync(fullPath);
          if (stat.size > DEFAULT_MAX_FILE_SIZE_BYTES || isBinaryFile(fullPath)) continue;
          const data = fs.readFileSync(fullPath, "utf-8");
          const lines = data.split("\n");
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.length > maxLineChars) continue;
            if (regex.test(line)) {
              matches.push({
                path: fullPath,
                line_number: i + 1,
                line: truncateLine(line),
              });
              if (matches.length >= maxResults) {
                truncated = true;
                return true;
              }
            }
          }
        } catch {
          continue;
        }
      }

      for (const name of dirNames) {
        const rel = relDir ? `${relDir}/${name}` : name;
        if (walk(path.join(dir, name), rel)) return true;
      }
      return false;
    };

    walk(rootResolved, "");
    return { matches, truncated };
  }
}
