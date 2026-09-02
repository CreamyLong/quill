/**
 * Handoff coordination — agents signal transitions to one another.
 *
 * Port of AutoGen's Swarm pattern and OpenAI Agents SDK's handoff
 * mechanism. Instead of a central coordinator, each agent decides
 * who should handle the next step by emitting a handoff message.
 *
 * Architecture:
 *   Agent A → handoff to B → Agent B → handoff to C → Agent C → done
 *
 * Best for: customer service triage, multi-stage pipelines, situations
 * where the flow isn't known in advance.
 */

import type {
  AgentMessage,
  AgentRunner,
  CoordAgent,
  CoordinationResult,
  HandoffMessage,
  SharedState,
} from "../types.js";

export interface HandoffOptions {
  /** All participating agents. */
  agents: CoordAgent[];
  /** The agent that starts the conversation. */
  startAgent: string;
  /** The initial task/message. */
  task: string;
  /** Agent runner. */
  runner: AgentRunner;
  /** Maximum handoff chain length before timeout. */
  maxHandoffs?: number;
}

/**
 * Run handoff-coordinated multi-agent work.
 *
 * The start agent receives the task. It either completes the task
 * directly or hands off to another agent. This continues until an
 * agent completes the task or the max handoff limit is reached.
 */
export async function runHandoffChain(
  options: HandoffOptions,
): Promise<CoordinationResult> {
  const { agents, startAgent, task, runner, maxHandoffs = 8 } = options;
  const startTime = Date.now();

  const messages: AgentMessage[] = [];
  const agentOutputs: Record<string, string> = {};
  const tokenUsage: Record<string, { inputTokens: number; outputTokens: number }> = {};

  const sharedState: SharedState = {
    task,
    context: [task],
    artifacts: {},
    status: "active",
    rounds: 0,
    maxRounds: maxHandoffs,
  };

  let success = false;
  let finalOutput = "";
  let error: string | undefined;
  let currentAgentName = startAgent;

  try {
    for (let handoff = 0; handoff < maxHandoffs; handoff++) {
      sharedState.rounds = handoff + 1;

      const currentAgent = agents.find((a) => a.name === currentAgentName);
      if (!currentAgent) {
        error = `Agent "${currentAgentName}" not found`;
        break;
      }

      const agentMsg = await runner(currentAgent, task, {
        sharedState,
        history: messages,
      });

      messages.push(agentMsg);
      agentOutputs[currentAgent.name] = agentMsg.content;
      accumulateTokens(tokenUsage, currentAgent.name, agentMsg);

      // Check if the agent completed the task or handed off.
      const handoffTarget = extractHandoff(agentMsg.content, agents);

      if (handoffTarget === null) {
        // No handoff — task is complete.
        finalOutput = agentMsg.content;
        success = true;
        sharedState.context.push(`[${currentAgent.name}]: ${agentMsg.content.slice(0, 500)}`);
        break;
      }

      // Handoff to the next agent.
      const handoffMsg: HandoffMessage = {
        from: currentAgent.name,
        to: [handoffTarget],
        content: agentMsg.content,
        kind: "handoff",
        timestamp: new Date().toISOString(),
        reason: extractHandoffReason(agentMsg.content) ?? "Agent requested handoff",
      };
      messages.push(handoffMsg);
      sharedState.context.push(`[${currentAgent.name}] → [${handoffTarget}]: ${handoffMsg.reason}`);
      currentAgentName = handoffTarget;
    }

    if (!success && !error) {
      sharedState.status = "timed_out";
      finalOutput = `Handoff chain reached max length (${maxHandoffs}) without completion.`;
    }
  } catch (err) {
    sharedState.status = "failed";
    error = err instanceof Error ? err.message : String(err);
    finalOutput = `Handoff chain failed: ${error}`;
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

/**
 * Extract a handoff target from an agent's response.
 * Looks for patterns like:
 * - "HANDOFF: agent_name"
 * - "→ agent_name"
 * - "transfer to agent_name"
 * Returns null if no handoff is requested (task complete).
 */
function extractHandoff(content: string, agents: CoordAgent[]): string | null {
  const patterns = [
    /HANDOFF\s*(?:to)?\s*:?\s*(\w+)/i,
    /(?:→|->|transfer\s+to)\s+(\w+)/i,
    /(?:delegate|route|pass)\s+(?:to\s+)?(\w+)/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      const targetName = match[1].toLowerCase();
      const agent = agents.find((a) => a.name.toLowerCase() === targetName);
      if (agent) {
        return agent.name;
      }
    }
  }

  return null;
}

function extractHandoffReason(content: string): string | null {
  const match = content.match(/HANDOFF.*(?:because|reason|since)\s*:?\s*(.+)/i);
  return match ? match[1].trim() : null;
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
