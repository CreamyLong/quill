/**
 * Structured Planning Artifacts — public API.
 *
 * Port of OpenAI Codex's Plan.md/Implement.md/Documentation.md pattern.
 * Provides reusable harness artifacts for long-horizon tasks.
 */

export * from "./types.js";
export {
  PlanningArtifactManager,
  getPlanningManager,
  resetPlanningManager,
} from "./manager.js";
