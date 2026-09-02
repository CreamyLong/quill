/**
 * Evaluation framework — core types.
 *
 * Port of DeepSeek-harness's evaluation model + SWE-agent's task structure.
 * Provides the type contract for benchmarking agent runs against defined
 * tasks with pluggable scorers and adapters.
 *
 * Architecture:
 *   Task (definition) → Adapter (normalizes to AgentTask) → Runner (executes)
 *   → Scorer (judges result) → Report (aggregates across tasks).
 *
 * Inspired by:
 *   - DeepSeek-harness: reproducible task definitions with pinned datasets
 *   - SWE-agent: Docker-isolated task execution with patch-based scoring
 *   - OpenAI Evals: pluggable scorer registry + prompt-based evaluation
 */

// ---------------------------------------------------------------------------
// Task definitions
// ---------------------------------------------------------------------------

/**
 * A single evaluation task — the unit of benchmarking.
 *
 * Mirrors DeepSeek-harness's task contract: an id, a prompt, an expected
 * outcome (or a scoring function reference), metadata, and optional
 * resource files (datasets, reference solutions, environment setup).
 */
export interface EvalTask {
  /** Unique task identifier (e.g. "swe-bench-lite__django__django-12345"). */
  id: string;
  /** Human-readable task name. */
  name: string;
  /** Category/group for reporting (e.g. "coding", "research", "math"). */
  category: string;
  /** The prompt sent to the agent. */
  prompt: string;
  /** Optional system prompt override for this task. */
  systemPrompt?: string | null;
  /** Expected output or reference answer (used by exact-match scorers). */
  expectedAnswer?: string | null;
  /** Expected artifacts (file paths the agent should produce). */
  expectedArtifacts?: string[];
  /** Maximum wall-clock seconds before the task is timed out. */
  timeoutSeconds?: number;
  /** Maximum agent turns before the task is stopped. */
  maxTurns?: number;
  /** Difficulty tier: "easy" | "medium" | "hard" | "expert". */
  difficulty?: "easy" | "medium" | "hard" | "expert";
  /** Free-form tags for filtering and reporting. */
  tags?: string[];
  /** Arbitrary metadata (dataset revision, source repo, etc.). */
  metadata?: Record<string, unknown>;
  /**
   * Scoring configuration — either a built-in scorer name or a custom
   * scoring function identifier resolved at runtime.
   */
  scoring: EvalScoringConfig;
}

/** How a task should be scored. */
export type EvalScoringConfig =
  | { type: "exact_match"; ignoreCase?: boolean; normalizeWhitespace?: boolean }
  | { type: "contains"; substring: string; ignoreCase?: boolean }
  | { type: "regex"; pattern: string; flags?: string }
  | { type: "llm_judge"; prompt: string; model?: string; temperature?: number }
  | { type: "artifact_exists"; paths: string[]; allRequired?: boolean }
  | { type: "artifact_content"; path: string; expected: string; ignoreCase?: boolean }
  | { type: "custom"; scorerPath: string; scorerConfig?: Record<string, unknown> }
  | { type: "composite"; scorers: EvalScoringConfig[]; weights?: number[] };

// ---------------------------------------------------------------------------
// Runner contract
// ---------------------------------------------------------------------------

/**
 * Result of a single task execution — what the agent produced.
 */
export interface EvalTaskResult {
  taskId: string;
  /** The agent's final text response. */
  response: string;
  /** Artifact paths the agent wrote (relative to workspace). */
  artifacts: string[];
  /** Artifact contents keyed by path (read at scoring time). */
  artifactContents: Record<string, string>;
  /** Token usage for the run. */
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  /** Wall-clock milliseconds. */
  durationMs: number;
  /** Number of agent turns. */
  turns: number;
  /** Whether the run was interrupted (timeout, max turns, error). */
  interrupted: boolean;
  /** Error message if the run failed. */
  error?: string | null;
  /** Raw events for debugging. */
  events?: EvalEvent[];
}

/** A single event during task execution (for trace analysis). */
export interface EvalEvent {
  timestamp: string;
  kind: "model_call" | "tool_call" | "tool_result" | "error" | "turn_boundary";
  data: Record<string, unknown>;
}

/**
 * EvalRunner executes a task against an agent and returns the result.
 * Implementations mirror SWE-agent's agent-interface abstraction:
 * the runner doesn't care which agent framework produces the answer,
 * it only needs a function that takes a prompt and returns a response
 * plus any artifacts.
 */
export type EvalRunner = (
  task: EvalTask,
  options?: { signal?: AbortSignal },
) => Promise<EvalTaskResult>;

// ---------------------------------------------------------------------------
// Scorer contract
// ---------------------------------------------------------------------------

/**
 * Score output of a single task. Returns a normalized score in [0, 1]
 * plus an optional explanation.
 *
 * Scorers are pure functions — no I/O, no network calls (except
 * LLM-judge scorers, which declare their model dependency explicitly).
 * This mirrors the awesome-harness-engineering principle of deterministic,
 * reproducible evaluation.
 */
export interface EvalScorer {
  readonly name: string;
  score(task: EvalTask, result: EvalTaskResult): Promise<EvalScore> | EvalScore;
}

/** A single score outcome. */
export interface EvalScore {
  /** Normalized score in [0, 1]. */
  score: number;
  /** Whether the task is considered "passing" (score >= threshold). */
  passed: boolean;
  /** Human-readable explanation of the score. */
  reason: string;
  /** Detailed metrics (per-check results, partial credits, etc.). */
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** Aggregated report for a benchmark run. */
export interface EvalReport {
  /** Run metadata. */
  meta: {
    runId: string;
    startedAt: string;
    finishedAt: string;
    runnerName: string;
    taskCount: number;
  };
  /** Per-task results. */
  results: EvalTaskScore[];
  /** Aggregate statistics. */
  summary: EvalSummary;
}

/** A single task's score within a report. */
export interface EvalTaskScore {
  taskId: string;
  taskName: string;
  category: string;
  difficulty?: string;
  score: number;
  passed: boolean;
  reason: string;
  durationMs: number;
  tokenUsage: EvalTaskResult["tokenUsage"];
  details?: Record<string, unknown>;
}

/** Aggregate statistics. */
export interface EvalSummary {
  /** Overall pass rate (fraction of tasks with passed=true). */
  passRate: number;
  /** Mean score across all tasks. */
  meanScore: number;
  /** Per-category breakdown. */
  byCategory: Record<string, CategoryStats>;
  /** Per-difficulty breakdown. */
  byDifficulty: Record<string, CategoryStats>;
  /** Total token usage. */
  totalTokens: number;
  /** Total wall-clock ms. */
  totalDurationMs: number;
}

export interface CategoryStats {
  total: number;
  passed: number;
  passRate: number;
  meanScore: number;
}
