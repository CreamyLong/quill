/**
 * SandboxAuditMiddleware — bash command security auditing.
 *
 * Faithful port of Python `SandboxAuditMiddleware`. For every `bash` tool call
 * it classifies the command (regex + shlex analysis) as high-risk (block),
 * medium-risk (warn), or safe (pass), writes a structured audit log, blocks
 * high-risk commands with an error ToolMessage, and appends a warning note to
 * medium-risk results.
 *
 * Deviation (noted in report): Python reads `thread_id` from `request.runtime`;
 * the TS `wrapToolCall` request carries no runtime, so audit records use a null
 * thread id.
 */

import { ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import { STATE_UPDATE, type MiddlewareDefinition, type ToolCallRequest } from "../factory.js";
import type { ThreadState } from "../thread_state.js";

// ---------------------------------------------------------------------------
// Command classification rules
// ---------------------------------------------------------------------------

const HIGH_RISK_PATTERNS: RegExp[] = [
  // --- original rules (retained) ---
  /rm\s+-[^\s]*r[^\s]*\s+(\/\*?|~\/?\*?|\/home\b|\/root\b)\s*$/,
  /dd\s+if=/,
  /mkfs/,
  /cat\s+\/etc\/shadow/,
  />+\s*\/etc\//,
  // --- pipe to sh/bash (generalised, replaces old curl|sh rule) ---
  /\|\s*(ba)?sh\b/,
  // --- command substitution (targeted – only dangerous executables) ---
  /[`$]\(?\s*(curl|wget|bash|sh|python|ruby|perl|base64)/,
  // --- base64 decode piped to execution ---
  /base64\s+.*-d.*\|/,
  // --- overwrite system binaries ---
  />+\s*(\/usr\/bin\/|\/bin\/|\/sbin\/)/,
  // --- overwrite shell startup files ---
  />+\s*~\/?\.(bashrc|profile|zshrc|bash_profile)/,
  // --- process environment leakage ---
  /\/proc\/[^/]+\/environ/,
  // --- dynamic linker hijack (one-step escalation) ---
  /\b(LD_PRELOAD|LD_LIBRARY_PATH)\s*=/,
  // --- bash built-in networking (bypasses tool allowlists) ---
  /\/dev\/tcp\//,
  // --- fork bomb ---
  /\S+\(\)\s*\{[^}]*\|\s*\S+\s*&/, // :(){ :|:& };:
  /while\s+true.*&\s*done/, // while true; do bash & done
];

const MEDIUM_RISK_PATTERNS: RegExp[] = [
  /chmod\s+777/,
  /pip3?\s+install/,
  /apt(-get)?\s+install/,
  // sudo/su: no-op under Docker root; warn so LLM is aware
  /\b(sudo|su)\b/,
  // PATH modification: long attack chain, warn rather than block
  /\bPATH\s*=/,
];

/**
 * Minimal POSIX-ish `shlex.split`. Throws on an unbalanced quote (mirrors
 * Python's `ValueError`) so callers can fall back to raw-pattern checks only.
 */
function shlexSplit(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let hasToken = false;
  let inSingle = false;
  let inDouble = false;
  let escaping = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (escaping) {
      current += ch;
      hasToken = true;
      escaping = false;
      continue;
    }

    if (ch === "\\" && !inSingle) {
      escaping = true;
      hasToken = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      hasToken = true;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      hasToken = true;
      continue;
    }

    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }

    current += ch;
    hasToken = true;
  }

  if (inSingle || inDouble || escaping) {
    throw new Error("No closing quotation");
  }

  if (hasToken) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * Split a compound command into sub-commands (quote-aware). Recognises unquoted
 * `&&`, `||`, and `;`. On an unclosed quote or dangling escape, returns the
 * whole command unchanged (fail-closed).
 */
function splitCompoundCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaping = false;
  let index = 0;

  while (index < command.length) {
    const char = command[index];

    if (escaping) {
      current += char;
      escaping = false;
      index += 1;
      continue;
    }

    if (char === "\\" && !inSingleQuote) {
      current += char;
      escaping = true;
      index += 1;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      index += 1;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      index += 1;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (command.startsWith("&&", index) || command.startsWith("||", index)) {
        const part = current.trim();
        if (part) {
          parts.push(part);
        }
        current = "";
        index += 2;
        continue;
      }
      if (char === ";") {
        const part = current.trim();
        if (part) {
          parts.push(part);
        }
        current = "";
        index += 1;
        continue;
      }
    }

    current += char;
    index += 1;
  }

  // Unclosed quote or dangling escape → fail-closed, return whole command
  if (inSingleQuote || inDoubleQuote || escaping) {
    return [command];
  }

  const part = current.trim();
  if (part) {
    parts.push(part);
  }
  return parts.length > 0 ? parts : [command];
}

type Verdict = "block" | "warn" | "pass";

/** Classify a single (non-compound) command. */
function classifySingleCommand(command: string): Verdict {
  const normalized = command.split(/\s+/).filter(Boolean).join(" ");

  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(normalized)) {
      return "block";
    }
  }

  // Also try shlex-parsed tokens for high-risk detection.
  try {
    const tokens = shlexSplit(command);
    const joined = tokens.join(" ");
    for (const pattern of HIGH_RISK_PATTERNS) {
      if (pattern.test(joined)) {
        return "block";
      }
    }
  } catch {
    // Heredocs and other multiline shell forms may be valid bash but
    // unparseable by shlex. Raw high-risk patterns were already checked.
  }

  for (const pattern of MEDIUM_RISK_PATTERNS) {
    if (pattern.test(normalized)) {
      return "warn";
    }
  }

  return "pass";
}

/** Return 'block', 'warn', or 'pass' for a (possibly compound) command. */
function classifyCommand(command: string): Verdict {
  // Pass 1: whole-command high-risk scan (catches multi-statement patterns).
  const normalized = command.split(/\s+/).filter(Boolean).join(" ");
  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(normalized)) {
      return "block";
    }
  }

  // Pass 2: per-sub-command classification. Most severe verdict wins.
  const subCommands = splitCompoundCommand(command);
  let worst: Verdict = "pass";
  for (const sub of subCommands) {
    const verdict = classifySingleCommand(sub);
    if (verdict === "block") {
      return "block";
    }
    if (verdict === "warn") {
      worst = "warn";
    }
  }
  return worst;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

const AUDIT_COMMAND_LIMIT = 200;
// Normal bash commands rarely exceed a few hundred characters.
const MAX_COMMAND_LENGTH = 10_000;

function writeAudit(
  threadId: string | null,
  command: string,
  verdict: Verdict,
  truncate = false
): void {
  let auditedCommand = command;
  if (truncate && command.length > AUDIT_COMMAND_LIMIT) {
    auditedCommand = `${command.slice(0, AUDIT_COMMAND_LIMIT)}... (${command.length} chars)`;
  }
  const record = {
    timestamp: new Date().toISOString(),
    thread_id: threadId ?? "unknown",
    command: auditedCommand,
    verdict,
  };
  console.info(`[SandboxAudit] ${JSON.stringify(record)}`);
}

function validateInput(command: string): string | null {
  if (!command.trim()) {
    return "empty command";
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    return "command too long";
  }
  if (command.includes("\u0000")) {
    return "null byte detected";
  }
  return null;
}

function buildBlockMessage(request: ToolCallRequest, reason: string): ToolMessage {
  const toolCallId = request.tool_call_id || "missing_id";
  return new ToolMessage({
    content: `Command blocked: ${reason}. Please use a safer alternative approach.`,
    tool_call_id: toolCallId,
    name: "bash",
    status: "error",
  });
}

/** Append a warning note to the tool result for medium-risk commands. */
function appendWarnToResult(result: BaseMessage, command: string): BaseMessage {
  if (!(result instanceof ToolMessage)) {
    return result;
  }
  const warning = `\n\n⚠️ Warning: \`${command}\` is a medium-risk command that may modify the runtime environment.`;
  let newContent: unknown;
  if (Array.isArray(result.content)) {
    newContent = [...result.content, { type: "text", text: warning }];
  } else {
    newContent = String(result.content) + warning;
  }
  return new ToolMessage({
    content: newContent as ToolMessage["content"],
    tool_call_id: result.tool_call_id,
    name: result.name,
    status: result.status,
  });
}

interface PreProcessResult {
  command: string;
  verdict: Verdict;
  rejectReason: string | null;
}

function preProcess(request: ToolCallRequest): PreProcessResult {
  const rawCommand = request.args?.["command"];
  const command = typeof rawCommand === "string" ? rawCommand : "";
  // thread_id is not available on the TS ToolCallRequest (no runtime).
  const threadId: string | null = null;

  // (1) input sanitisation — reject malformed input before regex analysis.
  const rejectReason = validateInput(command);
  if (rejectReason) {
    writeAudit(threadId, command, "block", true);
    console.warn(`[SandboxAudit] INVALID INPUT reason=${rejectReason}`);
    return { command, verdict: "block", rejectReason };
  }

  // (2) classify command.
  const verdict = classifyCommand(command);

  // (3) audit log.
  writeAudit(threadId, command, verdict);

  if (verdict === "block") {
    console.warn(`[SandboxAudit] BLOCKED cmd=${JSON.stringify(command)}`);
  } else if (verdict === "warn") {
    console.warn(`[SandboxAudit] WARN (medium-risk) cmd=${JSON.stringify(command)}`);
  }

  return { command, verdict, rejectReason: null };
}

/** Bash command security auditing middleware. */
export function sandboxAuditMiddleware(): MiddlewareDefinition {
  return {
    name: "SandboxAuditMiddleware",
    wrapToolCall: async (request, handler) => {
      if (request.name !== "bash") {
        return handler(request);
      }

      const { command, verdict, rejectReason } = preProcess(request);
      if (verdict === "block") {
        const reason = rejectReason ?? "security violation detected";
        return buildBlockMessage(request, reason);
      }
      let result: BaseMessage | Partial<ThreadState> = await handler(request);
      // Middleware tools may return a raw state update; pass through untouched.
      if (
        result !== null &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        (STATE_UPDATE in result || (result as Record<symbol, unknown>)[STATE_UPDATE] === true)
      ) {
        return result as Partial<ThreadState>;
      }
      if (verdict === "warn") {
        result = appendWarnToResult(result as BaseMessage, command);
      }
      return result as BaseMessage;
    },
  };
}

// Exposed for testing / reuse.
export {
  classifyCommand,
  classifySingleCommand,
  splitCompoundCommand,
  shlexSplit,
};
