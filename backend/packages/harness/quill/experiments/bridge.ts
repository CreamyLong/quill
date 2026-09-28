/**
 * Experiment-Evaluation Bridge — connect A/B testing with benchmark evaluation.
 *
 * This module bridges the experiments module (A/B testing of algorithm
 * variants) with the evaluation framework (benchmarking against tasks).
 * Researchers can:
 *   1. Define a benchmark suite
 *   2. Run it against multiple algorithm variants
 *   3. Compare results with statistical significance
 *
 * @module experiments/bridge
 */

import type { BenchmarkSuite } from "../evaluation/runner.js";
import type { EvalTask, EvalTaskResult, EvalRunner } from "../evaluation/types.js";
import type { ExperimentConfig } from "./config.js";
import type { AlgorithmModuleKey } from "./registry.js";
import { createModule, recordMetric } from "./registry.js";
import { runExperiment } from "./runtime.js";
import { generateReport } from "./evaluation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A benchmark task mapped to an experiment. */
export interface BenchmarkExperimentTask extends EvalTask {
  /** The algorithm module this task tests. */
  moduleKey: AlgorithmModuleKey;
  /** The variant to test. */
  variant: string;
}

/** Result of running a benchmark against multiple variants. */
export interface BenchmarkComparisonResult {
  /** The benchmark suite used. */
  suite: BenchmarkSuite;
  /** Per-variant results. */
  variantResults: VariantBenchmarkResult[];
  /** Pairwise comparisons between variants. */
  comparisons: VariantBenchmarkComparison[];
  /** Overall winner. */
  winner: string | null;
}

/** Result for a single variant. */
export interface VariantBenchmarkResult {
  variant: string;
  taskCount: number;
  passedCount: number;
  passRate: number;
  meanScore: number;
  totalTokens: number;
  totalDurationMs: number;
  meanLatencyMs: number;
}

/** Comparison between two variants. */
export interface VariantBenchmarkComparison {
  variantA: string;
  variantB: string;
  passRateDiff: number;
  scoreDiff: number;
  latencyDiff: number;
  winner: string | null;
}

// ---------------------------------------------------------------------------
// Benchmark Runner
// ---------------------------------------------------------------------------

/**
 * Create an EvalRunner that uses the experiment system to execute tasks.
 *
 * This allows the evaluation framework to run tasks through the experiment
 * routing system, enabling A/B testing of algorithm variants.
 */
export function createExperimentRunner(
  moduleKey: AlgorithmModuleKey,
  variant: string,
  baseRunner: EvalRunner,
): EvalRunner {
  return async (task: EvalTask, options?: { signal?: AbortSignal }): Promise<EvalTaskResult> => {
    // Execute through the experiment system
    const result = await runExperiment(
      moduleKey,
      {
        data: task.prompt,
        context: { taskId: task.id, variant },
      },
      {
        subjectId: task.id,
        forceVariant: variant,
      },
    );

    // If the experiment system returned a valid result, use it
    if (result.output.success) {
      return {
        taskId: task.id,
        response: String(result.output.result ?? ""),
        artifacts: [],
        artifactContents: {},
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: result.latencyMs,
        turns: 1,
        interrupted: false,
      };
    }

    // Fall back to the base runner
    return baseRunner(task, options);
  };
}

// ---------------------------------------------------------------------------
// Benchmark Comparison
// ---------------------------------------------------------------------------

/**
 * Run a benchmark suite against multiple variants and compare results.
 */
