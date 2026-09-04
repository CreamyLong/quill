/**
 * Goal Engine Configuration
 *
 * Configuration for the goal tracking and auto-continuation system.
 * Mirrors Kimi Code's Goal mode and DeerFlow 2.0's /goal command.
 */

export interface GoalConfig {
  /** Whether goal tracking is enabled. */
  enabled: boolean;
  /** Maximum automatic continuations per goal (default 8). */
  maxContinuations?: number;
  /** Maximum no-progress continuations before standing down (default 3). */
  maxNoProgressContinuations?: number;
  /** Whether to use a cheaper model for goal evaluation. */
  useCheaperModel?: boolean;
}

const DEFAULTS: Required<GoalConfig> = {
  enabled: false,
  maxContinuations: 8,
  maxNoProgressContinuations: 3,
  useCheaperModel: false,
};

/**
 * Build a GoalConfig from a raw config object.
 */
export function buildGoalConfig(raw: Record<string, unknown> | null | undefined): GoalConfig {
  if (!raw) {
    return { ...DEFAULTS };
  }
  return {
    enabled: Boolean(raw.enabled ?? DEFAULTS.enabled),
    maxContinuations: Number(raw.max_continuations ?? DEFAULTS.maxContinuations),
    maxNoProgressContinuations: Number(
      raw.max_no_progress_continuations ?? DEFAULTS.maxNoProgressContinuations,
    ),
    useCheaperModel: Boolean(raw.use_cheaper_model ?? DEFAULTS.useCheaperModel),
  };
}
