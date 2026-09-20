/**
 * Tests for State Machine Guardrails.
 */

import { describe, expect, it } from "vitest";
import {
  StateMachineGuardrails,
  WORKFLOW_PHASES,
  createPhaseToolFilter,
  type WorkflowPhase,
} from "../state_machine_guardrails.js";

describe("StateMachineGuardrails", () => {
  describe("phase transitions", () => {
    it("starts in planning phase", () => {
      const sm = new StateMachineGuardrails();
      expect(sm.getCurrentPhase()).toBe("planning");
    });

    it("allows valid transitions from planning", () => {
      const sm = new StateMachineGuardrails("planning");

      const r1 = sm.transitionTo("research");
      expect(r1.success).toBe(true);
      expect(sm.getCurrentPhase()).toBe("research");
    });

    it("blocks invalid transitions", () => {
      const sm = new StateMachineGuardrails("planning");

      // planning can only go to research or implementation
      const r = sm.transitionTo("cleanup");
      expect(r.success).toBe(false);
    });

    it("allows implementation to transition to any phase", () => {
      const sm = new StateMachineGuardrails("implementation");

      expect(sm.transitionTo("planning").success).toBe(true);
      sm.transitionTo("implementation");
      expect(sm.transitionTo("research").success).toBe(true);
      sm.transitionTo("implementation");
      expect(sm.transitionTo("review").success).toBe(true);
      sm.transitionTo("implementation");
      expect(sm.transitionTo("cleanup").success).toBe(true);
    });

    it("records transition history", () => {
      const sm = new StateMachineGuardrails("planning");
      sm.transitionTo("research");
      sm.transitionTo("implementation");

      const state = sm.getState();
      expect(state.transitions).toHaveLength(2);
      expect(state.transitions[0].from).toBe("planning");
      expect(state.transitions[0].to).toBe("research");
      expect(state.transitions[1].from).toBe("research");
      expect(state.transitions[1].to).toBe("implementation");
    });
  });

  describe("tool access checks", () => {
    it("allows read tools in planning phase", () => {
      const sm = new StateMachineGuardrails("planning");
      const check = sm.checkTool("read_file");
      expect(check.allowed).toBe(true);
    });

    it("blocks write tools in planning phase", () => {
      const sm = new StateMachineGuardrails("planning");
      const check = sm.checkTool("write_file");
      expect(check.allowed).toBe(false);
    });

    it("allows write tools in implementation phase", () => {
      const sm = new StateMachineGuardrails("implementation");
      expect(sm.checkTool("write_file").allowed).toBe(true);
      expect(sm.checkTool("bash").allowed).toBe(true);
    });

    it("blocks write tools in review phase", () => {
      const sm = new StateMachineGuardrails("review");
      expect(sm.checkTool("write_file").allowed).toBe(false);
    });

    it("allows execute tools in review phase", () => {
      const sm = new StateMachineGuardrails("review");
      expect(sm.checkTool("bash").allowed).toBe(true);
    });

    it("allows unknown tools by default", () => {
      const sm = new StateMachineGuardrails("planning");
      const check = sm.checkTool("unknown_tool");
      expect(check.allowed).toBe(true);
    });

    it("records blocked attempts", () => {
      const sm = new StateMachineGuardrails("planning");
      sm.checkTool("write_file");
      sm.checkTool("bash");

      const blocked = sm.getBlockedAttempts();
      expect(blocked).toHaveLength(2);
      expect(blocked[0].toolName).toBe("write_file");
    });
  });

  describe("batch tool checks", () => {
    it("checks multiple tools at once", () => {
      const sm = new StateMachineGuardrails("research");
      const checks = sm.checkTools(["read_file", "write_file", "web_search", "bash"]);

      expect(checks).toHaveLength(4);
      expect(checks.find((c) => c.toolName === "read_file")!.allowed).toBe(true);
      expect(checks.find((c) => c.toolName === "web_search")!.allowed).toBe(true);
    });
  });

  describe("allowed groups and tools", () => {
    it("returns allowed groups for current phase", () => {
      const sm = new StateMachineGuardrails("implementation");
      const groups = sm.getAllowedGroups();
      expect(groups).toContain("read");
      expect(groups).toContain("write");
      expect(groups).toContain("execute");
    });

    it("filters tool names by current phase", () => {
      const sm = new StateMachineGuardrails("research");
      const allowed = sm.getAllowedToolNames([
        "read_file", "write_file", "web_search", "bash", "grep",
      ]);

      expect(allowed).toContain("read_file");
      expect(allowed).toContain("web_search");
      expect(allowed).toContain("grep");
      expect(allowed).not.toContain("write_file");
      expect(allowed).not.toContain("bash");
    });
  });

  describe("custom tool groups", () => {
    it("allows registering custom tool groups", () => {
      const sm = new StateMachineGuardrails("planning");
      sm.registerToolGroup("my_custom_tool", "read");

      const check = sm.checkTool("my_custom_tool");
      expect(check.allowed).toBe(true);
      expect(check.group).toBe("read");
    });
  });

  describe("state restore", () => {
    it("restores state from snapshot", () => {
      const sm1 = new StateMachineGuardrails("planning");
      sm1.transitionTo("research");
      sm1.checkTool("write_file"); // blocked

      const state = sm1.getState();

      const sm2 = new StateMachineGuardrails();
      sm2.restoreState(state);

      expect(sm2.getCurrentPhase()).toBe("research");
      expect(sm2.getBlockedAttempts()).toHaveLength(1);
    });
  });

  describe("createPhaseToolFilter", () => {
    it("returns a filter function", () => {
      const sm = new StateMachineGuardrails("research");
      const filter = createPhaseToolFilter(sm);

      const allowed = filter(["read_file", "write_file", "web_search"]);
      expect(allowed).toContain("read_file");
      expect(allowed).toContain("web_search");
      expect(allowed).not.toContain("write_file");
    });
  });
});

describe("WORKFLOW_PHASES", () => {
  it("defines all 5 phases", () => {
    const phases = Object.keys(WORKFLOW_PHASES);
    expect(phases).toEqual(["planning", "research", "implementation", "review", "cleanup"]);
  });

  it("each phase has allowed groups", () => {
    for (const [key, def] of Object.entries(WORKFLOW_PHASES)) {
      expect(def.allowedGroups.length).toBeGreaterThan(0);
    }
  });

  it("planning has most restrictive access", () => {
    const planning = WORKFLOW_PHASES.planning;
    expect(planning.allowedGroups).not.toContain("write");
    expect(planning.allowedGroups).not.toContain("execute");
    expect(planning.allowedGroups).not.toContain("subagent");
  });

  it("implementation has full access", () => {
    const impl = WORKFLOW_PHASES.implementation;
    expect(impl.allowAnyTransition).toBe(true);
    expect(impl.allowedGroups).toContain("write");
    expect(impl.allowedGroups).toContain("execute");
    expect(impl.allowedGroups).toContain("subagent");
  });
});
