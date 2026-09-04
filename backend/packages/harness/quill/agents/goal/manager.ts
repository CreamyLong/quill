/**
 * Goal Manager
 *
 * Manages goal lifecycle: creation, evaluation, continuation, and stand-down.
 * After each agent turn, the goal middleware calls evaluate() to check if the
 * active goal is satisfied. If not, the manager decides whether to auto-continue
 * or stand down.
 *
 * Source patterns:
 * - Kimi Code: Goal mode with pause/resume/cancel/queue and exit codes
 * - DeerFlow 2.0: Session goals with automatic completion evaluation and
 *   hidden continuations (safety-capped at 8)
 */

import type { BaseMessage } from "@langchain/core/messages";
import {
  GOAL_DEFAULTS,
  type GoalEvaluation,
  type GoalOptions,
  type GoalState,
  type GoalStatus,
} from "./types.js";

/** LLM prompt template for goal evaluation. */
const GOAL_EVALUATION_PROMPT = `You are a goal evaluation assistant. Given a goal objective and the conversation history, evaluate whether the goal has been satisfied.

Goal: {objective}

Recent conversation:
{context}

Evaluate the goal status. Respond in JSON format:
{
  "satisfied": true/false,
  "blocker": "none" | "missing_evidence" | "needs_user_input" | "run_failed" | "external_wait" | "goal_not_met_yet",
  "reason": "brief explanation",
  "evidence_summary": "summary of evidence (optional)",
  "progress_key": "a short key indicating what progress was made (optional)"
}

Rules:
- "satisfied" should be true only if the goal is clearly and completely achieved
- "blocker": "none" if satisfied, otherwise the primary blocker
- "progress_key": use a stable key for the same type of progress (to detect no-progress loops)
- Be conservative: if uncertain, mark as not satisfied with "goal_not_met_yet"`;

export interface GoalManagerConfig {
  /** Maximum automatic continuations (default 8). */
  maxContinuations?: number;
  /** Maximum no-progress continuations before standing down (default 3). */
  maxNoProgressContinuations?: number;
}

export interface EvaluateContext {
  /** Recent messages for context. */
  messages: BaseMessage[];
  /** Current run ID. */
  runId?: string;
}

/**
 * Manages goal state transitions and evaluation decisions.
 *
 * This is a stateful manager that tracks the goal across agent turns.
 * It does NOT perform LLM calls directly — it produces the evaluation
 * prompt and interprets the result. The actual LLM call is made by the
 * middleware to leverage the existing model infrastructure.
 */
export class GoalManager {
  private config: Required<GoalManagerConfig>;

  constructor(config: GoalManagerConfig = {}) {
    this.config = {
      maxContinuations: config.maxContinuations ?? GOAL_DEFAULTS.maxContinuations,
      maxNoProgressContinuations:
        config.maxNoProgressContinuations ?? GOAL_DEFAULTS.maxNoProgressContinuations,
    };
  }

  /**
   * Create a new active goal.
   */
  createGoal(options: GoalOptions): GoalState {
    const now = new Date().toISOString();
    return {
      objective: options.objective,
      status: "active",
      created_at: now,
      updated_at: now,
      continuation_count: 0,
      max_continuations: options.max_continuations ?? this.config.maxContinuations,
      no_progress_count: 0,
      max_no_progress_continuations:
        options.max_no_progress_continuations ?? this.config.maxNoProgressContinuations,
    };
  }

  /**
   * Build the evaluation prompt for the LLM.
   */
  buildEvaluationPrompt(goal: GoalState, messages: BaseMessage[]): string {
    // Extract recent text content from messages (last 20 messages for context)
    const recentMessages = messages.slice(-20);
    const context = recentMessages
      .map((m) => {
        const role = m._getType();
        const content =
          typeof m.content === "string"
            ? m.content
            : JSON.stringify(m.content).slice(0, 500);
        return `[${role}]: ${content}`;
      })
      .join("\n");

    return GOAL_EVALUATION_PROMPT.replace("{objective}", goal.objective).replace(
      "{context}",
      context,
    );
  }

  /**
   * Parse the LLM evaluation response into a GoalEvaluation.
   */
  parseEvaluation(response: string, runId?: string): GoalEvaluation {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in evaluation response");
      }
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        satisfied: Boolean(parsed.satisfied),
        blocker: parsed.blocker ?? "goal_not_met_yet",
        reason: parsed.reason ?? "Evaluation completed",
        evidence_summary: parsed.evidence_summary,
        run_id: runId,
        evaluated_at: new Date().toISOString(),
        progress_key: parsed.progress_key,
      };
    } catch {
      // Fallback: treat as not satisfied if parsing fails
      return {
        satisfied: false,
        blocker: "goal_not_met_yet",
        reason: "Failed to parse evaluation response",
        run_id: runId,
        evaluated_at: new Date().toISOString(),
      };
    }
  }

  /**
   * Decide the next action after an evaluation.
   *
   * Returns the updated goal state and whether the agent should auto-continue.
   */
  decideNext(
    goal: GoalState,
    evaluation: GoalEvaluation,
  ): { goal: GoalState; shouldContinue: boolean; standDownReason?: string } {
    const now = new Date().toISOString();

    // Goal is satisfied
    if (evaluation.satisfied) {
      return {
        goal: {
          ...goal,
          status: "satisfied",
          updated_at: now,
          last_evaluation: evaluation,
        },
        shouldContinue: false,
      };
    }

    // Check for no-progress
    const lastProgressKey = goal.last_evaluation?.progress_key;
    const currentProgressKey = evaluation.progress_key;
    const noProgress =
      lastProgressKey !== undefined &&
      currentProgressKey !== undefined &&
      lastProgressKey === currentProgressKey;

    const newNoProgressCount = noProgress ? goal.no_progress_count + 1 : 0;

    // Stand down if too many no-progress continuations
    if (newNoProgressCount >= goal.max_no_progress_continuations) {
      return {
        goal: {
          ...goal,
          status: "paused",
          updated_at: now,
          no_progress_count: newNoProgressCount,
          last_evaluation: evaluation,
        },
        shouldContinue: false,
        standDownReason: `No progress detected for ${newNoProgressCount} consecutive evaluations (key: ${currentProgressKey})`,
      };
    }

    // Check continuation limit
    if (goal.continuation_count >= goal.max_continuations) {
      return {
        goal: {
          ...goal,
          status: "paused",
          updated_at: now,
          no_progress_count: newNoProgressCount,
          last_evaluation: evaluation,
        },
        shouldContinue: false,
        standDownReason: `Maximum continuations (${goal.max_continuations}) reached`,
      };
    }

    // Auto-continue
    return {
      goal: {
        ...goal,
        status: "active",
        updated_at: now,
        continuation_count: goal.continuation_count + 1,
        no_progress_count: newNoProgressCount,
        last_evaluation: evaluation,
      },
      shouldContinue: true,
    };
  }

  /**
   * Abandon a goal (user-initiated).
   */
  abandonGoal(goal: GoalState): GoalState {
    return {
      ...goal,
      status: "abandoned",
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Resume a paused goal.
   */
  resumeGoal(goal: GoalState): GoalState | null {
    if (goal.status !== "paused") {
      return null;
    }
    return {
      ...goal,
      status: "active",
      updated_at: new Date().toISOString(),
      no_progress_count: 0,
    };
  }
}
