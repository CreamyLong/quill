/**
 * Custom Claude provider with OAuth Bearer auth, prompt caching, and smart thinking.
 *
 * Supports two authentication modes:
 *   1. Standard API key (x-api-key header) — default ChatAnthropic behavior
 *   2. Claude Code OAuth token (Authorization: Bearer header)
 *      - Detected by sk-ant-oat prefix
 *      - Requires anthropic-beta: oauth-2025-04-20,claude-code-20250219
 *      - Requires billing header in system prompt for all OAuth requests
 *
 * Auto-loads credentials from explicit runtime handoff:
 *   - $ANTHROPIC_API_KEY environment variable
 *   - $CLAUDE_CODE_OAUTH_TOKEN or $ANTHROPIC_AUTH_TOKEN
 *   - $CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR
 *   - $CLAUDE_CODE_CREDENTIALS_PATH
 *   - ~/.claude/.credentials.json
 *
 * TS port of `quill.models.claude_provider`.
 *
 * Deviations:
 * - Pydantic `PrivateAttr` / `model_post_init` become plain fields plus
 *   constructor-time initialization.
 * - The Python retry loop keys off `anthropic.RateLimitError` /
 *   `anthropic.InternalServerError`; the SDK is not imported here, so the retry
 *   wrapper is preserved as {@link ClaudeChatModel.calcBackoffMs} plus documented
 *   hooks. The billing/caching/thinking payload transforms and OAuth client
 *   patching are ported faithfully but require the LangChain-JS Anthropic request
 *   hooks / client accessor to be wired.
 */

import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { ChatAnthropic } from "@langchain/anthropic";
import type { ChatAnthropicInput } from "@langchain/anthropic";

import { OAUTH_ANTHROPIC_BETAS, isOauthToken, loadClaudeCodeCredential } from "./credential_loader.js";
import type { RequestPayload } from "./patched_openai.js";

export const MAX_RETRIES = 3;
export const THINKING_BUDGET_RATIO = 0.8;

// Billing header required by Anthropic API for OAuth token access.
// Must be the first system prompt block. Format mirrors Claude Code CLI.
// Override with ANTHROPIC_BILLING_HEADER env var if the hardcoded version drifts.
const DEFAULT_BILLING_HEADER = "x-anthropic-billing-header: cc_version=2.1.85.351; cc_entrypoint=cli; cch=6c6d5;";
export const OAUTH_BILLING_HEADER = process.env.ANTHROPIC_BILLING_HEADER || DEFAULT_BILLING_HEADER;

/**
 * ChatAnthropic with OAuth Bearer auth, prompt caching, and smart thinking.
 *
 * Config example:
 *     - name: claude-sonnet-4.6
 *       use: quill.models.claude_provider:ClaudeChatModel
 *       model: claude-sonnet-4-6
 *       max_tokens: 16384
 *       enable_prompt_caching: true
 */
export class ClaudeChatModel extends ChatAnthropic {
  // Custom fields
  enablePromptCaching = true;
  promptCacheSize = 3;
  autoThinkingBudget = true;
  retryMaxAttempts: number = MAX_RETRIES;

  private isOauth = false;
  private oauthAccessToken = "";

  constructor(fields: Record<string, unknown> = {}) {
    super(fields as ChatAnthropicInput);

    if (typeof fields.enable_prompt_caching === "boolean") {
      this.enablePromptCaching = fields.enable_prompt_caching;
    } else if (typeof fields.enablePromptCaching === "boolean") {
      this.enablePromptCaching = fields.enablePromptCaching;
    }
    if (typeof fields.prompt_cache_size === "number") {
      this.promptCacheSize = fields.prompt_cache_size;
    } else if (typeof fields.promptCacheSize === "number") {
      this.promptCacheSize = fields.promptCacheSize;
    }
    if (typeof fields.auto_thinking_budget === "boolean") {
      this.autoThinkingBudget = fields.auto_thinking_budget;
    } else if (typeof fields.autoThinkingBudget === "boolean") {
      this.autoThinkingBudget = fields.autoThinkingBudget;
    }
    if (typeof fields.retry_max_attempts === "number") {
      this.retryMaxAttempts = fields.retry_max_attempts;
    } else if (typeof fields.retryMaxAttempts === "number") {
      this.retryMaxAttempts = fields.retryMaxAttempts;
    }

    this.initCredentials();
  }

