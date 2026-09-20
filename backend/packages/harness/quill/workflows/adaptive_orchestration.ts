/**
 * Adaptive Orchestration Topology — dynamic coordination pattern selection.
 *
 * Inspired by the awesome-harness-engineering "AdaptOrch" pattern and
 * CrewAI's dual paradigm (Crews + Flows).
 *
 * Fixed pipelines are suboptimal: the orchestration topology should match
 * the task structure. This module dynamically selects the best coordination
 * pattern based on the task dependency graph:
 *
 *   parallel      — All tasks are independent (fan-out/fan-in)
 *   sequential    — Tasks have linear dependencies (chain)
 *   hierarchical  — Tree-shaped task decomposition (supervisor → workers)
 *   hybrid        — Mix of parallel and sequential (DAG-based)
 *
 * Source patterns:
 * - awesome-harness-engineering: AdaptOrch — dynamic topology selection
 * - CrewAI: Crews (autonomous collaboration) + Flows (event-driven control)
 * - DeerFlow 2.0: Lead agent + on-demand subagents (not default)
 * - Codex CLI: Multi-agent V2 with namespaced tools and catalog overrides
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Orchestration topology options.
 */
export type OrchestrationTopology = "parallel" | "sequential" | "hierarchical" | "hybrid";

/**
 * A unit of work in the task dependency graph.
 */
export interface TaskNode {
  id: string;
  description: string;
  /** IDs of tasks this depends on (must complete first). */
  dependsOn?: string[];
  /** Estimated complexity (1-10) for routing decisions. */
  complexity?: number;
  /** Preferred agent type for this task. */
  agentType?: string;
  /** Whether this task can run in parallel with others. */
  parallelizable?: boolean;
}

/**
 * Task dependency graph.
 */
export interface TaskGraph {
  tasks: TaskNode[];
  /** Entry point task IDs (no dependencies). */
  entryPoints?: string[];
}

/**
 * Analysis result for topology selection.
 */
export interface TopologyAnalysis {
  topology: OrchestrationTopology;
  reasoning: string;
  /** Detected parallel groups (for parallel/hybrid). */
  parallelGroups: string[][];
  /** Detected sequential chains (for sequential/hybrid). */
  sequentialChains: string[][];
  /** Recommended worker count. */
  recommendedWorkers: number;
  /** Estimated total complexity. */
  totalComplexity: number;
}

/**
 * Coordination task for execution.
 */
export interface CoordinationTask {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
  /** Tasks that depend on this one. */
  dependents: string[];
  /** Tasks this depends on. */
  dependencies: string[];
}

// ---------------------------------------------------------------------------
// Topology Analyzer
// ---------------------------------------------------------------------------

/**
 * Analyze a task graph and recommend the optimal orchestration topology.
 *
 * Decision rules:
 * - All tasks independent (no edges) → parallel
 * - All tasks linear (single chain) → sequential
 * - Mix of independent groups with internal ordering → hybrid
 * - Tree-shaped (one root, multiple leaves) → hierarchical
 */
export function analyzeTopology(graph: TaskGraph): TopologyAnalysis {
  const tasks = graph.tasks;
  const totalComplexity = tasks.reduce(
    (sum, t) => sum + (t.complexity ?? 5),
    0,
  );

  // Build dependency analysis
  const hasDependencies = tasks.filter((t) => t.dependsOn && t.dependsOn.length > 0);
  const independentTasks = tasks.filter((t) => !t.dependsOn || t.dependsOn.length === 0);

  // Detect parallel groups (tasks at the same dependency level)
  const parallelGroups = detectParallelGroups(tasks);

  // Detect sequential chains (linear dependency paths)
  const sequentialChains = detectSequentialChains(tasks);

  // Determine topology
  let topology: OrchestrationTopology;
  let reasoning: string;
  let recommendedWorkers: number;

  if (hasDependencies.length === 0) {
    // All tasks are independent
    topology = "parallel";
    reasoning = `All ${tasks.length} tasks are independent — parallel execution maximizes throughput.`;
    recommendedWorkers = Math.min(tasks.length, 8);
  } else if (sequentialChains.length === 1 && sequentialChains[0].length === tasks.length) {
    // Single linear chain covering all tasks
    topology = "sequential";
    reasoning = `Tasks form a single linear chain (${sequentialChains[0].length} steps) — sequential execution is optimal.`;
    recommendedWorkers = 1;
  } else if (sequentialChains.length > 1 && parallelGroups.length > 1) {
    // Mix of parallel groups and sequential chains
    topology = "hybrid";
    reasoning = `Detected ${parallelGroups.length} parallel groups and ${sequentialChains.length} sequential chains — hybrid execution.`;
    recommendedWorkers = Math.min(parallelGroups.length, 6);
  } else if (independentTasks.length > 0 && hasDependencies.length > 0) {
    // Some tasks depend on others, some don't
    const maxDepth = getMaxDepth(tasks);
    if (maxDepth <= 2 && independentTasks.length > hasDependencies.length) {
      topology = "hierarchical";
      reasoning = `Tree-shaped task structure (depth: ${maxDepth}) — hierarchical delegation is optimal.`;
      recommendedWorkers = independentTasks.length;
    } else {
      topology = "hybrid";
      reasoning = `Mixed dependency structure (depth: ${maxDepth}) — hybrid execution adapts to task relationships.`;
      recommendedWorkers = Math.min(parallelGroups.length || 1, 6);
    }
  } else {
    // Fallback
    topology = "hybrid";
    reasoning = `Complex dependency structure — hybrid execution with dynamic scheduling.`;
    recommendedWorkers = Math.min(Math.ceil(tasks.length / 2), 6);
  }

  return {
    topology,
    reasoning,
    parallelGroups,
    sequentialChains,
    recommendedWorkers,
    totalComplexity,
  };
}

