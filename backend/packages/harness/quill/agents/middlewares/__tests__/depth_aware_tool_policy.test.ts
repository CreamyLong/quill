/**
 * Tests for depth-aware tool policy middleware.
 */

import { describe, expect, it } from "vitest";

import {
  toolsToRemoveAtDepth,
  filterToolsByDepth,
  CONTROL_PLANE_TOOLS,
  DELEGATION_TOOLS,
  MAX_SUBAGENT_DEPTH,
} from "../depth_aware_tool_policy_middleware.js";

function makeTool(name: string) {
  return { name, description: `Tool ${name}` };
}

describe("depth-aware tool policy", () => {
  describe("toolsToRemoveAtDepth", () => {
    it("removes nothing at depth 0", () => {
      const result = toolsToRemoveAtDepth(0);
      expect(result.size).toBe(0);
    });

    it("removes control-plane tools at depth 1", () => {
      const result = toolsToRemoveAtDepth(1);
      expect(result.has("setup_agent")).toBe(true);
      expect(result.has("update_agent")).toBe(true);
      expect(result.has("task")).toBe(false);
    });

    it("removes control-plane and delegation tools at depth 2", () => {
      const result = toolsToRemoveAtDepth(2);
      expect(result.has("setup_agent")).toBe(true);
      expect(result.has("update_agent")).toBe(true);
      expect(result.has("task")).toBe(true);
    });

    it("removes the same set at depth 3 (max)", () => {
      const result = toolsToRemoveAtDepth(3);
      expect(result.has("setup_agent")).toBe(true);
      expect(result.has("update_agent")).toBe(true);
      expect(result.has("task")).toBe(true);
    });
  });

  describe("filterToolsByDepth", () => {
    const tools = [
      makeTool("bash"),
      makeTool("read_file"),
      makeTool("setup_agent"),
      makeTool("update_agent"),
      makeTool("task"),
      makeTool("web_search"),
    ];

    it("returns all tools at depth 0", () => {
      const result = filterToolsByDepth(tools, 0);
      expect(result.length).toBe(6);
    });

    it("removes control-plane tools at depth 1", () => {
      const result = filterToolsByDepth(tools, 1);
      const names = result.map((t) => (t as { name: string }).name);
      expect(names).toContain("bash");
      expect(names).toContain("read_file");
      expect(names).toContain("task");
      expect(names).toContain("web_search");
      expect(names).not.toContain("setup_agent");
      expect(names).not.toContain("update_agent");
    });

    it("removes control-plane and delegation at depth 2", () => {
      const result = filterToolsByDepth(tools, 2);
      const names = result.map((t) => (t as { name: string }).name);
      expect(names).toContain("bash");
      expect(names).toContain("web_search");
      expect(names).not.toContain("setup_agent");
      expect(names).not.toContain("update_agent");
      expect(names).not.toContain("task");
    });

    it("preserves non-structured-tool entries", () => {
      const mixed = [makeTool("bash"), "string-entry", 42, null];
      const result = filterToolsByDepth(mixed, 2);
      // bash is not in the removal set at depth 2 (only setup_agent, update_agent, task are).
      // Non-tool entries ("string-entry", 42, null) are always preserved.
      expect(result.length).toBe(4);
      expect(result).toContain("string-entry");
      expect(result).toContain(42);
      expect(result).toContain(null);
    });

    it("returns original array when nothing is removed", () => {
      const result = filterToolsByDepth(tools, 0);
      expect(result).toBe(tools);
    });
  });

  describe("constants", () => {
    it("CONTROL_PLANE_TOOLS contains expected names", () => {
      expect(CONTROL_PLANE_TOOLS.has("setup_agent")).toBe(true);
      expect(CONTROL_PLANE_TOOLS.has("update_agent")).toBe(true);
    });

    it("DELEGATION_TOOLS contains expected names", () => {
      expect(DELEGATION_TOOLS.has("task")).toBe(true);
    });

    it("MAX_SUBAGENT_DEPTH is 3", () => {
      expect(MAX_SUBAGENT_DEPTH).toBe(3);
    });
  });
});
