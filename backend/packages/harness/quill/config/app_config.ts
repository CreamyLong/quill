/**
 * Quill application config loader.
 *
 * TS equivalent of `quill.config.app_config`. Loads `config.yaml`, resolves
 * `$ENV` variables, and exposes a typed AppConfig object plus singleton
 * helpers.
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import { existingProjectFile, projectRoot } from "./runtime_paths.js";
import type { DatabaseConfig } from "./database_config.js";
import { buildDatabaseConfig } from "./database_config.js";
import type { SandboxConfig } from "./sandbox_config.js";
import type { MemoryConfig } from "./memory_config.js";
import { loadMemoryConfigFromDict } from "./memory_config.js";
import type { RunEventsConfig } from "./run_events_config.js";
import { buildRunEventsConfig } from "./run_events_config.js";
import type { TokenBudgetConfig } from "./token_budget_config.js";
import { buildTokenBudgetConfig } from "./token_budget_config.js";
import type { TokenUsageConfig } from "./token_usage_config.js";
import type { GuardrailsConfig } from "./guardrails_config.js";
import { loadGuardrailsConfigFromDict } from "./guardrails_config.js";
import type { CircuitBreakerConfig } from "./circuit_breaker_config.js";
import { buildCircuitBreakerConfig } from "./circuit_breaker_config.js";
import type { ToolOutputConfig } from "./tool_output_config.js";
import { buildToolOutputConfig } from "./tool_output_config.js";
import type { ToolSearchConfig } from "./tool_search_config.js";
import { loadToolSearchConfigFromDict } from "./tool_search_config.js";
import type { AgentsApiConfig } from "./agents_api_config.js";
import { loadAgentsApiConfigFromDict } from "./agents_api_config.js";
import type { SkillEvolutionConfig } from "./skill_evolution_config.js";
import { loadSkillEvolutionConfigFromDict } from "./skill_evolution_config.js";
import type { SuggestionsConfig } from "./suggestions_config.js";
import type { TitleConfig } from "./title_config.js";
import { loadTitleConfigFromDict } from "./title_config.js";
import type { SubagentsAppConfig } from "./subagents_config.js";
import { loadSubagentsConfigFromDict } from "./subagents_config.js";
import type { LoopDetectionConfig } from "./loop_detection_config.js";
import { buildLoopDetectionConfig } from "./loop_detection_config.js";
import type { ModelConfig } from "./model_config.js";
import type { ToolConfig, ToolGroupConfig } from "./tool_config.js";
import type { SafetyFinishReasonConfig } from "./safety_finish_reason_config.js";
import { buildSafetyFinishReasonConfig } from "./safety_finish_reason_config.js";
import type { GoalConfig } from "./goal_config.js";
import { buildGoalConfig } from "./goal_config.js";

export type { ModelConfig, ToolConfig, ToolGroupConfig };

const CONFIG_FILE_NAMES = ["config.yaml", "config.yml"];

export interface AppConfig {
  logLevel: string;
  tokenUsage: TokenUsageConfig;
  tokenBudget: TokenBudgetConfig;
  models: ModelConfig[];
  sandbox: SandboxConfig;
  tools: ToolConfig[];
  toolGroups: ToolGroupConfig[];
  skills: Record<string, unknown>;
  skillEvolution: SkillEvolutionConfig;
  extensions: Record<string, unknown>;
  toolOutput: ToolOutputConfig;
  toolSearch: ToolSearchConfig;
  title: TitleConfig;
  summarization: Record<string, unknown>;
  memory: MemoryConfig;
  agentsApi: AgentsApiConfig;
  acpAgents: Record<string, unknown>;
  subagents: SubagentsAppConfig;
  guardrails: GuardrailsConfig;
  suggestions: SuggestionsConfig;
  channelConnections: Record<string, unknown>;
  loopDetection: LoopDetectionConfig;
  circuitBreaker: CircuitBreakerConfig;
  safetyFinishReason: SafetyFinishReasonConfig;
  goal: GoalConfig;
  database: DatabaseConfig;
  runEvents: RunEventsConfig;
  checkpointer: Record<string, unknown> | null;
  streamBridge: Record<string, unknown> | null;
  [key: string]: unknown;
}

/**
 * Resolve the config file path.
 */
