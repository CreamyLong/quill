/**
 * Input guardrail middleware for prompt-injection defense.
 *
 * Escapes blocked XML-like tags in the last genuine user message (e.g.
 * ``<system>`` → ``&lt;system&gt;``) so they render as literal text instead
 * of structured-context markers. Clean input is wrapped in plain-text boundary
 * markers as a secondary semantic defense.
 */

import { HumanMessage } from "@langchain/core/messages";
import type { BaseMessage, ContentBlock } from "@langchain/core/messages";

import type { MiddlewareDefinition, ModelRequest } from "../factory.js";

const SUMMARY_MESSAGE_NAME = "summary";

// System-reserved + common prompt-injection tag patterns.
const BLOCKED_TAG_NAMES: ReadonlySet<string> = new Set([
  "system-reminder",
  "memory",
  "current_date",
  "think",
  "analysis",
  "subagent_system",
  "skill_system",
  "uploaded_files",
  "todo_list_system",
  "system",
  "instruction",
  "role",
  "important",
  "override",
  "ignore",
  "prompt",
]);

const BLOCKED_TAG_PATTERN = new RegExp(
  String.raw`<\s*/?\s*(?:${Array.from(BLOCKED_TAG_NAMES)
    .sort()
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$\u0026"))
    .join("|")})\\b[^>]*>?`,
  "gi"
);

const USER_INPUT_BEGIN = "--- BEGIN USER INPUT ---";
const USER_INPUT_END = "--- END USER INPUT ---";
const NEUTRALIZED_BEGIN = "[BEGIN USER INPUT]";
const NEUTRALIZED_END = "[END USER INPUT]";

const BOUNDARY_TOKEN_RE = new RegExp(
  `${escapeRegex(USER_INPUT_BEGIN)}|${escapeRegex(USER_INPUT_END)}`,
  "g"
);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$\u0026");
}

function escapeTagMatch(match: string): string {
  return match.replace(/</g, "\u0026lt;").replace(/>/g, "\u0026gt;");
}

function isGenuineUserMessage(message: BaseMessage): boolean {
  if (message.getType() !== "human") {
    return false;
  }
  if (message.additional_kwargs?.hide_from_ui) {
    return false;
  }
  if (message.name === SUMMARY_MESSAGE_NAME) {
    return false;
  }
  return true;
}

function extractTextFromContent(
  content: unknown
): [string, Array<Record<string, unknown>> | null] {
  if (typeof content === "string") {
    return [content, null];
  }
  if (!Array.isArray(content)) {
    return ["", null];
  }
  const textParts: string[] = [];
  const textBlocks: Array<Record<string, unknown>> = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as Record<string, unknown>).type === "text" &&
      typeof (block as Record<string, unknown>).text === "string"
    ) {
      textParts.push(String((block as Record<string, unknown>).text));
      textBlocks.push(block as Record<string, unknown>);
    }
  }
  return [textParts.join("\n"), textBlocks];
}

function rebuildContent(
  originalContent: unknown[],
  processedText: string,
  textBlocks: Array<Record<string, unknown>>
): unknown[] {
  const textBlockIds = new Set<number>();
  for (const block of textBlocks) {
    const idx = originalContent.indexOf(block);
    if (idx >= 0) {
      textBlockIds.add(idx);
    }
  }
  let first: number | null = null;
  let last: number | null = null;
  for (let i = 0; i < originalContent.length; i++) {
    if (textBlockIds.has(i)) {
      if (first === null) {
        first = i;
      }
      last = i;
    }
  }
  if (first === null || last === null) {
    return originalContent;
  }
  const result: unknown[] = [
    ...originalContent.slice(0, first),
    { type: "text", text: processedText },
  ];
  for (let i = first + 1; i <= last; i++) {
    if (!textBlockIds.has(i)) {
      result.push(originalContent[i]);
    }
  }
  result.push(...originalContent.slice(last + 1));
  return result;
}

function checkUserContent(text: string): string {
  if (!text.trim()) {
    return text;
  }
  text = text.replace(BLOCKED_TAG_PATTERN, escapeTagMatch);

  if (text.startsWith(USER_INPUT_BEGIN) && text.endsWith(USER_INPUT_END)) {
    const inner = text.slice(USER_INPUT_BEGIN.length, -USER_INPUT_END.length);
    const neutralizedInner = inner.replace(
      BOUNDARY_TOKEN_RE,
      (m) => (m === USER_INPUT_BEGIN ? NEUTRALIZED_BEGIN : NEUTRALIZED_END)
    );
    if (neutralizedInner === inner) {
      return text;
    }
    return `${USER_INPUT_BEGIN}${neutralizedInner}${USER_INPUT_END}`;
  }

  const neutralized = text.replace(
    BOUNDARY_TOKEN_RE,
    (m) => (m === USER_INPUT_BEGIN ? NEUTRALIZED_BEGIN : NEUTRALIZED_END)
  );
  return `${USER_INPUT_BEGIN}\n${neutralized}\n${USER_INPUT_END}`;
}

function processRequest(request: ModelRequest): ModelRequest {
  const messages = request.messages.slice();
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!isGenuineUserMessage(msg)) {
      continue;
    }
    const content = msg.content;
    const [textContent, textBlocks] = extractTextFromContent(content);

    if (!textContent && typeof content !== "string") {
      return request;
    }

    const processed = checkUserContent(textContent);
    if (processed === textContent) {
      return request;
    }

    const newContent: string | Array<ContentBlock> = textBlocks
      ? (rebuildContent(content as unknown[], processed, textBlocks) as Array<ContentBlock>)
      : processed;

    messages[i] = new HumanMessage({
      content: newContent,
      id: msg.id,
      name: msg.name,
      additional_kwargs: msg.additional_kwargs,
    });
    return { messages };
  }
  return request;
}

/** Guardrail middleware that escapes prompt-injection tags in user input. */
export function inputSanitizationMiddleware(): MiddlewareDefinition {
  return {
    name: "InputSanitizationMiddleware",
    wrapModelCall: async (request, handler) => {
      return handler(processRequest(request));
    },
  };
}
