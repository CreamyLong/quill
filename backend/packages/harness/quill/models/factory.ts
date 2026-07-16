/**
 * Chat model factory.
 *
 * TS port of `quill.models.factory`. Builds a LangChain chat model from the
 * app config: resolves the provider `use` key to a constructor, projects the
 * per-model settings onto the constructor's option shape, applies the thinking /
 * stream-usage / stream-chunk-timeout defaults, and returns the instance.
 *
 * Deviations:
 * - Python resolves `model_config.use` (a `module:Class` path) dynamically via
 *   `quill.reflection.resolve_class`. TS cannot import arbitrary Python
 *   modules, so dispatch is a static {@link PROVIDER_REGISTRY} keyed by the same
 *   `use` strings. Only the ported providers plus the installed base classes
 *   (`langchain_openai:ChatOpenAI`, `langchain_anthropic:ChatAnthropic`) are
 *   registered. Raw `langchain_deepseek:ChatDeepSeek` is not available
 *   (`@langchain/deepseek` is not installed); use the patched provider instead.
 * - Python passes snake_case settings straight to the LangChain-Python
 *   constructors. LangChain-JS uses camelCase and nests client options, so
 *   {@link mapSettingsToConstructorFields} performs the options mapping
 *   (`base_url` -> `configuration.baseURL`, `api_key` -> `apiKey`, etc.).
 */

import { ChatOpenAI } from "@langchain/openai";
import type { ChatOpenAIFields } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import type { ChatAnthropicInput } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { getAppConfig } from "../config/app_config.js";
import type { AppConfig, ModelConfig } from "../config/app_config.js";

import { ClaudeChatModel } from "./claude_provider.js";
import { CodexChatModel } from "./openai_codex_provider.js";
import { MindIEChatModel } from "./mindie_provider.js";
import { PatchedChatOpenAI } from "./patched_openai.js";
import { PatchedChatDeepSeek } from "./patched_deepseek.js";
import { PatchedChatMiMo } from "./patched_mimo.js";
import { PatchedChatMiniMax } from "./patched_minimax.js";
import { PatchedChatStepFun } from "./patched_stepfun.js";
import { VllmChatModel } from "./vllm_provider.js";
import { buildTracingCallbacks } from "../tracing/factory.js";

/** Options for {@link createChatModel} (mirrors Python's keyword-only args + **kwargs). */
export interface CreateChatModelOptions {
  /** Explicit application config; falls back to the cached global if omitted. */
  appConfig?: AppConfig;
  /** When true (default), attach tracing callbacks directly to the model instance. */
  attachTracing?: boolean;
  /** Extra constructor kwargs forwarded to the provider. */
  [key: string]: unknown;
}

/** A registered provider: how to construct it and how the factory should treat it. */
interface ProviderEntry {
  create: (fields: Record<string, unknown>) => BaseChatModel;
  className: string;
  /** Constructor option dialect: OpenAI-compatible vs. Anthropic. */
  target: "openai" | "anthropic";
  /** Whether this is (a subclass of) CodexChatModel. */
  isCodex: boolean;
  /** Whether the constructor accepts a `stream_usage` field. */
  supportsStreamUsage: boolean;
}

/**
 * Static dispatch table replacing Python's `resolve_class(model_config.use)`.
 */
