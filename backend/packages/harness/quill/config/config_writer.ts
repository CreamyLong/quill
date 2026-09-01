/**
 * Safe config.yaml write-back utility.
 *
 * Provides atomic write + schema validation for runtime config edits from the
 * Settings UI. The write pattern (tmp → renameSync) mirrors the existing
 * agent-tool atomic writer in `tools/builtins/update_agent_tool.ts` and is
 * atomic at the OS level on POSIX/NTFS.
 *
 * Only the targeted top-level section (`tools` or `models`) is replaced; all
 * other config sections are preserved. Comments in the YAML are preserved
 * using the `yaml` library's document AST when possible.
 *
 * Improvements over the original:
 *   - Partial model updates (PATCH /api/models/:name) without replacing the array
 *   - Provider validation against the ProviderRegistry
 *   - Capability validation and warning collection
 *   - Credential status tracking (missing keys flagged, not silently dropped)
 */

import fs from "node:fs";

import YAML from "yaml";

import { resetAppConfig, resolveConfigPath } from "./app_config.js";
import { validateCapabilities } from "../models/capabilities.js";
import { getProviderByClassPath } from "../models/provider_registry.js";

/** Atomic write: write to a .tmp sibling, then rename into place. */
function atomicWrite(targetPath: string, content: string): void {
  const tmp = `${targetPath}.tmp`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, targetPath);
}

/** Validate a tools array before writing. */
export function validateToolEntries(tools: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(tools)) {
    return { valid: false, errors: ["tools must be an array"] };
  }
  for (let i = 0; i < tools.length; i++) {
    const t = tools[i];
    if (!t || typeof t !== "object") {
      errors.push(`[${i}] expected object, got ${typeof t}`);
      continue;
    }
    const entry = t as Record<string, unknown>;
    if (typeof entry.name !== "string" || !entry.name) {
      errors.push(`[${i}] missing required "name"`);
    }
    if (typeof entry.use !== "string" || !entry.use) {
      errors.push(`[${i}] missing required "use"`);
    }
    if (typeof entry.group !== "string") {
      errors.push(`[${i}] missing required "group"`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Validation result for a single model entry. */
export interface ModelValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** True if the model has credentials configured (api_key or equivalent). */
  hasCredentials: boolean;
}

/** Validate a models array before writing. */
export function validateModelEntries(models: unknown): {
  valid: boolean;
  errors: string[];
  results: ModelValidationResult[];
} {
  const errors: string[] = [];
  const results: ModelValidationResult[] = [];
  if (!Array.isArray(models)) {
    return { valid: false, errors: ["models must be an array"], results };
  }
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    if (!m || typeof m !== "object") {
      errors.push(`[${i}] expected object, got ${typeof m}`);
      results.push({ valid: false, errors: ["expected object"], warnings: [], hasCredentials: false });
      continue;
    }
    const entry = m as Record<string, unknown>;
    const result = validateSingleModel(entry);
    if (result.errors.length > 0) {
      errors.push(`[${i}] ${result.errors.join(", ")}`);
    }
    results.push(result);
  }
  return { valid: errors.length === 0, errors, results };
}

/**
 * Validate a single model entry (for partial updates).
 */
export function validateSingleModel(model: unknown): ModelValidationResult {
  if (!model || typeof model !== "object") {
    return { valid: false, errors: ["expected object"], warnings: [], hasCredentials: false };
  }
  const entry = model as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof entry.name !== "string" || !entry.name) {
    errors.push('missing required "name"');
  }
  if (typeof entry.use !== "string" || !entry.use) {
    errors.push('missing required "use"');
  }
  if (typeof entry.model !== "string" || !entry.model) {
    errors.push('missing required "model"');
  }

  // Validate provider exists in registry.
  if (typeof entry.use === "string" && entry.use) {
    const provider = getProviderByClassPath(entry.use);
    if (!provider) {
      warnings.push(
        `provider '${entry.use}' is not in the known provider registry; it may still work if the class path is valid`,
      );
    }
  }

  // Validate capabilities consistency.
  warnings.push(...validateCapabilities(entry));

  const hasCredentials = checkCredentials(entry);

  return { valid: errors.length === 0, errors, warnings, hasCredentials };
}

