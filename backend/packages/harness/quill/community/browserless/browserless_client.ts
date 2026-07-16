/**
 * Client for the Browserless headless Chrome API.
 *
 * TypeScript port of `community/browserless/browserless_client.py`. Uses
 * `fetch` (with an `AbortController` timeout) in place of `httpx.AsyncClient`.
 */

const logger = {
  debug: (...a: unknown[]) => console.debug(...a),
  info: (...a: unknown[]) => console.info(...a),
  warning: (...a: unknown[]) => console.warn(...a),
  error: (...a: unknown[]) => console.error(...a),
};

export class BrowserlessClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutS: number;

  constructor(baseUrl: string, token = "", timeoutS = 30) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.timeoutS = timeoutS;
  }

  /**
   * Fetch the rendered HTML of a page using Browserless.
   *
   * Only sends accepted parameters for the current Browserless API version.
   */
  async fetchHtml(
    url: string,
    waitForEvent = "",
    waitForTimeoutMs = 0,
    waitForSelector = "",
    waitForSelectorTimeoutMs = 5000,
    rejectResourceTypes: string[] | null = null,
    rejectRequestPattern: string[] | null = null,
  ): Promise<string> {
    const payload: Record<string, unknown> = { url };

    if (this.token) {
      payload["token"] = this.token;
    }
    if (waitForEvent) {
      payload["waitForEvent"] = waitForEvent;
    }
    if (waitForTimeoutMs > 0) {
      payload["waitForTimeout"] = waitForTimeoutMs;
    }
    if (waitForSelector) {
      payload["waitForSelector"] = {
        selector: waitForSelector,
        timeout: waitForSelectorTimeoutMs,
      };
    }
    if (rejectResourceTypes) {
      payload["rejectResourceTypes"] = rejectResourceTypes;
    }
    if (rejectRequestPattern) {
      payload["rejectRequestPattern"] = rejectRequestPattern;
    }

    logger.debug(`Fetching URL via Browserless: ${url}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutS * 1000);
    try {
      const resp = await fetch(`${this.baseUrl}/content`, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
        signal: controller.signal,
      });

      const code = resp.status;
      const targetCode = resp.headers.get("X-Response-Code") ?? "";
      const targetStatus = resp.headers.get("X-Response-Status") ?? "";

      logger.debug(`Browserless response: code=${code}, target_code=${targetCode}, target_status=${targetStatus}`);

      const html = await resp.text();
      if (code !== 200) {
        return `Error: Browserless HTTP ${code}: ${html.slice(0, 200)}`;
      }

      if (!html || !html.trim()) {
        return "Error: Browserless returned empty response";
      }

      return html;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        return `Error: Browserless request timed out after ${this.timeoutS}s`;
      }
      logger.error(`Browserless request failed: ${e instanceof Error ? e.message : String(e)}`);
      return `Error: Browserless request failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      clearTimeout(timer);
    }
  }
}
