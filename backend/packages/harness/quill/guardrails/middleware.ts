/**
 * GuardrailMiddleware - evaluates tool calls against a GuardrailProvider before execution.
 */

import { ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { isGraphBubbleUp } from "@langchain/langgraph";

import { STATE_UPDATE, type MiddlewareDefinition, type ThreadState, type ToolCallRequest } from "../agents/factory.js";
import type { GuardrailDecision, GuardrailProvider, GuardrailRequest } from "./provider.js";

export interface GuardrailMiddlewareOptions {
  failClosed?: boolean;
  passport?: string | null;
}

/**
 * Evaluate tool calls against a GuardrailProvider before execution.
 *
 * Denied calls return an error ToolMessage so the agent can adapt.
 * If the provider raises, behavior depends on failClosed:
 *   - true (default): block the call
 *   - false: allow it through with a warning
 *
 * The Python original exposes both a synchronous ``wrap_tool_call`` and an
 * asynchronous ``awrap_tool_call``. The TS tool node is uniformly async, so the
 * two collapse into the single async ``wrapToolCall`` here (mirrors the Python
 * async path, ``aevaluate``).
 */
export class GuardrailMiddleware {
  readonly name = "GuardrailMiddleware";
  readonly provider: GuardrailProvider;
  readonly failClosed: boolean;
  readonly passport: string | null;

  constructor(provider: GuardrailProvider, options: GuardrailMiddlewareOptions = {}) {
    this.provider = provider;
    this.failClosed = options.failClosed ?? true;
    this.passport = options.passport ?? null;
  }

  private buildRequest(request: ToolCallRequest): GuardrailRequest {
    // The Python original reads per-run metadata from ``request.runtime.context``.
    // The TS ToolCallRequest does not carry a runtime context, so this gracefully
    // falls back to an empty object (matching Python's ``getattr`` defaults).
    const runtime = (request as { runtime?: { context?: unknown } }).runtime;
    const rawContext = runtime != null ? runtime.context : undefined;
    const context: Record<string, unknown> =
      rawContext != null && typeof rawContext === "object" && !Array.isArray(rawContext)
        ? (rawContext as Record<string, unknown>)
        : {};

    return {
      toolName: String(request.name ?? ""),
      toolInput: request.args ?? {},
      agentId: this.passport,
      threadId: (context["thread_id"] as string | null | undefined) ?? null,
      isSubagent: Boolean(context["is_subagent"]),
      timestamp: new Date().toISOString(),
      userId: (context["user_id"] as string | null | undefined) ?? null,
      userRole: (context["user_role"] as string | null | undefined) ?? null,
      oauthProvider: (context["oauth_provider"] as string | null | undefined) ?? null,
      oauthId: (context["oauth_id"] as string | null | undefined) ?? null,
      runId: (context["run_id"] as string | null | undefined) ?? null,
      toolCallId: request.tool_call_id ?? null,
    };
  }

  private buildDeniedMessage(request: ToolCallRequest, decision: GuardrailDecision): ToolMessage {
    const toolName = request.name || "unknown_tool";
    const toolCallId = request.tool_call_id || "missing_id";
    const reasonText =
      decision.reasons.length > 0 ? (decision.reasons[0].message ?? "") : "blocked by guardrail policy";
    const reasonCode = decision.reasons.length > 0 ? decision.reasons[0].code : "oap.denied";
    return new ToolMessage({
      content: `Guardrail denied: tool '${toolName}' was blocked (${reasonCode}). Reason: ${reasonText}. Choose an alternative approach.`,
      tool_call_id: toolCallId,
      name: toolName,
      status: "error",
    });
  }

  async wrapToolCall(
    request: ToolCallRequest,
    handler: (request: ToolCallRequest) => Promise<BaseMessage | Partial<ThreadState>>
  ): Promise<BaseMessage | Partial<ThreadState>> {
    const gr = this.buildRequest(request);
    let decision: GuardrailDecision;
    try {
      decision = await this.provider.aevaluate(gr);
    } catch (err) {
      // Preserve LangGraph control-flow signals (interrupt/pause/resume).
      if (isGraphBubbleUp(err)) {
        throw err;
      }
      console.error("Guardrail provider error (async)", err);
      if (this.failClosed) {
        decision = {
          allow: false,
          reasons: [{ code: "oap.evaluator_error", message: "guardrail provider error (fail-closed)" }],
        };
      } else {
        return handler(request);
      }
    }
    if (!decision.allow) {
      const code = decision.reasons.length > 0 ? decision.reasons[0].code : "unknown";
      console.warn(
        `Guardrail denied: tool=${gr.toolName} policy=${String(decision.policyId ?? null)} code=${code}`
      );
      return this.buildDeniedMessage(request, decision);
    }
    return handler(request);
  }

  /** Adapt this middleware to the factory's MiddlewareDefinition shape. */
  toMiddleware(): MiddlewareDefinition {
    return {
      name: this.name,
      wrapToolCall: (request, handler) => this.wrapToolCall(request, handler),
    };
  }
}

/** Factory helper returning a MiddlewareDefinition for the guardrail middleware. */
export function guardrailMiddleware(
  provider: GuardrailProvider,
  options: GuardrailMiddlewareOptions = {}
): MiddlewareDefinition {
  return new GuardrailMiddleware(provider, options).toMiddleware();
}
