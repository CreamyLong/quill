/**
 * Subagent Context Modes — isolated vs. snapshot context delivery.
 *
 * Inspired by DeerFlow 2.0's two context modes and the awesome-harness-
 * engineering "Context Modes for Subagents" pattern.
 *
 * Two modes control what information a subagent receives:
 *
 *   isolated (default) — Child gets ONLY the delegated prompt. No parent
 *     conversation history, no prior context. Minimizes token usage and
 *     prevents context contamination.
 *
 *   snapshot — Child receives the delegated prompt PLUS the parent's retained
 *     conversation and compaction summary as historical background. The child
 *     understands what came before but doesn't see raw tool-call noise.
 *
 * Subagents with isolated context use ~67% fewer tokens than those with full
 * context (per awesome-harness-engineering benchmarks).
 *
 * Source patterns:
 * - DeerFlow 2.0: isolated (default) and snapshot context modes
 * - awesome-harness-engineering: Context Modes for Subagents
 * - OpenWork CodeMode: sandboxed code execution with isolated runtime
 */

import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Context delivery mode for subagents.
 */
export type ContextMode = "isolated" | "snapshot";

/**
 * Options for building subagent context.
 */
export interface ContextBuildOptions {
  /** The delegated task/prompt. */
  task: string;
  /** Context delivery mode. */
  mode: ContextMode;
  /** Parent conversation messages (for snapshot mode). */
  parentMessages?: BaseMessage[];
  /** Compaction summary from the parent (for snapshot mode). */
  compactionSummary?: string;
  /** Parent thread title (for snapshot mode context). */
  parentTitle?: string;
  /** Maximum characters of parent history to include in snapshot. */
  snapshotMaxChars?: number;
  /** Maximum messages to include in snapshot. */
  snapshotMaxMessages?: number;
}

/**
 * Built context for subagent execution.
 */
export interface SubagentContext {
  /** Messages to prepend to the subagent's conversation. */
  messages: BaseMessage[];
  /** The mode used. */
  mode: ContextMode;
  /** Token estimate for the context. */
  estimatedTokens: number;
  /** Whether the snapshot was truncated. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_SNAPSHOT_MAX_CHARS = 8000;
const DEFAULT_SNAPSHOT_MAX_MESSAGES = 20;

// ---------------------------------------------------------------------------
// Context Builder
// ---------------------------------------------------------------------------

/**
 * Build context messages for a subagent based on the chosen mode.
 */
export function buildSubagentContext(options: ContextBuildOptions): SubagentContext {
  const { task, mode } = options;

  if (mode === "isolated") {
    return buildIsolatedContext(task);
  } else {
    return buildSnapshotContext(task, options);
  }
}

/**
 * Isolated context: only the delegated task.
 *
 * The subagent receives a single human message with the task description.
 * No parent history, no prior context. This is the most token-efficient mode
 * and prevents the child from being influenced by the parent's failed
 * approaches or stale information.
 */
function buildIsolatedContext(task: string): SubagentContext {
  return {
    messages: [new HumanMessage(task)],
    mode: "isolated",
    estimatedTokens: estimateTokens(task),
    truncated: false,
  };
}

/**
 * Snapshot context: delegated task + parent conversation summary.
 *
 * The subagent receives:
 * 1. A system message framing the parent context (title, summary)
 * 2. The most recent N parent messages (as background)
 * 3. The delegated task (as the human message)
 *
 * This gives the child enough context to understand what came before
 * without the full token cost of the entire parent conversation.
 */
function buildSnapshotContext(
  task: string,
  options: ContextBuildOptions,
): SubagentContext {
  const messages: BaseMessage[] = [];
  const maxChars = options.snapshotMaxChars ?? DEFAULT_SNAPSHOT_MAX_CHARS;
  const maxMessages = options.snapshotMaxMessages ?? DEFAULT_SNAPSHOT_MAX_MESSAGES;
  let truncated = false;
  let charCount = 0;

  // Build the context frame
  const contextParts: string[] = [];

  if (options.parentTitle) {
    contextParts.push(`Parent thread: "${options.parentTitle}"`);
  }

  if (options.compactionSummary) {
    contextParts.push(`Background:\n${options.compactionSummary}`);
  }

  if (contextParts.length > 0) {
    messages.push(
      new SystemMessage(
        `You are a subagent working within a larger conversation.\n\n${contextParts.join("\n\n")}\n\nYour specific task is described below. Focus on completing this task.`,
      ),
    );
    charCount += messages[0].content.toString().length;
  }

  // Include recent parent messages (filtered to meaningful ones)
  if (options.parentMessages && options.parentMessages.length > 0) {
    const recentMessages = options.parentMessages.slice(-maxMessages);

    for (const msg of recentMessages) {
      const msgText = messageToText(msg);
      if (charCount + msgText.length > maxChars) {
        truncated = true;
        break;
      }
      messages.push(msg);
      charCount += msgText.length;
    }
  }

  // The actual task is always last
  messages.push(new HumanMessage(task));

  return {
    messages,
    mode: "snapshot",
    estimatedTokens: Math.ceil(charCount / 4) + estimateTokens(task),
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a message to a compact text representation for snapshot inclusion.
 */
function messageToText(message: BaseMessage): string {
  const type = message.getType();
  const content = typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content).slice(0, 500);

  // Truncate very long messages
  const truncated = content.length > 1000
    ? `${content.slice(0, 997)}...`
    : content;

  return `[${type}]: ${truncated}`;
}

/**
 * Rough token estimate from character count.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Create a context mode selector based on task characteristics.
 *
 * Heuristic: tasks that reference prior work, ask for continuation, or
 * contain pronouns like "it", "that", "the above" benefit from snapshot
 * mode. Simple, self-contained tasks work best with isolated mode.
 */
export function suggestContextMode(task: string): ContextMode {
  const taskLower = task.toLowerCase();

  // Indicators that the task benefits from parent context
  const contextIndicators = [
    /\b(it|that|this|the above|the previous|the former|the latter)\b/,
    /\b(continue|extend|build on|follow up|based on)\b/,
    /\b(as i mentioned|as discussed|previously|earlier)\b/,
    /\b(fix the|update the|modify the|refactor the)\b/,
    /\b(same\s+(file|function|class|module|pattern))\b/,
  ];

  for (const pattern of contextIndicators) {
    if (pattern.test(taskLower)) {
      return "snapshot";
    }
  }

  return "isolated";
}
