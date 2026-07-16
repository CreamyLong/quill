/**
 * Configuration for tool-result output budget enforcement.
 *
 * When a tool returns more than ``externalizeMinChars`` characters, the full
 * output is persisted to disk and replaced with a compact preview + file
 * reference. If disk persistence is unavailable the output falls back to
 * head+tail truncation.
 */

export interface ToolOutputConfig {
  /** Enable the tool output budget middleware. */
  enabled: boolean;
  /** Character threshold to trigger disk externalization. */
  externalizeMinChars: number;
  /** Characters to keep from the head of the output in the preview. */
  previewHeadChars: number;
  /** Characters to keep from the tail of the output in the preview. */
  previewTailChars: number;
  /** Maximum characters when disk persistence is unavailable. */
  fallbackMaxChars: number;
  /** Head characters for fallback truncation. */
  fallbackHeadChars: number;
  /** Tail characters for fallback truncation. */
  fallbackTailChars: number;
  /** Subdirectory under the thread outputs path for persisted tool results. */
  storageSubdir: string;
  /** Tool names exempt from budget enforcement. */
  exemptTools: string[];
  /** Per-tool externalizeMinChars overrides. */
  toolOverrides: Record<string, number>;
}

/**
 * Build a ToolOutputConfig from partial input, applying defaults.
 */
export function buildToolOutputConfig(
  input: Partial<ToolOutputConfig> = {}
): ToolOutputConfig {
  return {
    enabled: input.enabled ?? true,
    externalizeMinChars: input.externalizeMinChars ?? 12_000,
    previewHeadChars: input.previewHeadChars ?? 2_000,
    previewTailChars: input.previewTailChars ?? 1_000,
    fallbackMaxChars: input.fallbackMaxChars ?? 30_000,
    fallbackHeadChars: input.fallbackHeadChars ?? 8_000,
    fallbackTailChars: input.fallbackTailChars ?? 3_000,
    storageSubdir: input.storageSubdir ?? ".tool-results",
    exemptTools: input.exemptTools ?? ["read_file", "read_file_tool"],
    toolOverrides: input.toolOverrides ?? {},
  };
}
