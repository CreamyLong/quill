/**
 * Middleware extending the todo-list behavior with context-loss detection and
 * premature-exit prevention.
 *
 * Faithful port of the Quill-specific extensions in Python `TodoMiddleware`,
 * which itself subclasses `langchain.agents.middleware.TodoListMiddleware`.
 *
 * The middleware:
 * - Creates a `write_todos` tool that returns a raw state update (todos + the
 *   required ToolMessage), mirroring Python's `Command(update=...)`.
 * - Injects a todo-list system prompt via `wrapModelCall`.
 * - Detects when the original `write_todos` call has scrolled out of context
 *   and re-injects a reminder.
 * - Prevents the agent from exiting while todos are still incomplete by
 *   queueing a completion reminder and emitting `jump_to: "model"`.
 */

import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import type { MiddlewareDefinition, ModelRequest } from "../factory.js";
import { STATE_UPDATE } from "../factory.js";
import type { ThreadState } from "../thread_state.js";

/** Local mirror of langchain's `Todo` shape. */
export interface Todo {
  content?: string;
  status?: "pending" | "in_progress" | "completed" | string;
}

const TODO_ITEM_SCHEMA = z.object({
  content: z.string().describe("The content of the todo item."),
  status: z
    .enum(["pending", "in_progress", "completed"])
    .describe("The status of the todo item."),
});

const WRITE_TODOS_SCHEMA = z.object({
  todos: z
    .array(TODO_ITEM_SCHEMA)
    .describe("The complete todo list. This REPLACES the existing list (idempotent)."),
});

// ---------------------------------------------------------------------------
// Prompts matching the Python lead_agent.agent._create_todo_list_middleware
// ---------------------------------------------------------------------------

const DEFAULT_TODO_SYSTEM_PROMPT = `<todo_list_system>
You have access to the \`write_todos\` tool to help you manage and track complex multi-step objectives.

**CRITICAL RULES:**
- Mark todos as completed IMMEDIATELY after finishing each step - do NOT batch completions
- Keep EXACTLY ONE task as \`in_progress\` at any time (unless tasks can run in parallel)
- Update the todo list in REAL-TIME as you work - this gives users visibility into your progress
- DO NOT use this tool for simple tasks (< 3 steps) - just complete them directly

**When to Use:**
This tool is designed for complex objectives that require systematic tracking:
- Complex multi-step tasks requiring 3+ distinct steps
- Non-trivial tasks needing careful planning and execution
- User explicitly requests a todo list
- User provides multiple tasks (numbered or comma-separated list)
- The plan may need revisions based on intermediate results

**When NOT to Use:**
- Single, straightforward tasks
- Trivial tasks (< 3 steps)
- Purely conversational or informational requests
- Simple tool calls where the approach is obvious

**Best Practices:**
- Break down complex tasks into smaller, actionable steps
- Use clear, descriptive task names
- Remove tasks that become irrelevant
- Add new tasks discovered during implementation
- Don't be afraid to revise the todo list as you learn more

**Task Management:**
Writing todos takes time and tokens - use it when helpful for managing complex problems, not for simple requests.
</todo_list_system>`;

