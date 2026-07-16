/**
 * Subagent delegation tool (`task`).
 *
 * Minimal TypeScript implementation of Quill's multi-agent collaboration:
 * the lead agent calls `task` to hand a self-contained sub-task to a focused
 * subagent (e.g. a literature-research subagent wired to Sciverse), and gets
 * the subagent's final report back as the tool result.
 *
 * The actual subagent execution is injected (`runSubagent`) so this module does
 * not import the agent factory — avoiding a circular dependency. The launcher /
 * composition root provides `runSubagent` (it owns the model + tools + factory).
 *
 * The tool returns a ready-made `ToolMessage` (not a plain string) so
 * `toolsNode` writes it directly without double-wrapping. The `ToolMessage`
 * carries the human-readable fallback text in `content` AND the structured
 * status badge in `additional_kwargs` (`subagent_status`, `subagent_error`,
 * `task_id`, `token_usage`) — the frontend reads the structured field (issue
 * #3146) and falls back to the legacy prefix parse for old histories. Both
 * shapes converge on the status vocabulary pinned by
 * `contracts/subagent_status_contract.json`.
 */

import type { RunnableConfig } from "@langchain/core/runnables";
import { ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { makeSubagentAdditionalKwargs } from "../../subagents/status_contract.js";
import type { SubagentFinalResult } from "../../subagents/runtime/result.js";

export interface SubagentSpec {
  name: string;
  description: string;
}

export interface RunSubagentArgs {
  subagentType: string;
  /** Short (3-5 word) label for display/logging (Python `description`). */
  description: string;
  /** Detailed, self-contained task instructions for the subagent (Python `prompt`). */
  prompt: string;
}

export interface TaskToolDeps {
  /**
   * Run a subagent on `prompt` (the detailed task); resolve with the
   * subagent's normalised final result. `config` is the LangGraph
   * RunnableConfig for this tool invocation, used to emit streaming events
   * (`task_started`, `task_running`, `task_completed`, …).
   *
   * Mirrors Python `task_tool(description, prompt, subagent_type)` — `prompt`
   * is the actual task body, `description` is just a short display label.
   */
  runSubagent: (args: RunSubagentArgs, config?: RunnableConfig) => Promise<SubagentFinalResult>;
  /** Available subagent specs, surfaced in the tool description. */
  subagents?: SubagentSpec[];
  /** Default subagent type when the model omits one. */
  defaultSubagent?: string;
}

/**
 * Build a `ToolMessage` carrying the structured subagent status contract.
 *
 * Mirrors Python `task_tool`'s return + `ToolErrorHandlingMiddleware`'s
 * stamping. The human-readable `content` preserves the legacy prefix strings so
 * older clients / the frontend's fallback parser keep working; the
 * `additional_kwargs` structured badge is the canonical signal (issue #3146).
 */
export function makeTaskToolMessage(
  taskId: string,
  final: SubagentFinalResult,
): ToolMessage {
  const contractStatus = final.status;
  let content: string;
  if (contractStatus === "completed") {
    const body = final.result && final.result.trim() ? final.result : "(subagent returned no content)";
    content = `Task Succeeded. Result: ${body}`;
  } else if (contractStatus === "cancelled") {
    content = `Task cancelled by user. ${final.error ?? ""}`.trim();
  } else if (contractStatus === "timed_out") {
    content = `Task timed out. ${final.error ?? ""}`.trim();
  } else if (contractStatus === "polling_timed_out") {
    content = `Task polling timed out. ${final.error ?? ""}`.trim();
  } else {
    content = `Task failed. Error: ${final.error ?? "Subagent failed"}`;
  }

  // Start from the structured status badge the contract requires, then enrich
  // it with the runtime fields (task_id, token_usage) the frontend doesn't
  // yet read contract-side but the ToolMessage consumer does.
  const kwargs: Record<string, unknown> = makeSubagentAdditionalKwargs(contractStatus, {
    error: final.error && final.error.trim() ? final.error : undefined,
  });
  kwargs.task_id = taskId;
  if (final.tokenUsageRecords && final.tokenUsageRecords.length > 0) {
    kwargs.token_usage = final.tokenUsageRecords;
  }

  return new ToolMessage({
    content,
    // tool_call_id is overwritten by toolsNode to the model's tool_call id, but
    // seeding it with the task id keeps the message self-identifying.
    tool_call_id: taskId,
    additional_kwargs: kwargs,
  });
}

/** Build the `task` delegation tool bound to a concrete subagent runner. */
export function createTaskTool(deps: TaskToolDeps): StructuredToolInterface {
  const specs = deps.subagents ?? [];
  const defaultType = deps.defaultSubagent ?? specs[0]?.name ?? "research";
  const roster =
    specs.length > 0
      ? specs.map((s) => `- ${s.name}: ${s.description}`).join("\n")
      : `- ${defaultType}: general research subagent`;

  return tool(
    async (
      input: { description: string; prompt: string; subagent_type?: string },
      config?: RunnableConfig
    ): Promise<ToolMessage> => {
      const subagentType = input.subagent_type?.trim() || defaultType;
      // `prompt` is the detailed task body; some models only fill `description`.
      // Fall back to `description` so a model that ignores the `prompt` field
      // still hands the subagent something to act on.
      const taskPrompt =
        (typeof input.prompt === "string" && input.prompt.trim()) || input.description;
      const final = await deps.runSubagent(
        {
          subagentType,
          description: input.description,
          prompt: taskPrompt,
        },
        config
      );
      // Expose the task id so the surrounding `task_running` SSE events,
      // the persisted `subagent.*` events, and the `ToolMessage` all agree
      // on one id.
      const taskId = final.taskId;
      return makeTaskToolMessage(taskId, final);
    },
    {
      name: "task",
      description: [
        "Delegate a self-contained sub-task to a specialized subagent and receive its final report.",
        "Use this to parallelize or deep-dive focused work — especially literature/evidence gathering that benefits from multiple Sciverse tool calls.",
        "Provide a short `description` (3-5 words, for display) and a detailed, standalone `prompt` (the subagent does not see this conversation).",
        "Available subagents:",
        roster,
      ].join("\n"),
      schema: z.object({
        description: z
          .string()
          .describe(
            "A short (3-5 word) description of the task for logging/display. ALWAYS PROVIDE THIS PARAMETER FIRST.",
          ),
        prompt: z
          .string()
          .describe(
            "The detailed, self-contained task instructions for the subagent. Include the goal, scope, and what to return. ALWAYS PROVIDE THIS PARAMETER SECOND.",
          ),
        subagent_type: z
          .string()
          .optional()
          .describe(`Which subagent to use. Defaults to '${defaultType}'. ALWAYS PROVIDE THIS PARAMETER THIRD.`),
      }),
    },
  );
}
