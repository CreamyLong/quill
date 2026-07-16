/**
 * Middleware to fix dangling tool calls in message history.
 *
 * Faithful port of Python `DanglingToolCallMiddleware`. A dangling tool call
 * occurs when an AIMessage contains tool_calls but there are no corresponding
 * ToolMessages in the history (e.g. user interruption). This middleware
 * intercepts the model call (`wrapModelCall`) and inserts synthetic error
 * ToolMessages immediately after the offending AIMessage so the LLM receives a
 * well-formed conversation.
 */

import { ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition } from "../factory.js";

// Workaround for issue #2894: keep recovery error details short so the synthetic
// ToolMessage does not echo large or malformed content back to the model.
const MAX_RECOVERY_ERROR_DETAIL_LEN = 500;

interface NormalizedToolCall {
  id?: string | null;
  name: string;
  args: Record<string, unknown>;
  invalid?: boolean;
  error?: unknown;
}

/** Return normalized tool calls from structured fields or raw provider payloads. */
function messageToolCalls(msg: BaseMessage): NormalizedToolCall[] {
  const normalized: NormalizedToolCall[] = [];
  const anyMsg = msg as unknown as Record<string, unknown>;

  const toolCalls = (anyMsg["tool_calls"] as Array<Record<string, unknown>> | undefined) ?? [];
  for (const tc of toolCalls) {
    normalized.push({
      id: tc["id"] as string | undefined,
      name: (tc["name"] as string) ?? "unknown",
      args: (tc["args"] as Record<string, unknown>) ?? {},
    });
  }

  const additionalKwargs = (anyMsg["additional_kwargs"] as Record<string, unknown> | undefined) ?? {};
  const rawToolCalls = (additionalKwargs["tool_calls"] as Array<Record<string, unknown>> | undefined) ?? [];
  if (toolCalls.length === 0) {
    for (const rawTc of rawToolCalls) {
      if (rawTc === null || typeof rawTc !== "object") {
        continue;
      }

      const func = rawTc["function"] as Record<string, unknown> | undefined;
      let name = rawTc["name"] as string | undefined;
      if (!name && func !== undefined && func !== null && typeof func === "object") {
        name = func["name"] as string | undefined;
      }

      let args = (rawTc["args"] as Record<string, unknown>) ?? {};
      if (Object.keys(args).length === 0 && func !== undefined && func !== null && typeof func === "object") {
        const rawArgs = func["arguments"];
        if (typeof rawArgs === "string") {
          let parsedArgs: unknown = {};
          try {
            parsedArgs = JSON.parse(rawArgs);
          } catch {
            parsedArgs = {};
          }
          args =
            parsedArgs !== null && typeof parsedArgs === "object" && !Array.isArray(parsedArgs)
              ? (parsedArgs as Record<string, unknown>)
              : {};
        }
      }

      normalized.push({
        id: (rawTc["id"] as string | undefined) ?? null,
        name: name || "unknown",
        args: args !== null && typeof args === "object" ? args : {},
      });
    }
  }

  const invalidToolCalls = (anyMsg["invalid_tool_calls"] as Array<Record<string, unknown>> | undefined) ?? [];
  for (const invalidTc of invalidToolCalls) {
    if (invalidTc === null || typeof invalidTc !== "object") {
      continue;
    }
    normalized.push({
      id: (invalidTc["id"] as string | undefined) ?? null,
      name: (invalidTc["name"] as string) || "unknown",
      args: {},
      invalid: true,
      error: invalidTc["error"],
    });
  }

  return normalized;
}

function syntheticToolMessageContent(toolCall: NormalizedToolCall): string {
  if (toolCall.invalid) {
    const name = toolCall.name;
    const error = toolCall.error;
    const errorText =
      typeof error === "string" && error ? error.slice(0, MAX_RECOVERY_ERROR_DETAIL_LEN) : "";
    // Workaround for issue #2894: malformed write_file calls can carry huge
    // Markdown payloads in invalid tool-call args.
    if (name === "write_file") {
      const details = errorText ? ` Parser error: ${errorText}` : "";
      return (
        "[write_file failed before execution: the tool-call arguments were not valid JSON, " +
        "so no file was written. This often happens when the model tries to write a very " +
        "large Markdown file in a single tool call, especially when `content` contains " +
        "unescaped quotes, inline JSON, backslashes, or code fences. Do not retry the same " +
        "large `write_file` payload for this artifact; provide the report/content directly " +
        "as normal assistant text in your next response. If a file write is still needed " +
        `later, split the file into smaller sections instead of one large payload.${details}]`
      );
    }
    if (errorText) {
      return `[Tool call could not be executed because its arguments were invalid: ${errorText}]`;
    }
    return "[Tool call could not be executed because its arguments were invalid.]";
  }
  return "[Tool call was interrupted and did not return a result.]";
}

/**
 * Return messages with tool results grouped after their tool-call AIMessage, or
 * null when nothing changed.
 */
function buildPatchedMessages(messages: BaseMessage[]): BaseMessage[] | null {
  const toolMessagesById = new Map<string, ToolMessage[]>();
  for (const msg of messages) {
    if (msg instanceof ToolMessage) {
      const queue = toolMessagesById.get(msg.tool_call_id) ?? [];
      queue.push(msg);
      toolMessagesById.set(msg.tool_call_id, queue);
    }
  }

  const toolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg.getType() !== "ai") {
      continue;
    }
    for (const tc of messageToolCalls(msg)) {
      if (tc.id) {
        toolCallIds.add(tc.id);
      }
    }
  }

  const patched: BaseMessage[] = [];
  let patchCount = 0;
  for (const msg of messages) {
    if (msg instanceof ToolMessage && toolCallIds.has(msg.tool_call_id)) {
      continue;
    }

    patched.push(msg);
    if (msg.getType() !== "ai") {
      continue;
    }

    for (const tc of messageToolCalls(msg)) {
      const tcId = tc.id;
      if (!tcId) {
        continue;
      }

      const queue = toolMessagesById.get(tcId);
      const existingToolMsg = queue && queue.length > 0 ? queue.shift() : undefined;
      if (existingToolMsg !== undefined) {
        patched.push(existingToolMsg);
      } else {
        patched.push(
          new ToolMessage({
            content: syntheticToolMessageContent(tc),
            tool_call_id: tcId,
            name: tc.name,
            status: "error",
          })
        );
        patchCount += 1;
      }
    }
  }

  const unchanged =
    patched.length === messages.length && patched.every((m, i) => m === messages[i]);
  if (unchanged) {
    return null;
  }

  if (patchCount) {
    console.warn(
      `Injecting ${patchCount} placeholder ToolMessage(s) for dangling tool calls`
    );
  }
  return patched;
}

/** Insert placeholder ToolMessages for dangling tool calls before the model. */
export function danglingToolCallMiddleware(): MiddlewareDefinition {
  return {
    name: "DanglingToolCallMiddleware",
    wrapModelCall: async (request, handler) => {
      const patched = buildPatchedMessages(request.messages);
      if (patched !== null) {
        return handler({ messages: patched });
      }
      return handler(request);
    },
  };
}
