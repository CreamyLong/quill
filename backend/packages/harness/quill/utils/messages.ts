/**
 * Message content text extraction helpers.
 *
 * Mirrors `quill.utils.messages` from the Python backend.
 */

export const ORIGINAL_USER_CONTENT_KEY = "original_user_content";

/**
 * Extract text from LangChain message content shapes.
 */
export function messageContentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (item !== null && typeof item === "object") {
        const text = (item as Record<string, unknown>)["text"];
        if (typeof text === "string") {
          parts.push(text);
        }
      }
    }
    return parts.join("\n");
  }
  return String(content);
}

/**
 * Extract display text from a whole message (BaseMessage or dict-shaped).
 */
export function messageToText(
  message: unknown,
  { textAttributeFallback = false }: { textAttributeFallback?: boolean } = {}
): string {
  let content: unknown;
  if (message !== null && typeof message === "object" && "content" in (message as Record<string, unknown>)) {
    content = (message as Record<string, unknown>)["content"];
  } else {
    content = undefined;
  }

  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "string") {
        parts.push(block);
      } else if (block !== null && typeof block === "object") {
        const text = (block as Record<string, unknown>)["text"];
        if (typeof text === "string") {
          parts.push(text);
        } else {
          const nested = (block as Record<string, unknown>)["content"];
          if (typeof nested === "string") {
            parts.push(nested);
          }
        }
      }
    }
    return parts.join("");
  }
  if (content !== null && typeof content === "object") {
    for (const key of ["text", "content"]) {
      const value = (content as Record<string, unknown>)[key];
      if (typeof value === "string") {
        return value;
      }
    }
  }
  if (textAttributeFallback) {
    const text = (message as Record<string, unknown> | undefined)?.["text"];
    if (typeof text === "string") {
      return text;
    }
  }
  return "";
}

/**
 * Return pre-middleware user text when available, otherwise content text.
 */
export function getOriginalUserContentText(
  content: unknown,
  additionalKwargs: Record<string, unknown> | null | undefined
): string {
  const originalContent = additionalKwargs?.[ORIGINAL_USER_CONTENT_KEY];
  if (typeof originalContent === "string") {
    return originalContent;
  }
  return messageContentToText(content);
}
