/**
 * MCP session / connection management.
 *
 * Port of the Python `quill.mcp.session_pool` module, simplified for Node.js.
 * The Python version (~455 lines) exists primarily to satisfy anyio's
 * "cancel scope must be exited from the same task" requirement and to provide
 * thread-safe sync teardown. Node.js is single-threaded and its MCP SDK
 * (`@langchain/mcp-adapters`) already manages per-server reconnect/restart, so
 * the implementation here is intentionally lightweight:
 *
 *   * Track the active `MultiServerMCPClient` per client-key.
 *   * Provide scoped close (`closeScope`) and full teardown (`closeAll`).
 *   * LRU cap on the number of cached sessions to bound memory.
 *
 * The real value it adds over the SDK's internal pool is: (a) deterministic
 * teardown when the cache is reset (config hot-reload), and (b) a hook point
 * for per-(server, thread) session scoping if a future server needs it.
 */

import type { MultiServerMCPClient } from "@langchain/mcp-adapters";

/** LRU cap — mirrors Python `MCPSessionPool.MAX_SESSIONS`. */
const MAX_SESSIONS = 256;

interface PoolEntry {
  client: MultiServerMCPClient;
  /** Servers managed by this client instance. */
  servers: string[];
  /** Last-access bookkeeping for LRU eviction. */
  lastUsed: number;
}

/**
 * Manages the lifecycle of `MultiServerMCPClient` instances.
 *
 * In the common case there is a single `MultiServerMCPClient` holding all
 * configured servers. Multiple entries only appear if connection configs change
 * across reloads before old references are released.
 */
export class SessionManager {
  private readonly entries = new Map<string, PoolEntry>();
  private accessClock = 0;

  constructor(private readonly createClient: (servers: string[]) => Promise<MultiServerMCPClient>) {}

  /**
   * Get (or create) a `MultiServerMCPClient` that owns the listed servers.
   *
   * The `scopeKey` allows future per-(user, thread) isolation; for now it's
   * used only as part of the cache key so different scopes get independent
   * client instances.
   */
  async getClient(scopeKey: string, serverNames: string[]): Promise<MultiServerMCPClient> {
    const key = `${scopeKey}::${serverNames.sort().join(",")}`;
    const existing = this.entries.get(key);
    if (existing) {
      existing.lastUsed = ++this.accessClock;
      return existing.client;
    }

    // Evict the least-recently-used entry if at capacity.
    if (this.entries.size >= MAX_SESSIONS) {
      this.evictLru();
    }

    const client = await this.createClient(serverNames);
    this.entries.set(key, { client, servers: serverNames, lastUsed: ++this.accessClock });
    return client;
  }

  /**
   * Close all entries whose key begins with the given `scopeKey` prefix.
   * Useful when a thread is deleted and its sessions should be reaped.
   */
  closeScope(scopeKey: string): void {
    for (const [key, entry] of this.entries) {
      if (key.startsWith(`${scopeKey}::`)) {
        void closeClient(entry.client);
        this.entries.delete(key);
      }
    }
  }

  /** Close and drop every managed client. */
  async closeAll(): Promise<void> {
    const clients = [...this.entries.values()].map((e) => e.client);
    this.entries.clear();
    await Promise.allSettled(clients.map(closeClient));
  }

  get size(): number {
    return this.entries.size;
  }

  private evictLru(): void {
    let oldestKey: string | null = null;
    let oldestUsed = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.lastUsed < oldestUsed) {
        oldestUsed = entry.lastUsed;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      const entry = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (entry) void closeClient(entry.client);
    }
  }
}

// ---------------------------------------------------------------------------
// Module singleton
// ---------------------------------------------------------------------------

let _manager: SessionManager | null = null;

/** Get the global session manager, creating it lazily if needed. */
export function getSessionManager(): SessionManager {
  if (!_manager) {
    _manager = new SessionManager(async (servers: string[]) => {
      // This is a placeholder — the actual client construction happens in
      // `client.ts:loadMcpTools`. We delegate back to it so the manager can
      // remain transport-agnostic.
      const { loadMcpTools } = await import("./client.js");
      const loaded = await loadMcpTools({ mcpServers: {} });
      void servers;
      return loaded.client!;
    });
  }
  return _manager;
}

/**
 * Reset the global session manager — close all sessions and drop the singleton.
 * Called by `resetMcpToolsCache()` so the next `initializeMcpTools()` call
 * creates fresh sessions.
 */
export function resetSessionManager(): void {
  if (_manager) {
    void _manager.closeAll();
    _manager = null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Best-effort close of a `MultiServerMCPClient`. The SDK client exposes
 * `close()` which tears down all its underlying connections.
 */
async function closeClient(client: MultiServerMCPClient): Promise<void> {
  try {
    // The SDK client's close() returns a Promise.
    await (client as unknown as { close: () => Promise<void> }).close();
  } catch (e) {
    // A failing close is a resource leak, not a correctness bug — log and move on.
    console.debug(`[mcp] session close failed: ${e instanceof Error ? e.message : e}`);
  }
}
