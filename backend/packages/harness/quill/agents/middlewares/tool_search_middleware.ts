/**
 * Middleware that turns `tool_search` results into promoted deferred tools.
 *
 * Works with `deferredToolFilterMiddleware`. After each tool-execution step it
 * scans the latest tool messages for `tool_search` outputs, parses the returned
 * `promoted` names, and writes them into `state.promoted` (scoped by catalog
 * hash) so the deferred filter exposes those tool schemas on the next turn.
 */

import type { BaseMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition, ToolCall } from "../factory.js";
import type { ThreadState } from "../thread_state.js";

function extractPromotedNames(content: unknown): string[] {
  if (typeof content !== "string") return [];
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) return [];
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const promoted = parsed.promoted;
    if (Array.isArray(promoted)) {
      return promoted.filter((name): name is string => typeof name === "string");
    }
  } catch {
    // ignore malformed JSON
  }
  return [];
}

function findLastAiToolCallMessages(messages: BaseMessage[]): BaseMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.getType() === "ai") {
      const toolCalls = ((msg as unknown as { tool_calls?: ToolCall[] }).tool_calls ?? []).filter(
        (tc): tc is ToolCall => typeof tc?.id === "string" && typeof tc?.name === "string"
      );
      if (toolCalls.length === 0) return [];
      const ids = new Set(toolCalls.map((tc) => tc.id));
      const toolMessages: BaseMessage[] = [];
      for (let j = i + 1; j < messages.length; j++) {
        const tm = messages[j];
        if (tm.getType() !== "tool") break;
        const tcid = (tm as unknown as { tool_call_id?: unknown }).tool_call_id;
        if (typeof tcid === "string" && ids.has(tcid)) {
          toolMessages.push(tm);
        }
      }
      return toolMessages;
    }
  }
  return [];
}

/** Promote deferred tools returned by `tool_search`. */
export function toolSearchMiddleware(
  deferredNames: ReadonlySet<string> | Iterable<string>,
  catalogHash: string
): MiddlewareDefinition {
  const deferred = new Set(deferredNames);
  return {
    name: "ToolSearchMiddleware",
    afterAgent: (state: ThreadState): Partial<ThreadState> | void => {
      const toolMessages = findLastAiToolCallMessages(state.messages ?? []);
      if (toolMessages.length === 0) return {};

      const promoted = new Set<string>();
      for (const tm of toolMessages) {
        const names = extractPromotedNames(tm.content);
        for (const name of names) {
          if (deferred.has(name)) {
            promoted.add(name);
          }
        }
      }

      if (promoted.size === 0) return {};
      return {
        promoted: {
          catalog_hash: catalogHash,
          names: Array.from(promoted),
        },
      };
    },
  };
}
