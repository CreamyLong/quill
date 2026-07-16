/**
 * Middleware that enforces a per-result budget on tool outputs.
 *
 * Oversized tool results are persisted to disk and replaced with a compact
 * preview containing a file reference. When disk persistence is unavailable
 * the middleware falls back to head+tail truncation.
 */

import { ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { STATE_UPDATE, type MiddlewareDefinition, type ThreadState, type ToolCallRequest } from "../factory.js";
import {
  buildToolOutputConfig,
  type ToolOutputConfig,
} from "../../config/tool_output_config.js";

const VIRTUAL_OUTPUTS_BASE = "/mnt/user-data/outputs";

const EXT_MAP: Record<string, string> = {
  bash: "log",
  bash_tool: "log",
  web_fetch: "log",
};

function messageText(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }
  if (content === null || content === undefined) {
    return null;
  }
  if (Array.isArray(content)) {
    const pieces: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        pieces.push(part);
      } else if (
        typeof part === "object" &&
        part !== null &&
        typeof (part as Record<string, unknown>).text === "string"
      ) {
        pieces.push(String((part as Record<string, unknown>).text));
      } else {
        return null;
      }
    }
    return pieces.length > 0 ? pieces.join("\n") : null;
  }
  return null;
}

function snapToLineBoundary(text: string, pos: number): number {
  if (pos <= 0 || pos >= text.length) {
    return pos;
  }
  const half = Math.floor(pos / 2);
  const nl = text.lastIndexOf("\n", pos - 1);
  if (nl >= half) {
    return nl + 1;
  }
  return pos;
}

function sanitizeToolName(name: string): string {
  const base = path.basename(name);
  const safe = base.replace(/\.\./g, "").replace(/[/\\]/g, "_");
  return safe || "unknown";
}

