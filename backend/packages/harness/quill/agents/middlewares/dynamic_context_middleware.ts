/**
 * Middleware to inject dynamic context (memory, current date) as a system-reminder.
 *
 * Mirrors Python `DynamicContextMiddleware`. The static system prompt is kept
 * fully static for prefix-cache reuse. The current date is always injected.
 * Per-user memory is injected when `memory.injectionEnabled` is True.
 *
 * First turn: a full reminder (memory + date) is inserted before the first
 * HumanMessage using the ID-swap technique so add_messages replaces it in place.
 * Midnight crossing: a lightweight date-update reminder is inserted before the
 * current (last) HumanMessage.
 */

import crypto from "node:crypto";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition } from "../factory.js";
import type { ThreadState } from "../thread_state.js";
import { getMemoryContext } from "../memory/updater.js";

export const DYNAMIC_CONTEXT_REMINDER_KEY = "dynamic_context_reminder";
export const REMINDER_DATE_KEY = "reminder_date";
export const SUMMARY_MESSAGE_NAME = "summary";

const DATE_RE = /<current_date>([^\u003c]+)<\/current_date>/;
const INJECT_TIMEOUT_MS = 5000;

function extractDate(content: string): string | null {
  const m = DATE_RE.exec(content);
  return m ? m[1] : null;
}

/** Return whether a message is a hidden dynamic-context reminder. */
export function isDynamicContextReminder(message: BaseMessage): boolean {
  return message.additional_kwargs?.[DYNAMIC_CONTEXT_REMINDER_KEY] === true;
}

function lastInjectedDate(messages: BaseMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!isDynamicContextReminder(msg)) continue;
    const structured = msg.additional_kwargs?.[REMINDER_DATE_KEY];
    if (typeof structured === "string" && structured) {
      return structured;
    }
    if (msg.getType() === "system") {
      const contentStr = typeof msg.content === "string" ? msg.content : String(msg.content);
      const date = extractDate(contentStr);
      if (date) return date;
    }
  }
  return null;
}

function isUserInjectionTarget(message: BaseMessage): boolean {
  if (message.getType() !== "human") return false;
  if (isDynamicContextReminder(message)) return false;
  if (message.name === SUMMARY_MESSAGE_NAME) return false;
  if (message.id && String(message.id).endsWith("__user")) return false;
  return true;
}

function currentDateString(): string {
  const now = new Date();
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const weekday = weekdays[now.getDay()];
  const date = now.toISOString().slice(0, 10);
  return `${date}, ${weekday}`;
}

export interface DynamicContextMiddlewareOptions {
  agentName?: string | null;
  /** Callback returning the effective user id. */
  getUserId?: () => string | null;
  /** Optional override for loading the memory block. */
  getMemoryContext?: (agentName: string | null, userId: string | null) => string;
}

function resolveMemoryContext(options: DynamicContextMiddlewareOptions): string {
  const userId = options.getUserId?.() ?? null;
  if (options.getMemoryContext) {
    return options.getMemoryContext(options.agentName ?? null, userId).trim();
  }
  return getMemoryContext(options.agentName ?? null, userId).trim();
}

function buildDateReminder(): string {
  const currentDate = currentDateString();
  return ["<system-reminder>", `<current_date>${currentDate}</current_date>`, "</system-reminder>"].join("\n");
}

function makeReminderAndUserMessages(
  original: HumanMessage,
  reminderContent: string,
  memoryContent: string | null,
  reminderDate: string
): BaseMessage[] {
  const stableId = original.id ?? crypto.randomUUID();
  const messages: BaseMessage[] = [];

  const reminderKwargs: Record<string, unknown> = {
    hide_from_ui: true,
    [DYNAMIC_CONTEXT_REMINDER_KEY]: true,
    [REMINDER_DATE_KEY]: reminderDate,
  };
  messages.push(
    new SystemMessage({
      content: reminderContent,
      id: stableId,
      additional_kwargs: reminderKwargs,
    })
  );

  if (memoryContent) {
    messages.push(
      new HumanMessage({
        content: memoryContent,
        id: `${stableId}__memory`,
        additional_kwargs: { hide_from_ui: true, [DYNAMIC_CONTEXT_REMINDER_KEY]: true },
      })
    );
  }

  messages.push(
    new HumanMessage({
      content: original.content,
      id: `${stableId}__user`,
      name: original.name,
      additional_kwargs: { ...original.additional_kwargs },
    })
  );

  return messages;
}

function inject(state: ThreadState, options: DynamicContextMiddlewareOptions): { messages: BaseMessage[] } | null {
  const messages = state.messages ?? [];
  if (messages.length === 0) return null;

  const currentDate = currentDateString();
  const lastDate = lastInjectedDate(messages);

  if (lastDate === null) {
    const firstIdx = messages.findIndex((m) => isUserInjectionTarget(m));
    if (firstIdx < 0) return null;
    const target = messages[firstIdx];
    const memoryBlock = resolveMemoryContext(options) || null;
    const result = makeReminderAndUserMessages(
      target as HumanMessage,
      buildDateReminder(),
      memoryBlock,
      currentDate
    );
    return { messages: result };
  }

  if (lastDate === currentDate) {
    return null;
  }

  // Midnight crossing: inject a date-update reminder before the current turn.
  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isUserInjectionTarget(messages[i])) {
      lastHumanIdx = i;
      break;
    }
  }
  if (lastHumanIdx < 0) return null;
  const target = messages[lastHumanIdx];
  const result = makeReminderAndUserMessages(
    target as HumanMessage,
    buildDateReminder(),
    null,
    currentDate
  );
  return { messages: result };
}

/** Inject memory and current date as a system-reminder. */
export function dynamicContextMiddleware(
  options: DynamicContextMiddlewareOptions = {}
): MiddlewareDefinition {
  return {
    name: "DynamicContextMiddleware",
    beforeModel: (state: ThreadState): Partial<ThreadState> | void => {
      let result: { messages: BaseMessage[] } | null = null;
      const start = Date.now();
      try {
        result = inject(state, options);
      } catch (error) {
        console.warn("DynamicContextMiddleware: injection failed:", error);
        return {};
      }
      if (Date.now() - start > INJECT_TIMEOUT_MS) {
        console.warn("DynamicContextMiddleware: injection timed out; skipping memory/date injection");
        return {};
      }
      return result ?? {};
    },
  };
}
