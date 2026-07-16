/**
 * update_agent tool — persist updates to a custom agent's SOUL.md / config.yaml.
 *
 * Mirrors Python `deerflow.tools.builtins.update_agent_tool`. Allows a custom
 * agent to self-update its personality, description, skill whitelist, tool-group
 * whitelist, or default model during a normal conversation.
 *
 * Safety mechanisms:
 *  - Disabled on webhook channels (e.g. github) to prevent unauthorised
 *    self-mutation from external commenters.
 *  - Per-user isolation — updates can only affect the current user's agent.
 *  - Model name is validated against the configured models before writing.
 *  - Atomic write strategy: all updates are staged as `.tmp` files first,
 *    then renamed into place. If staging fails for any file, no file is replaced.
 *  - Non-managed fields (e.g. the `github:` webhook binding block) are
 *    preserved across updates.
 */

import fs from "node:fs";
import path from "node:path";
import type { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import YAML from "yaml";

import { validateAgentName, SOUL_FILENAME } from "../../config/agents_config.js";
import type { Paths } from "../../config/paths.js";
import { getPaths } from "../../config/paths.js";
import { resolveRuntimeUserId } from "../../runtime/user_context.js";
import type { AppConfig } from "../../config/app_config.js";
import { getAppConfig } from "../../config/app_config.js";

const updateAgentSchema = z.object({
  soul: z
    .string()
    .optional()
    .describe("Full replacement SOUL.md content. Start from the current SOUL and apply edits."),
  description: z
    .string()
    .optional()
    .describe("Updated one-line description."),
  skills: z
    .array(z.string())
    .optional()
    .describe("Updated skill whitelist. [] = no skills, omit = keep existing."),
  tool_groups: z
    .array(z.string())
    .optional()
    .describe("Updated tool-group whitelist. [] = empty, omit = keep existing."),
  model: z
    .string()
    .optional()
    .describe("Updated model override (must match a configured model name)."),
});

/**
 * Load raw config data from an agent directory using injected paths.
 *
 * This bypasses `loadAgentConfig()` (which uses the global `getPaths()`
 * singleton) so the tool can be tested with a temp directory via the
 * `getPaths` dep.
 */
function loadRawConfig(agentDir: string): Record<string, unknown> {
  const configFile = path.join(agentDir, "config.yaml");
  if (!fs.existsSync(configFile)) {
    throw new Error(`Agent config not found: ${configFile}`);
  }
  const data = YAML.parse(fs.readFileSync(configFile, "utf-8")) as Record<string, unknown> | null | undefined;
  return data ?? {};
}

/** Channels where self-mutation is disabled (mirrors _WEBHOOK_CHANNELS). */
const _UNTRUSTED_CHANNELS = new Set<string>(["github"]);

/** Managed config fields — anything else is preserved as-is. */
const _MANAGED_FIELDS = new Set(["name", "description", "model", "tool_groups", "skills"]);

export interface UpdateAgentToolDeps {
  /** Override getPaths() for testing with a temp directory. */
  getPaths?: () => Paths;
  /** Override getAppConfig() for testing. */
  getAppConfig?: () => AppConfig;
}

/**
 * Stage text to a `.tmp` file alongside the target. Returns the temp path.
 */
function stageTemp(target: string, content: string): string {
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, content, "utf-8");
  return tmp;
}

/**
 * Remove staged `.tmp` files, swallowing errors (best-effort cleanup).
 */
function cleanupTemps(paths: string[]): void {
  for (const p of paths) {
    try {
      fs.unlinkSync(p);
    } catch {
      // best-effort — ignore if the temp file doesn't exist
    }
  }
}

/**
 * Copy over non-managed fields from the existing config so hand-authored
 * fields (e.g. github: bindings) survive an update.
 */
function preserveNonManagedFields(
  existing: Record<string, unknown>,
  updated: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(existing)) {
    if (!_MANAGED_FIELDS.has(key) && !(key in updated)) {
      updated[key] = value;
    }
  }
}

/**
 * Create the update_agent tool.
 *
 * The tool reads `agent_name`, `user_id`, and `channel_name` from LangChain's
 * RunnableConfig (the TypeScript equivalent of Python's `runtime.context`).
 */
