/**
 * Tool annotations — structured safety metadata that tools declare about
 * themselves.
 *
 * Port of OpenAI Codex's tool annotations + the awesome-harness-engineering
 * "Tool Annotations" best practice. Tools optionally declare whether they are
 * read-only, destructive, idempotent, or open-world. Guardrail providers and
 * the annotation middleware consume these hints to make authorization
 * decisions without inspecting tool inputs.
 *
 * The four hints mirror the MCP tool annotations spec
 * (modelcontextprotocol.io) so MCP-sourced tools can carry their annotations
 * through unchanged.
 */

/** Safety hints a tool may declare about its behavior. */
export interface ToolAnnotations {
  /**
   * Tool only reads state — never modifies files, databases, or external
   * systems. Read-only tools are the lowest-risk class and can be allowed
   * through even restrictive guardrail policies.
   */
  readOnlyHint: boolean;
  /**
   * Tool may irreversibly destroy or overwrite data (e.g. `write_file`,
   * `str_replace`, `bash` with rm). Destructive tools may require explicit
   * approval or additional policy checks.
   */
  destructiveHint: boolean;
  /**
   * Repeated calls with the same input produce the same effect as a single
   * call. Idempotent tools are safe to retry on transient failures without
   * side-effect amplification.
   */
  idempotentHint: boolean;
  /**
   * Tool interacts with external systems beyond the agent's sandbox (network
   * calls, third-party APIs, cloud services). Open-world tools carry data
   * exfiltration and unexpected-cost risk.
   */
  openWorldHint: boolean;
}

/** All-false default — a tool that declares nothing is assumed to have no special safety properties. */
export const EMPTY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

/** A tool annotated with its safety hints. */
export interface AnnotatedTool {
  /** Tool name as registered in the agent's tool catalog. */
  toolName: string;
  /** Safety hints declared by the tool (or all-false defaults). */
  annotations: ToolAnnotations;
}

/**
 * Compute a composite risk level from annotations.
 *
 * Risk ordering (low → high): readOnly < idempotent < openWorld < destructive.
 * A tool is classified by its highest-severity true hint.
 */
export type ToolRiskLevel = "low" | "medium" | "high" | "critical";

export function computeRiskLevel(annotations: ToolAnnotations): ToolRiskLevel {
  if (annotations.destructiveHint) return "critical";
  if (annotations.openWorldHint) return "high";
  if (annotations.idempotentHint) return "medium";
  if (annotations.readOnlyHint) return "low";
  // No hints declared — treat as medium (unknown risk).
  return "medium";
}

/**
 * Merge caller-supplied annotations over defaults.
 *
 * Used by the annotation resolver when a tool declares only some hints.
 */
export function mergeAnnotations(
  defaults: ToolAnnotations,
  overrides: Partial<ToolAnnotations>,
): ToolAnnotations {
  return { ...defaults, ...overrides };
}

/**
 * Validate a partial annotations object, coercing unknown/undefined values
 * to the safe default (false).
 */
export function normalizeAnnotations(
  input: Record<string, unknown> | null | undefined,
): ToolAnnotations {
  if (!input || typeof input !== "object") return { ...EMPTY_ANNOTATIONS };
  return {
    readOnlyHint: Boolean(input.readOnlyHint),
    destructiveHint: Boolean(input.destructiveHint),
    idempotentHint: Boolean(input.idempotentHint),
    openWorldHint: Boolean(input.openWorldHint),
  };
}
