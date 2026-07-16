/**
 * Web fetch tool backed by the Jina AI Reader.
 *
 * TypeScript port of `community/jina_ai/tools.py`. Fetches a page's HTML via
 * `JinaClient` and converts it to Markdown with the ported
 * `ReadabilityExtractor`.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { getToolConfig } from "../../config/app_config.js";
import { ReadabilityExtractor } from "../../utils/readability.js";
import { JinaClient } from "./jina_client.js";

const readabilityExtractor = new ReadabilityExtractor();

function _coerceBool(value: unknown, defaultVal: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return defaultVal;
}

function _coerceTimeout(value: unknown, defaultVal: number): number {
  if (typeof value === "boolean") {
    return defaultVal;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string") {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? defaultVal : n;
  }
  return defaultVal;
}

function _coerceProxy(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const proxy = value.trim();
  return proxy || null;
}

/** `web_fetch` tool — fetch page contents via the Jina AI Reader. */
export const webFetchTool: StructuredToolInterface = tool(
  async (input: { url: string }): Promise<string> => {
    const jinaClient = new JinaClient();
    let timeout = 10;
    let proxy: string | null = null;
    let trustEnv = true;
    const config = getToolConfig("web_fetch") as Record<string, unknown> | undefined;
    if (config !== undefined) {
      timeout = _coerceTimeout(config["timeout"], timeout);
      proxy = _coerceProxy(config["proxy"]);
      trustEnv = _coerceBool(config["trust_env"], trustEnv);
    }
    const htmlContent = await jinaClient.crawl(input.url, "html", timeout, proxy, trustEnv);
    if (typeof htmlContent === "string" && htmlContent.startsWith("Error:")) {
      return htmlContent;
    }
    const article = readabilityExtractor.extractArticle(htmlContent);
    return article.toMarkdown().slice(0, 4096);
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
