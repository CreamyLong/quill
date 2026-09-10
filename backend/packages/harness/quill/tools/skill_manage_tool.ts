/**
 * skill_manage tool — agent-driven skill creation, improvement, and deletion.
 *
 * Ports the self-improving skill loop from Hermes Agent: after complex tasks,
 * the agent can persist what it learned as a reusable skill. Every write is
 * gated by the two-phase security scanner (deterministic + LLM) and validated
 * against the SKILL.md frontmatter schema.
 *
 * Operations:
 *   - `create`  — write a new custom skill to `skills/custom/<name>/SKILL.md`
 *   - `patch`   — replace the body of an existing custom skill
 *   - `improve` — alias for `patch` with an explicit "improvement" history label
 *   - `delete`  — remove a custom skill directory
 *
 * The tool is only registered when `skill_evolution.enabled: true` in config.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { getAppConfig } from "../config/app_config.js";
import { getOrNewSkillStorage } from "../skills/storage/index.js";
import { scanSkillContent } from "../skills/security_scanner.js";
import { SKILL_MD_FILE, SkillCategory } from "../skills/types.js";
import { validateSkillFrontmatter } from "../skills/validation.js";

export const SKILL_MANAGE_TOOL_NAME = "skill_manage";

export const SKILL_MANAGE_TOOL_DESCRIPTION = [
  "Create, improve, or delete agent skills in skills/custom/.",
  "Use this after completing complex tasks (5+ tool calls) to persist reusable workflows,",
  "when the user corrects your approach and the corrected version works,",
  "or when you discover a non-obvious, recurring pattern.",
  "Operations: create, patch, improve, delete.",
  "All writes are security-scanned before being committed to disk.",
].join(" ");

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const skillManageSchema = z.object({
  operation: z
    .enum(["create", "patch", "improve", "delete"])
    .describe("The operation to perform: create (new skill), patch/improve (update existing), delete."),
  name: z
    .string()
    .describe("Skill name in hyphen-case (e.g., 'data-analysis-pipeline'). Must match the name in frontmatter."),
  content: z
    .string()
    .optional()
    .describe(
      "Full SKILL.md content with YAML frontmatter (---name: ...\ndescription: ...\n---) and body. " +
        "Required for create, patch, and improve operations."
    ),
  reason: z
    .string()
    .optional()
    .describe("Why this skill is being created or updated. Used for history tracking."),
});

type SkillManageInput = z.infer<typeof skillManageSchema>;

// ---------------------------------------------------------------------------
// Helpers ---------------------------------------------------------------------------

function isCustomSkill(storage: ReturnType<typeof getOrNewSkillStorage>, name: string): boolean {
  try {
    return storage.customSkillExists(name);
  } catch {
    return false;
  }
}

function assertValidSkillName(name: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(
      `Invalid skill name '${name}'. Use hyphen-case: lowercase letters, digits, and hyphens only.`
    );
  }
  if (name.length > 64) {
    throw new Error("Skill name must be 64 characters or fewer.");
  }
}

/**
 * Validate that the content has proper frontmatter and the name matches.
 * Throws on invalid content with a descriptive error message.
 */
