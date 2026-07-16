/**
 * Configuration for automatic thread title generation.
 *
 * Mirrors `quill.config.title_config` from the Python backend.
 */

export interface TitleConfig {
  /** Whether to enable automatic title generation */
  enabled: boolean;
  /** Maximum number of words in the generated title */
  maxWords: number;
  /** Maximum number of characters in the generated title */
  maxChars: number;
  /** Model name to use for title generation (null = use default model) */
  modelName: string | null;
  /** Prompt template for title generation */
  promptTemplate: string;
}

let _titleConfig: TitleConfig = {
  enabled: true,
  maxWords: 6,
  maxChars: 60,
  modelName: null,
  promptTemplate:
    "Generate a concise title (max {max_words} words) for this conversation.\nUser: {user_msg}\nAssistant: {assistant_msg}\n\nReturn ONLY the title, no quotes, no explanation.",
};

/** Get the current title configuration. */
export function getTitleConfig(): TitleConfig {
  return _titleConfig;
}

/** Set the title configuration. */
export function setTitleConfig(config: TitleConfig): void {
  _titleConfig = config;
}

/** Load title configuration from a partial dictionary. */
export function loadTitleConfigFromDict(configDict: Partial<TitleConfig>): void {
  _titleConfig = {
    ..._titleConfig,
    ...configDict,
  };
}

/** Restore the title configuration to its default. */
export function resetTitleConfig(): void {
  _titleConfig = {
    enabled: true,
    maxWords: 6,
    maxChars: 60,
    modelName: null,
    promptTemplate:
      "Generate a concise title (max {max_words} words) for this conversation.\nUser: {user_msg}\nAssistant: {assistant_msg}\n\nReturn ONLY the title, no quotes, no explanation.",
  };
}
