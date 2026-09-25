/**
 * Plugin Store — marketplace, discovery, and registry.
 *
 * Inspired by ZCode's plugin store with official marketplace, CDN distribution,
 * personal sources, featured plugins, and catalog auto-refresh.
 *
 * The store manages:
 *   - Plugin registry (all known plugins and their state)
 *   - Marketplace browsing (search, filter, sort)
 *   - Source management (official, personal, marketplace)
 *   - Featured plugin curation
 *
 * Source patterns:
 * - ZCode: Plugin store with marketplace, CDN, personal sources
 * - OpenClaw: ClawHub with official publisher status and provenance
 * - Kimi Code: Plugin marketplace with trust levels
 */

import type {
  InstalledPlugin,
  MarketplaceQuery,
  MarketplaceResult,
  PluginLifecycleState,
  PluginManifest,
  PluginSource,
  PluginStoreListing,
} from "./types.js";

// ---------------------------------------------------------------------------
// Plugin Store interface
// ---------------------------------------------------------------------------

/**
 * Storage backend for plugin state.
 * Can be implemented with filesystem, SQLite, or remote API.
 */
export interface PluginStoreBackend {
  /** List all installed plugins. */
  list(): Promise<InstalledPlugin[]>;
  /** Get a specific plugin by name. */
  get(name: string): Promise<InstalledPlugin | null>;
  /** Save a plugin record. */
  save(plugin: InstalledPlugin): Promise<void>;
  /** Delete a plugin record. */
  remove(name: string): Promise<void>;
  /** Clear all records. */
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory backend (default)
// ---------------------------------------------------------------------------

/**
 * In-memory plugin store backend.
 * Suitable for testing and single-process deployments.
 */
export class MemoryPluginStoreBackend implements PluginStoreBackend {
  private plugins = new Map<string, InstalledPlugin>();

  async list(): Promise<InstalledPlugin[]> {
    return [...this.plugins.values()];
  }

  async get(name: string): Promise<InstalledPlugin | null> {
    return this.plugins.get(name) ?? null;
  }

  async save(plugin: InstalledPlugin): Promise<void> {
    this.plugins.set(plugin.manifest.name, plugin);
  }

  async remove(name: string): Promise<void> {
    this.plugins.delete(name);
  }

