/**
 * Plugin manifest — parsing, validation, and serialization.
 *
 * Inspired by ZCode's plugin.json manifest schema and OpenClaw's
 * provenance-verified plugin format.
 */

import type { PluginManifest, PluginSource } from "./types.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * JSON Schema for plugin.json validation.
 * Used to validate manifests at install time.
 */
export const PLUGIN_MANIFEST_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["name", "version", "displayName", "description", "author", "license", "source", "contributes"],
  properties: {
    name: {
      type: "string",
      pattern: "^[a-z0-9][a-z0-9-]*$",
      description: "Unique plugin identifier (kebab-case)",
    },
    version: {
      type: "string",
      pattern: "^\\d+\\.\\d+\\.\\d+.*$",
      description: "Semver version",
    },
    displayName: {
      type: "string",
      minLength: 1,
      maxLength: 64,
    },
    description: {
      type: "string",
      minLength: 1,
      maxLength: 500,
    },
    author: {
      type: "string",
      minLength: 1,
    },
    license: {
      type: "string",
      minLength: 1,
    },
    source: {
      type: "string",
      enum: ["builtin", "official", "personal", "marketplace"],
    },
    entrypoint: {
      type: "string",
    },
    homepage: {
      type: "string",
      format: "uri",
    },
    categories: {
      type: "array",
      items: { type: "string" },
    },
    keywords: {
      type: "array",
      items: { type: "string" },
    },
    icon: {
      type: "string",
    },
    examplePrompts: {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
    },
    contributes: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "middleware", "lifecycle_hook", "observer", "gateway_service", "http_router",
          "command", "agent", "skill", "mcp_server", "hook",
        ],
      },
      minItems: 1,
    },
    dependencies: {
      type: "array",
      items: { type: "string" },
    },
    minQuillVersion: {
      type: "string",
      pattern: "^\\d+\\.\\d+\\.\\d+.*$",
    },
    configSchema: {
      type: ["object", "null"],
    },
    defaultConfig: {
      type: "object",
    },
    sha256: {
      type: "string",
      pattern: "^[a-f0-9]{64}$",
    },
    sizeBytes: {
      type: "integer",
      minimum: 0,
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Result of manifest validation.
 */
export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a plugin manifest object.
 *
 * Performs structural validation against the schema.
 * Does not check filesystem existence or sha256 hashes.
 */
export function validateManifest(manifest: unknown): ManifestValidationResult {
  const errors: string[] = [];

  if (!manifest || typeof manifest !== "object") {
    return { valid: false, errors: ["Manifest must be an object"] };
  }

  const m = manifest as Record<string, unknown>;

  // Required fields
  const requiredFields = ["name", "version", "displayName", "description", "author", "license", "source", "contributes"];
  for (const field of requiredFields) {
    if (m[field] === undefined || m[field] === null) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  // Name validation (kebab-case)
  if (typeof m.name === "string") {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(m.name)) {
      errors.push(`Invalid plugin name "${m.name}": must be kebab-case (lowercase letters, digits, hyphens)`);
    }
    if (m.name.length > 64) {
      errors.push(`Plugin name "${m.name}" exceeds 64 characters`);
    }
  }

  // Version validation (semver)
  if (typeof m.version === "string") {
    if (!/^\d+\.\d+\.\d+.*$/.test(m.version)) {
      errors.push(`Invalid version "${m.version}": must follow semver (e.g., 1.0.0)`);
    }
  }

  // Source validation
  const validSources: PluginSource[] = ["builtin", "official", "personal", "marketplace"];
  if (typeof m.source === "string" && !validSources.includes(m.source as PluginSource)) {
    errors.push(`Invalid source "${m.source}": must be one of ${validSources.join(", ")}`);
  }

  // Contributes validation
  if (Array.isArray(m.contributes)) {
    const validContributions = [
      "middleware", "lifecycle_hook", "observer", "gateway_service", "http_router",
      "command", "agent", "skill", "mcp_server", "hook",
    ];
    for (const contrib of m.contributes) {
      if (typeof contrib === "string" && !validContributions.includes(contrib)) {
        errors.push(`Invalid contribution type "${contrib}"`);
      }
    }
  } else {
    errors.push('"contributes" must be a non-empty array');
  }

  // sha256 validation (if present)
  if (m.sha256 !== undefined && m.sha256 !== null) {
    if (typeof m.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(m.sha256)) {
      errors.push('Invalid sha256 hash: must be 64 hex characters');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a plugin manifest from JSON string.
 *
 * @throws Error if JSON is invalid or manifest fails validation
 */
export function parseManifest(json: string): PluginManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`Failed to parse plugin.json: ${(e as Error).message}`);
  }

  const result = validateManifest(parsed);
  if (!result.valid) {
    throw new Error(`Invalid plugin.json: ${result.errors.join("; ")}`);
  }

  return parsed as PluginManifest;
}

/**
 * Serialize a plugin manifest to JSON string.
 */
export function serializeManifest(manifest: PluginManifest): string {
  return JSON.stringify(manifest, null, 2);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a default manifest for a new plugin.
 */
export function createDefaultManifest(name: string, source: PluginSource = "personal"): PluginManifest {
  return {
    name,
    version: "0.1.0",
    displayName: name.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
    description: "",
    author: "unknown",
    license: "MIT",
    source,
    contributes: [],
    categories: [],
    keywords: [],
    dependencies: [],
    defaultConfig: {},
  };
}

/**
 * Check if a manifest's version is newer than another.
 */
export function isNewerVersion(current: string, candidate: string): boolean {
  const parse = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);
  const currentParts = parse(current);
  const candidateParts = parse(candidate);

  for (let i = 0; i < Math.max(currentParts.length, candidateParts.length); i++) {
    const c = currentParts[i] ?? 0;
    const p = candidateParts[i] ?? 0;
    if (p > c) return true;
    if (p < c) return false;
  }
  return false;
}
