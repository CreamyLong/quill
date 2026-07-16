/**
 * Middleware for injecting image details into conversation before the LLM call.
 *
 * Faithful port of Python `ViewImageMiddleware`. When the previous turn included
 * `view_image` tool calls that have all completed, a hidden HumanMessage carrying
 * the viewed image data (text + `image_url` blocks) is injected so the model can
 * "see" and analyze the images without an explicit user prompt.
 */

import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition } from "../factory.js";
import type { ThreadState, ViewedImageData } from "../thread_state.js";

type ContentBlock = string | Record<string, unknown>;

/** Return the last assistant (AI) message from the list, or null. */
function getLastAssistantMessage(messages: BaseMessage[]): AIMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg instanceof AIMessage) {
      return msg;
    }
  }
  return null;
}

/** Return whether the assistant message contains view_image tool calls. */
function hasViewImageTool(message: AIMessage): boolean {
  const toolCalls = message.tool_calls ?? [];
  if (toolCalls.length === 0) {
    return false;
  }
  return toolCalls.some((tc) => tc.name === "view_image");
}

/** Return whether every tool call in the assistant message has a ToolMessage. */
function allToolsCompleted(messages: BaseMessage[], assistantMsg: AIMessage): boolean {
  const toolCalls = assistantMsg.tool_calls ?? [];
  if (toolCalls.length === 0) {
    return false;
  }

  const toolCallIds = new Set<string>();
  for (const tc of toolCalls) {
    if (tc.id) {
      toolCallIds.add(tc.id);
    }
  }

  const assistantIdx = messages.indexOf(assistantMsg);
  if (assistantIdx < 0) {
    return false;
  }

  const completedToolIds = new Set<string>();
  for (const msg of messages.slice(assistantIdx + 1)) {
    if (msg instanceof ToolMessage && msg.tool_call_id) {
      completedToolIds.add(msg.tool_call_id);
    }
  }

  for (const id of toolCallIds) {
    if (!completedToolIds.has(id)) {
      return false;
    }
  }
  return true;
}

/** Create the formatted content blocks describing all viewed images. */
function createImageDetailsMessage(state: ThreadState): ContentBlock[] {
  const viewedImages: Record<string, ViewedImageData> = state.viewed_images ?? {};
  if (Object.keys(viewedImages).length === 0) {
    return [{ type: "text", text: "No images have been viewed." }];
  }

  const contentBlocks: ContentBlock[] = [
    { type: "text", text: "Here are the images you've viewed:" },
  ];

  for (const [imagePath, imageData] of Object.entries(viewedImages)) {
    const mimeType = imageData.mime_type ?? "unknown";
    const base64Data = imageData.base64 ?? "";

    contentBlocks.push({ type: "text", text: `\n- **${imagePath}** (${mimeType})` });

    if (base64Data) {
      contentBlocks.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${base64Data}` },
      });
    }
  }

  return contentBlocks;
}

/** Determine whether an image details message should be injected. */
function shouldInjectImageMessage(state: ThreadState): boolean {
  const messages = state.messages ?? [];
  if (messages.length === 0) {
    return false;
  }

  const lastAssistantMsg = getLastAssistantMessage(messages);
  if (!lastAssistantMsg) {
    return false;
  }

  if (!hasViewImageTool(lastAssistantMsg)) {
    return false;
  }

  if (!allToolsCompleted(messages, lastAssistantMsg)) {
    return false;
  }

  // Skip if we already injected an image details message after this turn.
  const assistantIdx = messages.indexOf(lastAssistantMsg);
  for (const msg of messages.slice(assistantIdx + 1)) {
    if (msg instanceof HumanMessage) {
      const contentStr = String(msg.content);
      if (
        contentStr.includes("Here are the images you've viewed") ||
        contentStr.includes("Here are the details of the images you've viewed")
      ) {
        return false;
      }
    }
  }

  return true;
}

/** Build the state update injecting the viewed-image HumanMessage, or {} if none. */
function injectImageMessage(state: ThreadState): Partial<ThreadState> {
  if (!shouldInjectImageMessage(state)) {
    return {};
  }

  const imageContent = createImageDetailsMessage(state);
  // Internal context for the model only: hide it from the chat UI / IM channels.
  const humanMsg = new HumanMessage({
    content: imageContent as unknown as HumanMessage["content"],
    additional_kwargs: { hide_from_ui: true },
  });

  return { messages: [humanMsg] };
}

/** Extract a viewed_image payload from a view_image ToolMessage content. */
function extractViewedImage(message: BaseMessage): ViewedImageData | null {
  if (!(message instanceof ToolMessage)) {
    return null;
  }
  if (message.name !== "view_image") {
    return null;
  }
  try {
    const parsed = JSON.parse(String(message.content ?? "{}")) as Record<string, unknown>;
    if (!parsed.ok || !parsed.viewed_image) {
      return null;
    }
    const img = parsed.viewed_image as Record<string, unknown>;
    if (
      typeof img.base64 === "string" &&
      typeof img.mime_type === "string" &&
      img.base64.length > 0
    ) {
      return { base64: img.base64, mime_type: img.mime_type };
    }
  } catch {
    // Not JSON — ignore.
  }
  return null;
}

/** Collect view_image results from the last assistant turn into state. */
function collectViewedImages(state: ThreadState): Record<string, ViewedImageData> | null {
  const messages = state.messages ?? [];
  if (messages.length === 0) {
    return null;
  }

  const lastAssistant = getLastAssistantMessage(messages);
  if (!lastAssistant) {
    return null;
  }

  const hasViewImage = (lastAssistant.tool_calls ?? []).some((tc) => (tc as { name?: string }).name === "view_image",
  );
  if (!hasViewImage) {
    return null;
  }

  const assistantIdx = messages.indexOf(lastAssistant);
  const viewedImages: Record<string, ViewedImageData> = {};
  for (const msg of messages.slice(assistantIdx + 1)) {
    if (msg instanceof ToolMessage) {
      const image = extractViewedImage(msg);
      if (image !== null && msg.name) {
        // Use the tool_call_id as key if available, otherwise the tool name.
        const key = msg.tool_call_id || msg.name;
        viewedImages[key] = image;
      }
    }
  }

  return Object.keys(viewedImages).length > 0 ? viewedImages : null;
}

/**
 * Inject viewed image details before the model call when view_image tools have
 * all completed.
 */
export function viewImageMiddleware(): MiddlewareDefinition {
  return {
    name: "ViewImageMiddleware",
    beforeModel: (state: ThreadState) => injectImageMessage(state),
    afterAgent: (state: ThreadState) => {
      const viewedImages = collectViewedImages(state);
      if (viewedImages === null) {
        return {};
      }
      return { viewed_images: viewedImages };
    },
  };
}