export const PROVIDER_REGISTRY: Record<string, ProviderEntry> = {
  "langchain_openai:ChatOpenAI": {
    create: (f) => new ChatOpenAI(f as ChatOpenAIFields),
    className: "ChatOpenAI",
    target: "openai",
    isCodex: false,
    supportsStreamUsage: true,
  },
  "langchain_anthropic:ChatAnthropic": {
    create: (f) => new ChatAnthropic(f as ChatAnthropicInput),
    className: "ChatAnthropic",
    target: "anthropic",
    isCodex: false,
    supportsStreamUsage: true,
  },
  "quill.models.claude_provider:ClaudeChatModel": {
    create: (f) => new ClaudeChatModel(f),
    className: "ClaudeChatModel",
    target: "anthropic",
    isCodex: false,
    supportsStreamUsage: true,
  },
  "quill.models.patched_openai:PatchedChatOpenAI": {
    create: (f) => new PatchedChatOpenAI(f as ChatOpenAIFields),
    className: "PatchedChatOpenAI",
    target: "openai",
    isCodex: false,
    supportsStreamUsage: true,
  },
  "quill.models.patched_deepseek:PatchedChatDeepSeek": {
    create: (f) => new PatchedChatDeepSeek(f as ChatOpenAIFields),
    className: "PatchedChatDeepSeek",
    target: "openai",
    isCodex: false,
    supportsStreamUsage: true,
  },
  "quill.models.patched_mimo:PatchedChatMiMo": {
    create: (f) => new PatchedChatMiMo(f as ChatOpenAIFields),
    className: "PatchedChatMiMo",
    target: "openai",
    isCodex: false,
    supportsStreamUsage: true,
  },
  "quill.models.patched_minimax:PatchedChatMiniMax": {
    create: (f) => new PatchedChatMiniMax(f as ChatOpenAIFields),
    className: "PatchedChatMiniMax",
    target: "openai",
    isCodex: false,
    supportsStreamUsage: true,
  },
  "quill.models.patched_stepfun:PatchedChatStepFun": {
    create: (f) => new PatchedChatStepFun(f as ChatOpenAIFields),
    className: "PatchedChatStepFun",
    target: "openai",
    isCodex: false,
    supportsStreamUsage: true,
  },
  "quill.models.vllm_provider:VllmChatModel": {
    create: (f) => new VllmChatModel(f as ChatOpenAIFields),
    className: "VllmChatModel",
    target: "openai",
    isCodex: false,
    supportsStreamUsage: true,
  },
  "quill.models.mindie_provider:MindIEChatModel": {
    create: (f) => new MindIEChatModel(f),
    className: "MindIEChatModel",
    target: "openai",
    isCodex: false,
    supportsStreamUsage: true,
  },
  "quill.models.openai_codex_provider:CodexChatModel": {
    create: (f) => new CodexChatModel(f),
    className: "CodexChatModel",
    target: "openai",
    isCodex: true,
    supportsStreamUsage: false,
  },
};

// Fields excluded from `model_settings_from_config` (both camelCase declared keys
// and their snake_case passthrough duplicates produced by the TS config loader).
const EXCLUDED_SETTING_KEYS = new Set([
  "use",
  "name",
  "displayName",
  "display_name",
  "description",
  "supportsThinking",
  "supports_thinking",
  "supportsReasoningEffort",
  "supports_reasoning_effort",
  "whenThinkingEnabled",
  "when_thinking_enabled",
  "whenThinkingDisabled",
  "when_thinking_disabled",
  "thinking",
  "supportsVision",
  "supports_vision",
]);

// Declared camelCase fields that survive into settings, mapped to their
// snake_case names (matching Python's `model_dump`).
const DECLARED_CAMEL_TO_SNAKE: Record<string, string> = {
  useResponsesApi: "use_responses_api",
  outputVersion: "output_version",
  streamChunkTimeout: "stream_chunk_timeout",
};

/**
 * Default chunk-gap budget for OpenAI-compatible streaming responses.
 *
 * langchain-openai raises `StreamChunkTimeoutError` after this many seconds
 * without receiving a chunk. We default to 240s so the streaming layer rarely
 * trips on long thinking pauses.
 */
const DEFAULT_STREAM_CHUNK_TIMEOUT_SECONDS = 240.0;

