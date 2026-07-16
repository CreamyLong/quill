/**
 * MCP tool caching with mtime-based staleness detection.
 *
 * Port of the Python `quill.mcp.cache` module (166 lines), simplified for
 * Node.js's single-threaded event loop: Python's `asyncio.Lock` +
 * `ThreadPoolExecutor` shenanigans become a single `_initPromise` that
 * concurrent callers await.
 *
 * Staleness is detected by comparing the `extensions_config.json` file's
 * `mtimeMs` at load time against its current value on each access. If the file
 * changed since we last cached, the cache is invalidated and tools are
 * reloaded on the next access — this is what makes `PUT /api/mcp/config`
 * effective immediately (paired with `gateway_server.mjs:reloadMcpTools`).
 */

import { statSync } from "node:fs";

import { loadMcpTools, type LoadedMcp, type LoadMcpToolsOptions } from "./client.js";
import { resetSessionManager } from "./session_manager.js";
import { ExtensionsConfig } from "../config/extensions_config.js";

/**
 * Extra options forwarded to `loadMcpTools()`. Set once at gateway startup
 * (interceptors, OAuth manager) and reused on every cache refresh so the hooks
 * don't need to be reloaded from disk each time.
 */
let _loadOptions: LoadMcpToolsOptions = {};

/**
 * Set options that `initializeMcpTools` / `getCachedMcpTools` forward to the
 * underlying `loadMcpTools()` call. Typically called once at startup.
 */
export function setMcpLoadOptions(options: LoadMcpToolsOptions): void {
  _loadOptions = options;
}

/** Cached tools + metadata, or null when not initialized. */
let _cachedTools: LoadedMcp | null = null;
/** mtimeMs of the config file at the time we loaded `_cachedTools`. */
let _configMtime: number | null = null;
/** Guards against concurrent lazy-init. Concurrent callers share this promise. */
let _initPromise: Promise<LoadedMcp> | null = null;

/**
 * Resolve the extensions config file path.
 *
 * Re-uses `ExtensionsConfig.resolveConfigPath()` so the search order stays in
 * sync with the rest of the codebase (explicit arg → env → project root →
 * legacy defaults). Falls back to a simple cwd scan if the class method throws.
 */
function getConfigPath(): string | null {
  try {
    return ExtensionsConfig.resolveConfigPath(null);
  } catch {
    // Fall back to a simple cwd scan.
    for (const name of ["extensions_config.json", "mcp_config.json"]) {
      const p = `${process.cwd()}/${name}`;
      try {
        statSync(p);
        return p;
      } catch {
        // not here
      }
    }
    return null;
  }
}

/** Return the config file's current mtime, or null if it can't be stat'd. */
function getCurrentMtime(): number | null {
  const path = getConfigPath();
  if (!path) return null;
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Returns true when the config file has been modified since we last cached.
 * Not-yet-initialized is considered "not stale" (the lazy-init path handles it).
 */
export function isCacheStale(): boolean {
  if (!_cachedTools || _configMtime === null) return false;
  const current = getCurrentMtime();
  if (current === null) return false; // can't tell; treat as fresh
  return current > _configMtime;
}

/**
 * Load and cache MCP tools from the on-disk `extensions_config.json`.
 * Safe for concurrent calls: only one load runs at a time, awaiters share it.
 */
export async function initializeMcpTools(): Promise<LoadedMcp> {
  if (_cachedTools && !isCacheStale()) {
    return _cachedTools;
  }

  // Dedupe concurrent calls.
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const extCfg = ExtensionsConfig.fromFile();
      // Cast through unknown: the config module's McpServerConfig.type is `string`
      // while client.ts expects `McpTransport`, but they are structurally compatible.
      const loaded = await loadMcpTools(
        { mcpServers: extCfg.mcpServers as Record<string, unknown> as never },
        _loadOptions,
      );
      _cachedTools = loaded;
      _configMtime = getCurrentMtime();
      return loaded;
    } finally {
      _initPromise = null;
    }
  })();

  return _initPromise;
}

/**
 * Get cached MCP tools, re-initializing if the cache is stale.
 *
 * This is the primary consumer-facing getter (analogous to Python's
 * `get_cached_mcp_tools()`). It is safe to call repeatedly.
 */
export async function getCachedMcpTools(): Promise<LoadedMcp> {
  if (isCacheStale()) {
    resetMcpToolsCache();
  }
  if (!_cachedTools) {
    return initializeMcpTools();
  }
  return _cachedTools;
}

/**
 * Synchronous peek at the currently cached tools (no reload, no init).
 * Returns null if not yet initialized or if the cache was reset.
 *
 * Useful for non-async contexts that want the last-known-good tools.
 */
export function peekCachedMcpTools(): LoadedMcp | null {
  return _cachedTools;
}

/**
 * Reset the cache: clear tools, close all MCP sessions, drop the session
 * manager singleton. The next `getCachedMcpTools()` call reloads from disk.
 */
export function resetMcpToolsCache(): void {
  // Close the cached client's connections (SDK teardown).
  const client = _cachedTools?.client;
  if (client) {
    void (client as unknown as { close: () => Promise<void> }).close().catch((e) => {
      console.debug(`[mcp] cache reset: client close failed: ${e instanceof Error ? e.message : e}`);
    });
  }
  _cachedTools = null;
  _configMtime = null;

  // Tear down the session manager so sessions are recreated on the next load.
  resetSessionManager();

  console.log("[mcp] tool cache reset");
}
