/**
 * Web Search Tool - Search the web using the Brave Search API.
 *
 * TypeScript port of `community/brave/tools.py`. Uses `fetch` in place of
 * `httpx`. Brave Search provides web results from an independent search index
 * via a REST API. An API key is required. Sign up at
 * https://brave.com/search/api/ to get one.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { getToolConfig } from "../../config/app_config.js";

const logger = {
  debug: (...a: unknown[]) => console.debug(...a),
  info: (...a: unknown[]) => console.info(...a),
  warning: (...a: unknown[]) => console.warn(...a),
  error: (...a: unknown[]) => console.error(...a),
};

const _BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const _DEFAULT_MAX_RESULTS = 5;
// Brave Search API caps the `count` parameter at 20 results per request.
const _BRAVE_MAX_COUNT = 20;
let _apiKeyWarned = false;

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
}

function _getApiKey(): string | undefined {
  const config = getToolConfig("web_search") as Record<string, unknown> | undefined;
  if (config !== undefined) {
    const apiKey = config["api_key"];
    if (typeof apiKey === "string" && apiKey.trim()) {
      return apiKey;
    }
  }
  return process.env.BRAVE_SEARCH_API_KEY;
}

function _coerceMaxResults(value: unknown, defaultVal: number = _DEFAULT_MAX_RESULTS): number {
  let coerced: number;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) {
    logger.warning(`Invalid Brave Search max_results=${String(value)}; using default ${defaultVal}`);
    coerced = defaultVal;
  } else {
    coerced = Math.trunc(n);
  }
  return Math.max(1, Math.min(coerced, _BRAVE_MAX_COUNT));
}

/** `web_search` tool — search the web for information using Brave Search. */
export const webSearchTool: StructuredToolInterface = tool(
  async (input: { query: string; max_results?: number }): Promise<string> => {
    const query = input.query;
    let maxResults: unknown = input.max_results ?? 5;

    const config = getToolConfig("web_search") as Record<string, unknown> | undefined;
    if (config !== undefined && "max_results" in config) {
      maxResults = config["max_results"];
    }

    const count = _coerceMaxResults(maxResults);

    const apiKey = _getApiKey();
    if (!apiKey) {
      if (!_apiKeyWarned) {
        _apiKeyWarned = true;
        logger.warning(
          "Brave Search API key is not set. Set BRAVE_SEARCH_API_KEY in your environment or provide api_key in config.yaml. Sign up at https://brave.com/search/api/",
        );
      }
      return JSON.stringify({ error: "BRAVE_SEARCH_API_KEY is not configured", query });
    }

    const headers = {
      "X-Subscription-Token": apiKey,
      Accept: "application/json",
    };
    const params = new URLSearchParams({
      q: query,
      count: String(count),
      text_decorations: "false",
    });

    let data: { web?: { results?: BraveWebResult[] } };
    try {
      const response = await fetch(`${_BRAVE_ENDPOINT}?${params.toString()}`, { headers });
      if (!response.ok) {
        logger.error(`Brave Search API returned HTTP ${response.status}: ${await response.text()}`);
        return JSON.stringify({ error: `Brave Search API error: HTTP ${response.status}`, query });
      }
      data = (await response.json()) as { web?: { results?: BraveWebResult[] } };
    } catch (e) {
      logger.error(`Brave search failed: ${e instanceof Error ? e.message : String(e)}`);
      return JSON.stringify({ error: e instanceof Error ? e.message : String(e), query });
    }

    const webResults = data.web?.results ?? [];
    if (webResults.length === 0) {
      return JSON.stringify({ error: "No results found", query });
    }

    const normalizedResults = webResults.map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      content: r.description ?? "",
    }));

    const output = {
      query,
      total_results: normalizedResults.length,
      results: normalizedResults,
    };
    return JSON.stringify(output, null, 2);
  },
  {
    name: "web_search",
    description: "Search the web for information using Brave Search.",
    schema: z.object({
      query: z.string().describe("Search keywords describing what you want to find. Be specific for better results."),
      max_results: z.number().int().optional().describe("Maximum number of search results to return. Default is 5."),
    }),
  },
);
