/**
 * Contains scorer — checks whether the response contains a required substring.
 *
 * Useful for tasks where the agent must include a specific fact, URL, or
 * keyword in its response.
 */

import type { EvalScore, EvalScorer, EvalTask, EvalTaskResult } from "../types.js";

export const containsScorer: EvalScorer = {
  name: "contains",

  score(task: EvalTask, result: EvalTaskResult): EvalScore {
    const config = task.scoring;
    if (config.type !== "contains") {
      return { score: 0, passed: false, reason: "Scoring config type mismatch" };
    }

    const ignoreCase = config.ignoreCase ?? true;
    const haystack = ignoreCase ? result.response.toLowerCase() : result.response;
    const needle = ignoreCase ? config.substring.toLowerCase() : config.substring;

    const passed = haystack.includes(needle);
    return {
      score: passed ? 1 : 0,
      passed,
      reason: passed
        ? `Response contains required substring "${config.substring}"`
        : `Response does not contain required substring "${config.substring}"`,
    };
  },
};
