/**
 * Tests for skill_manage tool — self-improving skill system.
 */

import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { createSkillManageTool } from "../skill_manage_tool.js";
import { LocalSkillStorage } from "../../skills/storage/local_skill_storage.js";

// ---------------------------------------------------------------------------
// Helpers ---------------------------------------------------------------------------

const VALID_SKILL_CONTENT = `---
name: test-skill
description: A test skill for unit testing
---

# Test Skill

This is a test skill body with instructions.
`;

const VALID_SKILL_CONTENT_2 = `---
name: another-skill
description: Another test skill
---

# Another Skill

Different content here.
`;

/** Create a temp directory with a valid skills root structure. */
function createTempSkillsRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quill-skill-test-"));
  fs.mkdirSync(path.join(tmp, "custom"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "public"), { recursive: true });
  return tmp;
}

/** Mock scan function that always allows. */
async function mockAllowScan(_content: string): Promise<{ decision: string; reason: string }> {
  return { decision: "allow", reason: "test mock" };
}

/** Mock scan function that always blocks. */
async function mockBlockScan(_content: string): Promise<{ decision: string; reason: string }> {
  return { decision: "block", reason: "test block" };
}

// ---------------------------------------------------------------------------
// Tests ---------------------------------------------------------------------------

describe("skill_manage tool", () => {
  describe("create", () => {
    it("creates a new custom skill with valid content", async () => {
      const root = createTempSkillsRoot();
      const tool = createSkillManageTool({ scanFn: mockAllowScan, skillsPath: root });

      const result = await tool.invoke({
        operation: "create",
        name: "test-skill",
        content: VALID_SKILL_CONTENT,
        reason: "Testing skill creation",
      });

      const parsed = JSON.parse(result);
      expect(parsed.ok).toBe(true);
      expect(parsed.skill_name).toBe("test-skill");

      // Verify file was written.
      const skillFile = path.join(root, "custom", "test-skill", "SKILL.md");
      expect(fs.existsSync(skillFile)).toBe(true);
      expect(fs.readFileSync(skillFile, "utf-8")).toBe(VALID_SKILL_CONTENT);
    });

    it("rejects create when skill already exists", async () => {
      const root = createTempSkillsRoot();
      const tool = createSkillManageTool({ scanFn: mockAllowScan, skillsPath: root });

      // Create first time.
      await tool.invoke({
        operation: "create",
        name: "test-skill",
        content: VALID_SKILL_CONTENT,
      });

      // Try to create again.
      const result = await tool.invoke({
        operation: "create",
        name: "test-skill",
        content: VALID_SKILL_CONTENT,
      });

      const parsed = JSON.parse(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("already exists");
    });

    it("rejects create when security scan blocks", async () => {
      const root = createTempSkillsRoot();
      const tool = createSkillManageTool({ scanFn: mockBlockScan, skillsPath: root });

      const result = await tool.invoke({
        operation: "create",
        name: "test-skill",
        content: VALID_SKILL_CONTENT,
      });

      const parsed = JSON.parse(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("Security scan blocked");
    });

    it("rejects create with invalid skill name", async () => {
      const root = createTempSkillsRoot();
      const tool = createSkillManageTool({ scanFn: mockAllowScan, skillsPath: root });

      const result = await tool.invoke({
        operation: "create",
        name: "Invalid_Name",
        content: VALID_SKILL_CONTENT,
      });

      const parsed = JSON.parse(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("Invalid skill name");
    });

    it("rejects create with missing content", async () => {
      const root = createTempSkillsRoot();
      const tool = createSkillManageTool({ scanFn: mockAllowScan, skillsPath: root });

      const result = await tool.invoke({
        operation: "create",
        name: "test-skill",
      });

      const parsed = JSON.parse(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("Content is required");
    });

    it("rejects create with mismatched frontmatter name", async () => {
      const root = createTempSkillsRoot();
      const tool = createSkillManageTool({ scanFn: mockAllowScan, skillsPath: root });

      const result = await tool.invoke({
        operation: "create",
        name: "different-name",
        content: VALID_SKILL_CONTENT, // frontmatter says "test-skill"
      });

      const parsed = JSON.parse(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("does not match");
    });
  });

  describe("patch", () => {
    it("updates an existing custom skill", async () => {
      const root = createTempSkillsRoot();
      const tool = createSkillManageTool({ scanFn: mockAllowScan, skillsPath: root });

      // Create first.
      await tool.invoke({
        operation: "create",
        name: "test-skill",
        content: VALID_SKILL_CONTENT,
      });

      // Patch with updated content.
      const updatedContent = `---
name: test-skill
description: Updated description
---

# Test Skill

Updated body.
`;

      const result = await tool.invoke({
        operation: "patch",
        name: "test-skill",
        content: updatedContent,
        reason: "Improved instructions",
      });

      const parsed = JSON.parse(result);
      expect(parsed.ok).toBe(true);

      const skillFile = path.join(root, "custom", "test-skill", "SKILL.md");
      expect(fs.readFileSync(skillFile, "utf-8")).toBe(updatedContent);
    });

    it("records history with previous content on patch", async () => {
      const root = createTempSkillsRoot();
      const tool = createSkillManageTool({ scanFn: mockAllowScan, skillsPath: root });

      await tool.invoke({
        operation: "create",
        name: "test-skill",
        content: VALID_SKILL_CONTENT,
      });

      const updatedContent = `---
name: test-skill
description: Updated description
---

# Updated
`;

      await tool.invoke({
        operation: "patch",
        name: "test-skill",
        content: updatedContent,
        reason: "Test patch",
      });

      const historyStorage = new LocalSkillStorage(root);
      const history = historyStorage.readHistory("test-skill");
      const patchEntry = history.find((h) => h.operation === "patch");
      expect(patchEntry).toBeDefined();
      expect(patchEntry?.prev_content).toBe(VALID_SKILL_CONTENT);
    });

    it("rejects patch for non-existent skill", async () => {
      const root = createTempSkillsRoot();
      const tool = createSkillManageTool({ scanFn: mockAllowScan, skillsPath: root });

      const result = await tool.invoke({
        operation: "patch",
        name: "nonexistent",
        content: VALID_SKILL_CONTENT,
      });

      const parsed = JSON.parse(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("not found");
    });
  });

  describe("improve", () => {
    it("works like patch but records improvement in history", async () => {
      const root = createTempSkillsRoot();
      const tool = createSkillManageTool({ scanFn: mockAllowScan, skillsPath: root });

      await tool.invoke({
        operation: "create",
        name: "test-skill",
        content: VALID_SKILL_CONTENT,
      });

      const improvedContent = `---
name: test-skill
description: Improved description
---

# Improved Skill

Better instructions here.
`;

      const result = await tool.invoke({
        operation: "improve",
        name: "test-skill",
        content: improvedContent,
        reason: "Learned better approach",
      });

      const parsed = JSON.parse(result);
      expect(parsed.ok).toBe(true);

      const historyStorage = new LocalSkillStorage(root);
      const history = historyStorage.readHistory("test-skill");
      const improveEntry = history.find((h) => h.operation === "improve");
      expect(improveEntry).toBeDefined();
      expect(improveEntry?.reason).toBe("Learned better approach");
    });
  });

  describe("delete", () => {
    it("deletes an existing custom skill", async () => {
      const root = createTempSkillsRoot();
      const tool = createSkillManageTool({ scanFn: mockAllowScan, skillsPath: root });

      await tool.invoke({
        operation: "create",
        name: "test-skill",
        content: VALID_SKILL_CONTENT,
      });

      const skillDir = path.join(root, "custom", "test-skill");
      expect(fs.existsSync(skillDir)).toBe(true);

      const result = await tool.invoke({
        operation: "delete",
        name: "test-skill",
        reason: "No longer needed",
      });

      const parsed = JSON.parse(result);
      expect(parsed.ok).toBe(true);
      expect(fs.existsSync(skillDir)).toBe(false);
    });

    it("rejects delete for non-existent skill", async () => {
      const root = createTempSkillsRoot();
      const tool = createSkillManageTool({ scanFn: mockAllowScan, skillsPath: root });

      const result = await tool.invoke({
        operation: "delete",
        name: "nonexistent",
      });

      const parsed = JSON.parse(result);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("not found");
    });
  });

  describe("edge cases", () => {
    it("throws on unknown operation (schema validation)", async () => {
      const root = createTempSkillsRoot();
      const tool = createSkillManageTool({ scanFn: mockAllowScan, skillsPath: root });

      // Schema validation rejects unknown operations before the handler runs.
      // LangChain's DynamicStructuredTool throws on schema mismatch.
      await expect(
        // @ts-expect-error Testing invalid operation
        tool.invoke({
          operation: "invalid_op",
          name: "test-skill",
        })
      ).rejects.toThrow("Invalid option");
    });

    it("writes history on create", async () => {
      const root = createTempSkillsRoot();
      const tool = createSkillManageTool({ scanFn: mockAllowScan, skillsPath: root });

      await tool.invoke({
        operation: "create",
        name: "test-skill",
        content: VALID_SKILL_CONTENT,
        reason: "First skill",
      });

      const historyStorage = new LocalSkillStorage(root);
      const history = historyStorage.readHistory("test-skill");
      expect(history.length).toBeGreaterThanOrEqual(1);
      const createEntry = history.find((h) => h.operation === "create");
      expect(createEntry).toBeDefined();
      expect(createEntry?.scan_decision).toBe("allow");
    });
  });
});
