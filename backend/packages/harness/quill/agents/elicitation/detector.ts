/**
 * AmbiguityDetector — scores user messages across ambiguity dimensions.
 *
 * Analyzes a user message for signals that the agent's interpretation may
 * diverge from user intent. Each dimension produces a 0-1 score; the weighted
 * sum drives the elicitation decision.
 *
 * Dimensions ported from ZCode's Elicitation runtime and awesome-harness-
 * engineering's "Context Rot" detection patterns.
 */

export interface AmbiguityScore {
  /** Overall ambiguity 0-1 (weighted sum of dimensions). */
  overall: number;
  /** Per-dimension scores. */
  dimensions: {
    /** Missing critical info (paths, names, versions, scope). */
    missingContext: number;
    /** Multiple valid interpretations detected. */
    vagueness: number;
    /** No clear success criteria or output format specified. */
    underspecifiedGoal: number;
    /** Contradictory or self-conflicting instructions. */
    contradiction: number;
    /** Message is very short relative to expected complexity. */
    insufficientDetail: number;
  };
  /** Specific signals detected in the message. */
  signals: string[];
}

/** Configurable weights for each ambiguity dimension. */
export interface DetectorWeights {
  missingContext: number;
  vagueness: number;
  underspecifiedGoal: number;
  contradiction: number;
  insufficientDetail: number;
}

const DEFAULT_WEIGHTS: DetectorWeights = {
  missingContext: 0.3,
  vagueness: 0.25,
  underspecifiedGoal: 0.2,
  contradiction: 0.15,
  insufficientDetail: 0.1,
};

// Vague phrases that signal multiple interpretations.
const VAGUE_PATTERNS = [
  /\b(something|stuff|things?|somehow)\b/i,
  /\b(make it better|improve|optimize|clean up)\b/i,
  /\b(fix|handle|deal with|take care of)\b/i,
  /\b(the usual|as normal|like before|you know)\b/i,
  /\b(etc\.?|and so on|and more|stuff like that)\b/i,
  /\b(just|simply|easy|quickly)\b/i,
];

// Contradictory phrase pairs.
const CONTRADICTION_PAIRS = [
  [/\b(simple|minimal|basic)\b/i, /\b(comprehensive|complete|exhaustive|thorough)\b/i],
  [/\b(fast|quick|speed)\b/i, /\b(careful|thorough|detailed)\b/i],
  [/\b(don't|do not|never)\b/i, /\b(always|make sure|ensure)\b/i],
];

// Patterns indicating a well-specified goal.
const GOAL_SPECIFIERS = [
  /\b(create|build|implement|write|add|remove|delete|refactor|migrate)\b/i,
  /\b(to|into|for|that|which|so that)\b/i,
  /\b(function|class|module|component|file|test|endpoint|api)\b/i,
];

export class AmbiguityDetector {
  private weights: DetectorWeights;

  constructor(weights?: Partial<DetectorWeights>) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  /**
   * Score a user message for ambiguity.
   *
   * @param message - The user's input message.
   * @param contextHints - Optional workspace context (e.g., current file,
   *   project type) to reduce false positives.
   */
  detect(message: string, contextHints?: { projectType?: string; currentFile?: string }): AmbiguityScore {
    const signals: string[] = [];
    const dims = this.dimensions(message, signals, contextHints);

    const overall =
      dims.missingContext * this.weights.missingContext +
      dims.vagueness * this.weights.vagueness +
      dims.underspecifiedGoal * this.weights.underspecifiedGoal +
      dims.contradiction * this.weights.contradiction +
      dims.insufficientDetail * this.weights.insufficientDetail;

    return {
      overall: Math.min(1, Math.max(0, overall)),
      dimensions: dims,
      signals,
    };
  }

  /** Whether the message should trigger elicitation. */
  shouldElicit(score: AmbiguityScore, threshold = 0.45): boolean {
    return score.overall >= threshold;
  }

  // ------------------------------------------------------------------
  // Dimension scorers
  // ------------------------------------------------------------------

  private dimensions(
    message: string,
    signals: string[],
    contextHints?: { projectType?: string; currentFile?: string },
  ): AmbiguityScore["dimensions"] {
    return {
      missingContext: this.scoreMissingContext(message, signals, contextHints),
      vagueness: this.scoreVagueness(message, signals),
      underspecifiedGoal: this.scoreUnderspecifiedGoal(message, signals),
      contradiction: this.scoreContradiction(message, signals),
      insufficientDetail: this.scoreInsufficientDetail(message, signals),
    };
  }

  private scoreMissingContext(
    message: string,
    signals: string[],
    contextHints?: { projectType?: string; currentFile?: string },
  ): number {
    // If we have project context, missing-context ambiguity is reduced.
    let score = 0;

    // Check for references to unspecified entities.
    if (/\b(this|that|it|they|them|the (?:file|function|class|module))\b/i.test(message)) {
      score += 0.3;
      signals.push("Unspecified pronoun references detected");
    }

    // Check for missing paths/scopes.
    if (/\b(in|at|under|inside)\b/i.test(message) && !/\b(?:[\/\w.-]+)\b/.test(message)) {
      score += 0.25;
      signals.push("Location reference without concrete path");
    }

    // Check for missing version/constraint info.
    if (/\b(update|upgrade|bump|latest|new)\b/i.test(message) && !/\b\d+\.\d+/.test(message)) {
      score += 0.2;
      signals.push("Version or constraint unspecified");
    }

    // Reduce if project context is available.
    if (contextHints?.projectType) score *= 0.7;
    if (contextHints?.currentFile) score *= 0.8;

    return Math.min(1, score);
  }

  private scoreVagueness(message: string, signals: string[]): number {
    let hits = 0;
    for (const pattern of VAGUE_PATTERNS) {
      if (pattern.test(message)) {
        hits++;
      }
    }
    if (hits > 0) {
      signals.push(`Vague language detected (${hits} pattern${hits > 1 ? "s" : ""} matched)`);
    }
    return Math.min(1, hits * 0.25);
  }

  private scoreUnderspecifiedGoal(message: string, signals: string[]): number {
    let hits = 0;
    for (const pattern of GOAL_SPECIFIERS) {
      if (pattern.test(message)) hits++;
    }
    // If fewer than 2 goal specifiers, the goal is underspecified.
    const score = hits < 2 ? 0.6 + (0.2 - hits * 0.2) : 0;
    if (score > 0) {
      signals.push("Goal lacks concrete action + target specification");
    }
    return Math.min(1, score);
  }

  private scoreContradiction(message: string, signals: string[]): number {
    let score = 0;
    for (const [a, b] of CONTRADICTION_PAIRS) {
      if (a.test(message) && b.test(message)) {
        score += 0.4;
        signals.push(`Potential contradiction: "${a.source}" vs "${b.source}"`);
      }
    }
    return Math.min(1, score);
  }

  private scoreInsufficientDetail(message: string, signals: string[]): number {
    const wordCount = message.split(/\s+/).length;
    const hasCodeBlock = message.includes("```");
    const hasList = /^[\s]*[-*]/m.test(message);

    if (wordCount < 5 && !hasCodeBlock) {
      signals.push("Very short message — likely missing detail");
      return 0.7;
    }
    if (wordCount < 15 && !hasCodeBlock && !hasList) {
      signals.push("Brief message — consider adding specifics");
      return 0.3;
    }
    return 0;
  }
}
