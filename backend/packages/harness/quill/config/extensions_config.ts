/**
 * Unified extensions configuration for MCP servers and skills.
 *
 * Mirrors `quill.config.extensions_config` from the Python backend.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { existingProjectFile } from "./runtime_paths.js";

export type McpGrantType = "client_credentials" | "refresh_token";

/** OAuth configuration for an MCP server (HTTP/SSE transports). */
export interface McpOAuthConfig {
  enabled: boolean;
  tokenUrl: string;
  grantType: McpGrantType;
  clientId: string | null;
  clientSecret: string | null;
  refreshToken: string | null;
  scope: string | null;
  audience: string | null;
  tokenField: string;
  tokenTypeField: string;
  expiresInField: string;
  defaultTokenType: string;
  refreshSkewSeconds: number;
  extraTokenParams: Record<string, string>;
  /** Extra fields allowed (Pydantic extra="allow"). */
  [key: string]: unknown;
}

export function buildMcpOAuthConfig(input: Record<string, unknown> & { token_url?: string; tokenUrl?: string }): McpOAuthConfig {
  const get = <T>(snake: string, camel: string, fallback: T): T => {
    if (input[camel] !== undefined) {
      return input[camel] as T;
    }
    if (input[snake] !== undefined) {
      return input[snake] as T;
    }
    return fallback;
  };
  const known = new Set([
    "enabled",
    "token_url",
    "tokenUrl",
    "grant_type",
    "grantType",
    "client_id",
    "clientId",
    "client_secret",
    "clientSecret",
    "refresh_token",
    "refreshToken",
    "scope",
    "audience",
    "token_field",
    "tokenField",
    "token_type_field",
    "tokenTypeField",
    "expires_in_field",
    "expiresInField",
    "default_token_type",
    "defaultTokenType",
    "refresh_skew_seconds",
    "refreshSkewSeconds",
    "extra_token_params",
    "extraTokenParams",
  ]);
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!known.has(key)) {
      extra[key] = value;
    }
  }
  return {
    enabled: get("enabled", "enabled", true),
    tokenUrl: get("token_url", "tokenUrl", "") as string,
    grantType: get("grant_type", "grantType", "client_credentials") as McpGrantType,
    clientId: get("client_id", "clientId", null),
    clientSecret: get("client_secret", "clientSecret", null),
    refreshToken: get("refresh_token", "refreshToken", null),
    scope: get("scope", "scope", null),
    audience: get("audience", "audience", null),
    tokenField: get("token_field", "tokenField", "access_token"),
    tokenTypeField: get("token_type_field", "tokenTypeField", "token_type"),
    expiresInField: get("expires_in_field", "expiresInField", "expires_in"),
    defaultTokenType: get("default_token_type", "defaultTokenType", "Bearer"),
    refreshSkewSeconds: get("refresh_skew_seconds", "refreshSkewSeconds", 60),
    extraTokenParams: get("extra_token_params", "extraTokenParams", {} as Record<string, string>),
    ...extra,
  };
}

/** Configuration for a single MCP server. */
export interface McpServerConfig {
  enabled: boolean;
  type: string;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  url: string | null;
  headers: Record<string, string>;
  oauth: McpOAuthConfig | null;
  description: string;
  /** Extra fields allowed (Pydantic extra="allow"). */
  [key: string]: unknown;
}

export function buildMcpServerConfig(rawInput: Record<string, unknown>): McpServerConfig {
  // Accept the MCP-spec `transport` field as an alias for `type` (type wins).
  let input = rawInput;
  const transport = input.transport;
  if (transport && !input.type) {
    input = { ...input, type: transport };
  }

  const known = new Set(["enabled", "type", "transport", "command", "args", "env", "url", "headers", "oauth", "description"]);
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!known.has(key)) {
      extra[key] = value;
    }
  }

  const oauthRaw = input.oauth;
  const oauth =
    oauthRaw !== undefined && oauthRaw !== null && typeof oauthRaw === "object"
      ? buildMcpOAuthConfig(oauthRaw as Record<string, unknown>)
      : null;

  return {
    enabled: (input.enabled as boolean) ?? true,
    type: (input.type as string) ?? "stdio",
    command: (input.command as string | null) ?? null,
    args: (input.args as string[]) ?? [],
    env: (input.env as Record<string, string>) ?? {},
    url: (input.url as string | null) ?? null,
    headers: (input.headers as Record<string, string>) ?? {},
    oauth,
    description: (input.description as string) ?? "",
    ...extra,
  };
}

