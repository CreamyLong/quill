/**
 * Middleware for the memory mechanism.
 *
 * Faithful port of Python `MemoryMiddleware`. After each agent execution it
 * queues the conversation (user inputs + final assistant responses only) for an
 * asynchronous, debounced memory update.
 *
 * Deviations / dependency notes (report):
 * - Python reads `thread_id` from `runtime.context` / `get_config()`. The TS
 *   `afterAgent` hook receives `state` and `config`; when no explicit `threadId`
 *   is provided it falls back to `config?.configurable?.thread_id`.
 * - `get_effective_user_id()` (quill.runtime.user_context) is not ported;
 *   pass a `getUserId` callback if per-user attribution is needed.
 */

import type { RunnableConfig } from "@langchain/core/runnables";

import type { MiddlewareDefinition } from "../factory.js";
import type { ThreadState } from "../thread_state.js";
import {
  detectCorrection,
  detectReinforcement,
  filterMessagesForMemory,
  type MessageLike,
} from "../memory/message_processing.js";
import { getMemoryConfig, type MemoryConfig } from "../../config/memory_config.js";
import type { ConversationContext, MemoryUpdateQueue } from "../memory/queue.js";
import { getMemoryQueue, type ProcessQueueCallback } from "../memory/queue_impl.js";
import { MemoryUpdater, type MemoryUpdaterOptions } from "../memory/updater.js";

export interface MemoryMiddlewareOptions {
  /** If provided, memory is stored per-agent; otherwise global memory is used. */
  agentName?: string | null;
  /** Explicit memory config; defaults to the global `getMemoryConfig()`. */
  memoryConfig?: MemoryConfig;
  /** Thread ID (normally sourced from runtime context in Python). */
  threadId?: string | null;
  /** Callback returning the effective user id captured at enqueue time. */
  getUserId?: () => string | null;
  /** Memory update queue (injected; otherwise a default queue is created). */
  queue?: MemoryUpdateQueue;
  /** Updater used by the default queue when none is supplied. */
  updater?: MemoryUpdater;
  /** Options used to build a default updater. */
  updaterOptions?: MemoryUpdaterOptions;
}

function defaultProcessCallback(options: MemoryMiddlewareOptions): ProcessQueueCallback {
  const updater = options.updater ?? new MemoryUpdater(options.updaterOptions);
  return async (contexts: ConversationContext[]) => {
    for (const ctx of contexts) {
      await updater.updateMemory(
        ctx.messages,
        ctx.thread_id,
        ctx.agent_name ?? options.agentName ?? null,
        ctx.correction_detected ?? false,
        ctx.reinforcement_detected ?? false,
        ctx.user_id ?? options.getUserId?.() ?? null
      );
    }
  };
}

function getThreadId(config: RunnableConfig | undefined, options: MemoryMiddlewareOptions): string | null {
  if (options.threadId) return options.threadId;
  const configurable = (config as unknown as { configurable?: Record<string, unknown> })?.configurable;
  const fromConfig = configurable?.thread_id;
  if (typeof fromConfig === "string") return fromConfig;
  return null;
}

/** Queue the conversation for a memory update after the agent completes. */
export function memoryMiddleware(options: MemoryMiddlewareOptions = {}): MiddlewareDefinition {
  const queue = options.queue ?? getMemoryQueue(defaultProcessCallback(options));

  return {
    name: "MemoryMiddleware",
    afterAgent: (state: ThreadState, config?: RunnableConfig): void => {
      const memoryConfig = options.memoryConfig ?? getMemoryConfig();
      if (!memoryConfig.enabled) {
        return;
      }

      const threadId = getThreadId(config, options);
      if (!threadId) {
        console.debug("No thread_id available, skipping memory update");
        return;
      }

      const messages = (state.messages ?? []) as unknown as MessageLike[];
      if (messages.length === 0) {
        console.debug("No messages in state, skipping memory update");
        return;
      }

      const filteredMessages = filterMessagesForMemory(messages);

      const userMessages = filteredMessages.filter((m) => m.type === "human");
      const assistantMessages = filteredMessages.filter((m) => m.type === "ai");
      if (userMessages.length === 0 || assistantMessages.length === 0) {
        return;
      }

      const correctionDetected = detectCorrection(filteredMessages);
      const reinforcementDetected = !correctionDetected && detectReinforcement(filteredMessages);
      const userId = options.getUserId?.() ?? null;

      const context: ConversationContext = {
        thread_id: threadId,
        messages: filteredMessages,
        timestamp: new Date().toISOString(),
        agent_name: options.agentName ?? null,
        user_id: userId,
        correction_detected: correctionDetected,
        reinforcement_detected: reinforcementDetected,
      };

      queue.add(context);
    },
  };
}
