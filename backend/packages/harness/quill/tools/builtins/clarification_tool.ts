/**
 * ask_clarification tool — request more information from the user.
 *
 * The ClarificationMiddleware intercepts calls to this tool and converts them
 * into a user-facing question, interrupting the current turn.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

const clarificationTypeSchema = z.enum([
  "missing_info",
  "ambiguous_requirement",
  "approach_choice",
  "risk_confirmation",
  "suggestion",
]);

const askClarificationSchema = z.object({
  question: z.string().describe("The clarification question to ask the user. Be specific and clear."),
  clarification_type: clarificationTypeSchema.describe(
    "The type of clarification needed (missing_info, ambiguous_requirement, approach_choice, risk_confirmation, suggestion).",
  ),
  context: z
    .string()
    .optional()
    .describe("Optional context explaining why clarification is needed."),
  options: z
    .array(z.string())
    .optional()
    .describe("Optional list of choices for approach_choice or suggestion types."),
});

/** Build the ask_clarification tool. */
export function createAskClarificationTool(): StructuredToolInterface {
  return tool(
    async (input: z.infer<typeof askClarificationSchema>): Promise<string> => {
      return JSON.stringify({
        ok: true,
        message: "Clarification request processed by middleware.",
        clarification: input,
      });
    },
    {
      name: "ask_clarification",
      description: [
        "Ask the user for clarification when you need more information to proceed.",
        "Use for missing information, ambiguous requirements, approach choices, risky operations, or suggestions.",
        "After calling this tool, execution is interrupted and the question is presented to the user.",
      ].join("\n"),
      schema: askClarificationSchema,
    },
  );
}
