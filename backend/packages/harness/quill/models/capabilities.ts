/**
 * Model capabilities — runtime capability resolution and validation.
 *
 * Replaces the static `supports_thinking`/`supports_vision` flags with
 * a dynamic capability system that providers resolve at runtime based
 * on the actual model configuration.
 *
 * Pattern: Model Capabilities tracking (OpenWork).
 */

import type { ProviderCapabilities } from "./provider_registry.js";
import { getProviderByClassPath } from "./provider_registry.js";

/** Extended model capabilities resolved at runtime. */
export interface ModelCapabilities {
  /** Supports extended thinking / reasoning. */
  reasoning: boolean;
  /** Supports reasoning effort control (minimal/low/medium/high). */
  reasoningEffort: boolean;
  /** Supports image/vision input. */
  vision: boolean;
  /** Supports file attachments. */
  attachments: boolean;
  /** Supports tool/function calling. */
  tools: boolean;
  /** Maximum context length in tokens (0 = unknown). */
  maxTokens: number;
  /** Maximum output tokens (0 = unknown). */
  maxOutputTokens: number;
}

/** Default capabilities when none can be resolved. */
export const DEFAULT_CAPABILITIES: ModelCapabilities = {
  reasoning: false,
  reasoningEffort: false,
  vision: false,
  attachments: false,
  tools: true,
  maxTokens: 0,
  maxOutputTokens: 0,
};

/**
 * Resolve the capabilities for a model given its config.
 *
 * Uses the provider plugin's `resolveCapabilities` if available,
 * otherwise falls back to parsing the config's `supports_*` flags.
 *
 * @param config  The model config entry from config.yaml.
 * @returns Resolved capabilities.
 */
export function resolveCapabilities(config: Record<string, unknown>): ModelCapabilities {
  const use = typeof config.use === "string" ? config.use : "";
  const provider = getProviderByClassPath(use);

  if (provider) {
    const caps = provider.resolveCapabilities(config);
    return {
      reasoning: caps.reasoning,
      reasoningEffort: resolveReasoningEffort(config, caps.reasoning),
      vision: caps.vision,
      attachments: caps.attachments,
      tools: caps.tools,
      maxTokens: resolveMaxTokens(config),
      maxOutputTokens: resolveMaxOutputTokens(config),
    };
  }

  // Fallback: parse from config flags.
  return {
    reasoning: Boolean(config.supports_thinking),
    reasoningEffort: resolveReasoningEffort(config, Boolean(config.supports_thinking)),
    vision: Boolean(config.supports_vision),
    attachments: Boolean(config.supports_vision), // vision implies attachments
    tools: true,
    maxTokens: resolveMaxTokens(config),
    maxOutputTokens: resolveMaxOutputTokens(config),
  };
}

/**
 * Validate a model config's capabilities are consistent.
 *
 * Returns an array of warning messages (empty if valid).
 */
export function validateCapabilities(config: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const caps = resolveCapabilities(config);

  // If reasoning_effort is set but reasoning is not supported.
  if (config.reasoning_effort && !caps.reasoning) {
    warnings.push(
      `Model '${String(config.name ?? "unknown")}' has reasoning_effort set but does not support reasoning`,
    );
  }

  // If when_thinking_enabled is set but reasoning is not supported.
  if (config.when_thinking_enabled && !caps.reasoning) {
    warnings.push(
      `Model '${String(config.name ?? "unknown")}' has when_thinking_enabled but does not support reasoning`,
    );
  }

  return warnings;
}

/**
 * Check if a model supports a specific capability by name.
 */
export function hasCapability(
  capabilities: ModelCapabilities,
  capability: keyof ModelCapabilities,
): boolean {
  const value = capabilities[capability];
  if (typeof value === "boolean") {
    return value;
  }
  // Numeric capabilities: > 0 means supported.
  return value > 0;
}

/**
 * Get a human-readable label for a capability.
 */
export function getCapabilityLabel(capability: keyof ModelCapabilities): string {
  const labels: Record<keyof ModelCapabilities, string> = {
    reasoning: "Reasoning",
    reasoningEffort: "Reasoning Effort",
    vision: "Vision",
    attachments: "Attachments",
    tools: "Tool Calling",
    maxTokens: "Context Length",
    maxOutputTokens: "Max Output",
  };
  return labels[capability] ?? capability;
}

/**
 * Get an icon name for a capability (for UI rendering).
 */
export function getCapabilityIcon(capability: keyof ModelCapabilities): string {
  const icons: Record<keyof ModelCapabilities, string> = {
    reasoning: "brain",
    reasoningEffort: "sliders",
    vision: "eye",
    attachments: "paperclip",
    tools: "wrench",
    maxTokens: "ruler",
    maxOutputTokens: "arrow-up",
  };
  return icons[capability] ?? "check";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveReasoningEffort(
  config: Record<string, unknown>,
  reasoningSupported: boolean,
): boolean {
  if (!reasoningSupported) return false;
  return (
    config.supports_reasoning_effort === true ||
    config.reasoning_effort !== undefined
  );
}

function resolveMaxTokens(config: Record<string, unknown>): number {
  const val = config.max_tokens ?? config.context_length ?? config.n_ctx;
  if (typeof val === "number" && val > 0) return val;
  return 0;
}

function resolveMaxOutputTokens(config: Record<string, unknown>): number {
  const val = config.max_output_tokens ?? config.max_tokens;
  if (typeof val === "number" && val > 0) return val;
  return 0;
}