export function resolveConfigPath(configPath?: string): string {
  if (configPath) {
    const resolved = path.resolve(configPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Config file not found at ${resolved}`);
    }
    return resolved;
  }
  const envPath = process.env.QUILL_CONFIG_PATH;
  if (envPath) {
    const resolved = path.resolve(envPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Config file not found at QUILL_CONFIG_PATH=${envPath}`);
    }
    return resolved;
  }
  const projectConfig = existingProjectFile(CONFIG_FILE_NAMES);
  if (projectConfig) {
    return projectConfig;
  }
  const root = projectRoot();
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("config.yaml not found in project root");
}

/**
 * Recursively resolve `$ENV_VAR` placeholders in config values.
 */
/**
 * Sentinel thrown internally when an env var is missing. Caught by container
 * resolvers (arrays/objects) so that a single missing credential does not crash
 * the entire config load.
 */
class MissingEnvVarError extends Error {
  constructor(public readonly envName: string, public readonly raw: string) {
    super(`Environment variable ${envName} not found for config value ${raw}`);
    this.name = "MissingEnvVarError";
  }
}

export function resolveEnvVariables(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.startsWith("$")) {
      const envName = value.slice(1);
      const envValue = process.env[envName];
      if (envValue === undefined) {
        // Throw a typed error so callers can distinguish "missing credential"
        // from other failures. Top-level config loading surfaces this as a
        // non-fatal warning instead of crashing the gateway.
        throw new MissingEnvVarError(envName, value);
      }
      return envValue;
    }
    return value;
  }
  if (Array.isArray(value)) {
    // Filter out entries whose env vars are unavailable (e.g. model entries
    // referencing $ANTHROPIC_API_KEY when only DeepSeek is configured).
    const result: unknown[] = [];
    for (const item of value) {
      try {
        result.push(resolveEnvVariables(item));
      } catch (err) {
        if (err instanceof MissingEnvVarError) {
          console.warn(`[config] skipping entry — env var ${err.envName} not set (${err.raw})`);
          continue;
        }
        throw err;
      }
    }
    return result;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      try {
        result[key] = resolveEnvVariables(val);
      } catch (err) {
        if (err instanceof MissingEnvVarError) {
          console.warn(`[config] skipping key "${key}" — env var ${err.envName} not set (${err.raw})`);
          continue;
        }
        throw err;
      }
    }
    return result;
  }
  return value;
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert a snake_case config dict into camelCase partial AppConfig keys.
 */
function normalizeConfigKeys(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const camelKey = snakeToCamel(key);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      output[camelKey] = normalizeConfigKeys(value as Record<string, unknown>);
    } else {
      output[camelKey] = value;
    }
  }
  return output;
}

function buildSandboxConfig(input: Record<string, unknown>): SandboxConfig {
  const mounts = (input.mounts as Array<Record<string, unknown>>)?.map((m) => ({
    hostPath: String(m.host_path ?? m.hostPath ?? ""),
    containerPath: String(m.container_path ?? m.containerPath ?? ""),
    readOnly: Boolean(m.read_only ?? m.readOnly ?? false),
  })) ?? [];
  return {
    use: String(input.use ?? ""),
    allowHostBash: Boolean(input.allow_host_bash ?? input.allowHostBash ?? false),
    image: (input.image as string | null) ?? null,
    port: (input.port as number | null) ?? null,
    replicas: (input.replicas as number | null) ?? null,
    containerPrefix: (input.container_prefix ?? input.containerPrefix) as string | null,
    idleTimeout: (input.idle_timeout ?? input.idleTimeout) as number | null,
    mounts,
    environment: (input.environment as Record<string, string>) ?? {},
    bashOutputMaxChars: (input.bash_output_max_chars ?? input.bashOutputMaxChars ?? 20000) as number,
    readFileOutputMaxChars: (input.read_file_output_max_chars ?? input.readFileOutputMaxChars ?? 50000) as number,
    lsOutputMaxChars: (input.ls_output_max_chars ?? input.lsOutputMaxChars ?? 20000) as number,
  };
}