const DEFAULT_TODO_TOOL_DESCRIPTION = `Use this tool to create and manage a structured task list for complex work sessions.

**IMPORTANT: Only use this tool for complex tasks (3+ steps). For simple requests, just do the work directly.**

## When to Use

Use this tool in these scenarios:
1. **Complex multi-step tasks**: When a task requires 3 or more distinct steps or actions
2. **Non-trivial tasks**: Tasks requiring careful planning or multiple operations
3. **User explicitly requests todo list**: When the user directly asks you to track tasks
4. **Multiple tasks**: When users provide a list of things to be done
5. **Dynamic planning**: When the plan may need updates based on intermediate results

## When NOT to Use

Skip this tool when:
1. The task is straightforward and takes less than 3 steps
2. The task is trivial and tracking provides no benefit
3. The task is purely conversational or informational
4. It's clear what needs to be done and you can just do it

## How to Use

1. **Starting a task**: Mark it as \`in_progress\` BEFORE beginning work
2. **Completing a task**: Mark it as \`completed\` IMMEDIATELY after finishing
3. **Updating the list**: Add new tasks, remove irrelevant ones, or update descriptions as needed
4. **Multiple updates**: You can make several updates at once (e.g. complete one task and start the next)

## Task States

- \`pending\`: Task not yet started
- \`in_progress\`: Currently working on (can have multiple if tasks run in parallel)
- \`completed\`: Task finished successfully

## Task Completion Requirements

**CRITICAL: Only mark a task as completed when you have FULLY accomplished it.**

Never mark a task as completed if:
- There are unresolved issues or errors
- Work is partial or incomplete
- You encountered blockers preventing completion
- You couldn't find necessary resources or dependencies
- Quality standards haven't been met

If blocked, keep the task as \`in_progress\` and create a new task describing what needs to be resolved.

## Best Practices

- Create specific, actionable items
- Break complex tasks into smaller, manageable steps
- Use clear, descriptive task names
- Update task status in real-time as you work
- Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
- Remove tasks that are no longer relevant
- **IMPORTANT**: When you write the todo list, mark your first task(s) as \`in_progress\` immediately
- **IMPORTANT**: Unless all tasks are completed, always have at least one task \`in_progress\` to show progress

Being proactive with task management demonstrates thoroughness and ensures all requirements are completed successfully.

**Remember**: If you only need a few tool calls to complete a task and it's clear what to do, it's better to just do the task directly and NOT use this tool at all.`;