  async clear(): Promise<void> {
    this.plugins.clear();
  }
}

// ---------------------------------------------------------------------------
// Marketplace source interface
// ---------------------------------------------------------------------------

/**
 * A marketplace source that can be queried for available plugins.
 */
export interface MarketplaceSource {
  /** Source identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Whether this is the official marketplace. */
  official: boolean;
  /** Query available plugins. */
  query(params: MarketplaceQuery): Promise<MarketplaceResult>;
  /** Get a specific plugin's listing. */
  getListing(name: string): Promise<PluginStoreListing | null>;
  /** Get featured plugins. */
  getFeatured(): Promise<PluginStoreListing[]>;
  /** Get available categories. */
  getCategories(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Plugin Store
// ---------------------------------------------------------------------------

/**
 * Plugin Store — central registry for plugin discovery and state.
 */
export class PluginStore {
  private backend: PluginStoreBackend;
  private sources: MarketplaceSource[] = [];
  private featuredPlugins = new Map<string, PluginStoreListing>();
  private categories = new Set<string>();

  constructor(backend?: PluginStoreBackend) {
    this.backend = backend ?? new MemoryPluginStoreBackend();
  }

  // ------------------------------------------------------------------
  // Source management
  // ------------------------------------------------------------------

  /**
   * Register a marketplace source.
   */
  registerSource(source: MarketplaceSource): void {
    // Replace existing source with same id
    this.sources = this.sources.filter((s) => s.id !== source.id);
    this.sources.push(source);
  }

  /**
   * Remove a marketplace source.
   */
  removeSource(id: string): void {
    this.sources = this.sources.filter((s) => s.id !== id);
  }

  /**
   * Get all registered sources.
   */
  getSources(): MarketplaceSource[] {
    return [...this.sources];
  }

  // ------------------------------------------------------------------
  // Plugin registry
  // ------------------------------------------------------------------

  /**
   * Get all installed plugins.
   */
  async listInstalled(): Promise<InstalledPlugin[]> {
    return this.backend.list();
  }

  /**
   * Get installed plugins filtered by state.
   */
  async listByState(state: PluginLifecycleState): Promise<InstalledPlugin[]> {
    const all = await this.backend.list();
    return all.filter((p) => p.state === state);
  }

  /**
   * Get a specific installed plugin.
   */
  async getInstalled(name: string): Promise<InstalledPlugin | null> {
    return this.backend.get(name);
  }

  /**
   * Register or update an installed plugin.
   */
  async registerPlugin(plugin: InstalledPlugin): Promise<void> {
    await this.backend.save(plugin);
  }

  /**
   * Remove a plugin from the registry.
   */
  async unregisterPlugin(name: string): Promise<void> {
    await this.backend.remove(name);
  }

  // ------------------------------------------------------------------
  // Marketplace browsing
  // ------------------------------------------------------------------

  /**
   * Query the marketplace for available plugins.
   *
   * Aggregates results from all registered sources.
   */
  async queryMarketplace(params: MarketplaceQuery): Promise<MarketplaceResult> {
    if (this.sources.length === 0) {
      return { plugins: [], total: 0, offset: params.offset ?? 0, limit: params.limit ?? 50 };
    }

    // Query all sources in parallel
    const results = await Promise.allSettled(
      this.sources.map((source) => source.query(params)),
    );

    // Aggregate results
    const allListings: PluginStoreListing[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        allListings.push(...result.value.plugins);
      }
    }

    // Deduplicate by name (official sources take precedence)
    const seen = new Map<string, PluginStoreListing>();
    for (const listing of allListings) {
      const existing = seen.get(listing.manifest.name);
      if (!existing || listing.manifest.source === "official") {
        seen.set(listing.manifest.name, listing);
      }
    }

    let plugins = [...seen.values()];

    // Filter by search term
    if (params.search) {
      const search = params.search.toLowerCase();
      plugins = plugins.filter(
        (p) =>
          p.manifest.name.toLowerCase().includes(search) ||
          p.manifest.displayName.toLowerCase().includes(search) ||
          p.manifest.description.toLowerCase().includes(search) ||
          p.manifest.keywords?.some((k) => k.toLowerCase().includes(search)),
      );
    }

    // Filter by category
    if (params.category) {
      const cat = params.category;
      plugins = plugins.filter((p) => p.manifest.categories?.includes(cat));
    }

    // Filter by source
    if (params.source && params.source !== "all") {
      const sourceFilter = params.source as PluginSource;
      plugins = plugins.filter((p) => p.manifest.source === sourceFilter);
    }

    // Sort
    const sort = params.sort ?? "featured";
    plugins = this.sortPlugins(plugins, sort);

    const total = plugins.length;
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 50;
    plugins = plugins.slice(offset, offset + limit);

    return { plugins, total, offset, limit };
  }

  /**
   * Get featured plugins from all sources.
   */
  async getFeatured(): Promise<PluginStoreListing[]> {
    const allFeatured: PluginStoreListing[] = [];
    for (const source of this.sources) {
      try {
        const featured = await source.getFeatured();
        allFeatured.push(...featured);
      } catch {
        // Source unavailable, skip
      }
    }
    return allFeatured;
  }

  /**
   * Get available categories from all sources.
   */
  async getCategories(): Promise<string[]> {
    const categories = new Set<string>();
    for (const source of this.sources) {
      try {
        const cats = await source.getCategories();
        for (const cat of cats) {
          categories.add(cat);
        }
      } catch {
        // Source unavailable, skip
      }
    }
    return [...categories].sort();
  }

  /**
   * Get a specific plugin's listing from any source.
   */
  async getListing(name: string): Promise<PluginStoreListing | null> {
    for (const source of this.sources) {
      try {
        const listing = await source.getListing(name);
        if (listing) return listing;
      } catch {
        // Source unavailable, try next
      }
    }
    return null;
  }

  /**
   * Refresh the marketplace catalog.
   * Called periodically and on user request.
   */
  async refreshCatalog(): Promise<void> {
    // Clear current featured
    this.featuredPlugins.clear();
    this.categories.clear();

    // Refresh from all sources
    await Promise.allSettled(
      this.sources.map(async (source) => {
        try {
          const featured = await source.getFeatured();
          for (const f of featured) {
            this.featuredPlugins.set(f.manifest.name, f);
          }
          const cats = await source.getCategories();
          for (const cat of cats) {
            this.categories.add(cat);
          }
        } catch {
          // Source unavailable
        }
      }),
    );
  }

  // ------------------------------------------------------------------
  // Sync & comparison
  // ------------------------------------------------------------------

  /**
   * Check for updates to installed plugins.
   *
   * Compares installed versions with marketplace listings.
   */
  async checkUpdates(): Promise<Array<{ name: string; currentVersion: string; availableVersion: string }>> {
    const installed = await this.backend.list();
    const updates: Array<{ name: string; currentVersion: string; availableVersion: string }> = [];

    for (const plugin of installed) {
      if (plugin.manifest.source === "builtin") continue;

      const listing = await this.getListing(plugin.manifest.name);
      if (listing && this.isNewer(plugin.manifest.version, listing.manifest.version)) {
        updates.push({
          name: plugin.manifest.name,
          currentVersion: plugin.manifest.version,
          availableVersion: listing.manifest.version,
        });
      }
    }

    return updates;
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private sortPlugins(plugins: PluginStoreListing[], sort: string): PluginStoreListing[] {
    const sorted = [...plugins];
    switch (sort) {
      case "featured":
        sorted.sort((a, b) => {
          if (a.featured !== b.featured) return a.featured ? -1 : 1;
          return b.installs - a.installs;
        });
        break;
      case "installs":
        sorted.sort((a, b) => b.installs - a.installs);
        break;
      case "rating":
        sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
        break;
      case "updated":
        sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        break;
      case "name":
        sorted.sort((a, b) => a.manifest.displayName.localeCompare(b.manifest.displayName));
        break;
    }
    return sorted;
  }

  private isNewer(current: string, candidate: string): boolean {
    const parse = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);
    const cp = parse(current);
    const cc = parse(candidate);
    for (let i = 0; i < Math.max(cp.length, cc.length); i++) {
      const a = cp[i] ?? 0;
      const b = cc[i] ?? 0;
      if (b > a) return true;
      if (b < a) return false;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let globalStore: PluginStore | null = null;

/**
 * Get the global plugin store instance.
 */
export function getPluginStore(): PluginStore {
  if (!globalStore) {
    globalStore = new PluginStore();
  }
  return globalStore;
}

/**
 * Reset the global plugin store (for testing).
 */
export function resetPluginStore(): void {
  globalStore = null;
}
