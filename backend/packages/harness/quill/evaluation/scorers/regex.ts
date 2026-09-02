/**
 * Regex scorer — matches the response against a regular expression.
 *
 * Useful for validating structured outputs like email addresses, dates,
 * code patterns, or any response format that can be expressed as a regex.
 */

import type { EvalScore, EvalScorer, EvalTask, EvalTaskResult } from "../types.js";

export const regexScorer: EvalScorer = {
  name: "regex",

  score(task: EvalTask, result: EvalTaskResult): EvalScore {
    const config = task.scoring;
    if (config.type !== "regex") {
      return { score: 0, passed: false, reason: "Scoring config type mismatch" };
    }

    let re: RegExp;
    try {
      re = new RegExp(config.pattern, config.flags ?? "s");
    } catch (err) {
      return {
        score: 0,
        passed: false,
        reason: `Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const passed = re.test(result.response);
    return {
      score: passed ? 1 : 0,
      passed,
      reason: passed
        ? `Response matches pattern /${config.pattern}/`
        : `Response does not match pattern /${config.pattern}/`,
    };
  },
};
