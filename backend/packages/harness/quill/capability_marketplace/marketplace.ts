/**
 * Capability Marketplace — search and execution engine.
 *
 * Port of OpenWork's `search_capability` + `execute_capability` pattern.
 * Provides a unified interface for discovering and invoking capabilities
 * across skills, MCP tools, and community integrations.
 */

import type {
  Capability,
  CapabilityExecutionRequest,
  CapabilityExecutionResult,
  CapabilitySearchQuery,
  CapabilitySearchResult,
  MarketplaceConfig,
} from "./types.js";
import { DEFAULT_MARKETPLACE_CONFIG } from "./types.js";

/** Function to execute a capability by source type and ID. */
export type CapabilityExecutor = (
  source: Capability["source"],
  sourceId: string,
  args: Record<string, unknown>,
  context: { threadId?: string | null; runId?: string | null; userId?: string | null },
) => Promise<unknown>;

/**
 * Capability Marketplace — searchable registry of agent capabilities.
 *
 * Maintains an indexed registry of capabilities from multiple sources
 * (skills, MCP tools, community integrations) and provides search
 * and execution interfaces.
 */
export class CapabilityMarketplace {
  private config: MarketplaceConfig;
  private capabilities = new Map<string, Capability>();
  private executor: CapabilityExecutor | null = null;

  constructor(config: Partial<MarketplaceConfig> = {}) {
    this.config = { ...DEFAULT_MARKETPLACE_CONFIG, ...config };
  }

  /**
   * Set the executor function for running capabilities.
   */
  setExecutor(executor: CapabilityExecutor): void {
    this.executor = executor;
  }

  /**
   * Register a capability in the marketplace.
   */
  register(capability: Capability): void {
    this.capabilities.set(capability.id, capability);
  }

  /**
   * Unregister a capability by ID.
   */
  unregister(id: string): boolean {
    return this.capabilities.delete(id);
  }

  /**
   * Get a capability by ID.
   */
  get(id: string): Capability | null {
    return this.capabilities.get(id) ?? null;
  }

  /**
   * Search for capabilities matching a query.
   */
  search(query: Partial<CapabilitySearchQuery>): CapabilitySearchResult {
    const fullQuery: CapabilitySearchQuery = {
      sortBy: "relevance",
      limit: this.config.maxResults,
      offset: 0,
      availableOnly: true,
      ...query,
    };

    let results = [...this.capabilities.values()];

    // Filter by availability.
    if (fullQuery.availableOnly) {
      results = results.filter((c) => c.available);
    }

    // Filter by category.
    if (fullQuery.category) {
      results = results.filter((c) => c.category === fullQuery.category);
    }

    // Filter by source.
    if (fullQuery.source) {
      results = results.filter((c) => c.source === fullQuery.source);
    }

    // Filter by tags.
    if (fullQuery.tags && fullQuery.tags.length > 0) {
      results = results.filter((c) =>
        fullQuery.tags!.some((tag) => c.tags.includes(tag)),
      );
    }

    // Filter by search query (simple text matching on name + description).
    if (fullQuery.query) {
      const q = fullQuery.query.toLowerCase();
      results = results.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    const total = results.length;

    // Sort results.
    switch (fullQuery.sortBy) {
      case "name":
        results.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "rating":
        results.sort((a, b) => b.rating - a.rating);
        break;
      case "usage":
        results.sort((a, b) => b.usageCount - a.usageCount);
        break;
      case "recent":
        results.sort((a, b) => b.updatedAt - a.updatedAt);
        break;
      case "relevance":
      default:
        // Relevance: combine rating and usage for ranking.
        results.sort(
          (a, b) =>
            b.rating * Math.log(b.usageCount + 1) -
            a.rating * Math.log(a.usageCount + 1),
        );
        break;
    }

    // Paginate.
    const offset = fullQuery.offset || 0;
    const paginated = results.slice(offset, offset + fullQuery.limit);

    return {
      capabilities: paginated,
      total,
      hasMore: offset + fullQuery.limit < total,
    };
  }

  /**
   * Execute a capability by ID.
   */
  async execute(request: CapabilityExecutionRequest): Promise<CapabilityExecutionResult> {
    const startTime = Date.now();

    if (!this.executor) {
      return {
        success: false,
        data: null,
        error: "No executor configured",
        durationMs: 0,
      };
    }

    const capability = this.capabilities.get(request.capabilityId);
    if (!capability) {
      return {
        success: false,
        data: null,
        error: `Capability not found: ${request.capabilityId}`,
        durationMs: 0,
      };
    }

    if (!capability.available) {
      return {
        success: false,
        data: null,
        error: `Capability is not available: ${capability.name}`,
        durationMs: 0,
      };
    }

    try {
      const data = await this.executor(
        capability.source,
        capability.sourceId,
        request.args,
        {
          threadId: request.threadId,
          runId: request.runId,
          userId: request.userId,
        },
      );

      // Update usage count.
      capability.usageCount++;

      return {
        success: true,
        data,
        error: null,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Get all registered capabilities.
   */
  getAll(): Capability[] {
    return [...this.capabilities.values()];
  }

  /**
   * Get capabilities by category.
   */
  getByCategory(category: Capability["category"]): Capability[] {
    return [...this.capabilities.values()].filter((c) => c.category === category);
  }

  /**
   * Get marketplace statistics.
   */
  getStats(): {
    total: number;
    byCategory: Record<string, number>;
    bySource: Record<string, number>;
    available: number;
  } {
    const all = [...this.capabilities.values()];
    const byCategory: Record<string, number> = {};
    const bySource: Record<string, number> = {};

    for (const c of all) {
      byCategory[c.category] = (byCategory[c.category] || 0) + 1;
      bySource[c.source] = (bySource[c.source] || 0) + 1;
    }

    return {
      total: all.length,
      byCategory,
      bySource,
      available: all.filter((c) => c.available).length,
    };
  }

  /**
   * Clear all capabilities (for testing).
   */
  clear(): void {
    this.capabilities.clear();
  }
}

/** Singleton marketplace instance. */
let _marketplace: CapabilityMarketplace | null = null;

export function getMarketplace(
  config?: Partial<MarketplaceConfig>,
): CapabilityMarketplace {
  if (!_marketplace) {
    _marketplace = new CapabilityMarketplace(config);
  }
  return _marketplace;
}

export function resetMarketplace(): void {
  _marketplace = null;
}
