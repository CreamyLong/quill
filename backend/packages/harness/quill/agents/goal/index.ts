/**
 * Goal Engine Module
 *
 * Provides goal tracking, evaluation, and automatic continuation
 * for the Quill agent system.
 */

export {
  GOAL_DEFAULTS,
  type GoalBlocker,
  type GoalEvaluation,
  type GoalOptions,
  type GoalState,
  type GoalStatus,
  mergeGoal,
} from "./types.js";

export { GoalManager, type GoalManagerConfig, type EvaluateContext } from "./manager.js";
