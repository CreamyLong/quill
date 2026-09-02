/**
 * Multi-Agent Coordination — core types.
 *
 * Port of coordination patterns from:
 *   - CrewAI: role-based crews, task delegation, flow patterns
 *   - AutoGen: group chat, selector patterns, handoff messages
 *   - Kimi Code: Tower protocol (mission-based, worktree isolation)
 *   - LangGraph: supervisor pattern, hierarchical teams
 *
 * This module provides the type contracts for multi-agent coordination
 * patterns that extend Quill's existing subagent system (which handles
 * single parent→child delegation). Multi-agent coordination handles:
 *   - Peer-to-peer message passing
 *   - Dynamic agent routing (who speaks next)
 *   - Shared vs. isolated scratchpads
 *   - Coordinated mission decomposition
 */

// ---------------------------------------------------------------------------
// Agent identity
// ---------------------------------------------------------------------------

/**
 * An agent participating in a multi-agent system.
 * Mirrors CrewAI's Agent concept and AutoGen's ConversableAgent contract.
 */
export interface CoordAgent {
  /** Unique name within the crew/workflow. */
  name: string;
  /** Human-readable role description. */
  role: string;
  /** Detailed goal/instruction for this agent. */
  goal: string;
  /** Optional backstory/context (CrewAI pattern). */
  backstory?: string;
  /** Tools this agent is allowed to use (null = inherit all). */
  allowedTools?: string[] | null;
  /** Tools explicitly denied to this agent. */
  deniedTools?: string[] | null;
  /** Model override for this agent. */
  model?: string;
  /** Maximum number of turns this agent can take in a single mission. */
  maxTurns?: number;
  /**
   * Whether this agent can spawn subagents.
   * Default: false (prevents recursive multi-agent spawning).
   */
  canDelegate?: boolean;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * A message exchanged between agents.
 * Mirrors AutoGen's message contract and Kimi Code's TowerSend.
 */
export interface AgentMessage {
  /** Who sent this message. */
  from: string;
  /** Who should receive this message (empty = broadcast). */
  to: string[];
  /** Message content. */
  content: string;
  /** Message type for routing. */
  kind: "request" | "response" | "handoff" | "review" | "alert" | "silent";
  /** Timestamp. */
  timestamp: string;
  /** Optional metadata (mission context, priority, etc.). */
  metadata?: Record<string, unknown>;
}

/**
 * Handoff message — signals that control should transfer to another agent.
 * Mirrors AutoGen's HandoffMessage and OpenAI Agents SDK's handoff pattern.
 */
export interface HandoffMessage extends AgentMessage {
  kind: "handoff";
  /** The reason for the handoff. */
  reason: string;
  /** Context to pass to the next agent. */
  context?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Coordination patterns
// ---------------------------------------------------------------------------

/**
 * Coordination strategy — determines how agents interact.
 * Mirrors AutoGen's team patterns and CrewAI's process types.
 */
export type CoordinationStrategy =
  | "round_robin" // AutoGen RoundRobinGroupChat: agents take turns
  | "supervisor" // LangGraph supervisor: one agent routes tasks
  | "selector" // AutoGen SelectorGroupChat: LLM picks next speaker
  | "handoff" // AutoGen Swarm: agents signal transitions
  | "hierarchical" // LangGraph hierarchical teams: supervisors of supervisors
  | "tower"; // Kimi Code Tower: mission-based with worktree isolation

/**
 * Shared state visible to all agents in a coordination round.
 * Mirrors the "shared scratchpad" pattern from LangGraph collaboration.
 */
export interface SharedState {
  /** The original task/request. */
  task: string;
  /** Accumulated context from previous agent turns. */
  context: string[];
  /** Artifacts produced by any agent. */
  artifacts: Record<string, string[]>;
  /** Current status of the coordination. */
  status: "active" | "completed" | "failed" | "timed_out";
  /** Number of coordination rounds so far. */
  rounds: number;
  /** Maximum rounds before timeout. */
  maxRounds: number;
}

// ---------------------------------------------------------------------------
// Mission decomposition (Tower protocol)
// ---------------------------------------------------------------------------

/**
 * A mission — a unit of work assigned to an agent in the Tower pattern.
 * Mirrors Kimi Code's TowerPlan missions.
 */
export interface Mission {
  id: string;
  /** Brief description of what this mission should accomplish. */
  description: string;
  /** Scope — files or modules this agent owns. */
  scope: string[];
  /** Mission kind: "build" (write code) or "survey" (read-only research). */
  kind: "build" | "survey";
  /** IDs of missions this one depends on. */
  dependencies: string[];
  /** Current status. */
  status: "pending" | "in_progress" | "review" | "done" | "blocked";
  /** Assigned agent name. */
  assignedTo?: string;
  /** Review verdict (for review missions). */
  verdict?: "clean" | "fix" | "hold";
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * Result of a multi-agent coordination run.
 */
export interface CoordinationResult {
  /** Final output/response. */
  output: string;
  /** Whether the coordination succeeded. */
  success: boolean;
  /** All messages exchanged. */
  messages: AgentMessage[];
  /** Per-agent outputs. */
  agentOutputs: Record<string, string>;
  /** Missions completed (Tower pattern). */
  missions?: Mission[];
  /** Token usage per agent. */
  tokenUsage: Record<string, { inputTokens: number; outputTokens: number }>;
  /** Total wall-clock ms. */
  durationMs: number;
  /** Number of coordination rounds. */
  rounds: number;
  /** Error message if failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Runner contract
// ---------------------------------------------------------------------------

/**
 * A function that runs a single agent with a message and returns its response.
 * This is the bridge between the multi-agent coordinator and the agent runtime
 * (QuillClient or similar).
 */
export type AgentRunner = (
  agent: CoordAgent,
  message: string,
  context: { sharedState: SharedState; history: AgentMessage[] },
) => Promise<AgentMessage>;

/**
 * A function that selects the next agent to speak (for selector strategy).
 * Mirrors AutoGen's speaker selection.
 */
export type SelectorFn = (
  agents: CoordAgent[],
  history: AgentMessage[],
  sharedState: SharedState,
) => Promise<string>; // returns agent name

/**
 * A function that evaluates whether the coordination is complete.
 */
export type TerminationFn = (
  history: AgentMessage[],
  sharedState: SharedState,
) => boolean;
