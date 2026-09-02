/**
 * Round-robin coordination — agents take turns in sequence.
 *
 * Port of AutoGen's RoundRobinGroupChat. All agents share a common
 * message history (shared scratchpad). Each agent sees the full
 * conversation and responds in turn.
 *
 * Best for: reflection patterns (primary + critic), peer review,
 * situations where every agent needs full context.
 *
 * Architecture:
 *   Agent A → shared history → Agent B → shared history → Agent A → ...
 *   (until termination condition met)
 */

import type {
  AgentMessage,
  AgentRunner,
  CoordAgent,
  CoordinationResult,
  SharedState,
  TerminationFn,
} from "../types.js";

export interface RoundRobinOptions {
  /** Agents participating in the round-robin. */
  agents: CoordAgent[];
  /** The initial task/message. */
  task: string;
  /** Agent runner. */
  runner: AgentRunner;
  /** Maximum total rounds across all agents. */
  maxRounds?: number;
  /** Custom termination condition. */
  isComplete?: TerminationFn;
  /**
   * Optional agent to summarize the final output.
   * If not provided, the last agent's output is used.
   */
  summarizer?: CoordAgent;
}

/**
 * Run round-robin coordinated multi-agent work.
 *
 * Agents take turns responding to the shared conversation. Each agent
 * sees the full history and builds on previous responses.
 */
export async function runRoundRobin(
  options: RoundRobinOptions,
): Promise<CoordinationResult> {
  const { agents, task, runner, maxRounds = 6, summarizer } = options;
  const startTime = Date.now();

  if (agents.length === 0) {
    return {
      output: "No agents provided",
      success: false,
      messages: [],
      agentOutputs: {},
      tokenUsage: {},
      durationMs: 0,
      rounds: 0,
      error: "No agents provided",
    };
  }

  const messages: AgentMessage[] = [];
  const agentOutputs: Record<string, string> = {};
  const tokenUsage: Record<string, { inputTokens: number; outputTokens: number }> = {};

  const sharedState: SharedState = {
    task,
    context: [task],
    artifacts: {},
    status: "active",
    rounds: 0,
    maxRounds,
  };

  let success = false;
  let finalOutput = "";
  let error: string | undefined;

  try {
    // Seed the conversation with the initial task as a system-like message.
    const taskMessage: AgentMessage = {
      from: "system",
      to: agents.map((a) => a.name),
      content: task,
      kind: "request",
      timestamp: new Date().toISOString(),
    };
    messages.push(taskMessage);

    // Run rounds.
    for (let round = 0; round < maxRounds; round++) {
      sharedState.rounds = round + 1;

      // Check termination before starting a new round.
      if (options.isComplete?.(messages, sharedState)) {
        success = true;
        break;
      }

      // Each agent takes its turn.
      for (const agent of agents) {
        const agentMsg = await runner(agent, task, {
          sharedState,
          history: messages,
        });

        messages.push(agentMsg);
        agentOutputs[agent.name] = agentMsg.content;
        accumulateTokens(tokenUsage, agent.name, agentMsg);

        // Update shared context.
        sharedState.context.push(`[${agent.name}]: ${agentMsg.content.slice(0, 500)}`);
      }

      // Check termination after each full round.
      if (options.isComplete?.(messages, sharedState)) {
        success = true;
        break;
      }
    }

    // Generate final output.
    if (summarizer) {
      const summaryMsg = await runner(
        summarizer,
        "Summarize the key findings and conclusions from the discussion above.",
        { sharedState, history: messages },
      );
      finalOutput = summaryMsg.content;
      agentOutputs[summarizer.name] = summaryMsg.content;
    } else {
      // Use the last agent's output.
      const lastAgent = agents[agents.length - 1];
      finalOutput = agentOutputs[lastAgent.name] ?? "No output produced";
    }

    success = success || sharedState.rounds < maxRounds;
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
