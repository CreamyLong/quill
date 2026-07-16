/**
 * Middleware for automatic thread title generation.
 *
 * Faithful port of Python `TitleMiddleware`. After the first complete exchange
 * (one user message + one assistant response) it derives a short title.
 *
 * Deviations / dependency notes (report):
 * - Python's `create_chat_model` (quill.models) is not ported. An optional
 *   `createChatModel` factory can be injected to enable the LLM-generated title;
 *   without it the middleware uses the local fallback (matching Python's sync
 *   `after_model`, which never blocks on an LLM call).
 * - The `RunnableConfig`/tracing plumbing (`get_config`, `TAG_NOSTREAM`) has no
 *   TS analogue and is omitted.
 */

import type { BaseMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition } from "../factory.js";
import type { ThreadState } from "../thread_state.js";
import { getTitleConfig, type TitleConfig } from "../../config/title_config.js";
import { isDynamicContextReminder } from "./dynamic_context_middleware.js";

/** Minimal chat-model shape needed for async title generation. */
interface ChatModelLike {
  invoke(input: string): Promise<{ content: unknown }>;
}

export interface TitleMiddlewareOptions {
  /** Explicit title config; defaults to the global `getTitleConfig()`. */
  titleConfig?: TitleConfig;
  /** Factory producing a chat model for LLM-based titles (optional). */
  createChatModel?: (name: string | null) => ChatModelLike;
}

function normalizeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content.map((item) => normalizeContent(item));
    return parts.filter((part) => part).join("\n");
  }
  if (content !== null && typeof content === "object") {
    const textValue = (content as Record<string, unknown>)["text"];
    if (typeof textValue === "string") {
      return textValue;
    }
    const nestedContent = (content as Record<string, unknown>)["content"];
    if (nestedContent !== undefined && nestedContent !== null) {
      return normalizeContent(nestedContent);
    }
  }
  return "";
}

function isUserMessageForTitle(message: BaseMessage): boolean {
  return message.getType() === "human" && !isDynamicContextReminder(message);
}

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/** Python `str.format`-style substitution for the title prompt template. */
function formatPrompt(
  template: string,
  values: { max_words: number; user_msg: string; assistant_msg: string }
): string {
  return template
    .replace(/\{max_words\}/g, String(values.max_words))
    .replace(/\{user_msg\}/g, values.user_msg)
    .replace(/\{assistant_msg\}/g, values.assistant_msg);
}

function shouldGenerateTitle(state: ThreadState, config: TitleConfig): boolean {
  if (!config.enabled) {
    return false;
  }
  if (state.title) {
    return false;
  }
  const messages = state.messages ?? [];
  if (messages.length < 2) {
    return false;
  }
  const userMessages = messages.filter((m) => isUserMessageForTitle(m));
  const assistantMessages = messages.filter((m) => m.getType() === "ai");
  return userMessages.length === 1 && assistantMessages.length >= 1;
}

/** Extract user/assistant messages and build the title prompt + user fallback. */
function buildTitlePrompt(state: ThreadState, config: TitleConfig): [string, string] {
  const messages = state.messages ?? [];
  const userMsgContent = messages.find((m) => isUserMessageForTitle(m))?.content ?? "";
  const assistantMsgContent = messages.find((m) => m.getType() === "ai")?.content ?? "";

  const userMsg = normalizeContent(userMsgContent);
  const assistantMsg = stripThinkTags(normalizeContent(assistantMsgContent));

  const prompt = formatPrompt(config.promptTemplate, {
    max_words: config.maxWords,
    user_msg: userMsg.slice(0, 500),
    assistant_msg: assistantMsg.slice(0, 500),
  });
  return [prompt, userMsg];
}

function parseTitle(content: unknown, config: TitleConfig): string {
  let titleContent = normalizeContent(content);
  titleContent = stripThinkTags(titleContent);
  const title = titleContent.trim().replace(/^["']+|["']+$/g, "");
  return title.length > config.maxChars ? title.slice(0, config.maxChars) : title;
}

function fallbackTitle(userMsg: string, config: TitleConfig): string {
  const fallbackChars = Math.min(config.maxChars, 50);
  if (userMsg.length > fallbackChars) {
    return userMsg.slice(0, fallbackChars).replace(/\s+$/, "") + "...";
  }
  return userMsg ? userMsg : "New Conversation";
}

/** Automatically generate a title for the thread after the first exchange. */
export function titleMiddleware(options: TitleMiddlewareOptions = {}): MiddlewareDefinition {
  const getConfig = (): TitleConfig => options.titleConfig ?? getTitleConfig();

  return {
    name: "TitleMiddleware",
    afterModel: async (state: ThreadState): Promise<Partial<ThreadState>> => {
      const config = getConfig();
      if (!shouldGenerateTitle(state, config)) {
        return {};
      }

      const [prompt, userMsg] = buildTitlePrompt(state, config);

      // Without an injected model factory, mirror Python's sync fallback path.
      if (options.createChatModel === undefined) {
        return { title: fallbackTitle(userMsg, config) };
      }

      try {
        const model = options.createChatModel(config.modelName);
        const response = await model.invoke(prompt);
        const title = parseTitle(response.content, config);
        if (title) {
          return { title };
        }
      } catch {
        console.debug("Failed to generate title; falling back to local title");
      }
      return { title: fallbackTitle(userMsg, config) };
    },
  };
}

// Exposed for testing / reuse.
export { fallbackTitle, parseTitle, stripThinkTags };
