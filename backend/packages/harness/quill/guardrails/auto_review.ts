/**
 * Auto Review — risk-tiered per-call review of tool invocations.
 *
 * Ported from DeepSeek Harness's Auto Review: every native tool call is
 * intercepted before execution and classified by its ACTUAL EFFECT into three
 * risk tiers:
 *
 * - low   → allowed to run
 * - medium→ requires explicit authorization (irreversible deletion, force
 *           push, production operations)
 * - high  → hard-denied even when explicitly requested (sensitive data
 *           exfiltration across trust boundaries)
 *
 * Denials surface as a structured AutoReviewDeniedError so manual-approval
 * sessions can offer a "proceed anyway" path for medium tier only.
 *
 * Also includes the LLM-reviewer prompt builder with DeepSeek's five fixed
 * partitions (REVIEW_POLICY, ENVIRONMENT, PROJECT_INSTRUCTIONS,
 * FILTERED_HISTORY, PENDING_ACTION).
 *
 * @module guardrails/auto_review
 */

export type RiskTier = "low" | "medium" | "high";

export type AutoReviewDecision = "allow" | "require_authorization" | "deny";

export interface AutoReviewResult {
  tier: RiskTier;
  decision: AutoReviewDecision;
  /** Human-readable justification (shown in the approval card). */
  reason: string;
  /** Which rule matched. */
  rule: string;
  /** The tool that was reviewed. */
  tool: string;
}

/** Structured denial — manual-approval UIs may catch and offer override. */
export class AutoReviewDeniedError extends Error {
  readonly result: AutoReviewResult;

  constructor(result: AutoReviewResult) {
    super(`AutoReview denied ${result.tool}: ${result.reason}`);
    this.name = "AutoReviewDeniedError";
    this.result = result;
  }
}

export interface ReviewContext {
  /** Free-form environment description (paths, platform). */
  environment?: string;
  /** Project instructions (CLAUDE.md/AGENTS.md excerpt). */
  projectInstructions?: string;
  /** Recent conversation/tool history, filtered for relevance. */
  filteredHistory?: string;
  /** Paths that hold secrets/credentials in this deployment. */
  secretPaths?: string[];
  /** Hosts considered internal (not a trust boundary crossing). */
  internalHosts?: string[];
}

// ---------------------------------------------------------------------------
// Rule tables
// ---------------------------------------------------------------------------

interface ReviewRule {
  name: string;
  tier: RiskTier;
  reason: string;
  /** Match against the tool name. */
  tools?: RegExp;
  /** Match against the serialized tool input. */
  input?: RegExp;
  /** Both tool and input must match (when both present). */
  match(tool: string, input: string): boolean;
}

function rule(
  name: string,
  tier: RiskTier,
  reason: string,
  match: (tool: string, input: string) => boolean,
): ReviewRule {
  return { name, tier, reason, match };
}

function toolPattern(pattern: RegExp): (tool: string, input: string) => boolean {
  return (tool) => pattern.test(tool);
}

function inputPattern(pattern: RegExp): (tool: string, input: string) => boolean {
  return (_tool, input) => pattern.test(input);
}

/**
 * High tier — exfiltration across trust boundaries. Even when the user
 * explicitly asks, these are denied: the payload contains secret material
 * AND the destination is outside the trust boundary.
 */
