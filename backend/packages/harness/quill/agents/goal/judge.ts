/**
 * Goal Judge — four-verdict continuation state machine.
 *
 * Ported from Hermes Agent's `/goal` standing objectives with judge-model
 * continuation (`hermes_cli/goals.py`, `judge_goal`): after each agent turn,
 * a judge model evaluates progress and returns one of four verdicts that
 * drive the continuation loop:
 *
 * - `done`     — goal satisfied (requires explicit evidence of the
 *                deliverable); the loop terminates.
 * - `blocked`  — unachievable as stated or needs user input; the goal is
 *                paused and the user informed.
 * - `wait`     — waiting on async work (background processes, delegated
 *                subagents); the loop parks until the condition is met.
 * - `continue` — a concrete next step exists; the loop runs another turn if
 *                the turn budget is not exhausted.
 *
 * Two Hermes semantics ported faithfully:
 * - **Fail-open**: on judge error (network, malformed response, unavailable
 *   judge client) the verdict defaults to `continue` — a broken judge never
 *   halts progress; the turn budget is the backstop.
 * - **Quality gates run before the judge**: if a gate fails, the judge is
 *   not called and the gate's directive drives the next turn.
 *
 * The engine composes with the existing `GoalManager` (satisfied/blocker
 * evaluation model): {@link verdictFromEvaluation} maps an evaluation to the
 * four-verdict world, and {@link GoalJudgeEngine.applyVerdict} performs the
 * state transition.
 *
 * @module agents/goal/judge
 */

import type { BaseMessage } from "@langchain/core/messages";

import type { GoalEvaluation, GoalState } from "./types.js";

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

/** Hermes judge verdicts. */
export type GoalJudgeVerdict = "done" | "blocked" | "wait" | "continue";

/** A judge outcome: verdict + human-readable reason. */
export interface JudgeOutcome {
  verdict: GoalJudgeVerdict;
  reason: string;
  /** Continuation directive for the next turn (gates or judge may supply one). */
  directive?: string;
  /** Whether the verdict was produced by fail-open rather than a real judge. */
  failOpen?: boolean;
}

/** What the agent loop should do after applying a verdict. */
export type JudgeAction = "stop" | "continue" | "park";

export interface JudgeDecision {
  goal: GoalState;
  action: JudgeAction;
  standDownReason?: string;
}

// ---------------------------------------------------------------------------
// Quality gates
// ---------------------------------------------------------------------------

/** Result of a failed quality gate (a passing gate returns null). */
export interface QualityGateResult {
  /** Gate name (for logging/telemetry). */
  gate: string;
  /** Why the gate failed. */
  reason: string;
  /** Directive that drives the next turn (replaces the judge this round). */
  directive: string;
}

/**
 * A quality gate checked before the judge is called. Gates are cheap,
 * deterministic checks; a failed gate skips the judge entirely and its
 * directive becomes the continuation instruction (Hermes semantics).
 */
export interface GoalQualityGate {
  name: string;
  /** Return a failure result, or null when the gate passes. */
  check(goal: GoalState, messages: BaseMessage[]): QualityGateResult | null;
}

