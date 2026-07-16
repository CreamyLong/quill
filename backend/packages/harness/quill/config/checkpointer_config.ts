/**
 * Configuration for the LangGraph checkpointer.
 *
 * Mirrors `quill.config.checkpointer_config` from the Python backend.
 */

import { getAppConfig, hasCustomAppConfig } from "./app_config.js";

export type CheckpointerType = "memory" | "sqlite" | "postgres";

/** Configuration for LangGraph state persistence checkpointer. */
export interface CheckpointerConfig {
  /** Checkpointer backend type. */
  type: CheckpointerType;
  /** Connection string for sqlite (file path) or postgres (DSN). */
  connectionString: string | null;
}

export function buildCheckpointerConfig(input: Partial<CheckpointerConfig> & { type: CheckpointerType }): CheckpointerConfig {
  return {
    type: input.type,
    connectionString: input.connectionString ?? null,
  };
}

// Global configuration instance — null means no checkpointer is configured.
let _checkpointerConfig: CheckpointerConfig | null = null;

/** Get the current checkpointer configuration, or null if not configured. */
export function getCheckpointerConfig(): CheckpointerConfig | null {
  return _checkpointerConfig;
}

/** Set the checkpointer configuration. */
export function setCheckpointerConfig(config: CheckpointerConfig | null): void {
  _checkpointerConfig = config;
}

/** Lazily load app config when checkpointer config has not been initialized. */
export function ensureConfigLoaded(): void {
  const config = getCheckpointerConfig();
  if (config !== null || hasCustomAppConfig()) {
    return;
  }

  try {
    getAppConfig();
  } catch {
    // Missing config.yaml is tolerated here (mirrors Python's FileNotFoundError pass).
  }
}

/** Load checkpointer configuration from a dictionary. */
export function loadCheckpointerConfigFromDict(configDict: (Partial<CheckpointerConfig> & { type: CheckpointerType }) | null | undefined): void {
  if (configDict === null || configDict === undefined) {
    _checkpointerConfig = null;
    return;
  }
  _checkpointerConfig = buildCheckpointerConfig(configDict);
}
