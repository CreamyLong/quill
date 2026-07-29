/**
 * Safe config.yaml write-back utility.
 *
 * Provides atomic write + schema validation for runtime config edits from the
 * Settings UI. The write pattern (tmp → renameSync) mirrors the existing
 * agent-tool atomic writer in `tools/builtins/update_agent_tool.ts` and is
 * atomic at the OS level on POSIX/NTFS.
 *
 * Only the targeted top-level section (`tools` or `models`) is replaced; all
 * other config sections are preserved. Comments in the YAML are lost on
 * round-trip (same trade-off the existing agent-tool writer makes).
 */

import fs from "node:fs";

import YAML from "yaml";

import { resetAppConfig, resolveConfigPath } from "./app_config.js";

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

/** Validate a models array before writing. */
export function validateModelEntries(models: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(models)) {
    return { valid: false, errors: ["models must be an array"] };
  }
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    if (!m || typeof m !== "object") {
      errors.push(`[${i}] expected object, got ${typeof m}`);
      continue;
    }
    const entry = m as Record<string, unknown>;
    if (typeof entry.name !== "string" || !entry.name) {
      errors.push(`[${i}] missing required "name"`);
    }
    if (typeof entry.use !== "string" || !entry.use) {
      errors.push(`[${i}] missing required "use"`);
    }
    if (typeof entry.model !== "string" || !entry.model) {
      errors.push(`[${i}] missing required "model"`);
    }
  }
  return { valid: errors.length === 0, errors };
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
