/**
 * Web Search Tool — Z.ai (智谱) Search API.
 *
 * POST https://api.z.ai/api/paas/v4/web_search
 * Auth: Bearer <api key> (env ZAI_API_KEY)
 *
 * Docs: https://docs.z.ai/api-reference/tools/web-search
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

const logger = {
  debug: (...a: unknown[]) => console.debug(...a),
  info: (...a: unknown[]) => console.info(...a),
  warning: (...a: unknown[]) => console.warn(...a),
  error: (...a: unknown[]) => console.error(...a),
};

const ZAI_ENDPOINT = "https://api.z.ai/api/paas/v4/web_search";

const SEARCH_RECENCY_VALUES = ["oneDay", "oneWeek", "oneMonth", "oneYear", "noLimit"] as const;

interface ZaiSearchResult {
  title?: string;
  content?: string;
  link?: string;
  media?: string;
  icon?: string;
  refer?: string;
  publish_date?: string;
}

interface ZaiSearchResponse {
  id?: string;
  created?: number;
  search_result?: ZaiSearchResult[];
}

/** Call the Z.ai web search API. */
async function zaiWebSearch(
  query: string,
  count = 10,
  recency: typeof SEARCH_RECENCY_VALUES[number] = "noLimit",
  apiKey = process.env.ZAI_API_KEY,
): Promise<string> {
  if (!apiKey) {
    return `Error: ZAI_API_KEY environment variable is not set. Set it to enable Z.ai web search.`;
  }

  const body = JSON.stringify({
    search_engine: "search-prime",
    search_query: query,
    count: Math.min(Math.max(count, 1), 50),
    search_recency_filter: recency,
  });

  try {
    const response = await fetch(ZAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Accept-Language": "zh-CN,zh",
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      return `Error: Z.ai search returned HTTP ${response.status}: ${text.slice(0, 200)}`;
    }

    const data = (await response.json()) as ZaiSearchResponse;
    const results = data.search_result ?? [];
    if (results.length === 0) {
      return `No search results found for: "${query}"`;
    }

    return results
      .map((r, i) => {
        const title = r.title ?? "(no title)";
        const link = r.link ?? "";
        const snippet = r.content ?? r.media ?? "";
        const date = r.publish_date ? ` (${r.publish_date})` : "";
        return `[citation:${i + 1}] ${title}${date}\n  ${link}\n  ${snippet}`;
      })
      .join("\n\n");
  } catch (err) {
    return `Error: Z.ai search failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** `web_search` tool backed by Z.ai. */
export const webSearchTool: StructuredToolInterface = tool(
  async (input: {
    query: string;
    count?: number;
    recency?: typeof SEARCH_RECENCY_VALUES[number];
  }): Promise<string> => {
    const count = input.count ?? 10;
    const recency = input.recency ?? "noLimit";
    logger.info(`[zai_web_search] query="${input.query.slice(0, 80)}" count=${count} recency=${recency}`);
    return zaiWebSearch(input.query, count, recency);
  },
  {
    name: "web_search",
    description: [
      "Search the web using Z.ai Search API. Returns real-time web results with citations.",
      "Required: query — the search string.",
      "Optional: count (1-50, default 10), recency filter (oneDay/oneWeek/oneMonth/oneYear/noLimit).",
      "Use this when the user asks for current information, news, or anything beyond the model's training data.",
    ].join("\n"),
    schema: z.object({
      query: z.string().describe("The search query string."),
      count: z.number().min(1).max(50).optional().describe("Number of results to return (1-50, default 10)."),
      recency: z.enum(SEARCH_RECENCY_VALUES).optional().describe("Time range filter for results."),
    }),
  },
);

export { zaiWebSearch };
