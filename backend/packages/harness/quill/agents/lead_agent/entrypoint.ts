/**
 * Thin lead-agent entrypoint for LangGraph Server resolution.
 *
 * Package import hygiene
 * ======================
 *
 * The LangGraph Server resolves graph factories directly from the module
 * dictionary, so this module MUST stay lightweight. All heavyweight imports
 * (tools, models, skills, tracing, sandbox) are kept INSIDE the function
 * body so that importing this module does not pull in the entire agent
 * runtime.
 *
 * Internal modules that only need lightweight types, config, or registries
 * should import the concrete submodule instead of this entrypoint.
 *
 * Mirrors the DeerFlow 2.0 package import hygiene pattern:
 * "The deerflow.agents:make_lead_agent LangGraph Server entrypoint is a
 * concrete thin module-level function because the server resolves graph
 * factories directly from the module dictionary; the wrapper keeps the
 * lead-agent and skill-cache imports inside the function so importing the
 * package remains lightweight."
 */

import type { RunnableConfig } from "@langchain/core/runnables";
import type { CompiledStateGraph } from "@langchain/langgraph";

/**
 * Create the lead agent graph. All heavyweight imports are deferred until
 * this function is called, so importing this module stays lightweight.
 *
 * @param config  RunnableConfig with configurable fields (model_name,
 *   thinking_enabled, is_plan_mode, subagent_enabled, etc.)
 */
export async function makeLeadAgent(
  config: RunnableConfig
): Promise<CompiledStateGraph> {
  // Heavyweight imports deferred to function body.
  const { makeLeadAgent: _makeLeadAgent } = await import("./agent.js");
  return _makeLeadAgent(config);
}
