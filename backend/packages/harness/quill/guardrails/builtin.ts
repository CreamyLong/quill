/**
 * Built-in guardrail providers that ship with Quill.
 */

import type { GuardrailDecision, GuardrailRequest } from "./provider.js";

export interface AllowlistProviderOptions {
  allowedTools?: string[];
  deniedTools?: string[];
}

/** One command-policy rule (Codex exec-policy style). */
export interface CommandRule {
  /** Tool name the rule applies to; `"*"` or omitted = all tools. */
  tool?: string;
  /** Regular-expression source matched against the target string. */
  pattern: string;
  effect: "allow" | "deny";
  /** Human-readable reason surfaced in the denial message. */
  description?: string;
}

export interface CommandPolicyProviderOptions {
  /** Ordered rules. Deny rules are evaluated before allow rules. */
  rules?: CommandRule[];
  /**
   * Tool-input field whose value the patterns match against. Defaults to
   * `"command"` (the `bash` tool's command string).
   */
  targetField?: string;
  /** Case-sensitive matching. Defaults to false. */
  caseSensitive?: boolean;
  /** Decision when no rule matches. Defaults to `"allow"`. */
  defaultDecision?: "allow" | "deny";
}

interface CompiledRule {
  tool: string | null;
  re: RegExp;
  effect: "allow" | "deny";
  description: string | null;
}

/**
 * Command-level allow/deny policy for shell-like tools (Codex `exec-policy`
 * style).
 *
 * Unlike {@link AllowlistProvider}, which only sees the tool *name*, this
 * provider inspects the tool *input* (by default the `command` field) and
 * matches it against ordered regex rules. Semantics:
 *
 *   1. Collect rules whose `tool` matches the called tool (`"*"` matches all).
 *   2. Deny rules are evaluated first — the first match denies the call
 *      (code `oap.command_denied`).
 *   3. Otherwise allow rules are evaluated — the first match allows it
 *      explicitly (code `oap.command_allowed`).
 *   4. No rule matched → `defaultDecision` (default: allow, code
 *      `oap.allowed` / `oap.command_not_allowed`).
 *
 * Tools whose input has no string value for `targetField` are left to the
 * default decision, so the policy never blocks non-shell tools by accident.
 */
export class CommandPolicyProvider {
  readonly name = "command_policy";
  private readonly _rules: CompiledRule[];
  private readonly _denyRules: CompiledRule[];
  private readonly _allowRules: CompiledRule[];
  private readonly _targetField: string;
  private readonly _defaultDecision: "allow" | "deny";

  constructor(options: CommandPolicyProviderOptions = {}) {
    const rawRules = options.rules ?? [];
    this._rules = rawRules.map((rule, i) => {
      if (typeof rule.pattern !== "string" || rule.pattern.length === 0) {
        throw new Error(`Command policy rule #${i}: 'pattern' must be a non-empty regex source string`);
      }
      if (rule.effect !== "allow" && rule.effect !== "deny") {
        throw new Error(`Command policy rule #${i}: 'effect' must be "allow" or "deny"`);
      }
      let re: RegExp;
      try {
        re = new RegExp(rule.pattern, options.caseSensitive ? "" : "i");
      } catch (err) {
        throw new Error(
          `Command policy rule #${i}: invalid regex '${rule.pattern}': ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      const tool = rule.tool ?? "*";
      return {
        tool: tool === "*" ? null : tool,
        re,
        effect: rule.effect,
        description: rule.description ?? null,
      };
    });
    this._denyRules = this._rules.filter((r) => r.effect === "deny");
    this._allowRules = this._rules.filter((r) => r.effect === "allow");
    this._targetField = options.targetField ?? "command";
    this._defaultDecision = options.defaultDecision ?? "allow";
  }

  private toolMatches(rule: CompiledRule, toolName: string): boolean {
    return rule.tool === null || rule.tool === toolName;
  }

  evaluate(request: GuardrailRequest): GuardrailDecision {
    const raw = request.toolInput?.[this._targetField];
    if (raw === undefined || raw === null) {
      // No target value (e.g. a tool without a command field) → default.
      return this.defaultDecision();
    }
    const target = typeof raw === "string" ? raw : String(raw);
    if (target.length === 0) {
      return this.defaultDecision();
    }

    for (const rule of this._denyRules) {
      if (this.toolMatches(rule, request.toolName) && rule.re.test(target)) {
        return {
          allow: false,
          policyId: "command-policy",
          reasons: [
            {
              code: "oap.command_denied",
              message: rule.description ?? `command matches deny pattern '${rule.re.source}'`,
            },
          ],
        };
      }
    }
    for (const rule of this._allowRules) {
      if (this.toolMatches(rule, request.toolName) && rule.re.test(target)) {
        return {
          allow: true,
          policyId: "command-policy",
          reasons: [
            {
              code: "oap.command_allowed",
              message: rule.description ?? `command matches allow pattern '${rule.re.source}'`,
            },
          ],
        };
      }
    }
    return this.defaultDecision();
  }

  private defaultDecision(): GuardrailDecision {
    if (this._defaultDecision === "deny") {
      return {
        allow: false,
        policyId: "command-policy",
        reasons: [{ code: "oap.command_not_allowed", message: "no matching allow rule (default deny)" }],
      };
    }
    return { allow: true, reasons: [{ code: "oap.allowed" }] };
  }

  async aevaluate(request: GuardrailRequest): Promise<GuardrailDecision> {
    return this.evaluate(request);
  }
}

/**
 * Simple allowlist/denylist provider. No external dependencies.
 */
export class AllowlistProvider {
  readonly name = "allowlist";
  private readonly _allowed: Set<string> | null;
  private readonly _denied: Set<string>;

  constructor(options: AllowlistProviderOptions = {}) {
    this._allowed = options.allowedTools ? new Set(options.allowedTools) : null;
    this._denied = options.deniedTools ? new Set(options.deniedTools) : new Set();
  }

  evaluate(request: GuardrailRequest): GuardrailDecision {
    if (this._allowed !== null && !this._allowed.has(request.toolName)) {
      return {
        allow: false,
        reasons: [
          {
            code: "oap.tool_not_allowed",
            message: `tool '${request.toolName}' not in allowlist`,
          },
        ],
      };
    }
    if (this._denied.has(request.toolName)) {
      return {
        allow: false,
        reasons: [
          {
            code: "oap.tool_not_allowed",
            message: `tool '${request.toolName}' is denied`,
          },
        ],
      };
    }
    return {
      allow: true,
      reasons: [{ code: "oap.allowed" }],
    };
  }

  async aevaluate(request: GuardrailRequest): Promise<GuardrailDecision> {
    return this.evaluate(request);
  }
}
