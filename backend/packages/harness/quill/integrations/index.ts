/**
 * Integrations module — public API for the integration installer system.
 *
 * Mirrors the DeerFlow 2.0 `integrations/` package structure.
 */

export * from "./types.js";
export {
  getRegisteredIntegrations,
  getIntegration,
  clearIntegrations,
  discoverIntegrations,
  markInstalled,
} from "./registry.js";