function buildModelConfig(input: Record<string, unknown>): ModelConfig {
  const base: ModelConfig = {
    name: String(input.name ?? ""),
    displayName: (input.display_name ?? input.displayName ?? null) as string | null,
    description: (input.description ?? null) as string | null,
    use: String(input.use ?? ""),
    model: String(input.model ?? ""),
    useResponsesApi: (input.use_responses_api ?? input.useResponsesApi ?? null) as boolean | null,
    outputVersion: (input.output_version ?? input.outputVersion ?? null) as string | null,
    supportsThinking: Boolean(input.supports_thinking ?? input.supportsThinking ?? false),
    supportsReasoningEffort: Boolean(input.supports_reasoning_effort ?? input.supportsReasoningEffort ?? false),
    whenThinkingEnabled: (input.when_thinking_enabled ?? input.whenThinkingEnabled ?? null) as Record<string, unknown> | null,
    whenThinkingDisabled: (input.when_thinking_disabled ?? input.whenThinkingDisabled ?? null) as Record<string, unknown> | null,
    supportsVision: Boolean(input.supports_vision ?? input.supportsVision ?? false),
    streamChunkTimeout: (input.stream_chunk_timeout ?? input.streamChunkTimeout ?? null) as number | null,
    thinking: (input.thinking ?? null) as Record<string, unknown> | null,
  };
  const declaredKeys = new Set(Object.keys(base));
  for (const [key, value] of Object.entries(input)) {
    if (!declaredKeys.has(key)) {
      (base as Record<string, unknown>)[key] = value;
    }
  }
  return base;
}

export function buildToolConfig(input: Record<string, unknown>): ToolConfig {
  const base: ToolConfig = {
    name: String(input.name ?? ""),
    group: String(input.group ?? ""),
    use: String(input.use ?? ""),
  };
  // Preserve provider-specific extra keys (e.g. api_key, max_results, base_url)
  // so community tools reading `getToolConfig(name)` can access their config.
  // Mirrors `buildModelConfig` (Pydantic extra="allow").
  const declaredKeys = new Set(Object.keys(base));
  for (const [key, value] of Object.entries(input)) {
    if (!declaredKeys.has(key)) {
      (base as Record<string, unknown>)[key] = value;
    }
  }
  return base;
}

function buildToolGroupConfig(input: Record<string, unknown>): ToolGroupConfig {
  return {
    name: String(input.name ?? ""),
  };
}

/**
 * Load AppConfig from a YAML file.
 */
