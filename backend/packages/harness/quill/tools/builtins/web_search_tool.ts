/**
 * Web search tool (Tavily).
 *
 * Ported capability from the Python `community/tavily` provider: gives the agent
 * general web search to complement Sciverse (which is scientific-literature only).
 * Returns a compact JSON payload the model can cite.
 *
 * Injected `apiKey` keeps this module free of env/config coupling.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

export interface WebSearchDeps {
  apiKey: string;
  maxResults?: number;
  /** Tavily endpoint override (defaults to the public API). */
  endpoint?: string;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
}

/** Build a `web_search` tool backed by the Tavily API. */
export function createWebSearchTool(deps: WebSearchDeps): StructuredToolInterface {
  const endpoint = deps.endpoint ?? "https://api.tavily.com/search";
  const defaultMax = deps.maxResults ?? 5;

  return tool(
    async (input: {
      query: string;
      max_results?: number;
      search_depth?: "basic" | "advanced";
      include_answer?: boolean;
    }): Promise<string> => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${deps.apiKey}`,
          },
          body: JSON.stringify({
            api_key: deps.apiKey,
            query: input.query,
            max_results: Math.min(input.max_results ?? defaultMax, 10),
            search_depth: input.search_depth ?? "basic",
            include_answer: input.include_answer ?? true,
          }),
        });
        if (!res.ok) {
          return `Web search error: HTTP ${res.status} ${await res.text()}`;
        }
        const json = (await res.json()) as { answer?: string; results?: TavilyResult[] };
        const results = (json.results ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          content: r.content,
          published_date: r.published_date,
        }));
        return JSON.stringify({ answer: json.answer ?? null, results }, null, 2);
      } catch (err) {
        return `Web search failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: "web_search",
      description: [
        "General web search (Tavily). Use for current events, news, product/tool docs, or any non-scientific-literature information — and to complement Sciverse when a question needs the open web.",
        "Returns an optional synthesized `answer` plus a list of results with title, url, content snippet, and date. Cite claims with their url.",
      ].join("\n"),
      schema: z.object({
        query: z.string().describe("The search query."),
        max_results: z.number().int().min(1).max(10).optional().describe("Number of results (max 10)."),
        search_depth: z.enum(["basic", "advanced"]).optional(),
        include_answer: z.boolean().optional(),
      }),
    },
  );
}
