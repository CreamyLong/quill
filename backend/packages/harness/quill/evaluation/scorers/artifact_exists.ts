/**
 * Artifact-exists scorer — verifies that the agent produced specific files.
 *
 * Mirrors SWE-bench's approach of checking that the agent created expected
 * output files (patches, reports, etc.) rather than only evaluating the
 * text response.
 */

import type { EvalScore, EvalScorer, EvalTask, EvalTaskResult } from "../types.js";

export const artifactExistsScorer: EvalScorer = {
  name: "artifact_exists",

  score(task: EvalTask, result: EvalTaskResult): EvalScore {
    const config = task.scoring;
    if (config.type !== "artifact_exists") {
      return { score: 0, passed: false, reason: "Scoring config type mismatch" };
    }

    const requiredPaths = config.paths ?? task.expectedArtifacts ?? [];
    if (requiredPaths.length === 0) {
      return { score: 1, passed: true, reason: "No artifact paths to check" };
    }

    const produced = new Set(result.artifacts);
    const missing = requiredPaths.filter((p) => !produced.has(p));

    const allRequired = config.allRequired ?? true;
    if (allRequired) {
      const passed = missing.length === 0;
      return {
        score: passed ? 1 : 0,
        passed,
        reason: passed
          ? `All ${requiredPaths.length} expected artifacts produced`
          : `Missing artifacts: ${missing.join(", ")}`,
        details: { requiredPaths, produced: [...produced], missing },
      };
    } else {
      const foundCount = requiredPaths.length - missing.length;
      const score = foundCount / requiredPaths.length;
      return {
        score,
        passed: foundCount > 0,
        reason: `${foundCount}/${requiredPaths.length} expected artifacts produced`,
        details: { requiredPaths, produced: [...produced], missing },
      };
    }
  },
};
