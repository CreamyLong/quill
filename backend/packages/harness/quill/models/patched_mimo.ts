/**
 * Patched ChatOpenAI adapter for Xiaomi MiMo reasoning_content replay.
 *
 * MiMo's OpenAI-compatible API returns `reasoning_content` in thinking mode and
 * requires that value to be replayed on historical assistant messages in
 * multi-turn agent conversations. Standard `ChatOpenAI` drops that
 * provider-specific field, which can cause HTTP 400 errors once tool calls enter
 * the conversation history.
 *
 * TS port of `quill.models.patched_mimo`.
 *
 * Note: LangChain-JS `ChatOpenAI` does not expose the `_get_request_payload`,
 * `_convert_chunk_to_generation_chunk`, or `_create_chat_result` override hooks
 * of the Python base. The reasoning-capture logic is preserved here as the
 * exported helpers and the same-named methods, which operate on already-built
 * LangChain outputs; wire them via the equivalent JS hooks when available.
 */

import { ChatOpenAI } from "@langchain/openai";
import { AIMessageChunk, isAIMessage, isAIMessageChunk } from "@langchain/core/messages";
import type { AIMessage, BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import type { ChatGeneration, ChatResult } from "@langchain/core/outputs";

import { restoreAssistantPayloads, restoreReasoningContent } from "./assistant_payload_replay.js";
import type { PayloadMessage } from "./assistant_payload_replay.js";
import type { RequestPayload } from "./patched_openai.js";

/** Sentinel marking an absent reasoning value (mirrors Python's `_MISSING`). */
const MISSING = Symbol("missing");

/** Return reasoning_content from a dict/object, preserving empty strings. */
export function extractReasoningContent(value: unknown): unknown {
  if (isRecord(value)) {
    if ("reasoning_content" in value && value.reasoning_content !== null && value.reasoning_content !== undefined) {
      return value.reasoning_content;
    }
    const modelExtra = value.model_extra;
    if (isRecord(modelExtra) && modelExtra.reasoning_content !== null && modelExtra.reasoning_content !== undefined) {
      return modelExtra.reasoning_content;
    }
    return MISSING;
  }
  return MISSING;
}

/**
 * Store `reasoning` in `additional_kwargs`.
 *
 * Python returns an immutable copy via `model_copy`; this port mutates
 * `additional_kwargs` in place, which yields an equivalent serialized payload.
 */
export function withReasoningContent<T extends AIMessage | AIMessageChunk>(message: T, reasoning: unknown): T {
  const additionalKwargs = { ...message.additional_kwargs };
  if (additionalKwargs.reasoning_content !== reasoning) {
    additionalKwargs.reasoning_content = reasoning;
  }
  message.additional_kwargs = additionalKwargs;
  return message;
}

function getTypedChoiceMessage(response: unknown, index: number): unknown {
  if (!isRecord(response) || !Array.isArray(response.choices)) {
    return null;
  }
  const choice = response.choices[index];
  if (isRecord(choice)) {
    return choice.message ?? null;
  }
  return null;
}

/** ChatOpenAI with `reasoning_content` preservation for MiMo thinking mode. */
export class PatchedChatMiMo extends ChatOpenAI {
  override lc_serializable = true;

  override get lc_secrets(): Record<string, string> {
    return { api_key: "MIMO_API_KEY", openai_api_key: "MIMO_API_KEY" };
  }

  getRequestPayload(payload: RequestPayload, originalMessages: BaseMessage[]): RequestPayload {
    restoreAssistantPayloads(asMessages(payload.messages), originalMessages, restoreReasoningContent);
    return payload;
  }

  convertChunkToGenerationChunk(generationChunk: ChatGenerationChunk | null, chunk: Record<string, unknown>): ChatGenerationChunk | null {
    if (generationChunk === null) {
      return null;
    }

    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    if (choices.length > 0) {
      const delta = isRecord(choices[0]) && isRecord(choices[0].delta) ? choices[0].delta : {};
      const reasoning = extractReasoningContent(delta);
      if (reasoning !== MISSING && isAIMessageChunk(generationChunk.message)) {
        return new ChatGenerationChunk({
          text: generationChunk.text,
          message: withReasoningContent(generationChunk.message as AIMessageChunk, reasoning),
          generationInfo: generationChunk.generationInfo,
        });
      }
    }

    return generationChunk;
  }

  createChatResult(result: ChatResult, response: unknown): ChatResult {
    const responseDict = isRecord(response) ? response : {};
    const choices = Array.isArray(responseDict.choices) ? responseDict.choices : [];

    let patchedGenerations: ChatGeneration[] | null = null;
    result.generations.forEach((generation, index) => {
      const choice = index < choices.length ? choices[index] : {};
      const choiceMessage = isRecord(choice) && isRecord(choice.message) ? choice.message : {};
      let reasoning = extractReasoningContent(choiceMessage);
      if (reasoning === MISSING && !isRecord(response)) {
        reasoning = extractReasoningContent(getTypedChoiceMessage(response, index));
      }

      const message = generation.message;
      if (reasoning !== MISSING && isAIMessage(message)) {
        if (patchedGenerations === null) {
          patchedGenerations = [...result.generations];
        }
        patchedGenerations[index] = {
          text: generation.text,
          message: withReasoningContent(message as AIMessage, reasoning),
          generationInfo: generation.generationInfo,
        };
      }
    });

    return { generations: patchedGenerations ?? result.generations, llmOutput: result.llmOutput };
  }
}

function asMessages(value: unknown): PayloadMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is PayloadMessage => isRecord(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
