/**
 * Tests for Claude Code session migration (ZCode sync).
 *
 * Covers project-dir scanning with real temp dirs, tolerant JSONL parsing
 * (string + block content, malformed lines, unknown types), and the import
 * pipeline with an injected thread creator.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  migrateClaudeCodeSession,
  parseClaudeCodeSessionFile,
  scanClaudeCodeSessions,
  unmungeProjectDir,
} from "../claude_code.js";

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quill-claude-mig-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("unmungeProjectDir", () => {
  it("un-munges Claude Code project dir names", () => {
    expect(unmungeProjectDir("-Users-Long-projects-foo")).toBe("/Users/Long/projects/foo");
    expect(unmungeProjectDir("plain-name")).toBe("plain-name");
  });
});

describe("scanClaudeCodeSessions", () => {
  it("finds JSONL sessions newest-first and skips empty files", () => {
    const root = makeTempDir();
    const projectDir = path.join(root, "-Users-x-proj");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "session-a.jsonl"), "{}\n");
    const older = path.join(projectDir, "session-b.jsonl");
    fs.writeFileSync(older, "{}\n");
    fs.utimesSync(older, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    fs.writeFileSync(path.join(projectDir, "empty.jsonl"), "");
    fs.writeFileSync(path.join(projectDir, "notes.txt"), "not a session");

    const sessions = scanClaudeCodeSessions(root);
    expect(sessions.map((s) => s.sessionId)).toEqual(["session-a", "session-b"]);
    expect(sessions[0].projectPath).toBe("/Users/x/proj");
    expect(sessions[0].sizeBytes).toBeGreaterThan(0);
  });

  it("returns an empty list when the root is missing", () => {
    expect(scanClaudeCodeSessions(path.join(makeTempDir(), "nope"))).toEqual([]);
  });
});

describe("parseClaudeCodeSessionFile", () => {
  const meta = { sessionId: "s1", projectPath: "/Users/x/proj" };

  it("parses string and block-array content", () => {
    const imported = parseClaudeCodeSessionFile(
      [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "fix the bug" },
          timestamp: "2026-09-01T10:00:00Z",
          cwd: "/Users/x/proj",
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "I'll fix it." },
              { type: "tool_use", id: "t1", name: "edit" },
            ],
          },
          timestamp: "2026-09-01T10:00:05Z",
        }),
      ].join("\n"),
      meta,
    );
    expect(imported.messages).toHaveLength(2);
    expect(imported.messages[0]).toEqual({
      role: "user",
      content: "fix the bug",
      timestamp: "2026-09-01T10:00:00Z",
      toolBlockCount: 0,
    });
    expect(imported.messages[1].content).toBe("I'll fix it.");
    expect(imported.messages[1].toolBlockCount).toBe(1);
    expect(imported.cwd).toBe("/Users/x/proj");
    expect(imported.startedAt).toBe("2026-09-01T10:00:00Z");
    expect(imported.endedAt).toBe("2026-09-01T10:00:05Z");
    expect(imported.skippedLines).toBe(0);
  });

  it("skips malformed lines and unknown event types without failing", () => {
    const imported = parseClaudeCodeSessionFile(
      [
        "{ this is not json",
        JSON.stringify({ type: "system", content: "hook fired" }),
        JSON.stringify({ type: "summary", summary: "Bug fixing session" }),
        JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }),
        JSON.stringify({ type: "assistant", message: null }),
      ].join("\n"),
      meta,
    );
    expect(imported.messages).toHaveLength(1);
    expect(imported.messages[0].content).toBe("hi");
    expect(imported.skippedLines).toBe(2); // bad json + null message
    expect(imported.summary).toBe("Bug fixing session");
  });

  it("skips messages with no extractable content", () => {
    const imported = parseClaudeCodeSessionFile(
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [] } }),
      meta,
    );
    expect(imported.messages).toHaveLength(0);
    expect(imported.skippedLines).toBe(1);
  });
});

describe("migrateClaudeCodeSession", () => {
  it("creates a thread with the imported history and origin tag", async () => {
    const root = makeTempDir();
    const projectDir = path.join(root, "-Users-x-proj");
    fs.mkdirSync(projectDir, { recursive: true });
    const file = path.join(projectDir, "session-1.jsonl");
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ type: "summary", summary: "Refactor sprint" }),
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "refactor the parser" },
          timestamp: "2026-09-01T10:00:00Z",
        }),
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: "done, tests pass" },
          timestamp: "2026-09-01T10:05:00Z",
        }),
      ].join("\n"),
    );
    const [summary] = scanClaudeCodeSessions(root);

    const created: unknown[] = [];
    const result = await migrateClaudeCodeSession(summary, async (input) => {
      created.push(input);
      return { threadId: "quill-thread-1" };
    });

    expect(result).toEqual({
      threadId: "quill-thread-1",
      migrationSource: "claudeCode",
      messageCount: 2,
    });
    const input = created[0] as {
      name: string;
      messages: Array<{ role: string }>;
      migrationSource: string;
      metadata: { sessionId: string; summary?: string };
    };
    expect(input.name).toBe("Refactor sprint");
    expect(input.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(input.migrationSource).toBe("claudeCode");
    expect(input.metadata.sessionId).toBe("session-1");
    expect(input.metadata.summary).toBe("Refactor sprint");
  });

  it("falls back to a session-id-based name when no summary exists", async () => {
    const root = makeTempDir();
    const projectDir = path.join(root, "-Users-x-proj");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "abcd1234-5678.jsonl"),
      JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }),
    );
    const [summary] = scanClaudeCodeSessions(root);
    const result = await migrateClaudeCodeSession(summary, async (input) => {
      expect(input.name).toContain("abcd1234");
      return { threadId: "t" };
    });
    expect(result.messageCount).toBe(1);
  });
});
