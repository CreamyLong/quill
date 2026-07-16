/**
 * Sandbox file + shell tools — TypeScript port of `quill.sandbox.tools`.
 *
 * `createSandboxTools(provider, { hostBashAllowed })` returns the 7 LangChain
 * StructuredTools the agent uses to work in its per-thread workspace:
 *
 *   bash, ls, glob, grep, read_file, write_file, str_replace
 *
 * Each tool reads the thread id from the tool callback's RunnableConfig
 * (`config.configurable.thread_id`, falling back to a default), acquires that
 * thread's `LocalSandbox` from the provider, and calls the matching method.
 * Tool names, parameter names and descriptions mirror the Python `@tool`
 * definitions.
 *
 * The `bash` tool is gated: when `hostBashAllowed` is false it returns
 * `LOCAL_HOST_BASH_DISABLED_MESSAGE` instead of executing anything (host bash on
 * the local backend is not a secure isolation boundary).
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

import { withFileOperationLock } from "../../sandbox/file_operation_lock.js";
import { LOCAL_HOST_BASH_DISABLED_MESSAGE } from "../../sandbox/security.js";
import type {
  GrepMatch,
  SandboxBackend,
  SandboxToolProvider,
} from "../../sandbox/sandbox_backend.js";

const DEFAULT_THREAD_ID = "default";

const DEFAULT_GLOB_MAX_RESULTS = 200;
const MAX_GLOB_MAX_RESULTS = 1000;
const DEFAULT_GREP_MAX_RESULTS = 100;
const MAX_GREP_MAX_RESULTS = 500;

const BASH_OUTPUT_MAX_CHARS = 20000;
const READ_FILE_OUTPUT_MAX_CHARS = 50000;
const LS_OUTPUT_MAX_CHARS = 20000;

// Single non-append write_file cap (issue #3189). Override via
// QUILL_WRITE_FILE_MAX_BYTES; 0 or negative disables the guard.
const WRITE_FILE_CONTENT_MAX_BYTES = 80 * 1024;
const WRITE_FILE_MAX_BYTES_ENV = "QUILL_WRITE_FILE_MAX_BYTES";
const DEFAULT_WRITE_FILE_ERROR_MAX_CHARS = 2000;

export interface CreateSandboxToolsOptions {
  /** When false, the bash tool refuses to run and returns the disabled message. */
  hostBashAllowed: boolean;
}

function getThreadId(config?: RunnableConfig): string {
  const raw = (config?.configurable as { thread_id?: unknown } | undefined)?.thread_id;
  return typeof raw === "string" && raw.length > 0 ? raw : DEFAULT_THREAD_ID;
}

