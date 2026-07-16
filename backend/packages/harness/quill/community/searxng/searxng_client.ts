/**
 * Client for the SearXNG meta search engine API.
 *
 * TypeScript port of `community/searxng/searxng_client.py`. Uses `fetch` in
 * place of `httpx.AsyncClient`.
 */

const logger = {
  debug: (...a: unknown[]) => console.debug(...a),
  info: (...a: unknown[]) => console.info(...a),
  warning: (...a: unknown[]) => console.warn(...a),
  error: (...a: unknown[]) => console.error(...a),
};

export class SearxngClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /** Search the web using SearXNG. */
  async search(query: string, maxResults = 5, categories: string[] | null = null): Promise<Array<Record<string, unknown>>> {
    const params = new URLSearchParams({
      q: query,
      format: "json",
      language: "auto",
      pageno: "1",
    });
    if (maxResults) {
      params.set("limit", String(maxResults));
    }
    if (categories) {
      params.set("categories", categories.join(","));
    }

    logger.debug(`Searching SearXNG at ${this.baseUrl} with query: ${query}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const resp = await fetch(`${this.baseUrl}/search?${params.toString()}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Quill/1.0)",
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      if (!resp.ok) {
        logger.error(`SearXNG search returned error status: HTTP ${resp.status}`);
        throw new Error(`SearXNG search returned error status: HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { results?: Array<Record<string, unknown>> };
      const results = data.results ?? [];
      return maxResults ? results.slice(0, maxResults) : results;
    } catch (e) {
      logger.error(`SearXNG search request failed: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
