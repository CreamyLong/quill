/**
 * Agent Teams Types — multi-agent coordination with task DAG.
 *
 * An AgentTeam is a lead agent + teammate roster with a shared task board.
 * Tasks can have blocking edges (blockedBy) forming a DAG. Teammates
 * communicate via a mailbox.
 *
 * Source patterns:
 * - DeepSeek Harness: Agent Teams with durable roster, task DAG with blocking
 *   edges, mailbox, continuable teammates with steer messaging
 * - CrewAI: Crews (autonomous) + Flows (deterministic) dual paradigm
 */

/** A task on the shared task board. */
export interface TeamTask {
  /** Unique task identifier. */
  id: string;
  /** Short description of the task. */
  description: string;
  /** Detailed prompt for the assigned teammate. */
  prompt: string;
  /** Teammate assigned to this task. */
  assignee: string;
  /** Task IDs that must complete before this task can start. */
  blockedBy: string[];
  /** Current status of the task. */
  status: "pending" | "blocked" | "ready" | "running" | "completed" | "failed";
  /** Result of the task (when completed). */
  result?: string;
  /** Creation timestamp. */
  created_at: string;
  /** Last update timestamp. */
  updated_at: string;
}

/** A teammate in the team roster. */
export interface Teammate {
  /** Unique teammate identifier. */
  id: string;
  /** Display name. */
  name: string;
  /** Role description. */
  role: string;
  /** System prompt for this teammate. */
  systemPrompt: string;
  /** Current status. */
  status: "idle" | "working" | "done" | "failed";
  /** Subagent type to use. */
  subagentType: string;
}

/** A message in the teammate mailbox. */
export interface MailboxMessage {
  /** Message identifier. */
  id: string;
  /** Sender teammate ID. */
  from: string;
  /** Recipient teammate ID (or "broadcast"). */
  to: string;
  /** Message content. */
  content: string;
  /** Timestamp. */
  created_at: string;
  /** Whether the message has been read. */
  read: boolean;
}

/** Coordination strategy for the team. */
export type CoordinationStrategy = "supervisor" | "round_robin" | "handoff";

/** Agent team state stored in ThreadState. */
export interface AgentTeamState {
  /** Team identifier. */
  id: string;
  /** Coordination strategy. */
  strategy: CoordinationStrategy;
  /** Teammate roster. */
  teammates: Teammate[];
  /** Shared task board. */
  tasks: TeamTask[];
  /** Mailbox messages. */
  mailbox: MailboxMessage[];
  /** Current phase of team execution. */
  phase: "forming" | "planning" | "executing" | "synthesizing" | "done";
  /** Creation timestamp. */
  created_at: string;
  /** Last update timestamp. */
  updated_at: string;
}

/** Request to create a team. */
export interface CreateTeamRequest {
  /** Teammate definitions. */
  teammates: Array<{
    name: string;
    role: string;
    systemPrompt?: string;
    subagentType?: string;
  }>;
  /** Initial tasks. */
  tasks?: Array<{
    description: string;
    prompt: string;
    assignee: string;
    blockedBy?: string[];
  }>;
  /** Coordination strategy. */
  strategy?: CoordinationStrategy;
}
