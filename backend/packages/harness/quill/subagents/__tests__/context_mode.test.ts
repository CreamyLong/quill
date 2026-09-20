/**
 * Tests for Subagent Context Modes.
 */

import { describe, expect, it } from "vitest";
import {
  buildSubagentContext,
  suggestContextMode,
  type CoordinationTask,
} from "../context_mode.js";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";

describe("buildSubagentContext", () => {
  describe("isolated mode", () => {
    it("returns only the task message", () => {
      const result = buildSubagentContext({
        task: "Implement a function",
        mode: "isolated",
      });

      expect(result.mode).toBe("isolated");
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toBeInstanceOf(HumanMessage);
      expect(result.messages[0].content).toBe("Implement a function");
      expect(result.truncated).toBe(false);
    });

    it("ignores parent messages in isolated mode", () => {
      const parentMessages = [
        new HumanMessage("Previous message"),
        new AIMessage("Previous response"),
      ];

      const result = buildSubagentContext({
        task: "New task",
        mode: "isolated",
        parentMessages,
        compactionSummary: "Some summary",
      });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe("New task");
    });
  });

  describe("snapshot mode", () => {
    it("includes parent context frame", () => {
      const result = buildSubagentContext({
        task: "Continue work",
        mode: "snapshot",
        parentTitle: "Main Thread",
        compactionSummary: "Found the bug in line 42",
      });

      expect(result.mode).toBe("snapshot");
      expect(result.messages.length).toBeGreaterThan(1);

      // First message should be a system message with context
      expect(result.messages[0]).toBeInstanceOf(SystemMessage);
      const sysContent = result.messages[0].content as string;
      expect(sysContent).toContain("Main Thread");
      expect(sysContent).toContain("Found the bug in line 42");
    });

    it("includes recent parent messages", () => {
      const parentMessages = [
        new HumanMessage("Find the bug"),
        new AIMessage("The bug is in line 42"),
        new HumanMessage("Fix it"),
        new AIMessage("Fixed"),
      ];

      const result = buildSubagentContext({
        task: "Verify the fix",
        mode: "snapshot",
        parentMessages,
        snapshotMaxMessages: 10,
      });

      // System frame + parent messages + task
      expect(result.messages.length).toBeGreaterThanOrEqual(5);
    });

    it("truncates when exceeding max chars", () => {
      const longMessage = "x".repeat(5000);
      const parentMessages = [
        new HumanMessage(longMessage),
        new HumanMessage(longMessage),
        new HumanMessage(longMessage),
      ];

      const result = buildSubagentContext({
        task: "Task",
        mode: "snapshot",
        parentMessages,
        snapshotMaxChars: 1000,
      });

      expect(result.truncated).toBe(true);
    });

    it("always places the task last", () => {
      const result = buildSubagentContext({
        task: "THE_ACTUAL_TASK",
        mode: "snapshot",
        parentMessages: [new HumanMessage("Previous")],
        compactionSummary: "Summary",
      });

      const lastMsg = result.messages[result.messages.length - 1];
      expect(lastMsg.content).toBe("THE_ACTUAL_TASK");
    });
  });
});

describe("suggestContextMode", () => {
  it("suggests snapshot for continuation tasks", () => {
    expect(suggestContextMode("Continue working on the previous function")).toBe("snapshot");
    expect(suggestContextMode("Build on what we did earlier")).toBe("snapshot");
    expect(suggestContextMode("Fix the bug we found")).toBe("snapshot");
  });

  it("suggests snapshot for pronoun references", () => {
    expect(suggestContextMode("Refactor it to use async/await")).toBe("snapshot");
    expect(suggestContextMode("Update the class with new methods")).toBe("snapshot");
  });

  it("suggests isolated for self-contained tasks", () => {
    expect(suggestContextMode("Write a hello world function")).toBe("isolated");
    expect(suggestContextMode("Search for Python documentation")).toBe("isolated");
    expect(suggestContextMode("Calculate fibonacci numbers")).toBe("isolated");
  });
});
