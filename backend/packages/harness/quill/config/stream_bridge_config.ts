/**
 * Configuration for the stream bridge.
 *
 * Mirrors `quill.config.stream_bridge_config` from the Python backend.
 */

export type StreamBridgeType = "memory" | "redis";

/** Configuration for the stream bridge that connects agent workers to SSE endpoints. */
export interface StreamBridgeConfig {
  /** Stream bridge backend type. */
  type: StreamBridgeType;
  /** Redis URL for the redis stream bridge type. */
  redisUrl: string | null;
  /** Maximum number of events buffered per run in the memory bridge. */
  queueMaxsize: number;
}

export function buildStreamBridgeConfig(input: Partial<StreamBridgeConfig> = {}): StreamBridgeConfig {
  return {
    type: input.type ?? "memory",
    redisUrl: input.redisUrl ?? null,
    queueMaxsize: input.queueMaxsize ?? 256,
  };
}

// Global configuration instance — null means no stream bridge is configured
// (falls back to memory with defaults).
let _streamBridgeConfig: StreamBridgeConfig | null = null;

/** Get the current stream bridge configuration, or null if not configured. */
export function getStreamBridgeConfig(): StreamBridgeConfig | null {
  return _streamBridgeConfig;
}

/** Set the stream bridge configuration. */
export function setStreamBridgeConfig(config: StreamBridgeConfig | null): void {
  _streamBridgeConfig = config;
}

/** Load stream bridge configuration from a dictionary. */
export function loadStreamBridgeConfigFromDict(configDict: Partial<StreamBridgeConfig> | null | undefined): void {
  if (configDict === null || configDict === undefined) {
    _streamBridgeConfig = null;
    return;
  }
  _streamBridgeConfig = buildStreamBridgeConfig(configDict);
}
