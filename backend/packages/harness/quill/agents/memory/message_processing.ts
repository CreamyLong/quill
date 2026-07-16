/**
 * Shared helpers for turning conversations into memory update inputs.
 */

export interface MessageLike {
  type?: string;
  content?: unknown;
  additional_kwargs?: Record<string, unknown>;
  tool_calls?: unknown[];
  [key: string]: unknown;
}

const UPLOAD_BLOCK_RE = /<<uploaded_files>[\s\S]*?<\/uploaded_files>\n*/gi;

const CORRECTION_PATTERNS: RegExp[] = [
  /\bthat(?:'s| is) (?:wrong|incorrect)\b/i,
  /\byou misunderstood\b/i,
  /\btry again\b/i,
  /\bredo\b/i,
  /不对/,
  /你理解错了/,
  /你理解有误/,
  /重试/,
  /重新来/,
  /换一种/,
  /改用/,
];

const REINFORCEMENT_PATTERNS: RegExp[] = [
  /\byes[,.]?\s+(?:exactly|perfect|that(?:'s| is) (?:right|correct|it))\b/i,
  /\bperfect(?:[.!?]|$)/i,
  /\bexactly\s+(?:right|correct)\b/i,
  /\bthat(?:'s| is)\s+(?:exactly\s+)?(?:right|correct|what i (?:wanted|needed|meant))\b/i,
  /\bkeep\s+(?:doing\s+)?that\b/i,
  /\bjust\s+(?:like\s+)?(?:that|this)\b/i,
  /\bthis is (?:great|helpful)\b(?:[.!?]|$)/i,
  /\bthis is what i wanted\b(?:[.!?]|$)/i,
  /对[，,]?\s*就是这样(?:[。！？!?.]|$)/,
  /完全正确(?:[。！？!?.]|$)/,
  /(?:对[，,]?\s*)?就是这个意思(?:[。！？!?.]|$)/,
  /正是我想要的(?:[。！？!?.]|$)/,
  /继续保持(?:[。！？!?.]|$)/,
];

/** Extract plain text from message content for filtering and signal detection. */
export function extractMessageText(message: MessageLike): string {
  const content = message.content ?? "";
  if (Array.isArray(content)) {
    const textParts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        textParts.push(part);
      } else if (part != null && typeof part === "object") {
        const textVal = (part as Record<string, unknown>)["text"];
        if (typeof textVal === "string") {
          textParts.push(textVal);
        }
      }
    }
    return textParts.join(" ");
  }
  return String(content);
}

/** Keep only user inputs and final assistant responses for memory updates. */
export function filterMessagesForMemory(messages: MessageLike[]): MessageLike[] {
  const filtered: MessageLike[] = [];
  let skipNextAi = false;

  for (const msg of messages) {
    const msgType = msg.type;

    if (msgType === "human") {
      const additionalKwargs = msg.additional_kwargs ?? {};
      if (additionalKwargs["hide_from_ui"]) {
        continue;
      }
      const contentStr = extractMessageText(msg);
      if (contentStr.includes("<uploaded_files>")) {
        const stripped = contentStr.replace(UPLOAD_BLOCK_RE, "").trim();
        if (!stripped) {
          skipNextAi = true;
          continue;
        }
        filtered.push({ ...msg, content: stripped });
        skipNextAi = false;
      } else {
        filtered.push(msg);
        skipNextAi = false;
      }
    } else if (msgType === "ai") {
      const toolCalls = msg.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        if (skipNextAi) {
          skipNextAi = false;
          continue;
        }
        filtered.push(msg);
      }
    }
  }

  return filtered;
}

/** Detect explicit user corrections in recent conversation turns. */
export function detectCorrection(messages: MessageLike[]): boolean {
  const recentUserMsgs = messages.slice(-6).filter((msg) => msg.type === "human");

  for (const msg of recentUserMsgs) {
    const content = extractMessageText(msg).trim();
    if (content && CORRECTION_PATTERNS.some((pattern) => pattern.test(content))) {
      return true;
    }
  }

  return false;
}

/** Detect explicit positive reinforcement signals in recent conversation turns. */
export function detectReinforcement(messages: MessageLike[]): boolean {
  const recentUserMsgs = messages.slice(-6).filter((msg) => msg.type === "human");

  for (const msg of recentUserMsgs) {
    const content = extractMessageText(msg).trim();
    if (content && REINFORCEMENT_PATTERNS.some((pattern) => pattern.test(content))) {
      return true;
    }
  }

  return false;
}