  private validateRetryConfig(): void {
    if (this.retryMaxAttempts < 1) {
      throw new Error("retry_max_attempts must be >= 1");
    }
  }

  /** Auto-load credentials and configure OAuth if needed. */
  private initCredentials(): void {
    this.validateRetryConfig();

    let currentKey = this.apiKey ?? this.anthropicApiKey ?? "";

    // Try the explicit Claude Code OAuth handoff sources if no valid key.
    if (!currentKey || currentKey === "your-anthropic-api-key") {
      const cred = loadClaudeCodeCredential();
      if (cred) {
        currentKey = cred.accessToken;
        console.info(`Using Claude Code CLI credential (source: ${cred.source})`);
      } else {
        console.warn("No Anthropic API key or explicit Claude Code OAuth credential found.");
      }
    }

    // Detect OAuth token and configure Bearer auth.
    if (isOauthToken(currentKey)) {
      this.isOauth = true;
      this.oauthAccessToken = currentKey;
      this.apiKey = currentKey;
      // Add required beta headers for OAuth.
      this.clientOptions = {
        ...(this.clientOptions ?? {}),
        defaultHeaders: {
          ...((this.clientOptions?.defaultHeaders as Record<string, string> | undefined) ?? {}),
          "anthropic-beta": OAUTH_ANTHROPIC_BETAS,
        },
      };
      // OAuth tokens have a limit of 4 cache_control blocks — disable prompt caching.
      this.enablePromptCaching = false;
      console.info("OAuth token detected — will use Authorization: Bearer header");
    } else if (currentKey) {
      this.apiKey = currentKey;
    }
  }

  /** Swap api_key -> auth_token on an Anthropic SDK client for OAuth Bearer auth. */
  patchClientOauth(client: unknown): void {
    if (isRecord(client) && "api_key" in client && "auth_token" in client) {
      client.api_key = null;
      client.auth_token = this.oauthAccessToken;
    }
  }

  /** Inject prompt caching, thinking budget, and OAuth billing into a request payload. */
  getRequestPayload(payload: RequestPayload): RequestPayload {
    if (this.isOauth) {
      this.applyOauthBilling(payload);
    }

    if (this.enablePromptCaching) {
      this.applyPromptCaching(payload);
    }

    if (this.autoThinkingBudget) {
      this.applyThinkingBudget(payload);
    }

    return payload;
  }

  /**
   * Inject the billing header block required for all OAuth requests.
   *
   * The billing block is always placed first in the system list, removing any
   * existing occurrence to avoid duplication or out-of-order positioning.
   */
  applyOauthBilling(payload: RequestPayload): void {
    const billingBlock = { type: "text", text: OAUTH_BILLING_HEADER };

    const system = payload.system;
    if (Array.isArray(system)) {
      const filtered = system.filter((b) => !(isRecord(b) && String(b.text ?? "").includes(OAUTH_BILLING_HEADER)));
      payload.system = [billingBlock, ...filtered];
    } else if (typeof system === "string") {
      if (system.includes(OAUTH_BILLING_HEADER)) {
        payload.system = [billingBlock];
      } else {
        payload.system = [billingBlock, { type: "text", text: system }];
      }
    } else {
      payload.system = [billingBlock];
    }

    // Add metadata.user_id required by the API for OAuth billing validation.
    if (!isRecord(payload.metadata)) {
      payload.metadata = {};
    }
    const metadata = payload.metadata as Record<string, unknown>;
    if (!("user_id" in metadata)) {
      // Generate a stable device_id from the machine's hostname.
      const deviceId = createHash("sha256").update(`quill-${hostname()}`).digest("hex");
      const sessionId = randomUUID();
      metadata.user_id = JSON.stringify({
        device_id: deviceId,
        account_uuid: "quill",
        session_id: sessionId,
      });
    }
  }

