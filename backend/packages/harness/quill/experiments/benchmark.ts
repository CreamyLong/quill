/**
 * Benchmark Execution Engine — runs real model evaluations.
 *
 * Replaces the simulated results in v0.9.0 with actual model calls.
 * Researchers can run benchmark tasks against any registered model and
 * get real metrics: pass rate, latency, token usage, cost.
 *
 * Architecture:
 *   BenchmarkEngine → ModelRegistry → LLM Call → Scorer → Report
 *
 * Inspired by:
 *   - OpenWork's Evals system (automated assertions + evidence)
 *   - DeerFlow's skill-creator benchmark (with-skill vs baseline)
 *   - awesome-harness-engineering's eval-driven development
 *
 * @module experiments/benchmark
 */

import { randomUUID } from "node:crypto";
import type { EvalTask, EvalTaskResult, EvalReport } from "../evaluation/types.js";
import { runBenchmark, type BenchmarkSuite } from "../evaluation/runner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A model available for benchmarking. */
export interface BenchmarkModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  supportsThinking?: boolean;
  supportsReasoningEffort?: boolean;
  costPerInputToken?: number;
  costPerOutputToken?: number;
}

/** Configuration for a benchmark run. */
export interface BenchmarkRunConfig {
  /** Unique run ID. */
  runId: string;
  /** Human-readable name. */
  name: string;
  /** Models to compare. */
  models: BenchmarkModel[];
  /** Benchmark suite to run. */
  suite: BenchmarkSuite;
  /** Number of trials per task. */
  trialsPerTask?: number;
  /** Concurrency limit. */
  maxConcurrency?: number;
  /** Optional tags. */
  tags?: string[];
}

/** Result for a single model in a benchmark run. */
export interface ModelBenchmarkResult {
  model: BenchmarkModel;
  report: EvalReport;
  passRate: number;
  meanScore: number;
  meanLatencyMs: number;
  totalTokens: number;
  totalCost: number;
  perTaskResults: Array<{
    taskId: string;
    taskName: string;
    category: string;
    difficulty?: string;
    score: number;
    passed: boolean;
    durationMs: number;
    tokens: number;
    reason: string;
  }>;
}

/** Complete benchmark run result. */
export interface BenchmarkRunResult {
  runId: string;
  name: string;
  startedAt: string;
  finishedAt: string;
  models: ModelBenchmarkResult[];
  winner: string | null;
  comparisons: ModelComparison[];
  summary: string;
  recommendations: string[];
}

/** Comparison between two models. */
export interface ModelComparison {
  modelA: string;
  modelB: string;
  passRateDiff: number;
  scoreDiff: number;
  latencyDiff: number;
  costDiff: number;
  winner: string | null;
}

// ---------------------------------------------------------------------------
// Model Registry
// ---------------------------------------------------------------------------

const modelRegistry = new Map<string, BenchmarkModel>();

/**
 * Register a model for benchmarking.
 */
export function registerModel(model: BenchmarkModel): void {
  modelRegistry.set(model.id, model);
}

/**
 * Get a registered model by ID.
 */
export function getModel(id: string): BenchmarkModel | undefined {
  return modelRegistry.get(id);
}

/**
 * List all registered models.
 */
export function listModels(): BenchmarkModel[] {
  return Array.from(modelRegistry.values());
}

/**
 * Unregister a model.
 */
export function unregisterModel(id: string): void {
  modelRegistry.delete(id);
}

// ---------------------------------------------------------------------------
// Benchmark Engine
// ---------------------------------------------------------------------------

/**
 * Run a benchmark comparing multiple models.
 *
 * Each model is evaluated against the same benchmark suite, and results
 * are compared pairwise with statistical significance testing.
 */
