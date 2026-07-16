/**
 * Chat model adapter for MindIE engine.
 *
 * Addresses compatibility issues including:
 * - Flattening multimodal list contents to strings.
 * - Intercepting and parsing hardcoded XML tool calls into LangChain standard.
 * - Handling stream=true dropping choices when tools are present by falling back
 *   to non-streaming generation and yielding simulated chunks.
 * - Fixing over-escaped newline characters from gateway responses.
 *
 * TS port of `quill.models.mindie_provider`.
 *
 * Deviations:
 * - `httpx.Timeout` (per-phase connect/read/write/pool timeouts) has no
 *   LangChain-JS analogue; the constructor collapses the phases to a single
 *   numeric `timeout` (read timeout).
 * - Python's `ast.literal_eval` fallback for non-JSON tool arguments has no TS
 *   analogue; such values are kept as raw strings.
 * - `html.escape`/`html.unescape` are reimplemented for the subset of entities
 *   the model emits.
 */

import { randomUUID } from "node:crypto";

import { ChatOpenAI } from "@langchain/openai";
import type { ChatOpenAIFields } from "@langchain/openai";
import { AIMessage, AIMessageChunk, HumanMessage, isAIMessage, isToolMessage } from "@langchain/core/messages";
import type { BaseMessage, ToolCall } from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import type { ChatResult } from "@langchain/core/outputs";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";

interface MindieToolCall {
  name: string;
  args: Record<string, unknown>;
  id: string;
}

/**
 * Sanitize incoming messages for MindIE compatibility.
 *
 * MindIE's chat template may fail to parse LangChain's native tool_calls or
 * ToolMessage roles, resulting in 0-token generation errors. This flattens
 * multi-modal list contents into strings and converts tool-related messages into
 * raw text with XML tags expected by the underlying model.
 */
export function fixMessages(messages: BaseMessage[]): BaseMessage[] {
  const fixed: BaseMessage[] = [];
  for (const msg of messages) {
    // Flatten content if it's a list of blocks.
    let text: string;
    if (Array.isArray(msg.content)) {
      const parts: string[] = [];
      for (const block of msg.content) {
        if (typeof block === "string") {
          parts.push(block);
        } else if (isRecord(block) && block.type === "text") {
          parts.push(typeof block.text === "string" ? block.text : "");
        }
      }
      text = parts.join("");
    } else {
      text = (msg.content as string) || "";
    }

    // Convert AIMessage with tool_calls to raw XML text format.
    if (isAIMessage(msg) && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const xmlParts: string[] = [];
      for (const tool of msg.tool_calls) {
        const args = (tool.args ?? {}) as Record<string, unknown>;
        const argsXml = Object.entries(args)
          .map(([k, v]) => {
            const value = typeof v === "string" ? v : JSON.stringify(v);
            return `<parameter=${htmlEscape(String(k))}>${htmlEscape(value)}</parameter>`;
          })
          .join(" ");
        xmlParts.push(`<tool_call> <function=${htmlEscape(String(tool.name))}> ${argsXml} </function> </tool_call>`);
      }
      const fullText = text ? `${text}\n${xmlParts.join("\n")}` : xmlParts.join("\n");
      fixed.push(new AIMessage({ content: fullText.trim() || " " }));
      continue;
    }

    // Wrap tool execution results in XML tags and convert to HumanMessage.
    if (isToolMessage(msg)) {
      const toolResultText = `<tool_response>\n${text}\n</tool_response>`;
      fixed.push(new HumanMessage({ content: toolResultText }));
      continue;
    }

    // Fallback to prevent completely empty message content.
    if (!text.trim()) {
      text = " ";
    }

    msg.content = text;
    fixed.push(msg);
  }

  return fixed;
}

/**
 * Parse XML-style tool calls from model output into LangChain dicts.
 *
 * Returns the cleaned text (with XML blocks removed) and a list of tool call
 * dictionaries formatted for LangChain.
 */
