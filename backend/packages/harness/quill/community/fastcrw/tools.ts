/**
 * Web search + fetch tools backed by fastCRW.
 *
 * TypeScript port of `community/fastcrw/tools.py`. fastCRW is a
 * Firecrawl-compatible web data engine, so this provider reuses the exported
 * `FirecrawlApp` REST client from the sibling `firecrawl` provider and only
 * swaps the base URL. Cloud default points at the managed service; override
 * `base_url` in the tool config (or set CRW_API_URL) for self-host.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { getToolConfig } from "../../config/app_config.js";
import { FirecrawlApp } from "../firecrawl/tools.js";

const DEFAULT_BASE_URL = "https://fastcrw.com/api";

function _getFastcrwClient(toolName = "web_search"): FirecrawlApp {
  const config = getToolConfig(toolName) as Record<string, unknown> | undefined;
  let apiKey: string | undefined;
  let baseUrl: string | undefined;
  if (config !== undefined) {
    if ("api_key" in config) {
      apiKey = config["api_key"] as string | undefined;
    }
    if ("base_url" in config) {
      baseUrl = config["base_url"] as string | undefined;
    }
  }
  if (apiKey === undefined) {
    apiKey = process.env.CRW_API_KEY;
  }
  if (baseUrl === undefined) {
    baseUrl = process.env.CRW_API_URL ?? DEFAULT_BASE_URL;
  }
  return new FirecrawlApp({ apiKey, apiUrl: baseUrl });
}

/** `web_search` tool — search the web via fastCRW. */
export const webSearchTool: StructuredToolInterface = tool(
  async (input: { query: string }): Promise<string> => {
    try {
      const config = getToolConfig("web_search") as Record<string, unknown> | undefined;
      let maxResults = 5;
      if (config !== undefined) {
        maxResults = (config["max_results"] as number | undefined) ?? maxResults;
      }

      const client = _getFastcrwClient("web_search");
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

/** `web_fetch` tool — fetch page contents via fastCRW scrape. */
export const webFetchTool: StructuredToolInterface = tool(
  async (input: { url: string }): Promise<string> => {
    let title: string;
    let markdownContent: string;
    try {
      const client = _getFastcrwClient("web_fetch");
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
