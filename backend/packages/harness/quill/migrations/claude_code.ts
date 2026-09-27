/**
 * Claude Code Session Migration — import Claude Code conversations as Quill
 * threads.
 *
 * Ported from ZCode's `claudeNativeSessionImportRepo` / `claudeNativeSessionImportParser`:
 * scan `~/.claude/projects` for native JSONL session files, parse them
 * tolerantly into a normalized message history, and hand them to an injected
 * thread creator that stamps the `migrationSource: "claudeCode"` origin tag.
 *
 * Claude Code stores each session as one JSONL file under
 * `~/.claude/projects/<munged-cwd>/<session-uuid>.jsonl`. Each line is an
 * event: `{"type": "user"|"assistant"|"summary"|"system"|"result", ...}`.
 * The parser is deliberately tolerant of schema drift across Claude Code
 * versions: malformed lines are skipped, message content may be a plain
 * string or an array of content blocks, and unknown event types are counted
 * but not fatal.
 *
 * @module migrations/claude_code
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A scannable Claude Code session file. */
export interface ClaudeCodeSessionSummary {
  /** Session UUID (file stem). */
  sessionId: string;
  /** Best-effort original working directory (un-munged project dir name). */
  projectPath: string;
  /** Absolute path to the JSONL file. */
  filePath: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** Last modified time (ISO). */
  modifiedAt: string;
}

/** One normalized message from an imported session. */
export interface ImportedMessage {
  role: "user" | "assistant";
  /** Extracted text content (content-block text joined). */
  content: string;
  /** ISO timestamp when present in the source event. */
  timestamp?: string;
  /** Number of non-text blocks (tool_use / tool_result) in the source message. */
  toolBlockCount: number;
}

/** A parsed Claude Code session, ready for import. */
export interface ImportedClaudeSession {
  sessionId: string;
  projectPath: string;
  messages: ImportedMessage[];
  /** First message timestamp (ISO) when known. */
  startedAt?: string;
  /** Last message timestamp (ISO) when known. */
  endedAt?: string;
  /** Working directory recorded in the session, when present. */
  cwd?: string;
  /** Session summary line, when the file carries one. */
  summary?: string;
  /** Lines skipped as malformed (schema-drift tolerance metric). */
  skippedLines: number;
}

