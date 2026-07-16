/**
 * Middleware for intercepting clarification requests and presenting them to the
 * user.
 *
 * Faithful port of Python `ClarificationMiddleware`. When the model calls the
 * `ask_clarification` tool, this middleware formats the question and returns it
 * as a ToolMessage instead of executing the tool.
 *
 * Deviation (noted in report): Python returns a LangGraph
 * `Command(update=..., goto=END)` to interrupt the run. The TS `wrapToolCall`
 * contract returns a `BaseMessage`, so only the formatted ToolMessage is
 * returned; the `goto=END` interrupt is not expressible in the current TS
 * runtime and continuation is governed by the graph's normal routing.
 */

import { createHash } from "node:crypto";

import { ToolMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition, ToolCallRequest } from "../factory.js";

/** Build a deterministic message ID so retried clarification calls replace. */
function stableMessageId(toolCallId: string, formattedMessage: string): string {
  if (toolCallId) {
    return `clarification:${toolCallId}`;
  }
  const digest = createHash("sha256")
    .update(formattedMessage, "utf-8")
    .digest("hex")
    .slice(0, 16);
  return `clarification:${digest}`;
}

/** Format the clarification arguments into a user-friendly message. */
function formatClarificationMessage(args: Record<string, unknown>): string {
  const question = (args["question"] as string) ?? "";
  const clarificationType = (args["clarification_type"] as string) ?? "missing_info";
  const context = args["context"];
  let options = args["options"] ?? [];

  // Some models serialize array parameters as JSON strings; normalize.
  if (typeof options === "string") {
    try {
      options = JSON.parse(options);
    } catch {
      options = [options];
    }
  }

  if (options === null || options === undefined) {
    options = [];
  } else if (!Array.isArray(options)) {
    options = [options];
  }

  const typeIcons: Record<string, string> = {
    missing_info: "❓",
    ambiguous_requirement: "🤔",
    approach_choice: "🔀",
    risk_confirmation: "⚠️",
    suggestion: "💡",
  };

  const icon = typeIcons[clarificationType] ?? "❓";

  const messageParts: string[] = [];

  if (context) {
    messageParts.push(`${icon} ${String(context)}`);
    messageParts.push(`\n${question}`);
  } else {
    messageParts.push(`${icon} ${question}`);
  }

  const optionList = options as unknown[];
  if (optionList.length > 0) {
    messageParts.push("");
    optionList.forEach((option, i) => {
      messageParts.push(`  ${i + 1}. ${String(option)}`);
    });
  }

  return messageParts.join("\n");
}

/** Handle a clarification request and return the formatted ToolMessage. */
function handleClarification(request: ToolCallRequest): ToolMessage {
  const args = request.args ?? {};
  console.info("Intercepted clarification request");

  const formattedMessage = formatClarificationMessage(args);
  const toolCallId = request.tool_call_id ?? "";

  return new ToolMessage({
    id: stableMessageId(toolCallId, formattedMessage),
    content: formattedMessage,
    tool_call_id: toolCallId,
    name: "ask_clarification",
  });
}

/** Intercept `ask_clarification` tool calls and surface the question. */
export function clarificationMiddleware(): MiddlewareDefinition {
  return {
    name: "ClarificationMiddleware",
    wrapToolCall: async (request, handler) => {
      if (request.name !== "ask_clarification") {
        return handler(request);
      }
      return handleClarification(request);
    },
  };
}
