/**
 * setup_agent tool — create a custom agent's initial configuration.
 *
 * Mirrors Python `deerflow.tools.builtins.setup_agent_tool`. During the
 * bootstrap flow, the LLM calls this tool to persist a new custom agent's
 * SOUL.md and config.yaml to the per-user agent directory.
 *
 * Validation and safety:
 *  - Rejects empty / whitespace-only `soul` content.
 *  - Validates `agent_name` against the ASCII-slug pattern (prevents path
 *    traversal).
 *  - Resolves the user ID from runtime context so agents are per-user
 *    isolated.
 *  - On failure, only cleans up the directory if it was newly created during
 *    this call (prevents data loss for pre-existing agents).
 */

import fs from "node:fs";
import type { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import YAML from "yaml";

import { validateAgentName, SOUL_FILENAME } from "../../config/agents_config.js";
import type { Paths } from "../../config/paths.js";
import { getPaths } from "../../config/paths.js";
import { resolveRuntimeUserId } from "../../runtime/user_context.js";

const setupAgentSchema = z.object({
  soul: z
    .string()
    .describe("Full SOUL.md content defining the agent's personality and behavior."),
  description: z
    .string()
    .describe("One-line description of what the agent does."),
  skills: z
    .array(z.string())
    .optional()
    .describe(
      "Optional skill whitelist. None means use all enabled skills, empty list means no skills.",
    ),
});

export interface SetupAgentToolDeps {
  /** Override getPaths() for testing with a temp directory. */
  getPaths?: () => Paths;
}

/**
 * Create the setup_agent tool.
 *
 * The tool reads `agent_name` and `user_id` from LangChain's RunnableConfig
 * (the TypeScript equivalent of Python's `runtime.context`).
 */
export function createSetupAgentTool(deps: SetupAgentToolDeps = {}): StructuredToolInterface {
  const getPathsFn = deps.getPaths ?? getPaths;

  return tool(
    async (
      input: z.infer<typeof setupAgentSchema>,
      config?: RunnableConfig,
    ): Promise<string> => {
      const cfg = config?.configurable as Record<string, unknown> | undefined;

      // Reject empty / whitespace-only soul content upfront.
      if (!input.soul || !input.soul.trim()) {
        return JSON.stringify({
          ok: false,
          error: "soul content is empty; refusing to create agent with an empty SOUL.md",
        });
      }

      let agentName: string | null = null;
      let agentDir: string | null = null;
      let isNewDir = false;

      try {
        // Validate agent_name from runtime context.
        const rawAgentName = (cfg?.["agent_name"] as string | null) ?? null;
        agentName = validateAgentName(rawAgentName);
        if (agentName === null) {
          return JSON.stringify({
            ok: false,
            error: "agent_name is required but was not provided in runtime context",
          });
        }

        // Resolve user ID for per-user isolation.
        const userId = resolveRuntimeUserId({ context: cfg });
        const paths = getPathsFn();
        agentDir = paths.userAgentDir(userId, agentName);
        isNewDir = !fs.existsSync(agentDir);

        // Create the agent directory.
        fs.mkdirSync(agentDir, { recursive: true });

        // Write config.yaml (only for custom agents with agent_name set).
        const configData: Record<string, unknown> = { name: agentName };
        if (input.description) {
          configData.description = input.description;
        }
        if (input.skills !== undefined) {
          configData.skills = input.skills;
        }
        const configFile = `${agentDir}/config.yaml`;
        fs.writeFileSync(configFile, YAML.stringify(configData), "utf-8");

        // Write SOUL.md.
        const soulFile = `${agentDir}/${SOUL_FILENAME}`;
        fs.writeFileSync(soulFile, input.soul, "utf-8");

        return JSON.stringify({
          ok: true,
          message: `Agent '${agentName}' created successfully!`,
          created_agent_name: agentName,
        });
      } catch (err) {
        // Clean up only if this call newly created the directory.
        if (agentName && isNewDir && agentDir !== null && fs.existsSync(agentDir)) {
          fs.rmSync(agentDir, { recursive: true, force: true });
        }
        const errorMessage = err instanceof Error ? err.message : String(err);
        return JSON.stringify({
          ok: false,
          error: errorMessage,
        });
      }
    },
    {
      name: "setup_agent",
      description: [
        "Set up a custom DeerFlow agent by creating its configuration files.",
        "Use this during the bootstrap flow to persist a new agent's SOUL.md and config.yaml.",
        "The agent_name is read from the runtime context.",
      ].join("\n"),
      schema: setupAgentSchema,
    },
  );
}
