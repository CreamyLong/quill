/**
 * Lightweight conversation summarization middleware.
 *
 * A pragmatic port of the Python `QuillSummarizationMiddleware`: when a
 * conversation grows beyond a threshold, the oldest complete turns are replaced
 * with a single concise summary (a SystemMessage) so the model keeps context
 * without an ever-growing prompt.
 *
 * Safety: the cut is taken at a human-message boundary, so a tool_call / tool
 * result pair is never split (which would make OpenAI/Anthropic reject the
 * request). If summarization fails, history is left intact.
 *
 * This middleware is opt-in (the factory treats `features.summarization` as a
 * custom instance): pass `summarizationMiddleware({ model })` to enable it.
 */

import {
  HumanMessage,
  RemoveMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { MiddlewareDefinition, ThreadState } from "../factory.js";

export interface SummarizationOptions {
  /** Model used to produce the summary (typically the same as the agent's). */
  model: BaseChatModel;
  /** Trigger summarization when the non-system message count exceeds this. */
  maxMessages?: number;
  /** Minimum number of most-recent messages to keep verbatim. */
  keepRecent?: number;
  /** Max characters of transcript fed to the summarizer. */
  maxTranscriptChars?: number;
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

export function summarizationMiddleware(opts: SummarizationOptions): MiddlewareDefinition {
  const maxMessages = opts.maxMessages ?? 40;
  const keepRecent = opts.keepRecent ?? 12;
  const maxChars = opts.maxTranscriptChars ?? 24000;

  return {
    name: "SummarizationMiddleware",
    beforeModel: async (state: ThreadState): Promise<Partial<ThreadState>> => {
      const messages = state.messages ?? [];
      const nonSystem = messages.filter((m) => msgType(m) !== "system");
      if (nonSystem.length <= maxMessages) return {};

      // Find the last human-message boundary that still leaves >= keepRecent
      // messages after it. Cutting before a human keeps complete prior turns
      // together (no split tool_call/tool pairs).
      const limit = nonSystem.length - keepRecent;
      let cut = -1;
      for (let i = 0; i <= limit && i < nonSystem.length; i++) {
        if (msgType(nonSystem[i]) === "human") cut = i;
      }
      if (cut <= 0) return {};

      const toSummarize = nonSystem.slice(0, cut);
      // Every message must have an id so we can remove it deterministically.
      if (toSummarize.some((m) => typeof m.id !== "string")) return {};

      const transcript = toSummarize
        .map((m) => `${msgType(m).toUpperCase()}: ${contentToText(m.content)}`)
        .join("\n")
        .slice(0, maxChars);

      let summary: string;
      try {
        const resp = await opts.model.invoke([
          new SystemMessage(
            "You compress conversation history. Summarize the transcript into a concise note that preserves key facts, entities, decisions, tool findings (keep identifiers like doc_id / DOI / url), and any open questions. Output only the note.",
          ),
          new HumanMessage(transcript),
        ]);
        summary = typeof resp.content === "string" ? resp.content : contentToText(resp.content);
      } catch {
        // If the summary call fails, leave the history untouched.
        return {};
      }
      if (!summary.trim()) return {};

      const removals = toSummarize
        .filter((m): m is BaseMessage & { id: string } => typeof m.id === "string")
        .map((m) => new RemoveMessage({ id: m.id }));
      const summaryMsg = new SystemMessage(`[Summary of earlier conversation]\n${summary}`);

      return { messages: [...removals, summaryMsg] };
    },
  };
}
