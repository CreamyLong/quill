/**
 * Patched ChatOpenAI adapter for MiniMax reasoning output.
 *
 * MiniMax's OpenAI-compatible chat completions API can return structured
 * `reasoning_details` when `extra_body.reasoning_split=true` is enabled.
 * `ChatOpenAI` currently ignores that field, so Quill's frontend never
 * receives reasoning content in the shape it expects.
 *
 * This adapter preserves `reasoning_split` in the request payload and maps the
 * provider-specific reasoning field into `additional_kwargs.reasoning_content`,
 * which Quill already understands.
 *
 * TS port of `quill.models.patched_minimax`.
 *
 * Deviation: the Python provider imports the private helpers
 * `_convert_delta_to_message_chunk` and `_create_usage_metadata` from
 * `langchain_openai.chat_models.base`. LangChain-JS does not export equivalents,
 * so this module ships minimal local reimplementations
 * ({@link convertDeltaToMessageChunk}, {@link createUsageMetadata}). The
 * `_convert_chunk_to_generation_chunk` / `_create_chat_result` override hooks
 * also have no LangChain-JS analogue; the logic is preserved as same-named
 * methods operating on already-built outputs.
 */

import { ChatOpenAI } from "@langchain/openai";
import { AIMessageChunk, isAIMessage } from "@langchain/core/messages";
import type { AIMessage, BaseMessageChunk } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import type { ChatGeneration, ChatResult } from "@langchain/core/outputs";

import type { RequestPayload } from "./patched_openai.js";

const THINK_TAG_RE = /<think>\s*([\s\S]*?)\s*<\/think>/g;

export function extractReasoningText(reasoningDetails: unknown, options: { stripParts?: boolean } = {}): string | null {
  const stripParts = options.stripParts ?? true;
  if (!Array.isArray(reasoningDetails)) {
    return null;
  }

  const parts: string[] = [];
  for (const item of reasoningDetails) {
    if (!isRecord(item)) {
      continue;
    }
    const text = item.text;
    if (typeof text === "string") {
      const normalized = stripParts ? text.trim() : text;
      if (normalized.trim()) {
        parts.push(normalized);
      }
    }
  }

  return parts.length ? parts.join("\n\n") : null;
}

export function stripInlineThinkTags(content: string): [string, string | null] {
  const reasoningParts: string[] = [];
  const cleaned = content
    .replace(THINK_TAG_RE, (_match, group1: string) => {
      const reasoning = group1.trim();
      if (reasoning) {
        reasoningParts.push(reasoning);
      }
      return "";
    })
    .trim();
  const reasoning = reasoningParts.length ? reasoningParts.join("\n\n") : null;
  return [cleaned, reasoning];
}

export function mergeReasoning(...values: (string | null | undefined)[]): string | null {
  const merged: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    const normalized = value.trim();
    if (normalized && !merged.includes(normalized)) {
      merged.push(normalized);
    }
  }
  return merged.length ? merged.join("\n\n") : null;
}

export function withReasoningContent<T extends AIMessage | AIMessageChunk>(
  message: T,
  reasoning: string | null,
  options: { preserveWhitespace?: boolean } = {},
): T {
  if (!reasoning) {
    return message;
  }

  const additionalKwargs = { ...message.additional_kwargs };
  if (options.preserveWhitespace) {
    const existing = additionalKwargs.reasoning_content;
    additionalKwargs.reasoning_content = typeof existing === "string" ? `${existing}${reasoning}` : reasoning;
  } else {
    additionalKwargs.reasoning_content = mergeReasoning(
      typeof additionalKwargs.reasoning_content === "string" ? additionalKwargs.reasoning_content : null,
      reasoning,
    );
  }
  message.additional_kwargs = additionalKwargs;
  return message;
}

/** ChatOpenAI adapter that preserves MiniMax reasoning output. */
export class PatchedChatMiniMax extends ChatOpenAI {
  getRequestPayload(payload: RequestPayload): RequestPayload {
    const extraBody = payload.extra_body;
    if (isRecord(extraBody)) {
      payload.extra_body = { ...extraBody, reasoning_split: true };
    } else {
      payload.extra_body = { reasoning_split: true };
    }
    PatchedChatMiniMax.stripUserMessageNames(payload);
    return payload;
  }

  /**
   * Drop the per-message `name` field from user-role messages.
   *
   * Quill middlewares tag user messages with internal provenance names
   * (`user-input`, `summary`, `loop_warning`, ...). `langchain_openai`
   * serializes those into the OpenAI-compatible request, but MiniMax requires
   * every user-role `name` to be identical and otherwise rejects the request
   * with `invalid params, user name must be consistent (2013)`. MiniMax does not
   * use the per-message author name, so strip it.
   */
  static stripUserMessageNames(payload: RequestPayload): void {
    const messages = payload.messages;
    if (!Array.isArray(messages)) {
      return;
    }
    for (const message of messages) {
      if (isRecord(message) && message.role === "user") {
        delete message.name;
      }
    }
  }

