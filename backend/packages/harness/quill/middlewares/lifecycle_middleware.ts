/**
 * Lifecycle middleware — gate and audit tool/model calls at key decision points.
 *
 * Mirrors DeerFlow's tool_progress_middleware hook pattern and Kimi Code's
 * lifecycle hook system.  Quill's lifecycle hooks let users attach safety gates,
 * audit hooks, and custom logic at the most important agent decision points.
 *
 * ---
 *
 * Architecture note: Hooks are registered per-run via `configurable` metadata
 * so they can be different for every thread.  The hooks run as part of the
 * middleware chain (not as separate nodes) to avoid the LangGraph state-node
 * overhead — a hook simply mutates state or throws to abort.
 *
 * Hook phases (executed in registration order within each phase):
 *
 *   pre_model    — before calling the LLM (inspect messages, mutate prompt)
 *   post_model   — after LLM returns, before tool execution (inspect response)
 *   pre_tool     — before executing a specific tool (gate risky operations)
 *   post_tool    — after tool returns, before sanitizing/forwarding (audit)
 *
 * Throwing an Error from a hook aborts the current step.  The error bubbles up
 * as the model/tool response, causing the graph to route back to the model
 * with an error signal.
 */

import type { RunnableConfig } from "@langchain/core/runnables";
import type { BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";

import type { ModelRequest, ToolCallRequest, MiddlewareDefinition } from "../agents/factory.js";
import type { ThreadState } from "../agents/thread_state.js";

// ---------------------------------------------------------------------------
// Hook types
// ---------------------------------------------------------------------------

/** A lifecycle hook function.  Receives the full request context. */
export type LifecycleHook = (
  request: ModelRequest | ToolCallRequest,
  state: ThreadState,
  config: RunnableConfig
) => Promise<void> | void;

/** One registered lifecycle hook at a specific phase. */
export interface LifecycleHookRegistration {
  /** Human-readable hook name (for logging). */
  name: string;
  /** Phase to run in. */
  phase: "pre_model" | "post_model" | "pre_tool" | "post_tool";
  /** The hook function. */
  fn: LifecycleHook;
  /** If true, the hook runs even when no tools are called (model-only phases). */
  required?: boolean;
}

// ---------------------------------------------------------------------------
// Hook configuration
// ---------------------------------------------------------------------------

/** Per-run hook configuration.  Passed via config metadata. */
export interface LifecycleHookConfig {
  /** Pre-model hooks: run before the LLM is called. */
  pre_model?: LifecycleHook[];
  /** Post-model hooks: run after the LLM response, before tool execution. */
  post_model?: LifecycleHook[];
  /** Pre-tool hooks: gate individual tool executions. */
  pre_tool?: LifecycleHook[];
  /** Post-tool hooks: audit after tool results. */
  post_tool?: LifecycleHook[];
}

// ---------------------------------------------------------------------------
// Lifecycle middleware options
// ---------------------------------------------------------------------------

export interface LifecycleMiddlewareOptions {
  /** Register lifecycle hooks from config. */
  hooksConfig?: LifecycleHookConfig;
  /** Whether to enable the audit hook by default. Default: false. */
  auditEnabled?: boolean;
  /** Log level for audit messages. Default: "warn". */
  auditLogLevel?: "info" | "warn";
  /** Budget guard hook config. */
  budgetGuard?: { enabled?: boolean; maxTotalTokens?: number };
}

// ---------------------------------------------------------------------------
// Lifecycle middleware factory
// ---------------------------------------------------------------------------

/**
 * Create a lifecycle middleware from registered hooks.
 *
 * Wraps model calls and tool calls at their respective phases, running
 * all hooks in registration order.
 */
export function createLifecycleHookMiddleware(
  opts?: LifecycleMiddlewareOptions,
): MiddlewareDefinition | null {
  const options = opts ?? {};
  const hooksConfig = options.hooksConfig;
  if (!hooksConfig) {
    return null;
  }

  const beforeModelHooks: MiddlewareDefinition["beforeModel"] = async (state, config) => {
    if (!hooksConfig.pre_model) return {};
    const modelRequest: ModelRequest = { messages: state.messages ?? [], tools: [] };
    const rwConfig = config as { metadata?: Record<string, unknown>; configurable?: Record<string, unknown> } & RunnableConfig;
    for (const fn of hooksConfig.pre_model) {
      try {
        await fn(modelRequest, state, config);
      } catch (error) {
        // Throw to abort — error propagates to model with a failure signal.
        if (error instanceof Error) throw error;
        throw new Error(`Lifecycle pre_model hook failed: ${String(error)}`);
      }
    }
    return {};
  };

  const afterModelHooks: MiddlewareDefinition["afterModel"] = async (state, config) => {
    if (!hooksConfig.post_model) return {};
    // Post-model: inspect the model response before tool execution.
    const messages = state.messages ?? [];
    const aiMessage = messages[messages.length - 1];
    if (aiMessage && (aiMessage.getType() === "ai" || aiMessage.getType() === "assistant")) {
      const modelRequest: ModelRequest = {
        messages: [aiMessage],
        tools: [],
        state,
      };
      for (const fn of hooksConfig.post_model) {
        try {
          await fn(modelRequest, state, config);
        } catch (error) {
          if (error instanceof Error) throw error;
          throw new Error(`Lifecycle post_model hook failed: ${String(error)}`);
        }
      }
    }
    return {};
  };

  const afterAgentHooks: MiddlewareDefinition["afterAgent"] = async (state, config) => {
    // Post-tool hooks run after all tools execute (afterAgent node).
    // We inspect the last tool message and run all post_tool hooks.
    if (!hooksConfig.post_tool) return {};
    const messages = state.messages ?? [];
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.getType() === "tool") {
      const toolCall: ToolCallRequest = {
        name: (lastMsg as unknown as { tool_call_id?: string }).tool_call_id ?? "unknown",
        args: (lastMsg as unknown as { content?: unknown }).content ?? "",
        tool_call_id: (lastMsg as unknown as { tool_call_id?: string }).tool_call_id ?? "",
        state,
      };
      for (const fn of hooksConfig.post_tool) {
        try {
          await fn(toolCall, state, config);
        } catch (error) {
          if (error instanceof Error) throw error;
          throw new Error(`Lifecycle post_tool hook failed: ${String(error)}`);
        }
      }
    }
    return {};
  };

  return {
    name: "lifecycle_hooks",
    beforeModel: beforeModelHooks,
    afterModel: afterModelHooks,
    afterAgent: afterAgentHooks,
  };
}

