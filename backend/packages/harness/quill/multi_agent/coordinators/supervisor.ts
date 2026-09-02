/**
 * Supervisor coordination — one agent routes tasks to worker agents.
 *
 * Port of LangGraph's "Agent Supervisor" pattern and Kimi Code's
 * TowerInit/TowerPlan. A supervisor agent sees all worker agents as
 * tools and decides which worker should handle each subtask.
 *
 * Architecture:
 *   Supervisor (has tools: delegate_to_researcher, delegate_to_coder, ...)
 *     → routes to Worker A
 *     → Worker A completes, returns result
 *     → Supervisor routes to Worker B (with context from A)
 *     → ... until done
 *
 * Key design decisions:
 * - Each worker has its own independent scratchpad (no shared state)
 * - The supervisor maintains the global context
 * - Workers return structured results, not raw messages
 * - Mirrors LangGraph's "supervisor with tools as agents" pattern
 */

import type {
  AgentMessage,
  AgentRunner,
  CoordAgent,
  CoordinationResult,
  SelectorFn,
  SharedState,
  TerminationFn,
} from "../types.js";

export interface SupervisorOptions {
  /** The supervisor agent. */
  supervisor: CoordAgent;
  /** Worker agents available for delegation. */
  workers: CoordAgent[];
  /** The task to accomplish. */
  task: string;
  /** Agent runner — executes a single agent turn. */
  runner: AgentRunner;
  /** Maximum coordination rounds before timeout. */
  maxRounds?: number;
  /** Custom termination condition. */
  isComplete?: TerminationFn;
}

/**
 * Run supervisor-coordinated multi-agent work.
 *
 * The supervisor receives the full task and iteratively delegates to
 * workers until the task is complete or max rounds are reached.
 */
export async function runSupervisorCoordination(
  options: SupervisorOptions,
): Promise<CoordinationResult> {
  const { supervisor, workers, task, runner, maxRounds = 10 } = options;
  const startTime = Date.now();

  const messages: AgentMessage[] = [];
  const agentOutputs: Record<string, string> = {};
  const tokenUsage: Record<string, { inputTokens: number; outputTokens: number }> = {};

  const sharedState: SharedState = {
    task,
    context: [],
    artifacts: {},
    status: "active",
    rounds: 0,
    maxRounds,
  };

  let finalOutput = "";
  let success = false;
  let error: string | undefined;

  try {
    // Build the initial message for the supervisor.
    const workerDescriptions = workers
      .map((w) => `- **${w.name}** (${w.role}): ${w.goal}`)
      .join("\n");

    const initialMessage = [
      `Task: ${task}`,
      "",
      "Available workers:",
      workerDescriptions,
      "",
      "Delegate to workers as needed. When the task is complete, provide a final summary.",
    ].join("\n");

    // Run the supervisor loop.
    for (let round = 0; round < maxRounds; round++) {
      sharedState.rounds = round + 1;

      // Check custom termination.
      if (options.isComplete?.(messages, sharedState)) {
        success = true;
        break;
      }

      // Supervisor decides what to do next.
      const supervisorMsg = await runner(supervisor, buildSupervisorPrompt(initialMessage, sharedState), {
        sharedState,
        history: messages,
      });

      messages.push(supervisorMsg);
      agentOutputs[supervisor.name] = supervisorMsg.content;
      accumulateTokens(tokenUsage, supervisor.name, supervisorMsg);

      // Check if supervisor signaled completion.
      if (isCompletionSignal(supervisorMsg.content)) {
        finalOutput = extractFinalAnswer(supervisorMsg.content);
        success = true;
        break;
      }

      // Parse delegation targets from the supervisor's message.
      const targets = parseDelegationTargets(supervisorMsg.content, workers);

      if (targets.length === 0) {
        // No delegation targets found — treat as final answer.
        finalOutput = supervisorMsg.content;
        success = true;
        break;
      }

      // Execute each target worker in parallel.
      const workerPromises = targets.map(async (target) => {
        const worker = workers.find((w) => w.name === target.agentName);
        if (!worker) return null;

        const workerMsg = await runner(worker, target.instruction, {
          sharedState,
          history: messages,
        });

        // Add the worker's result to shared context.
        sharedState.context.push(`[${worker.name}]: ${workerMsg.content}`);
        agentOutputs[worker.name] = workerMsg.content;
        accumulateTokens(tokenUsage, worker.name, workerMsg);
        messages.push(workerMsg);

        return workerMsg;
      });

      await Promise.all(workerPromises);
    }

    if (!success) {
      sharedState.status = "timed_out";
      finalOutput = `Supervisor reached max rounds (${maxRounds}). Last context: ${sharedState.context.slice(-3).join("; ")}`;
    }
  } catch (err) {
    sharedState.status = "failed";
    error = err instanceof Error ? err.message : String(err);
    finalOutput = `Coordination failed: ${error}`;
  }

  return {
    output: finalOutput,
    success,
    messages,
    agentOutputs,
    tokenUsage,
    durationMs: Date.now() - startTime,
    rounds: sharedState.rounds,
    error,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSupervisorPrompt(initialMessage: string, state: SharedState): string {
  const parts = [initialMessage];

  if (state.context.length > 0) {
    parts.push("\n\nProgress so far:");
    for (const ctx of state.context) {
      parts.push(`- ${ctx}`);
    }
  }

  parts.push(`\n\nRound ${state.rounds + 1}/${state.maxRounds}. What's the next step?`);
  return parts.join("\n");
}

function isCompletionSignal(content: string): boolean {
  const lower = content.toLowerCase();
  return (
    lower.includes("final answer:") ||
    lower.includes("task complete") ||
    lower.includes("coordination complete") ||
    lower.includes("## final summary")
  );
}

function extractFinalAnswer(content: string): string {
  // Try to extract content after "final answer" markers.
  const markers = ["final answer:", "final summary:", "## final summary"];
  const lower = content.toLowerCase();
  for (const marker of markers) {
    const idx = lower.indexOf(marker);
    if (idx !== -1) {
      return content.slice(idx + marker.length).trim();
    }
  }
  return content;
}

interface DelegationTarget {
  agentName: string;
  instruction: string;
}

function parseDelegationTargets(content: string, workers: CoordAgent[]): DelegationTarget[] {
  const targets: DelegationTarget[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    // Match patterns like "delegate to researcher: find information about X"
    // or "→ coder: implement function Y"
    const match = line.match(
      /^(?:delegate\s+to\s+|\→\s*|\-\s*)(\w+)[\s:=]+(.+)$/i,
    );
    if (match) {
      const agentName = match[1].toLowerCase();
      const worker = workers.find((w) => w.name.toLowerCase() === agentName);
      if (worker) {
        targets.push({ agentName: worker.name, instruction: match[2].trim() });
      }
    }
  }

  return targets;
}

function accumulateTokens(
  usage: Record<string, { inputTokens: number; outputTokens: number }>,
  agentName: string,
  message: AgentMessage,
): void {
  const meta = message.metadata;
  if (meta?.inputTokens || meta?.outputTokens) {
    const existing = usage[agentName] ?? { inputTokens: 0, outputTokens: 0 };
    existing.inputTokens += (meta.inputTokens as number) ?? 0;
    existing.outputTokens += (meta.outputTokens as number) ?? 0;
    usage[agentName] = existing;
  }
}
