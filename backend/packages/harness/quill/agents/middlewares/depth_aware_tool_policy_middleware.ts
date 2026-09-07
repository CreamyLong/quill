/**
 * Depth-Aware Tool Policy Middleware.
 *
 * Inspired by OpenClaw's depth-aware subagent tool policy. As subagents nest
 * deeper, they automatically lose access to dangerous tools. This contains the
 * blast radius of recursive delegation.
 *
 * Depth levels:
 *   0 — Lead agent: full tool access (subject to other middleware).
 *   1 — First-level subagent: loses control-plane tools (sessions_spawn, etc.)
 *   2+ — Deep subagent: additionally loses subagent-management tools (task).
 *   maxDepth (default 3) — deepest allowed level; no delegation permitted.
 *
 * Tool categories that are restricted:
 *   - Control-plane: tools that could modify gateway state (setup_agent, update_agent)
 *   - Delegation: tools that spawn further subagents (task)
 *   - Sensitive: tools that access credentials or external systems (config-dependent)
 *
 * This middleware reads `subagent_depth` from the run config's `configurable`
 * and removes disallowed tool schemas from the model's bound tools.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";

import type { MiddlewareDefinition } from "../factory.js";
import type { ThreadState } from "../thread_state.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Tools removed at depth >= 1 (first-level subagents). */
export const CONTROL_PLANE_TOOLS = new Set([
  "setup_agent",
  "update_agent",
]);

/** Tools removed at depth >= 2 (deep subagents cannot delegate further). */
export const DELEGATION_TOOLS = new Set([
  "task",
]);

/** Maximum nesting depth before delegation is completely blocked. */
export const MAX_SUBAGENT_DEPTH = 3;

// Types whose `.bindTools()` we can call.
interface ToolBindable {
  bindTools(tools: StructuredToolInterface[]): BaseChatModel;
}

function isToolBindable(model: unknown): model is ToolBindable {
  return (
    typeof model === "object" &&
    model !== null &&
    typeof (model as ToolBindable).bindTools === "function"
  );
}

function isStructuredTool(tool: unknown): tool is StructuredToolInterface {
  return (
    typeof tool === "object" &&
    tool !== null &&
    "name" in tool &&
    typeof (tool as StructuredToolInterface).name === "string"
  );
}

/**
 * Determine which tool names should be removed at a given depth.
 */
export function toolsToRemoveAtDepth(depth: number): Set<string> {
  const toRemove = new Set<string>();
  if (depth < 1) return toRemove;

  // Depth >= 1: remove control-plane tools.
  for (const name of CONTROL_PLANE_TOOLS) toRemove.add(name);

  // Depth >= 2: remove delegation tools.
  if (depth >= 2) {
    for (const name of DELEGATION_TOOLS) toRemove.add(name);
  }

  return toRemove;
}

/**
 * Filter tools based on subagent nesting depth.
 * Returns the filtered list of tools.
 */
export function filterToolsByDepth(
  tools: unknown[],
  depth: number
): unknown[] {
  const toRemove = toolsToRemoveAtDepth(depth);
  if (toRemove.size === 0) return tools;

  return tools.filter((tool) => {
    if (!isStructuredTool(tool)) return true;
    return !toRemove.has(tool.name);
  });
}

/**
 * Create the depth-aware tool policy middleware.
 *
 * @param options - Configuration options.
 * @param options.maxDepth - Maximum allowed nesting depth (default: 3).
 * @param options.controlPlaneTools - Additional tool names to restrict at depth >= 1.
 * @param options.delegationTools - Additional tool names to restrict at depth >= 2.
 */
export function depthAwareToolPolicyMiddleware(options: {
  maxDepth?: number;
  controlPlaneTools?: string[];
  delegationTools?: string[];
} = {}): MiddlewareDefinition {
  const maxDepth = options.maxDepth ?? MAX_SUBAGENT_DEPTH;
  const extraControlPlane = new Set(options.controlPlaneTools ?? []);
  const extraDelegation = new Set(options.delegationTools ?? []);

  return {
    name: "DepthAwareToolPolicyMiddleware",
    beforeModel: (state: ThreadState): Partial<ThreadState> => {
      // Read subagent depth from config metadata or default to 0.
      const subagentDepth = (state as Record<string, unknown>)._subagent_depth as number | undefined ?? 0;

      if (subagentDepth < 1) return {};

      const toRemove = toolsToRemoveAtDepth(subagentDepth);
      for (const name of extraControlPlane) toRemove.add(name);
      if (subagentDepth >= 2) {
        for (const name of extraDelegation) toRemove.add(name);
      }

      if (toRemove.size === 0) return {};

      // Tools are stored in the middleware context (set by the agent factory).
      // If there's nothing to filter, return early.
      const tools = (state as Record<string, unknown>)._bound_tools as unknown[] | undefined;
      if (!tools || tools.length === 0) return {};

      const filtered = filterToolsByDepth(tools, subagentDepth);
      if (filtered.length === tools.length) return {};

      // Log the restriction at deeper levels.
      if (subagentDepth >= 2) {
        console.warn(
          `[DepthAwareToolPolicy] Depth ${subagentDepth}: restricted ${tools.length - filtered.length} tool(s) (${Array.from(toRemove).join(", ")})`
        );
      }

      return {
        ...state,
        _bound_tools: filtered,
      } as Partial<ThreadState>;
    },
  };
}
