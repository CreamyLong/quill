/**
 * Tests for workflow execution engine.
 */

import { describe, expect, it } from "vitest";

import { executeWorkflow } from "../engine.js";
import type {
  WorkflowDefinition,
  WorkflowAgentRunner,
  WorkflowAgentConfig,
} from "../types.js";

function makeAgentConfig(name: string): WorkflowAgentConfig {
  return {
    name,
    role: `${name} role`,
    goal: `${name} goal`,
  };
}

async function mockAgentRunner(
  config: WorkflowAgentConfig,
  input: Record<string, string>,
): Promise<string> {
  return `Output from ${config.name}: ${JSON.stringify(input)}`;
}

describe("workflow engine", () => {
  describe("linear workflow", () => {
    it("executes nodes in topological order", async () => {
      const def: WorkflowDefinition = {
        name: "linear-test",
        nodes: [
          { id: "start", kind: "agent", agentConfig: makeAgentConfig("start"), outputKey: "startOut" },
          { id: "middle", kind: "agent", agentConfig: makeAgentConfig("middle"), outputKey: "middleOut" },
          { id: "end", kind: "agent", agentConfig: makeAgentConfig("end"), outputKey: "endOut" },
        ],
        edges: [
          { from: "start", to: "middle" },
          { from: "middle", to: "end" },
        ],
        startNode: "start",
        endNodes: ["end"],
      };

      const result = await executeWorkflow(def, { input: "test" }, { agentRunner: mockAgentRunner });

      expect(result.success).toBe(true);
      expect(result.state.meta.completedNodes).toContain("start");
      expect(result.state.meta.completedNodes).toContain("middle");
      expect(result.state.meta.completedNodes).toContain("end");
      expect(result.state.results.startOut).toContain("start");
      expect(result.state.results.middleOut).toContain("middle");
      expect(result.state.results.endOut).toContain("end");
    });
  });

  describe("parallel execution", () => {
    it("runs independent nodes in parallel", async () => {
      const def: WorkflowDefinition = {
        name: "parallel-test",
        nodes: [
          { id: "start", kind: "agent", agentConfig: makeAgentConfig("start"), outputKey: "startOut" },
          { id: "branch-a", kind: "agent", agentConfig: makeAgentConfig("branchA"), outputKey: "aOut" },
          { id: "branch-b", kind: "agent", agentConfig: makeAgentConfig("branchB"), outputKey: "bOut" },
          { id: "end", kind: "agent", agentConfig: makeAgentConfig("end"), outputKey: "endOut" },
        ],
        edges: [
          { from: "start", to: "branch-a" },
          { from: "start", to: "branch-b" },
          { from: "branch-a", to: "end" },
          { from: "branch-b", to: "end" },
        ],
        startNode: "start",
        endNodes: ["end"],
      };

      const result = await executeWorkflow(def, {}, { agentRunner: mockAgentRunner });

      expect(result.success).toBe(true);
      expect(result.state.meta.completedNodes).toContain("branch-a");
      expect(result.state.meta.completedNodes).toContain("branch-b");
    });
  });

  describe("function nodes", () => {
    it("executes function nodes alongside agent nodes", async () => {
      const def: WorkflowDefinition = {
        name: "function-test",
        nodes: [
          { id: "agent", kind: "agent", agentConfig: makeAgentConfig("agent"), outputKey: "agentOut" },
          {
            id: "transform",
            kind: "function",
            fn: (state) => ({
              ...state,
              results: { ...state.results, transformed: true },
              meta: state.meta,
            }),
            outputKey: "transformed",
          },
        ],
        edges: [{ from: "agent", to: "transform" }],
        startNode: "agent",
        endNodes: ["transform"],
      };

      const result = await executeWorkflow(def, {}, { agentRunner: mockAgentRunner });
      expect(result.success).toBe(true);
      expect(result.state.meta.completedNodes).toContain("transform");
    });
  });

  describe("retry", () => {
    it("retries failed nodes", async () => {
      let attempts = 0;
      const flakyRunner: WorkflowAgentRunner = async (_config, _input, _state) => {
        attempts++;
        if (attempts < 2) {
          throw new Error("Transient error");
        }
        return "Success after retry";
      };

      const def: WorkflowDefinition = {
        name: "retry-test",
        nodes: [
          { id: "flaky", kind: "agent", agentConfig: makeAgentConfig("flaky"), outputKey: "out" },
        ],
        edges: [],
        startNode: "flaky",
        endNodes: ["flaky"],
        maxRetries: 2,
      };

      const result = await executeWorkflow(def, {}, { agentRunner: flakyRunner });
      expect(result.success).toBe(true);
      expect(attempts).toBe(2);
    });

    it("fails after exhausting retries", async () => {
      const alwaysFail: WorkflowAgentRunner = async () => {
        throw new Error("Permanent failure");
      };

      const def: WorkflowDefinition = {
        name: "fail-test",
        nodes: [
          { id: "failing", kind: "agent", agentConfig: makeAgentConfig("failing"), outputKey: "out" },
        ],
        edges: [],
        startNode: "failing",
        endNodes: ["failing"],
        maxRetries: 1,
      };

      const result = await executeWorkflow(def, {}, { agentRunner: alwaysFail });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Permanent failure");
      expect(result.state.meta.failedNodes.length).toBeGreaterThan(0);
    });
  });

  describe("progress callbacks", () => {
    it("calls onNodeStart and onNodeComplete for each node", async () => {
      const started: string[] = [];
      const completed: string[] = [];

      const def: WorkflowDefinition = {
        name: "callback-test",
        nodes: [
          { id: "a", kind: "agent", agentConfig: makeAgentConfig("a"), outputKey: "aOut" },
          { id: "b", kind: "agent", agentConfig: makeAgentConfig("b"), outputKey: "bOut" },
        ],
        edges: [{ from: "a", to: "b" }],
        startNode: "a",
        endNodes: ["b"],
      };

      await executeWorkflow(def, {}, {
        agentRunner: mockAgentRunner,
        onNodeStart: (id) => started.push(id),
        onNodeComplete: (id) => completed.push(id),
      });

      expect(started).toContain("a");
      expect(started).toContain("b");
      expect(completed).toContain("a");
      expect(completed).toContain("b");
    });
  });

  describe("input mapping", () => {
    it("passes mapped inputs to agent nodes", async () => {
      const capturedInputs: Array<{ config: WorkflowAgentConfig; input: Record<string, string> }> = [];
      const capturingRunner: WorkflowAgentRunner = async (config, input, _state) => {
        capturedInputs.push({ config, input: { ...input } });
        return `Output from ${config.name}`;
      };

      const def: WorkflowDefinition = {
        name: "mapping-test",
        nodes: [
          {
            id: "start",
            kind: "agent",
            agentConfig: makeAgentConfig("start"),
            outputKey: "startOut",
          },
          {
            id: "process",
            kind: "agent",
            agentConfig: makeAgentConfig("process"),
            outputKey: "processOut",
            inputMapping: { prompt: "startOut" },
          },
        ],
        edges: [{ from: "start", to: "process" }],
        startNode: "start",
        endNodes: ["process"],
      };

      const result = await executeWorkflow(def, {}, { agentRunner: capturingRunner });
      expect(result.success).toBe(true);

      // The process node should receive the start node's output via inputMapping.
      const processCall = capturedInputs.find((c) => c.config.name === "process");
      expect(processCall).toBeDefined();
      expect(processCall?.input.prompt).toContain("start");
    });
  });
});
