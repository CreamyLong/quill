/**
 * Goal Tool — set, check, and manage goals (Goal Mode).
 *
 * This tool allows the agent to:
 * - Set a new goal (creates an active GoalState)
 * - Check the current goal status
 * - Abandon an active goal
 * - Resume a paused goal
 *
 * The actual goal evaluation and continuation logic is handled by the
 * GoalMiddleware. This tool only manages the GoalState in ThreadState.
 *
 * Source patterns:
 * - Kimi Code: Goal mode with pause/resume/cancel/queue
 * - DeerFlow 2.0: /goal command with automatic completion evaluation
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

const goalActionSchema = z.object({
  action: z
    .enum(["set", "status", "abandon", "resume"])
    .describe("The goal action to perform."),
  objective: z
    .string()
    .optional()
    .describe("The goal objective (required for 'set' action)."),
});

/**
 * Create the goal tool.
 *
 * @param callbacks - Callback functions for each action.
 */
export function createGoalTool(callbacks: {
  setGoal: (objective: string) => Promise<{ ok: boolean; message: string }>;
  getStatus: () => Promise<{ ok: boolean; goal: unknown; message: string }>;
  abandonGoal: () => Promise<{ ok: boolean; message: string }>;
  resumeGoal: () => Promise<{ ok: boolean; message: string }>;
}): StructuredToolInterface {
  return tool(
    async (input: z.infer<typeof goalActionSchema>): Promise<string> => {
      switch (input.action) {
        case "set": {
          if (!input.objective) {
            return JSON.stringify({
              ok: false,
              message: "Objective is required for 'set' action.",
            });
          }
          const result = await callbacks.setGoal(input.objective);
          return JSON.stringify(result);
        }
        case "status": {
          const result = await callbacks.getStatus();
          return JSON.stringify(result);
        }
        case "abandon": {
          const result = await callbacks.abandonGoal();
          return JSON.stringify(result);
        }
        case "resume": {
          const result = await callbacks.resumeGoal();
          return JSON.stringify(result);
        }
        default:
          return JSON.stringify({
            ok: false,
            message: `Unknown action: ${input.action}`,
          });
      }
    },
    {
      name: "goal",
      description: [
        "Manage goals for persistent multi-turn objective tracking.",
        "",
        "Actions:",
        "- set: Set a new goal with an objective description",
        "- status: Check the current goal status and progress",
        "- abandon: Abandon the active goal",
        "- resume: Resume a paused goal",
        "",
        "Use 'set' to define what you want to achieve, then work toward it.",
        "The system will automatically evaluate progress and continue until the goal is met.",
      ].join("\n"),
      schema: goalActionSchema,
    },
  );
}

/** Type guard for a goal tool call payload. */
export function isGoalCall(
  args: unknown,
): args is { action: string; objective?: string } {
  if (typeof args !== "object" || args === null) return false;
  const obj = args as Record<string, unknown>;
  return typeof obj.action === "string";
}