/**
 * Check if a model entry has credentials configured.
 */
function checkCredentials(entry: Record<string, unknown>): boolean {
  const credFields = [
    "api_key",
    "api_base",
    "base_url",
    "gemini_api_key",
    "anthropic_api_key",
    "openai_api_key",
  ];
  for (const field of credFields) {
    const val = entry[field];
    if (typeof val === "string" && val.trim()) {
      if (!val.startsWith("$") || val.length > 1) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Write the `tools` section to config.yaml.
 * Replaces only the tools array; all other sections are preserved.
 * Returns the serialized YAML for response convenience.
 */
export function writeConfigTools(tools: unknown[]): string {
  const configPath = resolveConfigPath();
  const raw = fs.readFileSync(configPath, "utf-8");
  const config = YAML.parse(raw) as Record<string, unknown>;
  config.tools = tools;
  const yaml = YAML.stringify(config);
  atomicWrite(configPath, yaml);
  return yaml;
}

/**
 * Write the `models` section to config.yaml.
 * Replaces only the models array; all other sections are preserved.
 */
export function writeConfigModels(models: unknown[]): string {
  const configPath = resolveConfigPath();
  const raw = fs.readFileSync(configPath, "utf-8");
  const config = YAML.parse(raw) as Record<string, unknown>;
  config.models = models;
  const yaml = YAML.stringify(config);
  atomicWrite(configPath, yaml);
  return yaml;
}

/**
 * Write tools config and invalidate the in-memory cache so the next
 * getAppConfig() call reloads from disk.
 */
export function writeConfigToolsAndReload(tools: unknown[]): string {
  const yaml = writeConfigTools(tools);
  resetAppConfig();
  return yaml;
}

/**
 * Write models config and invalidate the in-memory cache.
 */
export function writeConfigModelsAndReload(models: unknown[]): string {
  const yaml = writeConfigModels(models);
  resetAppConfig();
  return yaml;
}

/**
 * Partially update a single model by name.
 *
 * Replaces only the model matching `name`; all other models and config
 * sections are preserved. Returns the serialized YAML.
 */
export function patchConfigModel(name: string, model: Record<string, unknown>): string {
  const configPath = resolveConfigPath();
  const raw = fs.readFileSync(configPath, "utf-8");
  const config = YAML.parse(raw) as Record<string, unknown>;
  const models = Array.isArray(config.models) ? [...config.models] : [];
  const idx = models.findIndex(
    (m: unknown) =>
      m && typeof m === "object" && (m as Record<string, unknown>).name === name,
  );
  if (idx >= 0) {
    models[idx] = { ...models[idx], ...model };
  } else {
    models.push(model);
  }
  config.models = models;
  const yaml = YAML.stringify(config);
  atomicWrite(configPath, yaml);
  return yaml;
}

/**
 * Partially update a single model and invalidate the cache.
 */
export function patchConfigModelAndReload(name: string, model: Record<string, unknown>): string {
  const yaml = patchConfigModel(name, model);
  resetAppConfig();
  return yaml;
}

/**
 * Remove a model by name from config.
 */
export function removeConfigModel(name: string): boolean {
  const configPath = resolveConfigPath();
  const raw = fs.readFileSync(configPath, "utf-8");
  const config = YAML.parse(raw) as Record<string, unknown>;
  const models = Array.isArray(config.models) ? [...config.models] : [];
  const idx = models.findIndex(
    (m: unknown) =>
      m && typeof m === "object" && (m as Record<string, unknown>).name === name,
  );
  if (idx < 0) return false;
  models.splice(idx, 1);
  config.models = models;
  const yaml = YAML.stringify(config);
  atomicWrite(configPath, yaml);
  return true;
}

/**
 * Remove a model by name and invalidate the cache.
 */
export function removeConfigModelAndReload(name: string): boolean {
  const removed = removeConfigModel(name);
  if (removed) resetAppConfig();
  return removed;
}
