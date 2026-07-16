/**
 * Web search + fetch tools backed by Firecrawl.
 *
 * TypeScript port of `community/firecrawl/tools.py`. The Python module used the
 * `firecrawl` SDK (`FirecrawlApp.search` / `.scrape`); here a minimal REST
 * client (`FirecrawlApp`) is reimplemented with `fetch` and exported so the
 * Firecrawl-compatible `fastcrw` provider can reuse it (mirroring the Python
 * modules, which both import `FirecrawlApp`).
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { getToolConfig } from "../../config/app_config.js";

const DEFAULT_FIRECRAWL_URL = "https://api.firecrawl.dev";

export interface FirecrawlSearchResultItem {
  title?: string | null;
  url?: string | null;
  description?: string | null;
}

export interface FirecrawlSearchResult {
  web: FirecrawlSearchResultItem[];
}

export interface FirecrawlScrapeResult {
  markdown?: string | null;
  metadata?: { title?: string | null } | null;
}

/** Minimal Firecrawl REST client mirroring the `FirecrawlApp` SDK subset used. */
export class FirecrawlApp {
  private readonly apiKey: string | undefined;
  private readonly apiUrl: string;

  constructor(opts: { apiKey?: string; apiUrl?: string } = {}) {
    this.apiKey = opts.apiKey;
    this.apiUrl = (opts.apiUrl ?? DEFAULT_FIRECRAWL_URL).replace(/\/+$/, "");
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  async search(query: string, options: { limit: number }): Promise<FirecrawlSearchResult> {
    const res = await fetch(`${this.apiUrl}/v1/search`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ query, limit: options.limit, sources: ["web"] }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data?: { web?: FirecrawlSearchResultItem[] } | FirecrawlSearchResultItem[];
      web?: FirecrawlSearchResultItem[];
    };
    let web: FirecrawlSearchResultItem[] = [];
    if (json.data && !Array.isArray(json.data) && Array.isArray(json.data.web)) {
      web = json.data.web;
    } else if (Array.isArray(json.data)) {
      web = json.data;
    } else if (Array.isArray(json.web)) {
      web = json.web;
    }
    return { web };
  }

  async scrape(url: string, options: { formats: string[] }): Promise<FirecrawlScrapeResult> {
    const res = await fetch(`${this.apiUrl}/v1/scrape`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ url, formats: options.formats }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { data?: FirecrawlScrapeResult } & FirecrawlScrapeResult;
    return json.data ?? json;
  }
}

function _getFirecrawlClient(toolName = "web_search"): FirecrawlApp {
  const config = getToolConfig(toolName) as Record<string, unknown> | undefined;
  let apiKey: string | undefined;
  if (config !== undefined && "api_key" in config) {
    apiKey = config["api_key"] as string | undefined;
  }
  return new FirecrawlApp({ apiKey });
}

/** `web_search` tool — search the web via Firecrawl. */
export const webSearchTool: StructuredToolInterface = tool(
  async (input: { query: string }): Promise<string> => {
    try {
      const config = getToolConfig("web_search") as Record<string, unknown> | undefined;
      let maxResults = 5;
      if (config !== undefined) {
        maxResults = (config["max_results"] as number | undefined) ?? maxResults;
      }

      const client = _getFirecrawlClient("web_search");
      const result = await client.search(input.query, { limit: maxResults });

      const webResults = result.web ?? [];
      const normalizedResults = webResults.map((item) => ({
        title: item.title ?? "",
        url: item.url ?? "",
        snippet: item.description ?? "",
      }));
      return JSON.stringify(normalizedResults, null, 2);
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
  {
    name: "web_search",
    description: "Search the web.",
    schema: z.object({
      query: z.string().describe("The query to search for."),
    }),
  },
);

/** `web_fetch` tool — fetch page contents via Firecrawl scrape. */
export const webFetchTool: StructuredToolInterface = tool(
  async (input: { url: string }): Promise<string> => {
    let title: string;
    let markdownContent: string;
    try {
      const client = _getFirecrawlClient("web_fetch");
      const result = await client.scrape(input.url, { formats: ["markdown"] });

      markdownContent = result.markdown ?? "";
      const metadata = result.metadata;
      title = metadata && metadata.title ? metadata.title : "Untitled";

      if (!markdownContent) {
        return "Error: No content found";
      }
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }

    return `# ${title}\n\n${markdownContent.slice(0, 4096)}`;
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
