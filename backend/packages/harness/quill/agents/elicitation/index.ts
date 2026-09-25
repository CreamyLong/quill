/**
 * Elicitation System — proactive ambiguity detection & clarifying questions.
 *
 * Inspired by ZCode's Elicitation runtime capability: when user prompts are
 * ambiguous, incomplete, or underspecified, the system generates structured
 * clarifying questions before the agent commits to a full (expensive) run.
 *
 * This module provides:
 * - AmbiguityDetector: scores user messages on ambiguity dimensions
 * - ElicitationEngine: generates structured clarifying questions
 * - ElicitationStore: tracks pending/resolved elicitation sessions
 *
 * @module agents/elicitation
 */

export { AmbiguityDetector, type AmbiguityScore } from "./detector.js";
export { ElicitationEngine, type ElicitationQuestion, type ElicitationResult } from "./engine.js";
export { ElicitationStore, type ElicitationSession } from "./store.js";