export async function runBenchmarkComparison(options: {
  suite: BenchmarkSuite;
  variants: string[];
  moduleKey: AlgorithmModuleKey;
  baseRunner: EvalRunner;
  judgeLlmCall?: (system: string, user: string, opts?: { model?: string; temperature?: number }) => Promise<string>;
}): Promise<BenchmarkComparisonResult> {
  const { suite, variants, moduleKey, baseRunner, judgeLlmCall } = options;

  const variantResults: VariantBenchmarkResult[] = [];

  for (const variant of variants) {
    const runner = createExperimentRunner(moduleKey, variant, baseRunner);

    // Import runBenchmark dynamically to avoid circular dependency
    const { runBenchmark } = await import("../evaluation/runner.js");
    const report = await runBenchmark({
      runner,
      suite,
      runnerName: `${moduleKey}-${variant}`,
      judgeLlmCall,
    });

    variantResults.push({
      variant,
      taskCount: report.meta.taskCount,
      passedCount: report.results.filter((r) => r.passed).length,
      passRate: report.summary.passRate,
      meanScore: report.summary.meanScore,
      totalTokens: report.summary.totalTokens,
      totalDurationMs: report.summary.totalDurationMs,
      meanLatencyMs: report.summary.totalDurationMs / report.meta.taskCount,
    });
  }

  // Pairwise comparisons
  const comparisons: VariantBenchmarkComparison[] = [];
  for (let i = 0; i < variantResults.length; i++) {
    for (let j = i + 1; j < variantResults.length; j++) {
      const a = variantResults[i];
      const b = variantResults[j];

      let winner: string | null = null;
      if (a.passRate > b.passRate) winner = a.variant;
      else if (b.passRate > a.passRate) winner = b.variant;

      comparisons.push({
        variantA: a.variant,
        variantB: b.variant,
        passRateDiff: b.passRate - a.passRate,
        scoreDiff: b.meanScore - a.meanScore,
        latencyDiff: b.meanLatencyMs - a.meanLatencyMs,
        winner,
      });
    }
  }

  // Determine overall winner
  let winner: string | null = null;
  let bestPassRate = -1;
  for (const result of variantResults) {
    if (result.passRate > bestPassRate) {
      bestPassRate = result.passRate;
      winner = result.variant;
    }
  }

  return {
    suite,
    variantResults,
    comparisons,
    winner,
  };
}

// ---------------------------------------------------------------------------
// Experiment from Benchmark
// ---------------------------------------------------------------------------

/**
 * Create an experiment configuration from a benchmark suite.
 */
export function createExperimentFromBenchmark(options: {
  id: string;
  name: string;
  suite: BenchmarkSuite;
  moduleKey: AlgorithmModuleKey;
  variants: string[];
  description?: string;
}): ExperimentConfig {
  return {
    id: options.id,
    name: options.name,
    description: options.description ?? `Benchmark experiment: ${options.suite.name}`,
    moduleKey: options.moduleKey,
    variants: options.variants.map((v) => ({
      variant: v,
      weight: Math.floor(100 / options.variants.length),
    })),
    criteria: {
      minSuccessRate: 0.5,
    },
    enabled: true,
    metadata: {
      suiteName: options.suite.name,
      taskCount: options.suite.tasks.length,
      source: "benchmark",
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Statistical Analysis
// ---------------------------------------------------------------------------

/**
 * Perform statistical analysis on benchmark comparison results.
 */
export function analyzeBenchmarkComparison(result: BenchmarkComparisonResult): {
  summary: string;
  recommendations: string[];
  confidence: "high" | "medium" | "low";
} {
  const recommendations: string[] = [];
  let confidence: "high" | "medium" | "low" = "low";

  const totalTasks = result.variantResults[0]?.taskCount ?? 0;

  if (totalTasks < 10) {
    confidence = "low";
    recommendations.push(`Low sample size (${totalTasks} tasks). Consider adding more tasks for reliable results.`);
  } else if (totalTasks < 30) {
    confidence = "medium";
    recommendations.push(`Moderate sample size (${totalTasks} tasks). Results are indicative but not definitive.`);
  } else {
    confidence = "high";
    recommendations.push(`Good sample size (${totalTasks} tasks). Results are statistically reliable.`);
  }

  if (result.winner) {
    const winnerResult = result.variantResults.find((r) => r.variant === result.winner);
    if (winnerResult) {
      recommendations.push(`Variant "${result.winner}" achieves ${(winnerResult.passRate * 100).toFixed(1)}% pass rate.`);
    }
  } else {
    recommendations.push("No clear winner detected. Consider running more trials or adding more tasks.");
  }

  // Check for significant differences
  for (const comp of result.comparisons) {
    if (Math.abs(comp.passRateDiff) > 0.1) {
      recommendations.push(`Significant difference between ${comp.variantA} and ${comp.variantB}: ${(Math.abs(comp.passRateDiff) * 100).toFixed(1)}% pass rate difference.`);
    }
  }

  const summary = `Benchmark "${result.suite.name}" tested ${result.variantResults.length} variants across ${totalTasks} tasks.`;

  return { summary, recommendations, confidence };
}
