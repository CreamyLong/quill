/**
 * Custom OpenAI Codex provider using ChatGPT Codex Responses API.
 *
 * Uses Codex CLI OAuth tokens with chatgpt.com/backend-api/codex/responses
 * endpoint. This is the same endpoint that the Codex CLI uses internally.
 *
 * Supports:
 * - Auto-load credentials from ~/.codex/auth.json
 * - Responses API format (not Chat Completions)
 * - Tool calling
 * - Streaming (required by the endpoint)
 * - Retry with exponential backoff
 *
 * TS port of `quill.models.openai_codex_provider`.
 *
 * Deviation: Python uses the synchronous `httpx` client + `iter_lines`; this
 * port uses `fetch` with a streaming reader for SSE. `httpx.HTTPStatusError` is
 * mirrored by {@link HttpStatusError}.
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseChatModelCallOptions, BindToolsInput } from "@langchain/core/language_models/chat_models";
import type { BaseChatModelParams } from "@langchain/core/language_models/chat_models";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import {
  AIMessage,
  AIMessageChunk,
  isAIMessage,
  isHumanMessage,
  isSystemMessage,
  isToolMessage,
} from "@langchain/core/messages";
import type { BaseMessage, ToolCall } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { Runnable, RunnableBinding } from "@langchain/core/runnables";
import { isStructuredTool, convertToOpenAIFunction } from "@langchain/core/utils/function_calling";

import { loadCodexCliCredential } from "./credential_loader.js";
import type { CodexCliCredential } from "./credential_loader.js";

export const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const MAX_RETRIES = 3;

/** Mirror of `httpx.HTTPStatusError` for non-2xx responses. */
export class HttpStatusError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

/**
 * Convert Codex/Responses API usage dict to LangChain usage_metadata format.
 *
 * Maps OpenAI Responses API token usage fields to the dict structure that
 * LangChain AIMessage.usage_metadata expects.
 */
export function buildUsageMetadata(oaiUsage: Record<string, unknown>): Record<string, unknown> {
  const inputTokens = numberOr(oaiUsage.input_tokens, 0);
  const outputTokens = numberOr(oaiUsage.output_tokens, 0);
  const totalTokens = numberOr(oaiUsage.total_tokens, inputTokens + outputTokens);
  const metadata: Record<string, unknown> = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
  const inputDetails = isRecord(oaiUsage.input_tokens_details) ? oaiUsage.input_tokens_details : {};
  const outputDetails = isRecord(oaiUsage.output_tokens_details) ? oaiUsage.output_tokens_details : {};
  const cacheRead = inputDetails.cached_tokens;
  if (cacheRead !== null && cacheRead !== undefined) {
    metadata.input_token_details = { cache_read: cacheRead };
  }
  const reasoning = outputDetails.reasoning_tokens;
  if (reasoning !== null && reasoning !== undefined) {
    metadata.output_token_details = { reasoning };
  }
  return metadata;
}

/**
 * LangChain chat model using ChatGPT Codex Responses API.
 *
 * Config example:
 *     - name: gpt-5.4
 *       use: quill.models.openai_codex_provider:CodexChatModel
 *       model: gpt-5.4
 *       reasoning_effort: medium
 */
export class CodexChatModel extends BaseChatModel {
  model = "gpt-5.4";
  reasoningEffort = "medium";
  retryMaxAttempts: number = MAX_RETRIES;

  private accessToken = "";
  private accountId = "";

  constructor(fields: Record<string, unknown> = {}) {
    super(fields as BaseChatModelParams);

    if (typeof fields.model === "string") {
      this.model = fields.model;
    }
    const reasoningEffort = fields.reasoning_effort ?? fields.reasoningEffort;
    if (typeof reasoningEffort === "string") {
      this.reasoningEffort = reasoningEffort;
    }
    const retryMaxAttempts = fields.retry_max_attempts ?? fields.retryMaxAttempts;
    if (typeof retryMaxAttempts === "number") {
      this.retryMaxAttempts = retryMaxAttempts;
    }

    this.initCredentials();
  }

  static lc_name(): string {
    return "CodexChatModel";
  }

  override lc_serializable = true;

  _llmType(): string {
    return "codex-responses";
  }

  private validateRetryConfig(): void {
    if (this.retryMaxAttempts < 1) {
      throw new Error("retry_max_attempts must be >= 1");
    }
  }

