/**
 * AgentSwarm Tool — item-based fan-out parallelism for sub-agents.
 *
 * This tool allows the agent to spawn multiple sub-agents in parallel,
 * each working on a separate item. It features concurrency ramping
 * (start with N, ramp up by 1 every interval) and a configurable max.
 *
 * Source patterns:
 * - Kimi Code: AgentSwarm with item-based fan-out up to 128 sub-agents,
 *   concurrency ramp (5 initial + 1/700ms), configurable cap
 *
 * The tool delegates to the SubagentExecutor for actual execution,
 * managing the concurrency ramp and result aggregation.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

const swarmItemSchema = z.object({
  /** Unique identifier for this item. */
  id: z.string().describe("Unique identifier for this item."),
  /** The prompt/task for this specific item. */
  prompt: z.string().describe("The detailed task for this item."),
});

const agentSwarmSchema = z.object({
  /** The items to process in parallel. */
  items: z
    .array(swarmItemSchema)
    .describe("Array of items to process in parallel. Each item gets its own sub-agent."),
  /** Base prompt prefix for all items. */
  base_prompt: z
    .string()
    .optional()
    .describe("Base prompt prepended to each item's task."),
  /** Maximum concurrent sub-agents (default: 5). */
  max_concurrency: z
    .number()
    .int()
    .positive()
    .max(128)
    .optional()
    .describe("Maximum concurrent sub-agents (1-128, default: 5)."),
  /** Initial concurrency (default: 3). */
  initial_concurrency: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Initial concurrency before ramping (default: 3)."),
  /** Ramp interval in milliseconds (default: 700). */
  ramp_interval_ms: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Milliseconds between concurrency increases (default: 700)."),
  /** Subagent type to use (default: general-purpose). */
  subagent_type: z
    .string()
    .optional()
    .describe("Subagent type to use (default: general-purpose)."),
  /** Whether to wait for all results (default: true). */
  wait_for_all: z
    .boolean()
    .optional()
    .describe("Whether to wait for all results before returning (default: true)."),
});

export interface AgentSwarmCallbacks {
  /** Execute a single sub-agent task. */
  executeTask: (
    prompt: string,
    itemId: string,
    subagentType: string,
  ) => Promise<{ status: string; result: string; error?: string }>;
  /** Emit progress events. */
  onProgress?: (completed: number, total: number, active: number) => void;
}

/**
 * Create the AgentSwarm tool.
 *
 * This tool fans out multiple sub-agents in parallel, processing items
 * concurrently with a configurable ramp-up pattern.
 */
export function createAgentSwarmTool(callbacks: AgentSwarmCallbacks): StructuredToolInterface {
  return tool(
    async (input: z.infer<typeof agentSwarmSchema>): Promise<string> => {
      const {
        items,
        base_prompt = "",
        max_concurrency = 5,
        initial_concurrency = 3,
        ramp_interval_ms = 700,
        subagent_type = "general-purpose",
        wait_for_all = true,
      } = input;

      if (items.length === 0) {
        return JSON.stringify({
          ok: true,
          message: "No items to process.",
          results: [],
        });
      }

      const maxConcurrency = Math.min(max_concurrency, 128);
      const initialConcurrency = Math.min(initial_concurrency, maxConcurrency);
      const totalItems = items.length;

      // Track results
      const results: Array<{
        id: string;
        status: string;
        result: string;
        error?: string;
      }> = [];
      let completedCount = 0;
      let activeCount = 0;
      let currentConcurrency = initialConcurrency;
      let itemIndex = 0;

      // Process items with concurrency ramping
      const processNext = async (): Promise<void> => {
        while (itemIndex < totalItems && activeCount < currentConcurrency) {
          const item = items[itemIndex++];
          activeCount++;

          // Build the full prompt for this item
          const fullPrompt = base_prompt
            ? `${base_prompt}\n\n---\n\nItem ${item.id}: ${item.prompt}`
            : `Item ${item.id}: ${item.prompt}`;

          // Execute the task
          callbacks
            .executeTask(fullPrompt, item.id, subagent_type)
            .then((result) => {
              results.push({
                id: item.id,
                status: result.status,
                result: result.result,
                error: result.error,
              });
              completedCount++;
              activeCount--;
              callbacks.onProgress?.(completedCount, totalItems, activeCount);
            })
            .catch((err) => {
              results.push({
                id: item.id,
                status: "failed",
                result: "",
                error: err instanceof Error ? err.message : String(err),
              });
              completedCount++;
              activeCount--;
              callbacks.onProgress?.(completedCount, totalItems, activeCount);
            });
        }
      };

      // Concurrency ramping loop
      const rampConcurrency = (): void => {
        if (currentConcurrency < maxConcurrency && itemIndex < totalItems) {
          setTimeout(() => {
            currentConcurrency = Math.min(currentConcurrency + 1, maxConcurrency);
            void processNext();
            rampConcurrency();
          }, ramp_interval_ms);
        }
      };

      // Start initial batch
      void processNext();
      rampConcurrency();

      // Wait for all tasks to complete
      if (wait_for_all) {
        await new Promise<void>((resolve) => {
          const checkComplete = () => {
            if (completedCount >= totalItems) {
              resolve();
            } else {
              setTimeout(checkComplete, 100);
            }
          };
          checkComplete();
        });
      }

      // Aggregate results
      const succeeded = results.filter((r) => r.status === "completed").length;
      const failed = results.filter((r) => r.status === "failed").length;

      return JSON.stringify({
        ok: true,
        message: `Processed ${totalItems} items: ${succeeded} succeeded, ${failed} failed.`,
        total: totalItems,
        succeeded,
        failed,
        results,
      });
    },
    {
      name: "agent_swarm",
      description: [
        "Process multiple items in parallel using sub-agents.",
        "",
        "Use this tool when you have many independent items that can be",
        "processed in parallel. Each item gets its own sub-agent context.",
        "",
        "Features:",
        "- Concurrency ramping: starts with initial_concurrency, ramps up by 1",
        "  every ramp_interval_ms until max_concurrency is reached.",
        "- Up to 128 sub-agents per swarm.",
        "- Each item has isolated context (no cross-contamination).",
        "",
        "Example use cases:",
        "- Process multiple files in parallel",
        "- Research multiple topics simultaneously",
        "- Generate multiple variations of content",
        "- Batch data processing",
      ].join("\n"),
      schema: agentSwarmSchema,
    },
  );
}

/** Type guard for an agent_swarm tool call payload. */
export function isAgentSwarmCall(
  args: unknown,
): args is { items: Array<{ id: string; prompt: string }> } {
  if (typeof args !== "object" || args === null) return false;
  const obj = args as Record<string, unknown>;
  return Array.isArray(obj.items);
}
