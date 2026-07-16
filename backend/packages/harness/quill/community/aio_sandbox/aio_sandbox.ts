/**
 * Sandbox implementation using the agent-infra/sandbox Docker container.
 *
 * TypeScript port of `community/aio_sandbox/aio_sandbox.py`.
 *
 * PENDING DEPENDENCIES (not yet ported to TS — stubbed locally here and noted in
 * the port report):
 *   - `quill.sandbox.sandbox.Sandbox`      → local abstract `Sandbox` base
 *   - `quill.sandbox.search.*`             → local `GrepMatch`, `pathMatches`,
 *                                               `shouldIgnorePath`, `truncateLine`
 *
 * The container is reached over HTTP via the `agent_sandbox` SDK surface
 * (`AgentSandboxClient`). The Python original uses the Fern-generated
 * `agent_sandbox` SDK which hides transport details; this port implements the
 * same surface over `sync-request` against conventional REST paths. If the live
 * container uses different routes, only the URL constants below need adjustment
 * — the interface contract is unchanged. All host-side logic (path-traversal
 * guards, retry/observation handling, result normalization) is ported faithfully.
 */

import crypto from "node:crypto";
import { createRequire } from "node:module";

import type { Response } from "sync-request";

import { VIRTUAL_PATH_PREFIX } from "../../config/paths.js";

// sync-request is a CommonJS module whose .d.ts declares `export default`, which
// under NodeNext + esModuleInterop resolves to a non-callable module namespace.
// Using createRequire sidesteps the default-export interop and yields the
// callable function directly.
const _require = createRequire(import.meta.url);
const request = _require("sync-request") as (
  method: string,
  url: string,
  options?: Record<string, unknown>,
) => Response;

const logger = {
  debug: (...a: unknown[]) => console.debug(...a),
  info: (...a: unknown[]) => console.info(...a),
  warning: (...a: unknown[]) => console.warn(...a),
  error: (...a: unknown[]) => console.error(...a),
};

const _MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024; // 100 MB
const _ERROR_OBSERVATION_SIGNATURE = "'ErrorObservation' object has no attribute 'exit_code'";

// ── Stub for `quill.sandbox.search` (module not yet ported to TS) ─────────

/** A single grep hit. Mirrors Python `quill.sandbox.search.GrepMatch`. */
export interface GrepMatch {
  path: string;
  line_number: number;
  line: string;
}

const IGNORE_PATTERNS = [
  ".git", ".svn", ".hg", ".bzr", "node_modules", "__pycache__", ".venv", "venv",
  ".env", "env", ".tox", ".nox", ".eggs", "*.egg-info", "site-packages", "dist",
  "build", ".next", ".nuxt", ".output", ".turbo", "target", "out", ".idea",
  ".vscode", "*.swp", "*.swo", "*~", ".project", ".classpath", ".settings",
  ".DS_Store", "Thumbs.db", "desktop.ini", "*.lnk", "*.log", "*.tmp", "*.temp",
  "*.bak", "*.cache", ".cache", "logs", ".coverage", "coverage", ".nyc_output",
  "htmlcov", ".pytest_cache", ".mypy_cache", ".ruff_cache",
];

