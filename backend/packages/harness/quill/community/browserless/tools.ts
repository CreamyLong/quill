/**
 * Web fetch tool backed by Browserless (headless Chrome).
 *
 * TypeScript port of `community/browserless/tools.py`. Renders a page's HTML via
 * `BrowserlessClient` and converts it to Markdown with the ported
 * `ReadabilityExtractor`.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { getToolConfig } from "../../config/app_config.js";
import { ReadabilityExtractor } from "../../utils/readability.js";
import { BrowserlessClient } from "./browserless_client.js";

const logger = {
  debug: (...a: unknown[]) => console.debug(...a),
  info: (...a: unknown[]) => console.info(...a),
  warning: (...a: unknown[]) => console.warn(...a),
  error: (...a: unknown[]) => console.error(...a),
};

const _readabilityExtractor = new ReadabilityExtractor();

/** Get tool config extras safely, returning null if not configured. */
function _getToolConfig(toolName: string): Record<string, unknown> | null {
  const config = getToolConfig(toolName) as Record<string, unknown> | undefined;
  if (config === undefined) {
    return null;
  }
  return config;
}

function _getBrowserlessClient(): BrowserlessClient {
  const cfg = _getToolConfig("web_fetch");
  let baseUrl = "http://localhost:3032";
  let token = "";
  let timeoutS = 30.0;
  if (cfg !== null) {
    baseUrl = (cfg["base_url"] as string | undefined) ?? baseUrl;
    token = (cfg["token"] as string | undefined) ?? token;
    const raw = cfg["timeout_s"] ?? timeoutS;
    timeoutS = typeof raw === "number" ? raw : Number(raw);
  }
  return new BrowserlessClient(baseUrl, token, timeoutS);
}

/** `web_fetch` tool — fetch page contents via Browserless (headless Chrome). */
export const webFetchTool: StructuredToolInterface = tool(
  async (input: { url: string }): Promise<string> => {
    try {
      const cfg = _getToolConfig("web_fetch");

      let waitForEvent = "";
      let waitForTimeoutMs = 0;
      let waitForSelector = "";
      const waitForSelectorTimeoutMs = 5000;
      const rejectResourceTypes: string[] | null = null;
      const rejectRequestPattern: string[] | null = null;

      if (cfg !== null) {
        waitForEvent = (cfg["wait_for_event"] as string | undefined) ?? waitForEvent;
        const rawWait = cfg["wait_for_timeout_ms"] ?? waitForTimeoutMs;
        waitForTimeoutMs = typeof rawWait === "number" ? rawWait : parseInt(String(rawWait), 10);
        waitForSelector = (cfg["wait_for_selector"] as string | undefined) ?? waitForSelector;
      }

      const client = _getBrowserlessClient();
      const html = await client.fetchHtml(
        input.url,
        waitForEvent,
        waitForTimeoutMs,
        waitForSelector,
        waitForSelectorTimeoutMs,
        rejectResourceTypes,
        rejectRequestPattern,
      );

      if (html.startsWith("Error:")) {
        return html;
      }

      const article = _readabilityExtractor.extractArticle(html);
      return article.toMarkdown().slice(0, 4096);
    } catch (e) {
      logger.error(`Error in web_fetch_tool: ${e instanceof Error ? e.message : String(e)}`);
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
  {
    name: "web_fetch",
    description: [
      "Fetch the contents of a web page at a given URL using Browserless (headless Chrome).",
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