/** Result of importing one session into Quill. */
export interface MigrationResult {
  /** Quill thread id of the created thread. */
  threadId: string;
  /** Origin tag stamped on the thread. */
  migrationSource: "claudeCode";
  /** Number of messages imported. */
  messageCount: number;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/** Default root that Claude Code stores projects under. */
export function defaultClaudeProjectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/**
 * Un-munge a Claude Code project directory name back to a path:
 * `-Users-Long-projects-foo` → `/Users/Long/projects/foo` (the leading dash
 * is the root slash).
 */
export function unmungeProjectDir(dirName: string): string {
  if (!dirName.startsWith("-")) {
    return dirName;
  }
  return dirName.replace(/-/g, "/");
}

/**
 * Scan `~/.claude/projects` (or an explicit root) for importable session
 * files. Empty files are skipped; results are newest-first.
 */
export function scanClaudeCodeSessions(projectsDir: string = defaultClaudeProjectsDir()): ClaudeCodeSessionSummary[] {
  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  const sessions: ClaudeCodeSessionSummary[] = [];
  for (const dirName of projectDirs) {
    const dirPath = path.join(projectsDir, dirName);
    let files: string[];
    try {
      files = fs.readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) {
        continue;
      }
      const filePath = path.join(dirPath, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.size === 0) {
          continue;
        }
        sessions.push({
          sessionId: path.basename(file, ".jsonl"),
          projectPath: unmungeProjectDir(dirName),
          filePath,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch {
        continue;
      }
    }
  }

  sessions.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return sessions;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Extract text from a Claude message content value (string | block array). */
function extractContent(content: unknown): { text: string; toolBlocks: number } {
  if (typeof content === "string") {
    return { text: content, toolBlocks: 0 };
  }
  if (!Array.isArray(content)) {
    return { text: "", toolBlocks: 0 };
  }
  const texts: string[] = [];
  let toolBlocks = 0;
  for (const block of content) {
    if (block !== null && typeof block === "object") {
      const kind = (block as { type?: unknown }).type;
      if (kind === "text" && typeof (block as { text?: unknown }).text === "string") {
        texts.push((block as { text: string }).text);
      } else if (kind === "tool_use" || kind === "tool_result") {
        toolBlocks += 1;
      }
    }
  }
  return { text: texts.join("\n"), toolBlocks };
}

/**
 * Parse one Claude Code session JSONL (full file content) into a normalized
 * session. Tolerant: malformed lines are skipped and counted, unknown event
 * types are ignored, and message content may be either shape.
 */
export function parseClaudeCodeSessionFile(
  content: string,
  meta: { sessionId: string; projectPath: string },
): ImportedClaudeSession {
  const messages: ImportedMessage[] = [];
  let skippedLines = 0;
  let summary: string | undefined;
  let cwd: string | undefined;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      skippedLines += 1;
      continue;
    }

    const type = event.type;
    if (type === "summary" && typeof event.summary === "string") {
      summary = event.summary;
      continue;
    }
    if (type !== "user" && type !== "assistant") {
      continue;
    }

    const message = event.message as Record<string, unknown> | undefined;
    if (message === null || typeof message !== "object") {
      skippedLines += 1;
      continue;
    }
    const { text, toolBlocks } = extractContent(message.content);
    if (text.trim() === "" && toolBlocks === 0) {
      skippedLines += 1;
      continue;
    }
    if (typeof event.cwd === "string") {
      cwd = event.cwd;
    }
    messages.push({
      role: type,
      content: text,
      timestamp: typeof event.timestamp === "string" ? event.timestamp : undefined,
      toolBlockCount: toolBlocks,
    });
  }

  const timestamps = messages
    .map((m) => m.timestamp)
    .filter((t): t is string => t !== undefined)
    .sort();

  return {
    sessionId: meta.sessionId,
    projectPath: meta.projectPath,
    messages,
    startedAt: timestamps[0],
    endedAt: timestamps[timestamps.length - 1],
    cwd,
    summary,
    skippedLines,
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Injected thread creator: the gateway wires this to its thread repository. */
export type CreateThreadFromHistory = (input: {
  name: string;
  messages: ImportedMessage[];
  migrationSource: "claudeCode";
  metadata: { sessionId: string; projectPath: string; startedAt?: string; endedAt?: string; summary?: string };
}) => Promise<{ threadId: string }>;

/**
 * Import one scanned session file: read, parse, and create a Quill thread
 * with the imported history stamped `migrationSource: "claudeCode"`.
 */
export async function migrateClaudeCodeSession(
  summary: ClaudeCodeSessionSummary,
  createThread: CreateThreadFromHistory,
): Promise<MigrationResult> {
  const content = fs.readFileSync(summary.filePath, "utf-8");
  const imported = parseClaudeCodeSessionFile(content, {
    sessionId: summary.sessionId,
    projectPath: summary.projectPath,
  });
  const name =
    imported.summary !== undefined && imported.summary.trim() !== ""
      ? imported.summary.trim().slice(0, 80)
      : `Claude Code session ${summary.sessionId.slice(0, 8)}`;
  const created = await createThread({
    name,
    messages: imported.messages,
    migrationSource: "claudeCode",
    metadata: {
      sessionId: imported.sessionId,
      projectPath: imported.projectPath,
      startedAt: imported.startedAt,
      endedAt: imported.endedAt,
      summary: imported.summary,
    },
  });
  return {
    threadId: created.threadId,
    migrationSource: "claudeCode",
    messageCount: imported.messages.length,
  };
}
