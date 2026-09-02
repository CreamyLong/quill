/**
 * Tests for built-in evaluation scorers.
 *
 * Mirrors the awesome-harness-engineering principle: "eval criteria written
 * before the task starts, not after." These tests define the expected
 * behavior of each scorer so they serve as both tests and documentation.
 */

import { describe, it, expect } from "vitest";

import { exactMatchScorer } from "../scorers/exact_match.js";
import { containsScorer } from "../scorers/contains.js";
import { regexScorer } from "../scorers/regex.js";
import { artifactExistsScorer } from "../scorers/artifact_exists.js";
import { artifactContentScorer } from "../scorers/artifact_content.js";
import type { EvalTask, EvalTaskResult } from "../types.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<EvalTask> & { scoring: EvalTask["scoring"] }): EvalTask {
  return {
    id: "test-1",
    name: "Test Task",
    category: "test",
    prompt: "What is 2+2?",
    ...overrides,
  };
}

function makeResult(overrides: Partial<EvalTaskResult> = {}): EvalTaskResult {
  return {
    taskId: "test-1",
    response: "The answer is 4",
    artifacts: [],
    artifactContents: {},
    tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    durationMs: 100,
    turns: 1,
    interrupted: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Exact match
// ---------------------------------------------------------------------------

describe("exactMatchScorer", () => {
  it("passes when response matches expected answer (case-insensitive)", () => {
    const task = makeTask({
      scoring: { type: "exact_match" },
      expectedAnswer: "the answer is 4",
    });
    const result = makeResult();
    const score = exactMatchScorer.score(task, result);
    expect(score.passed).toBe(true);
    expect(score.score).toBe(1);
  });

  it("fails when response does not match expected answer", () => {
    const task = makeTask({
      scoring: { type: "exact_match" },
      expectedAnswer: "5",
    });
    const result = makeResult();
    const score = exactMatchScorer.score(task, result);
    expect(score.passed).toBe(false);
    expect(score.score).toBe(0);
  });

  it("normalizes whitespace by default", () => {
    const task = makeTask({
      scoring: { type: "exact_match" },
      expectedAnswer: "the  answer   is  4",
    });
    const result = makeResult();
    const score = exactMatchScorer.score(task, result);
    expect(score.passed).toBe(true);
  });

  it("respects case sensitivity when configured", () => {
    const task = makeTask({
      scoring: { type: "exact_match", ignoreCase: false },
      expectedAnswer: "THE ANSWER IS 4",
    });
    const result = makeResult();
    const score = exactMatchScorer.score(task, result);
    expect(score.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Contains
// ---------------------------------------------------------------------------

describe("containsScorer", () => {
  it("passes when response contains the required substring", () => {
    const task = makeTask({
      scoring: { type: "contains", substring: "answer" },
    });
    const result = makeResult();
    const score = containsScorer.score(task, result);
    expect(score.passed).toBe(true);
  });

  it("fails when response does not contain the substring", () => {
    const task = makeTask({
      scoring: { type: "contains", substring: "banana" },
    });
    const result = makeResult();
    const score = containsScorer.score(task, result);
    expect(score.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Regex
// ---------------------------------------------------------------------------

describe("regexScorer", () => {
  it("passes when response matches the regex", () => {
    const task = makeTask({
      scoring: { type: "regex", pattern: "\\d+" },
    });
    const result = makeResult();
    const score = regexScorer.score(task, result);
    expect(score.passed).toBe(true);
  });

  it("fails when response does not match the regex", () => {
    const task = makeTask({
      scoring: { type: "regex", pattern: "^[A-Z]+$" },
    });
    const result = makeResult();
    const score = regexScorer.score(task, result);
    expect(score.passed).toBe(false);
  });

  it("handles invalid regex gracefully", () => {
    const task = makeTask({
      scoring: { type: "regex", pattern: "[invalid" },
    });
    const result = makeResult();
    const score = regexScorer.score(task, result);
    expect(score.passed).toBe(false);
    expect(score.reason).toContain("Invalid regex");
  });
});

// ---------------------------------------------------------------------------
// Artifact exists
// ---------------------------------------------------------------------------

describe("artifactExistsScorer", () => {
  it("passes when all required artifacts are produced", () => {
    const task = makeTask({
      scoring: { type: "artifact_exists", paths: ["output.txt", "report.md"] },
    });
    const result = makeResult({ artifacts: ["output.txt", "report.md", "extra.log"] });
    const score = artifactExistsScorer.score(task, result);
    expect(score.passed).toBe(true);
  });

  it("fails when some required artifacts are missing", () => {
    const task = makeTask({
      scoring: { type: "artifact_exists", paths: ["output.txt", "report.md"] },
    });
    const result = makeResult({ artifacts: ["output.txt"] });
    const score = artifactExistsScorer.score(task, result);
    expect(score.passed).toBe(false);
    expect(score.details).toMatchObject({ missing: ["report.md"] });
  });

  it("supports partial credit when allRequired is false", () => {
    const task = makeTask({
      scoring: { type: "artifact_exists", paths: ["a.txt", "b.txt", "c.txt"], allRequired: false },
    });
    const result = makeResult({ artifacts: ["a.txt"] });
    const score = artifactExistsScorer.score(task, result);
    expect(score.score).toBeCloseTo(1 / 3);
    expect(score.passed).toBe(true); // at least one found
  });
});

// ---------------------------------------------------------------------------
// Artifact content
// ---------------------------------------------------------------------------

describe("artifactContentScorer", () => {
  it("passes when artifact content matches expected", () => {
    const task = makeTask({
      scoring: { type: "artifact_content", path: "output.txt", expected: "hello world" },
    });
    const result = makeResult({ artifactContents: { "output.txt": "hello world" } });
    const score = artifactContentScorer.score(task, result);
    expect(score.passed).toBe(true);
  });

  it("fails when artifact is missing", () => {
    const task = makeTask({
      scoring: { type: "artifact_content", path: "output.txt", expected: "hello" },
    });
    const result = makeResult();
    const score = artifactContentScorer.score(task, result);
    expect(score.passed).toBe(false);
    expect(score.reason).toContain("not found");
  });

  it("fails when artifact content does not match", () => {
    const task = makeTask({
      scoring: { type: "artifact_content", path: "output.txt", expected: "hello" },
    });
    const result = makeResult({ artifactContents: { "output.txt": "goodbye" } });
    const score = artifactContentScorer.score(task, result);
    expect(score.passed).toBe(false);
  });
});
