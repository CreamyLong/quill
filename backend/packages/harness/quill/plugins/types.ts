/**
 * Plugin system — shared types for the plugin store with lifecycle management.
 *
 * Inspired by ZCode's plugin store with official marketplace, CDN distribution,
 * personal sources, and full lifecycle management (install/configure/enable/
 * disable/uninstall/restore).
 *
 * A plugin is a directory or packaged archive containing:
 *   - plugin.json  (manifest: name, version, contributions, entrypoint)
 *   - <files>      (the plugin code, skills, hooks, MCP configs)
 *
 * Plugins contribute capabilities through the existing ContributionKind system:
 *   middleware, lifecycle_hook, observer, gateway_service, http_router
 * plus plugin-specific contributions: commands, agents, skills, hooks, mcpServers.
 *
 * Source patterns:
 * - ZCode: Plugin Store with lifecycle management and marketplace
 * - OpenClaw: Plugin SDK with ClawHub marketplace and provenance
 * - Kimi Code: Plugin ecosystem with trust levels
 * - DeepSeek Harness: Cordis everything-is-a-plugin architecture
 */

import type { ContributionKind } from "../extensions/manager.js";

// ---------------------------------------------------------------------------
// Plugin source types
// ---------------------------------------------------------------------------

/**
 * Where a plugin was installed from.
 */
export type PluginSource =
  | "builtin"      // Bundled with the application
  | "official"     // Official marketplace (CDN-distributed, sha256-verified)
  | "personal"     // User-added: git/URL/local directory/inline
  | "marketplace"; // Third-party marketplace

/**
 * Plugin lifecycle states.
 */
export type PluginLifecycleState =
  | "installed"    // Plugin files present, not yet configured
  | "configured"   // Configuration applied, ready to enable
  | "enabled"      // Active and running
  | "disabled"     // Installed but inactive
  | "error"        // Error state (see lastError)
  | "uninstalling" // Uninstall in progress
  | "orphaned";    // Source removed but data present

/**
 * Contribution types specific to plugins (beyond the 5 core ContributionKinds).
 */
export type PluginContributionType =
  | ContributionKind
  | "command"      // Slash commands
  | "agent"        // Custom agent definitions
  | "skill"        // Skill packages
  | "mcp_server"   // MCP server configurations
  | "hook";        // Workspace hooks

// ---------------------------------------------------------------------------
// Plugin manifest
// ---------------------------------------------------------------------------

/**
 * Plugin manifest — the plugin.json schema.
 *
 * This is the functional definition of what the plugin is and does.
 */
export interface PluginManifest {
  /** Unique plugin identifier (kebab-case). */
  name: string;
  /** Semver version. */
  version: string;
  /** Human-readable display name. */
  displayName: string;
  /** Short description. */
  description: string;
  /** Author name or organization. */
  author: string;
  /** License identifier (e.g., "MIT", "Apache-2.0"). */
  license: string;
  /** Plugin source type. */
  source: PluginSource;
  /** Entrypoint file (relative to plugin directory). */
  entrypoint?: string;
  /** Homepage or documentation URL. */
  homepage?: string;
  /** Categories for marketplace browsing. */
  categories?: string[];
  /** Keywords for search. */
  keywords?: string[];
  /** Icon URL or base64 data. */
  icon?: string;
  /** Example prompts (shown in marketplace detail). */
  examplePrompts?: string[];
  /** Contribution types this plugin provides. */
  contributes: PluginContributionType[];
  /** Dependencies on other plugins. */
  dependencies?: string[];
  /** Minimum Quill version required. */
  minQuillVersion?: string;
  /** Config schema (JSON Schema) for user configuration. */
  configSchema?: Record<string, unknown> | null;
  /** Default configuration values. */
  defaultConfig?: Record<string, unknown>;
  /** sha256 hash for CDN-distributed plugins. */
  sha256?: string;
  /** Size in bytes. */
  sizeBytes?: number;
}

/**
 * Store listing metadata — how the plugin appears in the marketplace.
 * This is separate from the manifest and is about presentation.
 */
export interface PluginStoreListing {
  manifest: PluginManifest;
  /** Download count. */
  installs: number;
  /** Average rating (0-5). */
  rating?: number;
  /** Whether this is a featured plugin. */
  featured: boolean;
  /** Last update timestamp. */
  updatedAt: string;
  /** Whether the plugin is verified by the marketplace. */
  verified: boolean;
}

// ---------------------------------------------------------------------------
// Installed plugin state
// ---------------------------------------------------------------------------

/**
 * Runtime state of an installed plugin.
 */
export interface InstalledPlugin {
  manifest: PluginManifest;
  /** Current lifecycle state. */
  state: PluginLifecycleState;
  /** Absolute path to the plugin directory. */
  directory: string;
  /** User configuration values. */
  config: Record<string, unknown>;
  /** Installation timestamp. */
  installedAt: string;
  /** Last update timestamp. */
  updatedAt: string;
  /** Last error message if state is "error". */
  lastError?: string;
  /** Whether this is a restorable builtin plugin. */
  restorableBuiltin?: boolean;
  /** Pending operation (if any). */
  pendingOperation?: "install" | "update" | "uninstall" | "enable" | "disable";
}

// ---------------------------------------------------------------------------
// Marketplace types
// ---------------------------------------------------------------------------

/**
 * Marketplace query parameters.
 */
export interface MarketplaceQuery {
  /** Search term. */
  search?: string;
  /** Category filter. */
  category?: string;
  /** Source filter (official, personal, all). */
  source?: PluginSource | "all";
  /** Sort order. */
  sort?: "featured" | "installs" | "rating" | "updated" | "name";
  /** Pagination. */
  offset?: number;
  limit?: number;
}

/**
 * Marketplace query result.
 */
export interface MarketplaceResult {
  plugins: PluginStoreListing[];
  total: number;
  offset: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Plugin operation results
// ---------------------------------------------------------------------------

/**
 * Result of a plugin operation.
 */
export interface PluginOperationResult {
  success: boolean;
  message: string;
  pluginName: string;
  /** New state after the operation. */
  newState?: PluginLifecycleState;
}

/**
 * Progress notification for long-running plugin operations.
 */
export interface PluginOperationProgress {
  pluginName: string;
  operation: string;
  /** Progress percentage (0-100). */
  progress: number;
  /** Status message. */
  message: string;
  /** Whether the operation is complete. */
  complete: boolean;
  /** Whether the operation failed. */
  failed?: boolean;
  error?: string;
}
