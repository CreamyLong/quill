/**
 * TwoStageClassifier — fast gate before expensive chain-of-thought reasoning.
 *
 * Ported from awesome-harness-engineering's "Two-Stage Classifier" pattern:
 * first, a fast single-token gate determines whether the user's request needs
 * deep reasoning; only flagged requests trigger the full chain-of-thought
 * pipeline. Simple requests bypass expensive planning and go straight to
 * execution.
 *
 * Stage 1 (fast): classify message as "simple" or "complex" via pattern
 * matching + heuristics (no LLM call).
 * Stage 2 (expensive): only for "complex" messages, invoke the reasoning
 * pipeline (plan → decompose → execute).
 *
 * This middleware attaches a `reasoningLevel` hint to the thread state that
 * downstream consumers (e.g. the model selection logic) can use to decide
 * whether to invoke extended thinking / deeper reasoning.
 */

import type { MiddlewareDefinition } from "../factory.js";
import type { ThreadState } from "../thread_state.js";

export type ReasoningLevel = "minimal" | "standard" | "deep";

export interface ClassificationResult {
  /** The assigned reasoning level. */
  level: ReasoningLevel;
  /** Confidence of the classification (0-1). */
  confidence: number;
  /** Why this classification was chosen. */
  reason: string;
  /** Signals detected. */
  signals: string[];
}

export interface TwoStageClassifierConfig {
  /** Maximum word count for "minimal" classification. */
  simpleMaxWords: number;
  /** Minimum word count for "complex" classification. */
  complexMinWords: number;
  /** Tools that always trigger deep reasoning. */
  deepReasoningTools: string[];
  /** Patterns that signal complexity. */
  complexPatterns: RegExp[];
  /** Patterns that signal simplicity. */
  simplePatterns: RegExp[];
}

const DEFAULT_CONFIG: TwoStageClassifierConfig = {
  simpleMaxWords: 15,
  complexMinWords: 50,
  deepReasoningTools: [
    "write_file",
    "edit_file",
    "run_code",
    "create_workflow",
    "delegate_task",
  ],
  complexPatterns: [
    /\b(refactor|restructure|redesign|rearchitect)\b/i,
    /\b(integrate|migration|migrate|consolidate)\b/i,
    /\b(optimize|performance|benchmark|scale)\b/i,
    /\b(debug|investigate|diagnose|root.cause)\b/i,
    /\b(design|architect|plan|strategy)\b/i,
    /\b(multiple|several|all|every|across)\b/i,
    /\b(security|vulnerability|audit|compliance)\b/i,
    /\b(conflict|race.condition|deadlock|memory.leak)\b/i,
    /```[\s\S]+```/,
    /\b(step.by.step|detailed|comprehensive|thorough)\b/i,
  ],
  simplePatterns: [
    /\b(fix.*typo|typo|spelling)\b/i,
    /\b(add.*comment|comment.*out)\b/i,
    /\b(rename|format.*code|formatting)\b/i,
    /\b(what.*mean|explain.*briefly|quick.*question)\b/i,
    /\b(check|verify|confirm|test)\b/i,
    /\b(how.*do|how.*to)\b/i,
    /\b(search|find|look.*up|grep)\b/i,
  ],
};

export class TwoStageClassifier {
  private config: TwoStageClassifierConfig;

  constructor(config?: Partial<TwoStageClassifierConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Classify a user message into a reasoning level.
   *
   * Stage 1: fast heuristic/pattern matching.
   * If ambiguous, Stage 2 heuristics break the tie.
   */
  classify(message: string, threadState?: ThreadState): ClassificationResult {
    const signals: string[] = [];
    const wordCount = message.split(/\s+/).length;

    // ---- Stage 1: Pattern matching ----
    let complexScore = 0;
    let simpleScore = 0;

    for (const pattern of this.config.complexPatterns) {
      if (pattern.test(message)) {
        complexScore++;
        signals.push(`Complex: "${pattern.source.slice(0, 40)}"`);
      }
    }

    for (const pattern of this.config.simplePatterns) {
      if (pattern.test(message)) {
        simpleScore++;
        signals.push(`Simple: "${pattern.source.slice(0, 40)}"`);
      }
    }

    // ---- Stage 1: Word count heuristic ----
    if (wordCount <= this.config.simpleMaxWords && complexScore === 0) {
      simpleScore += 2;
      signals.push(`Short message (${wordCount} words)`);
    }
    if (wordCount >= this.config.complexMinWords) {
      complexScore += 1;
      signals.push(`Long message (${wordCount} words)`);
    }

    // ---- Stage 1: Thread history context ----
    if (threadState) {
      const msgCount = threadState.messages?.length ?? 0;
      if (msgCount > 10) {
        complexScore += 1;
        signals.push(`Long conversation (${msgCount} messages)`);
      }
      // If previous tool calls were complex, likely still complex.
      const lastToolCalls = threadState.messages
        ?.filter((m) => m._getType() === "tool")
        .slice(-3);
      for (const tc of lastToolCalls ?? []) {
        const name = (tc as { name?: string }).name ?? "";
        if (this.config.deepReasoningTools.includes(name)) {
          complexScore += 1;
          signals.push(`Previous deep tool: ${name}`);
          break;
        }
      }
    }

    // ---- Stage 2: Tie-breaking heuristics ----
    const diff = complexScore - simpleScore;
    let level: ReasoningLevel;
    let confidence: number;
    let reason: string;

    if (diff >= 2) {
      level = "deep";
      confidence = Math.min(0.95, 0.6 + diff * 0.1);
      reason = "Strong complexity signals detected";
    } else if (diff >= 1) {
      level = "standard";
      confidence = 0.6 + diff * 0.15;
      reason = "Moderate complexity — standard reasoning";
    } else if (diff <= -2) {
      level = "minimal";
      confidence = Math.min(0.95, 0.6 + Math.abs(diff) * 0.1);
      reason = "Clearly simple request";
    } else if (diff <= -1) {
      level = "minimal";
      confidence = 0.5 + Math.abs(diff) * 0.15;
      reason = "Likely simple — fast path";
    } else {
      // Tie — use word count as tiebreaker.
      if (wordCount > 30) {
        level = "standard";
        confidence = 0.5;
        reason = "Ambiguous — default to standard for longer messages";
      } else {
        level = "minimal";
        confidence = 0.5;
        reason = "Ambiguous — default to minimal for shorter messages";
      }
    }

    return { level, confidence, reason, signals };
  }

  /** Whether the message should trigger the full reasoning pipeline. */
  needsDeepReasoning(result: ClassificationResult): boolean {
    return result.level === "deep" && result.confidence > 0.6;
  }
}

export function twoStageClassifier(
  config?: Partial<TwoStageClassifierConfig>,
): MiddlewareDefinition {
  const classifier = new TwoStageClassifier(config);

  return {
    name: "TwoStageClassifier",
    beforeModel: (state: ThreadState) => {
      const messages = state.messages ?? [];
      if (messages.length === 0) return;

      // Classify the most recent human message.
      const lastHuman = [...messages].reverse().find((m) => m._getType() === "human");
      if (!lastHuman) return;

      const content =
        typeof lastHuman.content === "string"
          ? lastHuman.content
          : JSON.stringify(lastHuman.content);

      const result = classifier.classify(content, state);

      return {
        internal: {
          ...state.internal,
          classification: result,
          reasoningLevel: result.level,
        },
      };
    },
  };
}

export { DEFAULT_CONFIG as DEFAULT_CLASSIFIER_CONFIG };
