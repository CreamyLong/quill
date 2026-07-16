/**
 * Web search + fetch tools backed by Exa.
 *
 * TypeScript port of `community/exa/tools.py`. The Python module used the
 * `exa_py` SDK (`Exa.search` / `.get_contents`); here those calls are
 * reimplemented against Exa's REST API with `fetch`, preserving the same tool
 * names, config resolution, and output shapes.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { getToolConfig } from "../../config/app_config.js";

const _SEARCH_ENDPOINT = "https://api.exa.ai/search";
const _CONTENTS_ENDPOINT = "https://api.exa.ai/contents";

interface ExaSearchResult {
  title?: string | null;
  url?: string | null;
  highlights?: string[] | null;
}

interface ExaContentsResult {
  title?: string | null;
  text?: string | null;
}

/** Minimal Exa REST client mirroring the `Exa` SDK subset the provider used. */
class Exa {
  constructor(private readonly apiKey: string | undefined) {}

  async search(
    query: string,
    options: { type: string; numResults: number; contents: { highlights: { maxCharacters: number } } },
  ): Promise<{ results: ExaSearchResult[] }> {
    const res = await fetch(_SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
      },
      body: JSON.stringify({
        query,
        type: options.type,
        numResults: options.numResults,
        contents: options.contents,
      }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as { results: ExaSearchResult[] };
  }

  async getContents(urls: string[], options: { text: { maxCharacters: number } }): Promise<{ results: ExaContentsResult[] }> {
    const res = await fetch(_CONTENTS_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
      },
      body: JSON.stringify({ urls, text: options.text }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as { results: ExaContentsResult[] };
  }
}

function _getExaClient(toolName = "web_search"): Exa {
  const config = getToolConfig(toolName) as Record<string, unknown> | undefined;
  let apiKey: string | undefined;
  if (config !== undefined && "api_key" in config) {
    apiKey = config["api_key"] as string | undefined;
  }
  return new Exa(apiKey);
}

/** `web_search` tool — search the web via Exa. */
export const webSearchTool: StructuredToolInterface = tool(
  async (input: { query: string }): Promise<string> => {
    try {
      const config = getToolConfig("web_search") as Record<string, unknown> | undefined;
      let maxResults = 5;
      let searchType = "auto";
      let contentsMaxCharacters = 1000;
      if (config !== undefined) {
        maxResults = (config["max_results"] as number | undefined) ?? maxResults;
        searchType = (config["search_type"] as string | undefined) ?? searchType;
        contentsMaxCharacters = (config["contents_max_characters"] as number | undefined) ?? contentsMaxCharacters;
      }

      const client = _getExaClient();
      const res = await client.search(input.query, {
        type: searchType,
        numResults: maxResults,
        contents: { highlights: { maxCharacters: contentsMaxCharacters } },
      });

      const normalizedResults = res.results.map((result) => ({
        title: result.title ?? "",
        url: result.url ?? "",
        snippet: result.highlights && result.highlights.length > 0 ? result.highlights.join("\n") : "",
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

/** `web_fetch` tool — fetch the contents of a web page via Exa. */
export const webFetchTool: StructuredToolInterface = tool(
  async (input: { url: string }): Promise<string> => {
    try {
      const client = _getExaClient("web_fetch");
      const res = await client.getContents([input.url], { text: { maxCharacters: 4096 } });

      if (res.results && res.results.length > 0) {
        const result = res.results[0];
        const title = result.title ?? "Untitled";
        const text = result.text ?? "";
        return `# ${title}\n\n${text.slice(0, 4096)}`;
      } else {
        return "Error: No results found";
      }
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
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