const HIGH_RISK_RULES: ReviewRule[] = [
  rule(
    "secret-file-to-network",
    "high",
    "sends the contents of a credential/secret file to an external destination",
    (tool, input) =>
      /curl|wget|web_?fetch|http|fetch_url|web_search|send|upload|post/i.test(tool) &&
      /(\.env|id_rsa|id_ed25519|\.pem|\.key|credentials|\.aws|\.ssh|secrets?\.(yml|yaml|json|toml)|\.netrc|auth\.json)/i.test(
        input,
      ),
  ),
  rule(
    "env-dump-to-network",
    "high",
    "transmits environment variables (potential secrets) to an external destination",
    (tool, input) =>
      /curl|wget|web_?fetch|http|fetch_url|send|upload|post/i.test(tool) &&
      /(printenv|env\b|\$\{?[A-Z_]{4,}|process\.env|os\.environ)/.test(input),
  ),
  rule(
    "keychain-read-and-send",
    "high",
    "reads keychain/credential-store material and transmits it",
    (tool, input) =>
      /security|keychain|secret|credential|vault/i.test(tool) && /(curl|http|upload|send|post|webhook)/i.test(input),
  ),
];

/**
 * Medium tier — irreversible or production-impacting effects. Requires
 * explicit authorization from the user (or the direct parent agent).
 */
const MEDIUM_RISK_RULES: ReviewRule[] = [
  rule(
    "recursive-delete",
    "medium",
    "performs a recursive/forced deletion (irreversible)",
    inputPattern(/\brm\b[^|]*\s-[a-zA-Z]*[rfR]/),
  ),
  rule(
    "force-push",
    "medium",
    "force-pushes to a git remote (rewrites remote history)",
    inputPattern(/git\s+push[^|]*--force(?!-with-lease)|git\s+push\s+-f\b/),
  ),
  rule(
    "force-push-all",
    "medium",
    "force-pushes all refs (rewrites remote history)",
    inputPattern(/git\s+push[^|]*--force.*--all|git\s+push[^|]*--all.*--force/),
  ),
  rule(
    "database-drop",
    "medium",
    "drops or truncates a database/table (irreversible)",
    inputPattern(/\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE|DROP\s+COLLECTION)\b/i),
  ),
  rule(
    "production-ops",
    "medium",
    "mutates production infrastructure",
    (tool, input) =>
      /kubectl|terraform|ansible|deploy|helm/i.test(tool) &&
      /\b(delete|destroy|apply|replace|scale\s+down|cordon|drain|rollout\s+undo)\b/i.test(input),
  ),
  rule(
    "prod-target",
    "medium",
    "targets a production environment",
    inputPattern(/(--prod|production|prod-[a-z0-9-]+|PRD\b)/i),
  ),
  rule(
    "package-publish",
    "medium",
    "publishes a package to a public registry (hard to undo)",
    (tool, input) => /\bnpm\s+publish\b|\bpnpm\s+publish\b|\bcargo\s+publish\b|\b_twine\s+upload\b/.test(input),
  ),
  rule(
    "bulk-file-overwrite",
    "medium",
    "overwrites many files at once",
    (tool, input) => /write|edit|apply/i.test(tool) && /(\/\*|\*\*|glob|all\s+files|\.\.\/)/i.test(input),
  ),
  rule(
    "shell-pipe-download",
    "medium",
    "pipes downloaded content into a shell",
    inputPattern(/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|fi)?sh\b/),
  ),
  rule(
    "disk-write",
    "medium",
    "writes to a raw disk device",
    inputPattern(/\bdd\b[^|]*\bof=\/dev\/(sd|hd|disk)/),
  ),
];

/** Tools whose effects are inherently bounded (reads, searches, listings). */
const KNOWN_LOW_RISK_TOOLS = /^(read|list|search|get|show|view|grep|find|ls|cat|head|tail|stat|tree|glob|fetch_thread|query)/i;

// ---------------------------------------------------------------------------
// Reviewer
// ---------------------------------------------------------------------------

export interface AutoReviewerOptions {
  /** Extra secret paths (in addition to defaults) checked in exfiltration rules. */
  secretPaths?: string[];
  /** Hosts treated as internal — sending data there is not a boundary crossing. */
  internalHosts?: string[];
  /** Disable the reviewer entirely (all calls pass through). */
  enabled?: boolean;
}

/**
 * AutoReviewer — deterministic first-pass review of every tool call. Runs
 * before the tool executes; the caller maps the decision to its permission
 * flow (allow / approval card / hard error).
 */
export class AutoReviewer {
  private readonly enabled: boolean;
  private readonly secretPaths: string[];

  constructor(options: AutoReviewerOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.secretPaths = [
      ".env",
      "id_rsa",
      "id_ed25519",
      ".pem",
      ".aws",
      ".ssh",
      "credentials",
      ...(options.secretPaths ?? []),
    ];
  }

