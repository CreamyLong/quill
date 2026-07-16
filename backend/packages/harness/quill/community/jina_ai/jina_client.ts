/**
 * Jina AI Reader client.
 *
 * TypeScript port of `community/jina_ai/jina_client.py`. Uses `fetch` in place
 * of `httpx.AsyncClient`. `proxy` / `trust_env` are accepted for signature
 * parity but not applied (Node's global `fetch` has no direct equivalent); see
 * the port report.
 */

const logger = {
  debug: (...a: unknown[]) => console.debug(...a),
  info: (...a: unknown[]) => console.info(...a),
  warning: (...a: unknown[]) => console.warn(...a),
  error: (...a: unknown[]) => console.error(...a),
};

let _apiKeyWarned = false;

export class JinaClient {
  async crawl(
    url: string,
    returnFormat = "html",
    timeout = 10,
    proxy: string | null = null,
    trustEnv = true,
  ): Promise<string> {
    void proxy;
    void trustEnv;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Return-Format": returnFormat,
      "X-Timeout": String(timeout),
    };
    if (process.env.JINA_API_KEY) {
      headers["Authorization"] = `Bearer ${process.env.JINA_API_KEY}`;
    } else if (!_apiKeyWarned) {
      _apiKeyWarned = true;
      logger.warning(
        "Jina API key is not set. Provide your own key to access a higher rate limit. See https://jina.ai/reader for more information.",
      );
    }
    const data = { url };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout * 1000);
      let response: Response;
      try {
        response = await fetch("https://r.jina.ai/", {
          method: "POST",
          headers,
          body: JSON.stringify(data),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const bodyText = await response.text();
      if (response.status !== 200) {
        const errorMessage = `Jina API returned status ${response.status}: ${bodyText}`;
        logger.error(errorMessage);
        return `Error: ${errorMessage}`;
      }

      if (!bodyText || !bodyText.trim()) {
        const errorMessage = "Jina API returned empty response";
        logger.error(errorMessage);
        return `Error: ${errorMessage}`;
      }

      return bodyText;
    } catch (e) {
      const errorMessage = `Request to Jina API failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`;
      logger.warning(errorMessage);
      return `Error: ${errorMessage}`;
    }
  }
}