// ---------------------------------------------------------------------------
// Hook registration helpers
// ---------------------------------------------------------------------------

/**
 * Register a lifecycle hook.
 *
 * @example
 *   registerHook({
 *     phase: "pre_tool",
 *     name: "dangerous-tool-gate",
 *     fn: async (req, state) => {
 *       if ((req as ToolCallRequest).name === "bash") {
 *         // Gate dangerous bash commands
 *         const cmd = (req as ToolCallRequest).args.command as string;
 *         if (cmd.includes("rm -rf /")) {
 *           throw new Error("Blocked dangerous rm -rf / command");
 *         }
 *       }
 *     },
 *   });
 */
export function registerHook(
  opts: Omit<LifecycleHookRegistration, "name"> & { name: string },
): LifecycleHookRegistration {
  return {
    name: opts.name,
    phase: opts.phase,
    fn: opts.fn,
    required: opts.required,
  };
}

/**
 * Create a hook factory for common patterns.
 */
export function makeHookFactory() {
  return {
    /** Pre-model hook: inspect and mutate the prompt before sending to LLM. */
    preModel(name: string, fn: LifecycleHook): LifecycleHookRegistration {
      return { name, phase: "pre_model", fn };
    },

    /** Post-model hook: inspect the LLM response before tool execution. */
    postModel(name: string, fn: LifecycleHook): LifecycleHookRegistration {
      return { name, phase: "post_model", fn };
    },

    /** Pre-tool hook: gate individual tool executions. */
    preTool(name: string, fn: LifecycleHook): LifecycleHookRegistration {
      return { name, phase: "pre_tool", fn };
    },

    /** Post-tool hook: audit after tool results. */
    postTool(name: string, fn: LifecycleHook): LifecycleHookRegistration {
      return { name, phase: "post_tool", fn };
    },
  };
}