  /** Review a tool call and return the tiered decision. */
  review(toolName: string, toolInput: unknown, context: ReviewContext = {}): AutoReviewResult {
    if (!this.enabled) {
      return { tier: "low", decision: "allow", reason: "auto review disabled", rule: "disabled", tool: toolName };
    }

    const input = this.serialize(toolInput);

    // High tier first — a hard deny always wins.
    for (const r of HIGH_RISK_RULES) {
      if (r.match(toolName, input)) {
        // Internal hosts are not a trust boundary crossing.
        if (this.isInternalOnly(input, context)) {
          return {
            tier: "medium",
            decision: "require_authorization",
            reason: `${r.reason} (destination appears internal)`,
            rule: r.name,
            tool: toolName,
          };
        }
        return { tier: "high", decision: "deny", reason: r.reason, rule: r.name, tool: toolName };
      }
    }

    // Medium tier — needs authorization.
    for (const r of MEDIUM_RISK_RULES) {
      if (r.match(toolName, input)) {
        return { tier: "medium", decision: "require_authorization", reason: r.reason, rule: r.name, tool: toolName };
      }
    }

    return { tier: "low", decision: "allow", reason: "no risky effect detected", rule: "default", tool: toolName };
  }

  /** True when every URL/host in the input is on the internal allowlist. */
  private isInternalOnly(input: string, context: ReviewContext): boolean {
    const hosts = [...(context.internalHosts ?? []), "localhost", "127.0.0.1", "0.0.0.0", "::1"];
    const urls = input.match(/https?:\/\/[^\s"'`]+/g) ?? [];
    if (!urls.length) return false;
    return urls.every((url) => hosts.some((host) => url.includes(host)));
  }

  private serialize(toolInput: unknown): string {
    if (typeof toolInput === "string") return toolInput;
    try {
      return JSON.stringify(toolInput ?? {});
    } catch {
      return String(toolInput);
    }
  }

  /** Default secret paths this reviewer watches (exposed for diagnostics). */
  get watchedSecretPaths(): string[] {
    return [...this.secretPaths];
  }
}

// ---------------------------------------------------------------------------
// LLM reviewer prompt (5 fixed partitions, DeepSeek layout)
// ---------------------------------------------------------------------------

export interface ReviewPromptInput {
  policy: string;
  environment: string;
  projectInstructions: string;
  filteredHistory: string;
  pendingAction: { tool: string; input: unknown };
}

/**
 * Build the LLM reviewer prompt with DeepSeek Auto Review's five fixed
 * partitions. Used when deterministic rules are inconclusive and an LLM
 * second opinion is configured.
 */
export function buildReviewPrompt(input: ReviewPromptInput): string {
  return [
    "=== REVIEW_POLICY ===",
    input.policy.trim() ||
      "Classify the pending tool call by its actual effect: low (bounded, reversible), medium (irreversible deletion, force push, production operations — requires explicit authorization), high (sensitive data exfiltration across trust boundaries — deny even if requested).",
    "",
    "=== ENVIRONMENT ===",
    input.environment.trim() || "local development sandbox",
    "",
    "=== PROJECT_INSTRUCTIONS ===",
    input.projectInstructions.trim() || "(none)",
    "",
    "=== FILTERED_HISTORY ===",
    input.filteredHistory.trim() || "(empty)",
    "",
    "=== PENDING_ACTION ===",
    `tool: ${input.pendingAction.tool}`,
    `input: ${JSON.stringify(input.pendingAction.input, null, 2)}`,
    "",
    "Respond with JSON: {\"tier\": \"low|medium|high\", \"reason\": \"...\"}",
  ].join("\n");
}

/** Parse the LLM reviewer's JSON response into a review result. */
export function parseReviewResponse(
  tool: string,
  response: string,
): AutoReviewResult {
  const match = response.match(/\{[\s\S]*\}/);
  if (!match) {
    // Unparseable reviewer output — fail safe by requiring authorization.
    return {
      tier: "medium",
      decision: "require_authorization",
      reason: "reviewer response unparseable; failing safe",
      rule: "reviewer-parse",
      tool,
    };
  }
  try {
    const parsed = JSON.parse(match[0]) as { tier?: string; reason?: string };
    const tier: RiskTier =
      parsed.tier === "high" ? "high" : parsed.tier === "medium" ? "medium" : "low";
    return {
      tier,
      decision: tier === "high" ? "deny" : tier === "medium" ? "require_authorization" : "allow",
      reason: parsed.reason ?? "reviewer classified the action",
      rule: "llm-reviewer",
      tool,
    };
  } catch {
    return {
      tier: "medium",
      decision: "require_authorization",
      reason: "reviewer response invalid JSON; failing safe",
      rule: "reviewer-parse",
      tool,
    };
  }
}

// Re-export helper used in rule tables for external inspection/tests.
export { KNOWN_LOW_RISK_TOOLS, toolPattern, inputPattern };