/** Configuration for a single skill's state. */
export interface SkillStateConfig {
  enabled: boolean;
}

export function buildSkillStateConfig(input: Partial<SkillStateConfig> = {}): SkillStateConfig {
  return { enabled: input.enabled ?? true };
}

/** Unified configuration for MCP servers and skills. */
export class ExtensionsConfig {
  mcpServers: Record<string, McpServerConfig>;
  skills: Record<string, SkillStateConfig>;
  /** Extra top-level fields allowed (Pydantic extra="allow"). */
  extra: Record<string, unknown>;

  constructor(mcpServers: Record<string, McpServerConfig> = {}, skills: Record<string, SkillStateConfig> = {}, extra: Record<string, unknown> = {}) {
    this.mcpServers = mcpServers;
    this.skills = skills;
    this.extra = extra;
  }

  /**
   * Resolve the extensions config file path.
   *
   * Priority: explicit arg → `QUILL_EXTENSIONS_CONFIG_PATH` → caller
   * project root (`extensions_config.json`, `mcp_config.json`) → legacy
   * backend/repo-root defaults → null (extensions are optional).
   */
  static resolveConfigPath(configPath: string | null = null): string | null {
    if (configPath) {
      if (!fs.existsSync(configPath)) {
        throw new Error(`Extensions config file specified by param \`config_path\` not found at ${configPath}`);
      }
      return configPath;
    }
    const envPath = process.env.QUILL_EXTENSIONS_CONFIG_PATH;
    if (envPath) {
      if (!fs.existsSync(envPath)) {
        throw new Error(`Extensions config file specified by environment variable \`QUILL_EXTENSIONS_CONFIG_PATH\` not found at ${envPath}`);
      }
      return envPath;
    }

    const projectConfig = existingProjectFile(["extensions_config.json", "mcp_config.json"]);
    if (projectConfig !== null) {
      return projectConfig;
    }

    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const backendDir = path.resolve(moduleDir, "..", "..", "..", "..");
    const repoRoot = path.dirname(backendDir);
    for (const candidate of [
      path.join(backendDir, "extensions_config.json"),
      path.join(repoRoot, "extensions_config.json"),
      path.join(backendDir, "mcp_config.json"),
      path.join(repoRoot, "mcp_config.json"),
    ]) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    // Extensions are optional, so return null if not found.
    return null;
  }

  /**
   * Load extensions config from a JSON file.
   *
   * Returns an empty config if the file is not found.
   */
  static fromFile(configPath: string | null = null): ExtensionsConfig {
    const resolvedPath = ExtensionsConfig.resolveConfigPath(configPath);
    if (resolvedPath === null) {
      return new ExtensionsConfig({}, {});
    }

    let configData: unknown;
    try {
      configData = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
    } catch (e) {
      throw new Error(`Extensions config file at ${resolvedPath} is not valid JSON: ${String(e)}`);
    }
    try {
      configData = ExtensionsConfig.resolveEnvVariables(configData);
      return ExtensionsConfig.modelValidate(configData as Record<string, unknown>);
    } catch (e) {
      throw new Error(`Failed to load extensions config from ${resolvedPath}: ${String(e)}`);
    }
  }

