/**
 * Built-in Quill middlewares for the JS LangGraph runtime.
 *
 * These mirror the Python middlewares used by `create_quill_agent`.  Each
 * middleware is intentionally small and stateless; any process-wide state
 * (loop counters, token budgets) is stored on the thread state so the graph
 * remains re-entrant and checkpointer-friendly.
 */

import type { BaseMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition } from "../factory.js";
import type {
  PromotedTools,
  ThreadDataState,
  ThreadState,
} from "../thread_state.js";
import { inputSanitizationMiddleware } from "./input_sanitization_middleware.js";
import { systemMessageCoalescingMiddleware } from "./system_message_coalescing_middleware.js";
import { tokenUsageMiddleware } from "./token_usage_middleware.js";
import { toolOutputBudgetMiddleware } from "./tool_output_budget_middleware.js";
import { llmErrorHandlingMiddleware } from "./llm_error_handling_middleware.js";
import { summarizationMiddleware } from "./summarization_middleware.js";
// Faithful ports — these REPLACE the earlier inline simplified versions that
// once lived in this file. They are re-exported here so existing importers
// (agents/index.ts, factory.ts) keep working without churn.
import { danglingToolCallMiddleware } from "./dangling_tool_call_middleware.js";
import { loopDetectionMiddleware } from "./loop_detection_middleware.js";
import { tokenBudgetMiddleware } from "./token_budget_middleware.js";
import { todoMiddleware } from "./todo_middleware.js";
import { viewImageMiddleware } from "./view_image_middleware.js";
import { safetyFinishReasonMiddleware } from "./safety_finish_reason_middleware.js";
import { sandboxAuditMiddleware } from "./sandbox_audit_middleware.js";
import { dynamicContextMiddleware } from "./dynamic_context_middleware.js";
import { memoryMiddleware } from "./memory_middleware.js";
import { uploadsMiddleware } from "./uploads_middleware.js";
import { sandboxMiddleware, setSandboxMiddlewareProvider } from "./sandbox_middleware.js";
import { threadDataMiddleware } from "./thread_data_middleware.js";
import { toolErrorHandlingMiddleware } from "./tool_error_handling_middleware.js";

export {
  inputSanitizationMiddleware,
  systemMessageCoalescingMiddleware,
  tokenUsageMiddleware,
  toolOutputBudgetMiddleware,
  llmErrorHandlingMiddleware,
  summarizationMiddleware,
  danglingToolCallMiddleware,
  loopDetectionMiddleware,
  tokenBudgetMiddleware,
  todoMiddleware,
  viewImageMiddleware,
  safetyFinishReasonMiddleware,
  sandboxAuditMiddleware,
  dynamicContextMiddleware,
  memoryMiddleware,
  uploadsMiddleware,
  sandboxMiddleware,
  threadDataMiddleware,
  setSandboxMiddlewareProvider,
  toolErrorHandlingMiddleware,
};

/** Uploads middleware: the faithful port lives in `uploads_middleware.ts`
 * (re-exported at the top of this file). */

/** Sandbox middleware: the lifecycle port lives in `sandbox_middleware.ts`
 * (re-exported at the top of this file). */

/** Plan-mode todo tracker: the faithful port lives in `todo_middleware.ts`
 * (re-exported at the top of this file). */

/** Generate a run title from the first user message. */
export function titleMiddleware(): MiddlewareDefinition {
  return {
    name: "TitleMiddleware",
    beforeModel: (state) => {
      if (state.title !== undefined && state.title !== null) {
        return {};
      }
      const firstUser = state.messages?.find((m) => m.getType() === "human");
      if (!firstUser) {
        return {};
      }
      const text = String(firstUser.content ?? "").trim();
      const title = text.length > 60 ? `${text.slice(0, 57)}...` : text;
      return { title: title || "New chat" };
    },
  };
}

/** Vision middleware: the faithful port lives in `view_image_middleware.ts`
 * (re-exported at the top of this file). */

/** Detect repetitive tool-call loops and force the agent to stop: the faithful
 * port lives in `loop_detection_middleware.ts` (re-exported at the top). */

/** Enforce a per-run token budget: the faithful port lives in
 * `token_budget_middleware.ts` (re-exported at the top). */

/** Clarification middleware: ask the user when a query is ambiguous. */
export function clarificationMiddleware(
  isAmbiguous?: (state: ThreadState) => boolean
): MiddlewareDefinition {
  return {
    name: "ClarificationMiddleware",
    beforeModel: async (state) => {
      if (isAmbiguous?.(state)) {
        const { AIMessage } = await import("@langchain/core/messages");
        return {
          messages: [
            new AIMessage(
              "I need a bit more detail to answer that. Could you clarify what you'd like to know?"
            ),
          ],
        };
      }
      return {};
    },
  };
}

/** Promote a set of deferred tools by name so DanglingToolCall accepts them. */
export function promoteToolsMiddleware(promoted: PromotedTools): MiddlewareDefinition {
  return {
    name: "PromoteToolsMiddleware",
    beforeModel: () => ({ promoted }),
  };
}
