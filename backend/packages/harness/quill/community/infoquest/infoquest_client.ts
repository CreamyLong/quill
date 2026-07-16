/**
 * Util that calls the InfoQuest (BytePlus) Search And Fetch API.
 *
 * TypeScript port of `community/infoquest/infoquest_client.py`. Uses `fetch` in
 * place of `requests`; the synchronous Python methods become async here.
 *
 * Setup instructions:
 * https://docs.byteplus.com/en/docs/InfoQuest/What_is_Info_Quest
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const logger = {
  debug: (...a: unknown[]) => console.debug(...a),
  info: (...a: unknown[]) => console.info(...a),
  warning: (...a: unknown[]) => console.warn(...a),
  error: (...a: unknown[]) => console.error(...a),
};

export interface InfoQuestClientOptions {
  fetchTime?: number;
  fetchTimeout?: number;
  fetchNavigationTimeout?: number;
  searchTimeRange?: number;
  imageSearchTimeRange?: number;
  imageSize?: string;
}

/** Client for interacting with the InfoQuest web search and fetch API. */
export class InfoQuestClient {
  private readonly fetchTime: number;
  private readonly fetchTimeout: number;
  private readonly fetchNavigationTimeout: number;
  private readonly searchTimeRange: number;
  private readonly imageSearchTimeRange: number;
  private readonly imageSize: string;
  private readonly apiKeySet: boolean;

  constructor(options: InfoQuestClientOptions = {}) {
    logger.info(
      "\n============================================\n🚀 BytePlus InfoQuest Client Initialization 🚀\n============================================",
    );

    this.fetchTime = options.fetchTime ?? -1;
    this.fetchTimeout = options.fetchTimeout ?? -1;
    this.fetchNavigationTimeout = options.fetchNavigationTimeout ?? -1;
    this.searchTimeRange = options.searchTimeRange ?? -1;
    this.imageSearchTimeRange = options.imageSearchTimeRange ?? -1;
    this.imageSize = options.imageSize ?? "i";
    this.apiKeySet = Boolean(process.env.INFOQUEST_API_KEY);
  }

  async fetch(url: string, returnFormat = "html"): Promise<string> {
    // Prepare headers
    const headers = InfoQuestClient._prepareHeaders();

    // Prepare request data
    const data = this._prepareCrawlRequestData(url, returnFormat);

    logger.debug("Sending crawl request to InfoQuest API");
    try {
      const response = await fetch("https://reader.infoquest.bytepluses.com", {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      });

      const text = await response.text();

      // Check if status code is not 200
      if (response.status !== 200) {
        const errorMessage = `fetch API returned status ${response.status}: ${text}`;
        return `Error: ${errorMessage}`;
      }

      // Check for empty response
      if (!text || !text.trim()) {
        const errorMessage = "no result found";
        return `Error: ${errorMessage}`;
      }

      // Try to parse response as JSON and extract reader_result
      try {
        const responseData = JSON.parse(text);
        if (responseData && typeof responseData === "object" && !Array.isArray(responseData)) {
          if ("reader_result" in responseData) {
            return responseData["reader_result"];
          } else if ("content" in responseData) {
            return responseData["content"];
          } else {
            logger.warning("Neither reader_result nor content field found in JSON response");
          }
        }
      } catch {
        // If response is not JSON, return the original text
        return text;
      }

      return text;
    } catch (e) {
      const errorMessage = `fetch API failed: ${e instanceof Error ? e.message : String(e)}`;
      logger.error(errorMessage);
      return `Error: ${errorMessage}`;
    }
  }

  /** Prepare request headers. */
  private static _prepareHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Add API key if available
    if (process.env.INFOQUEST_API_KEY) {
      headers["Authorization"] = `Bearer ${process.env.INFOQUEST_API_KEY}`;
    } else {
      logger.warning("InfoQuest API key is not set. Provide your own key for authentication.");
    }