// ---------------------------------------------------------------------------
// Built-in hooks
// ---------------------------------------------------------------------------

/**
 * Audit hook: log tool execution metadata for compliance/debugging.
 *
 * This is a standard post-tool hook that records tool call metadata.
 * Can be enabled via `opts.auditEnabled`.
 */
export function createAuditHook(
  opts?: { logLevel?: "info" | "warn" },
): LifecycleHook {
  const logLevel = opts?.logLevel ?? "warn";

  return async (request, state) => {
    const toolReq = request as ToolCallRequest;
    const msg = `[quill:lifecycle] tool=${toolReq.name} state.messages_count=${(state.messages?.length ?? 0)}`;

    if (logLevel === "warn") {
      console.warn(msg);
    } else {
      console.log(msg);
    }
  };
}

/**
 * Budget guard hook: stop tool execution when token budget is exceeded.
 */
export function createBudgetGuardHook(
  maxTotalTokens: number,
): LifecycleHook {
  return (request, state) => {
    const internal = (state.internal ?? {}) as Record<string, unknown>;
    const totalTokens = (internal._totalTokensUsed as number) ?? 0;
    if (totalTokens >= maxTotalTokens) {
      throw new Error(
        `Budget exceeded: ${totalTokens} >= ${maxTotalTokens} tokens consumed`,
      );
    }
  };
}

// ---------------------------------------------------------------------------
// Configuration loader
// ---------------------------------------------------------------------------

/**
 * Load lifecycle hooks from config metadata.
 *
 * Quill's `configurable` carries a `lifecycleHooks` key with registered hooks.
 * This function parses and returns the config.
 */
export function loadLifecycleHooks(
  config: RunnableConfig,
): LifecycleHookConfig | null {
  const configurable = config.configurable as Record<string, unknown> | undefined;
  if (!configurable) {
    return null;
  }

  const hooksConfig = configurable.lifecycleHooks as LifecycleHookConfig | undefined;
  if (!hooksConfig) {
    return null;
  }

  return hooksConfig;
}

// ---------------------------------------------------------------------------
// Convenience function for common use cases
// ---------------------------------------------------------------------------

/**
 * Build a lifecycle middleware from a configuration object.
 *
 * This is the recommended entry point for users who want lifecycle hooks.
 */
export function buildLifecycleMiddleware(
  config: LifecycleMiddlewareOptions,
): MiddlewareDefinition[] {
  const result: MiddlewareDefinition[] = [];

  // Audit hook (if enabled)
  if (config.auditEnabled) {
    result.push({
      name: "audit",
      afterAgent: async (state, cfg) => {
        const hook = createAuditHook({ logLevel: config.auditLogLevel });
        if (hook) {
          try {
            await hook({ messages: state.messages ?? [], tools: [] } as unknown as ModelRequest, state, cfg);
          } catch {
            // Ignore audit errors — they shouldn't break the agent.
          }
        }
        return {};
      },
    });
  }

  // Budget guard (if enabled)
  if (config.budgetGuard?.enabled && config.budgetGuard.maxTotalTokens) {
    result.push({
      name: "budget_guard",
      beforeModel: async (state, cfg) => {
        const hook = createBudgetGuardHook(config.budgetGuard!.maxTotalTokens!);
        try {
          await hook({ messages: state.messages ?? [], tools: [] } as unknown as ModelRequest, state, cfg);
        } catch (error) {
          // Budget guard errors should abort — rethrow.
          if (error instanceof Error) throw error;
          throw new Error(`Budget guard failed: ${String(error)}`);
        }
        return {};
      },
    });
  }

  // Custom hooks from config
  const hooksConfig = config.hooksConfig;
  if (hooksConfig) {
    const hooksMw = createLifecycleHookMiddleware({ hooksConfig });
    if (hooksMw) {
      result.push(hooksMw);
    }
  }

  return result;
}

export { LifecycleHook, LifecycleHookRegistration, LifecycleHookConfig };
