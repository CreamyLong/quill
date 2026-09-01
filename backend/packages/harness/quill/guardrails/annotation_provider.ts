/**
 * Tool-annotation-based guardrail provider.
 *
 * Makes authorization decisions based on declared tool safety hints
 * (readOnly/destructive/idempotent/openWorld) rather than inspecting tool
 * inputs. This is the "five-layer permission evaluation" pattern from the
 * awesome-harness-engineering list, simplified to annotation-based policy:
 *
 *   1. Read-only tools → always allowed (lowest risk).
 *   2. Destructive tools → denied unless explicitly allowed by policy.
 *   3. Open-world tools → denied in restricted modes.
 *   4. Idempotent tools → allowed (safe to retry).
 *   5. Unknown (no hints) → falls through to default decision.
 *
 * The provider is stateless and synchronous — it only reads the annotations
 * attached to the request. The middleware is responsible for resolving the
 * tool's annotations and attaching them to the GuardrailRequest.
 */

import type { GuardrailDecision, GuardrailRequest } from "./provider.js";
import {
  EMPTY_ANNOTATIONS,
  computeRiskLevel,
  type ToolAnnotations,
  type ToolRiskLevel,
} from "./annotations.js";

/** Key under which annotations are attached to GuardrailRequest metadata. */
export const ANNOTATIONS_METADATA_KEY = "toolAnnotations";

/** Configuration for the AnnotationProvider. */
export interface AnnotationProviderOptions {
  /**
   * Maximum risk level to allow without explicit approval.
   * Tools at or below this level are allowed; tools above are denied.
   *
   * Default: "medium" (allows readOnly + idempotent, denies openWorld + destructive).
   */
  maxRiskLevel?: ToolRiskLevel;

  /**
   * Tool names that are always allowed regardless of annotations.
   * Use for trusted internal tools (e.g. `ask_clarification`).
   */
  allowlist?: string[];

  /**
   * Tool names that are always denied regardless of annotations.
   * Use for high-risk tools that should never auto-execute.
   */
  denylist?: string[];
}

const RISK_ORDER: Record<ToolRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/**
 * Guardrail provider that decides based on declared tool annotations.
 *
 * Reads annotations from `request.metadata[ANNOTATIONS_METADATA_KEY]`.
 * When no annotations are present, falls back to all-false defaults
 * (medium risk) and applies the maxRiskLevel threshold.
 */
export class AnnotationProvider {
  readonly name = "annotation";
  private readonly _maxRisk: number;
  private readonly _allowlist: Set<string>;
  private readonly _denylist: Set<string>;

  constructor(options: AnnotationProviderOptions = {}) {
    this._maxRisk = RISK_ORDER[options.maxRiskLevel ?? "medium"];
    this._allowlist = new Set(options.allowlist ?? []);
    this._denylist = new Set(options.denylist ?? []);
  }

  evaluate(request: GuardrailRequest): GuardrailDecision {
    // Explicit denylist wins — always deny.
    if (this._denylist.has(request.toolName)) {
      return {
        allow: false,
        policyId: "annotation-policy",
        reasons: [
          {
            code: "oap.tool_denied_by_annotation",
            message: `tool '${request.toolName}' is on the annotation denylist`,
          },
        ],
      };
    }

    // Explicit allowlist wins — always allow.
    if (this._allowlist.has(request.toolName)) {
      return {
        allow: true,
        policyId: "annotation-policy",
        reasons: [{ code: "oap.tool_allowed_by_annotation" }],
      };
    }

    // Resolve annotations from request metadata.
    const raw = (request.metadata as Record<string, unknown> | undefined)?.[
      ANNOTATIONS_METADATA_KEY
    ];
    const annotations: ToolAnnotations =
      raw !== undefined && raw !== null && typeof raw === "object"
        ? (raw as ToolAnnotations)
        : EMPTY_ANNOTATIONS;

    const risk = computeRiskLevel(annotations);
    const riskValue = RISK_ORDER[risk];

    if (riskValue <= this._maxRisk) {
      return {
        allow: true,
        policyId: "annotation-policy",
        reasons: [
          {
            code: "oap.allowed_by_annotation",
            message: `tool risk level '${risk}' is within allowed threshold`,
          },
        ],
      };
    }

    return {
      allow: false,
      policyId: "annotation-policy",
      reasons: [
        {
          code: "oap.tool_risk_too_high",
          message: `tool '${request.toolName}' has risk level '${risk}' which exceeds the allowed threshold`,
        },
      ],
    };
  }

  async aevaluate(request: GuardrailRequest): Promise<GuardrailDecision> {
    return this.evaluate(request);
  }
}
