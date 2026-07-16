/**
 * tool_search — discover and promote deferred (MCP) tools.
 *
 * Deferred tools are registered for execution but hidden from the model's tool
 * binding until they are promoted. This tool searches the deferred catalog and
 * returns matching entries; a companion middleware turns the returned names into
 * `state.promoted` so the deferred tool filter exposes those schemas.
 *
 * Also hosts the deferred-tool assembly helpers (`assembleDeferredTools`,
 * `buildDeferredToolSetup`, `getDeferredToolsPromptSection`) shared by every
 * agent-build path (lead, embedded client, subagent) so they all get the same
 * fail-closed guarantee and prompt rendering from one place. Ports
 * `quill.tools.builtins.tool_search`.
 */

import crypto from "node:crypto";

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { isMcpTool } from "../mcp_metadata.js";

export { isMcpTool };

export interface DeferredToolCatalogEntry {
  name: string;
  description: string;
}

const toolSearchSchema = z.object({
  query: z
    .string()
    .describe(
      "Search query matched against deferred tool names and descriptions. Be concise."
    ),
});

/** Build the tool_search tool for a deferred tool catalog. */
export function createToolSearchTool(
  catalog: DeferredToolCatalogEntry[]
): StructuredToolInterface {
  return tool(
    async (input: z.infer<typeof toolSearchSchema>): Promise<string> => {
      const query = input.query.toLowerCase().trim();
      if (!query) {
        return JSON.stringify({
          ok: false,
          message: "Query cannot be empty.",
          results: [],
          promoted: [],
        });
      }

      const matches = catalog.filter((entry) => {
        const text = `${entry.name} ${entry.description}`.toLowerCase();
        return text.includes(query);
      });

      return JSON.stringify({
        ok: true,
        message:
          matches.length === 0
            ? "No matching deferred tools found."
            : `Found ${matches.length} matching deferred tool(s). Their schemas are now exposed for this turn.`,
        results: matches.map((entry) => ({
          name: entry.name,
          description: entry.description,
        })),
        promoted: matches.map((entry) => entry.name),
      });
    },
    {
      name: "tool_search",
      description: [
        "Search the catalog of deferred tools by name or description.",
        "Deferred tools (e.g. MCP servers) are hidden by default to keep the model's tool context small.",
        "Call tool_search to expose the schemas of tools relevant to the current task; matching tools are then available for the rest of the conversation.",
      ].join("\n"),
      schema: toolSearchSchema,
    }
  );
}

// ── Deferred-tool setup / assembly ──────────────────────────────────────────

/**
 * Result of assembling deferred-tool support for one agent build.
 *
 * The three fields move as a unit; callers branch on `toolSearchTool`:
 *
 * - **Empty** (`null, new Set(), null`): deferral is disabled, or no MCP tool
 *   survived policy filtering. Nothing is deferred — bind tools as-is.
 * - **Populated**: `toolSearchTool` is appended to the agent's tools,
 *   `deferredNames` are withheld from the model until promoted, and
 *   `catalogHash` scopes those promotions in graph state.
 *
 * Invariant: `toolSearchTool === null` ⟺ `deferredNames` is empty ⟺
 * `catalogHash === null`.
 */
export interface DeferredToolSetup {
  toolSearchTool: StructuredToolInterface | null;
  deferredNames: Set<string>;
  catalogHash: string | null;
}

/**
 * Build the deferred-tool setup from a POLICY-FILTERED tool list.
 *
 * Must be called after skill/agent tool-policy filtering so the catalog never
 * exposes a tool the current agent is not allowed to use.
 *
 * Returns an empty setup in two distinct cases: deferral is disabled, or it is
 * enabled but no MCP tool survived filtering.
 */
export function buildDeferredToolSetup(
  filteredTools: StructuredToolInterface[],
  options: { enabled: boolean },
): DeferredToolSetup {
  if (!options.enabled) {
    // Deferral disabled: defer nothing; the model binds every tool as before.
    return { toolSearchTool: null, deferredNames: new Set<string>(), catalogHash: null };
  }
  const deferred = filteredTools.filter((t) => isMcpTool(t as unknown as { metadata?: Record<string, unknown> }));
  if (deferred.length === 0) {
    // Enabled, but no MCP tool to defer: same empty result, different reason.
    return { toolSearchTool: null, deferredNames: new Set<string>(), catalogHash: null };
  }
  const catalog: DeferredToolCatalogEntry[] = deferred.map((t) => ({
    name: t.name,
    description: t.description ?? "",
  }));
  const deferredNames = new Set(deferred.map((t) => t.name));
  // Catalog hash: stable SHA-256 over sorted [name, description] pairs, truncated
  // to 16 hex chars. Mirrors the Python `DeferredToolCatalog.hash` (which uses
  // full OpenAI function schemas, but descriptions are the only varying field
  // visible to the TS catalog surface).
  const canon = catalog
    .map((e) => [e.name, e.description] as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const blob = JSON.stringify(canon);
  const catalogHash = crypto.createHash("sha256").update(blob).digest("hex").slice(0, 16);
  return {
    toolSearchTool: createToolSearchTool(catalog),
    deferredNames,
    catalogHash,
  };
}

/**
 * Build the final tool list + deferred setup from a POLICY-FILTERED list.
 *
 * Call AFTER tool-policy filtering so the deferred catalog never exposes a tool
 * the agent is not allowed to use. Fail-closed: if tool_search is enabled and
 * MCP tools survived filtering but no deferred set was recovered, raise rather
 * than silently binding their full schemas to the model.
 *
 * Shared by every agent-build path (lead, embedded client, subagent) so they
 * all get the same fail-closed guarantee from one place.
 */
export function assembleDeferredTools(
  filteredTools: StructuredToolInterface[],
  options: { enabled: boolean },
): [StructuredToolInterface[], DeferredToolSetup] {
  const deferredSetup = buildDeferredToolSetup(filteredTools, options);
  if (
    options.enabled &&
    deferredSetup.deferredNames.size === 0 &&
    filteredTools.some((t) => isMcpTool(t as unknown as { metadata?: Record<string, unknown> }))
  ) {
    throw new Error(
      "tool_search enabled and MCP tools survived policy filtering, but no deferred set was recovered - refusing to bind MCP schemas (fail-closed).",
    );
  }
  const finalTools = filteredTools.slice();
  if (deferredSetup.toolSearchTool) {
    finalTools.push(deferredSetup.toolSearchTool);
  }
  return [finalTools, deferredSetup];
}

/**
 * Generate `<available-deferred-tools>` from an explicit deferred-name set.
 *
 * Lists only names so the agent knows what exists and can use tool_search to
 * load them. Returns empty string when there are no deferred tools. The set is
 * computed at agent build time (after tool-policy filtering) and passed in.
 *
 * Lives here, next to the assembly that produces `deferredNames`, so every
 * agent-build path (lead, embedded client, subagent) renders the section the
 * same way without coupling back to `lead_agent.prompt`.
 */
export function getDeferredToolsPromptSection(options: {
  deferredNames: Set<string>;
}): string {
  if (!options.deferredNames || options.deferredNames.size === 0) {
    return "";
  }
  const names = Array.from(options.deferredNames).sort().join("\n");
  return `<available-deferred-tools>\n${names}\n</available-deferred-tools>`;
}
