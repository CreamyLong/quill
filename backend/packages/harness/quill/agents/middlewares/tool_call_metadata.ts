/**
 * Helpers for keeping AI message tool-call metadata consistent.
 */

export interface MessageLike {
  content?: unknown;
  tool_calls?: Array<Record<string, unknown>>;
  additional_kwargs?: Record<string, unknown>;
  response_metadata?: Record<string, unknown>;
  id?: string;
  type?: string;
  [key: string]: unknown;
}

function rawToolCallId(rawToolCall: unknown): string | null {
  if (rawToolCall === null || typeof rawToolCall !== "object") {
    return null;
  }
  const rawId = (rawToolCall as Record<string, unknown>)["id"];
  return typeof rawId === "string" && rawId.length > 0 ? rawId : null;
}

/**
 * Clone an AI message while keeping raw provider tool-call metadata in sync.
 */
export function cloneAiMessageWithToolCalls(
  message: MessageLike,
  toolCalls: Array<Record<string, unknown>>,
  { content }: { content?: unknown } = {}
): MessageLike {
  const keptIds = new Set<string>();
  for (const tc of toolCalls) {
    const id = tc["id"];
    if (typeof id === "string" && id.length > 0) {
      keptIds.add(id);
    }
  }

  const update: MessageLike = { tool_calls: toolCalls };
  if (content !== undefined) {
    update.content = content;
  }

  const additionalKwargs: Record<string, unknown> = { ...(message.additional_kwargs ?? {}) };
  const rawToolCalls = additionalKwargs["tool_calls"];
  if (Array.isArray(rawToolCalls)) {
    const synced = rawToolCalls.filter((rawTc) => {
      const id = rawToolCallId(rawTc);
      return id !== null && keptIds.has(id);
    });
    if (synced.length > 0) {
      additionalKwargs["tool_calls"] = synced;
    } else {
      delete additionalKwargs["tool_calls"];
    }
  }

  if (toolCalls.length === 0) {
    delete additionalKwargs["function_call"];
  }
  update.additional_kwargs = additionalKwargs;

  const responseMetadata: Record<string, unknown> = { ...(message.response_metadata ?? {}) };
  if (toolCalls.length === 0 && responseMetadata["finish_reason"] === "tool_calls") {
    responseMetadata["finish_reason"] = "stop";
  }
  update.response_metadata = responseMetadata;

  const clone = Object.create(Object.getPrototypeOf(message)) as MessageLike;
  Object.assign(clone, message, update);
  return clone;
}
