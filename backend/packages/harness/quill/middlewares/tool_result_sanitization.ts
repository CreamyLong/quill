/**
 * Tool result sanitization middleware.
 *
 * Sanitizes raw tool output before it reaches the LLM to prevent:
 * - Context pollution from verbose tool outputs
 * - Information leakage (sensitive data, credentials, file paths)
 * - Malformed responses that could break conversation flow
 *
 * Mirrors DeerFlow's `tool_result_sanitization_middleware`.
 */

import type { StructuredToolInterface } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { BaseMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition, ToolCallRequest } from "../agents/factory.js";
import type { ThreadState } from "../agents/thread_state.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ToolResultSanitizationOptions {
  /** Maximum length of tool output before truncation. Default: 10,000 chars. */
  maxOutputLength?: number;
  /** List of tool names to always sanitize (empty = all). */
  sanitizeAll?: boolean;
  /** Sensitive patterns to redact (regex strings). */
  sensitivePatterns?: RegExp[];
  /** Whether to include tool name in truncation markers. */
  includeToolNameInMarker?: boolean;
}

const DEFAULT_MAX_OUTPUT_LENGTH = 10_000;

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

/** Truncate a string to max length with a marker. */
function truncateWithMarker(
  content: string,
  maxLength: number,
  toolName?: string,
): string {
  if (content.length <= maxLength) {
    return content;
  }

  const markerPrefix = toolName
    ? `\n\n[... truncated — ${toolName} output exceeded ${maxLength} chars, showing first 2500 chars ...]\n\n`
    : `\n\n[... truncated — output exceeded ${maxLength} chars, showing first 2500 chars ...]\n\n`;

  const showLength = Math.min(2500, maxLength);
  return content.slice(0, showLength) + markerPrefix;
}

/**
 * Sanitize content by redacting sensitive patterns.
 */
function redactSensitiveContent(
  content: string,
  patterns: RegExp[],
): string {
  if (patterns.length === 0) {
    return content;
  }

  let result = content;
  for (const pattern of patterns) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/**
 * Neutralize empty or invalid content.
 */
function neutralizeContent(content: unknown): string {
  if (content === null || content === undefined) {
    return "";
  }
  if (typeof content === "object" && !Array.isArray(content)) {
    // JSON object — serialize it
    try {
      return JSON.stringify(content);
    } catch {
      return "";
    }
  }
  if (Array.isArray(content)) {
    return JSON.stringify(content);
  }
  return String(content);
}

// ---------------------------------------------------------------------------
// Sanitize tool message
// ---------------------------------------------------------------------------

/**
 * Sanitize a tool message content.
 *
 * This is the main sanitization function. It:
 * 1. Neutralizes empty/invalid content
 * 2. Applies truncation
 * 3. Redacts sensitive patterns
 *
 * @param content — raw tool output
 * @param toolName — optional tool name for context
 * @param options — sanitization options
 */
export function sanitizeToolResult(
  content: unknown,
  toolName?: string,
  options?: ToolResultSanitizationOptions,
): string {
  const {
    maxOutputLength = DEFAULT_MAX_OUTPUT_LENGTH,
    sensitivePatterns = [],
  } = options ?? {};

  const raw = neutralizeContent(content);
  const redacted = redactSensitiveContent(raw, sensitivePatterns);
  const truncated = truncateWithMarker(redacted, maxOutputLength, toolName);

  return truncated;
}

// ---------------------------------------------------------------------------
// Middleware definition
// ---------------------------------------------------------------------------

import type { MiddlewareDefinition, ModelCallRequest, ToolCallRequest } from "../agents/factory.js";

/**
 * Wrap tool call results through sanitization.
 *
 * This middleware wraps tool calls and sanitizes their results before
 * they reach the LLM.
 */
export function toolResultSanitizationMiddleware(
  options?: ToolResultSanitizationOptions,
): MiddlewareDefinition {
  const opts = { ...{ maxOutputLength: DEFAULT_MAX_OUTPUT_LENGTH }, ...options };

  return {
    name: "tool_result_sanitization",

    /** Wrap tool calls to sanitize results before forwarding. */
    wrapToolCall: async (
      request: ToolCallRequest,
      handler: (request: ToolCallRequest) => Promise<BaseMessage | Partial<ThreadState>>,
    ): Promise<BaseMessage | Partial<ThreadState>> => {
      const result = await handler(request);

      if (result instanceof Array) {
        // State update with messages array — sanitize each message
        return {
          ...result,
          messages: result.messages.map((msg) =>
            msg.getType() === "tool" ? sanitizeToolMessage(msg, request.name, opts) : msg,
          ),
        } as unknown as BaseMessage | Partial<ThreadState>;
      }

      if (result && typeof result === "object" && "getType" in result) {
        // Single BaseMessage — sanitize if it's a tool message
        return sanitizeToolMessage(result as BaseMessage, request.name, opts);
      }

      return result;
    },
  };
}

/**
 * Sanitize a single tool message, truncating and redacting as needed.
 */
function sanitizeToolMessage(
  message: BaseMessage,
  toolName?: string,
  options?: ToolResultSanitizationOptions,
): BaseMessage {
  const { maxOutputLength = DEFAULT_MAX_OUTPUT_LENGTH, sensitivePatterns = [] } = options ?? {};

  if (message.getType() !== "tool") {
    return message;
  }

  // Tool messages store content in a `content` field
  const content = (message as unknown as { content?: unknown }).content;
  if (content === undefined || content === null) {
    return message;
  }

  const sanitized = sanitizeToolResult(content, toolName, {
    maxOutputLength,
    sensitivePatterns,
  });

  // Clone the message with sanitized content
  const sanitizedMsg = message.clone ? message.clone() : { ...message };
  (sanitizedMsg as unknown as { content: string }).content = sanitized;

  return sanitizedMsg;
}

// ---------------------------------------------------------------------------
// Built-in sensitive patterns
// ---------------------------------------------------------------------------

/**
 * Common sensitive patterns for redaction.
 */
export const SENSITIVE_PATTERNS: RegExp[] = [
  // API keys (generic patterns)
  /(?:api[_-]?key|apikey|secret|token)\s*[=:]\s*["']?([a-zA-Z0-9_\-]{16,})["']?/gi,
  // File paths (absolute)
  /\/(?:root|home|Users)[\/][a-zA-Z0-9_\-]+/g,
  // Base64-encoded blobs (large base64 strings)
  /[A-Za-z0-9+/]{100,}={0,2}/g,
];

/**
 * Apply default sensitive patterns to a tool result.
 */
export function applyDefaultRedaction(content: string): string {
  return redactSensitiveContent(content, SENSITIVE_PATTERNS);
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

export { ToolResultSanitizationOptions };
