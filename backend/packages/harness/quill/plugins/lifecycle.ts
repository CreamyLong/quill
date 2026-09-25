/**
 * Plugin Lifecycle — install, configure, enable, disable, uninstall, restore.
 *
 * Inspired by ZCode's plugin lifecycle management with full state transitions
 * and OpenClaw's provenance-verified plugin operations.
 *
 * Lifecycle states:
 *   installed → configured → enabled ↔ disabled
 *   installed → error
 *   enabled/disable → uninstalling → (removed)
 *   builtin disabled → restorable (appears in marketplace, can be restored)
 *
 * Source patterns:
 * - ZCode: Plugin lifecycle with full state machine and persistence
 * - OpenClaw: Plugin SDK with clean install/uninstall
 * - DeepSeek Harness: Cordis reversible effects for hot-reload
 */

import type {
  InstalledPlugin,
  PluginLifecycleState,
  PluginManifest,
  PluginOperationResult,
  PluginOperationProgress,
} from "./types.js";
import type { PluginStore } from "./store.js";

// ---------------------------------------------------------------------------
// Progress callback
// ---------------------------------------------------------------------------

/**
 * Callback for receiving progress updates during long operations.
 */
export type ProgressCallback = (progress: PluginOperationProgress) => void;

// ---------------------------------------------------------------------------
// Lifecycle manager
// ---------------------------------------------------------------------------

/**
 * Manages plugin lifecycle transitions.
 */
export class PluginLifecycleManager {
  private store: PluginStore;
  private progressCallbacks: ProgressCallback[] = [];

  constructor(store: PluginStore) {
    this.store = store;
  }

  /**
   * Register a progress callback.
   */
  onProgress(callback: ProgressCallback): void {
    this.progressCallbacks.push(callback);
  }

  /**
   * Emit a progress update to all registered callbacks.
   */
  private emitProgress(progress: PluginOperationProgress): void {
    for (const cb of this.progressCallbacks) {
      try {
        cb(progress);
      } catch {
        // Callback error should not interrupt the operation
      }
    }
  }

  // ------------------------------------------------------------------
  // Install
  // ------------------------------------------------------------------