const TOOL_CALL_FINISH_REASONS = new Set(["tool_calls", "function_call"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todosInMessages(messages: BaseMessage[]): boolean {
  for (const msg of messages) {
    if (msg instanceof AIMessage && (msg.tool_calls ?? []).length > 0) {
      for (const tc of msg.tool_calls ?? []) {
        if (tc.name === "write_todos") {
          return true;
        }
      }
    }
  }
  return false;
}

function reminderInMessages(messages: BaseMessage[]): boolean {
  for (const msg of messages) {
    if (msg instanceof HumanMessage && msg.name === "todo_reminder") {
      return true;
    }
  }
  return false;
}

function formatTodos(todos: Todo[]): string {
  return todos.map((todo) => `- [${todo.status ?? "pending"}] ${todo.content ?? ""}`).join("\n");
}

function formatCompletionReminder(todos: Todo[]): string {
  const incomplete = todos.filter((t) => t.status !== "completed");
  const incompleteText = incomplete
    .map((t) => `- [${t.status ?? "pending"}] ${t.content ?? ""}`)
    .join("\n");
  return (
    "<system_reminder>\n" +
    "You have incomplete todo items that must be finished before giving your final response:\n\n" +
    `${incompleteText}\n\n` +
    "Please continue working on these tasks. Call `write_todos` to mark items as completed " +
    "as you finish them, and only respond when all items are done.\n" +
    "</system_reminder>"
  );
}

function hasToolCallIntentOrError(message: AIMessage): boolean {
  if ((message.tool_calls ?? []).length > 0) {
    return true;
  }
  const anyMsg = message as unknown as Record<string, unknown>;
  const invalidToolCalls = anyMsg["invalid_tool_calls"] as unknown[] | undefined;
  if (invalidToolCalls && invalidToolCalls.length > 0) {
    return true;
  }
  const additionalKwargs = (message.additional_kwargs ?? {}) as Record<string, unknown>;
  if (additionalKwargs["tool_calls"] || additionalKwargs["function_call"]) {
    return true;
  }
  const responseMetadata = (anyMsg["response_metadata"] as Record<string, unknown>) ?? {};
  const finishReason = responseMetadata["finish_reason"];
  return typeof finishReason === "string" && TOOL_CALL_FINISH_REASONS.has(finishReason);
}

function formatPendingCompletionReminders(reminders: string[]): string {
  return [...new Set(reminders)].join("\n\n");
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

const FIXED_KEY = "default\u0000default";
const MAX_COMPLETION_REMINDERS = 2;
const MAX_COMPLETION_REMINDER_KEYS = 4096;

export interface TodoMiddlewareOptions {
  systemPrompt?: string;
  toolDescription?: string;
}

/** Todo middleware with context-loss detection and premature-exit prevention. */
export class TodoMiddleware {
  private readonly _systemPrompt: string;
  private readonly _toolDescription: string;
  readonly tools: StructuredToolInterface[];

  private readonly _pendingCompletionReminders = new Map<string, string[]>();
  private readonly _completionReminderCounts = new Map<string, number>();
  private readonly _completionReminderTouchOrder = new Map<string, number>();
  private _completionReminderNextOrder = 0;

  constructor(options: TodoMiddlewareOptions = {}) {
    this._systemPrompt = options.systemPrompt ?? DEFAULT_TODO_SYSTEM_PROMPT;
    this._toolDescription = options.toolDescription ?? DEFAULT_TODO_TOOL_DESCRIPTION;

    // Dynamically create the write_todos tool with the configured description.
    // The tool returns a raw state update so LangGraph writes `todos` directly.
    const writeTodosTool = tool(
      async (input: z.infer<typeof WRITE_TODOS_SCHEMA>, config): Promise<unknown> => {
        const toolCallId =
          (config as { toolCall?: { id?: string } } | undefined)?.toolCall?.id ??
          "write_todos";
        return {
          [STATE_UPDATE]: true,
          todos: input.todos,
          messages: [
            new ToolMessage({
              content: `Updated todo list to ${JSON.stringify(input.todos)}`,
              tool_call_id: toolCallId,
            }),
          ],
        };
      },
      {
        name: "write_todos",
        description: this._toolDescription,
        schema: WRITE_TODOS_SCHEMA,
      },
    );

    this.tools = [writeTodosTool];
  }

  private _pendingKey(): string {
    return FIXED_KEY;
  }

  private _touchCompletionReminderKey(key: string): void {
    this._completionReminderNextOrder += 1;
    this._completionReminderTouchOrder.set(key, this._completionReminderNextOrder);
  }

  private _completionReminderKeys(): Set<string> {
    const keys = new Set<string>(this._pendingCompletionReminders.keys());
    for (const k of this._completionReminderCounts.keys()) {
      keys.add(k);
    }
    for (const k of this._completionReminderTouchOrder.keys()) {
      keys.add(k);
    }
    return keys;
  }

  private _dropCompletionReminderKey(key: string): void {
    this._pendingCompletionReminders.delete(key);
    this._completionReminderCounts.delete(key);
    this._completionReminderTouchOrder.delete(key);
  }

  private _pruneCompletionReminderState(protectedKey: string): void {
    const keys = this._completionReminderKeys();
    const overflow = keys.size - MAX_COMPLETION_REMINDER_KEYS;
    if (overflow <= 0) {
      return;
    }
    const candidates = [...keys].filter((key) => key !== protectedKey);
    candidates.sort(
      (a, b) =>
        (this._completionReminderTouchOrder.get(a) ?? 0) -
        (this._completionReminderTouchOrder.get(b) ?? 0),
    );
    for (const key of candidates.slice(0, overflow)) {
      this._dropCompletionReminderKey(key);
    }
  }

  private _queueCompletionReminder(reminder: string): void {
    const key = this._pendingKey();
    const list = this._pendingCompletionReminders.get(key) ?? [];
    list.push(reminder);
    this._pendingCompletionReminders.set(key, list);
    this._completionReminderCounts.set(key, (this._completionReminderCounts.get(key) ?? 0) + 1);
    this._touchCompletionReminderKey(key);
    this._pruneCompletionReminderState(key);
  }

  private _completionReminderCountForRuntime(): number {
    return this._completionReminderCounts.get(this._pendingKey()) ?? 0;
  }

  private _drainCompletionReminders(): string[] {
    const key = this._pendingKey();
    const reminders = this._pendingCompletionReminders.get(key) ?? [];
    this._pendingCompletionReminders.delete(key);
    if (reminders.length > 0 || this._completionReminderCounts.has(key)) {
      this._touchCompletionReminderKey(key);
    }
    return reminders;
  }

  private _clearOtherRunCompletionReminders(): void {
    const [threadId, currentRunId] = this._pendingKey().split("\u0000");
    for (const key of this._completionReminderKeys()) {
      const [t, r] = key.split("\u0000");
      if (t === threadId && r !== currentRunId) {
        this._dropCompletionReminderKey(key);
      }
    }
  }

  private _clearCurrentRunCompletionReminders(): void {
    this._dropCompletionReminderKey(this._pendingKey());
  }

  // -------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------

  private _injectSystemPrompt(messages: BaseMessage[]): BaseMessage[] {
    // Find the leading system message (if any) and append the todo prompt to
    // its content. This mirrors Python's wrap_model_call behaviour of adding
    // the todo system prompt to the existing system message's content_blocks.
    const systemIndex = messages.findIndex((m) => m.getType() === "system");
    if (systemIndex >= 0) {
      const systemMsg = messages[systemIndex];
      const originalContent =
        typeof systemMsg.content === "string"
          ? systemMsg.content
          : JSON.stringify(systemMsg.content);
      const newSystem = new SystemMessage({
        id: systemMsg.id,
        content: `${originalContent}\n\n${this._systemPrompt}`,
        additional_kwargs: { ...systemMsg.additional_kwargs },
      });
      return [...messages.slice(0, systemIndex), newSystem, ...messages.slice(systemIndex + 1)];
    }
    // No system message yet; prepend one.
    return [new SystemMessage(this._systemPrompt), ...messages];
  }

  private _beforeModel(state: ThreadState): Partial<ThreadState> {
    // Python `before_agent`: drop stale reminders from previous runs.
    this._clearOtherRunCompletionReminders();

    const jumpTo = (state as { jump_to?: unknown }).jump_to;

    // Re-engagement from afterModel: clear jump_to but keep reminder count
    // (the count is tracked in state.internal and persists across cycles).
    if (jumpTo === "model") {
      return { jump_to: null } as Partial<ThreadState>;
    }

    // Fresh call (new user message or first call): reset reminder count so
    // the agent gets reminded again on this new turn.
    const internal = (state.internal ?? {}) as Record<string, unknown>;
    const updates: Partial<ThreadState> = {};
    if (internal["todo:reminderCount"] !== undefined && internal["todo:reminderCount"] !== 0) {
      updates.internal = { "todo:reminderCount": 0 };
    }

    // Python `before_model`: inject a reminder when write_todos left context.
    const todos = (state.todos ?? []) as Todo[];
    if (todos.length === 0) {
      return updates;
    }
    const messages = state.messages ?? [];
    if (todosInMessages(messages)) {
      return updates;
    }
    if (reminderInMessages(messages)) {
      return updates;
    }

    const formatted = formatTodos(todos);
    const reminder = new HumanMessage({
      name: "todo_reminder",
      additional_kwargs: { hide_from_ui: true },
      content:
        "<system_reminder>\n" +
        "Your todo list from earlier is no longer visible in the current context window, " +
        "but it is still active. Here is the current state:\n\n" +
        `${formatted}\n\n` +
        "Continue tracking and updating this todo list as you work. " +
        "Call `write_todos` whenever the status of any item changes.\n" +
        "</system_reminder>",
    });
    return { ...updates, messages: [reminder] };
  }

  private _afterModel(state: ThreadState): Partial<ThreadState> {
    const messages = state.messages ?? [];
    let lastAi: AIMessage | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i] instanceof AIMessage) {
        lastAi = messages[i] as AIMessage;
        break;
      }
    }
    if (!lastAi) {
      return {};
    }

    // 1. Base-class behavior: reject parallel write_todos calls.
    const writeTodosCalls = (lastAi.tool_calls ?? []).filter((tc) => tc.name === "write_todos");
    if (writeTodosCalls.length > 1) {
      const errorMessages = writeTodosCalls.map(
        (tc) =>
          new ToolMessage({
            content:
              "Error: The `write_todos` tool should never be called multiple times " +
              "in parallel. Please call it only once per model invocation to update " +
              "the todo list.",
            tool_call_id: tc.id ?? (tc as unknown as { tool_call_id?: string }).tool_call_id ?? "missing_id",
            status: "error",
          }),
      );
      return { messages: errorMessages };
    }

    // 2. Only intervene when the agent wants to exit cleanly.
    if (hasToolCallIntentOrError(lastAi)) {
      return {};
    }

    // 3. Allow exit when all todos are completed or there are none.
    const todos = (state.todos ?? []) as Todo[];
    if (todos.length === 0 || todos.every((t) => t.status === "completed")) {
      return {};
    }

    // 4. Enforce a reminder cap to prevent infinite re-engagement loops.
    // Track count in state.internal so it persists across cycles (afterAgent
    // runs every cycle and would reset instance-based counters).
    const internal = (state.internal ?? {}) as Record<string, unknown>;
    const reminderCount = Number(internal["todo:reminderCount"] ?? 0);
    if (reminderCount >= MAX_COMPLETION_REMINDERS) {
      return {};
    }

    // 5. Queue a reminder for the next model request and force re-engagement.
    this._queueCompletionReminder(formatCompletionReminder(todos));
    return {
      jump_to: "model",
      internal: { "todo:reminderCount": reminderCount + 1 },
    } as Partial<ThreadState>;
  }

  private _afterAgent(): Partial<ThreadState> {
    // Reminder count is tracked in state.internal (not instance state) and
    // is reset by _beforeModel on fresh calls. Pending reminder text is
    // drained by _augmentRequest in wrapModelCall. Nothing to do here.
    return {};
  }

  private _augmentRequest(request: ModelRequest): ModelRequest {
    const reminders = this._drainCompletionReminders();
    const messagesWithPrompt = this._injectSystemPrompt(request.messages);
    if (reminders.length === 0) {
      return { ...request, messages: messagesWithPrompt };
    }
    const newMessages: BaseMessage[] = [
      ...messagesWithPrompt,
      new HumanMessage({
        content: formatPendingCompletionReminders(reminders),
        name: "todo_completion_reminder",
        additional_kwargs: { hide_from_ui: true },
      }),
    ];
    return { ...request, messages: newMessages };
  }

  private async _wrapModelCall(
    request: ModelRequest,
    handler: (request: ModelRequest) => Promise<BaseMessage>,
  ): Promise<BaseMessage> {
    return handler(this._augmentRequest(request));
  }

  /** Build the MiddlewareDefinition bound to this instance. */
  definition(): MiddlewareDefinition {
    return {
      name: "TodoMiddleware",
      tools: this.tools,
      beforeModel: (state: ThreadState) => this._beforeModel(state),
      afterModel: (state: ThreadState) => this._afterModel(state),
      afterAgent: () => this._afterAgent(),
      wrapModelCall: (request, handler) => this._wrapModelCall(request, handler),
    };
  }
}

/** Todo tracker with context-loss detection and premature-exit prevention. */
export function todoMiddleware(options?: TodoMiddlewareOptions): MiddlewareDefinition {
  return new TodoMiddleware(options).definition();
}
