/**
 * Deterministic offline security scanner for skill content.
 *
 * Port of DeerFlow 2.0's SkillScan Phase 1. Runs a set of deterministic
 * pattern matches against skill content *before* the LLM-based scanner.
 * Findings that match CRITICAL patterns are blocked immediately without any
 * LLM call. Findings that match WARNING patterns are passed to the LLM
 * scanner for contextual review.
 *
 * Design goals:
 *   - Zero external dependencies (no Semgrep/OpenGrep).
 *   - Deterministic work budget and recursion limit.
 *   - Fail-closed: a match on a CRITICAL pattern blocks the skill.
 *   - Explainable: every finding carries a rule id, severity, and evidence.
 */

/** Severity of a deterministic finding. */
export type FindingSeverity = "critical" | "warning";

/** A single deterministic finding. */
export interface DeterministicFinding {
  ruleId: string;
  severity: FindingSeverity;
  message: string;
  /** Line number where the match occurred (1-based). */
  line?: number;
  /** The matched text snippet (truncated for safety). */
  evidence?: string;
}

/** Result of a deterministic scan. */
export interface DeterministicScanResult {
  /** True when at least one CRITICAL finding was detected. */
  blocked: boolean;
  /** All findings (critical + warning), in rule-priority order. */
  findings: DeterministicFinding[];
}

interface ScanRule {
  id: string;
  severity: FindingSeverity;
  /** Human-readable explanation surfaced in the block message. */
  message: string;
  /** Regex matched against the full content (case-insensitive). */
  pattern: RegExp;
  /** When true, the match is only reported in executable contexts. */
  executableOnly?: boolean;
}

/**
 * Built-in rule set. Ordered: critical rules first so the most dangerous
 * findings surface at the top of the findings list.
 *
 * Patterns are conservative — they target high-confidence indicators rather
 * than borderline cases (which the LLM scanner handles).
 */