  /**
   * Install a plugin from a manifest and source directory.
   *
   * Transitions: (none) → installed → configured
   */
  async install(
    manifest: PluginManifest,
    sourceDirectory: string,
  ): Promise<PluginOperationResult> {
    const name = manifest.name;

    this.emitProgress({
      pluginName: name,
      operation: "install",
      progress: 0,
      message: `Installing ${name}@${manifest.version}...`,
      complete: false,
    });

    try {
      // Check if already installed
      const existing = await this.store.getInstalled(name);
      if (existing) {
        return {
          success: false,
          message: `Plugin "${name}" is already installed (v${existing.manifest.version}). Use update instead.`,
          pluginName: name,
        };
      }

      this.emitProgress({
        pluginName: name,
        operation: "install",
        progress: 30,
        message: `Registering ${name}...`,
        complete: false,
      });

      // Create installed plugin record
      const now = new Date().toISOString();
      const plugin: InstalledPlugin = {
        manifest,
        state: "installed",
        directory: sourceDirectory,
        config: manifest.defaultConfig ?? {},
        installedAt: now,
        updatedAt: now,
      };

      // Apply default configuration
      await this.store.registerPlugin(plugin);

      this.emitProgress({
        pluginName: name,
        operation: "install",
        progress: 70,
        message: `Applying configuration...`,
        complete: false,
      });

      // Transition to configured
      plugin.state = "configured";
      await this.store.registerPlugin(plugin);

      this.emitProgress({
        pluginName: name,
        operation: "install",
        progress: 100,
        message: `${name}@${manifest.version} installed successfully.`,
        complete: true,
      });

      return {
        success: true,
        message: `Plugin "${name}@${manifest.version}" installed successfully.`,
        pluginName: name,
        newState: "configured",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitProgress({
        pluginName: name,
        operation: "install",
        progress: 0,
        message: `Installation failed: ${message}`,
        complete: true,
        failed: true,
        error: message,
      });

      return {
        success: false,
        message: `Failed to install "${name}": ${message}`,
        pluginName: name,
      };
    }
  }

  // ------------------------------------------------------------------
  // Configure
  // ------------------------------------------------------------------

  /**
   * Update a plugin's configuration.
   *
   * Only allowed in installed or configured states.
   */
  async configure(
    name: string,
    config: Record<string, unknown>,
  ): Promise<PluginOperationResult> {
    const plugin = await this.store.getInstalled(name);
    if (!plugin) {
      return {
        success: false,
        message: `Plugin "${name}" is not installed.`,
        pluginName: name,
      };
    }

    if (plugin.state !== "installed" && plugin.state !== "configured" && plugin.state !== "disabled") {
      return {
        success: false,
        message: `Cannot configure plugin "${name}" in state "${plugin.state}".`,
        pluginName: name,
      };
    }

    plugin.config = { ...plugin.config, ...config };
    plugin.state = "configured";
    plugin.updatedAt = new Date().toISOString();
    await this.store.registerPlugin(plugin);

    return {
      success: true,
      message: `Plugin "${name}" configured.`,
      pluginName: name,
      newState: "configured",
    };
  }

  // ------------------------------------------------------------------
  // Enable
  // ------------------------------------------------------------------

  /**
   * Enable a plugin.
   *
   * Transitions: configured/disabled → enabled
   */
  async enable(name: string): Promise<PluginOperationResult> {
    const plugin = await this.store.getInstalled(name);
    if (!plugin) {
      return {
        success: false,
        message: `Plugin "${name}" is not installed.`,
        pluginName: name,
      };
    }

    if (plugin.state === "enabled") {
      return {
        success: true,
        message: `Plugin "${name}" is already enabled.`,
        pluginName: name,
        newState: "enabled",
      };
    }

    if (plugin.state !== "configured" && plugin.state !== "disabled") {
      return {
        success: false,
        message: `Cannot enable plugin "${name}" in state "${plugin.state}".`,
        pluginName: name,
      };
    }

    // Check dependencies
    for (const dep of plugin.manifest.dependencies ?? []) {
      const depPlugin = await this.store.getInstalled(dep);
      if (!depPlugin || depPlugin.state !== "enabled") {
        return {
          success: false,
          message: `Plugin "${name}" depends on "${dep}" which is not enabled.`,
          pluginName: name,
        };
      }
    }

    plugin.state = "enabled";
    plugin.updatedAt = new Date().toISOString();
    plugin.lastError = undefined;
    await this.store.registerPlugin(plugin);

    return {
      success: true,
      message: `Plugin "${name}" enabled.`,
      pluginName: name,
      newState: "enabled",
    };
  }

  // ------------------------------------------------------------------
  // Disable
  // ------------------------------------------------------------------

  /**
   * Disable a plugin.
   *
   * Transitions: enabled → disabled
   */
  async disable(name: string): Promise<PluginOperationResult> {
    const plugin = await this.store.getInstalled(name);
    if (!plugin) {
      return {
        success: false,
        message: `Plugin "${name}" is not installed.`,
        pluginName: name,
      };
    }

    if (plugin.state !== "enabled") {
      return {
        success: false,
        message: `Plugin "${name}" is not enabled (current state: ${plugin.state}).`,
        pluginName: name,
      };
    }

    // Check if other enabled plugins depend on this one
    const all = await this.store.listInstalled();
    for (const other of all) {
      if (other.manifest.name === name) continue;
      if (other.state !== "enabled") continue;
      if (other.manifest.dependencies?.includes(name)) {
        return {
          success: false,
          message: `Cannot disable "${name}": plugin "${other.manifest.name}" depends on it.`,
          pluginName: name,
        };
      }
    }

    plugin.state = "disabled";
    plugin.updatedAt = new Date().toISOString();
    await this.store.registerPlugin(plugin);

    return {
      success: true,
      message: `Plugin "${name}" disabled.`,
      pluginName: name,
      newState: "disabled",
    };
  }

  // ------------------------------------------------------------------
  // Uninstall
  // ------------------------------------------------------------------

  /**
   * Uninstall a plugin.
   *
   * Transitions: any → uninstalling → (removed)
   */
  async uninstall(name: string): Promise<PluginOperationResult> {
    const plugin = await this.store.getInstalled(name);
    if (!plugin) {
      return {
        success: false,
        message: `Plugin "${name}" is not installed.`,
        pluginName: name,
      };
    }

    // Disable first if enabled
    if (plugin.state === "enabled") {
      const disableResult = await this.disable(name);
      if (!disableResult.success) {
        return disableResult;
      }
    }

    // Mark as uninstalling
    plugin.state = "uninstalling";
    plugin.updatedAt = new Date().toISOString();
    await this.store.registerPlugin(plugin);

    // Remove from registry
    await this.store.unregisterPlugin(name);

    return {
      success: true,
      message: `Plugin "${name}" uninstalled.`,
      pluginName: name,
      newState: undefined,
    };
  }

  // ------------------------------------------------------------------
  // Restore builtin
  // ------------------------------------------------------------------

  /**
   * Restore a restorable builtin plugin.
 *
 * Transitions: disabled → configured → enabled
   */
  async restoreBuiltin(name: string): Promise<PluginOperationResult> {
    const plugin = await this.store.getInstalled(name);
    if (!plugin) {
      return {
        success: false,
        message: `Plugin "${name}" is not in the registry.`,
        pluginName: name,
      };
    }

    if (!plugin.restorableBuiltin) {
      return {
        success: false,
        message: `Plugin "${name}" is not a restorable builtin.`,
        pluginName: name,
      };
    }

    // Reset to configured state
    plugin.state = "configured";
    plugin.restorableBuiltin = false;
    plugin.updatedAt = new Date().toISOString();
    await this.store.registerPlugin(plugin);

    return {
      success: true,
      message: `Plugin "${name}" restored.`,
      pluginName: name,
      newState: "configured",
    };
  }

  // ------------------------------------------------------------------
  // Update
  // ------------------------------------------------------------------

  /**
   * Update a plugin to a new version.
   *
   * Preserves configuration.
   */
  async update(
    name: string,
    newManifest: PluginManifest,
    newDirectory: string,
  ): Promise<PluginOperationResult> {
    const plugin = await this.store.getInstalled(name);
    if (!plugin) {
      return {
        success: false,
        message: `Plugin "${name}" is not installed.`,
        pluginName: name,
      };
    }

    const wasEnabled = plugin.state === "enabled";

    // Disable if enabled
    if (wasEnabled) {
      await this.disable(name);
    }

    // Update manifest and directory
    const oldConfig = plugin.config;
    plugin.manifest = newManifest;
    plugin.directory = newDirectory;
    plugin.config = { ...newManifest.defaultConfig, ...oldConfig };
    plugin.state = "configured";
    plugin.updatedAt = new Date().toISOString();
    plugin.lastError = undefined;

    await this.store.registerPlugin(plugin);

    // Re-enable if it was enabled
    if (wasEnabled) {
      return this.enable(name);
    }

    return {
      success: true,
      message: `Plugin "${name}" updated to v${newManifest.version}.`,
      pluginName: name,
      newState: "configured",
    };
  }
}