export function createUpdateAgentTool(deps: UpdateAgentToolDeps = {}): StructuredToolInterface {
  const getPathsFn = deps.getPaths ?? getPaths;
  const getAppConfigFn = deps.getAppConfig ?? getAppConfig;

  return tool(
    async (
      input: z.infer<typeof updateAgentSchema>,
      config?: RunnableConfig,
    ): Promise<string> => {
      const cfg = config?.configurable as Record<string, unknown> | undefined;
      const agentName = (cfg?.["agent_name"] as string | null) ?? null;

      // Webhook channel gate — self-mutation must come from a trusted surface.
      const channelName = (cfg?.["channel_name"] as string | null) ?? null;
      if (channelName && _UNTRUSTED_CHANNELS.has(channelName)) {
        return JSON.stringify({
          ok: false,
          error:
            `update_agent is disabled on the '${channelName}' channel. ` +
            "Self-mutation requests must come from an operator-trusted surface " +
            "(chat UI or the HTTP API), not a webhook fan-out.",
        });
      }

      // Only custom agents can self-update.
      if (!agentName) {
        return JSON.stringify({
          ok: false,
          error: "update_agent requires a custom agent (agent_name is not set in runtime context).",
        });
      }

      const validated = validateAgentName(agentName);
      if (validated === null) {
        return JSON.stringify({
          ok: false,
          error: `Invalid agent name '${agentName}'.`,
        });
      }

      const userId = resolveRuntimeUserId({ context: cfg });
      const paths = getPathsFn();
      const agentDir = paths.userAgentDir(userId, validated);

      // Verify the agent directory exists.
      if (!fs.existsSync(agentDir)) {
        return JSON.stringify({
          ok: false,
          error: `Agent '${validated}' not found.`,
        });
      }

      // Load existing config from disk.
      let existingConfig: Record<string, unknown>;
      try {
        existingConfig = loadRawConfig(agentDir);
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: `Failed to load agent config: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // Model validation — must exist in config.
      if (input.model !== undefined) {
        const appConfig = getAppConfigFn();
        const modelExists = appConfig.models.some((m) => m.name === input.model);
        if (!modelExists) {
          return JSON.stringify({
            ok: false,
            error: `Unknown model '${input.model}'. Pass a model name that exists in config.yaml's models section.`,
          });
        }
      }

      // Build updated config — only changed fields are included.
      const configData: Record<string, unknown> = { ...existingConfig };
      const updatedFields: string[] = [];

      if (input.description !== undefined && input.description !== existingConfig.description) {
        configData.description = input.description;
        updatedFields.push("description");
      }
      if (input.model !== undefined && input.model !== existingConfig.model) {
        configData.model = input.model;
        updatedFields.push("model");
      }
      if (input.skills !== undefined) {
        configData.skills = input.skills;
        updatedFields.push("skills");
      }
      if (input.tool_groups !== undefined) {
        configData.tool_groups = input.tool_groups;
        updatedFields.push("tool_groups");
      }

      // No-op short-circuit.
      if (input.soul === undefined && updatedFields.length === 0) {
        return JSON.stringify({
          ok: true,
          message: "No changes applied.",
          updated_fields: [],
        });
      }

      // Preserve non-managed fields (e.g. the github: binding block).
      preserveNonManagedFields(existingConfig, configData);

      // Staging phase — write every temp file before any rename.
      const stagedTemps: string[] = [];
      const pending: { tmp: string; target: string }[] = [];

      try {
        if (updatedFields.length > 0) {
          const yamlText = YAML.stringify(configData);
          const configTarget = path.join(agentDir, "config.yaml");
          const configTmp = stageTemp(configTarget, yamlText);
          stagedTemps.push(configTmp);
          pending.push({ tmp: configTmp, target: configTarget });
        }

        if (input.soul !== undefined) {
          const soulTarget = path.join(agentDir, SOUL_FILENAME);
          const soulTmp = stageTemp(soulTarget, input.soul);
          stagedTemps.push(soulTmp);
          pending.push({ tmp: soulTmp, target: soulTarget });
          updatedFields.push("soul");
        }
      } catch (err) {
        cleanupTemps(stagedTemps);
        return JSON.stringify({
          ok: false,
          error: `Failed to stage update: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // Commit phase — atomic rename per file on POSIX/NTFS.
      const committed: string[] = [];
      try {
        for (const { tmp, target } of pending) {
          fs.renameSync(tmp, target);
          committed.push(target);
        }
      } catch (err) {
        // Clean up any temp files that haven't been committed yet.
        cleanupTemps(stagedTemps.filter((t) => !committed.includes(t.replace(/\.tmp$/, ""))));
        if (committed.length > 0) {
          return JSON.stringify({
            ok: false,
            error:
              `Partial update for agent '${validated}': ${committed.map((p) => path.basename(p))} ` +
              `were updated, but the rest failed (${err instanceof Error ? err.message : String(err)}). ` +
              "Re-run update_agent to retry the remaining fields.",
          });
        }
        throw err;
      }

      return JSON.stringify({
        ok: true,
        message: `Agent '${validated}' updated: ${updatedFields.join(", ")}.`,
        updated_fields: updatedFields,
      });
    },
    {
      name: "update_agent",
      description: [
        "Persist updates to the current custom agent's SOUL.md and config.yaml.",
        "Use this when the user asks to refine the agent's identity, description, ",
        "skill whitelist, tool-group whitelist, or default model.",
        "Only the fields you explicitly pass are updated; omitted fields keep their existing values.",
        "Pass skills=[] to disable all skills, or omit skills to keep the existing whitelist.",
        "Pass soul as the FULL replacement SOUL.md content — there is no patch semantics.",
      ].join("\n"),
      schema: updateAgentSchema,
    },
  );
}