  convertChunkToGenerationChunk(
    chunk: Record<string, unknown>,
    defaultChunkClass: MessageChunkCtor,
    baseGenerationInfo: Record<string, unknown> | null,
  ): ChatGenerationChunk | null {
    if (chunk.type === "content.delta") {
      return null;
    }

    const tokenUsage = chunk.usage;
    const choices = getChoices(chunk);
    const usageMetadata = isRecord(tokenUsage) ? createUsageMetadata(tokenUsage, chunk.service_tier) : null;

    if (choices.length === 0) {
      const message = new defaultChunkClass({ content: "", usage_metadata: usageMetadata ?? undefined });
      const generationChunk = new ChatGenerationChunk({ text: "", message, generationInfo: baseGenerationInfo ?? undefined });
      if (this.outputVersionValue === "v1") {
        generationChunk.message.content = [];
        (generationChunk.message.response_metadata as Record<string, unknown>).output_version = "v1";
      }
      return generationChunk;
    }

    const choice = choices[0];
    const delta = isRecord(choice) ? choice.delta : undefined;
    if (delta === null || delta === undefined) {
      return null;
    }

    const messageChunk = convertDeltaToMessageChunk(isRecord(delta) ? delta : {}, defaultChunkClass);
    const generationInfo: Record<string, unknown> = baseGenerationInfo ? { ...baseGenerationInfo } : {};

    const finishReason = isRecord(choice) ? choice.finish_reason : undefined;
    if (finishReason) {
      generationInfo.finish_reason = finishReason;
      if (chunk.model) {
        generationInfo.model_name = chunk.model;
      }
      if (chunk.system_fingerprint) {
        generationInfo.system_fingerprint = chunk.system_fingerprint;
      }
      if (chunk.service_tier) {
        generationInfo.service_tier = chunk.service_tier;
      }
    }

    const logprobs = isRecord(choice) ? choice.logprobs : undefined;
    if (logprobs) {
      generationInfo.logprobs = logprobs;
    }

    const reasoning = extractReasoningText(isRecord(delta) ? delta.reasoning_details : undefined, { stripParts: false });
    let finalChunk: BaseMessageChunk = messageChunk;
    if (messageChunk instanceof AIMessageChunk) {
      if (usageMetadata) {
        messageChunk.usage_metadata = usageMetadata;
      }
      if (reasoning) {
        finalChunk = withReasoningContent(messageChunk, reasoning, { preserveWhitespace: true });
      }
    }

    (finalChunk.response_metadata as Record<string, unknown>).model_provider = "openai";
    return new ChatGenerationChunk({
      text: typeof finalChunk.content === "string" ? finalChunk.content : "",
      message: finalChunk,
      generationInfo: Object.keys(generationInfo).length ? generationInfo : undefined,
    });
  }

  createChatResult(result: ChatResult, response: unknown): ChatResult {
    const responseDict = isRecord(response) ? response : {};
    const choices = Array.isArray(responseDict.choices) ? responseDict.choices : [];

    const generations: ChatGeneration[] = [];
    result.generations.forEach((generation, index) => {
      const choice = index < choices.length ? choices[index] : {};
      const message = generation.message;
      let nextGeneration = generation;
      if (isAIMessage(message)) {
        const content = typeof message.content === "string" ? message.content : null;
        let cleanedContent = content;
        let inlineReasoning: string | null = null;
        if (typeof content === "string") {
          [cleanedContent, inlineReasoning] = stripInlineThinkTags(content);
        }

        const choiceMessage = isRecord(choice) && isRecord(choice.message) ? choice.message : {};
        const splitReasoning = extractReasoningText(choiceMessage.reasoning_details);
        const mergedReasoning = mergeReasoning(splitReasoning, inlineReasoning);

        const updatedMessage = message as AIMessage;
        if (cleanedContent !== null && cleanedContent !== message.content) {
          updatedMessage.content = cleanedContent;
        }
        if (mergedReasoning) {
          withReasoningContent(updatedMessage, mergedReasoning);
        }

        nextGeneration = {
          text: cleanedContent ?? generation.text,
          message: updatedMessage,
          generationInfo: generation.generationInfo,
        };
      }

      generations.push(nextGeneration);
    });

    return { generations, llmOutput: result.llmOutput };
  }

  private get outputVersionValue(): string | undefined {
    return (this as unknown as { outputVersion?: string }).outputVersion;
  }
}

type MessageChunkCtor = new (fields: Record<string, unknown>) => BaseMessageChunk;

/**
 * Local stub of `langchain_openai.chat_models.base._create_usage_metadata`.
 *
 * Maps OpenAI-completions usage fields to LangChain's usage_metadata shape.
 */
export function createUsageMetadata(tokenUsage: Record<string, unknown>, _serviceTier?: unknown): Record<string, unknown> {
  const inputTokens = numberOr(tokenUsage.prompt_tokens, 0);
  const outputTokens = numberOr(tokenUsage.completion_tokens, 0);
  const totalTokens = numberOr(tokenUsage.total_tokens, inputTokens + outputTokens);
  return { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: totalTokens };
}

/**
 * Local stub of `langchain_openai.chat_models.base._convert_delta_to_message_chunk`.
 *
 * Only the fields Quill relies on are reconstructed; the streaming delta is
 * assumed to be assistant content unless the default chunk class says otherwise.
 */
export function convertDeltaToMessageChunk(delta: Record<string, unknown>, defaultClass: MessageChunkCtor): BaseMessageChunk {
  const content = typeof delta.content === "string" ? delta.content : "";
  const additionalKwargs: Record<string, unknown> = {};
  if (isRecord(delta.function_call)) {
    additionalKwargs.function_call = { ...delta.function_call };
  }
  const role = typeof delta.role === "string" ? delta.role : undefined;
  if (role === "assistant" || defaultClass === (AIMessageChunk as unknown as MessageChunkCtor)) {
    return new AIMessageChunk({ content, additional_kwargs: additionalKwargs });
  }
  return new defaultClass({ content, additional_kwargs: additionalKwargs });
}

function getChoices(chunk: Record<string, unknown>): unknown[] {
  if (Array.isArray(chunk.choices) && chunk.choices.length > 0) {
    return chunk.choices;
  }
  const nested = chunk.chunk;
  if (isRecord(nested) && Array.isArray(nested.choices)) {
    return nested.choices;
  }
  return Array.isArray(chunk.choices) ? chunk.choices : [];
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
