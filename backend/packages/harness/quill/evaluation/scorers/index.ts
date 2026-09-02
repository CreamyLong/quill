/**
 * Scorer registry and exports.
 *
 * Mirrors the awesome-harness-engineering "pluggable scorer registry" pattern.
 * All built-in scorers are exported here for use by the evaluation runner.
 */

export { exactMatchScorer } from "./exact_match.js";
export { containsScorer } from "./contains.js";
export { regexScorer } from "./regex.js";
export { artifactExistsScorer } from "./artifact_exists.js";
export { artifactContentScorer } from "./artifact_content.js";
export { compositeScore, resolveScorer } from "./composite.js";
export { createLlmJudgeScorer } from "./llm_judge.js";
export type { JudgeLlmCall } from "./llm_judge.js";
