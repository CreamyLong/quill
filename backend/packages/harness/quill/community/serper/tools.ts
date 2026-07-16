/**
 * Web and image search tools powered by Serper (Google Search API).
 *
 * TypeScript port of `community/serper/tools.py`. Uses `fetch` in place of
 * `httpx`. Serper provides real-time Google Search and Google Images results
 * via a JSON API. An API key is required. Sign up at https://serper.dev.
 *
 * The `_safePublicUrl` SSRF guard and its obfuscated-IPv4 decoding
 * (`_decodeIpv4`) mirror the Python `ipaddress`-based checks: non-http(s)
 * schemes, localhost, and private/non-global IP literals are rejected.
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

const _SERPER_SEARCH_ENDPOINT = "https://google.serper.dev/search";
const _SERPER_IMAGES_ENDPOINT = "https://google.serper.dev/images";
const _SERPER_MAX_RESULTS = 10;
const _apiKeyWarned = new Set<string>();

/** Mirrors httpx.HTTPStatusError so `_serperPost` can branch on HTTP failures. */
class HTTPStatusError extends Error {
  constructor(readonly status: number, readonly bodyText: string) {
    super(`HTTP ${status}`);
    this.name = "HTTPStatusError";
  }
}

function _getApiKey(toolName: string): string | undefined {
  const config = getToolConfig(toolName) as Record<string, unknown> | undefined;
  if (config !== undefined) {
    const apiKey = config["api_key"];
    if (typeof apiKey === "string" && apiKey.trim()) {
      return apiKey.trim();
    }
  }
  const envKey = process.env.SERPER_API_KEY;
  if (typeof envKey === "string" && envKey.trim()) {
    return envKey.trim();
  }
  return undefined;
}

/** Coerce config/parameter input into a bounded positive result count. */
function _coerceMaxResults(value: unknown, defaultVal = 5, maxAllowed: number = _SERPER_MAX_RESULTS): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) {
    return defaultVal;
  }
  const count = Math.trunc(n);
  if (count <= 0) {
    return defaultVal;
  }
  return Math.min(count, maxAllowed);
}

function _missingKeyError(query: string, toolName: string): string {
  if (!_apiKeyWarned.has(toolName)) {
    _apiKeyWarned.add(toolName);
    logger.warning(
      `Serper API key is not set for '${toolName}'. Set SERPER_API_KEY in your environment or provide api_key in config.yaml. Sign up at https://serper.dev`,
    );
  }
  return JSON.stringify({ error: "SERPER_API_KEY is not configured", query });
}

function _unexpectedFormatError(query: string): string {
  return JSON.stringify({ error: "Serper returned an unexpected response format", query });
}

function _responseItems(
  data: Record<string, unknown>,
  field: string,
  query: string,
): [Array<Record<string, unknown>> | null, string | null] {
  const items = data[field];
  // Treat a missing or null field as "no results".
  if (items === undefined || items === null) {
    return [[], null];
  }
  if (!Array.isArray(items)) {
    logger.error(`Serper returned unexpected '${field}' payload type: ${typeof items}`);
    return [null, _unexpectedFormatError(query)];
  }
  return [items.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item)), null];
}

/** Normalize a raw query into the value actually sent to Serper. */
function _cleanQuery(query: string): string {
  query = query.trim();
  if (query.length > 500) {
    query = query.slice(0, 500);
  }
  return query;
}

// ── IP-literal helpers (mirror Python's `ipaddress` module) ──────────────────

interface IpAddr {
  version: 4 | 6;
  isGlobal: boolean;
}

function _ipv4InCidr(value: number, baseStr: string, prefix: number): boolean {
  const base = _dottedQuadToInt(baseStr);
  if (base === null) {
    return false;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ((value & mask) >>> 0) === ((base & mask) >>> 0);
}

function _dottedQuadToInt(host: string): number | null {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) {
      return null;
    }
    if (p.length > 1 && p[0] === "0") {
      return null;
    }
    const n = Number(p);
    if (n > 255) {
      return null;
    }
    value = value * 256 + n;
  }
  return value;
}

function _ipv4IsGlobal(value: number): boolean {
  const notGlobal: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
    ["255.255.255.255", 32],
  ];
  for (const [base, prefix] of notGlobal) {
    if (_ipv4InCidr(value, base, prefix)) {
      return false;
    }
  }
  return true;
}

/** Parse a standard IPv4/IPv6 literal, mirroring `ipaddress.ip_address`. Returns null on ValueError. */
function _ipAddress(host: string): IpAddr | null {
  if (host.includes(":")) {
    return _parseIpv6(host);
  }
  const v4 = _dottedQuadToInt(host);
  if (v4 === null) {
    return null;
  }
  return { version: 4, isGlobal: _ipv4IsGlobal(v4) };
}

