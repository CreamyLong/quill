/**
 * Common sandbox backend interface used by the agent's file/shell tools.
 *
 * Both {@link LocalSandbox} and {@link AioSandboxAdapter} implement this shape
 * so that `createSandboxTools` and `createViewImageTool` can work with either
 * backend without caring about the underlying transport.
 */

import type { Buffer } from "node:buffer";

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

export interface GrepMatch {
  path: string;
  line_number: number;
  line: string;
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

/** Backend exposed to sandbox tools. */
export interface SandboxBackend {
  /** Stable sandbox identifier. */
  readonly id: string;

  /** Execute a shell command and return its output. */
  executeCommand(command: string): Promise<string> | string;

  /** Read a text file. */
  readFile(virtualPath: string, options?: ReadFileOptions): string;

  /** Read a binary file. */
  readFileBinary(virtualPath: string): Buffer;

  /** Write (or append) text to a file. */
  writeFile(virtualPath: string, content: string, append?: boolean): void;

  /** Replace a substring in a file. */
  strReplace(virtualPath: string, oldStr: string, newStr: string, replaceAll?: boolean): StrReplaceOutcome;

  /** List directory contents up to `maxDepth` levels. */
  listDir(virtualPath: string, maxDepth?: number): string[];

  /** Find paths matching a glob pattern. */
  glob(virtualPath: string, pattern: string, options?: GlobOptions): GlobResult;

  /** Search file contents for a pattern. */
  grep(pattern: string, virtualPath: string, options?: GrepOptions): GrepResult;
}

/** Provider that can hand out a {@link SandboxBackend} for a thread. */
export interface SandboxToolProvider {
  acquire(threadId: string): SandboxBackend | Promise<SandboxBackend>;
}
