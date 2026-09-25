/**
 * Capability Registry — federated registry of all capabilities.
 *
 * Inspired by OpenWork's capability registry that fans out from
 * MCP servers, skills, plugins, and built-in tools.
 *
 * The registry provides a single point of discovery for all capabilities
 * regardless of their source.
 *
 * Source patterns:
 * - OpenWork: Capability registry with federated sources
 * - Kimi Code: Plugin ecosystem with marketplace
 * - ZCode: Official MCP and plugin sync
 */

import type {
  CapabilityEntry,
  CapabilityRegistry,
  CapabilitySearchQuery,
  CapabilitySearchResult,
  CapabilitySource,
} from "./rail_types.js";

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * In-memory capability registry implementation.
 */
export class InMemoryCapabilityRegistry implements CapabilityRegistry {
  private capabilities = new Map<string, CapabilityEntry>();

  register(entry: CapabilityEntry): void {
    this.capabilities.set(entry.id, entry);
  }

  unregister(capabilityId: string): void {
    this.capabilities.delete(capabilityId);
  }

  unregisterBySource(source: CapabilitySource, sourceName: string): void {
    const toRemove: string[] = [];
    for (const [id, entry] of this.capabilities) {
      if (entry.source === source && entry.sourceName === sourceName) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.capabilities.delete(id);
    }
  }

  search(query: CapabilitySearchQuery): CapabilitySearchResult {
    let results = [...this.capabilities.values()];

    // Filter by search term
    if (query.query) {
      const search = query.query.toLowerCase();
      results = results.filter(
        (cap) =>
          cap.name.toLowerCase().includes(search) ||
          cap.description.toLowerCase().includes(search) ||
          cap.toolName.toLowerCase().includes(search) ||
          cap.tags.some((t) => t.toLowerCase().includes(search)) ||
          cap.sourceName.toLowerCase().includes(search),
      );
    }

    // Filter by source
    if (query.source) {
      results = results.filter((cap) => cap.source === query.source);
    }

    // Filter by source name
    if (query.sourceName) {
      results = results.filter((cap) => cap.sourceName === query.sourceName);
    }

    const total = results.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    results = results.slice(offset, offset + limit);

    return { capabilities: results, total, query: query.query ?? "" };
  }

  get(capabilityId: string): CapabilityEntry | null {
    return this.capabilities.get(capabilityId) ?? null;
  }

  listAll(): CapabilityEntry[] {
    return [...this.capabilities.values()];
  }

  getSources(): Array<{ source: CapabilitySource; sourceName: string; count: number }> {
    const sourceMap = new Map<string, number>();
    for (const entry of this.capabilities.values()) {
      const key = `${entry.source}:${entry.sourceName}`;
      sourceMap.set(key, (sourceMap.get(key) ?? 0) + 1);
    }

    return [...sourceMap.entries()].map(([key, count]) => {
      const colonIdx = key.indexOf(":");
      return {
        source: key.slice(0, colonIdx) as CapabilitySource,
        sourceName: key.slice(colonIdx + 1),
        count,
      };
    });
  }

  clear(): void {
    this.capabilities.clear();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let globalRegistry: InMemoryCapabilityRegistry | null = null;

/**
 * Get the global capability registry instance.
 */
export function getCapabilityRegistry(): InMemoryCapabilityRegistry {
  if (!globalRegistry) {
    globalRegistry = new InMemoryCapabilityRegistry();
  }
  return globalRegistry;
}

/**
 * Reset the global capability registry (for testing).
 */
export function resetCapabilityRegistry(): void {
  globalRegistry = null;
}
