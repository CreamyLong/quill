/**
 * Build a LangChain chat model from a Quill ModelConfig.
 *
 * Supports OpenAI-compatible providers (ChatOpenAI, incl. custom base_url such
 * as LongCat) and Anthropic-compatible providers (ChatAnthropic). Extend here
 * for Google, Ollama, etc.
 */

import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";

/**
 * Sleep helper for retry backoff.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine if an error is retryable (abort, network, rate-limit).
 */
function isRetryableError(err) {
  if (!err) return false;
  const msg = String(err.message ?? err).toLowerCase();
  return (
    msg.includes("abort") ||
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

export function buildChatModel(modelConfig) {
  const use = modelConfig.use ?? "";
  const providerName = use.split(":").pop() ?? "";

  // Collect extra kwargs from config, excluding internal/metadata fields.
  const excludedKeys = new Set([
    "name",
    "displayName",
    "description",
    "use",
    "model",
    "useResponsesApi",
    "outputVersion",
    "supportsThinking",
    "supportsReasoningEffort",
    "whenThinkingEnabled",
    "whenThinkingDisabled",
    "supportsVision",
    "streamChunkTimeout",
    "thinking",
  ]);
  const extra = {};
  for (const [key, value] of Object.entries(modelConfig)) {
    if (!excludedKeys.has(key) && value !== null && value !== undefined) {
      extra[key] = value;
    }
  }

  let model;

  if (providerName === "ChatOpenAI" || use.includes("PatchedChatOpenAI")) {
    const {
      api_key: apiKey,
      base_url: baseUrlSnake,
      baseURL: baseUrlCamel,
      api_base: apiBaseSnake,
      apiBase: apiBaseCamel,
      ...rest
    } = extra;
    const baseURL = baseUrlSnake ?? baseUrlCamel ?? apiBaseSnake ?? apiBaseCamel;

    const options = {
      model: modelConfig.model,
      temperature: rest.temperature ?? 0,
      apiKey: apiKey ?? process.env.OPENAI_API_KEY,
      // Retry with backoff for transient errors (abort, rate-limit, network)
      maxRetries: 3,
      // Align with Python backend: OpenAI SDK default read/write/pool timeout
      // is 600s. A 2-minute default is too short for long-context subagents.
      timeout: rest.timeout ?? 600000,
      ...rest,
    };
    if (baseURL) {
      options.configuration = { baseURL };
    }
    model = new ChatOpenAI(options);
  } else if (providerName === "ChatAnthropic" || use.includes("Anthropic")) {
    const {
      api_key: apiKey,
      base_url: baseUrlSnake,
      baseURL: baseUrlCamel,
      api_base: apiBaseSnake,
      apiBase: apiBaseCamel,
      ...rest
    } = extra;
    const baseUrl = baseUrlSnake ?? baseUrlCamel ?? apiBaseSnake ?? apiBaseCamel;
    model = new ChatAnthropic({
      model: modelConfig.model,
      temperature: rest.temperature ?? 0,
      apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
      maxRetries: 3,
      // Align with Python backend default (600s) for long-context subagents.
      timeout: rest.timeout ?? 600000,
      ...(baseUrl ? { anthropicApiUrl: baseUrl } : {}),
      ...rest,
    });
  } else {
    throw new Error(
      `Model provider '${use}' is not supported by the minimal TS runtime yet. Add it to scripts/model_factory.mjs.`
    );
  }

  // Wrap model with retry + exponential backoff for transient API errors
  // (AbortError from concurrent requests, rate limits, network blips).
  return withRetryBackoff(model, modelConfig.name ?? "model");
}

/**
 * Wrap a LangChain model with retry + exponential backoff for transient errors.
 * LangChain's built-in maxRetries doesn't always catch AbortError from
 * concurrent request contention, so we add an outer retry wrapper.
 */
function withRetryBackoff(model, label) {
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 2000;

  const wrap = (fn) => {
    return async (...args) => {
      let lastErr;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          return await fn.apply(model, args);
        } catch (err) {
          lastErr = err;
          if (attempt < MAX_RETRIES && isRetryableError(err)) {
            const delay = BASE_DELAY_MS * 2 ** attempt;
            console.warn(
              `[${label}] API call failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${err.message ?? err}. Retrying in ${delay}ms...`
            );
            await sleep(delay);
            continue;
          }
          break;
        }
      }
      throw lastErr;
    };
  };

  // Wrap invoke and stream (the two methods used by the agent graph)
  model.invoke = wrap(model.invoke.bind(model));
  model.stream = wrap(model.stream.bind(model));
  return model;
}

/**
 * Pick the first configured model or a fallback default.
 */
export function pickModelConfig(appConfig) {
  if (appConfig.models.length > 0) {
    return appConfig.models[0];
  }
  return {
    name: "gpt-4o-mini",
    displayName: null,
    description: null,
    use: "langchain_openai:ChatOpenAI",
    model: "gpt-4o-mini",
    useResponsesApi: null,
    outputVersion: null,
    supportsThinking: false,
    supportsReasoningEffort: false,
    whenThinkingEnabled: null,
    whenThinkingDisabled: null,
    supportsVision: false,
    streamChunkTimeout: null,
    thinking: null,
    api_key: process.env.OPENAI_API_KEY,
  };
}