function errorCode(err: unknown): string | undefined {
  return (err as { code?: string } | undefined)?.code;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// --- output truncation (ports of quill.sandbox.tools helpers) -------------

function truncateBashOutput(output: string, maxChars: number): string {
  if (maxChars === 0 || output.length <= maxChars) return output;
  const total = output.length;
  const markerMaxLen = `\n... [middle truncated: ${total} chars skipped] ...\n`.length;
  const kept = Math.max(0, maxChars - markerMaxLen);
  if (kept === 0) return output.slice(0, maxChars);
  const headLen = Math.floor(kept / 2);
  const tailLen = kept - headLen;
  const skipped = total - kept;
  const marker = `\n... [middle truncated: ${skipped} chars skipped] ...\n`;
  return `${output.slice(0, headLen)}${marker}${tailLen > 0 ? output.slice(output.length - tailLen) : ""}`;
}

function truncateReadFileOutput(output: string, maxChars: number): string {
  if (maxChars === 0 || output.length <= maxChars) return output;
  const total = output.length;
  const markerMaxLen =
    `\n... [truncated: showing first ${total} of ${total} chars. Use start_line/end_line to read a specific range] ...`
      .length;
  const kept = Math.max(0, maxChars - markerMaxLen);
  if (kept === 0) return output.slice(0, maxChars);
  const marker = `\n... [truncated: showing first ${kept} of ${total} chars. Use start_line/end_line to read a specific range] ...`;
  return `${output.slice(0, kept)}${marker}`;
}

function truncateLsOutput(output: string, maxChars: number): string {
  if (maxChars === 0 || output.length <= maxChars) return output;
  const total = output.length;
  const markerMaxLen =
    `\n... [truncated: showing first ${total} of ${total} chars. Use a more specific path to see fewer results] ...`
      .length;
  const kept = Math.max(0, maxChars - markerMaxLen);
  if (kept === 0) return output.slice(0, maxChars);
  const marker = `\n... [truncated: showing first ${kept} of ${total} chars. Use a more specific path to see fewer results] ...`;
  return `${output.slice(0, kept)}${marker}`;
}

function clampMaxResults(value: number, defaultValue: number, upperBound: number): number {
  if (value <= 0) return defaultValue;
  return Math.min(value, upperBound);
}

function formatGlobResults(rootPath: string, matches: string[], truncated: boolean): string {
  if (matches.length === 0) return `No files matched under ${rootPath}`;
  const header = truncated
    ? `Found ${matches.length} paths under ${rootPath} (showing first ${matches.length})`
    : `Found ${matches.length} paths under ${rootPath}`;
  const lines = [header];
  matches.forEach((p, index) => lines.push(`${index + 1}. ${p}`));
  if (truncated) {
    lines.push("Results truncated. Narrow the path or pattern to see fewer matches.");
  }
  return lines.join("\n");
}

function formatGrepResults(rootPath: string, matches: GrepMatch[], truncated: boolean): string {
  if (matches.length === 0) return `No matches found under ${rootPath}`;
  const header = truncated
    ? `Found ${matches.length} matches under ${rootPath} (showing first ${matches.length})`
    : `Found ${matches.length} matches under ${rootPath}`;
  const lines = [header];
  for (const match of matches) {
    lines.push(`${match.path}:${match.line_number}: ${match.line}`);
  }
  if (truncated) {
    lines.push("Results truncated. Narrow the path or add a glob filter.");
  }
  return lines.join("\n");
}

function effectiveWriteFileMaxBytes(): number {
  const raw = process.env[WRITE_FILE_MAX_BYTES_ENV];
  if (raw === undefined) return WRITE_FILE_CONTENT_MAX_BYTES;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? WRITE_FILE_CONTENT_MAX_BYTES : parsed;
}

// --- schemas -----------------------------------------------------------------

const bashSchema = z.object({
  description: z
    .string()
    .describe(
      "Explain why you are running this command in short words. ALWAYS PROVIDE THIS PARAMETER FIRST.",
    ),
  command: z
    .string()
    .describe("The bash command to execute. Always use absolute paths for files and directories."),
});

const lsSchema = z.object({
  description: z
    .string()
    .describe(
      "Explain why you are listing this directory in short words. ALWAYS PROVIDE THIS PARAMETER FIRST.",
    ),
  path: z.string().describe("The **absolute** path to the directory to list."),
});

const globSchema = z.object({
  description: z
    .string()
    .describe(
      "Explain why you are searching for these paths in short words. ALWAYS PROVIDE THIS PARAMETER FIRST.",
    ),
  pattern: z.string().describe("The glob pattern to match relative to the root path, for example `**/*.py`."),
  path: z.string().describe("The **absolute** root directory to search under."),
  include_dirs: z
    .boolean()
    .optional()
    .describe("Whether matching directories should also be returned. Default is False."),
  max_results: z
    .number()
    .int()
    .optional()
    .describe("Maximum number of paths to return. Default is 200."),
});

const grepSchema = z.object({
  description: z
    .string()
    .describe(
      "Explain why you are searching file contents in short words. ALWAYS PROVIDE THIS PARAMETER FIRST.",
    ),
  pattern: z.string().describe("The string or regex pattern to search for."),
  path: z.string().describe("The **absolute** root directory to search under."),
  glob: z.string().optional().describe("Optional glob filter for candidate files, for example `**/*.py`."),
  literal: z.boolean().optional().describe("Whether to treat `pattern` as a plain string. Default is False."),
  case_sensitive: z.boolean().optional().describe("Whether matching is case-sensitive. Default is False."),
  max_results: z
    .number()
    .int()
    .optional()
    .describe("Maximum number of matching lines to return. Default is 100."),
});

const readFileSchema = z.object({
  description: z
    .string()
    .describe(
      "Explain why you are reading this file in short words. ALWAYS PROVIDE THIS PARAMETER FIRST.",
    ),
  path: z.string().describe("The **absolute** path to the file to read."),
  start_line: z
    .number()
    .int()
    .optional()
    .describe("Optional starting line number (1-indexed, inclusive). Use with end_line to read a specific range."),
  end_line: z
    .number()
    .int()
    .optional()
    .describe("Optional ending line number (1-indexed, inclusive). Use with start_line to read a specific range."),
});

const writeFileSchema = z.object({
  description: z
    .string()
    .describe(
      "Explain why you are writing to this file in short words. ALWAYS PROVIDE THIS PARAMETER FIRST.",
    ),
  path: z
    .string()
    .describe("The **absolute** path to the file to write to. ALWAYS PROVIDE THIS PARAMETER SECOND."),
  content: z.string().describe("The content to write to the file. ALWAYS PROVIDE THIS PARAMETER THIRD."),
  append: z
    .boolean()
    .optional()
    .describe("Whether to append content to the end of the file instead of overwriting it. Defaults to False."),
});

const strReplaceSchema = z.object({
  description: z
    .string()
    .describe(
      "Explain why you are replacing the substring in short words. ALWAYS PROVIDE THIS PARAMETER FIRST.",
    ),
  path: z
    .string()
    .describe("The **absolute** path to the file to replace the substring in. ALWAYS PROVIDE THIS PARAMETER SECOND."),
  old_str: z.string().describe("The substring to replace. ALWAYS PROVIDE THIS PARAMETER THIRD."),
  new_str: z.string().describe("The new substring. ALWAYS PROVIDE THIS PARAMETER FOURTH."),
  replace_all: z
    .boolean()
    .optional()
    .describe(
      "Whether to replace all occurrences of the substring. If False, only the first occurrence will be replaced. Default is False.",
    ),
});

// --- tool factory ------------------------------------------------------------

/**
 * Build the array of 7 sandbox StructuredTools bound to `provider`.
 */
export function createSandboxTools(
  provider: SandboxToolProvider,
  options: CreateSandboxToolsOptions,
): StructuredToolInterface[] {
  const { hostBashAllowed } = options;
  const acquire = async (config?: RunnableConfig): Promise<SandboxBackend> =>
    provider.acquire(getThreadId(config));

  const bash = tool(
    async (input: z.infer<typeof bashSchema>, config?: RunnableConfig): Promise<string> => {
      if (!hostBashAllowed) {
        return `Error: ${LOCAL_HOST_BASH_DISABLED_MESSAGE}`;
      }
      try {
        const sandbox = await acquire(config);
        const output = await sandbox.executeCommand(input.command);
        return truncateBashOutput(output, BASH_OUTPUT_MAX_CHARS);
      } catch (err) {
        return `Error: Unexpected error executing command: ${errorMessage(err)}`;
      }
    },
    {
      name: "bash",
      description: [
        "Execute a bash command in a Linux environment.",
        "",
        "- Use `python` to run Python code.",
        "- Prefer a thread-local virtual environment in `/mnt/user-data/workspace/.venv`.",
        "- Use `python -m pip` (inside the virtual environment) to install Python packages.",
      ].join("\n"),
      schema: bashSchema,
    },
  );

  const ls = tool(
    async (input: z.infer<typeof lsSchema>, config?: RunnableConfig): Promise<string> => {
      try {
        const sandbox = await acquire(config);
        const children = sandbox.listDir(input.path);
        if (children.length === 0) return "(empty)";
        return truncateLsOutput(children.join("\n"), LS_OUTPUT_MAX_CHARS);
      } catch (err) {
        const code = errorCode(err);
        if (code === "ENOENT") return `Error: Directory not found: ${input.path}`;
        if (err instanceof Error && err.name.includes("Permission")) {
          return `Error: Permission denied: ${input.path}`;
        }
        return `Error: Unexpected error listing directory: ${errorMessage(err)}`;
      }
    },
    {
      name: "ls",
      description: "List the contents of a directory up to 2 levels deep in tree format.",
      schema: lsSchema,
    },
  );

  const glob = tool(
    async (input: z.infer<typeof globSchema>, config?: RunnableConfig): Promise<string> => {
      try {
        const sandbox = await acquire(config);
        const maxResults = clampMaxResults(
          input.max_results ?? DEFAULT_GLOB_MAX_RESULTS,
          DEFAULT_GLOB_MAX_RESULTS,
          MAX_GLOB_MAX_RESULTS,
        );
        const { paths, truncated } = sandbox.glob(input.path, input.pattern, {
          includeDirs: input.include_dirs ?? false,
          maxResults,
        });
        return formatGlobResults(input.path, paths, truncated);
      } catch (err) {
        const code = errorCode(err);
        if (code === "ENOENT") return `Error: Directory not found: ${input.path}`;
        if (code === "ENOTDIR") return `Error: Path is not a directory: ${input.path}`;
        if (err instanceof Error && err.name.includes("Permission")) {
          return `Error: Permission denied: ${input.path}`;
        }
        return `Error: Unexpected error searching paths: ${errorMessage(err)}`;
      }
    },
    {
      name: "glob",
      description: "Find files or directories that match a glob pattern under a root directory.",
      schema: globSchema,
    },
  );

  const grep = tool(
    async (input: z.infer<typeof grepSchema>, config?: RunnableConfig): Promise<string> => {
      try {
        const sandbox = await acquire(config);
        const maxResults = clampMaxResults(
          input.max_results ?? DEFAULT_GREP_MAX_RESULTS,
          DEFAULT_GREP_MAX_RESULTS,
          MAX_GREP_MAX_RESULTS,
        );
        const { matches, truncated } = sandbox.grep(input.pattern, input.path, {
          glob: input.glob ?? null,
          literal: input.literal ?? false,
          caseSensitive: input.case_sensitive ?? false,
          maxResults,
        });
        return formatGrepResults(input.path, matches, truncated);
      } catch (err) {
        const code = errorCode(err);
        if (code === "ENOENT") return `Error: Directory not found: ${input.path}`;
        if (code === "ENOTDIR") return `Error: Path is not a directory: ${input.path}`;
        if (err instanceof SyntaxError) return `Error: Invalid regex pattern: ${errorMessage(err)}`;
        if (err instanceof Error && err.name.includes("Permission")) {
          return `Error: Permission denied: ${input.path}`;
        }
        return `Error: Unexpected error searching file contents: ${errorMessage(err)}`;
      }
    },
    {
      name: "grep",
      description: "Search for matching lines inside text files under a root directory.",
      schema: grepSchema,
    },
  );

  const readFile = tool(
    async (input: z.infer<typeof readFileSchema>, config?: RunnableConfig): Promise<string> => {
      try {
        const sandbox = await acquire(config);
        let content = sandbox.readFile(input.path);
        if (!content) return "(empty)";
        if (input.start_line !== undefined && input.end_line !== undefined) {
          content = content.split("\n").slice(input.start_line - 1, input.end_line).join("\n");
        }
        return truncateReadFileOutput(content, READ_FILE_OUTPUT_MAX_CHARS);
      } catch (err) {
        const code = errorCode(err);
        if (code === "ENOENT") return `Error: File not found: ${input.path}`;
        if (code === "EISDIR") return `Error: Path is a directory, not a file: ${input.path}`;
        if (err instanceof Error && err.name.includes("Permission")) {
          return `Error: Permission denied reading file: ${input.path}`;
        }
        return `Error: Unexpected error reading file: ${errorMessage(err)}`;
      }
    },
    {
      name: "read_file",
      description:
        "Read the contents of a text file. Use this to examine source code, configuration files, logs, or any text-based file.",
      schema: readFileSchema,
    },
  );

  const writeFile = tool(
    async (input: z.infer<typeof writeFileSchema>, config?: RunnableConfig): Promise<string> => {
      const append = input.append ?? false;
      if (!append) {
        const maxBytes = effectiveWriteFileMaxBytes();
        if (maxBytes > 0) {
          const contentBytes = Buffer.byteLength(input.content, "utf-8");
          if (contentBytes > maxBytes) {
            return (
              `Error: write_file content (${contentBytes} bytes) exceeds the ` +
              `${maxBytes}-byte single-call limit. Split the content into smaller ` +
              "pieces: either (a) write the first section now, then use `str_replace` " +
              "for further edits, or (b) call write_file again with append=True " +
              "carrying the next section. See SIZE POLICY in the tool docstring " +
              "or issue #3189 for the rationale."
            );
          }
        }
      }
      try {
        const sandbox = await acquire(config);
        await withFileOperationLock({ id: sandbox.id }, input.path, () => {
          sandbox.writeFile(input.path, input.content, append);
        });
        return "OK";
      } catch (err) {
        const code = errorCode(err);
        if (err instanceof Error && err.name.includes("Permission")) {
          return `Error: Permission denied writing to file: ${input.path}`;
        }
        if (code === "EISDIR") return `Error: Path is a directory, not a file: ${input.path}`;
        const header = `Error: Failed to write file '${input.path}'`;
        const detail = errorMessage(err).slice(0, DEFAULT_WRITE_FILE_ERROR_MAX_CHARS);
        return `${header}: ${detail}`;
      }
    },
    {
      name: "write_file",
      description: [
        "Write text content to a file. By default this overwrites the target file; set append=True to add content to the end without replacing existing content.",
        "",
        "SIZE POLICY (issue #3189): a single non-append write_file call must not exceed 80 KB of UTF-8 content. For larger documents, either write the first section then use `str_replace` for further edits, or append in chunks with append=True (the cap does not apply to append=True).",
      ].join("\n"),
      schema: writeFileSchema,
    },
  );

  const strReplace = tool(
    async (input: z.infer<typeof strReplaceSchema>, config?: RunnableConfig): Promise<string> => {
      try {
        const sandbox = await acquire(config);
        const outcome = await withFileOperationLock({ id: sandbox.id }, input.path, () =>
          sandbox.strReplace(input.path, input.old_str, input.new_str, input.replace_all ?? false),
        );
        if (outcome === "not_found") {
          return `Error: String to replace not found in file: ${input.path}`;
        }
        return "OK";
      } catch (err) {
        const code = errorCode(err);
        if (code === "ENOENT") return `Error: File not found: ${input.path}`;
        if (err instanceof Error && err.name.includes("Permission")) {
          return `Error: Permission denied accessing file: ${input.path}`;
        }
        return `Error: Unexpected error replacing string: ${errorMessage(err)}`;
      }
    },
    {
      name: "str_replace",
      description: [
        "Replace a substring in a file with another substring.",
        "If `replace_all` is False (default), the substring to replace must appear **exactly once** in the file.",
      ].join("\n"),
      schema: strReplaceSchema,
    },
  );

  return [bash, ls, glob, grep, readFile, writeFile, strReplace];
}
