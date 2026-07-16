/**
 * Configuration for SafetyFinishReasonMiddleware.
 *
 * Mirrors the shape of GuardrailsConfig: detectors are loaded by class path
 * through reflection so users can drop in custom provider detectors without
 * modifying core code.
 */

export interface SafetyDetectorConfig {
  /** Class path of a SafetyTerminationDetector implementation. */
  use: string;
  /** Constructor kwargs passed to the detector class. */
  config: Record<string, unknown>;
}

export interface SafetyFinishReasonConfig {
  /** Master switch for the SafetyFinishReasonMiddleware. */
  enabled: boolean;
  /**
   * Custom detector list. Leave unset (null) to use the built-in set covering
   * OpenAI-compatible content_filter, Anthropic refusal, and Gemini safety
   * categories. Provide a non-null list to fully override.
   */
  detectors: SafetyDetectorConfig[] | null;
}

export function buildSafetyFinishReasonConfig(
  input: Partial<SafetyFinishReasonConfig> = {}
): SafetyFinishReasonConfig {
  return {
    enabled: input.enabled ?? true,
    detectors: input.detectors ?? null,
  };
}
