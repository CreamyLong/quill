/**
 * Async stream bridge factory.
 *
 * Provides a factory aligned with
 * `quill.runtime.checkpointer.async_provider.make_checkpointer`.
 *
 * NOTE (TS port): The Python module is an `@asynccontextmanager` that yields a
 * bridge and closes it on exit. Node has no direct analogue, so this port
 * returns the constructed bridge; the caller is responsible for calling
 * `bridge.close()` (e.g. in a `finally`). The dedicated
 * `quill.config.stream_bridge_config` global is also not ported — config is
 * read from `appConfig.streamBridge` when an AppConfig is supplied.
 */

import type { AppConfig } from "../../config/app_config.js";
import { StreamBridge } from "./base.js";
import { MemoryStreamBridge } from "./memory.js";

/** Minimal local view of the stream-bridge config section. */
interface StreamBridgeConfigLike {
  type?: string;
  queue_maxsize?: number;
  redis_url?: string | null;
}

const logger = {
  info: (...a: unknown[]) => console.info(...a),
};

/**
 * Global stream-bridge config, or `null` when unset.
 *
 * Mirrors `quill.config.stream_bridge_config.get_stream_bridge_config`; the
 * setter side is not ported, so this always returns `null` unless a caller
 * threads config through `appConfig`.
 */
export function getStreamBridgeConfig(): StreamBridgeConfigLike | null {
  return null;
}

/**
 * Construct a {@link StreamBridge}.
 *
 * Falls back to {@link MemoryStreamBridge} when no configuration is provided and
 * nothing is set globally.
 */
export async function makeStreamBridge(appConfig?: AppConfig | null): Promise<StreamBridge> {
  const config: StreamBridgeConfigLike | null =
    appConfig === undefined || appConfig === null
      ? getStreamBridgeConfig()
      : (appConfig.streamBridge as StreamBridgeConfigLike | null);

  if (config === null || config === undefined || config.type === "memory") {
    const maxsize = config !== null && config !== undefined ? config.queue_maxsize ?? 256 : 256;
    const bridge = new MemoryStreamBridge({ queueMaxsize: maxsize });
    logger.info("Stream bridge initialised: memory (queue_maxsize=%d)", maxsize);
    return bridge;
  }

  if (config.type === "redis") {
    throw new Error("Redis stream bridge planned for Phase 2");
  }

  throw new Error(`Unknown stream bridge type: ${JSON.stringify(config.type)}`);
}
