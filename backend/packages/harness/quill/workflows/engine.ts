/**
 * Workflow execution engine — DAG-based agent orchestration.
 *
 * Executes a WorkflowDefinition by:
 * 1. Building a dependency graph from nodes and edges
 * 2. Topologically sorting nodes for execution order
 * 3. Running nodes in parallel when dependencies are satisfied
 * 4. Passing state between nodes via data mappings
 * 5. Handling conditional branching (router nodes)
 * 6. Retrying failed nodes up to maxRetries
 *
 * Mirrors LangGraph's execution model and CrewAI Flows' event-driven
 * execution. The engine is agent-runtime-agnostic — it delegates
 * agent execution to the injected WorkflowAgentRunner.
 */

import type {
  WorkflowAgentRunner,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
  WorkflowResult,
  WorkflowState,
} from "./types.js";

export interface WorkflowEngineOptions {
  /** Agent runner — executes agent nodes. */
  agentRunner: WorkflowAgentRunner;
  /** Progress callback. */
  onNodeComplete?: (nodeId: string, output: unknown) => void;
  onNodeStart?: (nodeId: string) => void;
  onNodeError?: (nodeId: string, error: Error, attempt: number) => void;
}

/**
 * Execute a workflow definition.
 *
 * Runs the workflow from startNode, following edges and executing
 * nodes until an endNode is reached or all nodes are complete.
 */
export async function executeWorkflow(
  definition: WorkflowDefinition,
  input: Record<string, unknown>,
  options: WorkflowEngineOptions,
): Promise<WorkflowResult> {
  const startTime = Date.now();
  const { agentRunner, onNodeStart, onNodeComplete, onNodeError } = options;

  // Build adjacency and reverse-adjacency maps.
  const adjacency = buildAdjacencyMap(definition.edges);
  const reverseAdjacency = buildReverseAdjacencyMap(definition.edges);
  const nodeMap = new Map<string, WorkflowNode>();
  for (const node of definition.nodes) {
    nodeMap.set(node.id, node);
  }

  const endNodes = new Set(definition.endNodes ?? []);
  const timeoutSeconds = definition.timeoutSeconds ?? 1800; // 30 min default
  const maxRetries = definition.maxRetries ?? 2;

  // Initialize state.
  const state: WorkflowState = {
    input,
    results: { ...input },
    meta: {
      workflowName: definition.name,
      startedAt: new Date().toISOString(),
      currentNodes: [],
      completedNodes: [],
      failedNodes: [],
      rounds: 0,
    },
  };

  const nodeResults: WorkflowResult["nodeResults"] = {};
  let success = true;
  let error: string | undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    // Track which nodes are ready to execute (all dependencies met).
    const completed = new Set<string>();
    const inProgress = new Set<string>();

    // Start with the startNode.
    const readyQueue: string[] = [definition.startNode];

    while (readyQueue.length > 0 || inProgress.size > 0) {
      if (controller.signal.aborted) {
        success = false;
        error = `Workflow timed out after ${timeoutSeconds}s`;
        break;
      }

      // Execute all ready nodes in parallel.
      const batch = [...readyQueue];
      readyQueue.length = 0;

      if (batch.length === 0 && inProgress.size > 0) {
        // Waiting for in-progress nodes — this shouldn't happen with
        // our await below, but guard against infinite loops.
        break;
      }

      const batchPromises = batch.map(async (nodeId) => {
        const node = nodeMap.get(nodeId);
        if (!node) {
          throw new Error(`Node "${nodeId}" not found in workflow definition`);
        }

        inProgress.add(nodeId);
        state.meta.currentNodes = [...inProgress];
        onNodeStart?.(nodeId);

        let lastError: Error | undefined;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const output = await executeNode(node, state, agentRunner);
            const durationMs = 0; // Could track per-node duration.
            nodeResults[nodeId] = { output, durationMs };

            // Store result in state.
            if (node.kind === "agent") {
              state.results[node.outputKey] = output;
            } else if (node.kind === "function" && node.outputKey) {
              state.results[node.outputKey] = output;
            }

            completed.add(nodeId);
            inProgress.delete(nodeId);
            state.meta.completedNodes.push(nodeId);
            onNodeComplete?.(nodeId, output);

            // Determine next nodes.
            const nextNodes = getNextNodes(node, nodeMap.get(nodeId)!, adjacency, state);
            for (const next of nextNodes) {
              if (!completed.has(next) && !inProgress.has(next)) {
                // Check if all dependencies of next are met.
                const deps = reverseAdjacency.get(next) ?? [];
                if (deps.every((dep) => completed.has(dep))) {
                  readyQueue.push(next);
                }
              }
            }

            return;
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            onNodeError?.(nodeId, lastError, attempt + 1);
            if (attempt < maxRetries) {
              // Exponential backoff.
              await delay(Math.pow(2, attempt) * 1000);
            }
          }
        }

        // All retries exhausted.
        inProgress.delete(nodeId);
        state.meta.failedNodes.push({ node: nodeId, error: lastError?.message ?? "Unknown error" });
        success = false;
        error = `Node "${nodeId}" failed after ${maxRetries + 1} attempts: ${lastError?.message}`;
      });

      await Promise.all(batchPromises);

      if (!success) break;

      // Check if we've reached an end node.
      for (const nodeId of completed) {
        if (endNodes.has(nodeId)) {
          success = true;
          // Drain remaining work.
          readyQueue.length = 0;
          break;
        }
      }
    }
  } catch (err) {
    success = false;
    error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }

  return {
    output: state.results,
    success,
    state,
    durationMs: Date.now() - startTime,
    nodeResults,
    error,
  };
}