/** Best-effort IPv6 parser + is_global classifier (common reserved ranges). */
function _parseIpv6(host: string): IpAddr | null {
  let embeddedGlobal: boolean | null = null;
  let text = host;

  // Embedded IPv4 (e.g. ::ffff:1.2.3.4)
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = _dottedQuadToInt(tail);
    if (v4 === null) {
      return null;
    }
    embeddedGlobal = _ipv4IsGlobal(v4);
    const hi = Math.floor(v4 / 65536);
    const lo = v4 % 65536;
    text = text.slice(0, lastColon + 1) + hi.toString(16) + ":" + lo.toString(16);
  }

  const doubleColon = text.split("::");
  if (doubleColon.length > 2) {
    return null;
  }

  let groups: number[];
  if (doubleColon.length === 2) {
    const head = doubleColon[0] ? doubleColon[0].split(":") : [];
    const tailParts = doubleColon[1] ? doubleColon[1].split(":") : [];
    const missing = 8 - (head.length + tailParts.length);
    if (missing < 0) {
      return null;
    }
    groups = [...head, ...Array(missing).fill("0"), ...tailParts].map((g) => parseInt(g, 16));
  } else {
    const parts = text.split(":");
    if (parts.length !== 8) {
      return null;
    }
    groups = parts.map((g) => parseInt(g, 16));
  }
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) {
    return null;
  }

  const allZero = groups.every((g) => g === 0);
  const isLoopback = groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1;
  const isLinkLocal = (groups[0] & 0xffc0) === 0xfe80;
  const isUniqueLocal = (groups[0] & 0xfe00) === 0xfc00;
  const isMulticast = (groups[0] & 0xff00) === 0xff00;
  const isV4Mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;

  if (isV4Mapped && embeddedGlobal !== null) {
    return { version: 6, isGlobal: embeddedGlobal };
  }
  const isGlobal = !(allZero || isLoopback || isLinkLocal || isUniqueLocal || isMulticast);
  return { version: 6, isGlobal };
}

/**
 * Decode obfuscated IPv4 literals that `_ipAddress` rejects (integer, hex,
 * octal encodings). Returns null when the host is not an obfuscated IPv4.
 */
function _decodeIpv4(host: string): IpAddr | null {
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) {
    return null;
  }

  const values: number[] = [];
  for (const part of parts) {
    if (!part) {
      return null;
    }
    let n: number;
    if (part.startsWith("0x") || part.startsWith("0X")) {
      const digits = part.slice(2);
      if (!/^[0-9a-fA-F]+$/.test(digits)) {
        return null;
      }
      n = parseInt(digits, 16);
    } else if (part.startsWith("0") && part.length > 1) {
      if (!/^[0-7]+$/.test(part)) {
        return null;
      }
      n = parseInt(part, 8);
    } else {
      if (!/^\d+$/.test(part)) {
        return null;
      }
      n = parseInt(part, 10);
    }
    if (Number.isNaN(n)) {
      return null;
    }
    values.push(n);
  }

  const leading = values.slice(0, -1);
  const last = values[values.length - 1];
  for (const value of leading) {
    if (value < 0 || value > 0xff) {
      return null;
    }
  }
  const maxLast = Math.pow(2, 8 * (4 - leading.length)) - 1;
  if (last < 0 || last > maxLast) {
    return null;
  }

  let result = 0;
  for (const value of leading) {
    result = result * 256 + value;
  }
  result = result * Math.pow(2, 8 * (4 - leading.length)) + last;
  return { version: 4, isGlobal: _ipv4IsGlobal(result >>> 0) };
}

/** Return true when value is a non-empty URL string. */
function _isUrlPresent(value: unknown): boolean {
  return typeof value === "string" && Boolean(value.trim());
}

/** Return value only if it is a safe, public http(s) URL, else "". */
function _safePublicUrl(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const url = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const scheme = parsed.protocol.replace(/:$/, "");
  if ((scheme !== "http" && scheme !== "https") || !parsed.host || !parsed.hostname) {
    return "";
  }

  // Strip IPv6 brackets and a single trailing dot (FQDN root label).
  let host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  if (!host) {
    return "";
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    return "";
  }

  let ip = _ipAddress(host);
  if (ip === null) {
    ip = _decodeIpv4(host);
    if (ip === null) {
      return url;
    }
  }
  return ip.isGlobal ? url : "";
}

async function _serperPost(
  endpoint: string,
  apiKey: string,
  query: string,
  maxResults: number,
): Promise<[Record<string, unknown> | null, string | null]> {
  const headers = {
    "X-API-KEY": apiKey,
    "Content-Type": "application/json",
  };
  const payload = { q: query, num: maxResults };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new HTTPStatusError(response.status, await response.text());
    }
    const data = await response.json();
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      logger.error(`Serper returned an unexpected payload type: ${typeof data}`);
      return [null, _unexpectedFormatError(query)];
    }
    return [data as Record<string, unknown>, null];
  } catch (e) {
    if (e instanceof HTTPStatusError) {
      const respText = (e.bodyText || "").slice(0, 500);
      logger.error(`Serper API returned HTTP ${e.status}: ${respText}`);
      return [null, JSON.stringify({ error: `Serper API error: HTTP ${e.status}`, query })];
    }
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    logger.error(`Serper request failed: ${msg}`);
    return [null, JSON.stringify({ error: msg, query })];
  }
}

