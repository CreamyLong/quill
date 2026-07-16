/**
 * Web search + fetch tools backed by Tavily.
 *
 * TypeScript port of `community/tavily/tools.py`. The Python module used the
 * `tavily` SDK (`TavilyClient.search` / `.extract`); here those calls are
 * reimplemented against Tavily's public REST API with `fetch`, preserving the
 * same tool names (`web_search`, `web_fetch`), config resolution, and
 * normalized JSON output shape.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { getToolConfig } from "../../config/app_config.js";

const _SEARCH_ENDPOINT = "https://api.tavily.com/search";
const _EXTRACT_ENDPOINT = "https://api.tavily.com/extract";

interface TavilySearchResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilySearchResponse {
  results?: TavilySearchResult[];
}

interface TavilyExtractResult {
  title?: string;
  url?: string;
  raw_content?: string;
}

interface TavilyExtractResponse {
  results?: TavilyExtractResult[];
  failed_results?: Array<{ url?: string; error?: string }>;
}

/**
 * Minimal Tavily REST client mirroring the subset of the `TavilyClient` SDK
 * surface the Python provider used.
 */
class TavilyClient {
  constructor(private readonly apiKey: string | undefined) {}

  async search(query: string, maxResults: number): Promise<TavilySearchResponse> {
    const res = await fetch(_SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ api_key: this.apiKey, query, max_results: maxResults }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as TavilySearchResponse;
  }

  async extract(urls: string[]): Promise<TavilyExtractResponse> {
    const res = await fetch(_EXTRACT_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ api_key: this.apiKey, urls }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as TavilyExtractResponse;
  }
}

function _getTavilyClient(): TavilyClient {
  const config = getToolConfig("web_search") as Record<string, unknown> | undefined;
  let apiKey: string | undefined;
  if (config !== undefined && "api_key" in config) {
    apiKey = config["api_key"] as string | undefined;
  }
  // Fall back to the environment. The launcher loads the project-root `.env`
  // into `process.env`, so an explicit `api_key: $TAVILY_API_KEY` config entry
  // is not strictly required for the tool to be usable. (Deviation from the
  // Python provider, which reads the key from config only.)
  if (apiKey === undefined || apiKey === null || apiKey === "") {
    apiKey = process.env.TAVILY_API_KEY;
  }
  return new TavilyClient(apiKey);
}

/** `web_search` tool — search the web via Tavily. */
export const webSearchTool: StructuredToolInterface = tool(
  async (input: { query: string }): Promise<string> => {
    const config = getToolConfig("web_search") as Record<string, unknown> | undefined;
    let maxResults = 5;
    if (config !== undefined && "max_results" in config) {
      maxResults = config["max_results"] as number;
    }

    const client = _getTavilyClient();
    const res = await client.search(input.query, maxResults);
    const normalizedResults = (res.results ?? []).map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.content,
    }));
    return JSON.stringify(normalizedResults, null, 2);
  },
  {
    name: "web_search",
    description: "Search the web.",
    schema: z.object({
      query: z.string().describe("The query to search for."),
    }),
  },
);

/** `web_fetch` tool — fetch the contents of a web page via Tavily extract. */
export const webFetchTool: StructuredToolInterface = tool(
  async (input: { url: string }): Promise<string> => {
    const client = _getTavilyClient();
    const res = await client.extract([input.url]);
    if (res.failed_results !== undefined && res.failed_results.length > 0) {
      return `Error: ${res.failed_results[0].error}`;
    } else if (res.results !== undefined && res.results.length > 0) {
      const result = res.results[0];
      return `# ${result.title}\n\n${(result.raw_content ?? "").slice(0, 4096)}`;
    } else {
      return "Error: No results found";
    }
  },
  {
    name: "web_fetch",
    description: [
      "Fetch the contents of a web page at a given URL.",
      "Only fetch EXACT URLs that have been provided directly by the user or have been returned in results from the web_search and web_fetch tools.",
      "This tool can NOT access content that requires authentication, such as private Google Docs or pages behind login walls.",
      "Do NOT add www. to URLs that do NOT have them.",
      "URLs must include the schema: https://example.com is a valid URL while example.com is an invalid URL.",
    ].join("\n"),
    schema: z.object({
      url: z.string().describe("The URL to fetch the contents of."),
    }),
  },
);