const _EXACT_IGNORE = new Set(IGNORE_PATTERNS.filter((p) => !/[*?[]/.test(p)));
const _GLOB_IGNORE = IGNORE_PATTERNS.filter((p) => /[*?[]/.test(p));

function _globToRegExp(pattern: string): RegExp {
  let re = "";
  for (const ch of pattern) {
    if (ch === "*") {
      re += ".*";
    } else if (ch === "?") {
      re += ".";
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

function shouldIgnoreName(name: string): boolean {
  if (_EXACT_IGNORE.has(name)) {
    return true;
  }
  return _GLOB_IGNORE.some((p) => _globToRegExp(p).test(name));
}

export function shouldIgnorePath(path: string): boolean {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter((seg) => seg)
    .some((seg) => shouldIgnoreName(seg));
}

function _matchRight(pattern: string, relPath: string): boolean {
  const patParts = pattern.split("/");
  const pathParts = relPath.split("/");
  if (patParts.length > pathParts.length) {
    return false;
  }
  const tail = pathParts.slice(pathParts.length - patParts.length);
  for (let i = 0; i < patParts.length; i++) {
    if (!_globToRegExp(patParts[i]).test(tail[i])) {
      return false;
    }
  }
  return true;
}

export function pathMatches(pattern: string, relPath: string): boolean {
  if (_matchRight(pattern, relPath)) {
    return true;
  }
  if (pattern.startsWith("**/")) {
    return _matchRight(pattern.slice(3), relPath);
  }
  return false;
}

export function truncateLine(line: string, maxChars = 200): string {
  line = line.replace(/[\n\r]+$/, "");
  if (line.length <= maxChars) {
    return line;
  }
  return line.slice(0, maxChars - 3) + "...";
}

// ── Stub for `quill.sandbox.sandbox.Sandbox` (base not yet ported to TS) ───

/** Abstract base class for sandbox environments. */
export abstract class Sandbox {
  protected _id: string;

  constructor(id: string) {
    this._id = id;
  }

  get id(): string {
    return this._id;
  }

  abstract executeCommand(command: string): string;
  abstract readFile(path: string): string;
  abstract downloadFile(path: string): Buffer;
  abstract listDir(path: string, maxDepth?: number): string[];
  abstract writeFile(path: string, content: string, append?: boolean): void;
  abstract glob(path: string, pattern: string, opts?: { includeDirs?: boolean; maxResults?: number }): [string[], boolean];
  abstract grep(
    path: string,
    pattern: string,
    opts?: { glob?: string | null; literal?: boolean; caseSensitive?: boolean; maxResults?: number },
  ): [GrepMatch[], boolean];
  abstract updateFile(path: string, content: Buffer): void;
}

// ── `agent_sandbox` SDK client (sync-request over HTTP) ─────────────────────

interface ShellExecResult {
  data?: { output?: string } | null;
}
interface ReadFileResult {
  data?: { content?: string } | null;
}
interface FileListEntry {
  path: string;
  is_directory?: boolean;
}
interface FindFilesResult {
  data?: { files?: string[] } | null;
}
interface ListPathResult {
  data?: { files?: FileListEntry[] } | null;
}
interface SearchInFileResult {
  data?: { line_numbers?: number[]; matches?: string[] } | null;
}

export interface AgentSandboxClient {
  sandbox: { getContext(): { home_dir: string } };
  shell: {
    execCommand(args: { command: string; no_change_timeout?: number; id?: string }): ShellExecResult;
    createSession(args: { id: string }): void;
    cleanupSession(id: string): void;
  };
  file: {
    readFile(args: { file: string }): ReadFileResult;
    downloadFile(args: { path: string }): Iterable<Buffer>;
    writeFile(args: { file: string; content: string; encoding?: string }): void;
    findFiles(args: { path: string; glob: string }): FindFilesResult;
    listPath(args: { path: string; recursive: boolean; show_hidden: boolean }): ListPathResult;
    searchInFile(args: { file: string; regex: string }): SearchInFileResult;
  };
  close?(): void;
}

/**
 * Build a synchronous HTTP client for a running AIO sandbox container.
 *
 * The Python original uses the Fern-generated `agent_sandbox` SDK which hides
 * the HTTP transport. This port implements the same surface over `sync-request`
 * against conventional REST paths. The `AioSandbox` class calls every method
 * synchronously (e.g. `this._client!.shell.execCommand(...)`), so the client
 * must remain synchronous — `sync-request` blocks the event loop for each call,
 * which is the intended trade-off.
 *
 * If the live container uses different routes, only the URL constants below
 * need adjustment; the {@link AgentSandboxClient} contract is unchanged.
 */
export function createAgentSandboxClient(baseUrl: string, timeout: number): AgentSandboxClient {
  const base = baseUrl.replace(/\/+$/, "");
  // sync-request's `timeout` option is in milliseconds; the callers pass seconds.
  const requestTimeoutMs = (timeout > 0 ? timeout : 600) * 1000;

  /** Issue a sync JSON request and return the parsed body (or throw on non-2xx). */
  const doJsonRequest = <T>(
    method: string,
    path: string,
    options: { json?: Record<string, unknown>; qs?: Record<string, string> } = {},
  ): T => {
    const url = `${base}${path}`;
    const res = request(method, url, {
      ...(options.json ? { json: options.json } : {}),
      ...(options.qs ? { qs: options.qs } : {}),
      timeout: requestTimeoutMs,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const errBody = typeof res.body === "string" ? res.body : res.body.toString("utf8");
      throw new Error(
        `AIO sandbox HTTP ${method} ${url} failed: ${res.statusCode} ${errBody}`,
      );
    }
    const bodyText = typeof res.body === "string" ? res.body : res.body.toString("utf8");
    if (!bodyText) {
      return {} as T;
    }
    try {
      return JSON.parse(bodyText) as T;
    } catch {
      return { data: bodyText } as unknown as T;
    }
  };

  /** Issue a sync raw-bytes request (used by downloadFile). Returns the Buffer. */
  const doRawRequest = (path: string, qs: Record<string, string>): Buffer => {
    const url = `${base}${path}`;
    const res = request("GET", url, { qs, timeout: requestTimeoutMs });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const errBody = typeof res.body === "string" ? res.body : res.body.toString("utf8");
      throw new Error(
        `AIO sandbox HTTP GET ${url} failed: ${res.statusCode} ${errBody}`,
      );
    }
    return Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body as string);
  };

  return {
    sandbox: {
      getContext: (): { home_dir: string } => {
        // The dify-sandbox container serves the environment report at /v1/sandbox
        // as a textual markdown payload under `data`. The home directory lives in
        // a line of the form `- Home directory: /home/gem`; parse it out.
        const result = doJsonRequest<{ data?: string }>(
          "GET",
          "/v1/sandbox",
        );
        const text = result.data ?? "";
        const match = text.match(/Home directory:\s*(\S+)/);
        if (!match) {
          throw new Error(`AIO sandbox /v1/sandbox returned no home_dir: ${text.slice(0, 200)}`);
        }
        return { home_dir: match[1] };
      },
    },
    shell: {
      execCommand: (args: {
        command: string;
        no_change_timeout?: number;
        id?: string;
      }): ShellExecResult => {
        const body: Record<string, unknown> = { command: args.command };
        if (args.no_change_timeout !== undefined) body.no_change_timeout = args.no_change_timeout;
        if (args.id !== undefined) body.id = args.id;
        return doJsonRequest<ShellExecResult>("POST", "/v1/shell/exec", { json: body });
      },
      createSession: (args: { id: string }): void => {
        doJsonRequest<unknown>("POST", "/v1/shell/sessions", { json: { id: args.id } });
      },
      cleanupSession: (id: string): void => {
        doJsonRequest<unknown>("DELETE", `/v1/shell/sessions/${encodeURIComponent(id)}`);
      },
    },
    file: {
      readFile: (args: { file: string }): ReadFileResult => {
        return doJsonRequest<ReadFileResult>("POST", "/v1/file/read", {
          json: { file: args.file },
        });
      },
      downloadFile: (args: { path: string }): Iterable<Buffer> => {
        // Single GET returning the full body as one Buffer. The 100MB cap is
        // enforced by the caller (AioSandbox.downloadFile); here we return a
        // one-element iterable to satisfy the `Iterable<Buffer>` contract.
        const buf = doRawRequest("/v1/file/download", { path: args.path });
        return [buf];
      },
      writeFile: (args: {
        file: string;
        content: string;
        encoding?: string;
      }): void => {
        const body: Record<string, unknown> = { file: args.file, content: args.content };
        if (args.encoding !== undefined) body.encoding = args.encoding;
        doJsonRequest<unknown>("POST", "/v1/file/write", { json: body });
      },
      findFiles: (args: { path: string; glob: string }): FindFilesResult => {
        return doJsonRequest<FindFilesResult>("POST", "/v1/file/find", {
          json: { path: args.path, glob: args.glob },
        });
      },
      listPath: (args: {
        path: string;
        recursive: boolean;
        show_hidden: boolean;
      }): ListPathResult => {
        return doJsonRequest<ListPathResult>("POST", "/v1/file/list", {
          json: {
            path: args.path,
            recursive: args.recursive,
            show_hidden: args.show_hidden,
          },
        });
      },
      searchInFile: (args: { file: string; regex: string }): SearchInFileResult => {
        return doJsonRequest<SearchInFileResult>("POST", "/v1/file/search", {
          json: { file: args.file, regex: args.regex },
        });
      },
    },
    close: (): void => {
      // sync-request is stateless (no pooled sockets to release); no-op.
    },
  };
}

/** Shell-quote a single argument for the container's `find` invocation. */
function shlexQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sandbox implementation using the agent-infra/sandbox Docker container.
 *
 * This sandbox connects to a running AIO sandbox container via HTTP API.
 */
export class AioSandbox extends Sandbox {
  private readonly _baseUrl: string;
  private _client: AgentSandboxClient | null;
  private _homeDir: string | null;
  private _closed = false;

  // Default no_change_timeout for exec_command (seconds).
  private static readonly _DEFAULT_NO_CHANGE_TIMEOUT = 600;

  constructor(id: string, baseUrl: string, homeDir: string | null = null) {
    super(id);
    this._baseUrl = baseUrl;
    this._client = createAgentSandboxClient(baseUrl, 600);
    this._homeDir = homeDir;
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  /** Best-effort close of the host-side HTTP client owned by this sandbox. */
  close(): void {
    if (this._closed) {
      return;
    }
    this._closed = true;
    const client = this._client;
    this._client = null;

    if (client === null) {
      return;
    }
    try {
      client.close?.();
    } catch (e) {
      logger.warning(`Error closing AioSandbox client for ${this.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  get homeDir(): string {
    if (this._homeDir === null) {
      const context = this._client!.sandbox.getContext();
      this._homeDir = context.home_dir;
    }
    return this._homeDir;
  }

  executeCommand(command: string): string {
    try {
      let result = this._client!.shell.execCommand({
        command,
        no_change_timeout: AioSandbox._DEFAULT_NO_CHANGE_TIMEOUT,
      });
      let output = result.data ? result.data.output ?? "" : "";

      if (output && output.includes(_ERROR_OBSERVATION_SIGNATURE)) {
        logger.warning("ErrorObservation detected in sandbox output, retrying on a fresh session");
        const freshId = crypto.randomUUID();
        this._client!.shell.createSession({ id: freshId });
        try {
          result = this._client!.shell.execCommand({
            command,
            id: freshId,
            no_change_timeout: AioSandbox._DEFAULT_NO_CHANGE_TIMEOUT,
          });
          output = result.data ? result.data.output ?? "" : "";
        } finally {
          try {
            this._client!.shell.cleanupSession(freshId);
          } catch (cleanupError) {
            logger.warning(
              `Failed to release recovery session ${freshId}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
            );
          }
        }
      }

      return output ? output : "(no output)";
    } catch (e) {
      logger.error(`Failed to execute command in sandbox: ${e instanceof Error ? e.message : String(e)}`);
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  readFile(path: string): string {
    try {
      const result = this._client!.file.readFile({ file: path });
      return result.data ? result.data.content ?? "" : "";
    } catch (e) {
      logger.error(`Failed to read file in sandbox: ${e instanceof Error ? e.message : String(e)}`);
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  downloadFile(path: string): Buffer {
    // Reject path traversal before sending to the container API.
    const normalised = path.replace(/\\/g, "/");
    for (const segment of normalised.split("/")) {
      if (segment === "..") {
        logger.error(`Refused download due to path traversal: ${path}`);
        throw new Error(`Access denied: path traversal detected in '${path}'`);
      }
    }

    const strippedPath = normalised.replace(/^\/+/, "");
    const allowedPrefix = VIRTUAL_PATH_PREFIX.replace(/^\/+/, "");
    if (strippedPath !== allowedPrefix && !strippedPath.startsWith(`${allowedPrefix}/`)) {
      logger.error(`Refused download outside allowed directory: path=${path}, allowed_prefix=${VIRTUAL_PATH_PREFIX}`);
      throw new Error(`Access denied: path must be under '${VIRTUAL_PATH_PREFIX}': '${path}'`);
    }

    try {
      const chunks: Buffer[] = [];
      let total = 0;
      for (const chunk of this._client!.file.downloadFile({ path })) {
        total += chunk.length;
        if (total > _MAX_DOWNLOAD_SIZE) {
          throw new Error(`File exceeds maximum download size of ${_MAX_DOWNLOAD_SIZE} bytes`);
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (e) {
      logger.error(`Failed to download file in sandbox: ${e instanceof Error ? e.message : String(e)}`);
      throw new Error(`Failed to download file '${path}' from sandbox: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  listDir(path: string, maxDepth = 2): string[] {
    try {
      const result = this._client!.shell.execCommand({
        command: `find ${shlexQuote(path)} -maxdepth ${maxDepth} -type f -o -type d 2>/dev/null | head -500`,
        no_change_timeout: AioSandbox._DEFAULT_NO_CHANGE_TIMEOUT,
      });
      const output = result.data ? result.data.output ?? "" : "";
      if (output) {
        return output
          .trim()
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line);
      }
      return [];
    } catch (e) {
      logger.error(`Failed to list directory in sandbox: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  writeFile(path: string, content: string, append = false): void {
    try {
      if (append) {
        const existing = this.readFile(path);
        if (!existing.startsWith("Error:")) {
          content = existing + content;
        }
      }
      this._client!.file.writeFile({ file: path, content });
    } catch (e) {
      logger.error(`Failed to write file in sandbox: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }

  glob(path: string, pattern: string, opts: { includeDirs?: boolean; maxResults?: number } = {}): [string[], boolean] {
    const includeDirs = opts.includeDirs ?? false;
    const maxResults = opts.maxResults ?? 200;

    if (!includeDirs) {
      const result = this._client!.file.findFiles({ path, glob: pattern });
      const files = result.data && result.data.files ? result.data.files : [];
      const filtered = files.filter((filePath) => !shouldIgnorePath(filePath));
      const truncated = filtered.length > maxResults;
      return [filtered.slice(0, maxResults), truncated];
    }

    const result = this._client!.file.listPath({ path, recursive: true, show_hidden: false });
    const entries = result.data && result.data.files ? result.data.files : [];
    const matches: string[] = [];
    const rootPath = path.replace(/\/+$/, "") || "/";
    const rootPrefix = rootPath === "/" ? "/" : `${rootPath}/`;
    for (const entry of entries) {
      if (entry.path !== rootPath && !entry.path.startsWith(rootPrefix)) {
        continue;
      }
      if (shouldIgnorePath(entry.path)) {
        continue;
      }
      const relPath = entry.path.slice(rootPath.length).replace(/^\/+/, "");
      if (pathMatches(pattern, relPath)) {
        matches.push(entry.path);
        if (matches.length >= maxResults) {
          return [matches, true];
        }
      }
    }
    return [matches, false];
  }

  grep(
    path: string,
    pattern: string,
    opts: { glob?: string | null; literal?: boolean; caseSensitive?: boolean; maxResults?: number } = {},
  ): [GrepMatch[], boolean] {
    const glob = opts.glob ?? null;
    const literal = opts.literal ?? false;
    const caseSensitive = opts.caseSensitive ?? false;
    const maxResults = opts.maxResults ?? 100;

    const regexSource = literal ? escapeRegExp(pattern) : pattern;
    // Validate the pattern locally so an invalid regex throws rather than a
    // generic remote API error.
    // eslint-disable-next-line no-new
    new RegExp(regexSource, caseSensitive ? "" : "i");
    const regex = caseSensitive ? regexSource : `(?i)${regexSource}`;

    let candidatePaths: string[];
    if (glob !== null) {
      const findResult = this._client!.file.findFiles({ path, glob });
      candidatePaths = findResult.data && findResult.data.files ? findResult.data.files : [];
    } else {
      const listResult = this._client!.file.listPath({ path, recursive: true, show_hidden: false });
      const entries = listResult.data && listResult.data.files ? listResult.data.files : [];
      candidatePaths = entries.filter((entry) => !entry.is_directory).map((entry) => entry.path);
    }

    const matches: GrepMatch[] = [];
    let truncated = false;

    for (const filePath of candidatePaths) {
      if (shouldIgnorePath(filePath)) {
        continue;
      }

      const searchResult = this._client!.file.searchInFile({ file: filePath, regex });
      const data = searchResult.data;
      if (data === null || data === undefined) {
        continue;
      }

      const lineNumbers = data.line_numbers ?? [];
      const matchedLines = data.matches ?? [];
      const count = Math.min(lineNumbers.length, matchedLines.length);
      for (let i = 0; i < count; i++) {
        const lineNumber = lineNumbers[i];
        const line = matchedLines[i];
        matches.push({
          path: filePath,
          line_number: typeof lineNumber === "number" ? lineNumber : 0,
          line: truncateLine(line),
        });
        if (matches.length >= maxResults) {
          truncated = true;
          return [matches, truncated];
        }
      }
    }

    return [matches, truncated];
  }

  updateFile(path: string, content: Buffer): void {
    try {
      const base64Content = content.toString("base64");
      this._client!.file.writeFile({ file: path, content: base64Content, encoding: "base64" });
    } catch (e) {
      logger.error(`Failed to update file in sandbox: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }
}