/** Recursively merge two dictionaries without mutating the inputs. */
export function deepMergeDicts(base: Record<string, unknown> | null | undefined, override: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key];
    if (isRecord(value) && isRecord(existing)) {
      merged[key] = deepMergeDicts(existing, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

/** Build the disable payload for vLLM/Qwen chat template kwargs. */
export function vllmDisableChatTemplateKwargs(chatTemplateKwargs: Record<string, unknown>): Record<string, boolean> {
  const disableKwargs: Record<string, boolean> = {};
  if ("thinking" in chatTemplateKwargs) {
    disableKwargs.thinking = false;
  }
  if ("enable_thinking" in chatTemplateKwargs) {
    disableKwargs.enable_thinking = false;
  }
  return disableKwargs;
}

/**
 * Enable stream usage for OpenAI-compatible models unless explicitly configured.
 *
 * LangChain only auto-enables `stream_usage` for OpenAI models when no custom
 * base URL or client is configured. Quill frequently uses OpenAI-compatible
 * gateways, so token usage tracking would otherwise stay empty.
 */
export function enableStreamUsageByDefault(modelUsePath: string, settings: Record<string, unknown>): void {
  if (modelUsePath !== "langchain_openai:ChatOpenAI") {
    return;
  }
  if ("stream_usage" in settings) {
    return;
  }
  if ("base_url" in settings || "openai_api_base" in settings) {
    settings.stream_usage = true;
  }
}

/**
 * Inject a generous `stream_chunk_timeout` for OpenAI-compatible clients.
 *
 * The `stream_chunk_timeout` kwarg is specific to `langchain_openai:ChatOpenAI`
 * and is rejected by other providers' constructors. For the non-OpenAI path the
 * key is dropped so it is never forwarded to an incompatible constructor.
 */
export function applyStreamChunkTimeoutDefault(modelUsePath: string, settings: Record<string, unknown>): void {
  if (modelUsePath !== "langchain_openai:ChatOpenAI") {
    delete settings.stream_chunk_timeout;
    return;
  }
  if ("stream_chunk_timeout" in settings) {
    return;
  }
  settings.stream_chunk_timeout = DEFAULT_STREAM_CHUNK_TIMEOUT_SECONDS;
}

/**
 * Create a chat model instance from the config.
 *
 * @param name The name of the model to create. If null/undefined, the first
 *   model in the config is used.
 * @param thinkingEnabled Enable the model's extended-thinking mode when supported.
 * @param options Explicit `appConfig`, `attachTracing`, and extra constructor kwargs.
 */
export function createChatModel(name?: string | null, thinkingEnabled = false, options: CreateChatModelOptions = {}): BaseChatModel {
  const { appConfig, attachTracing = true, ...kwargs } = options;

  const config = appConfig ?? getAppConfig();
  let modelName = name ?? null;
  if (modelName === null) {
    if (config.models.length === 0) {
      throw new Error("No models configured");
    }
    modelName = config.models[0].name;
  }
  const modelConfig = config.models.find((m) => m.name === modelName);
  if (modelConfig === undefined) {
    throw new Error(`Model ${modelName} not found in config`);
  }

  const entry = PROVIDER_REGISTRY[modelConfig.use];
  if (entry === undefined) {
    throw new Error(
      `Could not resolve model provider '${modelConfig.use}'. Supported keys: ${Object.keys(PROVIDER_REGISTRY).join(", ")}`,
    );
  }

  const settings = buildModelSettings(modelConfig);

  // Compute effective when_thinking_enabled by merging in the `thinking` shortcut.
  const whenThinkingEnabled = isRecord(modelConfig.whenThinkingEnabled) ? modelConfig.whenThinkingEnabled : null;
  const whenThinkingDisabled = isRecord(modelConfig.whenThinkingDisabled) ? modelConfig.whenThinkingDisabled : null;
  const thinkingShortcut = isRecord(modelConfig.thinking) ? modelConfig.thinking : null;

  const hasThinkingSettings = whenThinkingEnabled !== null || thinkingShortcut !== null;
  let effectiveWte: Record<string, unknown> = whenThinkingEnabled ? { ...whenThinkingEnabled } : {};
  if (thinkingShortcut !== null) {
    const existingThinking = isRecord(effectiveWte.thinking) ? effectiveWte.thinking : {};
    const mergedThinking = { ...existingThinking, ...thinkingShortcut };
    effectiveWte = { ...effectiveWte, thinking: mergedThinking };
  }

  if (thinkingEnabled && hasThinkingSettings) {
    if (!modelConfig.supportsThinking) {
      throw new Error(
        `Model ${modelName} does not support thinking. Set \`supports_thinking\` to true in the \`config.yaml\` to enable thinking.`,
      );
    }
    if (Object.keys(effectiveWte).length > 0) {
      Object.assign(settings, effectiveWte);
    }
  }

  if (!thinkingEnabled) {
    if (whenThinkingDisabled !== null) {
      // User-provided disable settings take full precedence.
      Object.assign(settings, whenThinkingDisabled);
    } else if (hasThinkingSettings && getNested(effectiveWte, "extra_body", "thinking", "type")) {
      // OpenAI-compatible gateway: thinking is nested under extra_body.
      settings.extra_body = deepMergeDicts(asRecordOrNull(settings.extra_body), { thinking: { type: "disabled" } });
      settings.reasoning_effort = "minimal";
    } else if (hasThinkingSettings) {
      const ctk = getNested(effectiveWte, "extra_body", "chat_template_kwargs");
      const disableChatTemplateKwargs = vllmDisableChatTemplateKwargs(isRecord(ctk) ? ctk : {});
      if (Object.keys(disableChatTemplateKwargs).length > 0) {
        // vLLM uses chat template kwargs to switch thinking on/off.
        settings.extra_body = deepMergeDicts(asRecordOrNull(settings.extra_body), { chat_template_kwargs: disableChatTemplateKwargs });
      } else if (getNested(effectiveWte, "thinking", "type")) {
        // Native langchain_anthropic: thinking is a direct constructor parameter.
        settings.thinking = { type: "disabled" };
      }
    }
  }

  if (!modelConfig.supportsReasoningEffort) {
    delete kwargs.reasoning_effort;
    delete settings.reasoning_effort;
  }

  enableStreamUsageByDefault(modelConfig.use, settings);
  applyStreamChunkTimeoutDefault(modelConfig.use, settings);

  // For Codex Responses API models: map thinking mode to reasoning_effort.
  if (entry.isCodex) {
    // The ChatGPT Codex endpoint currently rejects max_tokens/max_output_tokens.
    delete settings.max_tokens;

    // Use explicit reasoning_effort from frontend if provided (low/medium/high).
    const explicitEffort = kwargs.reasoning_effort;
    delete kwargs.reasoning_effort;
    if (!thinkingEnabled) {
      settings.reasoning_effort = "none";
    } else if (explicitEffort && ["low", "medium", "high", "xhigh"].includes(explicitEffort as string)) {
      settings.reasoning_effort = explicitEffort;
    } else if (!("reasoning_effort" in settings)) {
      settings.reasoning_effort = "medium";
    }
  }

  // For MindIE models: enforce conservative retry defaults.
  if (entry.className === "MindIEChatModel") {
    settings.max_retries = "max_retries" in settings ? settings.max_retries : 1;
  }

  // Ensure stream_usage is enabled so token usage metadata is available in
  // streaming responses, unless explicitly configured.
  if (!("stream_usage" in settings) && !("stream_usage" in kwargs)) {
    if (entry.supportsStreamUsage) {
      settings.stream_usage = true;
    }
  }

  const mergedFields = { ...kwargs, ...settings };
  const constructorFields = mapSettingsToConstructorFields(mergedFields, entry.target);
  const modelInstance = entry.create(constructorFields);

  if (attachTracing) {
    const callbacks = buildTracingCallbacks();
    if (callbacks.length > 0) {
      const instance = modelInstance as unknown as { callbacks?: unknown[] };
      const existingCallbacks = instance.callbacks ?? [];
      instance.callbacks = [...existingCallbacks, ...callbacks];
    }
  }

  // Wrap with retry + exponential backoff for transient API errors
  // (AbortError from concurrent request contention, rate limits, network).
  return withRetryBackoff(modelInstance as BaseChatModel, modelName);
}

/* ------------------------------------------------------------------ */
/* Retry wrapper for transient API errors                              */
/* ------------------------------------------------------------------ */

const RETRY_MAX = 3;
const RETRY_BASE_MS = 2000;

/** Sleep for ms. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True if the error is transient and worth retrying. */
function isRetryableError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err).toLowerCase();
  return (
    msg.includes("abort") ||
    msg.includes("terminated") ||
    msg.includes("rate limit") ||
    msg.includes("429") ||
    msg.includes("too many request") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504")
  );
}