// ---------------------------------------------------------------------------
// Dependency Graph Analysis
// ---------------------------------------------------------------------------

/**
 * Detect groups of tasks that can run in parallel.
 *
 * Two tasks are in the same parallel group if neither depends on the other
 * (directly or transitively).
 */
function detectParallelGroups(tasks: TaskNode[]): string[][] {
  const groups: string[][] = [];
  const assigned = new Set<string>();

  // Group by dependency depth (topological level)
  const depthMap = new Map<string, number>();
  for (const task of tasks) {
    depthMap.set(task.id, computeDepth(task.id, tasks, depthMap));
  }

  // Group tasks at the same depth
  const depthGroups = new Map<number, string[]>();
  for (const [taskId, depth] of depthMap) {
    const group = depthGroups.get(depth) ?? [];
    group.push(taskId);
    depthGroups.set(depth, group);
  }

  for (const [, group] of [...depthGroups.entries()].sort((a, b) => a[0] - b[0])) {
    if (group.length > 1) {
      groups.push(group);
    }
    group.forEach((id) => assigned.add(id));
  }

  return groups;
}

/**
 * Detect sequential chains in the task graph.
 */
function detectSequentialChains(tasks: TaskNode[]): string[][] {
  const chains: string[][] = [];
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const hasDependent = new Set<string>();

  for (const task of tasks) {
    if (task.dependsOn) {
      for (const dep of task.dependsOn) {
        hasDependent.add(dep);
      }
    }
  }

  // Find chain starts (tasks with no dependencies)
  const chainStarts = tasks.filter((t) => !t.dependsOn || t.dependsOn.length === 0);

  for (const start of chainStarts) {
    const chain: string[] = [start.id];
    let current = start;

    // Follow the chain
    while (true) {
      const next = tasks.find(
        (t) => t.dependsOn && t.dependsOn.includes(current.id),
      );
      if (!next) break;
      chain.push(next.id);
      current = next;
    }

    if (chain.length > 1) {
      chains.push(chain);
    }
  }

  return chains;
}

/**
 * Compute the dependency depth of a task (for topological grouping).
 */
function computeDepth(
  taskId: string,
  tasks: TaskNode[],
  cache: Map<string, number>,
): number {
  if (cache.has(taskId)) return cache.get(taskId)!;

  const task = tasks.find((t) => t.id === taskId);
  if (!task || !task.dependsOn || task.dependsOn.length === 0) {
    cache.set(taskId, 0);
    return 0;
  }

  let maxParentDepth = 0;
  for (const depId of task.dependsOn) {
    const parentDepth = computeDepth(depId, tasks, cache);
    maxParentDepth = Math.max(maxParentDepth, parentDepth);
  }

  const depth = maxParentDepth + 1;
  cache.set(taskId, depth);
  return depth;
}

/**
 * Get the maximum dependency depth in the task graph.
 */
function getMaxDepth(tasks: TaskNode[]): number {
  const cache = new Map<string, number>();
  let maxDepth = 0;
  for (const task of tasks) {
    maxDepth = Math.max(maxDepth, computeDepth(task.id, tasks, cache));
  }
  return maxDepth;
}

// ---------------------------------------------------------------------------
// Topology Executor
// ---------------------------------------------------------------------------

export interface TopologyExecutorOptions {
  /** Execute a single task. */
  executeTask: (task: CoordinationTask) => Promise<string>;
  /** Progress callback. */
  onTaskComplete?: (taskId: string, result: string) => void;
  onTaskStart?: (taskId: string) => void;
}

