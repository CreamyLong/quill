/**
 * Annotation middleware — resolves tool safety hints and attaches them to
 * the guardrail request so annotation-based providers can make authorization
 * decisions.
 *
 * This is the bridge between the tool catalog (which knows each tool's
 * annotations) and the guardrail provider (which only sees the request).
 * The middleware runs inside the guardrail middleware's `wrapToolCall`,
 * reading annotations from a pluggable `AnnotationRegistry` and stashing
 * them on `request.metadata[ANNOTATIONS_METADATA_KEY]`.
 *
 * Pattern: five-layer permission evaluation (awesome-harness-engineering).
 */

import type { ToolCallRequest } from "../agents/factory.js";
import type { GuardrailRequest } from "./provider.js";
import { ANNOTATIONS_METADATA_KEY, EMPTY_ANNOTATIONS, type ToolAnnotations } from "./annotations.js";

/**
 * Registry that maps tool names to their declared annotations.
 *
 * Tools register their annotations at catalog-build time (mirrors how
 * the MCP tool catalog carries annotations through from the MCP server).
 * The annotation middleware consults this registry before each tool call.
 */
export interface AnnotationRegistry {
  /** Look up annotations for a tool. Returns all-ffalse defaults when unknown. */
  getAnnotations(toolName: string): ToolAnnotations;
}

/**
 * In-memory annotation registry backed by a plain record.
 */
export class MemoryAnnotationRegistry implements AnnotationRegistry {
  private readonly _annotations: Record<string, ToolAnnotations>;

  constructor(annotations: Record<string, Partial<ToolAnnotations>> = {}) {
    this._annotations = {};
    for (const [name, partial] of Object.entries(annotations)) {
      this._annotations[name] = { ...EMPTY_ANNOTATIONS, ...partial };
    }
  }

  getAnnotations(toolName: string): ToolAnnotations {
    return this._annotations[toolName] ?? { ...EMPTY_ANNOTATIONS };
  }

  /** Register or update annotations for a tool. */
  set(toolName: string, annotations: Partial<ToolAnnotations>): void {
    this._annotations[toolName] = { ...EMPTY_ANNOTATIONS, ...annotations };
  }
}

/**
 * Enrich a GuardrailRequest with tool annotations from the registry.
 *
 * Called by the GuardrailMiddleware before evaluating the provider.
 * When no registry is configured, the request passes through unchanged
 * (the AnnotationProvider falls back to all-false defaults).
 */
export function attachAnnotations(
  request: GuardrailRequest,
  registry: AnnotationRegistry | null,
): GuardrailRequest {
  if (registry === null) {
    return request;
  }
  const annotations = registry.getAnnotations(request.toolName);
  return {
    ...request,
    metadata: {
      ...(request.metadata ?? {}),
      [ANNOTATIONS_METADATA_KEY]: annotations,
    },
  };
}

/**
 * Resolve annotations for a ToolCallRequest (used by the middleware layer
 * when the guardrail middleware needs to read annotations).
 */
export function resolveToolAnnotations(
  toolName: string,
  registry: AnnotationRegistry | null,
): ToolAnnotations {
  if (registry === null) {
    return { ...EMPTY_ANNOTATIONS };
  }
  return registry.getAnnotations(toolName);
}

/** Global process-level annotation registry (set by the composition root). */
let _globalRegistry: AnnotationRegistry | null = null;

/** Set the global annotation registry. */
export function setGlobalAnnotationRegistry(registry: AnnotationRegistry | null): void {
  _globalRegistry = registry;
}

/** Get the global annotation registry (or null if unset). */
export function getGlobalAnnotationRegistry(): AnnotationRegistry | null {
  return _globalRegistry;
}
