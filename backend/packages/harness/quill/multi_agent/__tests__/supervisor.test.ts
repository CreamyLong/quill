/**
 * Tests for supervisor coordination.
 */

import { describe, expect, it } from "vitest";

import type { CoordAgent, SharedState, AgentRunner } from "../types.js";

describe("supervisor coordination", () => {
  // The supervisor module exports types and a runner function.
  // We test the type contracts and the pure helpers.

  describe("type contracts", () => {
    it("accepts a valid CoordAgent", () => {
      const agent: CoordAgent = {
        name: "researcher",
        role: "Research Analyst",
        goal: "Find and synthesize information",
        maxTurns: 5,
      };
      expect(agent.name).toBe("researcher");
      expect(agent.canDelegate).toBeUndefined();
    });

    it("accepts a SharedState with all fields", () => {
      const state: SharedState = {
        task: "Research AI frameworks",
        context: ["Previous finding"],
        artifacts: { researcher: ["doc1.md"] },
        status: "active",
        rounds: 2,
        maxRounds: 10,
      };
      expect(state.status).toBe("active");
      expect(state.rounds).toBe(2);
    });
  });

  describe("AgentRunner contract", () => {
    it("can be implemented as a mock", async () => {
      const mockRunner: AgentRunner = async (agent, message, _context) => ({
        from: agent.name,
        to: ["supervisor"],
        content: `Response from ${agent.name} to: ${message}`,
        kind: "response",
        timestamp: new Date().toISOString(),
      });

      const agent: CoordAgent = {
        name: "test-agent",
        role: "Tester",
        goal: "Test",
      };

      const result = await mockRunner(agent, "Hello", {
        sharedState: {
          task: "test",
          context: [],
          artifacts: {},
          status: "active",
          rounds: 0,
          maxRounds: 5,
        },
        history: [],
      });

      expect(result.from).toBe("test-agent");
      expect(result.kind).toBe("response");
    });
  });
});
