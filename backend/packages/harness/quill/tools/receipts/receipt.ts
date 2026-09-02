/**
 * Tool receipt system — deterministic verification layer for agent tool calls.
 *
 * Port of DeerFlow 2.0's tool receipt system. Every tool call gets an
 * immutable receipt stamped into the message's additional_kwargs. The agent
 * can cite receipts in its final output (e.g. "[r2 write_file]"), and the
 * system can verify these citations deterministically — no LLM needed.
 *
 * Key design decisions (from DeerFlow):
 * - Receipts are derived from the message stream (never stored separately)
 * - Positional IDs (r1..rN) assigned over the append-only message list
 * - Citation format: [r2] bare or [r2 write_file] anchored
 * - A visible ledger is injected into model context with a character budget
 * - Ledger snapshots survive compaction via per-turn preservation
 *
 * This enables:
 * - Deterministic verification of agent claims
 * - Audit trail without separate storage
 * - Citation-based output that users can verify
 */

import { createHash } from "node:crypto";

import type { ToolMessage } from "@langchain/core/messages";

// ---------------------------------------------------------------------------
// Receipt types
// ---------------------------------------------------------------------------

/**
 * A tool receipt — an immutable record of a tool call and its result.
 */
export interface ToolReceipt {
  /** Positional ID (r1, r2, ...). */
  id: string;
  /** Display number (1-based). */
  displayNumber: number;
  /** Tool name. */
  toolName: string;
  /** SHA-256 hash of the serialized tool arguments. */
  argsHash: string;
  /** SHA-256 hash of the tool result (truncated to first 1KB for hashing). */
  resultHash: string;
  /** Status of the tool call. */
  status: "success" | "error";
  /** ISO timestamp. */
  timestamp: string;
  /** Truncated result preview (for ledger display). */
  resultPreview: string;
  /** Whether this receipt has been cited by the agent. */
  cited: boolean;
}

/**
 * A ledger — a collection of receipts visible to the agent.
 */
export interface ReceiptLedger {
  /** Receipts in display order. */
  receipts: ToolReceipt[];
  /** Total character budget for the ledger display. */
  budget: number;
  /** Actual character count of the rendered ledger. */
  usedChars: number;
  /** Whether the ledger was truncated to fit the budget. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Receipt creation
// ---------------------------------------------------------------------------

const RESULT_HASH_MAX_CHARS = 1024;
const RESULT_PREVIEW_MAX_CHARS = 200;

/**
 * Create a receipt from a ToolMessage.
 *
 * The receipt captures the tool name, argument hash, result hash, and
 * a truncated preview. The args are extracted from the message's
 * additional_kwargs (where LangChain stores the original tool call).
 */
export function createReceipt(
  message: ToolMessage,
  displayNumber: number,
): ToolReceipt {
  const toolName = message.name ?? "unknown";
  const args = (message.additional_kwargs?.args ?? {}) as Record<string, unknown>;
  const resultContent = typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content);

  return {
    id: `r${displayNumber}`,
    displayNumber,
    toolName,
    argsHash: hashObject(args),
    resultHash: hashString(resultContent.slice(0, RESULT_HASH_MAX_CHARS)),
    status: message.additional_kwargs?.error ? "error" : "success",
    timestamp: new Date().toISOString(),
    resultPreview: truncate(resultContent, RESULT_PREVIEW_MAX_CHARS),
    cited: false,
  };
}

// ---------------------------------------------------------------------------
// Ledger management
// ---------------------------------------------------------------------------

/**
 * Build a receipt ledger from a list of ToolMessages.
 *
 * Assigns positional IDs (r1, r2, ...) in message order and renders
 * a ledger within the specified character budget.
 */
