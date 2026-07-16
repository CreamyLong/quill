/**
 * Web search / fetch / image search tools backed by InfoQuest (BytePlus).
 *
 * TypeScript port of `community/infoquest/tools.py`.
 */

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { getToolConfig } from "../../config/app_config.js";
import { ReadabilityExtractor } from "../../utils/readability.js";
import { InfoQuestClient } from "./infoquest_client.js";

const readabilityExtractor = new ReadabilityExtractor();

function _getInfoquestClient(): InfoQuestClient {
  const searchConfig = getToolConfig("web_search") as Record<string, unknown> | undefined;
  let searchTimeRange = -1;
  if (searchConfig !== undefined && "search_time_range" in searchConfig) {
    searchTimeRange = searchConfig["search_time_range"] as number;
  }

  const fetchConfig = getToolConfig("web_fetch") as Record<string, unknown> | undefined;
  let fetchTime = -1;
  if (fetchConfig !== undefined && "fetch_time" in fetchConfig) {
    fetchTime = fetchConfig["fetch_time"] as number;
  }
  let fetchTimeout = -1;
  if (fetchConfig !== undefined && "timeout" in fetchConfig) {
    fetchTimeout = fetchConfig["timeout"] as number;
  }
  let navigationTimeout = -1;
  if (fetchConfig !== undefined && "navigation_timeout" in fetchConfig) {
    navigationTimeout = fetchConfig["navigation_timeout"] as number;
  }

  const imageSearchConfig = getToolConfig("image_search") as Record<string, unknown> | undefined;
  let imageSearchTimeRange = -1;
  if (imageSearchConfig !== undefined && "image_search_time_range" in imageSearchConfig) {
    imageSearchTimeRange = imageSearchConfig["image_search_time_range"] as number;
  }
  let imageSize = "i";
  if (imageSearchConfig !== undefined && "image_size" in imageSearchConfig) {
    imageSize = imageSearchConfig["image_size"] as string;
  }

  return new InfoQuestClient({
    searchTimeRange,
    fetchTimeout,
    fetchNavigationTimeout: navigationTimeout,
    fetchTime,
    imageSearchTimeRange,
    imageSize,
  });
}

/** `web_search` tool — search the web via InfoQuest. */
export const webSearchTool: StructuredToolInterface = tool(
  async (input: { query: string }): Promise<string> => {
    const client = _getInfoquestClient();
    return client.webSearch(input.query);
  },
  {
    name: "web_search",
    description: "Search the web.",
    schema: z.object({
      query: z.string().describe("The query to search for."),
    }),
  },
);

/** `web_fetch` tool — fetch page contents via InfoQuest. */
export const webFetchTool: StructuredToolInterface = tool(
  async (input: { url: string }): Promise<string> => {
    const client = _getInfoquestClient();
    const result = await client.fetch(input.url);
    if (result.startsWith("Error: ")) {
      return result;
    }
    const article = readabilityExtractor.extractArticle(result);
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

/** `image_search` tool — search for images via InfoQuest. */
export const imageSearchTool: StructuredToolInterface = tool(
  async (input: { query: string }): Promise<string> => {
    const client = _getInfoquestClient();
    return client.imageSearch(input.query);
  },
  {
    name: "image_search",
    description:
      "Search for images online. Use this tool BEFORE image generation to find reference images for characters, portraits, objects, scenes, or any content requiring visual accuracy.\n\n**When to use:**\n- Before generating character/portrait images: search for similar poses, expressions, styles\n- Before generating specific objects/products: search for accurate visual references\n- Before generating scenes/locations: search for architectural or environmental references\n- Before generating fashion/clothing: search for style and detail references\n\nThe returned image URLs can be used as reference images in image generation to significantly improve quality.",
    schema: z.object({
      query: z.string().describe("The query to search for images."),
    }),
  },
);
