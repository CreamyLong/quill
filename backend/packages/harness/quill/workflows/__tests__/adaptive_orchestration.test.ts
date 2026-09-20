/**
 * Tests for Adaptive Orchestration Topology.
 */

import { describe, expect, it } from "vitest";
import {
  analyzeTopology,
  executeWithTopology,
  topologicalSort,
  type TaskNode,
  type CoordinationTask,
} from "../adaptive_orchestration.js";

describe("analyzeTopology", () => {
  it("selects parallel for independent tasks", () => {
    const analysis = analyzeTopology({
      tasks: [
        { id: "a", description: "Task A", complexity: 3 },
        { id: "b", description: "Task B", complexity: 5 },
        { id: "c", description: "Task C", complexity: 2 },
      ],
    });

    expect(analysis.topology).toBe("parallel");
    expect(analysis.recommendedWorkers).toBeGreaterThanOrEqual(2);
  });

  it("selects sequential for linear chains", () => {
    const analysis = analyzeTopology({
      tasks: [
        { id: "a", description: "Step 1", dependsOn: [] },
        { id: "b", description: "Step 2", dependsOn: ["a"] },
        { id: "c", description: "Step 3", dependsOn: ["b"] },
      ],
    });

    expect(analysis.topology).toBe("sequential");
    expect(analysis.recommendedWorkers).toBe(1);
  });

  it("selects hybrid for mixed dependencies", () => {
    const analysis = analyzeTopology({
      tasks: [
        { id: "a", description: "Research A" },
        { id: "b", description: "Research B" },
        { id: "c", description: "Implementation", dependsOn: ["a", "b"] },
      ],
    });

    expect(["hybrid", "hierarchical"]).toContain(analysis.topology);
  });

  it("selects hierarchical for tree-shaped tasks", () => {
    const analysis = analyzeTopology({
      tasks: [
        { id: "root", description: "Research" },
        { id: "leaf1", description: "Code A", dependsOn: ["root"] },
        { id: "leaf2", description: "Code B", dependsOn: ["root"] },
        { id: "leaf3", description: "Code C", dependsOn: ["root"] },
      ],
    });

    expect(["hierarchical", "hybrid"]).toContain(analysis.topology);
  });

  it("calculates total complexity", () => {
    const analysis = analyzeTopology({
      tasks: [
        { id: "a", description: "A", complexity: 3 },
        { id: "b", description: "B", complexity: 7 },
      ],
    });

    expect(analysis.totalComplexity).toBe(10);
  });

  it("detects parallel groups", () => {
    const analysis = analyzeTopology({
      tasks: [
        { id: "a", description: "A" },
        { id: "b", description: "B" },
        { id: "c", description: "C", dependsOn: ["a", "b"] },
      ],
    });

    expect(analysis.parallelGroups.length).toBeGreaterThan(0);
  });
});

describe("executeWithTopology", () => {
  function makeTasks(ids: string[]): CoordinationTask[] {
    return ids.map((id) => ({
      id,
      description: `Task ${id}`,
      status: "pending",
      dependents: [],
      dependencies: [],
    }));
  }

  it("executes parallel tasks", async () => {
    const tasks = makeTasks(["a", "b", "c"]);
    const results = await executeWithTopology(tasks, "parallel", {
      executeTask: async (task) => `Result-${task.id}`,
    });

    expect(results.size).toBe(3);
    expect(results.get("a")).toBe("Result-a");
    expect(results.get("b")).toBe("Result-b");
    expect(results.get("c")).toBe("Result-c");
  });

  it("executes sequential tasks in order", async () => {
    const executionOrder: string[] = [];
    const tasks = makeTasks(["a", "b", "c"]);

    await executeWithTopology(tasks, "sequential", {
      executeTask: async (task) => {
        executionOrder.push(task.id);
        return `Result-${task.id}`;
      },
    });

    expect(executionOrder).toEqual(["a", "b", "c"]);
  });

  it("calls progress callbacks", async () => {
    const tasks = makeTasks(["a", "b"]);
    const started: string[] = [];
    const completed: string[] = [];

    await executeWithTopology(tasks, "parallel", {
      executeTask: async (task) => `Result-${task.id}`,
      onTaskStart: (id) => started.push(id),
      onTaskComplete: (id) => completed.push(id),
    });

    expect(started).toContain("a");
    expect(started).toContain("b");
    expect(completed).toContain("a");
    expect(completed).toContain("b");
  });

  it("handles task errors in sequential mode", async () => {
    const tasks = makeTasks(["a", "b", "c"]);
    const results = await executeWithTopology(tasks, "sequential", {
      executeTask: async (task) => {
        if (task.id === "b") throw new Error("Task B failed");
        return `Result-${task.id}`;
      },
    });

    expect(results.get("a")).toBe("Result-a");
    expect(results.get("b")).toContain("Error");
    // Sequential stops on failure
    expect(results.get("c")).toBeUndefined();
  });
});

describe("topologicalSort", () => {
  it("sorts tasks in dependency order", () => {
    const tasks: CoordinationTask[] = [
      { id: "c", description: "C", status: "pending", dependents: [], dependencies: ["a", "b"] },
      { id: "a", description: "A", status: "pending", dependents: [], dependencies: [] },
      { id: "b", description: "B", status: "pending", dependents: [], dependencies: ["a"] },
    ];

    const sorted = topologicalSort(tasks);
    const ids = sorted.map((t) => t.id);

    expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
    expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("c"));
  });

  it("handles tasks with no dependencies", () => {
    const tasks: CoordinationTask[] = [
      { id: "a", description: "A", status: "pending", dependents: [], dependencies: [] },
      { id: "b", description: "B", status: "pending", dependents: [], dependencies: [] },
    ];

    const sorted = topologicalSort(tasks);
    expect(sorted).toHaveLength(2);
  });
});
