/**
 * Lifecycle hooks — gate and audit tool/model calls at key decision points.
 *
 * Mirrors DeerFlow's `tool_progress_middleware` hook pattern and Kimi Code's
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

import type { ModelRequest, ToolCallRequest } from "../agents/factory.js";
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
// Hook executor
// ---------------------------------------------------------------------------

/**
 * Execute a single lifecycle hook with error isolation.
 *
 * Errors from individual hooks are caught and logged (as warnings) rather than
 * aborting the step — unless the hook explicitly throws, in which case the error
 * propagates to abort the step.
 */
async function executeHook(
  hook: LifecycleHookRegistration,
  request: ModelRequest | ToolCallRequest,
  state: ThreadState,
  config: RunnableConfig,
): Promise<void> {
  try {
    await hook.fn(request, state, config);
  } catch (error) {
    // Hook explicitly throws — propagate to abort the step.
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Lifecycle hook '${hook.name}' failed: ${String(error)}`);
  }
}

/**
 * Run all hooks for a given phase.
 *
 * Hooks execute sequentially in registration order.  The first error aborts
 * the entire chain (unlike tool wrappers where errors are caught per-tool).
 *
 * @param hooks — all registrations for the phase
 * @param request — the request context (model or tool)
 * @param state — current thread state
 * @param config — runnable config
 */
export async function runLifecycleHooks(
  hooks: LifecycleHookRegistration[],
  request: ModelRequest | ToolCallRequest,
  state: ThreadState,
  config: RunnableConfig,
): Promise<void> {
  if (!hooks || hooks.length === 0) {
    return;
  }

  for (const hook of hooks) {
    await executeHook(hook, request, state, config);
  }
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
 * Can be enabled via `config.lifecycleHooks.audit.enabled`.
 */
export function createAuditHook(
  opts?: { enabled?: boolean; logLevel?: "info" | "warn" },
): LifecycleHookRegistration | null {
  if (!opts?.enabled) {
    return null;
  }

  return registerHook({
    name: "audit",
    phase: "post_tool",
    fn: async (request, state, config) => {
      const toolReq = request as ToolCallRequest;
      const logLevel = opts.logLevel ?? "info";

      if (logLevel === "warn") {
        console.warn(
          `[quill:audit] tool=${toolReq.name} args=${JSON.stringify(toolReq.args)} state.messages_count=${state.messages?.length ?? 0}`,
        );
      } else {
        console.log(
          `[quill:audit] tool=${toolReq.name} state.messages_count=${state.messages?.length ?? 0}`,
        );
      }
    },
  });
}

/**
 * Budget guard hook: stop tool execution when token budget is exceeded.
 */
export function createBudgetGuardHook(
  opts?: { maxTotalTokens?: number },
): LifecycleHookRegistration | null {
  if (!opts?.maxTotalTokens) {
    return null;
  }

  return registerHook({
    name: "budget-guard",
    phase: "pre_tool",
    fn: (request, state) => {
      const internal = (state.internal ?? {}) as Record<string, unknown>;
      const totalTokens = (internal._totalTokensUsed as number) ?? 0;
      if (totalTokens >= opts.maxTotalTokens) {
        throw new Error(
          `Budget exceeded: ${totalTokens} >= ${opts.maxTotalTokens} tokens consumed`,
        );
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Configuration loader
// ---------------------------------------------------------------------------

/**
 * Load lifecycle hooks from config metadata.
 *
 * Quill's `configurable` carries a `lifecycleHooks` key with registered hooks.
 * This function parses and returns them as `LifecycleHookRegistration[]`.
 */
export function loadLifecycleHooks(
  config: RunnableConfig,
): LifecycleHookRegistration[][] {
  const configurable = config.configurable as Record<string, unknown> | undefined;
  if (!configurable) {
    return [[], [], [], []];
  }

  const hooksConfig = configurable.lifecycleHooks as unknown as LifecycleHookConfig | undefined;
  if (!hooksConfig) {
    return [[], [], [], []];
  }

  const preModel: LifecycleHookRegistration[] = [];
  const postModel: LifecycleHookRegistration[] = [];
  const preTool: LifecycleHookRegistration[] = [];
  const postTool: LifecycleHookRegistration[] = [];

  if (hooksConfig.pre_model) {
    for (const fn of hooksConfig.pre_model) {
      preModel.push(registerHook({ name: "configured", phase: "pre_model", fn }));
    }
  }
  if (hooksConfig.post_model) {
    for (const fn of hooksConfig.post_model) {
      postModel.push(registerHook({ name: "configured", phase: "post_model", fn }));
    }
  }
  if (hooksConfig.pre_tool) {
    for (const fn of hooksConfig.pre_tool) {
      preTool.push(registerHook({ name: "configured", phase: "pre_tool", fn }));
    }
  }
  if (hooksConfig.post_tool) {
    for (const fn of hooksConfig.post_tool) {
      postTool.push(registerHook({ name: "configured", phase: "post_tool", fn }));
    }
  }

  return [preModel, postModel, preTool, postTool];
}

export { LifecycleHook, LifecycleHookRegistration, LifecycleHookConfig };