/**
 * Execute a task graph using the specified topology.
 */
export function executeWithTopology(
  tasks: CoordinationTask[],
  topology: OrchestrationTopology,
  options: TopologyExecutorOptions,
): Promise<Map<string, string>> {
  switch (topology) {
    case "parallel":
      return executeParallel(tasks, options);
    case "sequential":
      return executeSequential(tasks, options);
    case "hierarchical":
      return executeHierarchical(tasks, options);
    case "hybrid":
      return executeHybrid(tasks, options);
  }
}

/**
 * Execute all tasks in parallel.
 */
async function executeParallel(
  tasks: CoordinationTask[],
  options: TopologyExecutorOptions,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  await Promise.all(
    tasks.map(async (task) => {
      options.onTaskStart?.(task.id);
      try {
        const result = await options.executeTask(task);
        results.set(task.id, result);
        options.onTaskComplete?.(task.id, result);
      } catch (err) {
        results.set(task.id, `Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );

  return results;
}

/**
 * Execute tasks sequentially in dependency order.
 */
async function executeSequential(
  tasks: CoordinationTask[],
  options: TopologyExecutorOptions,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const sorted = topologicalSort(tasks);

  for (const task of sorted) {
    options.onTaskStart?.(task.id);
    try {
      const result = await options.executeTask(task);
      results.set(task.id, result);
      options.onTaskComplete?.(task.id, result);
    } catch (err) {
      results.set(task.id, `Error: ${err instanceof Error ? err.message : String(err)}`);
      break; // Stop on failure in sequential mode
    }
  }

  return results;
}

/**
 * Execute tasks with hierarchical delegation.
 */
async function executeHierarchical(
  tasks: CoordinationTask[],
  options: TopologyExecutorOptions,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  // Find root tasks (no dependencies)
  const roots = tasks.filter((t) => t.dependencies.length === 0);

  // Execute roots first, then their dependents
  for (const root of roots) {
    options.onTaskStart?.(root.id);
    try {
      const result = await options.executeTask(root);
      results.set(root.id, result);
      options.onTaskComplete?.(root.id, result);

      // Execute dependents of this root
      const dependents = tasks.filter(
        (t) => t.dependencies.includes(root.id) && !results.has(t.id),
      );
      await Promise.all(
        dependents.map(async (dep) => {
          options.onTaskStart?.(dep.id);
          try {
            const depResult = await options.executeTask(dep);
            results.set(dep.id, depResult);
            options.onTaskComplete?.(dep.id, depResult);
          } catch (err) {
            results.set(dep.id, `Error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }),
      );
    } catch (err) {
      results.set(root.id, `Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return results;
}

/**
 * Execute tasks with hybrid topology (parallel groups + sequential chains).
 */
async function executeHybrid(
  tasks: CoordinationTask[],
  options: TopologyExecutorOptions,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const sorted = topologicalSort(tasks);

  // Execute in topological order, running independent tasks in parallel
  const completed = new Set<string>();
  const remaining = new Set(sorted.map((t) => t.id));

  while (remaining.size > 0) {
    // Find tasks whose dependencies are all met
    const ready = sorted.filter(
      (t) => remaining.has(t.id) && t.dependencies.every((d) => completed.has(d)),
    );

    if (ready.length === 0) {
      // Circular dependency — break
      break;
    }

    // Execute ready tasks in parallel
    await Promise.all(
      ready.map(async (task) => {
        options.onTaskStart?.(task.id);
        try {
          const result = await options.executeTask(task);
          results.set(task.id, result);
          completed.add(task.id);
          remaining.delete(task.id);
          options.onTaskComplete?.(task.id, result);
        } catch (err) {
          results.set(task.id, `Error: ${err instanceof Error ? err.message : String(err)}`);
          completed.add(task.id);
          remaining.delete(task.id);
        }
      }),
    );
  }

  return results;
}

/**
 * Topological sort of tasks based on dependencies.
 */
export function topologicalSort(tasks: CoordinationTask[]): CoordinationTask[] {
  const sorted: CoordinationTask[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(task: CoordinationTask): void {
    if (visited.has(task.id)) return;
    if (visiting.has(task.id)) return; // Circular dependency

    visiting.add(task.id);
    for (const depId of task.dependencies) {
      const dep = tasks.find((t) => t.id === depId);
      if (dep) visit(dep);
    }
    visiting.delete(task.id);
    visited.add(task.id);
    sorted.push(task);
  }

  for (const task of tasks) {
    visit(task);
  }

  return sorted;
}
