/**
 * Deterministic capture and rendering for task delegations.
 *
 * Port of Python `deerflow.agents.middlewares.delegation_ledger`. Extracts
 * `task` tool calls and their paired results from message history into a
 * stable ledger, then renders it as model-visible system context.
 */

import type { AIMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";

import type { DelegationEntry } from "../thread_state.js";
import { TERMINAL_STATUSES } from "../thread_state.js";

// Subagent status is stamped into ToolMessage.additional_kwargs by the
// subagent status contract — mirrors contracts/subagent_status_contract.json.
const SUBAGENT_STATUS_KEY = "subagent_status";

const RESULT_BRIEF_CAP = 2000;
const DESCRIPTION_CAP = 200;
const LEDGER_RENDER_CHAR_BUDGET = 6000;
const LEDGER_ENTRY_RESULT_RENDER_CAP = 120;

const TASK_SUCCESS_PREFIX = "Task Succeeded. Result:";
const TASK_FAILED_PREFIX = "Task failed. Error:";
const TASK_TIMED_OUT_PREFIX = "Task timed out. Error:";

function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function boundText(text: string, cap: number = RESULT_BRIEF_CAP): string {
  if (text.length <= cap) return text;
  if (cap <= 0) return "";
  const head = Math.floor((cap * 2) / 3);
  const omittedMarker = "\n...\n";
  if (cap <= omittedMarker.length) return text.slice(0, cap);
  const tail = cap - head - omittedMarker.length;
  if (tail <= 0) return text.slice(0, cap);
  return `${text.slice(0, head)}${omittedMarker}${text.slice(-tail)}`;
}

function extractSubagentStatus(text: string): string | null {
  const t = text.trim();
  if (t.startsWith(TASK_SUCCESS_PREFIX)) return "completed";
  if (t.startsWith("Task polling timed out")) return "polling_timed_out";
  if (t.startsWith(TASK_TIMED_OUT_PREFIX)) return "timed_out";
  if (t.startsWith("Task cancelled by user")) return "cancelled";
  if (t.startsWith("Task failed.")) return "failed";
  return null;
}

function parseTaskResult(content: string, status?: string | null): [string, string] | null {
  const text = content.trim();
  const detectedStatus = status || extractSubagentStatus(text);
  if (!detectedStatus) return null;
  if (detectedStatus === "completed" && text.startsWith(TASK_SUCCESS_PREFIX)) {
    return [detectedStatus, text.slice(TASK_SUCCESS_PREFIX.length).trim()];
  }
  if (detectedStatus === "failed" && text.startsWith(TASK_FAILED_PREFIX)) {
    return [detectedStatus, text.slice(TASK_FAILED_PREFIX.length).trim()];
  }
  if (detectedStatus === "timed_out" && text.startsWith(TASK_TIMED_OUT_PREFIX)) {
    return [detectedStatus, text.slice(TASK_TIMED_OUT_PREFIX.length).trim()];
  }
  return [detectedStatus, text];
}

function toolCallName(toolCall: Record<string, unknown>): string {
  const name = toolCall.name;
  if (typeof name === "string") return name;
  const fn = toolCall.function;
  if (fn && typeof fn === "object" && typeof (fn as Record<string, unknown>).name === "string") {
    return (fn as Record<string, unknown>).name as string;
  }
  return "";
}

function toolCallId(toolCall: Record<string, unknown>): string | null {
  const id = toolCall.id;
  return typeof id === "string" ? id : null;
}

function toolCallArgs(toolCall: Record<string, unknown>): Record<string, unknown> {
  const args = toolCall.args;
  return args && typeof args === "object" ? (args as Record<string, unknown>) : {};
}

/** Enumerate `task` delegations from AI tool calls and paired result ToolMessages. */
export function extractDelegations(messages: BaseMessage[]): DelegationEntry[] {
  const entriesById = new Map<string, DelegationEntry>();
  const order: string[] = [];
  const now = utcNowIso();

  for (const message of messages) {
    if (message.getType() !== "ai") continue;
    const aiMsg = message as AIMessage;
    const toolCalls = aiMsg.tool_calls ?? [];
    for (const tc of toolCalls) {
      if (toolCallName(tc) !== "task") continue;
      const id = toolCallId(tc);
      if (!id) continue;
      const args = toolCallArgs(tc);
      const description = String(args.description ?? args.prompt ?? "").slice(0, DESCRIPTION_CAP);
      if (!entriesById.has(id)) order.push(id);
      entriesById.set(id, {
        id,
        description,
        subagent_type: String(args.subagent_type ?? ""),
        status: "in_progress",
        created_at: now,
      });
    }
  }

  for (const message of messages) {
    if (message.getType() !== "tool") continue;
    const tm = message as ToolMessage;
    const toolCallIdStr = tm.tool_call_id ?? "";
    const entry = entriesById.get(toolCallIdStr);
    if (!entry) continue;
    const content = typeof tm.content === "string" ? tm.content : JSON.stringify(tm.content);
    const statusFromKwarg = tm.additional_kwargs?.[SUBAGENT_STATUS_KEY];
    const parsed = parseTaskResult(content, typeof statusFromKwarg === "string" ? statusFromKwarg : null);
    if (!parsed) continue;
    const [status, resultText] = parsed;
    const resultRef = String(tm.id || toolCallIdStr);
    entry.status = status;
    entry.result_brief = boundText(resultText);
    entry.result_sha256 = simpleSha256(resultText);
    entry.result_ref = resultRef;
  }

  return order.map((id) => entriesById.get(id)!);
}

function simpleSha256(text: string): string {
  // Lazy import to avoid loading crypto for every turn.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require("node:crypto") as typeof import("node:crypto");
  return crypto.createHash("sha256").update(text).digest("hex");
}

function escapeContextText(value: unknown): string {
  return String(value).replace(/\s+/g, " ").replace(/[<>]/g, "");
}

function statusGuidance(status: string): string {
  switch (status) {
    case "in_progress":
      return "already delegated; do NOT delegate again; wait for or build on the result";
    case "completed":
      return "completed result; do NOT delegate again; reuse this result";
    case "failed":
      return "failed attempt; may retry with a changed plan";
    case "cancelled":
      return "cancelled attempt; may retry with a changed plan";
    case "timed_out":
      return "timed-out attempt; may retry with a changed plan";
    case "polling_timed_out":
      return "polling timed-out attempt; may retry with a changed plan";
    default:
      return "prior attempt; inspect status before retrying";
  }
}

function fitsBudget(lines: string[], candidate: string, maxChars: number): boolean {
  return [...lines, candidate].join("\n").length <= maxChars;
}

function renderEntryLine(entry: DelegationEntry): string {
  const status = escapeContextText(entry.status);
  const description = escapeContextText(entry.description);
  const subagentType = escapeContextText(entry.subagent_type);
  const guidance = statusGuidance(entry.status);
  let line = `- [${status}] ${description} (via ${subagentType}; ${guidance})`;
  if (entry.result_brief) {
    line += ` -> ${escapeContextText(boundText(entry.result_brief, LEDGER_ENTRY_RESULT_RENDER_CAP))}`;
  }
  return line;
}

/**
 * Render the delegation ledger as model-visible system context.
 * Newest entries first. Returns "" when empty.
 */
export function renderDelegationLedger(entries: DelegationEntry[], maxChars: number = LEDGER_RENDER_CHAR_BUDGET): string {
  if (entries.length === 0) return "";
  const lines = [
    "## Work already delegated",
    "Newest entries are shown first. In-progress entries are already delegated. Completed entries are reusable results. Failed, cancelled, or timed-out entries are prior attempts.",
  ];
  let omitted = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const line = renderEntryLine(entries[i]);
    if (fitsBudget(lines, line, maxChars)) {
      lines.push(line);
      continue;
    }
    omitted = entries.length - i;
    break;
  }
  if (omitted > 0) {
    let omittedLine = `- ... ${omitted} older delegation entries omitted from this model view because of context budget`;
    while (lines.length > 1 && !fitsBudget(lines, omittedLine, maxChars)) {
      lines.pop();
      omitted += 1;
      omittedLine = `- ... ${omitted} older delegation entries omitted from this model view because of context budget`;
    }
    if (fitsBudget(lines, omittedLine, maxChars)) lines.push(omittedLine);
  }
  const rendered = lines.join("\n");
  if (rendered.length <= maxChars) return rendered;
  return `${rendered.slice(0, Math.max(0, maxChars - 4))}\n...`;
}
