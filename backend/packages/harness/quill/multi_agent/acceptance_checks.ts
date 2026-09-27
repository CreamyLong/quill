/**
 * Delegation Acceptance Criteria — deterministic, code-executed checks on
 * subagent results that cannot be gamed by self-report.
 *
 * Ported from DeerFlow 2.1.0's `acceptance_checks.py`
 * (`check_acceptance_criteria`): a delegated task may declare acceptance
 * criteria as plain strings; after the subagent finishes, the harness — not
 * the model — verifies each criterion and renders the verdict into the
 * result text the lead agent sees.
 *
 * Criterion grammar (mirrors upstream):
 * - `file:<path> exists`          — path exists inside the shared workspace
 * - `file:<path> non-empty`       — path exists and has size > 0
 * - `file_written:<path>`         — path exists and is readable
 * - `tests_passed:<command>`      — a recorded execution of that command
 *                                    completed successfully AND its output
 *                                    has a test-summary shape. The check
 *                                    never re-runs tests; it verifies a
 *                                    recorded run (anchored to tool receipts).
 * - anything else                 — `unverified` (never guessed)
 *
 * Paths are normalized against the workspace root; absolute paths and
 * `..` traversals that escape the root are rejected to prevent
 * cross-sandbox reachability (upstream calls this workspace-scoping).
 *
 * @module multi_agent/acceptance_checks
 */

import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Deterministic verdict for one criterion. */
export type AcceptanceVerdict = "holds" | "does_not_hold" | "unverified";

/** A recorded tool execution the checks may anchor to (from thread history / receipts). */
export interface RecordedExecution {
  /** The command line that ran (e.g. `npm test -- --run`). */
  command: string;
  /** Terminal status of the execution. */
  status: "success" | "error";
  /** Truncated output text. */
  output: string;
}

/** Filesystem + execution view the checks run against. */
export interface AcceptanceCheckContext {
  /** Workspace root all relative paths resolve against. */
  workspaceRoot: string;
  /** Stat a workspace-relative path: size in bytes, or null when missing. */
  statFile(relPath: string): { size: number } | null;
  /** Read a workspace-relative path as UTF-8 text, or null when unreadable. */
  readFile(relPath: string): string | null;
  /** Recorded executions visible to this delegation. */
  executions: RecordedExecution[];
}

/** Result of checking one criterion. */
export interface AcceptanceCheckResult {
  /** The original criterion string. */
  criterion: string;
  /** Deterministic verdict. */
  verdict: AcceptanceVerdict;
  /** Human-readable evidence line (why the verdict holds or fails). */
  detail: string;
}

// ---------------------------------------------------------------------------
// Path scoping
// ---------------------------------------------------------------------------

/**
 * Normalize a criterion path against the workspace root. Returns the
 * workspace-relative POSIX path, or null when the path escapes the root
 * (absolute paths outside the root, or `..` traversals).
 */
export function scopeCriterionPath(rawPath: string, workspaceRoot: string): string | null {
  const trimmed = rawPath.trim();
  if (trimmed === "") {
    return null;
  }
  const resolved = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(workspaceRoot, trimmed);
  const root = path.resolve(workspaceRoot);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return path.relative(root, resolved).split(path.sep).join("/");
}

// ---------------------------------------------------------------------------
// tests_passed anchoring
// ---------------------------------------------------------------------------

/** Output shapes that indicate a test runner produced this output. */
const TEST_SUMMARY_PATTERNS: RegExp[] = [
  /\b\d+\s+(test|tests|spec|specs|case|cases)\b/i,
  /\b(tests?|specs?|cases?)\s+\d+\s+(passed|failed|skipped)\b/i,
  /\b\d+\s+(passed|failed|skipped)\b/i,
  /\b(passed|failed|skipped)\s*:?\s*\d+/i,
  /✓|✗|✔|✘/,
  /\bPASS\b|\bFAIL\b/,
  /Test Files\s+\d+/,
];

/** Whether an execution's output looks like a test summary (upstream's "test-summary shape"). */
export function hasTestSummaryShape(output: string): boolean {
  return TEST_SUMMARY_PATTERNS.some((re) => re.test(output));
}

/**
 * Whether a recorded execution anchors a `tests_passed:<command>` criterion:
 * the command must be covered (prefix or substring match so flag variations
 * still anchor), the run must have succeeded, and the output must carry a
 * test-summary shape.
 */
