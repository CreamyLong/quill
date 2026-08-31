/**
 * Extensions module — public API for the extension system.
 *
 * Mirrors the DeerFlow 2.0 `extensions/` package structure.
 */

export * from "./types.js";
export {
  getLoadedExtensions,
  getExtension,
  clearExtensions,
  validateManifest,
  loadExtension,
  discoverExtensions,
  setExtensionEnabled,
  removeExtension,
} from "./loader.js";
