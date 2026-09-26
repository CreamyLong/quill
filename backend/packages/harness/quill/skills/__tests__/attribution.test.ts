/**
 * Tests for skill attribution (OpenWork sync).
 *
 * Covers activation tracking, tool-use attribution, contribution inference
 * from answer text, summary lines, and seeding from thread state.
 */

import { describe, expect, it } from "vitest";

import {
  SkillAttributionTracker,
  seedFromState,
  type SkillContextState,
} from "../attribution.js";

describe("SkillAttributionTracker", () => {
  it("tracks activations and re-activations", () => {
    const tracker = new SkillAttributionTracker();
    tracker.trackActivation({ name: "pdf", description: "extract text from PDF files" });
    tracker.trackActivation({ name: "pdf" });

    const all = tracker.all();
    expect(all).toHaveLength(1);
    expect(all[0].activations).toBe(2);
    expect(all[0].description).toBe("extract text from PDF files");
  });

  it("attributes tool uses to the most recently activated skill", () => {
    const tracker = new SkillAttributionTracker();
    tracker.trackActivation({ name: "xlsx" });
    tracker.trackToolUse();
    tracker.trackToolUse();
    tracker.trackActivation({ name: "pdf" });
    tracker.trackToolUse();

    const byName = Object.fromEntries(tracker.all().map((r) => [r.skill, r]));
    expect(byName.xlsx.toolUses).toBe(2);
    expect(byName.pdf.toolUses).toBe(1);
  });

  it("tool uses alone mark a skill as contributed", () => {
    const tracker = new SkillAttributionTracker();
    tracker.trackActivation({ name: "xlsx" });
    tracker.trackToolUse();

    const summary = tracker.recordAnswer("Here is your data.");
    expect(summary.skills.map((s) => s.skill)).toEqual(["xlsx"]);
    expect(summary.line).toBe("Skills used: xlsx");
    expect(summary.skills[0].evidence).toContain("tool call");
  });

  it("infers contribution when the skill is named in the answer", () => {
    const tracker = new SkillAttributionTracker();
    tracker.trackActivation({ name: "latex-posters" });

    const summary = tracker.recordAnswer("I used the latex posters workflow to draft your poster.");
    expect(summary.skills).toHaveLength(1);
    expect(summary.skills[0].evidence).toContain("named in the answer");
  });

  it("infers contribution from salient description terms", () => {
    const tracker = new SkillAttributionTracker();
    tracker.trackActivation({ name: "docgen", description: "produce DOCX documents with tracked revisions" });

    const summary = tracker.recordAnswer("I produced the DOCX documents you asked for.");
    expect(summary.skills).toHaveLength(1);
    expect(summary.skills[0].evidence).toContain("subject");
  });

  it("does not attribute skills that never touched the answer", () => {
    const tracker = new SkillAttributionTracker();
    tracker.trackActivation({ name: "pdf", description: "extract text from PDF files" });
    tracker.trackActivation({ name: "xlsx" });
    tracker.trackToolUse();

    const summary = tracker.recordAnswer("Here is the spreadsheet.");
    expect(summary.skills.map((s) => s.skill)).toEqual(["xlsx"]);
  });

  it("supports explicit contribution marks", () => {
    const tracker = new SkillAttributionTracker();
    tracker.trackActivation({ name: "plotly" });
    tracker.markContributed("plotly", "chart embedded in response");

    const summary = tracker.recordAnswer("Here is the chart.");
    expect(summary.skills[0].evidence).toBe("chart embedded in response");
  });

  it("returns no line when nothing contributed", () => {
    const tracker = new SkillAttributionTracker();
    tracker.trackActivation({ name: "pdf" });
    const summary = tracker.recordAnswer("Hello!");
    expect(summary.skills).toEqual([]);
    expect(summary.line).toBeUndefined();
  });

  it("orders contributed skills by tool use then activation", () => {
    const tracker = new SkillAttributionTracker();
    tracker.trackActivation({ name: "a" });
    tracker.trackToolUse();
    tracker.trackActivation({ name: "b" });
    tracker.trackToolUse();
    tracker.trackToolUse();
    tracker.markContributed("a", "x");
    tracker.markContributed("b", "y");

    expect(tracker.summary().skills.map((s) => s.skill)).toEqual(["b", "a"]);
  });
});

describe("seedFromState", () => {
  it("seeds the tracker from skill_context in load order", () => {
    const tracker = new SkillAttributionTracker();
    const state: SkillContextState = {
      skill_context: [
        { name: "second", path: "/skills/second", description: "", loaded_at: 200 },
        { name: "first", path: "/skills/first", description: "", loaded_at: 100 },
      ],
    };

    seedFromState(tracker, state);
    expect(tracker.size).toBe(2);
    // Most recent activation is "second" (loaded last).
    tracker.trackToolUse();
    const byName = Object.fromEntries(tracker.all().map((r) => [r.skill, r]));
    expect(byName.second.toolUses).toBe(1);
    expect(byName.first.toolUses).toBe(0);
  });

  it("handles missing skill_context", () => {
    const tracker = new SkillAttributionTracker();
    seedFromState(tracker, {});
    expect(tracker.size).toBe(0);
  });
});
