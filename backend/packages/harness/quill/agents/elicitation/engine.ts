/**
 * ElicitationEngine — generates structured clarifying questions.
 *
 * Given an ambiguity score, produces up to 3 targeted questions that resolve
 * the detected ambiguity dimensions. Questions follow a structured format so
 * the UI can render them as interactive choice/radio/text inputs.
 */

import type { AmbiguityScore } from "./detector.js";

export type ElicitationQuestionType = "choice" | "text" | "multiselect";

export interface ElicitationQuestion {
  /** Unique ID for this question (used to match answers). */
  id: string;
  /** The question text to present to the user. */
  question: string;
  /** Input type — determines UI rendering. */
  type: ElicitationQuestionType;
  /** For choice/multiselect: the available options. */
  options?: string[];
  /** Which ambiguity dimension this question addresses. */
  dimension: keyof AmbiguityScore["dimensions"];
  /** Whether this question must be answered. */
  required: boolean;
}

export interface ElicitationResult {
  /** Whether elicitation is needed. */
  shouldElicit: boolean;
  /** The questions to ask (max 3). */
  questions: ElicitationQuestion[];
  /** The original ambiguity score. */
  score: AmbiguityScore;
}

export class ElicitationEngine {
  /**
   * Generate clarifying questions from an ambiguity score.
   *
   * Produces at most 3 questions, prioritized by the highest-scoring
   * ambiguity dimensions.
   */
  generate(score: AmbiguityScore): ElicitationResult {
    if (score.overall < 0.3) {
      return { shouldElicit: false, questions: [], score };
    }

    const questions: ElicitationQuestion[] = [];
    const dims = score.dimensions;

    // Sort dimensions by score descending, generate for top ones.
    const sortedDims = (
      Object.entries(dims) as [keyof typeof dims, number][]
    ).filter(([, v]) => v > 0.2).sort((a, b) => b[1] - a[1]);

    for (const [dim] of sortedDims.slice(0, 3)) {
      const q = this.questionForDimension(dim);
      if (q) questions.push(q);
    }

    return {
      shouldElicit: questions.length > 0,
      questions,
      score,
    };
  }

  // ------------------------------------------------------------------
  // Question generators per dimension
  // ------------------------------------------------------------------

  private questionForDimension(
    dim: keyof AmbiguityScore["dimensions"],
  ): ElicitationQuestion | null {
    switch (dim) {
      case "missingContext":
        return {
          id: "missing-context",
          question: "Could you provide more context? For example: which file(s), function(s), or module(s) should I focus on?",
          type: "text",
          dimension: "missingContext",
          required: true,
        };

      case "vagueness":
        return {
          id: "vagueness",
          question: "Which of these best describes what you want?",
          type: "choice",
          options: [
            "Implement a new feature",
            "Fix a bug or error",
            "Refactor existing code",
            "Add tests",
            "Documentation or comments",
            "Something else",
          ],
          dimension: "vagueness",
          required: true,
        };

      case "underspecifiedGoal":
        return {
          id: "goal-format",
          question: "What should the output look like?",
          type: "choice",
          options: [
            "A complete implementation",
            "A plan or outline first",
            "Just the changed files",
            "A summary of what to do",
          ],
          dimension: "underspecifiedGoal",
          required: true,
        };

      case "contradiction":
        return {
          id: "contradiction",
          question: "I noticed some potentially conflicting requirements. Which should take priority?",
          type: "text",
          dimension: "contradiction",
          required: false,
        };

      case "insufficientDetail":
        return {
          id: "insufficient-detail",
          question: "Could you add more details about your request?",
          type: "text",
          dimension: "insufficientDetail",
          required: false,
        };

      default:
        return null;
    }
  }
}
