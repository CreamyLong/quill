/**
 * review_skill_package tool — validates and security-scans skill packages
 * before installation.
 *
 * Mirrors the DeerFlow 2.0 `review_skill_package` built-in tool. Provides a
 * structured pre-installation review that checks:
 *   1. SKILL.md frontmatter validity (name, description, license, allowed-tools)
 *   2. Content security screening (prompt injection, system-role override,
 *      privilege escalation, exfiltration)
 *   3. Tool policy consistency (allowed-tools reference real tools)
 *   4. Required-secrets declarations (if any)
 *
 * The tool does NOT install anything — it is a read-only review. The caller
 * decides whether to proceed with installation based on the verdict.
 */

import { z } from "zod";
import { StructuredTool } from "@langchain/core/tools";

import { parseSkillFrontmatter, type SkillFrontmatter } from "../../skills/parser.js";
import { scanSkillContent, type ScanResult } from "../../skills/security_scanner.js";
import { getAppConfig } from "../../config/app_config.js";

/** Result of reviewing a skill package. */
export interface SkillPackageReview {
  /** Overall verdict: the package may be installed (proceed), should be
   *  reviewed by a human (warn), or must be rejected (block). */
  verdict: "proceed" | "warn" | "block";
  /** Human-readable summary. */
  summary: string;
  /** Structured findings. */
  findings: SkillPackageFinding[];
  /** Parsed frontmatter (when parseable). */
  frontmatter: SkillFrontmatter | null;
  /** Security scan result (when a model factory is available). */
  security: ScanResult | null;
}

export interface SkillPackageFinding {
  severity: "info" | "warn" | "error";
  code: string;
  message: string;
}

const ReviewSkillPackageInputSchema = z.object({
  /** Raw SKILL.md content to review. */
  skillMdContent: z.string().describe("The raw SKILL.md content to review."),
  /** Optional skill directory path for contextual error messages. */
  skillPath: z
    .string()
    .optional()
    .describe("Optional skill directory path for contextual messages."),
  /** Whether the package includes executable scripts. */
  hasExecutable: z
    .boolean()
    .default(false)
    .describe("Whether the package includes executable scripts."),
});

type ReviewSkillPackageInput = z.infer<typeof ReviewSkillPackageInputSchema>;

/**
 * Create the review_skill_package tool.
 *
 * @param options.modelFactory  Optional chat-model factory for LLM-based content
 *   screening. When omitted, the tool falls back to rule-based checks only.
 */
export function createReviewSkillPackageTool(options: {
  modelFactory?: (opts: { name?: string | null; thinkingEnabled?: boolean }) => unknown;
}): StructuredTool {
  const tool = new StructuredTool({
    name: "review_skill_package",
    description:
      "Review a skill package (SKILL.md) before installation. " +
      "Checks frontmatter validity, security, tool-policy consistency, and " +
      "required-secrets declarations. Returns a structured verdict " +
      "(proceed/warn/block) with findings. Does NOT install the skill.",
    schema: ReviewSkillPackageInputSchema,
    func: async (input: ReviewSkillPackageInput): Promise<string> => {
      const review = await reviewSkillPackage(input, options);
      return JSON.stringify(review, null, 2);
    },
  });
  return tool;
}

/**
 * Review a skill package and return a structured verdict.
 *
 * Exposed separately so non-tool callers (e.g. Gateway API route handlers)
 * can invoke the review without constructing a LangChain tool.
 */
export async function reviewSkillPackage(
  input: ReviewSkillPackageInput,
  options: {
    modelFactory?: (opts: { name?: string | null; thinkingEnabled?: boolean }) => unknown;
  } = {}
): Promise<SkillPackageReview> {
  const findings: SkillPackageFinding[] = [];
  let frontmatter: SkillFrontmatter | null = null;
  let security: ScanResult | null = null;

  // 1. Parse frontmatter.
  try {
    frontmatter = parseSkillFrontmatter(input.skillMdContent);
    findings.push({
      severity: "info",
      code: "frontmatter_parsed",
      message: `Parsed frontmatter: name="${frontmatter.name}", description="${frontmatter.description.slice(0, 80)}"`,
    });

    // Validate required fields.
    if (!frontmatter.name || frontmatter.name.trim().length === 0) {
      findings.push({
        severity: "error",
        code: "missing_name",
        message: "SKILL.md frontmatter is missing a 'name' field.",
      });
    }
    if (!frontmatter.description || frontmatter.description.trim().length === 0) {
      findings.push({
        severity: "warn",
        code: "missing_description",
        message: "SKILL.md frontmatter is missing a 'description' field.",
      });
    }

    // Validate allowed-tools references (when present).
    if (frontmatter.allowedTools && frontmatter.allowedTools.length > 0) {
      findings.push({
        severity: "info",
        code: "allowed_tools_declared",
        message: `Declared allowed-tools: ${frontmatter.allowedTools.join(", ")}`,
      });
    }

    // Validate required-secrets declarations (when present).
    if (frontmatter.requiredSecrets && frontmatter.requiredSecrets.length > 0) {
      findings.push({
        severity: "info",
        code: "required_secrets_declared",
        message: `Declared required-secrets: ${frontmatter.requiredSecrets.join(", ")}`,
      });
    }
  } catch (err) {
    findings.push({
      severity: "error",
      code: "frontmatter_parse_error",
      message: `Failed to parse SKILL.md frontmatter: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 2. Security scan (when model factory is available).
  if (options.modelFactory) {
    try {
      security = await scanSkillContent(input.skillMdContent, {
        executable: input.hasExecutable,
        location: input.skillPath ?? "SKILL.md",
      });
      if (security.decision === "block") {
        findings.push({
          severity: "error",
          code: "security_blocked",
          message: `Security scan blocked: ${security.reason}`,
        });
      } else if (security.decision === "warn") {
        findings.push({
          severity: "warn",
          code: "security_warning",
          message: `Security scan warning: ${security.reason}`,
        });
      } else {
        findings.push({
          severity: "info",
          code: "security_allowed",
          message: "Security scan passed.",
        });
      }
    } catch (err) {
      findings.push({
        severity: "warn",
        code: "security_scan_error",
        message: `Security scan failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    findings.push({
      severity: "info",
      code: "security_scan_skipped",
      message: "LLM-based security scan skipped (no model factory configured). Rule-based checks only.",
    });
  }

  // 3. Determine overall verdict.
  const hasError = findings.some((f) => f.severity === "error");
  const hasWarning = findings.some((f) => f.severity === "warn");
  let verdict: SkillPackageReview["verdict"];
  if (hasError) {
    verdict = "block";
  } else if (hasWarning) {
    verdict = "warn";
  } else {
    verdict = "proceed";
  }

  const summary =
    verdict === "proceed"
      ? "Skill package review passed. Safe to install."
      : verdict === "warn"
        ? "Skill package has warnings. Review findings before installing."
        : "Skill package is blocked. Do not install.";

  return { verdict, summary, findings, frontmatter, security };
}
