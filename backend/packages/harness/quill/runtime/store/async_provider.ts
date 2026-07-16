/**
 * Async Store factory — backend mirrors the configured checkpointer.
 *
 * The store and checkpointer share the same `checkpointer` section in
 * config.yaml so they always use the same persistence backend:
 *
 * - `type: memory`   → InMemoryStore
 * - `type: sqlite`   → node:sqlite-backed SqliteStore
 * - `type: postgres` → (no TS analogue — throws)
 *
 * NOTE (TS port): The Python `@asynccontextmanager` has no direct analogue, so
 * this returns `{ store, close }`; the caller invokes `close()` in a `finally`.
 */

import { InMemoryStore } from "@langchain/langgraph";

import { getAppConfig, type AppConfig } from "../../config/app_config.js";
import type { CheckpointerConfig } from "../checkpointer/provider.js";
import { buildStore, type StoreHandle } from "./provider.js";

const logger = {
  warning: (...a: unknown[]) => console.warn(...a),
};

const NO_CHECKPOINTER_WARNING =
  "No 'checkpointer' section in config.yaml — using InMemoryStore for the store. Thread list will be lost on server restart. Configure a sqlite or postgres backend for persistence.";

/**
 * Async factory that yields a Store whose backend matches the configured
 * checkpointer.
 *
 * Reads from the same `checkpointer` section of config.yaml used by
 * `makeCheckpointer` so that both always use the same persistence technology.
 *
 * Returns an `InMemoryStore` when no `checkpointer` section is configured
 * (emits a WARNING in that case).
 */
export async function makeStore(appConfig: AppConfig | null = null): Promise<StoreHandle> {
  const config = appConfig ?? getAppConfig();

  if (config.checkpointer === null || config.checkpointer === undefined) {
    logger.warning(NO_CHECKPOINTER_WARNING);
    return { store: new InMemoryStore(), close: () => {} };
  }

  const raw = config.checkpointer;
  return buildStore({
    type: (raw["type"] as CheckpointerConfig["type"]) ?? "memory",
    connection_string: (raw["connection_string"] as string | null | undefined) ?? null,
  });
}