export function buildLedger(
  toolMessages: ToolMessage[],
  budget = 2000,
): ReceiptLedger {
  const receipts: ToolReceipt[] = [];
  let displayNumber = 0;

  for (const msg of toolMessages) {
    if (msg.getType() === "tool") {
      displayNumber++;
      receipts.push(createReceipt(msg, displayNumber));
    }
  }

  const { rendered, usedChars, truncated } = renderLedger(receipts, budget);

  return {
    receipts,
    budget,
    usedChars,
    truncated,
  };
}

/**
 * Render the ledger as a string for injection into the model context.
 *
 * Format:
 *   ## Tool Receipts
 *   [r1] write_file (success) — Wrote 23 lines to /path/to/file
 *   [r2] bash (success) — Output: "Hello World"
 *   [r3] read_file (error) — File not found: /missing.txt
 */
export function renderLedger(
  receipts: ToolReceipt[],
  budget: number,
): { rendered: string; usedChars: number; truncated: boolean } {
  if (receipts.length === 0) {
    return { rendered: "", usedChars: 0, truncated: false };
  }

  const header = "## Tool Receipts\n";
  let body = "";
  let truncated = false;

  for (const receipt of receipts) {
    const line = formatReceiptLine(receipt);
    if (header.length + body.length + line.length > budget) {
      truncated = true;
      break;
    }
    body += line + "\n";
  }

  const rendered = header + body;
  return { rendered, usedChars: rendered.length, truncated };
}

function formatReceiptLine(receipt: ToolReceipt): string {
  const statusTag = receipt.status === "success" ? "✓" : "✗";
  const preview = receipt.resultPreview.replace(/\n/g, " ").trim();
  return `[${receipt.id}] ${receipt.toolName} ${statusTag} — ${preview}`;
}

// ---------------------------------------------------------------------------
// Citation verification
// ---------------------------------------------------------------------------

/**
 * Verify that cited receipts actually exist and match their anchors.
 *
 * Parses citation patterns like [r2] or [r2 write_file] from the agent's
 * output and verifies each against the ledger.
 *
 * Returns the verification result with any invalid citations.
 */
export function verifyCitations(
  output: string,
  ledger: ReceiptLedger,
): CitationsVerification {
  const receiptMap = new Map<number, ToolReceipt>();
  for (const r of ledger.receipts) {
    receiptMap.set(r.displayNumber, r);
  }

  // Match [rN] and [rN tool_name] patterns.
  const citationPattern = /\[r(\d+)(?:\s+(\w+))?\]/g;
  const citations: Array<{ id: number; anchor?: string; valid: boolean; reason: string }> = [];
  const seen = new Set<number>();

  let match: RegExpExecArray | null;
  while ((match = citationPattern.exec(output)) !== null) {
    const displayNumber = parseInt(match[1], 10);
    const anchor = match[2];

    if (seen.has(displayNumber)) continue;
    seen.add(displayNumber);

    const receipt = receiptMap.get(displayNumber);
    if (!receipt) {
      citations.push({
        id: displayNumber,
        anchor,
        valid: false,
        reason: `Receipt r${displayNumber} does not exist`,
      });
    else if (anchor && anchor !== receipt.toolName) {
      citations.push({
        id: displayNumber,
        anchor,
        valid: false,
        reason: `Receipt r${displayNumber} is "${receipt.toolName}", not "${anchor}"`,
      });
    } else {
      citations.push({ id: displayNumber, anchor, valid: true, reason: "Valid" });
    }
  }

  const invalid = citations.filter((c) => !c.valid);
  return {
    valid: invalid.length === 0,
    citations,
    invalidCitations: invalid,
    totalCitations: citations.length,
  };
}

export interface CitationsVerification {
  valid: boolean;
  citations: Array<{ id: number; anchor?: string; valid: boolean; reason: string }>;
  invalidCitations: Array<{ id: number; anchor?: string; valid: boolean; reason: string }>;
  totalCitations: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashObject(obj: Record<string, unknown>): string {
  return hashString(JSON.stringify(obj));
}

function hashString(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}...`;
}