export function parseXmlToolCallToDict(content: string): [string, MindieToolCall[]] {
  if (typeof content !== "string" || !content.includes("<tool_call>")) {
    return [content, []];
  }

  const toolCalls: MindieToolCall[] = [];
  const cleanParts: string[] = [];
  let cursor = 0;
  for (const [start, end, innerContent] of iterToolCallBlocks(content)) {
    cleanParts.push(content.slice(cursor, start));
    cursor = end;

    const funcMatch = /<function=([^>]+)>/.exec(innerContent);
    if (!funcMatch) {
      continue;
    }
    const functionName = htmlUnescape(funcMatch[1].trim());

    // Ignore nested tool blocks when extracting parameters for this call.
    const paramSourceParts: string[] = [];
    let nestedCursor = 0;
    for (const [nestedStart, nestedEnd] of iterToolCallBlocks(innerContent)) {
      paramSourceParts.push(innerContent.slice(nestedCursor, nestedStart));
      nestedCursor = nestedEnd;
    }
    paramSourceParts.push(innerContent.slice(nestedCursor));
    const paramSource = paramSourceParts.join("");

    const args: Record<string, unknown> = {};
    const paramPattern = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramPattern.exec(paramSource)) !== null) {
      const key = htmlUnescape(paramMatch[1].trim());
      const rawValue = htmlUnescape(paramMatch[2].trim());

      // Attempt to deserialize string values into native types.
      let parsedValue: unknown = rawValue;
      if (
        rawValue.startsWith("[") ||
        rawValue.startsWith("{") ||
        rawValue === "true" ||
        rawValue === "false" ||
        rawValue === "null" ||
        /^\d+$/.test(rawValue)
      ) {
        try {
          parsedValue = JSON.parse(rawValue);
        } catch {
          // Python falls back to ast.literal_eval here; no TS analogue, keep raw.
        }
      }

      args[key] = parsedValue;
    }

    toolCalls.push({ name: functionName, args, id: `call_${randomUUID().replace(/-/g, "").slice(0, 10)}` });
  }
  cleanParts.push(content.slice(cursor));

  return [cleanParts.join("").trim(), toolCalls];
}

/** Iterate `<tool_call>...</tool_call>` blocks and tolerate nesting. */
function iterToolCallBlocks(content: string): Array<[number, number, string]> {
  const tokenPattern = /<\/?tool_call>/g;
  const blocks: Array<[number, number, string]> = [];
  let depth = 0;
  let blockStart = -1;

  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(content)) !== null) {
    const token = match[0];
    if (token === "<tool_call>") {
      if (depth === 0) {
        blockStart = match.index;
      }
      depth += 1;
      continue;
    }

    if (depth === 0) {
      continue;
    }

    depth -= 1;
    if (depth === 0 && blockStart !== -1) {
      const blockEnd = match.index + token.length;
      const innerStart = blockStart + "<tool_call>".length;
      const innerEnd = match.index;
      blocks.push([blockStart, blockEnd, content.slice(innerStart, innerEnd)]);
      blockStart = -1;
    }
  }

  return blocks;
}

/** Decode literal `\n` outside fenced code blocks. */
export function decodeEscapedNewlinesOutsideFences(content: string): string {
  if (!content.includes("\\n")) {
    return content;
  }

  const parts = content.split(/(```[\s\S]*?```)/);
  for (let idx = 0; idx < parts.length; idx++) {
    if (parts[idx].startsWith("```")) {
      continue;
    }
    parts[idx] = parts[idx].replace(/\\n/g, "\n");
  }
  return parts.join("");
}

