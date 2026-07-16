/**
 * Web search tool backed by SearXNG.
 *
 * TypeScript port of `community/searxng/tools.py`.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { getToolConfig } from "../../config/app_config.js";
import { SearxngClient } from "./searxng_client.js";

const logger = {
  debug: (...a: unknown[]) => console.debug(...a),
  info: (...a: unknown[]) => console.info(...a),
  warning: (...a: unknown[]) => console.warn(...a),
  error: (...a: unknown[]) => console.error(...a),
};

/** Get tool config extras safely, returning null if not configured. */
function _getToolConfig(toolName: string): Record<string, unknown> | null {
  const config = getToolConfig(toolName) as Record<string, unknown> | undefined;
  if (config === undefined) {
    return null;
  }
  return config;
}

function _getSearxngClient(): SearxngClient {
  const cfg = _getToolConfig("web_search");
  let baseUrl = "http://localhost:8088";
  if (cfg !== null) {
    baseUrl = (cfg["base_url"] as string | undefined) ?? baseUrl;
  }
  return new SearxngClient(baseUrl);
}

/** `web_search` tool — search the web via SearXNG. */
export const webSearchTool: StructuredToolInterface = tool(
  async (input: { query: string }): Promise<string> => {
    const query = input.query;
    try {
      const cfg = _getToolConfig("web_search");
      let maxResults = 5;
      if (cfg !== null) {
        const raw = cfg["max_results"] ?? maxResults;
        maxResults = typeof raw === "number" ? raw : parseInt(String(raw), 10);
      }

      const client = _getSearxngClient();
      const results = await client.search(query, maxResults);

      const normalized = results.map((r) => ({
        title: (r["title"] as string | undefined) ?? "",
        url: (r["url"] as string | undefined) ?? "",
        snippet: (r["content"] as string | undefined) ?? "",
      }));
      return JSON.stringify(normalized, null, 2);
    } catch (e) {
      logger.error(`Error in web_search_tool: ${e instanceof Error ? e.message : String(e)}`);
      return JSON.stringify({ error: e instanceof Error ? e.message : String(e), query });
    }
  },
  {
    name: "web_search",
    description: "Search the web using SearXNG.",
    schema: z.object({
      query: z.string().describe("The query to search for."),
    }),
  },
);
