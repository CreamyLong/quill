/**
 * Composite scorer — combines multiple scorers with optional weights.
 *
 * Mirrors the awesome-harness-engineering "layered verification" pattern:
 * deterministic checks first, then rubric-based scoring. The composite
 * scorer lets a task define multiple verification dimensions (correctness,
 * completeness, safety, efficiency) and aggregate them into a single score.
 */

import type {
  EvalScore,
  EvalScorer,
  EvalScoringConfig,
  EvalTask,
  EvalTaskResult,
} from "../types.js";
import { exactMatchScorer } from "./exact_match.js";
import { containsScorer } from "./contains.js";
import { regexScorer } from "./regex.js";
import { artifactExistsScorer } from "./artifact_exists.js";
import { artifactContentScorer } from "./artifact_content.js";

/** Built-in scorer registry. */
const BUILTIN_SCORERS: Record<string, EvalScorer> = {
  exact_match: exactMatchScorer,
  contains: containsScorer,
  regex: regexScorer,
  artifact_exists: artifactExistsScorer,
  artifact_content: artifactContentScorer,
};

/**
 * Resolve a scorer from a scoring config. For built-in types, returns the
 * corresponding scorer. For custom types, returns null (the runner handles
 * custom scorer resolution).
 */
export function resolveScorer(config: EvalScoringConfig): EvalScorer | null {
  if (config.type === "composite") {
    return {
      name: "composite",
      score: (task: EvalTask, result: EvalTaskResult) => compositeScore(config, task, result),
    };
  }
  return BUILTIN_SCORERS[config.type] ?? null;
}

async function compositeScore(
  config: Extract<EvalScoringConfig, { type: "composite" }>,
  task: EvalTask,
  result: EvalTaskResult,
): Promise<EvalScore> {
  const weights = config.weights ?? config.scorers.map(() => 1);
  let totalWeight = 0;
  let weightedScore = 0;
  const subScores: Array<{ name: string; score: number; passed: boolean; reason: string }> = [];

  for (let i = 0; i < config.scorers.length; i++) {
    const subConfig = config.scorers[i];
    const weight = weights[i] ?? 1;
    const scorer = resolveScorer(subConfig);

    let subResult: EvalScore;
    if (scorer) {
      subResult = await scorer.score(task, result);
    } else {
      subResult = {
        score: 0,
        passed: false,
        reason: `No scorer available for type "${subConfig.type}"`,
      };
    }

    weightedScore += subResult.score * weight;
    totalWeight += weight;
    subScores.push({ name: subConfig.type, ...subResult });
  }

  const finalScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
  const allPassed = subScores.every((s) => s.passed);

  return {
    score: finalScore,
    passed: allPassed,
    reason: `Composite: ${subScores.filter((s) => s.passed).length}/${subScores.length} checks passed`,
    details: { subScores },
  };
}