/** Built-in gate: the last assistant turn must not be empty. */
export function createNonEmptyTurnGate(): GoalQualityGate {
  return {
    name: "non_empty_turn",
    check: (_goal, messages) => {
      const last = [...messages].reverse().find((m) => m._getType() === "ai");
      const text =
        last !== undefined && typeof last.content === "string" ? last.content.trim() : "";
      if (text === "") {
        return {
          gate: "non_empty_turn",
          reason: "last assistant turn produced no content",
          directive: "The previous turn produced no output. Repeat the work and produce a visible result.",
        };
      }
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// Verdict mapping
// ---------------------------------------------------------------------------

/** Map a `GoalManager` evaluation (satisfied/blocker model) to the four-verdict world. */
export function verdictFromEvaluation(evaluation: GoalEvaluation): GoalJudgeVerdict {
  if (evaluation.satisfied) {
    return "done";
  }
  switch (evaluation.blocker) {
    case "needs_user_input":
      return "blocked";
    case "external_wait":
      return "wait";
    default:
      return "continue";
  }
}

// ---------------------------------------------------------------------------
// Judge engine
// ---------------------------------------------------------------------------

/** Dependencies for one judge round. */
export interface JudgeRoundDeps {
  /** Quality gates checked before the judge (in order). */
  gates?: GoalQualityGate[];
  /** Performs the LLM call (the prompt comes from `GoalManager.buildEvaluationPrompt`). */
  callJudge: (prompt: string) => Promise<string>;
  /** Parses the judge response (delegates to `GoalManager.parseEvaluation`). */
  parseResponse: (response: string) => GoalEvaluation;
}

export interface GoalJudgeEngineConfig {
  /** Turn budget: max continuations before standing down (fail-open backstop). */
  maxTurns?: number;
}

/**
 * The four-verdict decision engine. Stateless per goal — callers own the
 * `GoalState`; this class maps verdicts to state transitions and actions.
 */
export class GoalJudgeEngine {
  private readonly maxTurns: number;

  constructor(config: GoalJudgeEngineConfig = {}) {
    this.maxTurns = config.maxTurns ?? 8;
  }

  /**
   * Run one judge round: quality gates first (a failure skips the judge),
   * then the judge with fail-open semantics.
   *
   * @param goal    Current goal state.
   * @param messages Recent thread messages (for quality gates).
   * @param buildPrompt Builds the judge prompt (from `GoalManager.buildEvaluationPrompt`).
   * @param deps    Judge dependencies (gates, LLM call, parser).
   */
  async judge(
    goal: GoalState,
    messages: BaseMessage[],
    buildPrompt: () => string,
    deps: JudgeRoundDeps,
  ): Promise<JudgeOutcome> {
    // Quality gates: gate output drives the next turn without a judge call.
    for (const gate of deps.gates ?? []) {
      const failure = gate.check(goal, messages);
      if (failure !== null) {
        return {
          verdict: "continue",
          reason: `quality gate '${failure.gate}' failed: ${failure.reason}`,
          directive: failure.directive,
        };
      }
    }

    try {
      const response = await deps.callJudge(buildPrompt());
      const evaluation = deps.parseResponse(response);
      return {
        verdict: verdictFromEvaluation(evaluation),
        reason: evaluation.reason,
      };
    } catch (error) {
      // Fail-open: a broken judge never halts progress. The turn budget is
      // the backstop.
      return {
        verdict: "continue",
        reason: `judge unavailable, failing open: ${error instanceof Error ? error.message : String(error)}`,
        failOpen: true,
      };
    }
  }

  /**
   * Apply a verdict to the goal state and decide the loop action.
   *
   * - `done` → satisfied, stop.
   * - `blocked` → paused (user informed), stop.
   * - `wait` → parked in `waiting`; the loop stops until woken
   *   (see {@link wakeWaiting}).
   * - `continue` → one more turn if the budget allows, else stand down.
   */
  applyVerdict(goal: GoalState, outcome: JudgeOutcome): JudgeDecision {
    const now = new Date().toISOString();
    const maxTurns = goal.max_continuations || this.maxTurns;

    switch (outcome.verdict) {
      case "done":
        return {
          goal: { ...goal, status: "satisfied", updated_at: now },
          action: "stop",
        };
      case "blocked":
        return {
          goal: { ...goal, status: "paused", updated_at: now },
          action: "stop",
          standDownReason: outcome.reason,
        };
      case "wait":
        return {
          goal: { ...goal, status: "waiting", updated_at: now },
          action: "park",
          standDownReason: outcome.reason,
        };
      case "continue": {
        if (goal.continuation_count >= maxTurns) {
          return {
            goal: { ...goal, status: "paused", updated_at: now },
            action: "stop",
            standDownReason: `turn budget exhausted (${maxTurns} continuations)`,
          };
        }
        return {
          goal: {
            ...goal,
            status: "active",
            updated_at: now,
            continuation_count: goal.continuation_count + 1,
          },
          action: "continue",
        };
      }
    }
  }
}

/**
 * Wake a goal parked in `waiting` (the async condition it was parked on has
 * been met — background process finished, subagent reported, etc.). Returns
 * the reactivated goal, or null when the goal is not parked.
 */
export function wakeWaiting(goal: GoalState): GoalState | null {
  if (goal.status !== "waiting") {
    return null;
  }
  return { ...goal, status: "active", updated_at: new Date().toISOString() };
}
