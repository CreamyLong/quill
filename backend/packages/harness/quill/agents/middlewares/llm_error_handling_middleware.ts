/**
 * LLM error handling middleware with retry/backoff and user-facing fallbacks.
 */

import { AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import type { AppConfig } from "../../config/app_config.js";
import { defaultAppConfig } from "../../config/app_config.js";
import type { MiddlewareDefinition, ModelRequest } from "../factory.js";

const RETRIABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

const BUSY_PATTERNS = [
  "server busy",
  "temporarily unavailable",
  "try again later",
  "please retry",
  "please try again",
  "overloaded",
  "high demand",
  "rate limit",
  "负载较高",
  "服务繁忙",
  "稍后重试",
  "请稍后重试",
];

const QUOTA_PATTERNS = [
  "insufficient_quota",
  "quota",
  "billing",
  "credit",
  "payment",
  "余额不足",
  "超出限额",
  "额度不足",
  "欠费",
];

const AUTH_PATTERNS = [
  "authentication",
  "unauthorized",
  "invalid api key",
  "invalid_api_key",
  "permission",
  "forbidden",
  "access denied",
  "无权",
  "未授权",
];

const STREAM_DROP_EXCEPTIONS = new Set(["StreamChunkTimeoutError"]);

const RETRY_BUDGET_OVERRIDES: Record<string, number> = {
  StreamChunkTimeoutError: 2,
};

function errRecord(exc: Error): Record<string, unknown> {
  return exc as unknown as Record<string, unknown>;
}

export interface LLMErrorHandlingOptions {
  appConfig?: AppConfig;
  retryMaxAttempts?: number;
  retryBaseDelayMs?: number;
  retryCapDelayMs?: number;
}

function matchesAny(detail: string, patterns: readonly string[]): boolean {
  const lowered = detail.toLowerCase();
  return patterns.some((pattern) => lowered.includes(pattern.toLowerCase()));
}

function extractErrorCode(exc: Error): unknown {
  for (const attr of ["code", "error_code"]) {
    const value = errRecord(exc)[attr];
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  const body = errRecord(exc).body;
  if (typeof body === "object" && body !== null) {
    const error = (body as Record<string, unknown>).error;
    if (typeof error === "object" && error !== null) {
      for (const key of ["code", "type"]) {
        const value = (error as Record<string, unknown>)[key];
        if (value !== undefined && value !== "") {
          return value;
        }
      }
    }
  }
  return null;
}

function extractStatusCode(exc: Error): number | null {
  for (const attr of ["status_code", "status"]) {
    const value = errRecord(exc)[attr];
    if (typeof value === "number") {
      return value;
    }
  }
  const response = errRecord(exc).response;
  if (typeof response === "object" && response !== null) {
    const status = (response as Record<string, unknown>).status_code;
    if (typeof status === "number") {
      return status;
    }
  }
  return null;
}

function parseRetryAfterMs(raw: string, headerName: string): number | null {
  try {
    const multiplier = headerName.toLowerCase().includes("ms") ? 1 : 1000;
    return Math.max(0, Math.floor(parseFloat(raw) * multiplier));
  } catch {
    // Ignore parse errors.
  }
  return null;
}

function extractRetryAfterMs(exc: Error): number | null {
  const response = errRecord(exc).response;
  if (typeof response !== "object" || response === null) {
    return null;
  }
  const headers = (response as Record<string, unknown>).headers;
  if (typeof headers !== "object" || headers === null) {
    return null;
  }
  const headerMap = headers as Record<string, unknown>;
  for (const key of [
    "retry-after-ms",
    "Retry-After-Ms",
    "retry-after",
    "Retry-After",
  ]) {
    const raw = headerMap[key];
    if (raw === undefined || raw === null || raw === "") {
      continue;
    }
    const parsed = parseRetryAfterMs(String(raw), key);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function extractErrorDetail(exc: Error): string {
  const detail = exc.message?.trim();
  if (detail) {
    return detail;
  }
  const message = errRecord(exc).message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }
  return exc.constructor.name;
}

function buildErrorFallbackMessage(
  content: string,
  errorType: string,
  reason: string,
  detail: string
): AIMessage {
  return new AIMessage({
    content,
    additional_kwargs: {
      quill_error_fallback: true,
      error_type: errorType,
      error_reason: reason,
      error_detail: detail,
    },
  });
}

function buildUserMessage(exc: Error, reason: string): string {
  if (reason === "quota") {
    return "The configured LLM provider rejected the request because the account is out of quota, billing is unavailable, or usage is restricted. Please fix the provider account and try again.";
  }
  if (reason === "auth") {
    return "The configured LLM provider rejected the request because authentication or access is invalid. Please check the provider credentials and try again.";
  }
  if (reason === "busy" || reason === "transient") {
    if (STREAM_DROP_EXCEPTIONS.has(exc.constructor.name)) {
      return (
        "The model's streaming response was interrupted before it could " +
        "finish. This usually happens when a single response or tool call " +
        "is very large — please ask the assistant to split the work into " +
        "smaller steps, or shorten the requested output, and try again."
      );
    }
    return "The configured LLM provider is temporarily unavailable after multiple retries. Please wait a moment and continue the conversation.";
  }
  return `LLM request failed: ${extractErrorDetail(exc)}`;
}

function buildUserFallbackMessage(exc: Error, reason: string): AIMessage {
  return buildErrorFallbackMessage(
    buildUserMessage(exc, reason),
    exc.constructor.name,
    reason,
    extractErrorDetail(exc)
  );
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CircuitBreaker {
  private state: "closed" | "open" | "half_open" = "closed";
  private failureCount = 0;
  private openUntil = 0;
  private probeInFlight = false;

  constructor(
    private failureThreshold: number,
    private recoveryTimeoutSec: number
  ) {}

  check(): boolean {
    const now = Date.now() / 1000;
    if (this.state === "open") {
      if (now < this.openUntil) {
        return true;
      }
      this.state = "half_open";
      this.probeInFlight = false;
    }
    if (this.state === "half_open") {
      if (this.probeInFlight) {
        return true;
      }
      this.probeInFlight = true;
      return false;
    }
    return false;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.openUntil = 0;
    this.state = "closed";
    this.probeInFlight = false;
  }

  recordFailure(): void {
    if (this.state === "half_open") {
      this.openUntil = Date.now() / 1000 + this.recoveryTimeoutSec;
      this.state = "open";
      this.probeInFlight = false;
      return;
    }
    this.failureCount += 1;
    if (this.failureCount >= this.failureThreshold) {
      this.openUntil = Date.now() / 1000 + this.recoveryTimeoutSec;
      this.state = "open";
      this.probeInFlight = false;
    }
  }
}

/** Retry transient LLM errors and surface graceful assistant messages. */
export function llmErrorHandlingMiddleware(
  options: LLMErrorHandlingOptions = {}
): MiddlewareDefinition {
  const appConfig = options.appConfig ?? defaultAppConfig();
  const retryMaxAttempts = options.retryMaxAttempts ?? 3;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 1000;
  const retryCapDelayMs = options.retryCapDelayMs ?? 8000;
  const failureThreshold = appConfig.circuitBreaker?.failureThreshold ?? 5;
  const recoveryTimeoutSec = appConfig.circuitBreaker?.recoveryTimeoutSec ?? 60;
  const circuit = new CircuitBreaker(failureThreshold, recoveryTimeoutSec);

  function maxAttemptsFor(exc: Error): number {
    const override = RETRY_BUDGET_OVERRIDES[exc.constructor.name];
    if (override === undefined) {
      return retryMaxAttempts;
    }
    return Math.min(override, retryMaxAttempts);
  }

  function classifyError(exc: Error): [boolean, string] {
    const detail = extractErrorDetail(exc);
    const errorCode = extractErrorCode(exc);
    const statusCode = extractStatusCode(exc);

    if (
      matchesAny(detail, QUOTA_PATTERNS) ||
      matchesAny(String(errorCode).toLowerCase(), QUOTA_PATTERNS)
    ) {
      return [false, "quota"];
    }
    if (matchesAny(detail, AUTH_PATTERNS)) {
      return [false, "auth"];
    }

    const excName = exc.constructor.name;
    if (
      [
        "APITimeoutError",
        "APIConnectionError",
        "InternalServerError",
        "ReadError",
        "RemoteProtocolError",
        "StreamChunkTimeoutError",
      ].includes(excName)
    ) {
      return [true, "transient"];
    }
    if (statusCode !== null && RETRIABLE_STATUS_CODES.has(statusCode)) {
      return [true, "transient"];
    }
    if (matchesAny(detail, BUSY_PATTERNS)) {
      return [true, "busy"];
    }
    return [false, "generic"];
  }

  function buildRetryDelayMs(attempt: number, exc: Error): number {
    const retryAfter = extractRetryAfterMs(exc);
    if (retryAfter !== null) {
      return retryAfter;
    }
    const backoff = retryBaseDelayMs * 2 ** Math.max(0, attempt - 1);
    return Math.min(backoff, retryCapDelayMs);
  }

  async function wrapCall(
    request: ModelRequest,
    handler: (request: ModelRequest) => Promise<BaseMessage>
  ): Promise<BaseMessage> {
    if (circuit.check()) {
      return buildErrorFallbackMessage(
        "The configured LLM provider is currently unavailable due to continuous failures. Circuit breaker is engaged to protect the system. Please wait a moment before trying again.",
        "CircuitBreakerOpen",
        "circuit_open",
        "LLM circuit breaker is open"
      );
    }

    let attempt = 1;
    while (true) {
      try {
        const response = await handler(request);
        circuit.recordSuccess();
        return response;
      } catch (error) {
        const exc = error instanceof Error ? error : new Error(String(error));
        const [retriable, reason] = classifyError(exc);
        const maxAttempts = maxAttemptsFor(exc);
        if (retriable && attempt < maxAttempts) {
          const waitMs = buildRetryDelayMs(attempt, exc);
          console.warn(
            `Transient LLM error on attempt ${attempt}/${maxAttempts}; retrying in ${waitMs}ms: ${extractErrorDetail(exc)}`
          );
          await delayMs(waitMs);
          attempt += 1;
          continue;
        }
        console.warn(
          `LLM call failed after ${attempt} attempt(s): ${extractErrorDetail(exc)}`
        );
        if (retriable) {
          circuit.recordFailure();
        }
        return buildUserFallbackMessage(exc, reason);
      }
    }
  }

  return {
    name: "LLMErrorHandlingMiddleware",
    wrapModelCall: wrapCall,
  };
}
