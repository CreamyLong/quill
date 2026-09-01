/**
 * GuardrailProvider protocol and data structures for pre-tool-call authorization.
 */

/** Context passed to the provider for each tool call. */
export interface GuardrailRequest {
  toolName: string;
  toolInput: Record<string, unknown>;
  agentId?: string | null;
  threadId?: string | null;
  isSubagent?: boolean;
  /** ISO-8601 timestamp; defaults to "" when omitted (matches Python dataclass). */
  timestamp?: string;
  userId?: string | null;
  userRole?: string | null;
  oauthProvider?: string | null;
  oauthId?: string | null;
  runId?: string | null;
  toolCallId?: string | null;
  /**
   * Optional metadata carried alongside the request. Used by the annotation
   * middleware to pass tool safety hints (readOnly/destructive/idempotent/
   * openWorld) to the AnnotationProvider.
   */
  metadata?: Record<string, unknown>;
}

/** Structured reason for an allow/deny decision (OAP reason object). */
export interface GuardrailReason {
  code: string;
  /** Defaults to "" when omitted (matches Python dataclass). */
  message?: string;
}

/** Provider's allow/deny verdict (aligned with OAP Decision object). */
export interface GuardrailDecision {
  allow: boolean;
  reasons: GuardrailReason[];
  policyId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Contract for pluggable tool-call authorization.
 *
 * Any class with these methods works - no base class required.
 * Providers are loaded by class path via resolveVariable(),
 * the same mechanism Quill uses for models, tools, and sandbox.
 */
export interface GuardrailProvider {
  name: string;

  /** Evaluate whether a tool call should proceed. */
  evaluate(request: GuardrailRequest): GuardrailDecision;

  /** Async variant. */
  aevaluate(request: GuardrailRequest): Promise<GuardrailDecision>;
}