// ---------------------------------------------------------------------------
// Node execution
// ---------------------------------------------------------------------------

async function executeNode(
  node: WorkflowNode,
  state: WorkflowState,
  agentRunner: WorkflowAgentRunner,
): Promise<unknown> {
  switch (node.kind) {
    case "agent": {
      // Build input for the agent from the input mapping.
      const agentInput: Record<string, string> = {};
      if (node.inputMapping) {
        for (const [agentKey, stateKey] of Object.entries(node.inputMapping)) {
          const value = state.results[stateKey];
          agentInput[agentKey] = typeof value === "string" ? value : JSON.stringify(value);
        }
      } else {
        // Default: pass all results as stringified inputs.
        for (const [key, value] of Object.entries(state.results)) {
          agentInput[key] = typeof value === "string" ? value : JSON.stringify(value);
        }
      }

      const response = await agentRunner(node.agentConfig, agentInput, state);
      return response;
    }

    case "function": {
      const result = await node.fn(state);
      // Function nodes can return a partial state update.
      if (result && typeof result === "object" && "results" in result) {
        return result;
      }
      return result;
    }

    case "router": {
      // Router nodes don't produce output — they select the next node.
      // The routing is handled by getNextNodes.
      return node.route(state);
    }

    default:
      throw new Error(`Unknown node kind: ${(node as WorkflowNode).kind}`);
  }
}

// ---------------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------------

function buildAdjacencyMap(edges: WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  const map = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    const list = map.get(edge.from) ?? [];
    list.push(edge);
    map.set(edge.from, list);
  }
  return map;
}

function buildReverseAdjacencyMap(edges: WorkflowEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const list = map.get(edge.to) ?? [];
    list.push(edge.from);
    map.set(edge.to, list);
  }
  return map;
}

function getNextNodes(
  node: WorkflowNode,
  fullNode: WorkflowNode,
  adjacency: Map<string, WorkflowEdge[]>,
  state: WorkflowState,
): string[] {
  const edges = adjacency.get(node.id) ?? [];
  const nextNodes: string[] = [];

  for (const edge of edges) {
    // Check edge condition.
    if (edge.condition && !edge.condition(state)) {
      continue;
    }
    nextNodes.push(edge.to);
  }

  return nextNodes;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