function _str(r: Record<string, unknown>, key: string): string {
  const v = r[key];
  return typeof v === "string" ? v : "";
}

/** `web_search` tool — search the web via Serper. */
export const webSearchTool: StructuredToolInterface = tool(
  async (input: { query: string; max_results?: number }): Promise<string> => {
    let maxResults: unknown = input.max_results ?? 5;
    const config = getToolConfig("web_search") as Record<string, unknown> | undefined;
    if (config !== undefined && "max_results" in config) {
      maxResults = config["max_results"];
    }
    const count = _coerceMaxResults(maxResults);
    const query = _cleanQuery(input.query);

    const apiKey = _getApiKey("web_search");
    if (!apiKey) {
      return _missingKeyError(query, "web_search");
    }

    const [data, postError] = await _serperPost(_SERPER_SEARCH_ENDPOINT, apiKey, query, count);
    if (postError !== null) {
      return postError;
    }

    const [organic, itemsError] = _responseItems(data as Record<string, unknown>, "organic", query);
    if (itemsError !== null) {
      return itemsError;
    }
    if (!organic || organic.length === 0) {
      return JSON.stringify({ error: "No results found", query });
    }

    const normalizedResults = organic.slice(0, count).map((r) => ({
      title: _str(r, "title"),
      url: _str(r, "link"),
      content: _str(r, "snippet"),
    }));

    const output = {
      query,
      total_results: normalizedResults.length,
      results: normalizedResults,
    };
    return JSON.stringify(output, null, 2);
  },
  {
    name: "web_search",
    description: "Search the web for information using Google Search via Serper.",
    schema: z.object({
      query: z.string().describe("Search keywords describing what you want to find. Be specific for better results."),
      max_results: z.number().int().optional().describe("Maximum number of search results to return. Default is 5, capped at 10."),
    }),
  },
);

/** `image_search` tool — search Google Images via Serper (with SSRF guard). */
export const imageSearchTool: StructuredToolInterface = tool(
  async (input: { query: string; max_results?: number }): Promise<string> => {
    let maxResults: unknown = input.max_results ?? 5;
    const config = getToolConfig("image_search") as Record<string, unknown> | undefined;
    if (config !== undefined && "max_results" in config) {
      maxResults = config["max_results"];
    }
    const count = _coerceMaxResults(maxResults);
    const query = _cleanQuery(input.query);

    const apiKey = _getApiKey("image_search");
    if (!apiKey) {
      return _missingKeyError(query, "image_search");
    }

    const [data, postError] = await _serperPost(_SERPER_IMAGES_ENDPOINT, apiKey, query, count);
    if (postError !== null) {
      return postError;
    }

    const [images, itemsError] = _responseItems(data as Record<string, unknown>, "images", query);
    if (itemsError !== null) {
      return itemsError;
    }
    if (!images || images.length === 0) {
      return JSON.stringify({ error: "No images found", query });
    }

    const normalizedResults: Array<{ title: string; image_url: string; thumbnail_url: string }> = [];
    for (const r of images) {
      const rawImage = r["imageUrl"];
      const rawThumb = r["thumbnailUrl"];
      const safeImage = _safePublicUrl(rawImage);
      const safeThumb = _safePublicUrl(rawThumb);
      const imageUrl = safeImage || (!_isUrlPresent(rawImage) ? safeThumb : "");
      const thumbnailUrl = safeThumb || (!_isUrlPresent(rawThumb) ? safeImage : "");
      if (!imageUrl && !thumbnailUrl) {
        continue;
      }
      normalizedResults.push({
        title: _str(r, "title"),
        image_url: imageUrl,
        thumbnail_url: thumbnailUrl,
      });
      if (normalizedResults.length >= count) {
        break;
      }
    }

    if (normalizedResults.length === 0) {
      return JSON.stringify({ error: "No safe image URLs found", query });
    }

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
      "Search for images online using Google Images via Serper. Use this tool BEFORE image generation to find reference images for characters, portraits, objects, scenes, or any content requiring visual accuracy.\n\nThe returned image URLs can be used as reference images in image generation to significantly improve quality.",
    schema: z.object({
      query: z.string().describe("Search keywords describing the images you want to find. Be specific for better results."),
      max_results: z.number().int().optional().describe("Maximum number of images to return. Default is 5, capped at 10."),
    }),
  },
);
