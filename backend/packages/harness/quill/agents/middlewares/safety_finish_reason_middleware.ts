/**
 * Suppress tool execution when the provider safety-terminated the response.
 *
 * Faithful port of Python `SafetyFinishReasonMiddleware` (see issue
 * scitops/scitops#3028). When a configured `SafetyTerminationDetector` fires
 * and the AIMessage carries tool calls, the tool calls are stripped (structured
 * and raw provider payloads), a user-facing explanation is appended, and
 * observability fields are stashed in `additional_kwargs.safety_termination`.
 *
 * Hook choice: `afterModel` — the response is a normal return (not an
 * exception), and we participate in the same after-model chain as
 * LoopDetectionMiddleware.
 *
 * Deviations from Python (noted in report):
 * - `_emit_event` (stream writer) and `_record_audit_event` (RunJournal) require
 *   `runtime`/`get_stream_writer`, neither of which is available to the TS
 *   `afterModel` hook (which receives only `state`). Those side-effects degrade
 *   to a `console.warn` log; the message-rewriting contract is preserved.
 * - `from_config` reflection-based detector resolution (`resolve_variable`) is
 *   not ported; pass detectors explicitly instead.
 */

import { AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import type { MiddlewareDefinition } from "../factory.js";
import type { ThreadState } from "../thread_state.js";
import {
  cloneAiMessageWithToolCalls,
  type MessageLike,
} from "./tool_call_metadata.js";
import {
  defaultDetectors,
  type SafetyTermination,
  type SafetyTerminationDetector,
} from "./safety_termination_detectors.js";

function userFacingMessage(termination: SafetyTermination): string {
  return (
    "The model provider stopped this response with a safety-related signal " +
    `(${termination.reason_field}=${JSON.stringify(termination.reason_value)}, ` +
    `detector=${JSON.stringify(termination.detector)}). Any tool ` +
    "calls produced in this turn were suppressed because their arguments " +
    "may be truncated and unsafe to execute. Please rephrase the request " +
    "or ask for a narrower output."
  );
}

/** Run each detector; return the first hit, tolerating buggy detectors. */
function detect(
  detectors: SafetyTerminationDetector[],
  message: AIMessage
): SafetyTermination | null {
  for (const detector of detectors) {
    let hit: SafetyTermination | null;
    try {
      hit = detector.detect(message);
    } catch {
      // Never let a buggy detector break the agent run.
      console.warn(
        `SafetyTerminationDetector ${detector.name} raised; treating as no-match`
      );
      continue;
    }
    if (hit !== null) {
      return hit;
    }
  }
  return null;
}

/**
 * Append a plain-text explanation to AIMessage content, preserving list-content
 * structure (Anthropic thinking blocks, vLLM reasoning splits).
 */
function appendUserMessage(content: unknown, text: string): string | unknown[] {
  if (content === null || content === undefined || content === "") {
    return text;
  }
  if (Array.isArray(content)) {
    return [...content, { type: "text", text: `\n\n${text}` }];
  }
  if (typeof content === "string") {
    return content + `\n\n${text}`;
  }
  return String(content) + `\n\n${text}`;
}

function buildSuppressedMessage(
  message: AIMessage,
  termination: SafetyTermination
): MessageLike {
  const toolCalls = (message.tool_calls ?? []) as Array<Record<string, unknown>>;
  const suppressedNames = toolCalls.map((tc) => (tc.name as string) || "unknown");
  const explanation = userFacingMessage(termination);
  const newContent = appendUserMessage(message.content, explanation);

  // clone handles structured tool_calls, raw additional_kwargs.tool_calls, and
  // function_call in one shot. It only rewrites finish_reason when the old value
  // was "tool_calls" — not our case — so content_filter / refusal / SAFETY stay.
  const cleared = cloneAiMessageWithToolCalls(message as unknown as MessageLike, [], {
    content: newContent,
  });

  const kwargs: Record<string, unknown> = { ...(cleared.additional_kwargs ?? {}) };
  kwargs["safety_termination"] = {
    detector: termination.detector,
    reason_field: termination.reason_field,
    reason_value: termination.reason_value,
    suppressed_tool_call_count: suppressedNames.length,
    suppressed_tool_call_names: suppressedNames,
    extras: termination.extras ? { ...termination.extras } : {},
  };
  cleared.additional_kwargs = kwargs;
  return cleared;
}

function apply(
  detectors: SafetyTerminationDetector[],
  state: ThreadState
): Partial<ThreadState> {
  const messages = state.messages ?? [];
  if (messages.length === 0) {
    return {};
  }

  const last = messages[messages.length - 1];
  if (!(last instanceof AIMessage)) {
    return {};
  }

  // Only intervene when there's something to suppress. content_filter without
  // tool_calls is allowed through unchanged so any partial text reaches the user.
  const toolCalls = last.tool_calls ?? [];
  if (toolCalls.length === 0) {
    return {};
  }

  const termination = detect(detectors, last);
  if (termination === null) {
    return {};
  }

  const patched = buildSuppressedMessage(last, termination);

  console.warn(
    `Provider safety termination detected — suppressed ${toolCalls.length} tool call(s) ` +
      `(detector=${termination.detector}, ${termination.reason_field}=${termination.reason_value})`
  );

  return { messages: [patched as unknown as BaseMessage] };
}

/**
 * Strip tool_calls from AIMessages flagged by a SafetyTerminationDetector.
 *
 * @param detectors Detector list; defaults to the built-in set when omitted or
 *   empty (matching Python's `default_detectors()` fallback).
 */
export function safetyFinishReasonMiddleware(
  detectors?: SafetyTerminationDetector[] | null
): MiddlewareDefinition {
  // Copy so caller mutations after construction don't leak into us.
  const resolved =
    detectors && detectors.length > 0 ? [...detectors] : defaultDetectors();
  return {
    name: "SafetyFinishReasonMiddleware",
    afterModel: (state: ThreadState) => apply(resolved, state),
  };
}
