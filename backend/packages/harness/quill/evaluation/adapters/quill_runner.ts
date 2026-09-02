/**
 * Quill agent adapter — bridges the evaluation framework to QuillClient.
 *
 * Mirrors SWE-agent's agent-interface abstraction: the eval runner
 * doesn't care which agent framework produces the answer. This adapter
 * implements the EvalRunner type contract using Quill's embedded client.
 *
 * Design notes:
 * - Each task runs in an isolated thread (fresh conversation state)
 * - Artifacts are read from the sandbox workspace after execution
 * - Token usage is captured from stream events
 * - The adapter is stateless; thread_id is managed per-task
 */

import { randomUUID } from "node:crypto";

import type { EvalRunner, EvalTask, EvalTaskResult } from "../types.js";

/**
 * Minimal surface of QuillClient needed for evaluation.
 * This is intentionally a subset so the adapter works with both
 * the real QuillClient and test mocks.
 */
export interface EvalQuillClient {
  stream(message: string, threadId?: string): AsyncIterable<EvalStreamEvent>;
  setSandboxProvider?(provider: unknown): void;
}

/** Stream event shapes we care about for evaluation. */
export interface EvalStreamEvent {
  type: "values" | "messages-tuple" | "custom" | "end" | "error";
  data?: unknown;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  error?: string;
}

export interface QuillRunnerOptions {
  client: EvalQuillClient;
  /** Optional model override for all tasks. */
  modelName?: string;
  /** Optional sandbox provider override. */
  sandboxProvider?: unknown;
  /** Maximum stream iterations before force-stopping. */
  maxStreamIterations?: number;
}

/**
 * Create an EvalRunner backed by a QuillClient.
 *
 * Usage:
 *   const runner = createQuillRunner({ client: quillClient });
 *   const report = await runBenchmark({ runner, suite: mySuite });
 */
export function createQuillRunner(options: QuillRunnerOptions): EvalRunner {
  const { client, modelName, sandboxProvider, maxStreamIterations = 500 } = options;

  return async (task: EvalTask, runOptions?: { signal?: AbortSignal }): Promise<EvalTaskResult> => {
    const threadId = `eval_${task.id}_${randomUUID().slice(0, 8)}`;
    const startTime = Date.now();
    const events: EvalTaskResult["events"] = [];

    let responseText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let turns = 0;
    let interrupted = false;
    let error: string | null = null;

    if (sandboxProvider) {
      client.setSandboxProvider?.(sandboxProvider);
    }

    try {
      let iteration = 0;
      for await (const event of client.stream(task.prompt, threadId)) {
        if (runOptions?.signal?.aborted) {
          interrupted = true;
          break;
        }
        if (++iteration > maxStreamIterations) {
          interrupted = true;
          break;
        }

        // Track events for debugging.
        events.push({
          timestamp: new Date().toISOString(),
          kind: mapStreamEventKind(event.type),
          data: (event.data as Record<string, unknown>) ?? {},
        });

        // Accumulate AI text from messages-tuple events.
        if (event.type === "messages-tuple") {
          const tuple = event.data as [unknown, unknown] | undefined;
          if (Array.isArray(tuple) && tuple.length === 2) {
            const [message, metadata] = tuple;
            const msg = message as { getType?: () => string; content?: unknown };
            if (msg.getType?.() === "ai" && typeof msg.content === "string") {
              responseText += msg.content;
              turns++;
            }
          }
        }

        // Capture usage from end events.
        if (event.type === "end" && event.usage) {
          inputTokens = event.usage.inputTokens ?? 0;
          outputTokens = event.usage.outputTokens ?? 0;
          totalTokens = event.usage.totalTokens ?? inputTokens + outputTokens;
        }

        if (event.type === "error") {
          error = event.error ?? "Unknown stream error";
          break;
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      interrupted = true;
    }

    return {
      taskId: task.id,
      response: responseText,
      artifacts: [], // Artifacts would be read from sandbox by a separate step
      artifactContents: {},
      tokenUsage: { inputTokens, outputTokens, totalTokens },
      durationMs: Date.now() - startTime,
      turns,
      interrupted,
      error,
      events,
    };
  };
}

function mapStreamEventKind(type: string): EvalEvent["kind"] {
  switch (type) {
    case "messages-tuple":
      return "model_call";
    case "end":
      return "turn_boundary";
    case "error":
      return "error";
    default:
      return "tool_call";
  }
}

// Re-export the event type used in EvalTaskResult
type EvalEvent = import("../types.js").EvalEvent;