export function loadAppConfigFromFile(configPath?: string): AppConfig {
  const resolvedPath = resolveConfigPath(configPath);
  const raw = fs.readFileSync(resolvedPath, "utf-8");
  const parsed = YAML.parse(raw) as Record<string, unknown> | null | undefined;
  const data = (parsed ?? {}) as Record<string, unknown>;

  const resolved = resolveEnvVariables(data) as Record<string, unknown>;
  const cfg = normalizeConfigKeys(resolved) as Record<string, Record<string, unknown> | unknown>;

function section(cfg: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = cfg[key];
  if (value === null || value === undefined) {
    return {};
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

  // Filter out models whose required credential (api_key) resolved to nothing —
  // e.g. $ANTHROPIC_API_KEY not set. Otherwise the default model picker falls
  // back to config.models[0] and the run fails with "API key not found".
  const models = ((cfg.models ?? []) as Array<Record<string, unknown>>)
    .map(buildModelConfig)
    .filter((m) => typeof m.api_key === "string" && m.api_key.length > 0);
  const tools = ((cfg.tools ?? []) as Array<Record<string, unknown>>).map(buildToolConfig);
  const toolGroups = ((cfg.toolGroups ?? cfg.tool_groups ?? []) as Array<Record<string, unknown>>).map(buildToolGroupConfig);

  const appConfig: AppConfig = {
    logLevel: String(cfg.logLevel ?? "info"),
    tokenUsage: { enabled: (section(cfg, "tokenUsage").enabled as boolean) ?? true },
    tokenBudget: buildTokenBudgetConfig(section(cfg, "tokenBudget") as Partial<TokenBudgetConfig>),
    models,
    sandbox: buildSandboxConfig(section(cfg, "sandbox")),
    tools,
    toolGroups,
    skills: section(cfg, "skills"),
    skillEvolution: { enabled: (section(cfg, "skillEvolution").enabled as boolean) ?? false, moderationModelName: (section(cfg, "skillEvolution").moderationModelName ?? null) as string | null },
    extensions: section(cfg, "extensions"),
    mcp: section(cfg, "mcp"),
    toolOutput: buildToolOutputConfig(section(cfg, "toolOutput") as Partial<ToolOutputConfig>),
    toolSearch: { enabled: (section(cfg, "toolSearch").enabled as boolean) ?? false },
    title: {
      enabled: (section(cfg, "title").enabled as boolean) ?? true,
      maxWords: (section(cfg, "title").maxWords as number) ?? 6,
      maxChars: (section(cfg, "title").maxChars as number) ?? 60,
      modelName: (section(cfg, "title").modelName ?? null) as string | null,
      promptTemplate: (section(cfg, "title").promptTemplate as string) ?? "Generate a concise title (max {max_words} words) for this conversation.\nUser: {user_msg}\nAssistant: {assistant_msg}\n\nReturn ONLY the title, no quotes, no explanation.",
    },
    summarization: section(cfg, "summarization"),
    memory: {
      enabled: (section(cfg, "memory").enabled as boolean) ?? true,
      storagePath: (section(cfg, "memory").storagePath as string) ?? "",
      storageClass: (section(cfg, "memory").storageClass as string) ?? "quill.agents.memory.storage.FileMemoryStorage",
      debounceSeconds: (section(cfg, "memory").debounceSeconds as number) ?? 30,
      modelName: (section(cfg, "memory").modelName ?? null) as string | null,
      maxFacts: (section(cfg, "memory").maxFacts as number) ?? 100,
      factConfidenceThreshold: (section(cfg, "memory").factConfidenceThreshold as number) ?? 0.7,
      injectionEnabled: (section(cfg, "memory").injectionEnabled as boolean) ?? true,
      maxInjectionTokens: (section(cfg, "memory").maxInjectionTokens as number) ?? 2000,
      tokenCounting: ((section(cfg, "memory").tokenCounting as string) ?? "tiktoken") as import("./memory_config.js").TokenCountingStrategy,
      guaranteedCategories: ((section(cfg, "memory").guaranteedCategories as string[]) ?? ["correction"]),
      guaranteedTokenBudget: (section(cfg, "memory").guaranteedTokenBudget as number) ?? 500,
    },
    agentsApi: { enabled: (section(cfg, "agentsApi").enabled as boolean) ?? false },
    acpAgents: section(cfg, "acpAgents"),
    subagents: {
      // Master switch — read from both camelCase and snake_case for YAML parity.
      enabled: (section(cfg, "subagents").enabled ?? true) as boolean,
      timeoutSeconds: (section(cfg, "subagents").timeoutSeconds as number) ?? 1800,
      maxTurns: (section(cfg, "subagents").maxTurns ?? null) as number | null,
      agents: (section(cfg, "subagents").agents ?? {}) as Record<string, import("./subagents_config.js").SubagentOverrideConfig>,
      customAgents: (section(cfg, "subagents").customAgents ?? {}) as Record<string, import("./subagents_config.js").CustomSubagentConfig>,
    },
    guardrails: {
      enabled: (section(cfg, "guardrails").enabled as boolean) ?? false,
      failClosed: (section(cfg, "guardrails").failClosed as boolean) ?? true,
      passport: (section(cfg, "guardrails").passport ?? null) as string | null,
      provider: (section(cfg, "guardrails").provider ?? null) as GuardrailsConfig["provider"],
    },
    suggestions: { enabled: (section(cfg, "suggestions").enabled as boolean) ?? true },
    channelConnections: section(cfg, "channelConnections"),
    loopDetection: buildLoopDetectionConfig(section(cfg, "loopDetection") as Partial<LoopDetectionConfig>),
    circuitBreaker: buildCircuitBreakerConfig(section(cfg, "circuitBreaker") as Partial<CircuitBreakerConfig>),
    safetyFinishReason: buildSafetyFinishReasonConfig(section(cfg, "safetyFinishReason") as Partial<SafetyFinishReasonConfig>),
    goal: buildGoalConfig(section(cfg, "goal") as Record<string, unknown> | null),
    database: buildDatabaseConfig(section(cfg, "database") as Partial<DatabaseConfig>),
    runEvents: buildRunEventsConfig(section(cfg, "runEvents") as Partial<RunEventsConfig>),
    checkpointer: section(cfg, "checkpointer") as Record<string, unknown> | null,
    streamBridge: section(cfg, "streamBridge") as Record<string, unknown> | null,
  };

  // Synchronize singletons for modules that still read their own config globals.
  loadMemoryConfigFromDict(appConfig.memory);
  loadTitleConfigFromDict(appConfig.title);
  loadSubagentsConfigFromDict(appConfig.subagents);
  loadAgentsApiConfigFromDict(appConfig.agentsApi);
  loadToolSearchConfigFromDict(appConfig.toolSearch);
  loadGuardrailsConfigFromDict(appConfig.guardrails);

  return appConfig;
}

let cachedConfig: AppConfig | null = null;
let cachedPath: string | null = null;
let customConfig: AppConfig | null = null;

/**
 * Load and cache AppConfig from file. Subsequent calls return the cached
 * instance unless `resetAppConfig()` is called.
 */
export function loadAppConfig(configPath?: string): AppConfig {
  if (customConfig !== null) {
    return customConfig;
  }
  const resolvedPath = resolveConfigPath(configPath);
  if (cachedConfig !== null && cachedPath === resolvedPath) {
    return cachedConfig;
  }
  cachedConfig = loadAppConfigFromFile(resolvedPath);
  cachedPath = resolvedPath;
  return cachedConfig;
}

/**
 * Return a default AppConfig when no config file is present.
 */
export function defaultAppConfig(): AppConfig {
  return {
    logLevel: "info",
    tokenUsage: { enabled: true },
    tokenBudget: buildTokenBudgetConfig(),
    models: [],
    sandbox: buildSandboxConfig({}),
    tools: [],
    toolGroups: [],
    skills: {},
    skillEvolution: { enabled: false, moderationModelName: null },
    extensions: {},
    toolOutput: buildToolOutputConfig(),
    toolSearch: { enabled: false },
    title: {
      enabled: true,
      maxWords: 6,
      maxChars: 60,
      modelName: null,
      promptTemplate:
        "Generate a concise title (max {max_words} words) for this conversation.\nUser: {user_msg}\nAssistant: {assistant_msg}\n\nReturn ONLY the title, no quotes, no explanation.",
    },
    summarization: {},
    memory: {
      enabled: true,
      storagePath: "",
      storageClass: "quill.agents.memory.storage.FileMemoryStorage",
      debounceSeconds: 30,
      modelName: null,
      maxFacts: 100,
      factConfidenceThreshold: 0.7,
      injectionEnabled: true,
      maxInjectionTokens: 2000,
      tokenCounting: "tiktoken",
      guaranteedCategories: ["correction"],
      guaranteedTokenBudget: 500,
    },
    agentsApi: { enabled: false },
    acpAgents: {},
    subagents: {
      enabled: true,
      timeoutSeconds: 1800,
      maxTurns: null,
      agents: {},
      customAgents: {},
    },
    guardrails: {
      enabled: false,
      failClosed: true,
      passport: null,
      provider: null,
    },
    suggestions: { enabled: true },
    channelConnections: {},
    loopDetection: buildLoopDetectionConfig(),
    circuitBreaker: buildCircuitBreakerConfig(),
    safetyFinishReason: buildSafetyFinishReasonConfig(),
    goal: buildGoalConfig(),
    database: buildDatabaseConfig(),
    runEvents: buildRunEventsConfig(),
    checkpointer: null,
    streamBridge: null,
  };
}

/**
 * Return the current AppConfig, loading from the default file if necessary.
 * Falls back to a default config when no file exists.
 */
export function getAppConfig(): AppConfig {
  if (customConfig !== null) {
    return customConfig;
  }
  if (cachedConfig !== null) {
    return cachedConfig;
  }
  try {
    return loadAppConfig();
  } catch (error) {
    if (error instanceof Error && error.message.includes("config.yaml not found")) {
      return defaultAppConfig();
    }
    throw error;
  }
}

/**
 * Set a custom AppConfig (used by tests / composition roots).
 */
export function setAppConfig(config: AppConfig): void {
  customConfig = config;
  cachedConfig = null;
  cachedPath = null;
}

/**
 * Reset the cached AppConfig so the next call reloads from file.
 */
export function resetAppConfig(): void {
  cachedConfig = null;
  cachedPath = null;
  customConfig = null;
}

/**
 * Return true if a custom config has been injected.
 */
export function hasCustomAppConfig(): boolean {
  return customConfig !== null;
}

/**
 * Lookup helpers.
 */
export function getModelConfig(name: string): ModelConfig | undefined {
  return getAppConfig().models.find((m) => m.name === name);
}

export function getToolConfig(name: string): ToolConfig | undefined {
  return getAppConfig().tools.find((t) => t.name === name);
}

export function getToolGroupConfig(name: string): ToolGroupConfig | undefined {
  return getAppConfig().toolGroups.find((g) => g.name === name);
}
