/**
 * Web Search Tool - Search the web using DuckDuckGo (no API key required).
 *
 * TypeScript implementation using DuckDuckGo's Instant Answer API
 * (https://api.duckduckgo.com/). No API key required. Returns structured
 * search results including abstract, related topics, definitions, and
 * instant answers.
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

const DEFAULT_REGION = "wt-wt";

type BackendInput = string | string[] | null | undefined;

/** DuckDuckGo Instant Answer API response shape. */
interface DDGResponse {
  Abstract?: string;
  AbstractURL?: string;
  AbstractSource?: string;
  Definition?: string;
  DefinitionURL?: string;
  Answer?: string;
  AnswerType?: string;
  RelatedTopics?: Array<{
    Text?: string;
    FirstURL?: string;
    Topics?: Array<{ Text?: string; FirstURL?: string }>;
  }>;
  Results?: Array<{
    Text?: string;
    FirstURL?: string;
  }>;
}

function _normalizeBackend(backend: BackendInput): string {
  if (backend === null || backend === undefined) {
    return "auto";
  }
  if (Array.isArray(backend)) {
    return backend.map((part) => String(part).trim()).filter((part) => part).join(",") || "auto";
  }
  return String(backend).trim() || "auto";
}

/** Execute text search using DuckDuckGo Instant Answer API. */
async function _searchText(
  query: string,
  maxResults = 5,
  _region: string | null = DEFAULT_REGION,
): Promise<Array<Record<string, unknown>>> {
  const endpoint = "https://api.duckduckgo.com/";
  const params = new URLSearchParams({
    q: query,
    format: "json",
    no_html: "1",
    skip_disambig: "1",
  });

  try {
    const resp = await fetch(`${endpoint}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      logger.error(`DuckDuckGo API returned ${resp.status}`);
      return [];
    }
    const data = (await resp.json()) as DDGResponse;
    const results: Array<Record<string, unknown>> = [];

    // Abstract (top result)
    if (data.Abstract) {
      results.push({
        title: data.AbstractSource || data.AbstractURL || query,
        href: data.AbstractURL || "",
        body: data.Abstract,
      });
    }

    // Definition
    if (data.Definition) {
      results.push({
        title: `Definition${data.DefinitionURL ? `: ${data.DefinitionURL}` : ""}`,
        href: data.DefinitionURL || "",
        body: data.Definition,
      });
    }

    // Instant answer
    if (data.Answer && data.AnswerType !== "calc") {
      results.push({
        title: `Answer (${data.AnswerType || "instant"})`,
        href: "",
        body: data.Answer,
      });
    }

    // Related topics (flatten nested Topics arrays)
    for (const topic of data.RelatedTopics ?? []) {
      if (results.length >= maxResults) break;
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.FirstURL,
          href: topic.FirstURL,
          body: topic.Text,
        });
      }
      for (const sub of topic.Topics ?? []) {
        if (results.length >= maxResults) break;
        if (sub.Text && sub.FirstURL) {
          results.push({
            title: sub.FirstURL,
            href: sub.FirstURL,
            body: sub.Text,
          });
        }
      }
    }

    // Traditional search results (if any)
    for (const r of data.Results ?? []) {
      if (results.length >= maxResults) break;
      if (r.Text && r.FirstURL) {
        results.push({
          title: r.FirstURL,
          href: r.FirstURL,
          body: r.Text,
        });
      }
    }

    return results.slice(0, maxResults);
  } catch (err) {
    logger.error(`DuckDuckGo search failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function _get(r: Record<string, unknown>, key: string): unknown {
  return key in r ? r[key] : undefined;
}

/** `web_search` tool — search the web via DuckDuckGo. */
export const web_search_tool: StructuredToolInterface = tool(
  async (input: { query: string; max_results?: number }): Promise<string> => {
    const query = input.query;
    let maxResults: number = input.max_results ?? 5;
    let region: string = DEFAULT_REGION;

    const config = getToolConfig("web_search") as Record<string, unknown> | undefined;
    if (config !== undefined) {
      // Override tool call defaults from config if set.
      maxResults = (config["max_results"] as number | undefined) ?? maxResults;
      region = (config["region"] as string | undefined) ?? region;
    }

    const results = await _searchText(query, maxResults, region);

    if (results.length === 0) {
      return JSON.stringify({ error: "No results found", query });
    }

    const normalizedResults = results.map((r) => {
      const href = _get(r, "href");
      const body = _get(r, "body");
      return {
        title: (_get(r, "title") ?? "") as string,
        url: (href !== undefined ? href : (_get(r, "link") ?? "")) as string,
        content: (body !== undefined ? body : (_get(r, "snippet") ?? "")) as string,
      };
    });

    const output = {
      query,
      total_results: normalizedResults.length,
      results: normalizedResults,
    };

    return JSON.stringify(output, null, 2);
  },
  {
    name: "web_search",
    description:
      "Search the web for information. Use this tool to find current information, news, articles, and facts from the internet.",
    schema: z.object({
      query: z.string().describe("Search keywords describing what you want to find. Be specific for better results."),
      max_results: z.number().int().optional().describe("Maximum number of results to return. Default is 5."),
    }),
  },
);
