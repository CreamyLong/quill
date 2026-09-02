/**
 * Exact-match scorer — deterministic string comparison.
 *
 * The simplest scorer: normalizes both the agent response and the expected
 * answer, then checks equality. Supports case-insensitive and whitespace
 * normalization.
 */

import type { EvalScore, EvalScorer, EvalTask, EvalTaskResult } from "../types.js";

export const exactMatchScorer: EvalScorer = {
  name: "exact_match",

  score(task: EvalTask, result: EvalTaskResult): EvalScore {
    const config = task.scoring;
    if (config.type !== "exact_match") {
      return { score: 0, passed: false, reason: "Scoring config type mismatch" };
    }

    const ignoreCase = config.ignoreCase ?? true;
    const normalizeWhitespace = config.normalizeWhitespace ?? true;

    const normalize = (s: string): string => {
      let out = s.trim();
      if (normalizeWhitespace) {
        out = out.replace(/\s+/g, " ");
      }
      if (ignoreCase) {
        out = out.toLowerCase();
      }
      return out;
    };

    const actual = normalize(result.response);
    const expected = normalize(task.expectedAnswer ?? "");

    if (expected.length === 0) {
      return {
        score: 0,
        passed: false,
        reason: "No expected answer defined for exact_match scorer",
      };
    }

    const passed = actual === expected;
    return {
      score: passed ? 1 : 0,
      passed,
      reason: passed
        ? "Response matches expected answer"
        : `Expected "${expected.slice(0, 80)}" but got "${actual.slice(0, 80)}"`,
    };
  },
};
