/**
 * Tests for Progressive Skill Loading.
 */

import { describe, expect, it } from "vitest";
import { ProgressiveSkillLoader } from "../progressive_loader.js";
import type { Skill } from "../types.js";

function makeSkill(name: string, description: string, overrides: Partial<Skill> = {}): Skill {
  return {
    name,
    description,
    license: null,
    skillDir: `/skills/custom/${name}`,
    skillFile: `/skills/custom/${name}/SKILL.md`,
    relativePath: name,
    category: "custom",
    allowedTools: null,
    enabled: true,
    ...overrides,
  };
}

describe("ProgressiveSkillLoader", () => {
  const skills = [
    makeSkill("code-reviewer", "Reviews code for quality and best practices"),
    makeSkill("code-formatter", "Formats code according to style guides"),
    makeSkill("test-generator", "Generates unit tests for source code"),
    makeSkill("doc-writer", "Writes documentation for code and APIs"),
    makeSkill("security-auditor", "Audits code for security vulnerabilities"),
  ];

  describe("buildCatalog", () => {
    it("builds a catalog with all enabled skills", () => {
      const loader = new ProgressiveSkillLoader();
      const { entries, rendered } = loader.buildCatalog(skills);

      expect(entries).toHaveLength(5);
      expect(rendered).toContain("Skills Catalog");
      expect(rendered).toContain("code-reviewer");
      expect(rendered).toContain("Reviews code for quality");
    });

    it("excludes disabled skills", () => {
      const loader = new ProgressiveSkillLoader();
      const { entries } = loader.buildCatalog([
        ...skills,
        makeSkill("disabled-skill", "Disabled", { enabled: false }),
      ]);

      expect(entries).toHaveLength(5);
    });

    it("shows empty message when no skills", () => {
      const loader = new ProgressiveSkillLoader();
      const { rendered } = loader.buildCatalog([]);

      expect(rendered).toContain("No skills available");
    });
  });

  describe("loadLevel1", () => {
    it("loads full content for an existing skill", () => {
      const loader = new ProgressiveSkillLoader();
      const summary = loader.loadLevel1("code-reviewer", skills, () => {
        return "---\nname: code-reviewer\ndescription: Reviews code\n---\n# Code Review\n\nReview code for quality.";
      });

      expect(summary).not.toBeNull();
      expect(summary!.name).toBe("code-reviewer");
      expect(summary!.content).toContain("Review code for quality");
    });

    it("returns null for non-existent skill", () => {
      const loader = new ProgressiveSkillLoader();
      const summary = loader.loadLevel1("nonexistent", skills, () => "content");
      expect(summary).toBeNull();
    });

    it("returns null for disabled skill", () => {
      const loader = new ProgressiveSkillLoader();
      const summary = loader.loadLevel1(
        "disabled",
        [makeSkill("disabled", "Disabled", { enabled: false })],
        () => "content",
      );
      expect(summary).toBeNull();
    });

    it("tracks level 1 loaded skills", () => {
      const loader = new ProgressiveSkillLoader();
      loader.loadLevel1("code-reviewer", skills, () => "content");

      expect(loader.getLevel1Loaded().has("code-reviewer")).toBe(true);
    });
  });

  describe("rankSkills", () => {
    it("ranks skills by name match", () => {
      const loader = new ProgressiveSkillLoader();
      const { entries } = loader.buildCatalog(skills);
      const rankings = loader.rankSkills("code reviewer", entries);

      expect(rankings.length).toBeGreaterThan(0);
      expect(rankings[0].skill.name).toBe("code-reviewer");
    });

    it("ranks skills by description token overlap", () => {
      const loader = new ProgressiveSkillLoader();
      const { entries } = loader.buildCatalog(skills);
      const rankings = loader.rankSkills("security audit code", entries);

      expect(rankings.length).toBeGreaterThan(0);
      // security-auditor should be ranked highly
      const topNames = rankings.slice(0, 3).map((r) => r.skill.name);
      expect(topNames).toContain("security-auditor");
    });

    it("returns empty for no matches", () => {
      const loader = new ProgressiveSkillLoader();
      const { entries } = loader.buildCatalog(skills);
      const rankings = loader.rankSkills("xyz-nonexistent-query", entries);

      expect(rankings).toHaveLength(0);
    });

    it("respects maxResults limit", () => {
      const loader = new ProgressiveSkillLoader();
      const { entries } = loader.buildCatalog(skills);
      const rankings = loader.rankSkills("code", entries, 2);

      expect(rankings.length).toBeLessThanOrEqual(2);
    });
  });

  describe("reset", () => {
    it("clears level 1 loaded tracking", () => {
      const loader = new ProgressiveSkillLoader();
      loader.loadLevel1("code-reviewer", skills, () => "content");
      expect(loader.getLevel1Loaded().size).toBe(1);

      loader.reset();
      expect(loader.getLevel1Loaded().size).toBe(0);
    });
  });
});
