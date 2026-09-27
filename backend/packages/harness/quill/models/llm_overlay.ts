/**
 * LLM Overlay — process-context role→model routing.
 *
 * Ported from CrewAI 1.15.22's `llm_overlay` context variable
 * (`lib/crewai/src/crewai/llm_overlay.py`): within a `withLlmOverlay(...)`
 * scope, any agent whose role is a key of the mapping is built with the
 * mapped model instead of its declared one. Roles not in the mapping — and
 * agents built outside the scope — keep their declared model.
 *
 * Semantics ported faithfully from the source:
 * - Whitespace-stripped exact role match. Two keys that differ only in
 *   whitespace name the same role: same model is fine, different models are
 *   a conflict error ("give each role one model") so routing never depends
 *   on dictionary order.
 * - The overlay is read at agent-factory time (and may be re-read when a
 *   role is interpolated later). A role resolution that lands outside the
 *   mapping restores the declared model — a reused agent never bills a
 *   previous role's provider.
 * - Settings merge (`mergeOverlaySettings`): generation/runtime settings
 *   (temperature, timeouts, token limits, stop sequences) are copied from
 *   the declared model onto the overlay model when the overlay model does
 *   not specify its own; credentials/endpoint settings are copied only when
 *   the two models share a provider — cross-provider overlays get the
 *   overlay model's own credentials and environment.
 *
 * TS analogue of Python's `contextvars.ContextVar`: `AsyncLocalStorage`,
 * which follows the async calling context (and must be propagated into
 * plain threads manually, same caveat as upstream).
 *
 * @module models/llm_overlay
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** role (exact, whitespace-stripped) → model name. */
export type LlmOverlayMapping = Record<string, string>;

/** Thrown when two overlay keys that differ only in whitespace map to different models. */
export class LlmOverlayConflictError extends Error {
  constructor(readonly role: string, readonly models: [string, string]) {
    super(
      `llm_overlay conflict: role "${role}" is mapped to both "${models[0]}" and "${models[1]}" — give each role one model`,
    );
    this.name = "LlmOverlayConflictError";
  }
}

const overlayStorage = new AsyncLocalStorage<LlmOverlayMapping>();

/** Generation/runtime settings copied from the declared model when the overlay model omits them. */
const GENERATION_SETTINGS = [
  "temperature",
  "top_p",
  "max_tokens",
  "max_output_tokens",
  "timeout",
  "timeout_ms",
  "stop",
  "stop_sequences",
  "presence_penalty",
  "frequency_penalty",
  "seed",
  "reasoning_effort",
  "thinking_enabled",
] as const;

/** Credential/endpoint settings copied only when both models share a provider. */
const CREDENTIAL_SETTINGS = [
  "api_key",
  "base_url",
  "api_base",
  "endpoint",
  "azure_endpoint",
  "aws_region",
  "project",
  "organization",
] as const;

/**
 * Validate a mapping: whitespace-stripped keys must not name the same role
 * with two different models. Returns the normalized mapping.
 */
export function normalizeOverlayMapping(mapping: LlmOverlayMapping): LlmOverlayMapping {
  const normalized: LlmOverlayMapping = {};
  const byRole = new Map<string, string>();
  for (const [rawKey, model] of Object.entries(mapping)) {
    const role = rawKey.trim();
    const existing = byRole.get(role);
    if (existing !== undefined && existing !== model) {
      throw new LlmOverlayConflictError(role, [existing, model]);
    }
    byRole.set(role, model);
    normalized[role] = model;
  }
  return normalized;
}

/**
 * Run `fn` with an active role→model overlay. Exception-safe: the overlay is
 * cleared when the scope exits, even on error (token-based reset, matching
 * upstream's `@contextmanager`).
 */
export async function withLlmOverlay<T>(
  mapping: LlmOverlayMapping,
  fn: () => Promise<T> | T,
): Promise<T> {
  return overlayStorage.run(normalizeOverlayMapping(mapping), fn);
}

/** Non-async variant for synchronous factory code paths. */
export function withLlmOverlaySync<T>(mapping: LlmOverlayMapping, fn: () => T): T {
  return overlayStorage.run(normalizeOverlayMapping(mapping), fn);
}

/** Active overlay mapping, or `null` outside a scope. */
export function activeLlmOverlay(): LlmOverlayMapping | null {
  return overlayStorage.getStore() ?? null;
}

/**
 * Resolve the model for a role under the active overlay. Whitespace-stripped
 * exact match; unmapped roles (and calls outside any scope) return the
 * declared model unchanged.
 */
export function overlayModelFor(role: string, declaredModel: string): string {
  const overlay = overlayStorage.getStore();
  if (!overlay) {
    return declaredModel;
  }
  const mapped = overlay[role.trim()];
  return mapped ?? declaredModel;
}

/**
 * Merge settings for an overlay-routed model, mirroring CrewAI's
 * `create_llm_like(overlay_model, declared_llm)`:
 * - generation/runtime settings: copied from the declared model's settings
 *   only when the overlay model does not set its own value;
 * - credentials/endpoints: copied from the declared model only when both
 *   models share a provider — cross-provider overlays keep their own.
 */
export function mergeOverlaySettings(
  overlaySettings: Record<string, unknown>,
  declaredSettings: Record<string, unknown>,
  overlayProvider: string,
  declaredProvider: string,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...overlaySettings };
  for (const key of GENERATION_SETTINGS) {
    if (declaredSettings[key] !== undefined && overlaySettings[key] === undefined) {
      merged[key] = declaredSettings[key];
    }
  }
  if (overlayProvider === declaredProvider) {
    for (const key of CREDENTIAL_SETTINGS) {
      if (declaredSettings[key] !== undefined && overlaySettings[key] === undefined) {
        merged[key] = declaredSettings[key];
      }
    }
  }
  return merged;
}