export class MindIEChatModel extends ChatOpenAI {
  /** Normalize timeout kwargs without creating long-lived clients. */
  constructor(fields: Record<string, unknown> = {}) {
    const rest = { ...fields };
    // httpx per-phase timeouts (connect/read/write/pool) have no JS analogue;
    // collapse to a single numeric read timeout.
    delete rest.connect_timeout;
    delete rest.connectTimeout;
    const readTimeout = numberOr(fields.read_timeout ?? fields.readTimeout, 900.0);
    delete rest.read_timeout;
    delete rest.readTimeout;
    delete rest.write_timeout;
    delete rest.writeTimeout;
    delete rest.pool_timeout;
    delete rest.poolTimeout;

    if (rest.timeout === undefined || rest.timeout === null) {
      rest.timeout = readTimeout;
    }

    super(rest as ChatOpenAIFields);
  }

  /** Apply post-generation fixes to the model result. */
  private patchResultWithTools(result: ChatResult): ChatResult {
    for (const gen of result.generations) {
      const msg = gen.message;

      if (typeof msg.content === "string") {
        // Keep escaped newlines inside fenced code blocks untouched.
        msg.content = decodeEscapedNewlinesOutsideFences(msg.content);

        if (msg.content.includes("<tool_call>")) {
          const [cleanContent, extractedTools] = parseXmlToolCallToDict(msg.content);

          if (extractedTools.length > 0) {
            msg.content = cleanContent;
            const aiMsg = msg as AIMessage;
            if (aiMsg.tool_calls === null || aiMsg.tool_calls === undefined) {
              aiMsg.tool_calls = [];
            }
            aiMsg.tool_calls.push(...(extractedTools as unknown as ToolCall[]));
          }
        }
      }
    }
    return result;
  }

  override async _generate(messages: BaseMessage[], options: this["ParsedCallOptions"], runManager?: CallbackManagerForLLMRun): Promise<ChatResult> {
    const result = await super._generate(fixMessages(messages), options, runManager);
    return this.patchResultWithTools(result);
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const tools = (options as { tools?: unknown }).tools;

    // Route standard queries to native streaming for lower TTFB.
    if (!tools) {
      for await (const chunk of super._streamResponseChunks(fixMessages(messages), options, runManager)) {
        if (typeof chunk.message.content === "string") {
          chunk.message.content = decodeEscapedNewlinesOutsideFences(chunk.message.content);
        }
        yield chunk;
      }
      return;
    }

    // Fallback for tool-enabled requests:
    // MindIE currently drops choices when stream=true and tools are present.
    // We await the full generation and yield chunks to simulate streaming.
    const result = await this._generate(messages, options, runManager);

    for (const gen of result.generations) {
      const msg = gen.message;
      const content = msg.content;
      const standardToolCalls = (msg as AIMessage).tool_calls ?? [];
      const invalidToolCalls = (msg as AIMessage).invalid_tool_calls ?? [];

      // Yield text in chunks to allow downstream UI/Markdown parsers to render smoothly.
      if (typeof content === "string" && content) {
        const chunkSize = 15;
        for (let i = 0; i < content.length; i += chunkSize) {
          const chunkText = content.slice(i, i + chunkSize);
          const chunkMsg = new AIMessageChunk({
            content: chunkText,
            id: msg.id,
            response_metadata: i === 0 ? msg.response_metadata : {},
          });
          yield new ChatGenerationChunk({ text: chunkText, message: chunkMsg, generationInfo: i === 0 ? gen.generationInfo : undefined });
        }

        if (standardToolCalls.length > 0) {
          yield new ChatGenerationChunk({
            text: "",
            message: new AIMessageChunk({ content: "", id: msg.id, tool_calls: standardToolCalls, invalid_tool_calls: invalidToolCalls }),
          });
        }
      } else {
        const chunkMsg = new AIMessageChunk({
          content: content as string,
          id: msg.id,
          tool_calls: standardToolCalls,
          invalid_tool_calls: invalidToolCalls,
        });
        yield new ChatGenerationChunk({ text: typeof content === "string" ? content : "", message: chunkMsg, generationInfo: gen.generationInfo });
      }
    }
  }
}

/** `html.escape(s, quote=False)` — escapes `&`, `<`, `>` only. */
function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Subset of `html.unescape` covering the entities MindIE emits. */
function htmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
