/**
 * Extension API — public, host-independent extension contracts.
 *
 * This package mirrors the DeerFlow 2.0 `packages/extension-api/` structure.
 * It defines the stable interfaces that third-party extension authors
 * implement against, without depending on the full harness runtime.
 *
 * Import prefix: `quill_extension_api.*`
 *
 * This package is intentionally dependency-free and lightweight so that
 * extension authors can depend on it without pulling in the entire
 * Quill harness.
 */

// Re-export the core types that extensions implement against.
export type {
  ExtensionHookPhase,
  ExtensionManifest,
  ExtensionHookContext,
  ExtensionHookResult,
  ExtensionModule,
} from "./types.js";

// Version of this extension API contract.
export const EXTENSION_API_VERSION = "1.0.0";

/**
 * Helper to create a well-formed extension manifest.
 * Use this in extension.yaml generation to ensure correctness.
 */
export function createExtensionManifest(options: {
  name: string;
  version: string;
  description: string;
  entrypoint: string;
  hooks?: ExtensionHookPhase[];
  tools?: string[];
}): ExtensionManifest {
  return {
    name: options.name,
    version: options.version,
    description: options.description,
    entrypoint: options.entrypoint,
    hooks: options.hooks ?? [],
    tools: options.tools ?? [],
  };
}

/**
 * Validate that an extension module exports the expected shape.
 * Does NOT execute the module — just checks the export surface.
 */
export function validateExtensionModule(mod: Record<string, unknown>): string[] {
  const errors: string[] = [];

  if (mod.initialize !== undefined && typeof mod.initialize !== "function") {
    errors.push("'initialize' must be a function if present.");
  }
  if (mod.dispose !== undefined && typeof mod.dispose !== "function") {
    errors.push("'dispose' must be a function if present.");
  }
  if (mod.hooks !== undefined) {
    if (typeof mod.hooks !== "object" || mod.hooks === null) {
      errors.push("'hooks' must be an object if present.");
    } else {
      const validPhases = new Set([
        "pre_model",
        "post_model",
        "pre_tool",
        "post_tool",
        "on_agent_start",
        "on_agent_end",
      ]);
      for (const [key, value] of Object.entries(mod.hooks as Record<string, unknown>)) {
        if (!validPhases.has(key)) {
          errors.push(`Invalid hook phase in hooks: ${key}`);
        }
        if (typeof value !== "function") {
          errors.push(`Hook '${key}' must be a function.`);
        }
      }
    }
  }

  return errors;
}
