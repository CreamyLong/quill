/**
 * Middleware that promotes `present_files` tool results into state.artifacts.
 */

import { ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition } from "../factory.js";
import type { ThreadState } from "../thread_state.js";

function extractPresentedFiles(message: BaseMessage): string[] | null {
  if (!(message instanceof ToolMessage) || message.name !== "present_files") {
    return null;
  }
  try {
    const parsed = JSON.parse(String(message.content ?? "{}")) as Record<string, unknown>;
    if (!parsed.ok || !Array.isArray(parsed.presented_files)) {
      return null;
    }
    return parsed.presented_files.filter((p): p is string => typeof p === "string");
  } catch {
    return null;
  }
}

function getLastAssistantMessage(messages: BaseMessage[]): BaseMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.getType() === "ai") {
      return msg;
    }
  }
  return null;
}

/** Promote files presented by the model into the artifacts list. */
export function presentFilesMiddleware(): MiddlewareDefinition {
  return {
    name: "PresentFilesMiddleware",
    afterAgent: (state: ThreadState) => {
      const messages = state.messages ?? [];
      if (messages.length === 0) {
        return {};
      }
      const lastAssistant = getLastAssistantMessage(messages);
      if (!lastAssistant) {
        return {};
      }
      const assistantIdx = messages.indexOf(lastAssistant);
      const artifacts: string[] = [];
      const seen = new Set<string>();
      for (const msg of messages.slice(assistantIdx + 1)) {
        const files = extractPresentedFiles(msg);
        if (files !== null) {
          for (const f of files) {
            if (!seen.has(f)) {
              seen.add(f);
              artifacts.push(f);
            }
          }
        }
      }
      if (artifacts.length === 0) {
        return {};
      }
      return { artifacts };
    },
  };
}
