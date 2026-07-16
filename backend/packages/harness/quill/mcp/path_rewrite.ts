/**
 * Local-path-to-virtual-path rewriting for MCP tool outputs.
 *
 * MCP servers (especially stdio ones like Playwright) often return files they
 * produced as host paths — bare paths, `file://` URIs, or relative paths —
 * instead of the sandbox virtual paths (`/mnt/user-data/...`) that the rest of
 * Quill resolves against. This module rewrites those references in tool output
 * text so the agent can hand them to sandbox tools like `read_file` and
 * `present_files`.
 *
 * The rewrite is deliberately conservative (ported from Python
 * `deerflow.mcp.tools._rewrite_local_paths_in_text`): a candidate token is
 * only rewritten when it resolves to an existing file inside the thread's
 * user-data tree. Tokens that are not real paths, point at directories, or
 * live outside the tree are left exactly as-is, so an over-eager regex match
 * has no harmful effect.
 */

import { existsSync } from "node:fs";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

/** Virtual mount root — must match `paths.ts` `VIRTUAL_PATH_PREFIX`. */
export const VIRTUAL_PATH_PREFIX = "/mnt/user-data";

/** Resolves a thread's host workspace root, or null if unknown/not registered. */
export type WorkspaceResolver = (threadId: string) => string | null;

let _resolver: WorkspaceResolver | null = null;

/**
 * Register the workspace resolver used to map a thread to its host workspace.
 * Called once at startup from the composition root (`gateway_server.mjs`).
 */
export function setWorkspaceResolver(resolver: WorkspaceResolver): void {
  _resolver = resolver;
}

/**
 * Returns the host filesystem `Path` if `uri` names a local file, else `None`.
 * Accepts bare paths and `file://` URIs. Remote URIs (`http`/`https`/`data`/...)
 * return null so the caller leaves them untouched. Relative paths resolve only
 * when `baseDir` is supplied.
 */
function localPathFromUri(uri: string, baseDir?: string): string | null {
  if (!uri) return null;
  let raw: string;
  if (uri.startsWith("file://")) {
    raw = decodeURIComponent(uri.slice(7));
  } else if (uri.includes("://")) {
    return null; // remote scheme (http, https, data, …)
  } else {
    raw = uri;
  }
  if (!raw) return null;
  if (path.isAbsolute(raw)) return raw;
  if (baseDir) return path.join(baseDir, raw);
  return null;
}

/**
 * Translate a local file reference to its `/mnt/user-data/...` virtual path.
 * Returns null when the reference is remote, unresolvable, outside the
 * thread's user-data tree, or not an existing file.
 */
export function localUriToVirtualPath(
  uri: string,
  threadId: string,
  sourceBaseDir?: string
): string | null {
  const src = localPathFromUri(uri, sourceBaseDir);
  if (src === null) return null;

  let real: string;
  try {
    real = realpathSync(src);
  } catch {
    return null;
  }
  let stat;
  try {
    stat = lstatSync(real);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  const wsRoot = _resolver?.(threadId);
  if (!wsRoot) return null;
  let wsReal: string;
  try {
    wsReal = realpathSync(wsRoot);
  } catch {
    return null;
  }

  // Require the file to live inside the thread's workspace tree.
  const rel = path.relative(wsReal, real);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;

  return `${VIRTUAL_PATH_PREFIX}/${rel.split(path.sep).join("/")}`;
}

// Matches local-file references embedded in free-text returned by an MCP server.
// Some servers (notably Playwright) report saved files only as text/markdown
// links rather than structured blocks. The regex accepts absolute paths,
// `file://` URIs, and relative path prefixes.
const LOCAL_PATH_IN_TEXT_RE =
  /(?:file:\/\/)?\/[^\s'"<>|*?]+|(?:\.{0,2}\/|[\w.-]+\/)[^\s'"<>|*?]+/g;

// Trailing characters that are punctuation/markup rather than part of a path.
const TEXT_PATH_TRAILING_CHARS = ".,;:!?)]}>`'";

/**
 * Best-effort rewrite of local file references found in free text.
 * Only rewrites tokens that resolve to an existing file inside the thread's
 * user-data tree; all others are left untouched.
 */
export function rewriteLocalPathsInText(
  text: string,
  threadId: string,
  sourceBaseDir?: string
): string {
  if (!_resolver) return text;

  return text.replace(LOCAL_PATH_IN_TEXT_RE, (token) => {
    // A path can end a sentence ("saved as temp/a.png."); strip trailing
    // punctuation and restore it after the (possibly rewritten) path.
    const stripped = token.replace(new RegExp(`[${TEXT_PATH_TRAILING_CHARS.replace(/[\[\]\\]/g, "\\$&")}]+$`), "");
    const trailing = token.slice(stripped.length);
    const rewritten = localUriToVirtualPath(stripped, threadId, sourceBaseDir);
    if (rewritten === null) return token;
    return `${rewritten}${trailing}`;
  });
}

/**
 * Rewrite local paths in MCP tool output content blocks.
 * `text` content blocks get path rewriting; non-text blocks pass through.
 */
export function rewriteMcpContent(
  content: unknown,
  threadId: string,
  sourceBaseDir?: string
): unknown {
  if (typeof content === "string") {
    return rewriteLocalPathsInText(content, threadId, sourceBaseDir);
  }
  if (Array.isArray(content)) {
    return content.map((block) => rewriteMcpContent(block, threadId, sourceBaseDir));
  }
  if (content && typeof content === "object") {
    const block = content as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") {
      return { ...block, text: rewriteLocalPathsInText(block.text, threadId, sourceBaseDir) };
    }
    // ResourceLink-style blocks referencing a local file URI.
    if (typeof block.url === "string") {
      const rewritten = localUriToVirtualPath(block.url, threadId, sourceBaseDir);
      if (rewritten !== null) return { ...block, url: rewritten };
    }
    if (typeof block.uri === "string") {
      const rewritten = localUriToVirtualPath(block.uri, threadId, sourceBaseDir);
      if (rewritten !== null) return { ...block, uri: rewritten };
    }
  }
  return content;
}
