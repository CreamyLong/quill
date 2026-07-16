/**
 * Detectors for provider-side safety termination signals.
 *
 * Faithful port of Python `safety_termination_detectors`. Different LLM
 * providers signal "I stopped this response for safety reasons" through
 * different fields with different values. This module defines a small strategy
 * interface and three built-in detectors covering the major providers.
 *
 * The middleware that consumes these detectors lives in
 * `safety_finish_reason_middleware.ts`.
 */

import type { BaseMessage } from "@langchain/core/messages";

/** A detected safety-related termination signal. */
export interface SafetyTermination {
  /** Name of the detector that produced this result (observability). */
  detector: string;
  /** The message metadata field that carried the signal (e.g. finish_reason). */
  reason_field: string;
  /** The actual value of that field (e.g. content_filter, refusal, SAFETY). */
  reason_value: string;
  /** Provider-specific metadata that may help downstream consumers. */
  extras: Record<string, unknown>;
}

/** Strategy interface for provider safety termination detection. */
export interface SafetyTerminationDetector {
  name: string;
  /**
   * Return a SafetyTermination if `message` indicates provider safety
   * termination, otherwise return null. Implementations must be side-effect
   * free and tolerant of missing or oddly-typed metadata.
   */
  detect(message: BaseMessage): SafetyTermination | null;
}

/**
 * Read a string-typed value from either `response_metadata` or
 * `additional_kwargs`, in that order. Only non-empty string values are accepted
 * so we never raise on malformed inputs.
 */
function getMetadataValue(message: BaseMessage, fieldName: string): string | null {
  for (const containerName of ["response_metadata", "additional_kwargs"] as const) {
    const container = (message as unknown as Record<string, unknown>)[containerName];
    if (container === null || typeof container !== "object") {
      continue;
    }
    const value = (container as Record<string, unknown>)[fieldName];
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return null;
}

/**
 * OpenAI-compatible content_filter signal.
 *
 * Covers OpenAI, Azure OpenAI, Moonshot/Kimi, DeepSeek, Mistral, vLLM, Qwen
 * (OpenAI-compatible mode), and any other adapter that follows the OpenAI
 * `finish_reason` convention.
 */
export class OpenAICompatibleContentFilterDetector implements SafetyTerminationDetector {
  readonly name = "openai_compatible_content_filter";
  private readonly _finishReasons: ReadonlySet<string>;

  constructor(finishReasons?: string[] | null) {
    const configured = finishReasons ?? ["content_filter"];
    this._finishReasons = new Set(configured.map((r) => r.toLowerCase()));
  }

  detect(message: BaseMessage): SafetyTermination | null {
    const value = getMetadataValue(message, "finish_reason");
    if (value === null || !this._finishReasons.has(value.toLowerCase())) {
      return null;
    }

    const extras: Record<string, unknown> = {};
    const responseMetadata = (message as unknown as Record<string, unknown>)["response_metadata"];
    if (responseMetadata !== null && typeof responseMetadata === "object") {
      const filterResults = (responseMetadata as Record<string, unknown>)["content_filter_results"];
      if (filterResults) {
        extras["content_filter_results"] = filterResults;
      }
    }

    return {
      detector: this.name,
      reason_field: "finish_reason",
      reason_value: value,
      extras,
    };
  }
}

/** Anthropic `stop_reason === "refusal"` signal. */
export class AnthropicRefusalDetector implements SafetyTerminationDetector {
  readonly name = "anthropic_refusal";
  private readonly _stopReasons: ReadonlySet<string>;

  constructor(stopReasons?: string[] | null) {
    const configured = stopReasons ?? ["refusal"];
    this._stopReasons = new Set(configured.map((r) => r.toLowerCase()));
  }

  detect(message: BaseMessage): SafetyTermination | null {
    const value = getMetadataValue(message, "stop_reason");
    if (value === null || !this._stopReasons.has(value.toLowerCase())) {
      return null;
    }
    return {
      detector: this.name,
      reason_field: "stop_reason",
      reason_value: value,
      extras: {},
    };
  }
}

/** Gemini / Vertex AI safety-related finish reasons. */
export class GeminiSafetyDetector implements SafetyTerminationDetector {
  readonly name = "gemini_safety";

  private static readonly _DEFAULT_FINISH_REASONS: readonly string[] = [
    // Text safety
    "SAFETY",
    "BLOCKLIST",
    "PROHIBITED_CONTENT",
    "SPII",
    "RECITATION",
    // Image safety (multimodal generation)
    "IMAGE_SAFETY",
    "IMAGE_PROHIBITED_CONTENT",
    "IMAGE_RECITATION",
  ];

  private readonly _finishReasons: ReadonlySet<string>;

  constructor(finishReasons?: string[] | null) {
    const configured = finishReasons ?? GeminiSafetyDetector._DEFAULT_FINISH_REASONS;
    this._finishReasons = new Set(configured.map((r) => r.toUpperCase()));
  }

  detect(message: BaseMessage): SafetyTermination | null {
    const value = getMetadataValue(message, "finish_reason");
    if (value === null || !this._finishReasons.has(value.toUpperCase())) {
      return null;
    }

    const extras: Record<string, unknown> = {};
    const responseMetadata = (message as unknown as Record<string, unknown>)["response_metadata"];
    if (responseMetadata !== null && typeof responseMetadata === "object") {
      const ratings = (responseMetadata as Record<string, unknown>)["safety_ratings"];
      if (ratings) {
        extras["safety_ratings"] = ratings;
      }
    }

    return {
      detector: this.name,
      reason_field: "finish_reason",
      reason_value: value,
      extras,
    };
  }
}

/** Built-in detector set used when no custom detectors are configured. */
export function defaultDetectors(): SafetyTerminationDetector[] {
  return [
    new OpenAICompatibleContentFilterDetector(),
    new AnthropicRefusalDetector(),
    new GeminiSafetyDetector(),
  ];
}
