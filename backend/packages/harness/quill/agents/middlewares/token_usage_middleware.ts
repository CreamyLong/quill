/**
 * Middleware for logging token usage and annotating step attribution.
 */

import { AIMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition, ThreadState } from "../factory.js";

export const TOKEN_USAGE_ATTRIBUTION_KEY = "token_usage_attribution";

interface Todo {
  content?: string;
  status?: "pending" | "in_progress" | "completed";
}

function stringArg(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || null;
  }
  return null;
}

function normalizeTodos(value: unknown): Todo[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: Todo[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const todo: Todo = {};
    const content = stringArg((item as Record<string, unknown>).content);
    const status = (item as Record<string, unknown>).status;
    if (content !== null) {
      todo.content = content;
    }
    if (status === "pending" || status === "in_progress" || status === "completed") {
      todo.status = status;
    }
    normalized.push(todo);
  }
  return normalized;
}

function todoActionKind(previous: Todo | null, current: Todo): string {
  const status = current.status;
  if (previous === null) {
    if (status === "completed") {
      return "todo_complete";
    }
    if (status === "in_progress") {
      return "todo_start";
    }
    return "todo_update";
  }
  if (previous.content !== current.content) {
    return "todo_update";
  }
  if (status === "completed") {
    return "todo_complete";
  }
  if (status === "in_progress") {
    return "todo_start";
  }
  return "todo_update";
}

function buildTodoActions(previousTodos: Todo[], nextTodos: Todo[]): Array<Record<string, unknown>> {
  const previousByContent: Record<string, Array<{ index: number; todo: Todo }>> = {};
  const matchedPreviousIndices = new Set<number>();

  for (let index = 0; index < previousTodos.length; index++) {
    const todo = previousTodos[index];
    const content = todo.content;
    if (typeof content === "string" && content) {
      if (!previousByContent[content]) {
        previousByContent[content] = [];
      }
      previousByContent[content].push({ index, todo });
    }
  }

  const actions: Array<Record<string, unknown>> = [];

  for (let index = 0; index < nextTodos.length; index++) {
    const todo = nextTodos[index];
    const content = todo.content;
    if (typeof content !== "string" || !content) {
      continue;
    }

    let previousMatch: Todo | null = null;
    const contentMatches = previousByContent[content];
    if (contentMatches) {
      while (contentMatches.length > 0 && matchedPreviousIndices.has(contentMatches[0].index)) {
        contentMatches.shift();
      }
      if (contentMatches.length > 0) {
        const match = contentMatches.shift()!;
        previousMatch = match.todo;
        matchedPreviousIndices.add(match.index);
      }
    }

    if (
      previousMatch === null &&
      !previousByContent[content] &&
      index < previousTodos.length &&
      !matchedPreviousIndices.has(index)
    ) {
      previousMatch = previousTodos[index];
      matchedPreviousIndices.add(index);
    }

    if (previousMatch !== null) {
      if (
        previousMatch.content === content &&
        previousMatch.status === todo.status
      ) {
        continue;
      }
    }

    actions.push({
      kind: todoActionKind(previousMatch, todo),
      content,
    });
  }

  for (let index = 0; index < previousTodos.length; index++) {
    if (matchedPreviousIndices.has(index)) {
      continue;
    }
    const todo = previousTodos[index];
    const content = todo.content;
    if (typeof content !== "string" || !content) {
      continue;
    }
    actions.push({
      kind: "todo_remove",
      content,
    });
  }

  return actions;
}

function describeToolCall(
  toolCall: Record<string, unknown>,
  todos: Todo[]
): Array<Record<string, unknown>> {
  const name = stringArg(toolCall.name) ?? "unknown";
  const args =
    typeof toolCall.args === "object" && toolCall.args !== null
      ? (toolCall.args as Record<string, unknown>)
      : {};
  const toolCallId = stringArg(toolCall.id);

  if (name === "write_todos") {
    const nextTodos = normalizeTodos(args.todos);
    const actions = buildTodoActions(todos, nextTodos);
    if (actions.length === 0) {
      return [
        {
          kind: "tool",
          tool_name: name,
          tool_call_id: toolCallId,
        },
      ];
    }
    return actions.map((action) => ({ ...action, tool_call_id: toolCallId }));
  }

  if (name === "task") {
    return [
      {
        kind: "subagent",
        description: stringArg(args.description),
        subagent_type: stringArg(args.subagent_type),
        tool_call_id: toolCallId,
      },
    ];
  }

  if (name === "web_search" || name === "image_search") {
    return [
      {
        kind: "search",
        tool_name: name,
        query: stringArg(args.query),
        tool_call_id: toolCallId,
      },
    ];
  }

  if (name === "present_files") {
    return [
      {
        kind: "present_files",
        tool_call_id: toolCallId,
      },
    ];
  }

  if (name === "ask_clarification") {
    return [
      {
        kind: "clarification",
        tool_call_id: toolCallId,
      },
    ];
  }

  return [
    {
      kind: "tool",
      tool_name: name,
      description: stringArg(args.description),
      tool_call_id: toolCallId,
    },
  ];
}

