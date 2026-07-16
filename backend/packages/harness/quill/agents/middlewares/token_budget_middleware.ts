/**
 * Middleware to enforce per-run token budget limits.
 *
 * Faithful port of Python `TokenBudgetMiddleware`. Tracks cumulative token
 * usage across model calls within a run and enforces soft-warning and hard-stop
 * thresholds. Warnings use the deferred pattern: `afterModel` queues, and
 * `wrapModelCall` injects a HumanMessage at the next model call so the
 * AIMessage(tool_calls) → ToolMessage pairing is preserved.
 *
 * Deviations (noted in report):
 * - Python keys all bookkeeping by `run_id` from `runtime.context`. The TS
 *   hooks resolve `run_id` from the LangGraph `config.configurable.run_id`
 *   (or `request.runId` for `wrapModelCall`) so each run is scoped correctly.
 * - `threading.Lock` is dropped — JS is single-threaded.
 */

import { AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";

import type { MiddlewareDefinition, ModelRequest } from "../factory.js";
import type { ThreadState } from "../thread_state.js";
import type { TokenBudgetConfig } from "../../config/token_budget_config.js";
import {
  cloneAiMessageWithToolCalls,
  type MessageLike,
} from "./tool_call_metadata.js";

const BUDGET_WARNING_MSG = (
  used: number,
  budget: number,
  reason: string,
  percent: number
): string =>
  `[TOKEN BUDGET WARNING] You have used ${used.toLocaleString("en-US")} of your ` +
  `${budget.toLocaleString("en-US")} ${reason} token budget (${percent.toFixed(0)}%). ` +
  "Wrap up your current work and produce a final answer. Avoid starting new tool " +
  "calls unless absolutely necessary.";

const BUDGET_EXCEEDED_MSG = (used: number, budget: number, reason: string): string =>
  `[TOKEN BUDGET EXCEEDED] The ${reason} token usage (${used.toLocaleString("en-US")}) ` +
  `has exceeded the safety limit (${budget.toLocaleString("en-US")}). Producing final ` +
  "answer with results collected so far.";

interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

/** A bounded map to prevent unbounded state growth on abandoned runs. */
class BoundedMap<V> extends Map<string, V> {
  constructor(private readonly maxsize = 1000) {
    super();
  }

  override set(key: string, value: V): this {
    if (!this.has(key) && this.size >= this.maxsize) {
      const oldest = this.keys().next().value;
      if (oldest !== undefined) {
        this.delete(oldest);
      }
    }
    return super.set(key, value);
  }
}

/** Resolve a run id from the LangGraph run config. */
function resolveRunId(runConfig?: RunnableConfig): string {
  const configurable = runConfig?.configurable as { run_id?: unknown } | undefined;
  if (configurable && typeof configurable.run_id === "string" && configurable.run_id) {
    return configurable.run_id;
  }
  return "default";
}

function appendText(content: unknown, stopMsg: string): string | unknown[] {
  if (content === null || content === undefined) {
    return stopMsg;
  }
  if (typeof content === "string") {
    return content ? `${content}\n\n${stopMsg}` : `\n\n${stopMsg}`;
  }
  if (Array.isArray(content)) {
    return [...content, { type: "text", text: `\n\n${stopMsg}` }];
  }
  return `${String(content)}\n\n${stopMsg}`;
}

/** Enforce per-run token budget limits. */
export function tokenBudgetMiddleware(config: TokenBudgetConfig): MiddlewareDefinition {
  const warned = new BoundedMap<boolean>(1000);
  const pendingWarnings = new BoundedMap<string[]>(1000);
  const seenMessages = new BoundedMap<Map<string, [number, number]>>(1000);
  const cumulativeUsage = new BoundedMap<TokenUsage>(1000);
  const baselinedRuns = new Set<string>();

  const getRunId = (runConfig?: RunnableConfig): string => resolveRunId(runConfig);

  const clearRunState = (runId: string): void => {
    warned.delete(runId);
    pendingWarnings.delete(runId);
    seenMessages.delete(runId);
    cumulativeUsage.delete(runId);
    baselinedRuns.delete(runId);
  };

  const buildHardStopUpdate = (msg: AIMessage, stopMsg: string): Partial<ThreadState> => {
    const updatedContent = appendText(msg.content, stopMsg);
    const stopped = cloneAiMessageWithToolCalls(msg as unknown as MessageLike, [], {
      content: updatedContent,
    });
    return { messages: [stopped as unknown as BaseMessage] };
  };

  const apply = (state: ThreadState, runConfig?: RunnableConfig): Partial<ThreadState> => {
    if (!config.enabled) {
      return {};
    }
    const messages = state.messages ?? [];
    if (messages.length === 0) {
      return {};
    }
    const lastMsg = messages[messages.length - 1];
    if (!(lastMsg instanceof AIMessage)) {
      return {};
    }

    const runId = getRunId(runConfig);
    const seen = seenMessages.get(runId) ?? new Map<string, [number, number]>();
    seenMessages.set(runId, seen);
    const usageAccum = cumulativeUsage.get(runId) ?? { input: 0, output: 0, total: 0 };
    cumulativeUsage.set(runId, usageAccum);

    for (const msg of messages) {
      if (msg instanceof AIMessage && msg.id && msg.usage_metadata) {
        const usage = msg.usage_metadata;
        const inputTokens = usage.input_tokens ?? 0;
        const outputTokens = usage.output_tokens ?? 0;

        const [prevInput, prevOutput] = seen.get(msg.id) ?? [0, 0];
        const diffInput = Math.max(0, inputTokens - prevInput);
        const diffOutput = Math.max(0, outputTokens - prevOutput);

        if (diffInput > 0 || diffOutput > 0) {
          usageAccum.input += diffInput;
          usageAccum.output += diffOutput;
          usageAccum.total += diffInput + diffOutput;
          seen.set(msg.id, [inputTokens, outputTokens]);
        }
      }
    }

    if (usageAccum.total <= 0) {
      return {};
    }

    const fractions: Array<[string, number, number]> = [
      ["total", usageAccum.total, config.maxTokens],
    ];
    if (config.maxInputTokens) {
      fractions.push(["input", usageAccum.input, config.maxInputTokens]);
    }
    if (config.maxOutputTokens) {
      fractions.push(["output", usageAccum.output, config.maxOutputTokens]);
    }

    let highestFraction = 0;
    let triggerReason = "";
    let triggerUsed = 0;
    let triggerBudget = 0;
    for (const [reason, used, limit] of fractions) {
      const frac = used / limit;
      if (frac > highestFraction) {
        highestFraction = frac;
        triggerReason = reason;
        triggerUsed = used;
        triggerBudget = limit;
      }
    }

    if (highestFraction >= config.hardStopThreshold) {
      console.warn(
        `Token budget hard stop triggered for run ${runId}: ${triggerReason} limit exceeded`
      );
      const stopText = BUDGET_EXCEEDED_MSG(triggerUsed, triggerBudget, triggerReason);
      return buildHardStopUpdate(lastMsg, stopText);
    }

    if (highestFraction >= config.warnThreshold && !warned.get(runId)) {
      warned.set(runId, true);
      const percent = highestFraction * 100;
      const warnText = BUDGET_WARNING_MSG(triggerUsed, triggerBudget, triggerReason, percent);
      console.info(
        `Token budget warning triggered for run ${runId}: ${triggerReason} limit at ${percent.toFixed(1)}%`
      );
      const warnings = pendingWarnings.get(runId) ?? [];
      warnings.push(warnText);
      pendingWarnings.set(runId, warnings);
      return {};
    }

    return {};
  };

  return {
    name: "TokenBudgetMiddleware",
    beforeModel: (state: ThreadState, runConfig?: RunnableConfig) => {
      // Mirror Python `before_agent`: mark messages from previous runs as
      // 'seen' so they don't count toward this run's budget. Guarded to run
      // once per agent turn since `beforeModel` fires every model step.
      if (!config.enabled) {
        return {};
      }
      const messages = state.messages ?? [];
      if (messages.length === 0) {
        return {};
      }
      const runId = getRunId(runConfig);
      if (baselinedRuns.has(runId)) {
        return {};
      }
      baselinedRuns.add(runId);

      const seen = seenMessages.get(runId) ?? new Map<string, [number, number]>();
      seenMessages.set(runId, seen);
      if (!cumulativeUsage.has(runId)) {
        cumulativeUsage.set(runId, { input: 0, output: 0, total: 0 });
      }
      for (const msg of messages) {
        if (msg instanceof AIMessage && msg.id && msg.usage_metadata) {
          const usage = msg.usage_metadata;
          seen.set(msg.id, [usage.input_tokens ?? 0, usage.output_tokens ?? 0]);
        }
      }
      return {};
    },
    afterModel: (state: ThreadState, runConfig?: RunnableConfig) => apply(state, runConfig),
    afterAgent: (_state: ThreadState, runConfig?: RunnableConfig) => {
      if (!config.enabled) {
        return {};
      }
      clearRunState(getRunId(runConfig));
      return {};
    },
    wrapModelCall: async (request: ModelRequest, handler) => {
      if (!config.enabled) {
        return handler(request);
      }
      const runId = request.runId ?? "default";
      const warnings = pendingWarnings.get(runId);
      pendingWarnings.delete(runId);
      if (!warnings || warnings.length === 0) {
        return handler(request);
      }
      const { HumanMessage } = await import("@langchain/core/messages");
      const warningMsg = new HumanMessage({
        content: warnings.join("\n\n"),
        name: "budget_warning",
      });
      return handler({ messages: [...request.messages, warningMsg], runId });
    },
  };
}
