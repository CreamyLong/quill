/**
 * Custom vLLM provider built on top of LangChain ChatOpenAI.
 *
 * vLLM exposes reasoning models through an OpenAI-compatible API, but LangChain's
 * default OpenAI adapter drops the non-standard `reasoning` field from assistant
 * messages and streaming deltas. That breaks interleaved thinking/tool-call
 * flows because vLLM expects the assistant's prior reasoning to be echoed back on
 * subsequent turns.
 *
 * This provider preserves `reasoning` on:
 * - non-streaming responses
 * - streaming deltas
 * - multi-turn request payloads
 *
 * TS port of `quill.models.vllm_provider`.
 *
 * Deviation: the Python provider imports `_create_usage_metadata` from
 * `langchain_openai.chat_models.base`, which LangChain-JS does not export — a
 * minimal local stub ({@link createUsageMetadata}) is used instead. The
 * `_get_request_payload` / `_create_chat_result` / `_convert_chunk_to_generation_chunk`
 * override hooks have no LangChain-JS analogue; the logic is preserved as
 * same-named methods operating on already-built outputs.
 */

import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessageChunk,
  ChatMessageChunk,
  FunctionMessageChunk,
  HumanMessageChunk,
  SystemMessageChunk,
  ToolMessageChunk,
  isAIMessage,
} from "@langchain/core/messages";
import type { AIMessage, BaseMessage, BaseMessageChunk } from "@langchain/core/messages";
import type { ToolCallChunk } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import type { ChatResult } from "@langchain/core/outputs";

import type { PayloadMessage } from "./assistant_payload_replay.js";
import type { RequestPayload } from "./patched_openai.js";

type MessageChunkCtor = new (fields: Record<string, unknown>) => BaseMessageChunk;

/**
 * Map Quill's legacy `thinking` toggle to vLLM/Qwen's `enable_thinking`.
 *
 * Quill originally documented `extra_body.chat_template_kwargs.thinking` for
 * vLLM, but vLLM's Qwen reasoning parser reads
 * `chat_template_kwargs.enable_thinking`. Normalize the payload just before it is
 * sent so existing configs keep working and flash mode can truly disable
 * reasoning.
 */
export function normalizeVllmChatTemplateKwargs(payload: RequestPayload): void {
  const extraBody = payload.extra_body;
  if (!isRecord(extraBody)) {
    return;
  }

  const chatTemplateKwargs = extraBody.chat_template_kwargs;
  if (!isRecord(chatTemplateKwargs)) {
    return;
  }

  if (!("thinking" in chatTemplateKwargs)) {
    return;
  }

  const normalized: Record<string, unknown> = { ...chatTemplateKwargs };
  if (!("enable_thinking" in normalized)) {
    normalized.enable_thinking = normalized.thinking;
  }
  delete normalized.thinking;
  extraBody.chat_template_kwargs = normalized;
}

/** Best-effort extraction of readable reasoning text from vLLM payloads. */
export function reasoningToText(reasoning: unknown): string {
  if (typeof reasoning === "string") {
    return reasoning;
  }

  if (Array.isArray(reasoning)) {
    const parts = reasoning.map((item) => reasoningToText(item));
    return parts.filter((part) => part).join("");
  }

  if (isRecord(reasoning)) {
    for (const key of ["text", "content", "reasoning"] as const) {
      const value = reasoning[key];
      if (typeof value === "string") {
        return value;
      }
      if (value !== null && value !== undefined) {
        const text = reasoningToText(value);
        if (text) {
          return text;
        }
      }
    }
    try {
      return JSON.stringify(reasoning);
    } catch {
      return String(reasoning);
    }
  }

  try {
    return JSON.stringify(reasoning);
  } catch {
    return String(reasoning);
  }
}

/** Convert a streaming delta to a LangChain message chunk while preserving reasoning. */
export function convertDeltaToMessageChunkWithReasoning(dict: Record<string, unknown>, defaultClass: MessageChunkCtor): BaseMessageChunk {
  const id = dict.id as string | undefined;
  const role = dict.role as string | undefined;
  const content = typeof dict.content === "string" ? dict.content : dict.content ? String(dict.content) : "";
  const additionalKwargs: Record<string, unknown> = {};

  if (dict.function_call) {
    const functionCall = isRecord(dict.function_call) ? { ...dict.function_call } : {};
    if ("name" in functionCall && functionCall.name === null) {
      functionCall.name = "";
    }
    additionalKwargs.function_call = functionCall;
  }

  const reasoning = dict.reasoning;
  if (reasoning !== null && reasoning !== undefined) {
    additionalKwargs.reasoning = reasoning;
    const reasoningText = reasoningToText(reasoning);
    if (reasoningText) {
      additionalKwargs.reasoning_content = reasoningText;
    }
  }

  let toolCallChunks: ToolCallChunk[] = [];
  const rawToolCalls = dict.tool_calls;
  if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
    try {
      toolCallChunks = rawToolCalls.map((rtc: Record<string, unknown>) => {
        const fn = rtc.function as Record<string, unknown>;
        return {
          name: fn.name as string | undefined,
          args: fn.arguments as string | undefined,
          id: rtc.id as string | undefined,
          index: rtc.index as number,
        };
      });
    } catch {
      toolCallChunks = [];
    }
  }

  if (role === "user" || defaultClass === (HumanMessageChunk as unknown as MessageChunkCtor)) {
    return new HumanMessageChunk({ content, id });
  }
  if (role === "assistant" || defaultClass === (AIMessageChunk as unknown as MessageChunkCtor)) {
    return new AIMessageChunk({ content, additional_kwargs: additionalKwargs, id, tool_call_chunks: toolCallChunks });
  }
  if (role === "system" || role === "developer" || defaultClass === (SystemMessageChunk as unknown as MessageChunkCtor)) {
    const roleKwargs = role === "developer" ? { __openai_role__: "developer" } : {};
    return new SystemMessageChunk({ content, id, additional_kwargs: roleKwargs });
  }
  if (role === "function" || defaultClass === (FunctionMessageChunk as unknown as MessageChunkCtor)) {
    return new FunctionMessageChunk({ content, name: String(dict.name ?? ""), id });
  }
  if (role === "tool" || defaultClass === (ToolMessageChunk as unknown as MessageChunkCtor)) {
    return new ToolMessageChunk({ content, tool_call_id: String(dict.tool_call_id ?? ""), id });
  }
  if (role || defaultClass === (ChatMessageChunk as unknown as MessageChunkCtor)) {
    return new ChatMessageChunk({ content, role: role as string, id });
  }
  return new defaultClass({ content, id });
}

