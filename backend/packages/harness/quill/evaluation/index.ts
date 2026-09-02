/**
 * Evaluation framework — benchmarking and agent evaluation.
 *
 * Port of DeepSeek-harness's evaluation model + SWE-agent's task structure
 * + the awesome-harness-engineering "pluggable scorer registry" and
 * "pass^k methodology" best practices.
 *
 * Architecture:
 *   BenchmarkSuite (task definitions)
 *     → EvalRunner (executes tasks against an agent)
 *     → EvalScorer (judges results, pluggable per task)
 *     → EvalReport (aggregated results + statistics)
 *
 * Quick start:
 *   import { runBenchmark } from "quill.evaluation";
 *   import { createQuillRunner } from "quill.evaluation/adapters/quill_runner";
 *
 *   const runner = createQuillRunner({ client: quillClient });
 *   const report = await runBenchmark({
 *     runner,
 *     suite: { name: "my-benchmark", tasks: [...] },
 *   });
 *   console.log(`Pass rate: ${(report.summary.passRate * 100).toFixed(1)}%`);
 */

// Types
export type {
  EvalTask,
  EvalScoringConfig,
  EvalTaskResult,
  EvalEvent,
  EvalScore,
  EvalScorer,
  EvalReport,
  EvalTaskScore,
  EvalSummary,
  EvalRunner,
  CategoryStats,
} from "./types.js";

// Runner
export { runBenchmark, type BenchmarkSuite, type EvalRunnerOptions } from "./runner.js";

// Scorers
export {
  exactMatchScorer,
  containsScorer,
  regexScorer,
  artifactExistsScorer,
  artifactContentScorer,
  createLlmJudgeScorer,
  resolveScorer,
  compositeScore,
} from "./scorers/index.js";
export type { JudgeLlmCall } from "./scorers/llm_judge.js";

// Adapters
export { createQuillRunner, type EvalQuillClient, type EvalStreamEvent } from "./adapters/quill_runner.js";
