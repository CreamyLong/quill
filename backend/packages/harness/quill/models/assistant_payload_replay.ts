/**
 * Helpers for replaying provider-specific assistant message fields.
 *
 * Several provider adapters need to preserve fields that LangChain stores on the
 * original `AIMessage` but drops when serializing request payloads. This module
 * keeps the assistant-message matching logic shared while letting each provider
 * decide which fields to restore.
 *
 * TS port of `quill.models.assistant_payload_replay`.
 */

import { isAIMessage } from "@langchain/core/messages";
import type { AIMessage, BaseMessage } from "@langchain/core/messages";

/** A serialized assistant/chat payload message (OpenAI/Anthropic wire shape). */
export type PayloadMessage = Record<string, unknown>;

/** Restorer callback: mutates a serialized payload message using the original AIMessage. */
export type AssistantPayloadRestorer = (payloadMsg: PayloadMessage, origMsg: AIMessage) => void;

/**
 * Restore provider-specific fields onto serialized assistant payloads.
 */
export function restoreAssistantPayloads(
  payloadMessages: PayloadMessage[],
  originalMessages: BaseMessage[],
  restore: AssistantPayloadRestorer,
): void {
  if (payloadMessages.length === originalMessages.length) {
    for (let i = 0; i < payloadMessages.length; i++) {
      const payloadMsg = payloadMessages[i];
      const origMsg = originalMessages[i];
      if (payloadMsg.role === "assistant" && isAIMessage(origMsg)) {
        restore(payloadMsg, origMsg as AIMessage);
      }
    }
    return;
  }

  const aiMessages = originalMessages.filter((m): m is AIMessage => isAIMessage(m));
  const assistantPayloads = payloadMessages.filter((m) => m.role === "assistant");
  const usedAiIndexes = new Set<number>();

  assistantPayloads.forEach((payloadMsg, ordinal) => {
    const aiMsg = matchAiMessage(payloadMsg, aiMessages, usedAiIndexes, ordinal);
    if (aiMsg !== null) {
      restore(payloadMsg, aiMsg);
    }
  });
}

/**
 * Copy a provider-specific `additional_kwargs` field onto a payload message.
 */
export function restoreAdditionalKwargsField(payloadMsg: PayloadMessage, origMsg: AIMessage, fieldName: string): void {
  const value = origMsg.additional_kwargs?.[fieldName];
  if (value !== null && value !== undefined) {
    payloadMsg[fieldName] = value;
  }
}

/**
 * Copy provider reasoning content onto a serialized assistant payload.
 */
export function restoreReasoningContent(payloadMsg: PayloadMessage, origMsg: AIMessage): void {
  restoreAdditionalKwargsField(payloadMsg, origMsg, "reasoning_content");
}

function matchAiMessage(
  payloadMsg: PayloadMessage,
  aiMessages: AIMessage[],
  usedAiIndexes: Set<number>,
  fallbackOrdinal: number,
): AIMessage | null {
  const payloadKey = assistantSignature(payloadMsg);
  if (payloadKey !== null) {
    const matches: number[] = [];
    aiMessages.forEach((aiMsg, index) => {
      if (!usedAiIndexes.has(index) && signaturesEqual(aiSignature(aiMsg), payloadKey)) {
        matches.push(index);
      }
    });
    if (matches.length === 1) {
      usedAiIndexes.add(matches[0]);
      return aiMessages[matches[0]];
    }
  }

  const fallbackIndex = nextUnusedIndexAtOrAfter(aiMessages.length, usedAiIndexes, fallbackOrdinal);
  if (fallbackIndex !== null) {
    usedAiIndexes.add(fallbackIndex);
    return aiMessages[fallbackIndex];
  }

  return null;
}

/**
 * Return the next unused AI index at or after `start`.
 *
 * Scanning forward from the payload's ordinal preserves the positional bias of
 * the previous behaviour while still recovering when serialization drops or
 * reorders messages so the exact ordinal index is already taken. It does not
 * wrap to earlier indexes because those messages may be represented by payload
 * entries that were already dropped.
 */
function nextUnusedIndexAtOrAfter(count: number, usedAiIndexes: Set<number>, start: number): number | null {
  if (count === 0 || start >= count) {
    return null;
  }
  for (let index = start; index < count; index++) {
    if (!usedAiIndexes.has(index)) {
      return index;
    }
  }
  return null;
}

function assistantSignature(payloadMsg: PayloadMessage): [string, string] | null {
  return signature(payloadMsg.content, toolCallIds(asArray(payloadMsg.tool_calls)));
}

function aiSignature(message: AIMessage): [string, string] | null {
  const toolCalls = message.tool_calls ?? asArray(message.additional_kwargs?.tool_calls);
  return signature(message.content, toolCallIds(toolCalls));
}

function signature(content: unknown, ids: string[]): [string, string] | null {
  const emptyContent = content === null || content === undefined || content === "";
  if (emptyContent && ids.length === 0) {
    return null;
  }
  return [stableRepr(content), ids.join("|")];
}

function signaturesEqual(a: [string, string] | null, b: [string, string] | null): boolean {
  if (a === null || b === null) {
    return false;
  }
  return a[0] === b[0] && a[1] === b[1];
}

function stableRepr(value: unknown): string {
  try {
    return stableStringify(value);
  } catch {
    return String(value);
  }
}

/** JSON stringify with recursively sorted object keys (mirrors `json.dumps(sort_keys=True)`). */
function stableStringify(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[key] = (val as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return val;
  });
  return serialized === undefined ? String(value) : serialized;
}

function toolCallIds(toolCalls: unknown[]): string[] {
  const ids: string[] = [];
  for (const toolCall of toolCalls) {
    if (toolCall !== null && typeof toolCall === "object" && !Array.isArray(toolCall)) {
      const callId = (toolCall as Record<string, unknown>).id;
      if (typeof callId === "string" && callId) {
        ids.push(callId);
      }
    }
  }
  return ids;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