/** Wrap a model so invoke/stream retry with backoff on transient errors. */
function withRetryBackoff(model: BaseChatModel, label: string): BaseChatModel {
  const wrap =
    <T extends (...args: any[]) => Promise<any>>(fn: T) =>
    async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
        try {
          return await fn(...args) as Awaited<ReturnType<T>>;
        } catch (err) {
          lastErr = err;
          if (attempt < RETRY_MAX && isRetryableError(err)) {
            const delay = RETRY_BASE_MS * 2 ** attempt;
            console.warn(
              `[${label}] API call failed (attempt ${attempt + 1}/${RETRY_MAX + 1}): ` +
                `${(err as { message?: string })?.message ?? err}. Retrying in ${delay}ms...`
            );
            await sleep(delay);
            continue;
          }
          break;
        }
      }
      throw lastErr;
    };

  // LangChain models have invoke and stream methods; wrap both.
  const m = model as unknown as { invoke: (...a: any[]) => Promise<any>; stream: (...a: any[]) => Promise<any> };
  m.invoke = wrap(m.invoke.bind(model));
  m.stream = wrap(m.stream.bind(model));
  return model;
}

/**
 * Project the per-model config (excluding thinking/metadata fields) into a
 * snake_case settings dict, mirroring Python's `ModelConfig.model_dump`.
 */
