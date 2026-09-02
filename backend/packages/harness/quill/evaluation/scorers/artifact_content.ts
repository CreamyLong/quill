/**
 * Artifact-content scorer — verifies that a specific artifact's content
 * matches expectations.
 *
 * Useful for checking that generated code, reports, or config files
 * contain specific content.
 */

import type { EvalScore, EvalScorer, EvalTask, EvalTaskResult } from "../types.js";

export const artifactContentScorer: EvalScorer = {
  name: "artifact_content",

  score(task: EvalTask, result: EvalTaskResult): EvalScore {
    const config = task.scoring;
    if (config.type !== "artifact_content") {
      return { score: 0, passed: false, reason: "Scoring config type mismatch" };
    }

    const content = result.artifactContents[config.path];
    if (content === undefined) {
      return {
        score: 0,
        passed: false,
        reason: `Artifact "${config.path}" not found in result`,
        details: { path: config.path, availablePaths: Object.keys(result.artifactContents) },
      };
    }

    const ignoreCase = config.ignoreCase ?? false;
    const actual = ignoreCase ? content.toLowerCase() : content;
    const expected = ignoreCase ? config.expected.toLowerCase() : config.expected;

    const passed = actual === expected;
    return {
      score: passed ? 1 : 0,
      passed,
      reason: passed
        ? `Artifact "${config.path}" content matches expected`
        : `Artifact "${config.path}" content does not match expected`,
      details: {
        path: config.path,
        expectedLength: expected.length,
        actualLength: actual.length,
        firstDifference: findFirstDifference(expected, actual),
      },
    };
  },
};

function findFirstDifference(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  if (a.length !== b.length) return len;
  return -1;
}
