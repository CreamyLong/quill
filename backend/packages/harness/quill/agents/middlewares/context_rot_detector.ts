/**
 * ContextRotDetector — detects and mitigates degraded conversation context.
 *
 * Ported from awesome-harness-engineering's "Context Rot" pattern. Over long
 * agent runs, the conversation context degrades: old tool results accumulate,
 * reasoning chains fragment, and the model's effective attention window
 * shrinks. This detector monitors context health in real time and recommends
 * (or triggers) remediation actions.
 *
 * Signals monitored:
 * - Token density (tokens per reasoning unit — high = bloated)
 * - Tool result staleness (old tool outputs dominating context)
 * - Repetition score (repeated patterns indicate loop/stuck behavior)
 * - Fragmentation (rapid topic shifts degrading coherence)
 */

import type { BaseMessage } from "@langchain/core/messages";
import type { MiddlewareDefinition, ToolCallRequest } from "../factory.js";
import type { ThreadState } from "../thread_state.js";

export interface ContextHealth {
  /** 0-100 health score (100 = pristine, 0 = unusable). */
  score: number;
  /** Whether compaction/remediation is recommended. */
  shouldCompact: boolean;
  /** Whether the conversation should be forked. */
  shouldFork: boolean;
  /** Per-signal breakdown. */
  signals: {
    tokenDensity: number;
    toolResultStaleness: number;
    repetitionScore: number;
    fragmentationScore: number;
  };
  /** Human-readable recommendation. */
  recommendation: string;
}

export interface ContextRotConfig {
  /** Token count at which context rot becomes a concern. */
  warningTokenThreshold: number;
  /** Token count at which compaction is forced. */
  criticalTokenThreshold: number;
  /** Fraction of context that can be old tool results before staleness triggers. */
  toolResultStalenessRatio: number;
  /** Number of repeated patterns before repetition is flagged. */
  repetitionThreshold: number;
  /** Fraction of topic shifts before fragmentation triggers. */
  fragmentationRatio: number;
}

const DEFAULT_CONFIG: ContextRotConfig = {
  warningTokenThreshold: 40_000,
  criticalTokenThreshold: 80_000,
  toolResultStalenessRatio: 0.6,
  repetitionThreshold: 3,
  fragmentationRatio: 0.4,
};

function estimateTokenCount(messages: BaseMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    const content =
      typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    total += content.length;
  }
  return Math.floor(total / 4);
}

function computeToolResultStaleness(
  messages: BaseMessage[],
  ratio: number,
): number {
  if (messages.length < 3) return 0;
  const recent = messages.slice(-20);
  let toolResults = 0;
  for (const msg of recent) {
    if (msg._getType() === "tool") toolResults++;
  }
  const r = toolResults / recent.length;
  return r > ratio ? (r - ratio) / (1 - ratio) : 0;
}

function computeRepetition(messages: BaseMessage[], threshold: number): number {
  if (messages.length < 4) return 0;
  const toolMessages = messages.filter((m) => m._getType() === "tool");
  const signatures = new Map<string, number>();
  for (const msg of toolMessages) {
    const name = (msg as { name?: string }).name ?? "unknown";
    const content =
      typeof msg.content === "string"
        ? msg.content.slice(0, 100)
        : JSON.stringify(msg.content).slice(0, 100);
    const sig = `${name}:${content}`;
    signatures.set(sig, (signatures.get(sig) ?? 0) + 1);
  }
  let maxRepeat = 0;
  for (const count of signatures.values()) {
    if (count > maxRepeat) maxRepeat = count;
  }
  return maxRepeat >= threshold
    ? Math.min(1, (maxRepeat - threshold + 1) / 5)
    : 0;
}

function computeFragmentation(
  messages: BaseMessage[],
  ratio: number,
): number {
  if (messages.length < 6) return 0;
  const toolNames: string[] = [];
  for (const msg of messages) {
    if (msg._getType() === "tool" && (msg as { name?: string }).name) {
      toolNames.push((msg as { name: string }).name);
    }
  }
  if (toolNames.length < 3) return 0;
  let shifts = 0;
  for (let i = 1; i < toolNames.length; i++) {
    if (toolNames[i] !== toolNames[i - 1]) shifts++;
  }
  const r = shifts / (toolNames.length - 1);
  return r > ratio ? (r - ratio) / (1 - ratio) : 0;
}

function assess(
  messages: BaseMessage[],
  cfg: ContextRotConfig,
): ContextHealth {
  const tokenCount = estimateTokenCount(messages);
  const tokenDensity =
    tokenCount > cfg.warningTokenThreshold
      ? Math.min(
          1,
          (tokenCount - cfg.warningTokenThreshold) /
            (cfg.criticalTokenThreshold - cfg.warningTokenThreshold),
        )
      : 0;

  const toolStaleness = computeToolResultStaleness(messages, cfg.toolResultStalenessRatio);
  const repetition = computeRepetition(messages, cfg.repetitionThreshold);
  const fragmentation = computeFragmentation(messages, cfg.fragmentationRatio);

  const degradation =
    tokenDensity * 0.35 +
    toolStaleness * 0.25 +
    repetition * 0.25 +
    fragmentation * 0.15;

  const score = Math.max(0, Math.min(100, Math.round((1 - degradation) * 100)));

  return {
    score,
    shouldCompact: score < 50,
    shouldFork: score < 25,
    signals: {
      tokenDensity: Math.round(tokenDensity * 100) / 100,
      toolResultStaleness: Math.round(toolStaleness * 100) / 100,
      repetitionScore: Math.round(repetition * 100) / 100,
      fragmentationScore: Math.round(fragmentation * 100) / 100,
    },
    recommendation:
      score < 25
        ? "Critical context degradation — fork a new conversation"
        : score < 50
          ? "Context quality declining — consider compacting"
          : score < 75
            ? "Context health moderate — monitor tool result accumulation"
            : "Context health good",
  };
}

export function contextRotDetector(
  config?: Partial<ContextRotConfig>,
): MiddlewareDefinition {
  const cfg: ContextRotConfig = { ...DEFAULT_CONFIG, ...config };

  return {
    name: "ContextRotDetector",
    afterAgent: (state: ThreadState) => {
      const messages = state.messages ?? [];
      if (messages.length < 4) return;

      const health = assess(messages, cfg);

      if (health.shouldCompact) {
        console.warn(
          `[ContextRotDetector] Context health ${health.score}/100 — ${health.recommendation}`,
        );
      }

      // Attach health to internal state for telemetry consumption.
      return {
        internal: {
          ...state.internal,
          contextHealth: health,
        },
      };
    },
  };
}

export { assess as assessContextHealth };
