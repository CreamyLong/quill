/**
 * Web Reader Tool — Z.ai Web Reader API.
 *
 * POST https://api.z.ai/api/paas/v4/reader
 * Auth: Bearer <api key> (env ZAI_API_KEY)
 *
 * Docs: https://docs.z.ai/api-reference/tools/web-reader
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

const ZAI_READER_ENDPOINT = "https://api.z.ai/api/paas/v4/reader";

interface ZaiReaderResult {
  content?: string;
  title?: string;
  description?: string;
  url?: string;
  external?: unknown;
  metadata?: Record<string, unknown>;
}

interface ZaiReaderResponse {
  id?: string;
  created?: number;
  request_id?: string;
  model?: string;
  reader_result?: ZaiReaderResult;
}

/** Call the Z.ai web reader API to fetch and extract page content. */
async function zaiWebReader(
  url: string,
  timeout = 20,
  returnFormat = "markdown",
  noCache = false,
  apiKey = process.env.ZAI_API_KEY,
): Promise<string> {
  if (!apiKey) {
    return "Error: ZAI_API_KEY environment variable is not set. Set it to enable Z.ai web reader.";
  }

  const body = JSON.stringify({
    url,
    timeout,
    return_format: returnFormat,
    no_cache: noCache,
    retain_images: true,
  });

  try {
    const response = await fetch(ZAI_READER_ENDPOINT, {
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
      return `Error: Z.ai reader returned HTTP ${response.status}: ${text.slice(0, 200)}`;
    }

    const data = (await response.json()) as ZaiReaderResponse;
    const result = data.reader_result;
    if (!result?.content) {
      return `Error: Z.ai reader returned no content for: "${url}"`;
    }

    const title = result.title ?? "";
    const prefix = title ? `# ${title}\n\n` : "";
    return `${prefix}${result.content}`;
  } catch (err) {
    return `Error: Z.ai reader failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** `web_fetch_zai` tool — fetch and extract web page content via Z.ai. */
export const webFetchZaiTool: StructuredToolInterface = tool(
  async (input: {
    url: string;
    timeout?: number;
    return_format?: string;
    no_cache?: boolean;
  }): Promise<string> => {
    const timeout = input.timeout ?? 20;
    const returnFormat = input.return_format ?? "markdown";
    const noCache = input.no_cache ?? false;
    logger.info(`[zai_web_reader] url="${input.url.slice(0, 120)}" timeout=${timeout}`);
    return zaiWebReader(input.url, timeout, returnFormat, noCache);
  },
  {
    name: "web_fetch_zai",
    description: [
      "Fetch and extract the main content of a web page using Z.ai Web Reader API.",
      "Returns clean markdown/text extracted from the page.",
      "Required: url — the page URL to read.",
      "Optional: timeout (seconds, default 20), return_format (markdown/text, default markdown), no_cache (bool, default false).",
      "Use this when the user asks you to read a specific URL, summarize a webpage, or extract information from a link.",
    ].join("\n"),
    schema: z.object({
      url: z.string().describe("The URL of the web page to fetch and read."),
      timeout: z.number().min(1).max(120).optional().describe("Request timeout in seconds (1-120, default 20)."),
      return_format: z.enum(["markdown", "text"]).optional().describe("Content return format (markdown/text, default markdown)."),
      no_cache: z.boolean().optional().describe("Whether to disable cached results (default false)."),
    }),
  },
);

export { zaiWebReader };