  /** Auto-load Codex CLI credentials. */
  private initCredentials(): void {
    this.validateRetryConfig();

    const cred = this.loadCodexAuth();
    if (cred) {
      this.accessToken = cred.accessToken;
      this.accountId = cred.accountId;
      console.info(`Using Codex CLI credential (account: ${this.accountId.slice(0, 8)}...)`);
    } else {
      throw new Error("Codex CLI credential not found. Expected ~/.codex/auth.json or CODEX_AUTH_PATH.");
    }
  }

  /** Load access_token and account_id from Codex CLI auth. */
  private loadCodexAuth(): CodexCliCredential | null {
    return loadCodexCliCredential();
  }

  /** Flatten LangChain content blocks into plain text for Codex. */
  static normalizeContent(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      const parts = content.map((item) => CodexChatModel.normalizeContent(item));
      return parts.filter((part) => part).join("\n");
    }

    if (isRecord(content)) {
      for (const key of ["text", "output"] as const) {
        const value = content[key];
        if (typeof value === "string") {
          return value;
        }
      }
      const nestedContent = content.content;
      if (nestedContent !== null && nestedContent !== undefined) {
        return CodexChatModel.normalizeContent(nestedContent);
      }
      try {
        return JSON.stringify(content);
      } catch {
        return String(content);
      }
    }

    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }

  /** Convert LangChain messages to Responses API format: [instructions, inputItems]. */
  convertMessages(messages: BaseMessage[]): [string, Record<string, unknown>[]] {
    const instructionsParts: string[] = [];
    const inputItems: Record<string, unknown>[] = [];

    for (const msg of messages) {
      if (isSystemMessage(msg)) {
        const content = CodexChatModel.normalizeContent(msg.content);
        if (content) {
          instructionsParts.push(content);
        }
      } else if (isHumanMessage(msg)) {
        const content = CodexChatModel.normalizeContent(msg.content);
        inputItems.push({ role: "user", content });
      } else if (isAIMessage(msg)) {
        if (msg.content) {
          const content = CodexChatModel.normalizeContent(msg.content);
          inputItems.push({ role: "assistant", content });
        }
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            inputItems.push({
              type: "function_call",
              name: tc.name,
              arguments: isRecord(tc.args) ? JSON.stringify(tc.args) : tc.args,
              call_id: tc.id,
            });
          }
        }
      } else if (isToolMessage(msg)) {
        inputItems.push({
          type: "function_call_output",
          call_id: msg.tool_call_id,
          output: CodexChatModel.normalizeContent(msg.content),
        });
      }
    }

    const instructions = instructionsParts.join("\n\n") || "You are a helpful assistant.";

    return [instructions, inputItems];
  }

  /** Convert LangChain tool format to Responses API format. */
  convertTools(tools: Record<string, unknown>[]): Record<string, unknown>[] {
    const responsesTools: Record<string, unknown>[] = [];
    for (const tool of tools) {
      if (tool.type === "function" && isRecord(tool.function)) {
        const fn = tool.function;
        responsesTools.push({
          type: "function",
          name: fn.name,
          description: fn.description ?? "",
          parameters: fn.parameters ?? {},
        });
      } else if ("name" in tool) {
        responsesTools.push({
          type: "function",
          name: tool.name,
          description: tool.description ?? "",
          parameters: tool.parameters ?? {},
        });
      }
    }
    return responsesTools;
  }

  /** Call the Codex Responses API and return the completed response. */
  private async callCodexApi(messages: BaseMessage[], tools: Record<string, unknown>[] | null = null): Promise<Record<string, unknown>> {
    const [instructions, inputItems] = this.convertMessages(messages);

    const payload: Record<string, unknown> = {
      model: this.model,
      instructions,
      input: inputItems,
      store: false,
      stream: true,
      reasoning: this.reasoningEffort !== "none" ? { effort: this.reasoningEffort, summary: "detailed" } : { effort: "none" },
    };

    if (tools) {
      payload.tools = this.convertTools(tools);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      "ChatGPT-Account-ID": this.accountId,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      originator: "codex_cli_rs",
    };

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.retryMaxAttempts; attempt++) {
      try {
        return await this.streamResponse(headers, payload);
      } catch (e) {
        if (e instanceof HttpStatusError) {
          lastError = e;
          if ([429, 500, 529].includes(e.status)) {
            if (attempt >= this.retryMaxAttempts) {
              throw e;
            }
            const waitMs = 2000 * (1 << (attempt - 1));
            console.warn(`Codex API error ${e.status}, retrying ${attempt}/${this.retryMaxAttempts} after ${waitMs}ms`);
            await sleep(waitMs);
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }
    }

    throw lastError;
  }

  /** Stream SSE from Codex API and collect the final response. */
  private async streamResponse(headers: Record<string, string>, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    let completedResponse: Record<string, unknown> | null = null;
    const streamedOutputItems = new Map<number, Record<string, unknown>>();

    const resp = await fetch(`${CODEX_BASE_URL}/responses`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      throw new HttpStatusError(resp.status, `Codex API returned HTTP ${resp.status}`);
    }
    if (!resp.body) {
      throw new Error("Codex API stream had no response body");
    }

    for await (const line of iterLines(resp.body)) {
      const data = CodexChatModel.parseSseDataLine(line);
      if (!data) {
        continue;
      }

      const eventType = data.type;
      if (eventType === "response.output_item.done") {
        const outputIndex = data.output_index;
        const outputItem = data.item;
        if (typeof outputIndex === "number" && isRecord(outputItem)) {
          streamedOutputItems.set(outputIndex, outputItem);
        }
      } else if (eventType === "response.completed") {
        completedResponse = isRecord(data.response) ? data.response : null;
      }
    }

    if (!completedResponse) {
      throw new Error("Codex API stream ended without response.completed event");
    }

    // ChatGPT Codex can emit the final assistant content only in stream events.
    // When response.completed arrives, response.output may still be empty.
    if (streamedOutputItems.size > 0) {
      let mergedOutput: (Record<string, unknown> | null)[] = [];
      const responseOutput = completedResponse.output;
      if (Array.isArray(responseOutput)) {
        mergedOutput = [...responseOutput];
      }

      const maxIndex = Math.max(Math.max(...streamedOutputItems.keys()), mergedOutput.length - 1);
      if (maxIndex >= 0 && mergedOutput.length <= maxIndex) {
        while (mergedOutput.length < maxIndex + 1) {
          mergedOutput.push(null);
        }
      }

      for (const [outputIndex, outputItem] of streamedOutputItems) {
        const existingItem = mergedOutput[outputIndex];
        if (!isRecord(existingItem)) {
          mergedOutput[outputIndex] = outputItem;
        }
      }

      completedResponse = { ...completedResponse, output: mergedOutput.filter((item): item is Record<string, unknown> => isRecord(item)) };
    }

    return completedResponse;
  }

  /** Parse a data line from the SSE stream, skipping terminal markers. */
  static parseSseDataLine(line: string): Record<string, unknown> | null {
    if (!line.startsWith("data:")) {
      return null;
    }

    const rawData = line.slice(5).trim();
    if (!rawData || rawData === "[DONE]") {
      return null;
    }

    let data: unknown;
    try {
      data = JSON.parse(rawData);
    } catch {
      console.debug(`Skipping non-JSON Codex SSE frame: ${rawData}`);
      return null;
    }

    return isRecord(data) ? data : null;
  }

  /** Parse function-call arguments, surfacing malformed payloads safely. */
  private parseToolCallArguments(outputItem: Record<string, unknown>): [Record<string, unknown> | null, Record<string, unknown> | null] {
    const rawArguments = outputItem.arguments ?? "{}";
    if (isRecord(rawArguments)) {
      return [rawArguments, null];
    }

    const normalizedArguments = (rawArguments as string) || "{}";
    let parsedArguments: unknown;
    try {
      parsedArguments = JSON.parse(normalizedArguments);
    } catch (exc) {
      return [
        null,
        {
          type: "invalid_tool_call",
          name: outputItem.name,
          args: String(rawArguments),
          id: outputItem.call_id,
          error: `Failed to parse tool arguments: ${String(exc)}`,
        },
      ];
    }

    if (!isRecord(parsedArguments)) {
      return [
        null,
        {
          type: "invalid_tool_call",
          name: outputItem.name,
          args: String(rawArguments),
          id: outputItem.call_id,
          error: "Tool arguments must decode to a JSON object.",
        },
      ];
    }

    return [parsedArguments, null];
  }

  /** Parse Codex Responses API response into LangChain ChatResult. */
  private parseResponse(response: Record<string, unknown>): ChatResult {
    let content = "";
    const toolCalls: Record<string, unknown>[] = [];
    const invalidToolCalls: Record<string, unknown>[] = [];
    let reasoningContent = "";

    const output = Array.isArray(response.output) ? response.output : [];
    for (const outputItem of output) {
      if (!isRecord(outputItem)) {
        continue;
      }
      if (outputItem.type === "reasoning") {
        // Extract reasoning summary text.
        const summary = Array.isArray(outputItem.summary) ? outputItem.summary : [];
        for (const summaryItem of summary) {
          if (isRecord(summaryItem) && summaryItem.type === "summary_text") {
            reasoningContent += typeof summaryItem.text === "string" ? summaryItem.text : "";
          } else if (typeof summaryItem === "string") {
            reasoningContent += summaryItem;
          }
        }
      } else if (outputItem.type === "message") {
        const parts = Array.isArray(outputItem.content) ? outputItem.content : [];
        for (const part of parts) {
          if (isRecord(part) && part.type === "output_text") {
            content += typeof part.text === "string" ? part.text : "";
          }
        }
      } else if (outputItem.type === "function_call") {
        const [parsedArguments, invalidToolCall] = this.parseToolCallArguments(outputItem);
        if (invalidToolCall) {
          invalidToolCalls.push(invalidToolCall);
          continue;
        }

        toolCalls.push({
          name: outputItem.name,
          args: parsedArguments ?? {},
          id: outputItem.call_id ?? "",
          type: "tool_call",
        });
      }
    }

    const usage = isRecord(response.usage) ? response.usage : {};
    const usageMetadata = Object.keys(usage).length > 0 ? buildUsageMetadata(usage) : undefined;
    const additionalKwargs: Record<string, unknown> = {};
    if (reasoningContent) {
      additionalKwargs.reasoning_content = reasoningContent;
    }

    const message = new AIMessage({
      content,
      tool_calls: (toolCalls.length > 0 ? toolCalls : []) as unknown as ToolCall[],
      invalid_tool_calls: invalidToolCalls as never,
      additional_kwargs: additionalKwargs,
      usage_metadata: usageMetadata as never,
      response_metadata: {
        model: response.model ?? this.model,
        usage,
      },
    });

    return {
      generations: [{ text: content, message }],
      llmOutput: {
        token_usage: {
          prompt_tokens: numberOr(usage.input_tokens, 0),
          completion_tokens: numberOr(usage.output_tokens, 0),
          total_tokens: numberOr(usage.total_tokens, 0),
        },
        model_name: response.model ?? this.model,
      },
    };
  }

  /** Generate a response using Codex Responses API. */
  async _generate(messages: BaseMessage[], options: this["ParsedCallOptions"], _runManager?: CallbackManagerForLLMRun): Promise<ChatResult> {
    const tools = (options as { tools?: unknown }).tools;
    const response = await this.callCodexApi(messages, Array.isArray(tools) ? (tools as Record<string, unknown>[]) : null);
    return this.parseResponse(response);
  }

  /** Bind tools for function calling. */
  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<BaseChatModelCallOptions>,
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions> {
    const formattedTools: Record<string, unknown>[] = [];
    for (const tool of tools) {
      if (isStructuredTool(tool)) {
        try {
          const fn = convertToOpenAIFunction(tool);
          formattedTools.push({
            type: "function",
            name: fn.name,
            description: fn.description ?? "",
            parameters: fn.parameters ?? {},
          });
        } catch {
          formattedTools.push({
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: { type: "object", properties: {} },
          });
        }
      } else if (isRecord(tool)) {
        if ("function" in tool && isRecord(tool.function)) {
          const fn = tool.function;
          formattedTools.push({
            type: "function",
            name: fn.name,
            description: fn.description ?? "",
            parameters: fn.parameters ?? {},
          });
        } else {
          formattedTools.push(tool);
        }
      }
    }

    return new RunnableBinding({
      bound: this,
      kwargs: { ...(kwargs ?? {}), tools: formattedTools } as Partial<BaseChatModelCallOptions>,
      config: {},
    });
  }
}

/** Async line iterator over a fetch response body (SSE). */
async function* iterLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      yield line;
    }
  }
  if (buffer) {
    yield buffer.replace(/\r$/, "");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
