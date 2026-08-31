/**
 * Capability Marketplace — public API.
 *
 * Port of OpenWork's capability marketplace pattern. Provides search_capability
 * and execute_capability interfaces for discovering and invoking shared
 * capabilities across skills, MCP tools, and community integrations.
 */

export * from "./types.js";
export {
  CapabilityMarketplace,
  getMarketplace,
  resetMarketplace,
  type CapabilityExecutor,
} from "./marketplace.js";