function buildExternalizedFilename(toolName: string): string {
  const safeName = sanitizeToolName(toolName);
  const ext = EXT_MAP[toolName] ?? "txt";
  const shortId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${safeName}-${shortId}.${ext}`;
}

async function externalize(
  content: string,
  toolName: string,
  outputsPath: string,
  storageSubdir: string
): Promise<string | null> {
  if (path.isAbsolute(storageSubdir) || storageSubdir.includes("..")) {
    return null;
  }
  const storageDir = path.join(outputsPath, storageSubdir);
  try {
    await fs.mkdir(storageDir, { recursive: true });
  } catch {
    return null;
  }
  const filename = buildExternalizedFilename(toolName);
  const filepath = path.join(storageDir, filename);
  if (!path.resolve(filepath).startsWith(path.resolve(storageDir) + path.sep)) {
    return null;
  }
  try {
    await fs.writeFile(filepath, content, "utf-8");
  } catch {
    return null;
  }
  return `${VIRTUAL_OUTPUTS_BASE}/${storageSubdir}/${filename}`;
}

function buildPreview(
  content: string,
  toolName: string,
  virtualPath: string,
  headChars: number,
  tailChars: number
): string {
  const total = content.length;
  const headEnd = snapToLineBoundary(content, Math.min(headChars, total));
  let tailStart = Math.max(headEnd, total - tailChars);
  const tailStartSnapped = snapToLineBoundary(content, tailStart);
  if (tailStartSnapped > headEnd) {
    tailStart = tailStartSnapped;
  }
  const head = content.slice(0, headEnd);
  const tail = tailStart < total ? content.slice(tailStart) : "";
  const omitted = total - head.length - tail.length;
  const ref = `\n\n[Full ${toolName} output saved to ${virtualPath} (${total} chars, ~${Math.floor(total / 4)} tokens). Use read_file with start_line and end_line to access specific sections. ${omitted} chars omitted from this preview.]\n\n`;
  const parts = [head, ref];
  if (tail) {
    parts.push(tail);
  }
  return parts.join("");
}

function buildFallback(
  content: string,
  toolName: string,
  maxChars: number,
  headChars: number,
  tailChars: number
): string {
  const total = content.length;
  if (maxChars <= 0 || total <= maxChars) {
    return content;
  }
  const markerTemplate = "\n\n[... {n} chars omitted from {tn} output. Persistent storage unavailable. Consider narrowing the query or using more specific parameters.]\n\n";
  const markerOverhead = markerTemplate.replace("{n}", String(total)).replace("{tn}", toolName).length;
  if (markerOverhead >= maxChars) {
    return content.slice(0, maxChars);
  }
  const budget = maxChars - markerOverhead;
  const effectiveHead = Math.min(headChars, budget);
  const effectiveTail = Math.min(tailChars, Math.max(0, budget - effectiveHead));
  const headEnd = snapToLineBoundary(content, Math.min(effectiveHead, total));
  let tailStart = Math.max(headEnd, total - effectiveTail);
  const tailStartSnapped = snapToLineBoundary(content, tailStart);
  if (tailStartSnapped > headEnd) {
    tailStart = tailStartSnapped;
  }
  const head = content.slice(0, headEnd);
  const tail = tailStart < total ? content.slice(tailStart) : "";
  const omitted = total - head.length - tail.length;
  const marker = markerTemplate.replace("{n}", String(omitted)).replace("{tn}", toolName);
  const parts = [head, marker];
  if (tail) {
    parts.push(tail);
  }
  return parts.join("");
}

function resolveOutputsPath(state: ThreadState): string | null {
  const outputsPath = state.thread_data?.outputs_path;
  return typeof outputsPath === "string" ? outputsPath : null;
}

function resolveSandbox(_state: ThreadState): null {
  // Sandbox provider integration is not yet available in the TS runtime.
  return null;
}

async function budgetContent(
  content: string,
  toolName: string,
  toolCallId: string,
  outputsPath: string | null,
  config: ToolOutputConfig
): Promise<string | null> {
  const threshold = config.toolOverrides[toolName] ?? config.externalizeMinChars;
  if (threshold <= 0 && config.fallbackMaxChars <= 0) {
    return null;
  }
  if (
    content.length <= threshold &&
    content.length <= config.fallbackMaxChars
  ) {
    return null;
  }

  if (threshold > 0 && content.length > threshold && outputsPath !== null) {
    const virtualPath = await externalize(
      content,
      toolName,
      outputsPath,
      config.storageSubdir
    );
    if (virtualPath !== null) {
      return buildPreview(
        content,
        toolName,
        virtualPath,
        config.previewHeadChars,
        config.previewTailChars
      );
    }
  }

  if (
    config.fallbackMaxChars > 0 &&
    content.length > config.fallbackMaxChars
  ) {
    return buildFallback(
      content,
      toolName,
      config.fallbackMaxChars,
      config.fallbackHeadChars,
      config.fallbackTailChars
    );
  }

  return null;
}

async function patchToolMessage(
  msg: ToolMessage,
  config: ToolOutputConfig,
  outputsPath: string | null
): Promise<ToolMessage> {
  const toolName = msg.name ?? "unknown";
  if (config.exemptTools.includes(toolName)) {
    return msg;
  }
  const text = messageText(msg.content);
  if (text === null) {
    return msg;
  }
  const replacement = await budgetContent(
    text,
    toolName,
    msg.tool_call_id,
    outputsPath,
    config
  );
  if (replacement === null) {
    return msg;
  }
  return new ToolMessage({
    content: replacement,
    tool_call_id: msg.tool_call_id,
    name: msg.name,
    additional_kwargs: msg.additional_kwargs,
    response_metadata: msg.response_metadata,
  });
}

function effectiveTrigger(toolName: string, config: ToolOutputConfig): number {
  const candidates: number[] = [];
  const externalize = config.toolOverrides[toolName] ?? config.externalizeMinChars;
  if (externalize > 0) {
    candidates.push(externalize);
  }
  if (config.fallbackMaxChars > 0) {
    candidates.push(config.fallbackMaxChars);
  }
  return candidates.length > 0 ? Math.min(...candidates) : -1;
}

function toolMessageOverBudget(msg: ToolMessage, config: ToolOutputConfig): boolean {
  const toolName = msg.name ?? "";
  if (config.exemptTools.includes(toolName)) {
    return false;
  }
  const trigger = effectiveTrigger(toolName, config);
  if (trigger < 0) {
    return false;
  }
  const text = messageText(msg.content);
  return text !== null && text.length > trigger;
}

function needsBudget(result: BaseMessage, config: ToolOutputConfig): boolean {
  if (result instanceof ToolMessage) {
    return toolMessageOverBudget(result, config);
  }
  return false;
}

async function patchResult(
  result: BaseMessage,
  config: ToolOutputConfig,
  outputsPath: string | null
): Promise<BaseMessage> {
  if (result instanceof ToolMessage) {
    return patchToolMessage(result, config, outputsPath);
  }
  return result;
}

async function patchModelMessages(
  messages: BaseMessage[],
  config: ToolOutputConfig
): Promise<BaseMessage[] | null> {
  if (!messages.some((m) => m instanceof ToolMessage && toolMessageOverBudget(m, config))) {
    return null;
  }
  const updated: BaseMessage[] = [];
  let changed = false;
  for (const msg of messages) {
    if (msg instanceof ToolMessage) {
      const patched = await patchToolMessage(msg, config, null);
      if (patched !== msg) {
        changed = true;
      }
      updated.push(patched);
    } else {
      updated.push(msg);
    }
  }
  return changed ? updated : null;
}

/** Enforce per-result budget on tool outputs via externalization or truncation. */
export function toolOutputBudgetMiddleware(
  config?: Partial<ToolOutputConfig>
): MiddlewareDefinition {
  const cfg = buildToolOutputConfig(config);
  return {
    name: "ToolOutputBudgetMiddleware",
    wrapToolCall: async (request: ToolCallRequest, handler) => {
      if (!cfg.enabled) {
        return handler(request);
      }
      const result = await handler(request);
      // Middleware tools may return a raw state update; pass through untouched.
      if (
        result !== null &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        (STATE_UPDATE in result || (result as Record<symbol, unknown>)[STATE_UPDATE] === true)
      ) {
        return result as Partial<ThreadState>;
      }
      if (!needsBudget(result as BaseMessage, cfg)) {
        return result as BaseMessage;
      }
      const outputsPath = resolveOutputsPath(request.state);
      return patchResult(result as BaseMessage, cfg, outputsPath);
    },
    wrapModelCall: async (request, handler) => {
      if (!cfg.enabled) {
        return handler(request);
      }
      const patched = await patchModelMessages(request.messages, cfg);
      if (patched !== null) {
        return handler({ messages: patched });
      }
      return handler(request);
    },
  };
}
