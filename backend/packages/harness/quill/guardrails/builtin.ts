/**
 * Built-in guardrail providers that ship with Quill.
 */

import type { GuardrailDecision, GuardrailRequest } from "./provider.js";

export interface AllowlistProviderOptions {
  allowedTools?: string[];
  deniedTools?: string[];
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
