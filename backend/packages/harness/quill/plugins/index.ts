/**
 * Plugin system — public API for plugin store with lifecycle management.
 *
 * Inspired by ZCode's plugin store with official marketplace, CDN distribution,
 * personal sources, and full lifecycle management.
 *
 * Features:
 *   - Plugin registry with state tracking (installed → configured → enabled ↔ disabled)
 *   - Marketplace browsing (search, filter, sort)
 *   - Full lifecycle operations (install, configure, enable, disable, uninstall, restore)
 *   - Update checking
 *   - Progress notifications
 */

export {
  type InstalledPlugin,
  type MarketplaceQuery,
  type MarketplaceResult,
  type PluginLifecycleState,
  type PluginManifest,
  type PluginSource,
  type PluginStoreListing,
  type PluginContributionType,
  type PluginOperationResult,
  type PluginOperationProgress,
} from "./types.js";

export {
  type PluginStoreBackend,
  MemoryPluginStoreBackend,
  type MarketplaceSource,
  PluginStore,
  getPluginStore,
  resetPluginStore,
} from "./store.js";

export {
  PLUGIN_MANIFEST_SCHEMA,
  type ManifestValidationResult,
  validateManifest,
  parseManifest,
  serializeManifest,
  createDefaultManifest,
  isNewerVersion,
} from "./manifest.js";

export {
  type ProgressCallback,
  PluginLifecycleManager,
} from "./lifecycle.js";
