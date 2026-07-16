/**
 * Pure functions to convert LangChain message objects to OpenAI Chat Completions format.
 *
 * Utility for translating LangChain message types to OpenAI-compatible dicts.
 * Not currently wired into RunJournal (which uses message serialization
 * directly), but available for consumers that need the OpenAI wire format.
 */

/** Loosely-typed message shape — LangChain messages are accessed by attribute. */
type AnyMessage = Record<string, any>;

const _ROLE_MAP: Record<string, string> = {
  human: "user",
  ai: "assistant",
  system: "system",
  tool: "tool",
};

/**
 * Convert a single LangChain BaseMessage to an OpenAI message dict.
 *
 * Handles:
 * - HumanMessage → {"role": "user", "content": "..."}
 * - AIMessage (text only) → {"role": "assistant", "content": "..."}
 * - AIMessage (with tool_calls) → {"role": "assistant", "content": null, "tool_calls": [...]}
 * - AIMessage (text + tool_calls) → both content and tool_calls present
 * - AIMessage (list content / multimodal) → content preserved as list
 * - SystemMessage → {"role": "system", "content": "..."}
 * - ToolMessage → {"role": "tool", "tool_call_id": "...", "content": "..."}
 */
export function langchainToOpenaiMessage(message: AnyMessage): Record<string, unknown> {
  const msgType: string = message?.type ?? "";
  const role = _ROLE_MAP[msgType] ?? msgType;
  const content: unknown = message?.content ?? "";

  if (role === "tool") {
    return {
      role: "tool",
      tool_call_id: message?.tool_call_id ?? "",
      content,
    };
  }

  if (role === "assistant") {
    const toolCalls: AnyMessage[] = message?.tool_calls ?? [];
    const result: Record<string, unknown> = { role: "assistant" };

    if (toolCalls && toolCalls.length > 0) {
      const openaiToolCalls: Record<string, unknown>[] = [];
      for (const tc of toolCalls) {
        const args = tc?.args ?? {};
        openaiToolCalls.push({
          id: tc?.id ?? "",
          type: "function",
          function: {
            name: tc?.name ?? "",
            arguments: typeof args !== "string" ? JSON.stringify(args) : args,
          },
        });
      }
      // If no text content, set content to null per OpenAI spec.
      const hasContent =
        (Array.isArray(content) && content.length > 0) || (typeof content === "string" && content.length > 0);
      result["content"] = hasContent ? content : null;
      result["tool_calls"] = openaiToolCalls;
    } else {
      result["content"] = content;
    }

    return result;
  }

  // user / system / unknown
  return { role, content };
}

/**
 * Infer OpenAI finish_reason from an AIMessage.
 *
 * Returns "tool_calls" if tool_calls present, else looks in
 * response_metadata.finish_reason, else returns "stop".
 */
function _inferFinishReason(message: AnyMessage): string {
  const toolCalls: AnyMessage[] = message?.tool_calls ?? [];
  if (toolCalls && toolCalls.length > 0) {
    return "tool_calls";
  }
  const respMeta: unknown = message?.response_metadata ?? {};
  if (respMeta !== null && typeof respMeta === "object" && !Array.isArray(respMeta)) {
    const finish = (respMeta as Record<string, unknown>)["finish_reason"];
    if (finish) {
      return String(finish);
    }
  }
  return "stop";
}

/**
 * Convert an AIMessage and its metadata to an OpenAI completion response dict.
 *
 * Returns:
 *   {
 *     "id": message.id,
 *     "model": message.response_metadata.get("model_name"),
 *     "choices": [{"index": 0, "message": <openai_message>, "finish_reason": <inferred>}],
 *     "usage": {"prompt_tokens": ..., "completion_tokens": ..., "total_tokens": ...} or null,
 *   }
 */
export function langchainToOpenaiCompletion(message: AnyMessage): Record<string, unknown> {
  const respMeta: unknown = message?.response_metadata ?? {};
  const modelName =
    respMeta !== null && typeof respMeta === "object" && !Array.isArray(respMeta)
      ? (respMeta as Record<string, unknown>)["model_name"] ?? null
      : null;

  const openaiMsg = langchainToOpenaiMessage(message);
  const finishReason = _inferFinishReason(message);

  const usageMetadata: AnyMessage | null | undefined = message?.usage_metadata;
  let usage: Record<string, unknown> | null;
  if (usageMetadata !== null && usageMetadata !== undefined) {
    const inputTokens: number = usageMetadata?.input_tokens ?? 0;
    const outputTokens: number = usageMetadata?.output_tokens ?? 0;
    usage = {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    };
  } else {
    usage = null;
  }

  return {
    id: message?.id ?? null,
    model: modelName,
    choices: [
      {
        index: 0,
        message: openaiMsg,
        finish_reason: finishReason,
      },
    ],
    usage,
  };
}

/** Convert a list of LangChain BaseMessages to OpenAI message dicts. */
export function langchainMessagesToOpenai(messages: AnyMessage[]): Record<string, unknown>[] {
  return messages.map((m) => langchainToOpenaiMessage(m));
}