const BUILTIN_RULES: ScanRule[] = [
  // --- Critical: private keys and secrets ---
  {
    id: "CRIT-001",
    severity: "critical",
    message: "Private key material detected (RSA/DSA/EC/OpenSSH private key)",
    pattern:
      /-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH|PGP)\s+PRIVATE\s+KEY\s*(?:BLOCK)?-----/i,
  },
  {
    id: "CRIT-002",
    severity: "critical",
    message: "High-entropy secret or API token embedded in content",
    pattern:
      /(?:api[_-]?key|api[_-]?secret|auth[_-]?token|access[_-]?token|secret[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{24,}['"]?/i,
  },
  // --- Critical: prompt injection ---
  {
    id: "CRIT-003",
    severity: "critical",
    message: "Prompt injection marker: explicit instruction override detected",
    pattern:
      /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)/i,
  },
  {
    id: "CRIT-004",
    severity: "critical",
    message: "Prompt injection marker: system-role override attempt",
    pattern:
      /(?:you\s+are\s+now|from\s+now\s+on\s+you|new\s+persona|pretend\s+(?:to\s+be|you\s+are))\b/i,
  },
  // --- Critical: exfiltration patterns ---
  {
    id: "CRIT-005",
    severity: "critical",
    message: "Data exfiltration pattern: outbound request carrying secret-like data",
    pattern:
      /(?:curl|wget|fetch|nc\s+-|python\s+-c)\s+[^;\n]*(?:token|key|secret|password|credential)[^;\n]*/i,
  },
  {
    id: "CRIT-006",
    severity: "critical",
    message: "DNS exfiltration pattern detected",
    pattern:
      /(?:dig|nslookup|host)\s+[^;\n]*(?:key|token|secret|password)/i,
  },
  // --- Critical: unsafe shell execution ---
  {
    id: "CRIT-007",
    severity: "critical",
    message: "Unsafe shell execution: eval/exec of dynamic content",
    pattern:
      /(?:eval|exec)\s*\(\s*(?:request|input|params|body|args|os\.environ)/i,
    executableOnly: true,
  },
  {
    id: "CRIT-008",
    severity: "critical",
    message: "Unsafe shell execution: os.system / subprocess with user input",
    pattern:
      /(?:os\.system|subprocess\.(?:call|run|Popen))\s*\(\s*(?:request|input|params|body|args)/i,
    executableOnly: true,
  },
  // --- Warning: borderline patterns passed to LLM scanner ---
  {
    id: "WARN-001",
    severity: "warning",
    message: "External API reference detected — review for data leakage",
    pattern:
      /https?:\/\/(?:api\.)?[a-z0-9\-]+\.(?:com|io|net|dev|app)\/[a-z0-9\-_\/]+/i,
  },
  {
    id: "WARN-002",
    severity: "warning",
    message: "File system write operation detected",
    pattern:
      /(?:open|write|fs\.write|fs\.create)\s*\(\s*['"]/i,
    executableOnly: true,
  },
  {
    id: "WARN-003",
    severity: "warning",
    message: "Environment variable access detected",
    pattern:
      /(?:process\.env|os\.environ|os\.getenv)/i,
    executableOnly: true,
  },
];

const DEFAULT_MAX_EVIDENCE_CHARS = 80;
const DEFAULT_MAX_FINDINGS = 20;

export interface DeterministicScanOptions {
  /** When true, only executable-context rules are evaluated. */
  executable?: boolean;
  /** Maximum characters of evidence to capture per finding. */
  maxEvidenceChars?: number;
  /** Maximum number of findings to report (bounds work). */
  maxFindings?: number;
  /** Additional rules to evaluate beyond the built-in set. */
  extraRules?: ScanRule[];
}

/**
 * Run a deterministic security scan against skill content.
 *
 * Evaluates each built-in (and any extra) rule against the content. Rules
 * flagged `executableOnly` are skipped unless `options.executable` is true.
 * Scanning stops after `maxFindings` findings to bound work.
 *
 * @returns A result with `blocked: true` when any CRITICAL finding matches.
 */
export function deterministicScan(
  content: string,
  options: DeterministicScanOptions = {},
): DeterministicScanResult {
  const executable = options.executable ?? false;
  const maxEvidence = options.maxEvidenceChars ?? DEFAULT_MAX_EVIDENCE_CHARS;
  const maxFindings = options.maxFindings ?? DEFAULT_MAX_FINDINGS;
  const rules = options.extraRules
    ? [...BUILTIN_RULES, ...options.extraRules]
    : BUILTIN_RULES;

  const findings: DeterministicFinding[] = [];
  const lines = content.split("\n");

  for (const rule of rules) {
    if (rule.executableOnly && !executable) continue;
    if (findings.length >= maxFindings) break;

    // Fast path: test the full content first (avoids per-line work when
    // there is no match at all).
    if (!rule.pattern.test(content)) continue;

    // Reset lastIndex before per-line search — the full-content test above
    // advances it past the match.
    rule.pattern.lastIndex = 0;

    // Match → locate the line for evidence.
    const lineNum = findMatchingLine(lines, rule.pattern);
    const evidence = lineNum
      ? truncate(lines[lineNum - 1].trim(), maxEvidence)
      : undefined;

    findings.push({
      ruleId: rule.id,
      severity: rule.severity,
      message: rule.message,
      line: lineNum,
      evidence,
    });

    // Reset lastIndex so the next rule's pattern starts clean.
    rule.pattern.lastIndex = 0;
  }

  const blocked = findings.some((f) => f.severity === "critical");
  return { blocked, findings };
}

/** Find the first line matching the pattern (1-based line number). */
function findMatchingLine(lines: string[], pattern: RegExp): number | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      pattern.lastIndex = 0;
      return i + 1;
    }
  }
  return undefined;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

/**
 * Convenience: scan and return a human-readable block message when blocked.
 * Returns `null` when the content passes the deterministic scan.
 */
export function scanOrDescribeBlock(
  content: string,
  options: DeterministicScanOptions = {},
): string | null {
  const result = deterministicScan(content, options);
  if (!result.blocked) return null;
  const criticals = result.findings.filter((f) => f.severity === "critical");
  const lines = criticals.map((f) => {
    const loc = f.line ? ` (line ${f.line})` : "";
    const ev = f.evidence ? ` — "${f.evidence}"` : "";
    return `[${f.ruleId}] ${f.message}${loc}${ev}`;
  });
  return `Deterministic security scan blocked this content:\n${lines.join("\n")}`;
}
