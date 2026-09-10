/**
 * Tests for manual context compaction middleware.
 */

import { describe, expect, it } from "vitest";
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from "@langchain/core/messages";

import {
  isCompactCommand,
  buildSummaryPrompt,
  COMPACT_COMMAND,
  COMPACT_COMMAND_PATTERN,
} from "../compact_middleware.js";

// Re-export buildSummaryPrompt for testing (it's not exported, so test via isCompactCommand)

describe("compact middleware", () => {
  describe("COMPACT_COMMAND_PATTERN", () => {
    it("matches /compact", () => {
      expect(COMPACT_COMMAND_PATTERN.test("/compact")).toBe(true);
    });

    it("matches /compact 5", () => {
      expect(COMPACT_COMMAND_PATTERN.test("/compact 5")).toBe(true);
    });

    it("does not match /compact-foo", () => {
      expect(COMPACT_COMMAND_PATTERN.test("/compact-foo")).toBe(false);
    });

    it("does not match 'please /compact'", () => {
      expect(COMPACT_COMMAND_PATTERN.test("please /compact")).toBe(false);
    });
  });

  describe("isCompactCommand", () => {
    it("returns false for empty messages", () => {
      expect(isCompactCommand([])).toEqual({ isCompact: false });
    });

    it("detects /compact in last human message", () => {
      const messages = [
        new HumanMessage({ content: "/compact" }),
      ];
      const result = isCompactCommand(messages);
      expect(result.isCompact).toBe(true);
      expect(result.keepCount).toBeUndefined();
    });

    it("detects /compact with keep count", () => {
      const messages = [
        new HumanMessage({ content: "/compact 8" }),
      ];
      const result = isCompactCommand(messages);
      expect(result.isCompact).toBe(true);
      expect(result.keepCount).toBe(8);
    });

    it("returns false when last human message is not /compact", () => {
      const messages = [
        new HumanMessage({ content: "/compact" }),
        new HumanMessage({ content: "Hello" }),
      ];
      const result = isCompactCommand(messages);
      expect(result.isCompact).toBe(false);
    });

    it("ignores /compact in non-last human message", () => {
      const messages = [
        new HumanMessage({ content: "/compact" }),
        new AIMessage({ content: "some response" }),
        new HumanMessage({ content: "new question" }),
      ];
      const result = isCompactCommand(messages);
      expect(result.isCompact).toBe(false);
    });

    it("handles system messages correctly", () => {
      const messages = [
        new SystemMessage({ content: "system prompt" }),
        new HumanMessage({ content: "/compact" }),
      ];
      const result = isCompactCommand(messages);
      expect(result.isCompact).toBe(true);
    });
  });
});
