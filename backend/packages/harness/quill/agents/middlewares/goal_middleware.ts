/**
 * Goal Middleware
 *
 * Evaluates active goals after each agent turn and decides whether to
 * auto-continue or stand down. When a goal is active and not yet satisfied,
 * this middleware injects a continuation prompt to keep the agent working
 * toward the objective.
 *
 * Source patterns:
 * - Kimi Code: Goal mode with persistent multi-turn objective tracking
 * - DeerFlow 2.0: /goal command with automatic completion evaluation
 *
 * Integration: Registered after Memory middleware, before Clarification.
 * The middleware checks for an active goal in ThreadState after each agent
 * turn. If the goal is active and should continue, it sets jump_to to
 * re-engage the model with a continuation prompt.
 */

import type { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { HumanMessage as HumanMessageClass } from "@langchain/core/messages";
import type { MiddlewareDefinition } from "../factory.js";
import type { ThreadState } from "../thread_state.js";
import { GoalManager } from "../goal/manager.js";
import type { GoalState } from "../goal/types.js";

/** Extended ThreadState that includes the goal field. */
interface GoalThreadState extends ThreadState {
  goal?: GoalState | null;
}

export interface GoalMiddlewareOptions {
  /** Whether goal tracking is enabled. */
  enabled?: boolean;
}

/**
 * Create the goal middleware.
 *
 * The middleware performs two roles:
 * 1. afterAgent: After each agent turn, evaluate the active goal and decide
 *    whether to continue or stand down.
 * 2. beforeModel: If a continuation was decided, inject a continuation prompt.
 */
export function goalMiddleware(options: GoalMiddlewareOptions = {}): MiddlewareDefinition {
  const { enabled = true } = options;
  const manager = new GoalManager();

  // Track whether we should continue (set in afterAgent, consumed in beforeModel)
  let pendingContinuation = false;
  let pendingGoalState: GoalState | null = null;

  return {
    name: "GoalMiddleware",

    beforeModel: (state: ThreadState) => {
      if (!enabled || !pendingContinuation || !pendingGoalState) {
        return;
      }

      // Consume the continuation signal
      pendingContinuation = false;
      const goal = pendingGoalState;
      pendingGoalState = null;

      // Inject a continuation prompt as a HumanMessage
      const continuationPrompt = buildContinuationPrompt(goal);
      const continuationMessage = new HumanMessageClass({
        content: continuationPrompt,
      });

      return {
        messages: [continuationMessage as unknown as BaseMessage],
        goal: goal,
      };
    },

    afterAgent: (state: GoalThreadState) => {
      if (!enabled) {
        return;
      }

      const goal = state.goal;
      if (!goal || goal.status !== "active") {
        pendingContinuation = false;
        pendingGoalState = null;
        return;
      }

      // Evaluate the goal using the conversation history
      const messages = state.messages ?? [];
      const evaluation = evaluateGoalSync(manager, goal, messages);

      // Decide next action
      const { goal: updatedGoal, shouldContinue, standDownReason } =
        manager.decideNext(goal, evaluation);

      // If standing down, update the evaluation with the reason
      if (!shouldContinue && standDownReason) {
        updatedGoal.last_evaluation = {
          ...updatedGoal.last_evaluation!,
          stand_down_reason: standDownReason,
        };
      }

      // Set continuation state for beforeModel
      pendingContinuation = shouldContinue;
      pendingGoalState = shouldContinue ? updatedGoal : null;

      return {
        goal: updatedGoal,
        jump_to: shouldContinue ? "model" : undefined,
      };
    },
  };
}

/**
 * Build a continuation prompt for the agent.
 */
function buildContinuationPrompt(goal: GoalState): string {
  const count = goal.continuation_count + 1;
  const max = goal.max_continuations;

  if (goal.last_evaluation?.blocker === "needs_user_input") {
    return `[Goal Continuation ${count}/${max}] Your goal is: "${goal.objective}"

The goal requires user input to proceed. Ask the user a specific question to unblock progress.`;
  }

  if (goal.last_evaluation?.blocker === "missing_evidence") {
    return `[Goal Continuation ${count}/${max}] Your goal is: "${goal.objective}"

Missing evidence was identified. Search for the missing information or try an alternative approach.`;
  }

  return `[Goal Continuation ${count}/${max}] Your goal is: "${goal.objective}"

Previous evaluation: ${goal.last_evaluation?.reason ?? "Goal not yet satisfied"}

Continue working toward the goal. Make progress on the remaining work.`;
}

/**
 * Synchronous goal evaluation.
 *
 * In a full implementation, this would make an LLM call to evaluate the goal.
 * For now, we use a heuristic: if the last AI message contains indicators of
 * completion (e.g., "done", "complete", "finished"), mark as satisfied.
 * Otherwise, mark as not satisfied with a continuation.
 *
 * TODO: Replace with actual LLM evaluation call when model infrastructure
 * is available in the middleware context.
 */
function evaluateGoalSync(
  manager: GoalManager,
  goal: GoalState,
  messages: BaseMessage[],
): GoalState["last_evaluation"] extends infer T ? T : never {
  // Get the last AI message
  const lastAiMessage = [...messages].reverse().find((m) => m._getType() === "ai");

  if (!lastAiMessage) {
    return {
      satisfied: false,
      blocker: "goal_not_met_yet",
      reason: "No AI response to evaluate",
      evaluated_at: new Date().toISOString(),
    };
  }

  const content =
    typeof lastAiMessage.content === "string"
      ? lastAiMessage.content.toLowerCase()
      : JSON.stringify(lastAiMessage.content).toLowerCase();

  // Heuristic: check for completion indicators
  const completionIndicators = [
    "goal achieved",
    "task complete",
    "successfully completed",
    "all done",
    "finished",
    "accomplished",
  ];

  const hasCompletionIndicator = completionIndicators.some((indicator) =>
    content.includes(indicator),
  );

  // Check for error indicators
  const errorIndicators = ["error", "failed", "cannot", "unable to", "not possible"];
  const hasErrorIndicator = errorIndicators.some((indicator) =>
    content.includes(indicator),
  );

  if (hasCompletionIndicator && !hasErrorIndicator) {
    return {
      satisfied: true,
      blocker: "none",
      reason: "Completion indicators detected in AI response",
      evidence_summary: lastAiMessage.content.slice(0, 200) as string,
      evaluated_at: new Date().toISOString(),
      progress_key: "completion_detected",
    };
  }

  if (hasErrorIndicator) {
    return {
      satisfied: false,
      blocker: "run_failed",
      reason: "Error indicators detected in AI response",
      evidence_summary: lastAiMessage.content.slice(0, 200) as string,
      evaluated_at: new Date().toISOString(),
      progress_key: "error_encountered",
    };
  }

  return {
    satisfied: false,
    blocker: "goal_not_met_yet",
    reason: "Goal not yet satisfied, continuing work",
    evaluated_at: new Date().toISOString(),
    progress_key: `continuation_${goal.continuation_count + 1}`,
  };
}