    return headers;
  }

  /** Prepare request data with formatted parameters. */
  private _prepareCrawlRequestData(url: string, returnFormat: string): Record<string, unknown> {
    // Normalize return_format
    const normalizedFormat = returnFormat && returnFormat.toLowerCase() === "html" ? "HTML" : returnFormat;

    const data: Record<string, unknown> = { url, format: normalizedFormat };

    // Add timeout parameters if set to positive values
    const timeoutParams: Record<string, number> = {};
    if (this.fetchTime > 0) {
      timeoutParams["fetch_time"] = this.fetchTime;
    }
    if (this.fetchTimeout > 0) {
      timeoutParams["timeout"] = this.fetchTimeout;
    }
    if (this.fetchNavigationTimeout > 0) {
      timeoutParams["navi_timeout"] = this.fetchNavigationTimeout;
    }

    if (Object.keys(timeoutParams).length > 0) {
      Object.assign(data, timeoutParams);
    }

    return data;
  }

  /** Get results from the InfoQuest Web-Search API. */
  async webSearchRawResults(query: string, site: string, outputFormat = "JSON"): Promise<Record<string, any>> {
    const headers = InfoQuestClient._prepareHeaders();

    const params: Record<string, unknown> = { format: outputFormat, query };
    if (this.searchTimeRange > 0) {
      params["time_range"] = this.searchTimeRange;
    }

    if (site !== "") {
      params["site"] = site;
    }

    const response = await fetch("https://search.infoquest.bytepluses.com", {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    });
    if (!response.ok) {
      throw new Error(`InfoQuest search returned HTTP ${response.status}`);
    }

    return (await response.json()) as Record<string, any>;
  }

  /** Clean results from InfoQuest Web-Search API. */
  static cleanResults(rawResults: Array<Record<string, any>>): Array<Record<string, any>> {
    const seenUrls = new Set<string>();
    const cleanResults: Array<Record<string, any>> = [];

    for (const contentList of rawResults) {
      const content = contentList["content"];
      const results = content["results"];

      if (results["organic"]) {
        const organicResults = results["organic"];
        for (const result of organicResults) {
          const cleanResult: Record<string, any> = { type: "page" };
          if ("title" in result) {
            cleanResult["title"] = result["title"];
          }
          if ("desc" in result) {
            cleanResult["desc"] = result["desc"];
            cleanResult["snippet"] = result["desc"];
          }
          if ("url" in result) {
            cleanResult["url"] = result["url"];
            const url = cleanResult["url"];
            if (typeof url === "string" && url && !seenUrls.has(url)) {
              seenUrls.add(url);
              cleanResults.push(cleanResult);
            }
          }
        }
      }

      if (results["top_stories"]) {
        const news = results["top_stories"];
        for (const obj of news["items"]) {
          const cleanResult: Record<string, any> = { type: "news" };
          if ("time_frame" in obj) {
            cleanResult["time_frame"] = obj["time_frame"];
          }
          if ("source" in obj) {
            cleanResult["source"] = obj["source"];
          }
          const title = obj["title"];
          const url = obj["url"];
          if (title) {
            cleanResult["title"] = title;
          }
          if (url) {
            cleanResult["url"] = url;
          }
          if (title && typeof url === "string" && url && !seenUrls.has(url)) {
            seenUrls.add(url);
            cleanResults.push(cleanResult);
          }
        }
      }
    }

    return cleanResults;
  }

  async webSearch(query: string, site = "", outputFormat = "JSON"): Promise<string> {
    try {
      const rawResults = await this.webSearchRawResults(query, site, outputFormat);
      if ("search_result" in rawResults) {
        const results = rawResults["search_result"];
        const cleanedResults = InfoQuestClient.cleanResults(results["results"]);
        return JSON.stringify(cleanedResults, null, 2);
      } else if ("content" in rawResults) {
        // Fallback to content field if search_result is not available
        const errorMessage = "web search API return wrong format";
        logger.error(`web search API return wrong format, no search_result nor content field found in JSON response`);
        return `Error: ${errorMessage}`;
      } else {
        // If neither field exists, return the original response
        logger.warning("InfoQuest Web-Search - Neither search_result nor content field found in JSON response");
        return JSON.stringify(rawResults, null, 2);
      }
    } catch (e) {
      const errorMessage = `InfoQuest Web-Search - Search tool execution failed | mode=synchronous | error=${e instanceof Error ? e.message : String(e)}`;
      logger.error(errorMessage);
      return `Error: ${errorMessage}`;
    }
  }

  /** Clean image-search results from InfoQuest Web-Search API. */
  static cleanResultsWithImageSearch(rawResults: Array<Record<string, any>>): Array<Record<string, any>> {
    const seenUrls = new Set<string>();
    const cleanResults: Array<Record<string, any>> = [];

    for (const contentList of rawResults) {
      const content = contentList["content"];
      const results = content["results"];

      if (results["images_results"]) {
        const imagesResults = results["images_results"];
        for (const result of imagesResults) {
          const cleanResult: Record<string, any> = {};
          if ("original" in result) {
            cleanResult["image_url"] = result["original"];
            const url = cleanResult["image_url"];
            if (typeof url === "string" && url && !seenUrls.has(url)) {
              seenUrls.add(url);
              cleanResults.push(cleanResult);
            }
          }
          if ("title" in result) {
            cleanResult["title"] = result["title"];
          }
        }
      }
    }

    return cleanResults;
  }

  /** Get image search results from the InfoQuest Web-Search API. */
  async imageSearchRawResults(query: string, site = "", outputFormat = "JSON"): Promise<Record<string, any>> {
    const headers = InfoQuestClient._prepareHeaders();

    const params: Record<string, unknown> = { format: outputFormat, query, search_type: "Images" };

    // Add time_range filter if specified (1-365)
    if (this.imageSearchTimeRange >= 1 && this.imageSearchTimeRange <= 365) {
      params["time_range"] = this.imageSearchTimeRange;
    } else if (this.imageSearchTimeRange > 0) {
      logger.warning(`time_range ${this.imageSearchTimeRange} is out of valid range (1-365), ignoring`);
    }

    // Add site filter if specified
    if (site) {
      params["site"] = site;
    }

    // Add image_size filter if specified
    if (this.imageSize && ["l", "m", "i"].includes(this.imageSize)) {
      params["image_size"] = this.imageSize;
    } else if (this.imageSize) {
      logger.warning(`image_size ${this.imageSize} is not valid, must be 'l', 'm', or 'i'`);
    }

    const response = await fetch("https://search.infoquest.bytepluses.com", {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    });
    if (!response.ok) {
      throw new Error(`InfoQuest image search returned HTTP ${response.status}`);
    }

    return (await response.json()) as Record<string, any>;
  }

  async imageSearch(query: string, site = "", outputFormat = "JSON"): Promise<string> {
    try {
      logger.info("InfoQuest Image Search - Executing search with parameters");
      const rawResults = await this.imageSearchRawResults(query, site, outputFormat);

      if ("search_result" in rawResults) {
        const results = rawResults["search_result"];
        const cleanedResults = InfoQuestClient.cleanResultsWithImageSearch(results["results"]);
        return JSON.stringify(cleanedResults, null, 2);
      } else if ("content" in rawResults) {
        // Fallback to content field if search_result is not available
        const errorMessage = "image search API return wrong format";
        logger.error(`image search API return wrong format, no search_result nor content field found in JSON response`);
        return `Error: ${errorMessage}`;
      } else {
        // If neither field exists, return the original response
        logger.warning("InfoQuest Image Search - Neither search_result nor content field found in JSON response");
        return JSON.stringify(rawResults, null, 2);
      }
    } catch (e) {
      const errorMessage = `InfoQuest Image Search - Image search tool execution failed | mode=synchronous | error=${e instanceof Error ? e.message : String(e)}`;
      logger.error(errorMessage);
      return `Error: ${errorMessage}`;
    }
  }
}
