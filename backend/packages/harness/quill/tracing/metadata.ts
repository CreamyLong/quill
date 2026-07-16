/**
 * Langfuse trace-attribute metadata builders.
 *
 * Mirrors `quill.tracing.metadata` from the Python backend.
 *
 * The Langfuse v4 langchain CallbackHandler lifts a fixed set of reserved keys
 * from the runnable config metadata onto the root trace.
 */

import { getEnabledTracingProviders } from "../config/tracing_config.js";
import { DEFAULT_USER_ID } from "../runtime/user_context.js";

const DEFAULT_TRACE_NAME = "lead-agent";

export interface LangfuseTraceMetadataOptions {
  threadId: string | null;
  userId?: string | null;
  assistantId?: string | null;
  modelName?: string | null;
  environment?: string | null;
}

/**
 * Return Langfuse trace-attribute metadata for the runnable config metadata.
 *
 * Returns `{}` when Langfuse is not in the enabled tracing providers so callers
 * can unconditionally merge the result.
 */
export function buildLangfuseTraceMetadata(options: LangfuseTraceMetadataOptions): Record<string, unknown> {
  if (!getEnabledTracingProviders().includes("langfuse")) {
    return {};
  }

  const metadata: Record<string, unknown> = {
    langfuse_session_id: options.threadId,
    langfuse_user_id: options.userId || DEFAULT_USER_ID,
    langfuse_trace_name: options.assistantId || DEFAULT_TRACE_NAME,
  };

  const tags: string[] = [];
  if (options.environment) {
    tags.push(`env:${options.environment}`);
  }
  if (options.modelName) {
    tags.push(`model:${options.modelName}`);
  }
  if (tags.length > 0) {
    metadata.langfuse_tags = tags;
  }

  return metadata;
}

export interface InjectLangfuseMetadataOptions extends LangfuseTraceMetadataOptions {
  /** The runnable config to mutate in place. */
  config: Record<string, unknown>;
}

/**
 * Merge Langfuse trace-attribute metadata into `config.metadata`.
 *
 * Caller-supplied metadata wins (setdefault semantics). The `config` object is
 * mutated in place; the call is a no-op when Langfuse is not enabled.
 */
export function injectLangfuseMetadata(options: InjectLangfuseMetadataOptions): void {
  const { config } = options;
  const langfuseMetadata = buildLangfuseTraceMetadata({
    threadId: options.threadId,
    userId: options.userId,
    assistantId: options.assistantId,
    modelName: options.modelName,
    environment: options.environment,
  });
  if (Object.keys(langfuseMetadata).length === 0) {
    return;
  }

  const mergedMetadata: Record<string, unknown> = { ...((config.metadata as Record<string, unknown> | undefined) ?? {}) };
  for (const [key, value] of Object.entries(langfuseMetadata)) {
    if (!(key in mergedMetadata)) {
      mergedMetadata[key] = value;
    }
  }
  config.metadata = mergedMetadata;
}
