/**
 * Goal Engine Types
 *
 * Mirrors the frontend GoalState interface in
 * frontend/src/core/threads/types.ts. The backend goal engine
 * evaluates whether an active goal has been satisfied and manages
 * automatic continuation.
 *
 * Source patterns:
 * - Kimi Code: persistent multi-turn objective tracking with verifiable finish lines
 * - DeerFlow 2.0: /goal command with automatic completion evaluation
 */

/** Blocker types for goal evaluation. */
export type GoalBlocker =
  | "none"
  | "missing_evidence"
  | "needs_user_input"
  | "run_failed"
  | "external_wait"
  | "goal_not_met_yet";

/** Status of a goal. */
export type GoalStatus = "active" | "satisfied" | "abandoned" | "paused";

/** Result of a goal evaluation. */
export interface GoalEvaluation {
  /** Whether the goal is considered satisfied. */
  satisfied: boolean;
  /** The blocker preventing completion (if not satisfied). */
  blocker: GoalBlocker;
  /** Human-readable reason for the evaluation. */
  reason: string;
  /** Summary of evidence supporting the evaluation. */
  evidence_summary?: string;
  /** Run ID when this evaluation was performed. */
  run_id?: string;
  /** Timestamp of the evaluation. */
  evaluated_at?: string;
  /** Key indicating what progress was made (for no-progress detection). */
  progress_key?: string;
  /** Reason for standing down (if no-progress threshold reached). */
  stand_down_reason?: string;
}

/** Runtime goal state stored in ThreadState. */
export interface GoalState {
  /** The objective text. */
  objective: string;
  /** Current status of the goal. */
  status: GoalStatus;
  /** Creation timestamp. */
  created_at: string;
  /** Last update timestamp. */
  updated_at: string;
  /** Number of automatic continuations performed. */
  continuation_count: number;
  /** Maximum number of automatic continuations allowed. */
  max_continuations: number;
  /** Number of consecutive evaluations with no progress. */
  no_progress_count: number;
  /** Maximum no-progress continuations before standing down. */
  max_no_progress_continuations: number;
  /** The most recent evaluation result. */
  last_evaluation?: GoalEvaluation;
}

/** Options for creating a new goal. */
export interface GoalOptions {
  objective: string;
  max_continuations?: number;
  max_no_progress_continuations?: number;
}

/** Default configuration for the goal engine. */
export const GOAL_DEFAULTS = {
  maxContinuations: 8,
  maxNoProgressContinuations: 3,
} as const;

/** Reducer for goal state — preserves active goal, allows transitions. */
export function mergeGoal(
  existing: GoalState | null | undefined,
  incoming: GoalState | null | undefined,
): GoalState | null | undefined {
  if (incoming === null || incoming === undefined) {
    return existing;
  }
  if (existing === null || existing === undefined) {
    return incoming;
  }
  // Once satisfied or abandoned, don't regress
  if (existing.status === "satisfied" || existing.status === "abandoned") {
    return existing;
  }
  return incoming;
}
