/**
 * Tests for the goal judge verdict state machine (Hermes Agent sync).
 *
 * Covers the four verdicts (done/blocked/wait/continue), fail-open on judge
 * errors, quality gates running before the judge, the turn-budget backstop,
 * wait-parking with wake, and mapping from the satisfied/blocker evaluation
 * model.
 */

import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

import {
  GoalJudgeEngine,
  createNonEmptyTurnGate,
  verdictFromEvaluation,
  wakeWaiting,
  type GoalState,
} from "../judge.js";
import type { GoalEvaluation } from "../types.js";

function activeGoal(overrides: Partial<GoalState> = {}): GoalState {
  return {
    objective: "ship the report",
    status: "active",
    created_at: "2026-09-28T00:00:00Z",
    updated_at: "2026-09-28T00:00:00Z",
    continuation_count: 0,
    max_continuations: 3,
    no_progress_count: 0,
    max_no_progress_continuations: 3,
    ...overrides,
  };
}

function evaluation(overrides: Partial<GoalEvaluation> = {}): GoalEvaluation {
  return { satisfied: false, blocker: "goal_not_met_yet", reason: "still working", ...overrides };
}

describe("verdictFromEvaluation", () => {
  it("maps satisfied → done", () => {
    expect(verdictFromEvaluation(evaluation({ satisfied: true, blocker: "none" }))).toBe("done");
  });

  it("maps needs_user_input → blocked and external_wait → wait", () => {
    expect(verdictFromEvaluation(evaluation({ blocker: "needs_user_input" }))).toBe("blocked");
    expect(verdictFromEvaluation(evaluation({ blocker: "external_wait" }))).toBe("wait");
  });

  it("maps everything else → continue", () => {
    expect(verdictFromEvaluation(evaluation({ blocker: "goal_not_met_yet" }))).toBe("continue");
    expect(verdictFromEvaluation(evaluation({ blocker: "missing_evidence" }))).toBe("continue");
    expect(verdictFromEvaluation(evaluation({ blocker: "run_failed" }))).toBe("continue");
  });
});

describe("GoalJudgeEngine.applyVerdict", () => {
  const engine = new GoalJudgeEngine({ maxTurns: 3 });

  it("done → satisfied, stop", () => {
    const decision = engine.applyVerdict(activeGoal(), { verdict: "done", reason: "report shipped" });
    expect(decision.goal.status).toBe("satisfied");
    expect(decision.action).toBe("stop");
  });

  it("blocked → paused, stop with reason", () => {
    const decision = engine.applyVerdict(activeGoal(), { verdict: "blocked", reason: "needs user choice" });
    expect(decision.goal.status).toBe("paused");
    expect(decision.action).toBe("stop");
    expect(decision.standDownReason).toBe("needs user choice");
  });

  it("wait → waiting, park", () => {
    const decision = engine.applyVerdict(activeGoal(), { verdict: "wait", reason: "subagent still running" });
    expect(decision.goal.status).toBe("waiting");
    expect(decision.action).toBe("park");
  });

  it("continue → increments and continues while budget remains", () => {
    const decision = engine.applyVerdict(activeGoal({ continuation_count: 1 }), {
      verdict: "continue",
      reason: "next step exists",
    });
    expect(decision.goal.status).toBe("active");
    expect(decision.goal.continuation_count).toBe(2);
    expect(decision.action).toBe("continue");
  });

  it("continue at the budget → paused, stop (turn budget backstop)", () => {
    const decision = engine.applyVerdict(activeGoal({ continuation_count: 3 }), {
      verdict: "continue",
      reason: "next step exists",
    });
    expect(decision.goal.status).toBe("paused");
    expect(decision.action).toBe("stop");
    expect(decision.standDownReason).toContain("turn budget exhausted");
  });
});

describe("GoalJudgeEngine.judge", () => {
  it("returns the judge verdict parsed from the response", async () => {
    const engine = new GoalJudgeEngine();
    const outcome = await engine.judge(activeGoal(), [new HumanMessage("go")], () => "prompt", {
      callJudge: async () => '{"satisfied": true, "blocker": "none", "reason": "done it"}',
      parseResponse: (r) => JSON.parse(r),
    });
    expect(outcome.verdict).toBe("done");
    expect(outcome.reason).toBe("done it");
    expect(outcome.failOpen).toBeUndefined();
  });

  it("fails open to continue when the judge throws", async () => {
    const engine = new GoalJudgeEngine();
    const outcome = await engine.judge(activeGoal(), [], () => "prompt", {
      callJudge: async () => {
        throw new Error("network down");
      },
      parseResponse: (r) => JSON.parse(r),
    });
    expect(outcome.verdict).toBe("continue");
    expect(outcome.failOpen).toBe(true);
    expect(outcome.reason).toContain("failing open");
  });

  it("fails open to continue when parsing produces garbage", async () => {
    const engine = new GoalJudgeEngine();
    const outcome = await engine.judge(activeGoal(), [], () => "prompt", {
      callJudge: async () => "not json at all",
      parseResponse: () => {
        throw new Error("bad json");
      },
    });
    expect(outcome.verdict).toBe("continue");
    expect(outcome.failOpen).toBe(true);
  });

  it("skips the judge when a quality gate fails, and the gate directive drives the turn", async () => {
    const engine = new GoalJudgeEngine();
    let judgeCalled = false;
    const outcome = await engine.judge(
      activeGoal(),
      [new AIMessage("")],
      () => "prompt",
      {
        gates: [createNonEmptyTurnGate()],
        callJudge: async () => {
          judgeCalled = true;
          return '{"satisfied": true}';
        },
        parseResponse: (r) => JSON.parse(r),
      },
    );
    expect(judgeCalled).toBe(false);
    expect(outcome.verdict).toBe("continue");
    expect(outcome.reason).toContain("non_empty_turn");
    expect(outcome.directive).toContain("produce a visible result");
  });

  it("calls the judge when all gates pass", async () => {
    const engine = new GoalJudgeEngine();
    let judgeCalled = false;
    const outcome = await engine.judge(
      activeGoal(),
      [new AIMessage("here is the work")],
      () => "prompt",
      {
        gates: [createNonEmptyTurnGate()],
        callJudge: async () => {
          judgeCalled = true;
          return '{"satisfied": false, "blocker": "goal_not_met_yet", "reason": "more to do"}';
        },
        parseResponse: (r) => JSON.parse(r),
      },
    );
    expect(judgeCalled).toBe(true);
    expect(outcome.verdict).toBe("continue");
  });
});

describe("wakeWaiting", () => {
  it("reactivates a parked goal", () => {
    const woken = wakeWaiting(activeGoal({ status: "waiting" }));
    expect(woken?.status).toBe("active");
  });

  it("returns null for goals that are not parked", () => {
    expect(wakeWaiting(activeGoal({ status: "active" }))).toBeNull();
    expect(wakeWaiting(activeGoal({ status: "satisfied" }))).toBeNull();
  });
});
