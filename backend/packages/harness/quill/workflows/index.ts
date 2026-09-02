/**
 * Workflow system — DAG-based agent orchestration.
 *
 * Port of CrewAI Flows' event-driven patterns + DeerFlow's coordinator-
 * researcher-writer workflow + LangGraph's subgraph composition.
 *
 * A workflow is a directed acyclic graph of nodes where each node is an
 * agent or a function. The workflow engine handles execution ordering,
 * parallel execution, state passing, conditional branching, and retries.
 *
 * Quick start:
 *   import { executeWorkflow } from "quill.workflows";
 *
 *   const result = await executeWorkflow({
 *     name: "research-pipeline",
 *     startNode: "research",
 *     nodes: [
 *       { id: "research", kind: "agent", agentConfig: {...}, outputKey: "findings" },
 *       { id: "write", kind: "agent", agentConfig: {...}, inputMapping: { findings: "findings" }, outputKey: "draft" },
 *     ],
 *     edges: [
 *       { from: "research", to: "write" },
 *     ],
 *   }, { topic: "AI agents" }, { agentRunner: myRunner });
 */

export type {
  WorkflowNode,
  AgentWorkflowNode,
  FunctionWorkflowNode,
  RouterWorkflowNode,
  WorkflowEdge,
  WorkflowDefinition,
  WorkflowState,
  WorkflowResult,
  WorkflowAgentConfig,
  WorkflowAgentRunner,
} from "./types.js";

export { executeWorkflow, type WorkflowEngineOptions } from "./engine.js";
