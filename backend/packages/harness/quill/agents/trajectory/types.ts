/**
 * Model Trajectory — recording and replay of model decision paths.
 *
 * Inspired by ZCode's model trajectory recording and DeepSeek Harness's
 * session log as deterministic replay source.
 *
 * A trajectory is a directed graph of model decisions:
 *   nodes = LLM calls (with prompts, responses, tool calls)
 *   edges = transitions between decisions (tool results → next prompt)
 *
 * Trajectories enable:
 *   - Debugging: trace why the model made specific decisions
 *   - Optimization: identify redundant or inefficient tool call patterns
 *   - Replay: reproduce exact execution paths for testing
 *   - Analysis: understand model behavior patterns
 *
 * Source patterns:
 * - ZCode: Model trajectory recording with file tail
 * - DeepSeek Harness: Session log as deterministic replay source
 * - Codex CLI: Tool orchestrator with approval-sandbox-attempt-retry
 */

// ---------------------------------------------------------------------------
// Trajectory node types
// ---------------------------------------------------------------------------

/**
 * Types of trajectory nodes.
 */
export type TrajectoryNodeType =
  | "llm_call"        // Model invocation (prompt → response)
  | "tool_call"       // Tool execution (tool name + args)
  | "tool_result"     // Tool output
  | "user_message"    // User input
  | "system_event"    // System-level event (session start/end)
  | "error";          // Error occurred

/**
 * A node in the trajectory graph.
 */
export interface TrajectoryNode {
  /** Unique node ID. */
  id: string;
  /** Node type. */
  type: TrajectoryNodeType;
  /** Sequence number within the trajectory. */
  sequence: number;
  /** Timestamp. */
  timestamp: string;
  /** Duration in ms (for llm_call and tool_call). */
  durationMs?: number;
  /** Node content. */
  content: {
    /** For llm_call: model name. */
    model?: string;
    /** For llm_call: input tokens. */
    inputTokens?: number;
    /** For llm_call: output tokens. */
    outputTokens?: number;
    /** For tool_call: tool name. */
    toolName?: string;
    /** For tool_call: tool arguments (truncated). */
    toolArgs?: Record<string, unknown>;
    /** For tool_result: result summary. */
    resultSummary?: string;
    /** For user_message: message preview. */
    messagePreview?: string;
    /** For error: error message. */
    errorMessage?: string;
    /** For system_event: event name. */
    eventName?: string;
  };
  /** Caller (lead_agent, subagent:name, middleware:name). */
  caller?: string;
}

/**
 * An edge in the trajectory graph (transition between nodes).
 */
export interface TrajectoryEdge {
  /** Source node ID. */
  sourceId: string;
  /** Target node ID. */
  targetId: string;
  /** Transition type. */
  transitionType:
    | "tool_result_to_next_prompt"
    | "tool_call_to_result"
    | "prompt_to_tool_call"
    | "user_to_response"
    | "error_to_retry"
    | "sequential";
  /** Optional label. */
  label?: string;
}

/**
 * Complete trajectory graph.
 */
export interface TrajectoryGraph {
  /** Trajectory ID (same as run ID). */
  id: string;
  /** Thread ID. */
  threadId: string;
  /** Start timestamp. */
  startedAt: string;
  /** End timestamp. */
  endedAt?: string;
  /** Whether the trajectory is complete. */
  complete: boolean;
  /** Graph nodes. */
  nodes: TrajectoryNode[];
  /** Graph edges. */
  edges: TrajectoryEdge[];
  /** Graph-level metrics. */
  metrics: {
    totalNodes: number;
    llmCallCount: number;
    toolCallCount: number;
    errorCount: number;
    totalTokens: number;
    totalDurationMs: number;
    uniqueToolsUsed: string[];
    modelsUsed: string[];
  };
}

// ---------------------------------------------------------------------------
// Replay types
// ---------------------------------------------------------------------------

/**
 * Replay options.
 */
export interface ReplayOptions {
  /** Whether to actually execute tool calls (false = dry run). */
  executeTools: boolean;
  /** Whether to actually call LLM (false = use recorded responses). */
  callLlm: boolean;
  /** Stop after N nodes (for partial replay). */
  stopAfter?: number;
  /** Inject modifications at specific nodes. */
  modifications?: Array<{
    nodeId: string;
    newContent: Record<string, unknown>;
  }>;
}

/**
 * Replay result.
 */
export interface ReplayResult {
  /** Whether replay completed. */
  completed: boolean;
  /** Nodes processed. */
  nodesProcessed: number;
  /** Whether replay matched original trajectory. */
  matched: boolean;
  /** Differences from original. */
  differences: Array<{
    nodeId: string;
    field: string;
    expected: unknown;
    actual: unknown;
  }>;
  /** Error if replay failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Recording configuration
// ---------------------------------------------------------------------------

/**
 * Trajectory recording configuration.
 */
export interface TrajectoryConfig {
  /** Whether recording is enabled. */
  enabled: boolean;
  /** Maximum nodes per trajectory (default: 10000). */
  maxNodes: number;
  /** Whether to record full tool arguments (false = truncate). */
  recordFullArgs: boolean;
  /** Maximum content length to record per node. */
  maxContentLength: number;
  /** Whether to record user messages. */
  recordUserMessages: boolean;
  /** Whether to record system events. */
  recordSystemEvents: boolean;
}

/**
 * Default trajectory configuration.
 */
export const DEFAULT_TRAJECTORY_CONFIG: TrajectoryConfig = {
  enabled: true,
  maxNodes: 10000,
  recordFullArgs: false,
  maxContentLength: 1000,
  recordUserMessages: true,
  recordSystemEvents: true,
};
