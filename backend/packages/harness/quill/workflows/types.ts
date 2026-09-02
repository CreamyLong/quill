/**
 * Workflow system — DAG-based agent orchestration.
 *
 * Port of CrewAI Flows' event-driven patterns + DeerFlow's coordinator-
 * researcher-writer workflow + LangGraph's subgraph composition.
 *
 * A workflow is a directed acyclic graph of nodes. Each node is an
 * agent (or a pure function) that receives inputs from its upstream
 * nodes and produces outputs for its downstream nodes. The workflow
 * engine handles:
 *   - Topological execution (respect dependencies)
 *   - Parallel execution of independent nodes
 *   - State passing between nodes
 *   - Conditional branching (router nodes)
 *   - Error handling and retry
 *
 * Architecture:
 *   ┌──────────┐     ┌──────────┐     ┌──────────┐
 *   │  Start   │────→│ Research │────→│  Write   │
 *   └──────────┘     └──────────┘     └──────────┘
 *                         │                  │
 *                         ↓                  ↓
 *                    ┌──────────┐     ┌──────────┐
 *                    │  Review  │────→│  Output  │
 *                    └──────────┘     └──────────┘
 */

// ---------------------------------------------------------------------------
// Node definitions
// ---------------------------------------------------------------------------

/**
 * A node in the workflow graph.
 *
 * Nodes can be:
 * - Agent nodes: run an agent to produce output
 * - Function nodes: run a pure function (transform, filter, merge)
 * - Router nodes: conditionally select the next node
 * - Parallel nodes: fan out to multiple nodes simultaneously
 */
export type WorkflowNode =
  | AgentWorkflowNode
  | FunctionWorkflowNode
  | RouterWorkflowNode;

/** Base node interface. */
interface BaseWorkflowNode {
  id: string;
  description?: string;
}

/** A node that runs an agent. */
export interface AgentWorkflowNode extends BaseWorkflowNode {
  kind: "agent";
  /** Agent configuration. */
  agentConfig: WorkflowAgentConfig;
  /** Input mapping — maps workflow state keys to agent prompt variables. */
  inputMapping?: Record<string, string>;
  /** Output key — where to store the agent's response in workflow state. */
  outputKey: string;
  /** Maximum turns for this agent. */
  maxTurns?: number;
  /** Timeout in seconds. */
  timeoutSeconds?: number;
}

/** A node that runs a pure function. */
export interface FunctionWorkflowNode extends BaseWorkflowNode {
  kind: "function";
  /** The function to execute. */
  fn: (state: WorkflowState) => WorkflowState | Promise<WorkflowState>;
  /** Output key — where to store the function result. */
  outputKey?: string;
}

/** A node that routes to different branches. */
export interface RouterWorkflowNode extends BaseWorkflowNode {
  kind: "router";
  /** Routing function — returns the next node ID. */
  route: (state: WorkflowState) => string;
  /** Possible destinations. */
  destinations: string[];
}

/** Agent configuration for workflow nodes. */
export interface WorkflowAgentConfig {
  name: string;
  role: string;
  goal: string;
  backstory?: string;
  systemPrompt?: string;
  allowedTools?: string[] | null;
  deniedTools?: string[] | null;
  model?: string;
}

// ---------------------------------------------------------------------------
// Graph definition
// ---------------------------------------------------------------------------

/**
 * Edge in the workflow graph — defines data/control flow.
 */
export interface WorkflowEdge {
  from: string;
  to: string;
  /** Optional condition for this edge (only taken if true). */
  condition?: (state: WorkflowState) => boolean;
  /** Data mapping — selects/transforms state keys for the target node. */
  dataMapping?: Record<string, string>;
}

/**
 * The complete workflow definition.
 */
export interface WorkflowDefinition {
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** Entry node ID. */
  startNode: string;
  /** Terminal node IDs — reaching any of these ends the workflow. */
  endNodes?: string[];
  /** Maximum total execution time in seconds. */
  timeoutSeconds?: number;
  /** Maximum retries for failed nodes. */
  maxRetries?: number;
}

// ---------------------------------------------------------------------------
// Execution state
// ---------------------------------------------------------------------------

/**
 * Runtime state of a workflow execution.
 */
export interface WorkflowState {
  /** The original input. */
  input: Record<string, unknown>;
  /** Intermediate results keyed by node ID or output key. */
  results: Record<string, unknown>;
  /** Execution metadata. */
  meta: {
    workflowName: string;
    startedAt: string;
    currentNodes: string[];
    completedNodes: string[];
    failedNodes: Array<{ node: string; error: string }>;
    rounds: number;
  };
}

// ---------------------------------------------------------------------------
// Execution result
// ---------------------------------------------------------------------------

/**
 * Result of a workflow execution.
 */
export interface WorkflowResult {
  /** Final output. */
  output: Record<string, unknown>;
  /** Whether the workflow completed successfully. */
  success: boolean;
  /** Final state. */
  state: WorkflowState;
  /** Execution duration in ms. */
  durationMs: number;
  /** Per-node results. */
  nodeResults: Record<string, { output: unknown; durationMs: number }>;
  /** Error message if failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Runner contract
// ---------------------------------------------------------------------------

/**
 * Function that executes an agent node.
 * Bridges the workflow engine to the agent runtime.
 */
export type WorkflowAgentRunner = (
  config: WorkflowAgentConfig,
  input: Record<string, string>,
  state: WorkflowState,
) => Promise<string>;
