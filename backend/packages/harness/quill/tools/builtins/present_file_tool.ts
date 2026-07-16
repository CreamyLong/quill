/**
 * present_files tool — expose output files to the user/frontend.
 *
 * Validates that the requested paths live under `/mnt/user-data/outputs` and
 * records them as artifacts in graph state.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { VIRTUAL_PATH_PREFIX } from "../../config/paths.js";

const OUTPUTS_VIRTUAL_PREFIX = `${VIRTUAL_PATH_PREFIX}/outputs`;

const presentFilesSchema = z.object({
  description: z
    .string()
    .describe("Explain why you are presenting these files in short words. ALWAYS PROVIDE THIS PARAMETER FIRST."),
  filepaths: z
    .array(z.string())
    .describe("List of absolute virtual paths under /mnt/user-data/outputs to present to the user."),
});

function normalizePresentedPath(filepath: string): { ok: true; path: string } | { ok: false; error: string } {
  const stripped = filepath.replace(/\\/g, "/").replace(/^\/+/, "");
  const virtualPrefix = VIRTUAL_PATH_PREFIX.replace(/^\/+/, "");

  let actual: string;
  if (stripped === virtualPrefix || stripped.startsWith(`${virtualPrefix}/`)) {
    actual = filepath.replace(/\\/g, "/");
  } else {
    return {
      ok: false,
      error: `Only files in ${OUTPUTS_VIRTUAL_PREFIX} can be presented: ${filepath}`,
    };
  }

  if (!actual.startsWith(`${OUTPUTS_VIRTUAL_PREFIX}/`) && actual !== OUTPUTS_VIRTUAL_PREFIX) {
    return {
      ok: false,
      error: `Only files in ${OUTPUTS_VIRTUAL_PREFIX} can be presented: ${filepath}`,
    };
  }
  return { ok: true, path: actual };
}

/** Build the present_files tool. */
export function createPresentFilesTool(): StructuredToolInterface {
  return tool(
    async (input: z.infer<typeof presentFilesSchema>): Promise<string> => {
      const normalized: string[] = [];
      for (const filepath of input.filepaths) {
        const result = normalizePresentedPath(filepath);
        if (!result.ok) {
          return JSON.stringify({ ok: false, error: result.error });
        }
        normalized.push(result.path);
      }
      return JSON.stringify({
        ok: true,
        message: "Successfully presented files.",
        presented_files: normalized,
      });
    },
    {
      name: "present_files",
      description: [
        "Make files visible to the user for viewing, downloading, or rendering in the client interface.",
        "Use this tool after creating files that should be shown to the user.",
        "Only files under /mnt/user-data/outputs can be presented.",
      ].join("\n"),
      schema: presentFilesSchema,
    },
  );
}
