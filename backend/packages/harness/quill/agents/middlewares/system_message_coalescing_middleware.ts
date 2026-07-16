/**
 * Middleware to coalesce multiple SystemMessages into a single leading one.
 *
 * Strict OpenAI-compatible backends reject non-leading SystemMessages. This
 * middleware merges every SystemMessage in the request into one leading
 * SystemMessage before the model call, without touching persisted state.
 */

import { SystemMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition, ModelRequest } from "../factory.js";
import { isDynamicContextReminder } from "./dynamic_context_middleware.js";

function flattenContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (
        typeof item === "object" &&
        item !== null &&
        "text" in item
      ) {
        parts.push(String((item as Record<string, unknown>).text));
      } else {
        parts.push(String(item));
      }
    }
    return parts.join("\n");
  }
  return String(content);
}

function coalesceMessages(messages: BaseMessage[]): BaseMessage[] {
  const systemIndices: number[] = [];
  messages.forEach((m, i) => {
    if (m.getType() === "system") {
      systemIndices.push(i);
    }
  });
  if (systemIndices.length <= 1) {
    return messages;
  }

  let parts = systemIndices.map((i) => messages[i]);

  // Deduplicate dynamic-context reminders: only keep the last one.
  const reminderIndices = parts
    .map((m, i) => (isDynamicContextReminder(m) ? i : -1))
    .filter((i) => i >= 0);
  if (reminderIndices.length > 1) {
    const keepLast = reminderIndices[reminderIndices.length - 1];
    parts = parts.filter((_, i) => i === keepLast || !isDynamicContextReminder(parts[i]));
  }

  const first = parts[0];
  const mergedKwargs: Record<string, unknown> = {};
  for (const p of parts) {
    Object.assign(mergedKwargs, p.additional_kwargs ?? {});
  }

  const merged = new SystemMessage({
    content: parts.map((p) => flattenContent(p.content)).join("\n\n"),
    id: first.id,
    additional_kwargs: mergedKwargs,
  });

  const nonSystem = messages.filter((m) => m.getType() !== "system");
  return [merged, ...nonSystem];
}

/** Merge all SystemMessages into a single leading SystemMessage. */
export function systemMessageCoalescingMiddleware(): MiddlewareDefinition {
  return {
    name: "SystemMessageCoalescingMiddleware",
    wrapModelCall: async (request, handler) => {
      return handler({ ...request, messages: coalesceMessages(request.messages) });
    },
  };
}