function buildModelSettings(modelConfig: ModelConfig): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(modelConfig)) {
    if (EXCLUDED_SETTING_KEYS.has(key)) {
      continue;
    }
    if (value === null || value === undefined) {
      continue;
    }
    if (key in DECLARED_CAMEL_TO_SNAKE) {
      settings[DECLARED_CAMEL_TO_SNAKE[key]] = value;
      continue;
    }
    settings[key] = value;
  }
  return settings;
}

/**
 * Map snake_case LangChain-Python constructor kwargs onto the LangChain-JS
 * constructor option shape.
 */
export function mapSettingsToConstructorFields(settings: Record<string, unknown>, target: "openai" | "anthropic"): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const configuration: Record<string, unknown> = {};
  const clientOptions: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(settings)) {
    switch (key) {
      case "base_url":
      case "openai_api_base":
      case "api_base":
        if (target === "anthropic") {
          fields.anthropicApiUrl = value;
        } else {
          configuration.baseURL = value;
        }
        break;
      case "api_key":
      case "openai_api_key":
      case "anthropic_api_key":
        fields.apiKey = value;
        break;
      case "default_headers":
        if (target === "anthropic") {
          clientOptions.defaultHeaders = value;
        } else {
          configuration.defaultHeaders = value;
        }
        break;
      case "max_tokens":
        fields.maxTokens = value;
        break;
      case "max_retries":
        fields.maxRetries = value;
        break;
      case "top_p":
        fields.topP = value;
        break;
      case "top_k":
        fields.topK = value;
        break;
      case "stream_usage":
        fields.streamUsage = value;
        break;
      case "reasoning_effort":
        fields.reasoningEffort = value;
        break;
      case "use_responses_api":
        fields.useResponsesApi = value;
        break;
      case "output_version":
        fields.outputVersion = value;
        break;
      case "extra_body":
        if (target === "anthropic") {
          fields.invocationKwargs = value;
        } else {
          fields.modelKwargs = value;
        }
        break;
      default:
        fields[snakeToCamel(key)] = value;
    }
  }

  if (Object.keys(configuration).length > 0) {
    fields.configuration = configuration;
  }
  if (Object.keys(clientOptions).length > 0) {
    fields.clientOptions = clientOptions;
  }
  return fields;
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_m, letter: string) => letter.toUpperCase());
}

function getNested(obj: unknown, ...keys: string[]): unknown {
  let current: unknown = obj;
  for (const key of keys) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