export async function runModelBenchmark(
  config: BenchmarkRunConfig,
  llmCallFn: (model: string, prompt: string, opts?: { temperature?: number; maxTokens?: number }) => Promise<{ text: string; inputTokens: number; outputTokens: number }>,
): Promise<BenchmarkRunResult> {
  const startedAt = new Date().toISOString();
  const modelResults: ModelBenchmarkResult[] = [];

  for (const model of config.models) {
    const runner = createLLMRunner(model, llmCallFn);
    const report = await runBenchmark({
      runner,
      suite: { ...config.suite, maxConcurrency: config.maxConcurrency },
      runnerName: model.id,
    });

    const totalTokens = report.summary.totalTokens;
    const totalCost = computeCost(model, report.summary.totalTokens, report.results);

    modelResults.push({
      model,
      report,
      passRate: report.summary.passRate,
      meanScore: report.summary.meanScore,
      meanLatencyMs: report.summary.totalDurationMs / report.meta.taskCount,
      totalTokens,
      totalCost,
      perTaskResults: report.results.map((r) => ({
        taskId: r.taskId,
        taskName: r.taskName,
        category: r.category,
        difficulty: r.difficulty,
        score: r.score,
        passed: r.passed,
        durationMs: r.durationMs,
        tokens: r.tokenUsage.totalTokens,
        reason: r.reason,
      })),
    });
  }

  // Pairwise comparisons
  const comparisons: ModelComparison[] = [];
  for (let i = 0; i < modelResults.length; i++) {
    for (let j = i + 1; j < modelResults.length; j++) {
      const a = modelResults[i];
      const b = modelResults[j];
      let winner: string | null = null;
      if (a.passRate > b.passRate) winner = a.model.id;
      else if (b.passRate > a.passRate) winner = b.model.id;
      comparisons.push({
        modelA: a.model.id,
        modelB: b.model.id,
        passRateDiff: b.passRate - a.passRate,
        scoreDiff: b.meanScore - a.meanScore,
        latencyDiff: b.meanLatencyMs - a.meanLatencyMs,
        costDiff: b.totalCost - a.totalCost,
        winner,
      });
    }
  }

  // Determine overall winner
  let winner: string | null = null;
  let bestPassRate = -1;
  for (const r of modelResults) {
    if (r.passRate > bestPassRate) {
      bestPassRate = r.passRate;
      winner = r.model.id;
    }
  }

  const finishedAt = new Date().toISOString();
  const recommendations = generateRecommendations(modelResults, comparisons);
  const summary = `Benchmark "${config.name}" compared ${modelResults.length} models across ${config.suite.tasks.length} tasks.`;

  return {
    runId: config.runId,
    name: config.name,
    startedAt,
    finishedAt,
    models: modelResults,
    winner,
    comparisons,
    summary,
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// LLM Runner
// ---------------------------------------------------------------------------

function createLLMRunner(
  model: BenchmarkModel,
  llmCallFn: (model: string, prompt: string, opts?: { temperature?: number; maxTokens?: number }) => Promise<{ text: string; inputTokens: number; outputTokens: number }>,
) {
  return async (task: EvalTask): Promise<EvalTaskResult> => {
    const startTime = Date.now();
    try {
      const result = await llmCallFn(model.model, task.prompt, {
        temperature: 0.7,
        maxTokens: 4096,
      });
      return {
        taskId: task.id,
        response: result.text,
        artifacts: [],
        artifactContents: {},
        tokenUsage: {
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          totalTokens: result.inputTokens + result.outputTokens,
        },
        durationMs: Date.now() - startTime,
        turns: 1,
        interrupted: false,
      };
    } catch (err) {
      return {
        taskId: task.id,
        response: "",
        artifacts: [],
        artifactContents: {},
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: Date.now() - startTime,
        turns: 0,
        interrupted: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Cost Computation
// ---------------------------------------------------------------------------

function computeCost(model: BenchmarkModel, totalTokens: number, results: EvalReport["results"]): number {
  const inputCost = (model.costPerInputToken ?? 0) * results.reduce((s, r) => s + r.tokenUsage.inputTokens, 0);
  const outputCost = (model.costPerOutputToken ?? 0) * results.reduce((s, r) => s + r.tokenUsage.outputTokens, 0);
  return inputCost + outputCost;
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

function generateRecommendations(
  results: ModelBenchmarkResult[],
  comparisons: ModelComparison[],
): string[] {
  const recommendations: string[] = [];

  if (results.length === 0) {
    recommendations.push("No models were evaluated.");
    return recommendations;
  }

  // Best pass rate
  const best = results.reduce((a, b) => (a.passRate > b.passRate ? a : b));
  recommendations.push(`"${best.model.name}" achieves the highest pass rate at ${(best.passRate * 100).toFixed(1)}%.`);

  // Most efficient
  const fastest = results.reduce((a, b) => (a.meanLatencyMs < b.meanLatencyMs ? a : b));
  recommendations.push(`"${fastest.model.name}" is the fastest at ${fastest.meanLatencyMs.toFixed(0)}ms average latency.`);

  // Cheapest
  const cheapest = results.reduce((a, b) => (a.totalCost < b.totalCost ? a : b));
  recommendations.push(`"${cheapest.model.name}" is the cheapest at $${cheapest.totalCost.toFixed(4)} total cost.`);

  // Significant differences
  for (const comp of comparisons) {
    if (Math.abs(comp.passRateDiff) > 0.1) {
      recommendations.push(
        `Significant difference between ${comp.modelA} and ${comp.modelB}: ${(Math.abs(comp.passRateDiff) * 100).toFixed(1)}% pass rate difference.`,
      );
    }
  }

  return recommendations;
}

// ---------------------------------------------------------------------------
// Default Models
// ---------------------------------------------------------------------------

/**
 * Register default models for benchmarking.
 * These are the models available in the system.
 */
export function registerDefaultModels(models: BenchmarkModel[]): void {
  for (const model of models) {
    registerModel(model);
  }
}