function inferStepKind(
  message: AIMessage,
  actions: Array<Record<string, unknown>>
): string {
  if (actions.length > 0) {
    const firstKind = actions[0].kind;
    const todoKinds = new Set([
      "todo_start",
      "todo_complete",
      "todo_update",
      "todo_remove",
    ]);
    if (actions.length === 1 && typeof firstKind === "string" && todoKinds.has(firstKind)) {
      return "todo_update";
    }
    if (actions.length === 1 && firstKind === "subagent") {
      return "subagent_dispatch";
    }
    return "tool_batch";
  }
  if (message.content) {
    return "final_answer";
  }
  return "thinking";
}

function hasToolCall(message: AIMessage, toolCallId: string): boolean {
  for (const tc of message.tool_calls ?? []) {
    if (tc.id === toolCallId) {
      return true;
    }
  }
  return false;
}

function buildAttribution(
  message: AIMessage,
  todos: Todo[]
): Record<string, unknown> {
  const toolCalls = message.tool_calls ?? [];
  const actions: Array<Record<string, unknown>> = [];
  let currentTodos = todos.slice();

  for (const rawToolCall of toolCalls) {
    const toolCall = rawToolCall as unknown as Record<string, unknown>;
    const described = describeToolCall(toolCall, currentTodos);
    actions.push(...described);
    if (toolCall.name === "write_todos") {
      const args =
        typeof toolCall.args === "object" && toolCall.args !== null
          ? (toolCall.args as Record<string, unknown>)
          : {};
      currentTodos = normalizeTodos(args.todos);
    }
  }

  return {
    version: 1,
    kind: inferStepKind(message, actions),
    shared_attribution: actions.length > 1,
    tool_call_ids: toolCalls.map((tc) => tc.id).filter((id): id is string => typeof id === "string"),
    actions,
  };
}

function updateAiMessageAttribution(
  message: AIMessage,
  attribution: Record<string, unknown>
): AIMessage {
  return new AIMessage({
    content: message.content,
    tool_calls: message.tool_calls,
    id: message.id,
    name: message.name,
    additional_kwargs: {
      ...message.additional_kwargs,
      [TOKEN_USAGE_ATTRIBUTION_KEY]: attribution,
    },
    response_metadata: message.response_metadata,
    usage_metadata: message.usage_metadata,
  });
}

/** Logs token usage from model responses and annotates the AI step. */
export function tokenUsageMiddleware(): MiddlewareDefinition {
  return {
    name: "TokenUsageMiddleware",
    afterModel: (state: ThreadState) => {
      const messages = state.messages ?? [];
      if (messages.length === 0) {
        return {};
      }

      const last = messages[messages.length - 1];
      if (!(last instanceof AIMessage)) {
        return {};
      }

      const usage = last.usage_metadata;
      if (usage) {
        const inputTokenDetails =
          (usage.input_token_details as Record<string, unknown>) ?? {};
        const outputTokenDetails =
          (usage.output_token_details as Record<string, unknown>) ?? {};
        const detailParts: string[] = [];
        if (Object.keys(inputTokenDetails).length > 0) {
          detailParts.push(`input_token_details=${JSON.stringify(inputTokenDetails)}`);
        }
        if (Object.keys(outputTokenDetails).length > 0) {
          detailParts.push(`output_token_details=${JSON.stringify(outputTokenDetails)}`);
        }
        const detailSuffix = detailParts.length > 0 ? ` ${detailParts.join(" ")}` : "";
        console.log(
          `LLM token usage: input=${String(usage.input_tokens ?? "?")} output=${String(
            usage.output_tokens ?? "?"
          )} total=${String(usage.total_tokens ?? "?")}${detailSuffix}`
        );
      }

      const todos = normalizeTodos(state.todos);
      const attribution = buildAttribution(last, todos);
      const additionalKwargs = last.additional_kwargs ?? {};
      if (
        additionalKwargs[TOKEN_USAGE_ATTRIBUTION_KEY] !== undefined &&
        JSON.stringify(additionalKwargs[TOKEN_USAGE_ATTRIBUTION_KEY]) === JSON.stringify(attribution)
      ) {
        return {};
      }

      return {
        messages: [updateAiMessageAttribution(last, attribution)],
      };
    },
  };
}
