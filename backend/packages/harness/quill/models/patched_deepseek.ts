/**
 * Patched ChatDeepSeek that preserves reasoning_content in multi-turn conversations.
 *
 * The original implementation stores reasoning_content in additional_kwargs but
 * doesn't include it when making subsequent API calls, which causes errors with
 * APIs that require reasoning_content on all assistant messages when thinking
 * mode is enabled.
 *
 * TS port of `quill.models.patched_deepseek`.
 *
 * Deviation: the Python provider extends `langchain_deepseek.ChatDeepSeek`, but
 * `@langchain/deepseek` is not installed. `ChatDeepSeek` is itself a
 * `BaseChatOpenAI` subclass, so this port extends `ChatOpenAI` (DeepSeek exposes
 * an OpenAI-compatible API). Swap the base to `ChatDeepSeek` once the package is
 * available in the TS workspace.
 */

import { ChatOpenAI } from "@langchain/openai";
import type { BaseMessage } from "@langchain/core/messages";

import { restoreAssistantPayloads, restoreReasoningContent } from "./assistant_payload_replay.js";
import type { PayloadMessage } from "./assistant_payload_replay.js";
import type { RequestPayload } from "./patched_openai.js";

/**
 * ChatDeepSeek with proper reasoning_content preservation.
 *
 * When using thinking/reasoning enabled models, the API expects reasoning_content
 * to be present on ALL assistant messages in multi-turn conversations. This
 * patched version ensures reasoning_content from additional_kwargs is included in
 * the request payload.
 */
export class PatchedChatDeepSeek extends ChatOpenAI {
  override lc_serializable = true;

  override get lc_secrets(): Record<string, string> {
    return { api_key: "DEEPSEEK_API_KEY", openai_api_key: "DEEPSEEK_API_KEY" };
  }

  /**
   * Get request payload with reasoning_content preserved.
   *
   * Injects reasoning_content from additional_kwargs into assistant messages in
   * the payload.
   */
  getRequestPayload(payload: RequestPayload, originalMessages: BaseMessage[]): RequestPayload {
    restoreAssistantPayloads(asMessages(payload.messages), originalMessages, restoreReasoningContent);
    return payload;
  }
}

function asMessages(value: unknown): PayloadMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is PayloadMessage => item !== null && typeof item === "object" && !Array.isArray(item));
}