  /** Build an ExtensionsConfig from a plain object (mirrors pydantic model_validate). */
  static modelValidate(data: Record<string, unknown>): ExtensionsConfig {
    const rawServers = (data.mcpServers ?? data.mcp_servers ?? {}) as Record<string, Record<string, unknown>>;
    const rawSkills = (data.skills ?? {}) as Record<string, Partial<SkillStateConfig>>;

    const mcpServers: Record<string, McpServerConfig> = {};
    for (const [name, cfg] of Object.entries(rawServers)) {
      mcpServers[name] = buildMcpServerConfig(cfg ?? {});
    }
    const skills: Record<string, SkillStateConfig> = {};
    for (const [name, cfg] of Object.entries(rawSkills)) {
      skills[name] = buildSkillStateConfig(cfg ?? {});
    }

    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key !== "mcpServers" && key !== "mcp_servers" && key !== "skills") {
        extra[key] = value;
      }
    }
    return new ExtensionsConfig(mcpServers, skills, extra);
  }

  /**
   * Recursively resolve environment variables in the config.
   *
   * Environment variables are resolved via `process.env`. Example: `$OPENAI_API_KEY`.
   * Unresolved placeholders become an empty string.
   */
  static resolveEnvVariables(config: unknown): unknown {
    if (typeof config === "string") {
      if (!config.startsWith("$")) {
        return config;
      }
      const envValue = process.env[config.slice(1)];
      if (envValue === undefined) {
        return "";
      }
      return envValue;
    }

    if (Array.isArray(config)) {
      return config.map((item) => ExtensionsConfig.resolveEnvVariables(item));
    }

    if (config !== null && typeof config === "object") {
      const resolved: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
        resolved[key] = ExtensionsConfig.resolveEnvVariables(value);
      }
      return resolved;
    }

    return config;
  }

  /** Get only the enabled MCP servers. */
  getEnabledMcpServers(): Record<string, McpServerConfig> {
    const enabled: Record<string, McpServerConfig> = {};
    for (const [name, config] of Object.entries(this.mcpServers)) {
      if (config.enabled) {
        enabled[name] = config;
      }
    }
    return enabled;
  }

  /** Check if a skill is enabled. */
  isSkillEnabled(skillName: string, skillCategory: string): boolean {
    const skillConfig = this.skills[skillName];
    if (skillConfig === undefined) {
      // Default to enable for public & custom skills.
      return skillCategory === "public" || skillCategory === "custom";
    }
    return skillConfig.enabled;
  }

  /** Serialise to a plain JSON object (on-disk representation). */
  toJSON(): Record<string, unknown> {
    const mcpServers: Record<string, unknown> = {};
    for (const [name, cfg] of Object.entries(this.mcpServers)) {
      mcpServers[name] = { ...cfg };
    }
    return { mcpServers, skills: this.skills };
  }

  /**
   * Save this config back to disk.
   *
   * @param configPath Optional explicit path; resolves via
   *   {@link resolveConfigPath} or falls back to
   *   `<repoRoot>/extensions_config.json`.
   */
  save(configPath: string | null = null): void {
    let targetPath = configPath ?? ExtensionsConfig.resolveConfigPath(null);
    if (targetPath === null) {
      const moduleDir = path.dirname(fileURLToPath(import.meta.url));
      const backendDir = path.resolve(moduleDir, "..", "..", "..", "..");
      const repoRoot = path.dirname(backendDir);
      targetPath = path.join(repoRoot, "extensions_config.json");
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, JSON.stringify(this.toJSON(), null, 2) + "\n", "utf-8");
  }
}

let _extensionsConfig: ExtensionsConfig | null = null;

/** Get the cached extensions config singleton. */
export function getExtensionsConfig(): ExtensionsConfig {
  if (_extensionsConfig === null) {
    _extensionsConfig = ExtensionsConfig.fromFile();
  }
  return _extensionsConfig;
}

/** Reload the extensions config from file and update the cached instance. */
export function reloadExtensionsConfig(configPath: string | null = null): ExtensionsConfig {
  _extensionsConfig = ExtensionsConfig.fromFile(configPath);
  return _extensionsConfig;
}

/** Reset the cached extensions config instance. */
export function resetExtensionsConfig(): void {
  _extensionsConfig = null;
}

/** Set a custom extensions config instance. */
export function setExtensionsConfig(config: ExtensionsConfig): void {
  _extensionsConfig = config;
}
