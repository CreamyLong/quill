/**
 * write_todos tool — create / update the agent's todo list during plan mode.
 *
 * This tool mirrors the Python `langchain.experimental.todo.TodoListMiddleware`
 * `write_todos` tool surface: the agent calls it with the full desired todo
 * list (idempotent replace), and the result is stored in `state.todos` via the
 * `mergeTodos` reducer.
 *
 * The tool itself only returns the echoed list; the actual state mutation is
 * performed by the TodoMiddleware's `afterAgent` / `wrapToolCall` hook, which
 * detects the `write_todos` tool call and writes the args to `state.todos`.
 * This split mirrors the Python pattern (tool returns result; middleware
 * reflects the args into graph state) so the agent sees a normal tool response
 * while the todo list is updated in parallel.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

const todoItemSchema = z.object({
  content: z.string().describe("The content of the todo item."),
  status: z
    .enum(["pending", "in_progress", "completed"])
    .describe("The status of the todo item."),
});

const writeTodosSchema = z.object({
  todos: z
    .array(todoItemSchema)
    .describe(
      "The complete todo list. This REPLACES the existing list (idempotent). " +
        "Each item has a content string and a status (pending|in_progress|completed).",
    ),
});

/** Build the write_todos tool. The tool itself just echoes; state reflection
 *  is handled by TodoMiddleware. */
export function createWriteTodosTool(): StructuredToolInterface {
  return tool(
    async (input: z.infer<typeof writeTodosSchema>): Promise<string> => {
      return JSON.stringify({
        ok: true,
        message: "Todo list updated.",
        todos: input.todos,
      });
    },
    {
      name: "write_todos",
      description: [
        "Create or update your todo list during plan mode.",
        "Pass the COMPLETE list — this replaces any existing todos.",
        "Use this tool at the start of a complex task to plan your steps, and",
        "call it again whenever a todo item's status changes (e.g. when you",
        "start or finish an item). Mark items as 'in_progress' before working",
        "on them and 'completed' when done.",
      ].join("\n"),
      schema: writeTodosSchema,
    },
  );
}

/** Type guard for a write_todos tool call payload. */
export function isWriteTodosCall(
  args: unknown,
): args is { todos: Array<{ content: string; status: string }> } {
  if (typeof args !== "object" || args === null) return false;
  const obj = args as Record<string, unknown>;
  if (!Array.isArray(obj.todos)) return false;
  return obj.todos.every(
    (t) =>
      typeof t === "object" &&
      t !== null &&
      typeof (t as Record<string, unknown>).content === "string" &&
      typeof (t as Record<string, unknown>).status === "string",
  );
}
