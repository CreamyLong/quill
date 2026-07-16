/**
 * Configuration for conversation summarization.
 *
 * Mirrors `quill.config.summarization_config` from the Python backend.
 */

export type ContextSizeType = "fraction" | "tokens" | "messages";

/** Context size specification for trigger or keep parameters. */
export interface ContextSize {
  /** Type of context size specification. */
  type: ContextSizeType;
  /** Value for the context size specification. */
  value: number;
}

/** Convert to tuple format expected by the summarization middleware. */
export function contextSizeToTuple(size: ContextSize): [ContextSizeType, number] {
  return [size.type, size.value];
}

/** Configuration for automatic conversation summarization. */
export interface SummarizationConfig {
  /** Whether to enable automatic conversation summarization. */
  enabled: boolean;
  /** Model name to use for summarization (null = use a lightweight model). */
  modelName: string | null;
  /** One or more thresholds that trigger summarization. */
  trigger: ContextSize | ContextSize[] | null;
  /** Context retention policy after summarization. */
  keep: ContextSize;
  /** Maximum tokens to keep when preparing messages for summarization (null = skip trimming). */
  trimTokensToSummarize: number | null;
  /** Custom prompt template for generating summaries. */
  summaryPrompt: string | null;
  /** Number of most-recently-loaded skill files to exclude from summarization. */
  preserveRecentSkillCount: number;
  /** Total token budget reserved for recently-loaded skill files. */
  preserveRecentSkillTokens: number;
  /** Per-skill token cap when preserving skill files across summarization. */
  preserveRecentSkillTokensPerSkill: number;
  /** Tool names treated as skill file reads when preserving recently-loaded skills. */
  skillFileReadToolNames: string[];
}

export function buildSummarizationConfig(input: Partial<SummarizationConfig> = {}): SummarizationConfig {
  return {
    enabled: input.enabled ?? false,
    modelName: input.modelName ?? null,
    trigger: input.trigger ?? null,
    keep: input.keep ?? { type: "messages", value: 20 },
    trimTokensToSummarize: input.trimTokensToSummarize ?? 4000,
    summaryPrompt: input.summaryPrompt ?? null,
    preserveRecentSkillCount: input.preserveRecentSkillCount ?? 5,
    preserveRecentSkillTokens: input.preserveRecentSkillTokens ?? 25000,
    preserveRecentSkillTokensPerSkill: input.preserveRecentSkillTokensPerSkill ?? 5000,
    skillFileReadToolNames: input.skillFileReadToolNames ?? ["read_file", "read", "view", "cat"],
  };
}

// Global configuration instance.
let _summarizationConfig: SummarizationConfig = buildSummarizationConfig();

/** Get the current summarization configuration. */
export function getSummarizationConfig(): SummarizationConfig {
  return _summarizationConfig;
}

/** Set the summarization configuration. */
export function setSummarizationConfig(config: SummarizationConfig): void {
  _summarizationConfig = config;
}

/** Load summarization configuration from a dictionary. */
export function loadSummarizationConfigFromDict(configDict: Partial<SummarizationConfig>): void {
  _summarizationConfig = buildSummarizationConfig(configDict);
}