export function executionAnchorsTestsPassed(
  execution: RecordedExecution,
  command: string,
): boolean {
  const wanted = command.trim();
  if (wanted === "") {
    return false;
  }
  const ran = execution.command.trim();
  const covers = ran === wanted || ran.startsWith(wanted + " ") || ran.includes(wanted);
  if (!covers) {
    return false;
  }
  return execution.status === "success" && hasTestSummaryShape(execution.output);
}

// ---------------------------------------------------------------------------
// Criterion checks
// ---------------------------------------------------------------------------

/** Parse and check one criterion against the context. Never throws. */
export function checkAcceptanceCriterion(
  criterion: string,
  ctx: AcceptanceCheckContext,
): AcceptanceCheckResult {
  const raw = criterion.trim();

  // file:<path> exists | file:<path> non-empty
  const fileMatch = /^file:(.+?)\s+(exists|non-empty)$/.exec(raw);
  if (fileMatch !== null) {
    const rel = scopeCriterionPath(fileMatch[1], ctx.workspaceRoot);
    if (rel === null) {
      return {
        criterion: raw,
        verdict: "does_not_hold",
        detail: `path escapes the workspace root`,
      };
    }
    const stat = ctx.statFile(rel);
    if (stat === null) {
      return { criterion: raw, verdict: "does_not_hold", detail: `${rel} does not exist` };
    }
    if (fileMatch[2] === "non-empty" && stat.size === 0) {
      return { criterion: raw, verdict: "does_not_hold", detail: `${rel} is empty` };
    }
    return {
      criterion: raw,
      verdict: "holds",
      detail: fileMatch[2] === "exists" ? `${rel} exists` : `${rel} is non-empty (${stat.size} bytes)`,
    };
  }

  // file_written:<path>
  const writtenMatch = /^file_written:(.+)$/.exec(raw);
  if (writtenMatch !== null) {
    const rel = scopeCriterionPath(writtenMatch[1], ctx.workspaceRoot);
    if (rel === null) {
      return {
        criterion: raw,
        verdict: "does_not_hold",
        detail: `path escapes the workspace root`,
      };
    }
    const content = ctx.readFile(rel);
    if (content === null) {
      return {
        criterion: raw,
        verdict: "does_not_hold",
        detail: `${rel} is missing or unreadable`,
      };
    }
    return { criterion: raw, verdict: "holds", detail: `${rel} is readable (${content.length} chars)` };
  }

  // tests_passed:<command>
  const testsMatch = /^tests_passed:(.+)$/.exec(raw);
  if (testsMatch !== null) {
    const command = testsMatch[1].trim();
    const anchor = ctx.executions.find((exec) => executionAnchorsTestsPassed(exec, command));
    if (anchor !== undefined) {
      return {
        criterion: raw,
        verdict: "holds",
        detail: `recorded run succeeded: \`${anchor.command}\``,
      };
    }
    const ranButFailed = ctx.executions.some(
      (exec) =>
        exec.command.trim() !== "" &&
        (exec.command.trim() === command || exec.command.trim().startsWith(command + " ") || exec.command.trim().includes(command)),
    );
    return {
      criterion: raw,
      verdict: "does_not_hold",
      detail: ranButFailed
        ? `a run of \`${command}\` was recorded but did not succeed with a test-summary output`
        : `no successful recorded run of \`${command}\``,
    };
  }

  return {
    criterion: raw,
    verdict: "unverified",
    detail: "unrecognized criterion format",
  };
}

/** Check every criterion. */
export function checkAcceptanceCriteria(
  criteria: string[],
  ctx: AcceptanceCheckContext,
): AcceptanceCheckResult[] {
  return criteria.map((criterion) => checkAcceptanceCriterion(criterion, ctx));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const VERDICT_MARK: Record<AcceptanceVerdict, string> = {
  holds: "✓",
  does_not_hold: "✗",
  unverified: "?",
};

/**
 * Render the verdicts into a compact block appended to the subagent result
 * text, so the lead agent sees deterministic evidence instead of trusting
 * the subagent's self-report.
 */
export function renderAcceptanceResults(results: AcceptanceCheckResult[]): string {
  if (results.length === 0) {
    return "";
  }
  const lines = results.map(
    (r) => `${VERDICT_MARK[r.verdict]} ${r.criterion} — ${r.verdict} (${r.detail})`,
  );
  const allHold = results.every((r) => r.verdict === "holds");
  const header = allHold
    ? "Acceptance criteria: ALL HOLD (verified by the harness, not self-reported)"
    : "Acceptance criteria: NOT fully verified by the harness";
  return [header, ...lines].join("\n");
}
