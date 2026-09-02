/**
 * Tests for the evaluation runner.
 *
 * Verifies the core orchestration: task execution, scoring, pass^k trials,
 * and report aggregation.
 */

import { describe, it, expect, vi } from "vitest";

import { runBenchmark, type BenchmarkSuite } from "../runner.js";
import type { EvalRunner, EvalTask, EvalTaskResult } from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTask(id: string, scoring: EvalTask["scoring"], expectedAnswer?: string): EvalTask {
  return {
    id,
    name: `Task ${id}`,
    category: "test",
    prompt: `Prompt for ${id}`,
    expectedAnswer,
    scoring,
  };
}

function makeResult(taskId: string, response: string): EvalTaskResult {
  return {
    taskId,
    response,
    artifacts: [],
    artifactContents: {},
    tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    durationMs: 100,
    turns: 1,
    interrupted: false,
  };
}

/**
 * Create a mock runner that returns predefined responses for each task.
 */
function makeMockRunner(responses: Record<string, string>): EvalRunner {
  return async (task: EvalTask): Promise<EvalTaskResult> => {
    const response = responses[task.id] ?? "default response";
    return makeResult(task.id, response);
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runBenchmark", () => {
  it("runs all tasks and produces a report", async () => {
    const suite: BenchmarkSuite = {
      name: "test-suite",
      tasks: [
        makeTask("t1", { type: "exact_match" }, "hello"),
        makeTask("t2", { type: "exact_match" }, "world"),
      ],
    };

    const runner = makeMockRunner({
      t1: "hello",
      t2: "world",
    });

    const report = await runBenchmark({ runner, suite });

    expect(report.meta.taskCount).toBe(2);
    expect(report.results).toHaveLength(2);
    expect(report.summary.passRate).toBe(1);
    expect(report.summary.meanScore).toBe(1);
  });

  it("correctly computes pass rate for mixed results", async () => {
    const suite: BenchmarkSuite = {
      name: "mixed-suite",
      tasks: [
        makeTask("t1", { type: "exact_match" }, "correct"),
        makeTask("t2", { type: "exact_match" }, "correct"),
        makeTask("t3", { type: "exact_match" }, "correct"),
      ],
    };

    const runner = makeMockRunner({
      t1: "correct",
      t2: "wrong answer",
      t3: "correct",
    });

    const report = await runBenchmark({ runner, suite });

    expect(report.summary.passRate).toBeCloseTo(2 / 3);
    expect(report.results.filter((r) => r.passed)).toHaveLength(2);
    expect(report.results.filter((r) => !r.passed)).toHaveLength(1);
  });

  it("groups results by category", async () => {
    const suite: BenchmarkSuite = {
      name: "category-suite",
      tasks: [
        { ...makeTask("t1", { type: "exact_match" }, "ok"), category: "math" },
        { ...makeTask("t2", { type: "exact_match" }, "ok"), category: "math" },
        { ...makeTask("t3", { type: "exact_match" }, "ok"), category: "coding" },
      ],
    };

    const runner = makeMockRunner({
      t1: "ok",
      t2: "ok",
      t3: "wrong",
    });

    const report = await runBenchmark({ runner, suite });

    expect(report.summary.byCategory).toHaveProperty("math");
    expect(report.summary.byCategory).toHaveProperty("coding");
    // Using type assertion since byCategory is Record<string, CategoryStats>
    const mathStats = report.summary.byCategory["math"] as { passRate: number };
    const codingStats = report.summary.byCategory["coding"] as { passRate: number };
    expect(mathStats.passRate).toBe(1);
    expect(codingStats.passRate).toBe(0);
  });

  it("supports pass^k trials", async () => {
    const suite: BenchmarkSuite = {
      name: "trials-suite",
      trialsPerTask: 3,
      tasks: [makeTask("t1", { type: "exact_match" }, "yes")],
    };

    // Runner that fails on the second trial.
    let callCount = 0;
    const runner: EvalRunner = async (task: EvalTask): Promise<EvalTaskResult> => {
      callCount++;
      const response = callCount === 2 ? "no" : "yes";
      return makeResult(task.id, response);
    };

    const report = await runBenchmark({ runner, suite });

    // Task should fail because not all 3 trials passed.
    expect(report.results[0].passed).toBe(false);
    expect(report.results[0].reason).toContain("1/3");
  });

  it("calls progress callbacks", async () => {
    const suite: BenchmarkSuite = {
      name: "callback-suite",
      tasks: [makeTask("t1", { type: "exact_match" }, "ok")],
    };

    const runner = makeMockRunner({ t1: "ok" });

    const onTrialStart = vi.fn();
    const onTaskComplete = vi.fn();

    await runBenchmark({
      runner,
      suite,
      onTrialStart,
      onTaskComplete,
    });

    expect(onTrialStart).toHaveBeenCalledTimes(1);
    expect(onTaskComplete).toHaveBeenCalledTimes(1);
  });

  it("handles runner errors gracefully", async () => {
    const suite: BenchmarkSuite = {
      name: "error-suite",
      tasks: [makeTask("t1", { type: "exact_match" }, "ok")],
    };

    const runner: EvalRunner = async (): Promise<EvalTaskResult> => {
      throw new Error("Agent crashed");
    };

    await expect(runBenchmark({ runner, suite })).rejects.toThrow("Agent crashed");
  });

  it("aggregates token usage and duration", async () => {
    const suite: BenchmarkSuite = {
      name: "usage-suite",
      tasks: [makeTask("t1", { type: "exact_match" }, "ok")],
    };

    const runner = makeMockRunner({ t1: "ok" });

    const report = await runBenchmark({ runner, suite });

    expect(report.summary.totalTokens).toBe(15);
    expect(report.summary.totalDurationMs).toBe(100);
  });
});
