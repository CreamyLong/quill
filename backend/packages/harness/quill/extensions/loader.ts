/**
 * Extension loader — discovers, validates, and registers extensions.
 *
 * Mirrors the DeerFlow 2.0 Python `extensions/loader.py` but adapted for the
 * TypeScript runtime. Scans configured extension directories, validates
 * manifests, and registers enabled extensions with the lifecycle middleware.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type {
  ExtensionManifest,
  ExtensionModule,
  LoadedExtension,
} from "./types.js";

const EXTENSION_MANIFEST_FILE = "extension.yaml";

/** Registry of loaded extensions, keyed by name. */
const _extensions = new Map<string, LoadedExtension>();

/** Extensions sorted by registration order. */
export function getLoadedExtensions(): LoadedExtension[] {
  return [..._extensions.values()];
}

/** Get a specific extension by name. */
export function getExtension(name: string): LoadedExtension | null {
  return _extensions.get(name) ?? null;
}

/** Remove all loaded extensions (for testing / reload). */
export function clearExtensions(): void {
  _extensions.clear();
}

/**
 * Validate an extension manifest object.
 * Returns an array of error strings (empty when valid).
 */
export function validateManifest(manifest: unknown): string[] {
  const errors: string[] = [];
  if (manifest === null || typeof manifest !== "object") {
    return ["Manifest is not an object."];
  }
  const m = manifest as Record<string, unknown>;

  if (typeof m.name !== "string" || m.name.trim().length === 0) {
    errors.push("Missing or empty 'name' field.");
  }
  if (typeof m.version !== "string" || m.version.trim().length === 0) {
    errors.push("Missing or empty 'version' field.");
  }
  if (typeof m.description !== "string") {
    errors.push("Missing or empty 'description' field.");
  }
  if (typeof m.entrypoint !== "string" || m.entrypoint.trim().length === 0) {
    errors.push("Missing or empty 'entrypoint' field.");
  }
  if (!Array.isArray(m.hooks)) {
    errors.push("'hooks' must be an array of hook phases.");
  } else {
    const validPhases = new Set([
      "pre_model",
      "post_model",
      "pre_tool",
      "post_tool",
      "on_agent_start",
      "on_agent_end",
    ]);
    for (const hook of m.hooks) {
      if (typeof hook !== "string" || !validPhases.has(hook)) {
        errors.push(`Invalid hook phase: ${String(hook)}.`);
      }
    }
  }
  return errors;
}

/**
 * Load an extension from a directory path.
 * Validates the manifest and registers it in the registry.
 */
export function loadExtension(
  directory: string,
  options: { enabled?: boolean } = {}
): LoadedExtension {
  const manifestPath = path.join(directory, EXTENSION_MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Extension manifest not found: ${manifestPath}. ` +
        `Each extension must have an "${EXTENSION_MANIFEST_FILE}" file.`
    );
  }

  const raw = fs.readFileSync(manifestPath, "utf-8");
  // Simple YAML-like parsing (without external deps): key: value pairs.
  const manifest = parseSimpleYaml(raw);
  const errors = validateManifest(manifest);
  if (errors.length > 0) {
    throw new Error(
      `Invalid extension manifest at ${manifestPath}:\n${errors.map((e) => `  - ${e}`).join("\n")}`
    );
  }

  const ext: LoadedExtension = {
    manifest: manifest as unknown as ExtensionManifest,
    directory,
    enabled: options.enabled ?? true,
  };

  _extensions.set(ext.manifest.name, ext);
  return ext;
}

/**
 * Discover and load all extensions from a list of directory paths.
 * Each immediate subdirectory that contains an extension.yaml is loaded.
 */
export function discoverExtensions(
  searchPaths: string[],
  options: { enabled?: boolean } = {}
): LoadedExtension[] {
  const loaded: LoadedExtension[] = [];
  for (const searchPath of searchPaths) {
    if (!fs.existsSync(searchPath)) {
      continue;
    }
    const entries = fs.readdirSync(searchPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const extDir = path.join(searchPath, entry.name);
      const manifestPath = path.join(extDir, EXTENSION_MANIFEST_FILE);
      if (!fs.existsSync(manifestPath)) {
        continue;
      }
      try {
        loaded.push(loadExtension(extDir, options));
      } catch (err) {
        console.warn(
          `[extensions] Failed to load extension from ${extDir}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
  return loaded;
}

/**
 * Enable or disable a loaded extension by name.
 */
export function setExtensionEnabled(name: string, enabled: boolean): boolean {
  const ext = _extensions.get(name);
  if (!ext) {
    return false;
  }
  ext.enabled = enabled;
  return true;
}

/**
 * Remove an extension from the registry.
 */
export function removeExtension(name: string): boolean {
  return _extensions.delete(name);
}

/**
 * Minimal YAML parser for extension manifests.
 *
 * Supports flat key: value documents with optional nested arrays.
 * Does NOT support full YAML — just the subset needed for extension manifests.
 */
function parseSimpleYaml(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = raw.split("\n");
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of lines) {
    // Skip comments and empty lines.
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    // Array item (starts with "- ").
    if (trimmed.startsWith("- ")) {
      if (currentArray) {
        currentArray.push(trimmed.slice(2).trim());
      }
      continue;
    }

    // Key: value pair.
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    // If value is empty, this might be the start of an array.
    if (value.length === 0) {
      currentKey = key;
      currentArray = [];
      result[key] = currentArray;
    } else {
      currentKey = null;
      currentArray = null;
      // Remove surrounding quotes.
      const unquoted =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
          ? value.slice(1, -1)
          : value;
      // Parse booleans and numbers.
      if (unquoted.toLowerCase() === "true") {
        result[key] = true;
      } else if (unquoted.toLowerCase() === "false") {
        result[key] = false;
      } else if (/^-?\d+$/.test(unquoted)) {
        result[key] = parseInt(unquoted, 10);
      } else if (/^-?\d+\.\d+$/.test(unquoted)) {
        result[key] = parseFloat(unquoted);
      } else {
        result[key] = unquoted;
      }
    }
  }

  return result;
}
