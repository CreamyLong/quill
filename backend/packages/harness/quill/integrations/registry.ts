/**
 * Integration registry — discovers and manages first-party integrations.
 *
 * Mirrors the DeerFlow 2.0 `integrations/` registry pattern.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { IntegrationManifest, RegisteredIntegration } from "./types.js";

const INTEGRATION_MANIFEST_FILE = "integration.yaml";

/** Registry of discovered integrations, keyed by name. */
const _integrations = new Map<string, RegisteredIntegration>();

/** Integrations sorted by registration order. */
export function getRegisteredIntegrations(): RegisteredIntegration[] {
  return [..._integrations.values()];
}

/** Get a specific integration by name. */
export function getIntegration(name: string): RegisteredIntegration | null {
  return _integrations.get(name) ?? null;
}

/** Remove all registered integrations (for testing / reload). */
export function clearIntegrations(): void {
  _integrations.clear();
}

/**
 * Discover integrations from a list of directory paths.
 * Each immediate subdirectory that contains an integration.yaml is registered.
 */
export function discoverIntegrations(searchPaths: string[]): RegisteredIntegration[] {
  const discovered: RegisteredIntegration[] = [];
  for (const searchPath of searchPaths) {
    if (!fs.existsSync(searchPath)) {
      continue;
    }
    const entries = fs.readdirSync(searchPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const intDir = path.join(searchPath, entry.name);
      const manifestPath = path.join(intDir, INTEGRATION_MANIFEST_FILE);
      if (!fs.existsSync(manifestPath)) {
        continue;
      }
      try {
        const raw = fs.readFileSync(manifestPath, "utf-8");
        const manifest = parseIntegrationYaml(raw);
        const integration: RegisteredIntegration = {
          manifest: manifest as IntegrationManifest,
          directory: intDir,
          installed: false,
        };
        _integrations.set(integration.manifest.name, integration);
        discovered.push(integration);
      } catch (err) {
        console.warn(
          `[integrations] Failed to load integration from ${intDir}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
  return discovered;
}

/**
 * Mark an integration as installed.
 */
export function markInstalled(name: string): boolean {
  const int = _integrations.get(name);
  if (!int) {
    return false;
  }
  int.installed = true;
  return true;
}

/**
 * Minimal YAML parser for integration manifests.
 * Reuses the same approach as extensions/loader.ts.
 */
function parseIntegrationYaml(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = raw.split("\n");
  let currentArray: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    if (trimmed.startsWith("- ")) {
      if (currentArray) {
        currentArray.push(trimmed.slice(2).trim());
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    if (value.length === 0) {
      currentArray = [];
      result[key] = currentArray;
    } else {
      currentArray = null;
      const unquoted =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
          ? value.slice(1, -1)
          : value;
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