/** Re-inject vLLM reasoning onto outgoing assistant messages. */
export function restoreReasoningField(payloadMsg: PayloadMessage, origMsg: AIMessage): void {
  let reasoning = origMsg.additional_kwargs?.reasoning;
  if (reasoning === null || reasoning === undefined) {
    reasoning = origMsg.additional_kwargs?.reasoning_content;
  }
  if (reasoning !== null && reasoning !== undefined) {
    payloadMsg.reasoning = reasoning;
  }
}

/** ChatOpenAI variant that preserves vLLM reasoning fields across turns. */
export class VllmChatModel extends ChatOpenAI {
  override _llmType(): string {
    return "vllm-openai-compatible";
  }

  /** Restore assistant reasoning in request payloads for interleaved thinking. */
  getRequestPayload(payload: RequestPayload, originalMessages: BaseMessage[]): RequestPayload {
    normalizeVllmChatTemplateKwargs(payload);
    const payloadMessages = asMessages(payload.messages);

    if (payloadMessages.length === originalMessages.length) {
      for (let i = 0; i < payloadMessages.length; i++) {
        const payloadMsg = payloadMessages[i];
        const origMsg = originalMessages[i];
        if (payloadMsg.role === "assistant" && isAIMessage(origMsg)) {
          restoreReasoningField(payloadMsg, origMsg as AIMessage);
        }
      }
    } else {
      const aiMessages = originalMessages.filter((m): m is AIMessage => isAIMessage(m));
      const assistantPayloads = payloadMessages.filter((m) => m.role === "assistant");
      const count = Math.min(assistantPayloads.length, aiMessages.length);
      for (let i = 0; i < count; i++) {
        restoreReasoningField(assistantPayloads[i], aiMessages[i]);
      }
    }

    return payload;
  }

  /** Preserve vLLM reasoning on non-streaming responses. */
  createChatResult(result: ChatResult, response: unknown): ChatResult {
    const responseDict = isRecord(response) ? response : {};
    const choices = Array.isArray(responseDict.choices) ? responseDict.choices : [];

    const count = Math.min(result.generations.length, choices.length);
    for (let i = 0; i < count; i++) {
      const generation = result.generations[i];
      const choice = choices[i];
      const message = generation.message;
      if (!isAIMessage(message)) {
        continue;
      }
      const reasoning = isRecord(choice) && isRecord(choice.message) ? choice.message.reasoning : undefined;
      if (reasoning === null || reasoning === undefined) {
        continue;
      }
      message.additional_kwargs.reasoning = reasoning;
      const reasoningText = reasoningToText(reasoning);
      if (reasoningText) {
        message.additional_kwargs.reasoning_content = reasoningText;
      }
    }

    return result;
  }

  /** Preserve vLLM reasoning on streaming deltas. */
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

    const messageChunk = convertDeltaToMessageChunkWithReasoning(isRecord(delta) ? delta : {}, defaultChunkClass);
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

    if (usageMetadata && messageChunk instanceof AIMessageChunk) {
      messageChunk.usage_metadata = usageMetadata;
    }

    (messageChunk.response_metadata as Record<string, unknown>).model_provider = "openai";
    return new ChatGenerationChunk({
      text: typeof messageChunk.content === "string" ? messageChunk.content : "",
      message: messageChunk,
      generationInfo: Object.keys(generationInfo).length ? generationInfo : undefined,
    });
  }

  private get outputVersionValue(): string | undefined {
    return (this as unknown as { outputVersion?: string }).outputVersion;
  }
}

/** Local stub of `langchain_openai.chat_models.base._create_usage_metadata`. */
export function createUsageMetadata(tokenUsage: Record<string, unknown>, _serviceTier?: unknown): Record<string, unknown> {
  const inputTokens = numberOr(tokenUsage.prompt_tokens, 0);
  const outputTokens = numberOr(tokenUsage.completion_tokens, 0);
  const totalTokens = numberOr(tokenUsage.total_tokens, inputTokens + outputTokens);
  return { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: totalTokens };
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

function asMessages(value: unknown): PayloadMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is PayloadMessage => isRecord(item));
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
