/**
 * Patched ChatOpenAI that preserves thought_signature for Gemini thinking models.
 *
 * When using Gemini with thinking enabled via an OpenAI-compatible gateway (e.g.
 * Vertex AI, Google AI Studio, or any proxy), the API requires that the
 * `thought_signature` field on tool-call objects is echoed back verbatim in
 * every subsequent request.
 *
 * The OpenAI-compatible gateway stores the raw tool-call dicts (including
 * `thought_signature`) in `additional_kwargs["tool_calls"]`, but standard
 * `ChatOpenAI` only serialises the standard fields (`id`, `type`, `function`)
 * into the outgoing payload, silently dropping the signature. That causes an
 * HTTP 400 `INVALID_ARGUMENT` error:
 *
 *     Unable to submit request because function call `<tool>` in the N. content
 *     block is missing a `thought_signature`.
 *
 * This module fixes the problem by re-injecting tool-call signatures back into
 * the outgoing payload for any assistant message that originally carried them.
 *
 * TS port of `quill.models.patched_openai`.
 *
 * Note: LangChain-JS `ChatOpenAI` does not expose the `_get_request_payload`
 * override hook the Python provider relies on. The signature-restoration logic
 * is preserved here as {@link PatchedChatOpenAI.getRequestPayload} /
 * {@link restoreToolCallSignatures}; wiring it into the request path requires
 * the equivalent JS serialization hook when it becomes available.
 */

import { ChatOpenAI } from "@langchain/openai";
import type { AIMessage, BaseMessage } from "@langchain/core/messages";

import { restoreAssistantPayloads } from "./assistant_payload_replay.js";
import type { PayloadMessage } from "./assistant_payload_replay.js";

/** A serialized request payload (OpenAI wire shape). */
export type RequestPayload = Record<string, unknown>;

/**
 * ChatOpenAI with `thought_signature` preservation for Gemini thinking via OpenAI gateway.
 *
 * Usage in `config.yaml`:
 *
 *     - name: gemini-2.5-pro-thinking
 *       display_name: Gemini 2.5 Pro (Thinking)
 *       use: quill.models.patched_openai:PatchedChatOpenAI
 *       model: google/gemini-2.5-pro-preview
 *       api_key: $GEMINI_API_KEY
 *       base_url: https://<your-openai-compat-gateway>/v1
 *       max_tokens: 16384
 *       supports_thinking: true
 *       supports_vision: true
 *       when_thinking_enabled:
 *         extra_body:
 *           thinking:
 *             type: enabled
 */
export class PatchedChatOpenAI extends ChatOpenAI {
  /**
   * Get request payload with `thought_signature` preserved on tool-call objects.
   *
   * Re-injects `thought_signature` fields on tool-call objects that were stored
   * in `additional_kwargs["tool_calls"]` by LangChain but dropped during
   * serialisation.
   */
  getRequestPayload(payload: RequestPayload, originalMessages: BaseMessage[]): RequestPayload {
    restoreAssistantPayloads(asMessages(payload.messages), originalMessages, restoreToolCallSignatures);
    return payload;
  }
}

/**
 * Re-inject `thought_signature` onto tool-call objects in `payloadMsg`.
 *
 * Matches raw tool-call entries (by `id`, falling back to positional order) and
 * copies the signature back onto the serialised payload entries.
 */
export function restoreToolCallSignatures(payloadMsg: PayloadMessage, origMsg: AIMessage): void {
  const rawToolCalls = asRecordArray(origMsg.additional_kwargs?.tool_calls);
  const payloadToolCalls = asRecordArray(payloadMsg.tool_calls);

  if (rawToolCalls.length === 0 || payloadToolCalls.length === 0) {
    return;
  }

  // Build an id -> raw_tc lookup for efficient matching.
  const rawById = new Map<string, Record<string, unknown>>();
  for (const rawTc of rawToolCalls) {
    const tcId = rawTc.id;
    if (typeof tcId === "string" && tcId) {
      rawById.set(tcId, rawTc);
    }
  }

  payloadToolCalls.forEach((payloadTc, idx) => {
    // Try matching by id first, then fall back to positional.
    let rawTc: Record<string, unknown> | undefined;
    const payloadId = payloadTc.id;
    if (typeof payloadId === "string") {
      rawTc = rawById.get(payloadId);
    }
    if (rawTc === undefined && idx < rawToolCalls.length) {
      rawTc = rawToolCalls[idx];
    }

    if (rawTc === undefined) {
      return;
    }

    // The gateway may use either snake_case or camelCase.
    const sig = rawTc.thought_signature ?? rawTc.thoughtSignature;
    if (sig) {
      payloadTc.thought_signature = sig;
    }
  });
}

function asMessages(value: unknown): PayloadMessage[] {
  return asRecordArray(value);
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item));
}
