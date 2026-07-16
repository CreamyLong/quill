/**
 * Patched ChatOpenAI adapter for StepFun reasoning models.
 *
 * StepFun returns `reasoning` (or `reasoning_content` with deepseek-style) in
 * both streaming deltas and non-streaming responses. Standard `ChatOpenAI`
 * ignores these non-standard fields, so reasoning content is silently dropped.
 * This adapter captures reasoning from all response paths and replays it on
 * historical assistant messages for multi-turn tool-call conversations.
 *
 * TS port of `quill.models.patched_stepfun`.
 *
 * Note: LangChain-JS `ChatOpenAI` lacks the `_get_request_payload`,
 * `_convert_chunk_to_generation_chunk`, and `_create_chat_result` hooks the
 * Python base exposes. The reasoning-capture logic is preserved here as the
 * exported helpers and same-named methods, operating on already-built outputs.
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

/**
 * Return reasoning content from a dict/object.
 *
 * StepFun may return reasoning via `reasoning` (default) or `reasoning_content`
 * (deepseek-style). Check both fields.
 */
export function extractReasoning(value: unknown): unknown {
  if (isRecord(value)) {
    // Check reasoning_content first (deepseek-style), then reasoning (default).
    for (const field of ["reasoning_content", "reasoning"] as const) {
      if (field in value && value[field] !== null && value[field] !== undefined) {
        return value[field];
      }
    }
    const modelExtra = value.model_extra;
    if (isRecord(modelExtra)) {
      for (const field of ["reasoning_content", "reasoning"] as const) {
        if (field in modelExtra && modelExtra[field] !== null && modelExtra[field] !== undefined) {
          return modelExtra[field];
        }
      }
    }
    return MISSING;
  }
  return MISSING;
}

/**
 * Return `message` with reasoning_content stored in additional_kwargs.
 *
 * Python returns an immutable copy via `model_copy`; this port mutates
 * `additional_kwargs` in place for an equivalent serialized payload.
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

/**
 * ChatOpenAI with full reasoning support for StepFun models.
 *
 * Captures `reasoning` / `reasoning_content` from both streaming and
 * non-streaming responses and replays it on historical assistant messages in
 * multi-turn tool-call conversations.
 */
export class PatchedChatStepFun extends ChatOpenAI {
  override lc_serializable = true;

  override get lc_secrets(): Record<string, string> {
    return { api_key: "STEPFUN_API_KEY", openai_api_key: "STEPFUN_API_KEY" };
  }

  // --- Request payload replay ---

  /** Restore `reasoning_content` on historical assistant messages. */
  getRequestPayload(payload: RequestPayload, originalMessages: BaseMessage[]): RequestPayload {
    restoreAssistantPayloads(asMessages(payload.messages), originalMessages, restoreReasoningContent);
    return payload;
  }

  // --- Streaming reasoning capture ---

  /** Capture `reasoning` / `reasoning_content` from streaming deltas. */
  convertChunkToGenerationChunk(generationChunk: ChatGenerationChunk | null, chunk: Record<string, unknown>): ChatGenerationChunk | null {
    if (generationChunk === null) {
      return null;
    }

    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    if (choices.length > 0) {
      const delta = isRecord(choices[0]) && isRecord(choices[0].delta) ? choices[0].delta : {};
      const reasoning = extractReasoning(delta);
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

  // --- Non-streaming reasoning capture ---

  /** Extract `reasoning` / `reasoning_content` from non-streaming responses. */
  createChatResult(result: ChatResult, response: unknown): ChatResult {
    const responseDict = isRecord(response) ? response : {};
    const choices = Array.isArray(responseDict.choices) ? responseDict.choices : [];

    let patchedGenerations: ChatGeneration[] | null = null;
    result.generations.forEach((generation, index) => {
      const choice = index < choices.length ? choices[index] : {};
      const choiceMessage = isRecord(choice) && isRecord(choice.message) ? choice.message : {};
      let reasoning = extractReasoning(choiceMessage);

      if (reasoning === MISSING && !isRecord(response)) {
        reasoning = extractReasoning(getTypedChoiceMessage(response, index));
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