function validateSkillContent(name: string, content: string): void {
  if (!content.trim()) {
    throw new Error("Skill content cannot be empty.");
  }
  if (!content.startsWith("---")) {
    throw new Error("Skill content must start with YAML frontmatter (---).");
  }

  // Write to a temp directory and run the full frontmatter validator.
  const tmpDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "quill-skill-validate-"));
  try {
    const skillDir = path.join(tmpDir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, SKILL_MD_FILE), content, { encoding: "utf-8" });

    const [isValid, message, parsedName] = validateSkillFrontmatter(skillDir);
    if (!isValid) {
      throw new Error(`Invalid skill content: ${message}`);
    }
    if (parsedName !== name) {
      throw new Error(
        `Skill name in frontmatter ('${parsedName}') does not match the tool call name ('${name}').`
      );
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Factory ---------------------------------------------------------------------------

export interface SkillManageToolOptions {
  /** Override the app config (for testing). */
  appConfig?: ReturnType<typeof getAppConfig> | null;
  /** Override the security scan (for testing). */
  scanFn?: ((content: string) => Promise<{ decision: string; reason: string }>) | null;
  /** Override the skills root path (for testing). */
  skillsPath?: string | null;
}

/**
 * Build the skill_manage tool.
 *
 * @param options Optional overrides for testing.
 * @returns A StructuredToolInterface for the skill_manage operation.
 */
export function createSkillManageTool(options: SkillManageToolOptions = {}): StructuredToolInterface {
  const scanFn = options.scanFn ?? scanSkillContent;

  return tool(
    async (input: SkillManageInput): Promise<string> => {
      const { operation, name, content, reason } = input;

      // Validate name format.
      try {
        assertValidSkillName(name);
      } catch (e) {
        return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }

      const config = options.appConfig ?? getAppConfig();
      const storageOptions: { appConfig: ReturnType<typeof getAppConfig>; skillsPath?: string } = {
        appConfig: config,
      };
      if (options.skillsPath) {
        storageOptions.skillsPath = options.skillsPath;
      }
      const storage = getOrNewSkillStorage(storageOptions);

      // Route to the appropriate operation.
      switch (operation) {
        case "create":
          return handleCreate(storage, name, content, reason, scanFn);
        case "patch":
        case "improve":
          return handlePatch(storage, name, content, reason, operation, scanFn);
        case "delete":
          return handleDelete(storage, name, reason);
        default:
          return JSON.stringify({ ok: false, error: `Unknown operation: ${operation}` });
      }
    },
    {
      name: SKILL_MANAGE_TOOL_NAME,
      description: SKILL_MANAGE_TOOL_DESCRIPTION,
      schema: skillManageSchema,
    }
  );
}

// ---------------------------------------------------------------------------
// Operation handlers ----------------------------------------------------------------

async function handleCreate(
  storage: ReturnType<typeof getOrNewSkillStorage>,
  name: string,
  content: string | undefined,
  reason: string | undefined,
  scanFn: (content: string) => Promise<{ decision: string; reason: string }>
): Promise<string> {
  if (!content) {
    return JSON.stringify({ ok: false, error: "Content is required for 'create' operation." });
  }

  // Check if skill already exists.
  if (isCustomSkill(storage, name)) {
    return JSON.stringify({
      ok: false,
      error: `Skill '${name}' already exists. Use 'patch' or 'improve' to update it.`,
    });
  }

  // Validate content structure.
  try {
    validateSkillContent(name, content);
  } catch (e) {
    return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }

  // Security scan.
  const scanResult = await scanFn(content);
  if (scanResult.decision === "block") {
    return JSON.stringify({
      ok: false,
      error: `Security scan blocked: ${scanResult.reason}`,
    });
  }

  // Write the skill.
  try {
    storage.writeCustomSkill(name, SKILL_MD_FILE, content);
    storage.appendHistory(name, {
      operation: "create",
      reason: reason ?? "Agent-created skill",
      scan_decision: scanResult.decision,
    });

    return JSON.stringify({
      ok: true,
      message: `Skill '${name}' created successfully at custom/${name}/${SKILL_MD_FILE}.`,
      skill_name: name,
      location: `custom/${name}/${SKILL_MD_FILE}`,
      scan_decision: scanResult.decision,
    });
  } catch (e) {
    return JSON.stringify({
      ok: false,
      error: `Failed to write skill: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

async function handlePatch(
  storage: ReturnType<typeof getOrNewSkillStorage>,
  name: string,
  content: string | undefined,
  reason: string | undefined,
  operation: "patch" | "improve",
  scanFn: (content: string) => Promise<{ decision: string; reason: string }>
): Promise<string> {
  if (!content) {
    return JSON.stringify({ ok: false, error: `Content is required for '${operation}' operation.` });
  }

  // Check that the skill exists and is custom (not built-in).
  if (!isCustomSkill(storage, name)) {
    return JSON.stringify({
      ok: false,
      error: `Custom skill '${name}' not found. Use 'create' to make a new skill.`,
    });
  }

  // Validate content structure.
  try {
    validateSkillContent(name, content);
  } catch (e) {
    return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }

  // Security scan.
  const scanResult = await scanFn(content);
  if (scanResult.decision === "block") {
    return JSON.stringify({
      ok: false,
      error: `Security scan blocked: ${scanResult.reason}`,
    });
  }

  // Read previous content for history.
  let prevContent = "";
  try {
    prevContent = storage.readCustomSkill(name);
  } catch {
    // Ignore read errors for history.
  }

  // Write the updated skill.
  try {
    storage.writeCustomSkill(name, SKILL_MD_FILE, content);
    storage.appendHistory(name, {
      operation,
      reason: reason ?? "Agent-updated skill",
      scan_decision: scanResult.decision,
      prev_content: prevContent,
    });

    return JSON.stringify({
      ok: true,
      message: `Skill '${name}' ${operation}d successfully.`,
      skill_name: name,
      location: `custom/${name}/${SKILL_MD_FILE}`,
      scan_decision: scanResult.decision,
    });
  } catch (e) {
    return JSON.stringify({
      ok: false,
      error: `Failed to write skill: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

function handleDelete(
  storage: ReturnType<typeof getOrNewSkillStorage>,
  name: string,
  reason: string | undefined
): string {
  if (!isCustomSkill(storage, name)) {
    return JSON.stringify({
      ok: false,
      error: `Custom skill '${name}' not found. Only custom skills can be deleted.`,
    });
  }

  try {
    storage.deleteCustomSkill(name, {
      operation: "delete",
      reason: reason ?? "Agent-deleted skill",
    });

    return JSON.stringify({
      ok: true,
      message: `Skill '${name}' deleted successfully.`,
      skill_name: name,
    });
  } catch (e) {
    return JSON.stringify({
      ok: false,
      error: `Failed to delete skill: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
