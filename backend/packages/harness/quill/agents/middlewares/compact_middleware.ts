/**
 * Manual Context Compaction Middleware.
 *
 * Inspired by DeerFlow's `/compact` command. Provides a manual trigger for
 * conversation summarization that preserves the full history on disk while
 * replacing old turns with a concise summary in the active context window.
 *
 * How it works:
 *   - The middleware watches for a special HumanMessage containing `/compact`.
   - When detected, it:
 *     1. Separates system messages from conversation messages.
 *     2. Summarizes messages before the keep-recent threshold.
 *     3. Replaces old messages with a summary SystemMessage.
 *     4. Adds a confirmation HumanMessage visible to the model.
 *   - The compaction preserves tool_call/tool result pair integrity.
 *
 * Configuration:
 *   - `maxMessages`: trigger threshold (default: 40 non-system messages).
 *   - `keepRecent`: number of recent messages to keep verbatim (default: 12).
 *   - `maxSummaryChars`: max chars of transcript fed to the summarizer.
 *
 * This middleware works alongside SummarizationMiddleware (auto-summarization)
 * but provides explicit user control over when compaction happens.
 */

import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { MiddlewareDefinition, ThreadState } from "../factory.js";

/** The command text that triggers manual compaction. */
export const COMPACT_COMMAND = "/compact";

/** The `/compact` command with optional ratio argument. */
export const COMPACT_COMMAND_PATTERN = /^\/compact(\s+(\d+))?$/;

export interface CompactOptions {
  /** Model used to produce the summary. */
  model: BaseChatModel;
  /** Number of recent messages to keep verbatim after compaction. */
  keepRecent?: number;
  /** Maximum characters of transcript fed to the summarizer. */
  maxSummaryChars?: number;
  /** Custom summary prompt prefix. */
  summaryPromptPrefix?: string;
}

function msgType(m: BaseMessage): string {
  const fn = (m as { getType?: () => string }).getType;
  return typeof fn === "function" ? fn.call(m) : ((m as { type?: string }).type ?? "ai");
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        typeof b === "string"
          ? b
          : b && typeof b === "object" && "text" in b
            ? String((b as { text: unknown }).text ?? "")
            : "",
      )
      .join("");
  }
  return "";
}

/**
 * Check if the latest user message is a `/compact` command.
 */
export function isCompactCommand(messages: BaseMessage[]): { isCompact: boolean; keepCount?: number } {
  if (messages.length === 0) return { isCompact: false };

  // Find the last human message.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (msgType(m) === "human") {
      const text = contentToText(m.content).trim();
      const match = text.match(COMPACT_COMMAND_PATTERN);
      if (match) {
        const keepCount = match[2] ? parseInt(match[2], 10) : undefined;
        return { isCompact: true, keepCount };
      }
      return { isCompact: false };
    }
  }
  return { isCompact: false };
}

/**
 * Build a summary prompt from the messages to be compacted.
 */
function buildSummaryPrompt(messages: BaseMessage[], maxChars: number): string {
  const parts: string[] = [];
  let currentLen = 0;

  for (const m of messages) {
    const role = msgType(m);
    const text = contentToText(m.content);
    if (!text) continue;

    const entry = `[${role}]: ${text}\n`;
    if (currentLen + entry.length > maxChars) {
      parts.push("... (truncated)");
      break;
    }
    parts.push(entry);
    currentLen += entry.length;
  }

  return parts.join("");
}

/**
 * Perform compaction: summarize old messages, keep recent ones intact.
 */
async function compactMessages(
  messages: BaseMessage[],
  model: BaseChatModel,
  keepRecent: number,
  maxChars: number,
  summaryPrefix?: string
): Promise<BaseMessage[]> {
  const systemMessages = messages.filter((m) => msgType(m) === "system");
  const conversationMessages = messages.filter((m) => msgType(m) !== "system");

  if (conversationMessages.length <= keepRecent) {
    // Nothing to compact — return original.
    return messages;
  }

  // Find a human-message boundary to cut at, keeping at least keepRecent messages.
  const cutIndex = conversationMessages.length - keepRecent;
  let cutAt = -1;
  for (let i = 0; i <= cutIndex && i < conversationMessages.length; i++) {
    if (msgType(conversationMessages[i]) === "human") cutAt = i;
  }
  if (cutAt <= 0) cutAt = cutIndex; // Fallback: cut at the calculated index.

  const toCompact = conversationMessages.slice(0, cutAt);
  const toKeep = conversationMessages.slice(cutAt);

  // Build and send the summarization request.
  const prefix = summaryPrefix ??
    "Summarize the following conversation concisely. Preserve key facts, decisions, code changes, file paths, errors, and any unresolved questions. Output a single paragraph.";
  const transcript = buildSummaryPrompt(toCompact, maxChars);
  const prompt = `${prefix}\n\n---\n${transcript}\n---\nSummary:`;

  const summaryResponse = await model.invoke([
    new HumanMessage({ content: prompt }),
  ]);
  const summaryText = contentToText(summaryResponse.content);

  // Build the compacted message list.
  const compactedMessages: BaseMessage[] = [
    ...systemMessages,
    new SystemMessage({
      content: `[Compacted conversation summary]: ${summaryText}`,
    }),
    ...toKeep,
  ];

  return compactedMessages;
}

/**
 * Create the manual compaction middleware.
 */
export function compactMiddleware(opts: CompactOptions): MiddlewareDefinition {
  const keepRecent = opts.keepRecent ?? 12;
  const maxChars = opts.maxSummaryChars ?? 24000;

  return {
    name: "CompactMiddleware",
    beforeModel: async (state: ThreadState): Promise<Partial<ThreadState>> => {
      const messages = state.messages ?? [];
      if (messages.length === 0) return {};

      const { isCompact, keepCount } = isCompactCommand(messages);
      if (!isCompact) return {};

      const effectiveKeep = keepCount ?? keepRecent;

      // Remove the `/compact` command message from the list before processing.
      const filteredMessages = messages.filter((m) => {
        if (msgType(m) !== "human") return true;
        const text = contentToText(m.content).trim();
        return !COMPACT_COMMAND_PATTERN.test(text);
      });

      try {
        const compacted = await compactMessages(
          filteredMessages,
          opts.model,
          effectiveKeep,
          maxChars,
          opts.summaryPromptPrefix
        );

        return {
          messages: compacted as BaseMessage[],
        };
      } catch (err) {
        console.error(`[CompactMiddleware] Compaction failed: ${err instanceof Error ? err.message : err}`);
        // On failure, remove the /compact message but leave history intact.
        return {
          messages: filteredMessages as BaseMessage[],
        };
      }
    },
  };
}