  /**
   * Apply ephemeral cache_control to system, recent messages, and last tool definition.
   *
   * Uses a budget of MAX_CACHE_BREAKPOINTS (4) breakpoints — the hard limit
   * enforced by both the Anthropic API and AWS Bedrock. Breakpoints are placed
   * on the *last* eligible blocks because later breakpoints cover a larger prefix
   * and yield better cache hit rates.
   */
  applyPromptCaching(payload: RequestPayload): void {
    const MAX_CACHE_BREAKPOINTS = 4;

    const candidates: Record<string, unknown>[] = [];

    // 1. System blocks
    const system = payload.system;
    if (system && Array.isArray(system)) {
      for (const block of system) {
        if (isRecord(block) && block.type === "text") {
          candidates.push(block);
        }
      }
    } else if (system && typeof system === "string") {
      const newBlock: Record<string, unknown> = { type: "text", text: system };
      payload.system = [newBlock];
      candidates.push(newBlock);
    }

    // 2. Recent message blocks
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const cacheStart = Math.max(0, messages.length - this.promptCacheSize);
    for (let i = cacheStart; i < messages.length; i++) {
      const msg = messages[i];
      if (!isRecord(msg)) {
        continue;
      }
      const content = msg.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (isRecord(block)) {
            candidates.push(block);
          }
        }
      } else if (typeof content === "string" && content) {
        const newBlock: Record<string, unknown> = { type: "text", text: content };
        msg.content = [newBlock];
        candidates.push(newBlock);
      }
    }

    // 3. Last tool definition
    const tools = Array.isArray(payload.tools) ? payload.tools : [];
    if (tools.length > 0 && isRecord(tools[tools.length - 1])) {
      candidates.push(tools[tools.length - 1] as Record<string, unknown>);
    }

    // Apply cache_control only to the last MAX_CACHE_BREAKPOINTS candidates.
    for (const block of candidates.slice(-MAX_CACHE_BREAKPOINTS)) {
      block.cache_control = { type: "ephemeral" };
    }
  }

  /** Auto-allocate thinking budget (80% of max_tokens). */
  applyThinkingBudget(payload: RequestPayload): void {
    const thinking = payload.thinking;
    if (!thinking || !isRecord(thinking)) {
      return;
    }
    if (thinking.type !== "enabled") {
      return;
    }
    if (thinking.budget_tokens) {
      return;
    }

    const maxTokens = typeof payload.max_tokens === "number" ? payload.max_tokens : 8192;
    thinking.budget_tokens = Math.trunc(maxTokens * THINKING_BUDGET_RATIO);
  }

  /** Remove cache_control markers before OAuth requests reach Anthropic. */
  static stripCacheControl(payload: RequestPayload): void {
    for (const section of ["system", "messages"] as const) {
      const items = payload[section];
      if (!Array.isArray(items)) {
        continue;
      }
      for (const item of items) {
        if (!isRecord(item)) {
          continue;
        }
        delete item.cache_control;
        const content = item.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (isRecord(block)) {
              delete block.cache_control;
            }
          }
        }
      }
    }

    const tools = payload.tools;
    if (Array.isArray(tools)) {
      for (const tool of tools) {
        if (isRecord(tool)) {
          delete tool.cache_control;
        }
      }
    }
  }

  /** Exponential backoff with a fixed 20% buffer. */
  static calcBackoffMs(attempt: number, error: unknown): number {
    const backoffMs = 2000 * (1 << (attempt - 1));
    const jitterMs = Math.trunc(backoffMs * 0.2);
    let totalMs = backoffMs + jitterMs;

    if (isRecord(error) && isRecord(error.response)) {
      const headers = error.response.headers;
      const retryAfter = isRecord(headers) ? headers["Retry-After"] : undefined;
      if (retryAfter) {
        const parsed = Number.parseInt(String(retryAfter), 10);
        if (!Number.isNaN(parsed)) {
          totalMs = parsed * 1000;
        }
      }
    }

    return totalMs;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
