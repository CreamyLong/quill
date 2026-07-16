/**
 * Configuration for agent-managed skill evolution.
 */
export interface SkillEvolutionConfig {
  /** Whether the agent can create and modify skills under skills/custom. */
  enabled: boolean;
  /** Optional model name for skill security moderation. */
  moderationModelName: string | null;
}

let _skillEvolutionConfig: SkillEvolutionConfig | null = null;

/** Get skill evolution config, returning defaults if not loaded. */
export function getSkillEvolutionConfig(): SkillEvolutionConfig {
  if (_skillEvolutionConfig === null) {
    _skillEvolutionConfig = {
      enabled: false,
      moderationModelName: null,
    };
  }
  return _skillEvolutionConfig;
}

/** Load skill evolution config from a partial dict. */
export function loadSkillEvolutionConfigFromDict(data: Partial<SkillEvolutionConfig>): void {
  _skillEvolutionConfig = {
    enabled: data.enabled ?? false,
    moderationModelName: data.moderationModelName ?? null,
  };
}
