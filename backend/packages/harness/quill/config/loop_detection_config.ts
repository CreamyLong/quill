export interface ToolFreqOverride {
  warn: number;
  hardLimit: number;
}

export interface LoopDetectionConfig {
  /** Whether to enable repetitive tool-call loop detection */
  enabled: boolean;
  /** Number of identical tool-call sets before injecting a warning */
  warnThreshold: number;
  /** Number of identical tool-call sets before forcing a stop */
  hardLimit: number;
  /** Number of recent tool-call sets to track per thread */
  windowSize: number;
  /** Maximum number of thread histories to keep in memory */
  maxTrackedThreads: number;
  /** Number of calls to the same tool type before injecting a frequency warning */
  toolFreqWarn: number;
  /** Number of calls to the same tool type before forcing a stop */
  toolFreqHardLimit: number;
  /** Per-tool overrides for tool_freq_warn / tool_freq_hard_limit */
  toolFreqOverrides: Record<string, ToolFreqOverride>;
}

function validateThresholds(config: LoopDetectionConfig): void {
  if (config.hardLimit < config.warnThreshold) {
    throw new Error("hard_limit must be greater than or equal to warn_threshold");
  }
  if (config.toolFreqHardLimit < config.toolFreqWarn) {
    throw new Error("tool_freq_hard_limit must be greater than or equal to tool_freq_warn");
  }
  for (const [tool, override] of Object.entries(config.toolFreqOverrides)) {
    if (override.hardLimit < override.warn) {
      throw new Error(`tool_freq_overrides[${tool}].hard_limit must be >= warn`);
    }
  }
}

/** Build a LoopDetectionConfig from partial input, applying defaults and validation. */
export function buildLoopDetectionConfig(input: Partial<LoopDetectionConfig> = {}): LoopDetectionConfig {
  const config: LoopDetectionConfig = {
    enabled: input.enabled ?? true,
    warnThreshold: input.warnThreshold ?? 3,
    hardLimit: input.hardLimit ?? 5,
    windowSize: input.windowSize ?? 20,
    maxTrackedThreads: input.maxTrackedThreads ?? 100,
    toolFreqWarn: input.toolFreqWarn ?? 30,
    toolFreqHardLimit: input.toolFreqHardLimit ?? 50,
    toolFreqOverrides: input.toolFreqOverrides ?? {},
  };
  validateThresholds(config);
  return config;
}
