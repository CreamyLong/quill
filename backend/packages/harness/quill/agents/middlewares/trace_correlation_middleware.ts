/**
 * Trace Correlation ID Middleware.
 *
 * Inspired by DeerFlow's trace correlation IDs and the awesome-harness-engineering
 * best practice of propagating observability context across agent boundaries.
 *
 * Generates and propagates a unique trace ID (X-Trace-Id) that follows a run
 * across:
 *   - The main agent loop
 *   - Subagent delegations (task tool calls)
 *   - Background memory/scheduling threads
 *   - SSE event streams
 *
 * The trace ID is:
 *   - Generated once per top-level run (not per model call)
 *   - Injected into the run's config metadata
 *   - Propagated to subagents via the task tool's run config
 *   - Returned in HTTP response headers (X-Trace-Id)
 *   - Included in all structured log lines for the run
 *
 * Format: `q-<8-char-random>` (e.g., `q-a1b2c3d4`) — short, URL-safe, sortable.
 */

import { randomBytes } from "node:crypto";
import type { BaseMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition, ThreadState } from "../factory.js";

// ---------------------------------------------------------------------------
// Trace ID generation and propagation
// ---------------------------------------------------------------------------

/** Generate a new short trace ID. */
export function generateTraceId(): string {
  return `q-${randomBytes(4).toString("hex")}`;
}

/**
 * Extract an existing trace ID from thread state or config metadata.
 * Returns undefined if none is set.
 */
export function getTraceId(state: ThreadState): string | undefined {
  // Check state metadata first.
  const fromState = (state as Record<string, unknown>)._trace_id as string | undefined;
  if (fromState) return fromState;

  // Check config metadata.
  const config = (state as Record<string, unknown>)._config as Record<string, unknown> | undefined;
  const metadata = (config?.metadata ?? {}) as Record<string, unknown>;
  const fromConfig = metadata.trace_id as string | undefined;
  return fromConfig;
}

/**
 * Set the trace ID in thread state.
 */
export function setTraceId(state: ThreadState, traceId: string): Partial<ThreadState> {
  return {
    ...(state as unknown as Record<string, unknown>),
    _trace_id: traceId,
  } as unknown as Partial<ThreadState>;
}

/**
 * Inject the trace ID into a model request's metadata.
 * Used by the before_model hook to make the trace visible to callbacks/tracers.
 */
export function injectTraceIntoMetadata(
  state: ThreadState,
  traceId: string
): Record<string, unknown> {
  const config = (state as Record<string, unknown>)._config as Record<string, unknown> | undefined;
  const existingMetadata = (config?.metadata ?? {}) as Record<string, unknown>;
  return {
    ...existingMetadata,
    trace_id: traceId,
  };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export interface TraceCorrelationOptions {
  /**
   * Header name for the trace ID in HTTP responses.
   * Default: "X-Trace-Id".
   */
  headerName?: string;
  /**
   * Whether to inject the trace ID into LangChain callback metadata.
   * This makes the trace visible in LangSmith/Langfuse traces.
   * Default: true.
   */
  injectIntoCallbacks?: boolean;
}

/**
 * Create the trace correlation middleware.
 *
 * This middleware:
 * 1. Generates a trace ID on the first model call of a run (if not already set).
 * 2. Propagates it to subsequent model calls within the same run.
 * 3. Injects it into callback metadata for observability tools.
 */
export function traceCorrelationMiddleware(
  options: TraceCorrelationOptions = {}
): MiddlewareDefinition {
  const headerName = options.headerName ?? "X-Trace-Id";
  const injectCallbacks = options.injectIntoCallbacks ?? true;

  return {
    name: "TraceCorrelationMiddleware",
    beforeModel: (state: ThreadState): Partial<ThreadState> => {
      const existingId = getTraceId(state);

      if (existingId) {
        // Trace already established — ensure it's in callback metadata.
        if (injectCallbacks) {
          const config = (state as Record<string, unknown>)._config as Record<string, unknown> | undefined;
          if (config) {
            return {
              _config: {
                ...config,
                metadata: injectTraceIntoMetadata(state, existingId),
              },
            } as Partial<ThreadState>;
          }
        }
        return {};
      }

      // First model call in this run — generate a new trace ID.
      const traceId = generateTraceId();
      console.trace = console.trace; // no-op to keep trace reference

      const updates: Record<string, unknown> = { _trace_id: traceId };

      if (injectCallbacks) {
        const config = (state as Record<string, unknown>)._config as Record<string, unknown> | undefined;
        updates._config = {
          ...(config ?? {}),
          metadata: {
            ...((config?.metadata as Record<string, unknown>) ?? {}),
            trace_id: traceId,
          },
        };
      }

      return updates as Partial<ThreadState>;
    },
  };
}

/**
 * Helper to format a log prefix with the trace ID.
 * Usage: console.log(formatTraceLogPrefix(traceId), "message");
 */
export function formatTraceLogPrefix(traceId: string | undefined): string {
  return traceId ? `[trace=${traceId}]` : "[trace=none]";
}

/**
 * Build a subagent run config that inherits the parent's trace ID.
 * Used by the task tool to propagate tracing context.
 */
export function buildSubagentTraceConfig(
  parentTraceId: string,
  subagentName: string
): { metadata: Record<string, unknown> } {
  return {
    metadata: {
      trace_id: parentTraceId,
      parent_trace_id: parentTraceId,
      subagent_name: subagentName,
    },
  };
}
