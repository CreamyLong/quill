/**
 * CuaBroker — orchestrates computer use actions with privacy and audit.
 *
 * The broker sits between the agent's tool calls and the actual system
 * operations. Every action passes through:
 * 1. Privacy evaluation (fail-closed)
 * 2. User confirmation (if required)
 * 3. Execution (if allowed)
 * 4. Audit logging (always)
 *
 * Inspired by ZCode's CUA broker architecture with fail-closed privacy.
 */

import { PrivacyGuard, type PrivacyDecision } from "./privacy.js";
import { CuaAuditLog, type AuditActionStatus } from "./audit.js";

export type CuaActionType =
  | "file.read"
  | "file.write"
  | "file.delete"
  | "shell.exec"
  | "browser.navigate"
  | "browser.click"
  | "browser.fill"
  | "network.request"
  | "system.clipboard"
  | "system.notification";

export interface CuaAction {
  type: CuaActionType;
  detail?: string;
  arguments?: Record<string, unknown>;
}

export interface CuaResult {
  /** Whether the action was executed. */
  executed: boolean;
  /** Whether it was blocked. */
  blocked: boolean;
  /** Whether confirmation is pending. */
  pendingConfirmation: boolean;
  /** The action output (if executed). */
  output?: unknown;
  /** Error message (if failed). */
  error?: string;
  /** Privacy reason. */
  reason: string;
  /** Audit entry ID. */
  auditId?: string;
}

export interface CuaBrokerOptions {
  /** Custom privacy rules. */
  privacyRules?: ConstructorParameters<typeof PrivacyGuard>[0];
  /** Maximum audit entries. */
  maxAuditEntries?: number;
  /** Function to request user confirmation. */
  requestConfirmation?: (
    action: CuaAction,
    decision: PrivacyDecision,
  ) => Promise<boolean>;
  /** Session ID for audit context. */
  sessionId?: string;
}

export class CuaBroker {
  private privacy: PrivacyGuard;
  private audit: CuaAuditLog;
  private requestConfirmation: NonNullable<CuaBrokerOptions["requestConfirmation"]>;
  private sessionId?: string;

  constructor(options: CuaBrokerOptions = {}) {
    this.privacy = new PrivacyGuard(options.privacyRules);
    this.audit = new CuaAuditLog(options.maxAuditEntries);
    this.requestConfirmation = options.requestConfirmation ?? (() => Promise.resolve(false));
    this.sessionId = options.sessionId;
  }

  /**
   * Process a computer use action through the broker pipeline.
   *
   * 1. Evaluate privacy policy
   * 2. If confirmation needed, request it
   * 3. Execute if allowed
   * 4. Log to audit
   */
  async process(action: CuaAction): Promise<CuaResult> {
    // Step 1: Privacy evaluation.
    const decision = this.privacy.evaluate(action.type, action.detail);

    if (!decision.allowed) {
      // Blocked by policy — log and return.
      const auditEntry = this.audit.record({
        actionType: action.type,
        detail: action.detail,
        status: "blocked",
        reason: decision.reason,
        sessionId: this.sessionId,
      });
      return {
        executed: false,
        blocked: true,
        pendingConfirmation: false,
        reason: decision.reason,
        auditId: auditEntry.id,
      };
    }

    // Step 2: User confirmation if required.
    if (decision.needsConfirmation) {
      const confirmed = await this.requestConfirmation(action, decision);
      if (!confirmed) {
        const auditEntry = this.audit.record({
          actionType: action.type,
          detail: action.detail,
          status: "blocked",
          reason: "User declined confirmation",
          sessionId: this.sessionId,
        });
        return {
          executed: false,
          blocked: true,
          pendingConfirmation: false,
          reason: "User declined the action",
          auditId: auditEntry.id,
        };
      }
    }

    // Step 3: Execute (delegate to sandbox or system).
    try {
      const output = await this.execute(action);
      const auditEntry = this.audit.record({
        actionType: action.type,
        detail: action.detail,
        status: decision.needsConfirmation ? "confirmed" : "allowed",
        reason: decision.reason,
        sessionId: this.sessionId,
      });
      return {
        executed: true,
        blocked: false,
        pendingConfirmation: false,
        output,
        reason: decision.reason,
        auditId: auditEntry.id,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const auditEntry = this.audit.record({
        actionType: action.type,
        detail: action.detail,
        status: "failed",
        reason: error,
        sessionId: this.sessionId,
        error,
      });
      return {
        executed: false,
        blocked: false,
        pendingConfirmation: false,
        error,
        reason: error,
        auditId: auditEntry.id,
      };
    }
  }

  /**
   * Check if an action would be allowed without executing it.
   */
  preview(action: CuaAction): PrivacyDecision {
    return this.privacy.evaluate(action.type, action.detail);
  }

  /** Get the audit log for inspection. */
  getAuditLog(): CuaAuditLog {
    return this.audit;
  }

  /** Get the privacy guard for rule management. */
  getPrivacyGuard(): PrivacyGuard {
    return this.privacy;
  }

  // ------------------------------------------------------------------
  // Execution
  // ------------------------------------------------------------------

  private async execute(action: CuaAction): Promise<unknown> {
    // In a full implementation, this delegates to the sandbox or native
    // desktop bridge. Here we return a structured acknowledgment.
    return {
      action: action.type,
      detail: action.detail,
      executed: true,
      timestamp: new Date().toISOString(),
    };
  }
}
