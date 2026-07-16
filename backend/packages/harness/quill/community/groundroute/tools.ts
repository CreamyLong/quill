/**
 * GroundRoute community web search + fetch tools.
 *
 * TypeScript port of `community/groundroute/tools.py`. GroundRoute is a meta
 * search layer: one API in front of six search engines. This module is
 * self-contained (`fetch` only, no GroundRoute SDK). The /v1/search request and
 * response mapping mirrors the Python provider:
 *   results[] = {url, title, snippet, content, source_engine, published_at}
 *
 * `web_search` returns a normalized JSON list of {title, url, snippet, source_engine}.
 * `web_fetch` reads one URL via GroundRoute mode=page and returns its extracted text.
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

const _GROUNDROUTE_ENDPOINT = "https://api.groundroute.ai/v1/search";
const _DEFAULT_MAX_RESULTS = 5;
// GroundRoute clamps max_results to 1-50 server-side; clamp here too to mirror it.
const _MAX_RESULTS_CAP = 50;
const _FETCH_SNIPPET_LIMIT = 4096;
// Warn at most once per tool ("web_search" / "web_fetch") about a missing key.
const _apiKeyWarned = new Set<string>();

/** Mirrors httpx.HTTPStatusError so the tools can branch on HTTP failures. */
class HTTPStatusError extends Error {
  constructor(readonly status: number, readonly bodyText: string) {
    super(`HTTP ${status}`);
    this.name = "HTTPStatusError";
  }
}

interface GroundRouteResult {
  url?: string;
  title?: string;
  snippet?: string;
  content?: string;
  source_engine?: string;
}

function _getApiKey(toolName: string): string | undefined {
  const config = getToolConfig(toolName) as Record<string, unknown> | undefined;
  if (config !== undefined) {
    const apiKey = config["api_key"];
    if (typeof apiKey === "string" && apiKey.trim()) {
      return apiKey.trim();
    }
  }
  return process.env.GROUNDROUTE_API_KEY;
}

function _coerceMaxResults(value: unknown, defaultVal: number = _DEFAULT_MAX_RESULTS): number {
  let coerced: number;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) {
    logger.warning(`Invalid GroundRoute max_results=${String(value)}; using default ${defaultVal}`);
    coerced = defaultVal;
  } else {
    coerced = Math.trunc(n);
  }
  return Math.max(1, Math.min(coerced, _MAX_RESULTS_CAP));
}

function _missingKeyError(toolName: string, context: Record<string, string>): string {
  if (!_apiKeyWarned.has(toolName)) {
    _apiKeyWarned.add(toolName);
    logger.warning(
      `GroundRoute API key is not set for '${toolName}'. Set GROUNDROUTE_API_KEY in your environment or provide api_key in config.yaml. Get a free key at https://groundroute.ai/keys`,
    );
  }
  return JSON.stringify({ error: "GROUNDROUTE_API_KEY is not configured", ...context });
}

async function _postSearch(apiKey: string, body: Record<string, unknown>): Promise<{ results?: GroundRouteResult[] }> {
  const response = await fetch(_GROUNDROUTE_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new HTTPStatusError(response.status, await response.text());
  }
  return (await response.json()) as { results?: GroundRouteResult[] };
}

/** `web_search` tool — search the web via GroundRoute. */
export const webSearchTool: StructuredToolInterface = tool(
  async (input: { query: string; max_results?: number }): Promise<string> => {
    const query = input.query;
    // Honor the caller-supplied max_results; fall back to config only when omitted.
    let maxResults: unknown = input.max_results;
    if (maxResults === undefined || maxResults === null) {
      const config = getToolConfig("web_search") as Record<string, unknown> | undefined;
      if (config !== undefined) {
        maxResults = config["max_results"];
      }
    }
    const count = maxResults === undefined || maxResults === null ? _DEFAULT_MAX_RESULTS : _coerceMaxResults(maxResults);

    const apiKey = _getApiKey("web_search");
    if (!apiKey) {
      return _missingKeyError("web_search", { query });
    }

    let data: { results?: GroundRouteResult[] };
    try {
      data = await _postSearch(apiKey, { query, max_results: count });
    } catch (e) {
      if (e instanceof HTTPStatusError) {
        logger.error(`GroundRoute API returned HTTP ${e.status}: ${e.bodyText}`);
        return JSON.stringify({ error: `GroundRoute API error: HTTP ${e.status}`, query });
      }
      logger.error(`GroundRoute search failed: ${e instanceof Error ? e.message : String(e)}`);
      return JSON.stringify({ error: e instanceof Error ? e.message : String(e), query });
    }

    const results = data.results ?? [];
    if (results.length === 0) {
      return JSON.stringify({ error: "No results found", query });
    }

    const normalizedResults = results.map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.snippet ?? "",
      source_engine: r.source_engine ?? "",
    }));
    return JSON.stringify(normalizedResults, null, 2);
  },
  {
    name: "web_search",
    description: "Search the web for information using GroundRoute.",
    schema: z.object({
      query: z.string().describe("Search keywords describing what you want to find. Be specific for better results."),
      max_results: z
        .number()
        .int()
        .optional()
        .describe(
          "Maximum number of search results to return. If omitted, uses the configured value (default 5). Clamped to 1-50.",
        ),
    }),
  },
);

/** `web_fetch` tool — fetch page contents via GroundRoute mode=page. */
export const webFetchTool: StructuredToolInterface = tool(
  async (input: { url: string }): Promise<string> => {
    const url = input.url;
    const apiKey = _getApiKey("web_fetch");
    if (!apiKey) {
      return _missingKeyError("web_fetch", { url });
    }

    let data: { results?: GroundRouteResult[] };
    try {
      data = await _postSearch(apiKey, { query: url, mode: "page", max_results: 1 });
    } catch (e) {
      if (e instanceof HTTPStatusError) {
        logger.error(`GroundRoute fetch returned HTTP ${e.status}: ${e.bodyText}`);
        return `Error: GroundRoute API error: HTTP ${e.status}`;
      }
      logger.error(`GroundRoute fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }

    const results = data.results ?? [];
    if (results.length === 0) {
      return "Error: No results found";
    }

    const result = results[0];
    const content = result.content || result.snippet || "";
    const title = result.title ?? "";
    return `# ${title}\n\n${content.slice(0, _FETCH_SNIPPET_LIMIT)}`;
  },
  {
    name: "web_fetch",
    description: [
      "Fetch the contents of a web page at a given URL via GroundRoute.",
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
