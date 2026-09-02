/**
 * Evaluation runner — orchestrates task execution and scoring.
 *
 * Mirrors DeepSeek-harness's runner architecture: loads tasks, dispatches
 * them through an agent adapter, scores results with pluggable scorers, and
 * aggregates into a report.
 *
 * Design principles (from awesome-harness-engineering):
 * - Deterministic ordering for reproducibility
 * - Pass^k support: require success across k independent trials
 * - Binary pass/fail per task + mean score across suite
 * - Isolated task execution with timeout enforcement
 * - Metadata pinning (git revision, config snapshot, model name)
 */

import { randomUUID } from "node:crypto";

import type {
  EvalEvent,
  EvalReport,
  EvalRunner,
  EvalScore,
  EvalScoringConfig,
  EvalSummary,
  EvalTask,
  EvalTaskResult,
  EvalTaskScore,
} from "./types.js";
import { resolveScorer } from "./scorers/composite.js";

// ---------------------------------------------------------------------------
// Benchmark definition
// ---------------------------------------------------------------------------

/**
 * A benchmark suite — a named collection of tasks with shared configuration.
 * Mirrors DeepSeek-harness's benchmark definition format.
 */
export interface BenchmarkSuite {
  name: string;
  description?: string;
  /** Tasks in this suite. */
  tasks: EvalTask[];
  /**
   * Number of independent trials required to consider a task "reliably
   * passing" (pass^k methodology). Default: 1.
   */
  trialsPerTask?: number;
  /** Concurrency limit for parallel task execution. Default: 1 (sequential). */
  maxConcurrency?: number;
  /** Shared timeout applied to all tasks unless overridden per-task. */
  defaultTimeoutSeconds?: number;
  /** Shared max turns applied to all tasks unless overridden per-task. */
  defaultMaxTurns?: number;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface EvalRunnerOptions {
  /** The agent runner — executes a single task and returns the result. */
  runner: EvalRunner;
  /** Suite to run. */
  suite: BenchmarkSuite;
  /** Human-readable runner name (e.g. "quill-lead-agent"). */
  runnerName?: string;
  /** LLM-judge scorer for tasks using llm_judge scoring. */
  judgeLlmCall?: (system: string, user: string, opts?: { model?: string; temperature?: number }) => Promise<string>;
  /** Progress callback. */
  onTaskComplete?: (task: EvalTask, result: EvalTaskResult, score: EvalScore) => void;
  /** Progress callback for trial starts. */
  onTrialStart?: (task: EvalTask, trial: number, totalTrials: number) => void;
}

/**
 * Run a benchmark suite against the configured agent runner.
 *
 * Executes tasks sequentially (or with bounded concurrency), scores each
 * result, and aggregates into a report. Supports pass^k trials for
 * statistical confidence.
 */
export async function runBenchmark(options: EvalRunnerOptions): Promise<EvalReport> {
  const {
    runner,
    suite,
    runnerName = "unknown-runner",
    judgeLlmCall,
    onTaskComplete,
    onTrialStart,
  } = options;

  const startedAt = new Date().toISOString();
  const runId = `eval_${randomUUID().slice(0, 8)}`;
  const trialsPerTask = suite.trialsPerTask ?? 1;
  const maxConcurrency = suite.maxConcurrency ?? 1;

  // Build the effective runner list: repeat each task trialsPerTask times.
  const runnerEntries: Array<{ task: EvalTask; trialIndex: number }> = [];
  for (const task of suite.tasks) {
    for (let i = 0; i < trialsPerTask; i++) {
      runnerEntries.push({ task, trialIndex: i });
    }
  }

  // Execute with bounded concurrency.
  const taskScores: EvalTaskScore[] = [];
  const resultsByTask = new Map<string, EvalTaskScore[]>();

  let cursor = 0;
  const workers = Array.from({ length: Math.min(maxConcurrency, runnerEntries.length) }, async () => {
    while (cursor < runnerEntries.length) {
      const idx = cursor++;
      const { task, trialIndex } = runnerEntries[idx];

      onTrialStart?.(task, trialIndex + 1, trialsPerTask);

      const result = await executeTask(runner, task, suite);
      const score = await scoreTask(task, result, judgeLlmCall);

      onTaskComplete?.(task, result, score);

      const taskScore: EvalTaskScore = {
        taskId: task.id,
        taskName: task.name,
        category: task.category,
        difficulty: task.difficulty,
        score: score.score,
        passed: score.passed,
        reason: score.reason,
        durationMs: result.durationMs,
        tokenUsage: result.tokenUsage,
        details: score.details,
      };

      // Collect per-task scores for pass^k aggregation.
      const existing = resultsByTask.get(task.id) ?? [];
      existing.push(trialIndex === 0 ? taskScore : { ...taskScore, taskId: `${task.id}#trial${trialIndex}` });
      resultsByTask.set(task.id, existing);

      // Only emit one entry per task (the first trial) in the report.
      // Additional trial scores contribute to pass^k but aren't listed separately.
      if (trialIndex === 0) {
        taskScores.push(taskScore);
      }
    }
  });

  await Promise.all(workers);

  // Apply pass^k: a task only passes if ALL trials passed.
  if (trialsPerTask > 1) {
    for (const score of taskScores) {
      const allTrials = resultsByTask.get(score.taskId) ?? [];
      const allPassed = allTrials.every((t) => t.passed);
      const meanScore = allTrials.reduce((s, t) => s + t.score, 0) / allTrials.length;
      score.passed = allPassed;
      score.score = meanScore;
      score.reason = allPassed
        ? `Passed all ${trialsPerTask} trials (mean score: ${meanScore.toFixed(2)})`
        : `Failed ${allTrials.filter((t) => !t.passed).length}/${trialsPerTask} trials`;
      score.details = {
        ...score.details,
        trialResults: allTrials.map((t) => ({ passed: t.passed, score: t.score })),
      };
    }
  }

  const finishedAt = new Date().toISOString();
  const summary = computeSummary(taskScores);

  return {
    meta: {
      runId,
      startedAt,
      finishedAt,
      runnerName,
      taskCount: suite.tasks.length,
    },
    results: taskScores,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Task execution
// ---------------------------------------------------------------------------

async function executeTask(
  runner: EvalRunner,
  task: EvalTask,
  suite: BenchmarkSuite,
): Promise<EvalTaskResult> {
  const timeoutSeconds = task.timeoutSeconds ?? suite.defaultTimeoutSeconds ?? 600;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    return await runner(task, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

async function scoreTask(
  task: EvalTask,
  result: EvalTaskResult,
  judgeLlmCall?: (system: string, user: string, opts?: { model?: string; temperature?: number }) => Promise<string>,
): Promise<EvalScore> {
  const config = task.scoring;

  // Special handling for llm_judge: requires the judge LLM call.
  if (config.type === "llm_judge") {
    if (!judgeLlmCall) {
      return { score: 0, passed: false, reason: "LLM judge scorer requested but no judgeLlmCall provided" };
    }
    const { createLlmJudgeScorer } = await import("./scorers/llm_judge.js");
    const scorer = createLlmJudgeScorer(judgeLlmCall);
    return scorer.score(task, result);
  }

  const scorer = resolveScorer(config);
  if (!scorer) {
    return { score: 0, passed: false, reason: `No scorer available for type "${config.type}"` };
  }
  return scorer.score(task, result);
}

// ---------------------------------------------------------------------------
// Summary computation
// ---------------------------------------------------------------------------

function computeSummary(scores: EvalTaskScore[]): EvalSummary {
  const byCategory: Record<string, CategoryAccumulator> = {};
  const byDifficulty: Record<string, CategoryAccumulator> = {};
  let totalTokens = 0;
  let totalDurationMs = 0;

  for (const s of scores) {
    // By category
    const cat = (byCategory[s.category] ??= { total: 0, passed: 0, scoreSum: 0 });
    cat.total++;
    cat.passed += s.passed ? 1 : 0;
    cat.scoreSum += s.score;

    // By difficulty
    const diffKey = s.difficulty ?? "unknown";
    const diff = (byDifficulty[diffKey] ??= { total: 0, passed: 0, scoreSum: 0 });
    diff.total++;
    diff.passed += s.passed ? 1 : 0;
    diff.scoreSum += s.score;

    totalTokens += s.tokenUsage.totalTokens;
    totalDurationMs += s.durationMs;
  }

  return {
    passRate: scores.length > 0 ? scores.filter((s) => s.passed).length / scores.length : 0,
    meanScore: scores.length > 0 ? scores.reduce((s, t) => s + t.score, 0) / scores.length : 0,
    byCategory: finalizeAccumulators(byCategory),
    byDifficulty: finalizeAccumulators(byDifficulty),
    totalTokens,
    totalDurationMs,
  };
}

interface CategoryAccumulator {
  total: number;
  passed: number;
  scoreSum: number;
}

function finalizeAccumulators(
  accs: Record<string, CategoryAccumulator>,
): import("./types.js").CategoryStats {
  const result: Record<string, import("./types.js").CategoryStats> = {};
  for (const [key, acc] of Object.entries(accs)) {
    result[key] = {
      total: acc.total,
      passed: acc.passed,
      passRate: acc.total > 0 ? acc.passed / acc.total : 0,
      meanScore: acc.total > 0 ? acc.scoreSum / acc.total : 0,
    };
  }
  return result as import("./types.js").CategoryStats;
}
