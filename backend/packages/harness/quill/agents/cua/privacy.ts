/**
 * PrivacyGuard — fail-closed privacy for computer use actions.
 *
 * Inspired by ZCode's "fail-closed privacy design": when in doubt, block the
 * action and ask the user. No sensitive action proceeds without explicit
 * approval.
 *
 * Privacy levels:
 * - allowed: action proceeds without prompt
 * - confirm: action requires user confirmation
 * - blocked: action is denied by policy
 */

export type PrivacyLevel = "allowed" | "confirm" | "blocked";

export interface PrivacyRule {
  /** Action type this rule applies to. */
  actionType: string;
  /** Privacy level for this action. */
  level: PrivacyLevel;
  /** Optional pattern match (e.g., file path glob). */
  pattern?: RegExp;
  /** Human-readable reason for this rule. */
  reason: string;
}

export interface PrivacyDecision {
  /** Whether the action is allowed. */
  allowed: boolean;
  /** Whether explicit user confirmation is required. */
  needsConfirmation: boolean;
  /** The matched rule (if any). */
  matchedRule?: PrivacyRule;
  /** Reason string for UI display. */
  reason: string;
}

const DEFAULT_RULES: PrivacyRule[] =
  // File operations — reading is allowed, writing needs confirmation.
  [
    { actionType: "file.read", level: "allowed", reason: "Read-only file access" },
    { actionType: "file.write", level: "confirm", reason: "File modification requires approval" },
    { actionType: "file.delete", level: "confirm", reason: "File deletion requires approval" },
    {
      actionType: "file.read",
      level: "blocked",
      pattern: /\.env|credentials|secrets|token|password|keyfile/i,
      reason: "Access to sensitive files is blocked",
    },
    // Shell commands.
    { actionType: "shell.exec", level: "confirm", reason: "Shell execution requires approval" },
    {
      actionType: "shell.exec",
      level: "blocked",
      pattern: /rm\s+-rf\s+\/|sudo\s|chmod\s+777|mkfs|dd\s+if=/i,
      reason: "Dangerous command blocked by policy",
    },
    // Browser actions.
    { actionType: "browser.navigate", level: "allowed", reason: "Navigation is generally safe" },
    { actionType: "browser.click", level: "confirm", reason: "Clicking may trigger state changes" },
    { actionType: "browser.fill", level: "confirm", reason: "Form filling may submit data" },
    // Network.
    { actionType: "network.request", level: "confirm", reason: "External network requests require approval" },
    // System.
    { actionType: "system.clipboard", level: "confirm", reason: "Clipboard access requires approval" },
    { actionType: "system.notification", level: "allowed", reason: "Notifications are safe" },
  ];

export class PrivacyGuard {
  private rules: PrivacyRule[];
  private userOverrides = new Map<string, PrivacyLevel>();

  constructor(rules?: PrivacyRule[]) {
    this.rules = rules ?? [...DEFAULT_RULES];
  }

  /**
   * Evaluate an action against privacy rules.
   *
   * Returns a decision indicating whether the action is allowed and whether
   * user confirmation is required.
   */
  evaluate(
    actionType: string,
    detail?: string,
    userId?: string,
  ): PrivacyDecision {
    // Check user overrides first.
    const overrideKey = `${actionType}:${detail ?? ""}`;
    const userOverride = this.userOverrides.get(overrideKey);
    if (userOverride) {
      return decisionFromLevel(userOverride, {
        actionType,
        level: userOverride,
        reason: "User override",
      });
    }

    // Find matching rules (more specific patterns first).
    const matches = this.rules
      .filter((r) => {
        if (r.actionType !== actionType) return false;
        if (r.pattern && detail) return r.pattern.test(detail);
        if (!r.pattern) return true;
        return false;
      })
      .sort((a, b) => (b.pattern ? 1 : 0) - (a.pattern ? 1 : 0));

    // Use the most specific match (first after sort).
    const rule = matches[0];
    if (!rule) {
      // No rule matched — fail closed.
      return {
        allowed: false,
        needsConfirmation: false,
        reason: `No privacy rule for action "${actionType}" — blocked by default`,
      };
    }

    return decisionFromLevel(rule.level, rule);
  }

  /** Add a custom privacy rule. */
  addRule(rule: PrivacyRule): void {
    this.rules.push(rule);
  }

  /** Set a user-level override. */
  setOverride(actionType: string, detail: string, level: PrivacyLevel): void {
    this.userOverrides.set(`${actionType}:${detail}`, level);
  }

  /** Get all active rules. */
  getRules(): PrivacyRule[] {
    return [...this.rules];
  }
}

function decisionFromLevel(
  level: PrivacyLevel,
  rule: PrivacyRule,
): PrivacyDecision {
  switch (level) {
    case "allowed":
      return {
        allowed: true,
        needsConfirmation: false,
        matchedRule: rule,
        reason: rule.reason,
      };
    case "confirm":
      return {
        allowed: true,
        needsConfirmation: true,
        matchedRule: rule,
        reason: rule.reason,
      };
    case "blocked":
      return {
        allowed: false,
        needsConfirmation: false,
        matchedRule: rule,
        reason: rule.reason,
      };
  }
}
