/**
 * Image Search Tool - Search images using DuckDuckGo for reference in image generation.
 *
 * TypeScript port of `community/image_search/tools.py`. The Python module uses
 * the `ddgs` library, which has no Node/TypeScript equivalent available in this
 * port, so `loadDDGS()` returns null (mirroring the Python `ImportError`
 * branch: the tool logs and returns no results).
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

/** Stub for the `ddgs` DDGS client — no TypeScript binding exists. */
interface DDGSClient {
  images(query: string, opts: Record<string, unknown>): Array<Record<string, unknown>> | null;
}

function loadDDGS(): (new (opts: { timeout: number }) => DDGSClient) | null {
  return null;
}

/** Execute image search using DuckDuckGo. */
function _searchImages(
  query: string,
  maxResults = 5,
  region = "wt-wt",
  safesearch = "moderate",
  size?: string | null,
  color?: string | null,
  typeImage?: string | null,
  layout?: string | null,
  licenseImage?: string | null,
): Array<Record<string, unknown>> {
  const DDGSCtor = loadDDGS();
  if (DDGSCtor === null) {
    logger.error("ddgs library not installed. Run: pip install ddgs");
    return [];
  }

  const ddgs = new DDGSCtor({ timeout: 30 });

  try {
    const kwargs: Record<string, unknown> = {
      region,
      safesearch,
      max_results: maxResults,
    };

    if (size) {
      kwargs["size"] = size;
    }
    if (color) {
      kwargs["color"] = color;
    }
    if (typeImage) {
      kwargs["type_image"] = typeImage;
    }
    if (layout) {
      kwargs["layout"] = layout;
    }
    if (licenseImage) {
      kwargs["license_image"] = licenseImage;
    }

    const results = ddgs.images(query, kwargs);
    return results ? Array.from(results) : [];
  } catch (e) {
    logger.error(`Failed to search images: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

function _str(r: Record<string, unknown>, key: string): string {
  const v = r[key];
  return typeof v === "string" ? v : "";
}

/** `image_search` tool — search for images via DuckDuckGo. */
export const imageSearchTool: StructuredToolInterface = tool(
  async (input: { query: string; max_results?: number; size?: string; type_image?: string; layout?: string }): Promise<string> => {
    const query = input.query;
    let maxResults = input.max_results ?? 5;

    const config = getToolConfig("image_search") as Record<string, unknown> | undefined;
    // Override max_results from config if set
    if (config !== undefined && "max_results" in config) {
      maxResults = config["max_results"] as number;
    }

    const results = _searchImages(query, maxResults, "wt-wt", "moderate", input.size, undefined, input.type_image, input.layout);

    if (results.length === 0) {
      return JSON.stringify({ error: "No images found", query });
    }

    const normalizedResults = results.map((r) => ({
      title: _str(r, "title"),
      image_url: _str(r, "thumbnail"),
      thumbnail_url: _str(r, "thumbnail"),
    }));

    const output = {
      query,
      total_results: normalizedResults.length,
      results: normalizedResults,
      usage_hint: "Use the 'image_url' values as reference images in image generation. Download them first if needed.",
    };

    return JSON.stringify(output, null, 2);
  },
  {
    name: "image_search",
    description:
      "Search for images online. Use this tool BEFORE image generation to find reference images for characters, portraits, objects, scenes, or any content requiring visual accuracy.\n\n**When to use:**\n- Before generating character/portrait images: search for similar poses, expressions, styles\n- Before generating specific objects/products: search for accurate visual references\n- Before generating scenes/locations: search for architectural or environmental references\n- Before generating fashion/clothing: search for style and detail references\n\nThe returned image URLs can be used as reference images in image generation to significantly improve quality.",
    schema: z.object({
      query: z.string().describe("Search keywords describing the images you want to find. Be specific for better results."),
      max_results: z.number().int().optional().describe("Maximum number of images to return. Default is 5."),
      size: z.string().optional().describe('Image size filter. Options: "Small", "Medium", "Large", "Wallpaper".'),
      type_image: z.string().optional().describe('Image type filter. Options: "photo", "clipart", "gif", "transparent", "line".'),
      layout: z.string().optional().describe('Layout filter. Options: "Square", "Tall", "Wide".'),
    }),
  },
);
