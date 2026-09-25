/**
 * Telemetry Analytics — query and aggregate telemetry data.
 *
 * Inspired by ZCode's conversation telemetry analytics and Kimi Code's
 * usage analytics engine.
 *
 * Provides time-bucketed analytics queries over run journal events:
 *   - Token usage by model and time
 *   - Tool call frequency and patterns
 *   - Session duration distribution
 *   - Success/failure rates
 *   - Cost tracking
 *
 * Source patterns:
 * - ZCode: Conversation telemetry with analytics queries
 * - Kimi Code: Usage analytics with time-bucketed aggregation
 * - DeerFlow: Observability with per-model token tracking
 */

import type {
  ModelCostEntry,
  ModelTokenUsage,
  SessionAnalyticsSummary,
  SessionStats,
  TelemetryQuery,
  TimeBucket,
  TimeSeries,
  TimeSeriesPoint,
  TokenUsageSummary,
  ToolStats,
  ToolUsageSummary,
} from "./types.js";

// ---------------------------------------------------------------------------
// Default model pricing (USD per 1M tokens)
// ---------------------------------------------------------------------------

/**
 * Default model cost table.
 * Can be overridden via configuration.
 */
export const DEFAULT_MODEL_COSTS: ModelCostEntry[] = [
  { model: "gpt-4o", inputCostPerMillion: 2.5, outputCostPerMillion: 10.0 },
  { model: "gpt-4o-mini", inputCostPerMillion: 0.15, outputCostPerMillion: 0.6 },
  { model: "gpt-5", inputCostPerMillion: 1.5, outputCostPerMillion: 6.0 },
  { model: "gpt-5.2", inputCostPerMillion: 1.25, outputCostPerMillion: 5.0 },
  { model: "claude-sonnet-4-20250514", inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
  { model: "claude-opus-4-20250514", inputCostPerMillion: 15.0, outputCostPerMillion: 75.0 },
  { model: "claude-haiku-4-5", inputCostPerMillion: 0.8, outputCostPerMillion: 4.0 },
  { model: "gemini-2.5-flash", inputCostPerMillion: 0.15, outputCostPerMillion: 0.6 },
  { model: "gemini-2.5-pro", inputCostPerMillion: 1.25, outputCostPerMillion: 5.0 },
  { model: "deepseek-chat", inputCostPerMillion: 0.27, outputCostPerMillion: 1.1 },
];

// ---------------------------------------------------------------------------
// Raw event types (from RunJournal)
// ---------------------------------------------------------------------------

/**
 * Raw run event for analytics processing.
 */
export interface RawRunEvent {
  eventType: string;
  category: string;
  content: string | Record<string, unknown>;
  metadata: Record<string, unknown>;
  timestamp: string;
  threadId?: string;
  runId?: string;
}

/**
 * Processed session data.
 */
interface ProcessedSession {
  threadId: string;
  startedAt: string;
  endedAt: string;
  messageCount: number;
  toolCallCount: number;
  totalTokens: number;
  durationMs: number;
  completed: boolean;
  models: Set<string>;
}

// ---------------------------------------------------------------------------
// Analytics engine
// ---------------------------------------------------------------------------

/**
 * Telemetry analytics engine.
 */
export class TelemetryAnalytics {
  private modelCosts: Map<string, ModelCostEntry>;

  constructor(modelCosts?: ModelCostEntry[]) {
    this.modelCosts = new Map();
    const costs = modelCosts ?? DEFAULT_MODEL_COSTS;
    for (const entry of costs) {
      this.modelCosts.set(entry.model, entry);
    }
  }

  // ------------------------------------------------------------------
  // Token analytics
  // ------------------------------------------------------------------

  /**
   * Compute token usage summary from raw events.
   */
  computeTokenUsage(events: RawRunEvent[], query: TelemetryQuery): TokenUsageSummary {
    const byModelMap = new Map<string, ModelTokenUsage>();
    const bucketMap = new Map<string, number>();
    let totalInput = 0;
    let totalOutput = 0;
    let totalCalls = 0;

    for (const event of events) {
      if (event.eventType !== "llm.ai.response") continue;
      const usage = event.metadata["usage"] as Record<string, unknown> | undefined;
      if (!usage) continue;

      const inputTokens = (usage["input_tokens"] as number) ?? 0;
      const outputTokens = (usage["output_tokens"] as number) ?? 0;
      const totalTokens = (usage["total_tokens"] as number) ?? (inputTokens + outputTokens);

      if (totalTokens <= 0) continue;

      // Per-model
      const model = (event.metadata["model"] as string) ?? "unknown";
      if (query.model && model !== query.model) continue;

      let modelUsage = byModelMap.get(model);
      if (!modelUsage) {
        modelUsage = { model, inputTokens: 0, outputTokens: 0, totalTokens: 0, callCount: 0 };
        byModelMap.set(model, modelUsage);
      }
      modelUsage.inputTokens += inputTokens;
      modelUsage.outputTokens += outputTokens;
      modelUsage.totalTokens += totalTokens;
      modelUsage.callCount++;

      totalInput += inputTokens;
      totalOutput += outputTokens;
      totalCalls++;

      // Time bucket
      const bucket = this.getBucketKey(event.timestamp, query.bucket ?? "day");
      bucketMap.set(bucket, (bucketMap.get(bucket) ?? 0) + totalTokens);
    }

    // Build time series
    const timeSeries: TimeSeries[] = [{
      metric: "tokens",
      bucket: query.bucket ?? "day",
      points: [...bucketMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([timestamp, value]) => ({ timestamp, value })),
      total: totalInput + totalOutput,
      average: bucketMap.size > 0 ? (totalInput + totalOutput) / bucketMap.size : 0,
    }];

    // Calculate costs
    let estimatedTotalCost = 0;
    const byModel = [...byModelMap.values()];
    for (const usage of byModel) {
      const cost = this.modelCosts.get(usage.model);
      if (cost) {
        const inputCost = (usage.inputTokens / 1_000_000) * cost.inputCostPerMillion;
        const outputCost = (usage.outputTokens / 1_000_000) * cost.outputCostPerMillion;
        usage.estimatedCostUsd = Math.round((inputCost + outputCost) * 10000) / 10000;
        estimatedTotalCost += inputCost + outputCost;
      }
    }

    return {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
      totalCalls,
      byModel,
      timeSeries,
      estimatedTotalCostUsd: Math.round(estimatedTotalCost * 100) / 100,
    };
  }

  // ------------------------------------------------------------------
  // Tool analytics
  // ------------------------------------------------------------------

  /**
   * Compute tool usage summary from raw events.
   */
  computeToolUsage(events: RawRunEvent[], _query: TelemetryQuery): ToolUsageSummary {
    const byToolMap = new Map<string, ToolStats>();
    let totalCalls = 0;

    for (const event of events) {
      if (event.eventType !== "llm.tool.result") continue;

      const toolName = (event.metadata["tool_name"] as string) ?? "unknown";
      const success = event.metadata["error"] === undefined;

      let stats = byToolMap.get(toolName);
      if (!stats) {
        stats = {
          toolName,
          callCount: 0,
          successCount: 0,
          failureCount: 0,
          averageDurationMs: 0,
          totalDurationMs: 0,
          lastCalledAt: event.timestamp,
        };
        byToolMap.set(toolName, stats);
      }

      stats.callCount++;
      if (success) {
        stats.successCount++;
      } else {
        stats.failureCount++;
      }
      stats.lastCalledAt = event.timestamp;
      totalCalls++;
    }

    const byTool = [...byToolMap.values()];
    const mostUsed = [...byTool].sort((a, b) => b.callCount - a.callCount).slice(0, 10);
    const leastReliable = [...byTool]
      .filter((t) => t.callCount > 0)
      .sort((a, b) => {
        const rateA = a.failureCount / a.callCount;
        const rateB = b.failureCount / b.callCount;
        return rateB - rateA;
      })
      .slice(0, 5);

    return { totalCalls, byTool, mostUsed, leastReliable };
  }

  // ------------------------------------------------------------------
  // Session analytics
  // ------------------------------------------------------------------

  /**
   * Compute session analytics from raw events.
   */
  computeSessionAnalytics(events: RawRunEvent[], query: TelemetryQuery): SessionAnalyticsSummary {
    const sessions = this.buildSessions(events);

    let totalDuration = 0;
    let totalMessages = 0;
    let totalTokens = 0;
    let completedSessions = 0;
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    let activeSessions = 0;

    const startBucketMap = new Map<string, number>();
    const durationBucketMap = new Map<string, number>();

    for (const session of sessions) {
      totalDuration += session.durationMs;
      totalMessages += session.messageCount;
      totalTokens += session.totalTokens;
      if (session.completed) completedSessions++;

      if (now - new Date(session.endedAt).getTime() < oneDayMs) {
        activeSessions++;
      }

      const startBucket = this.getBucketKey(session.startedAt, query.bucket ?? "day");
      startBucketMap.set(startBucket, (startBucketMap.get(startBucket) ?? 0) + 1);

      const endBucket = this.getBucketKey(session.endedAt, query.bucket ?? "day");
      durationBucketMap.set(endBucket, (durationBucketMap.get(endBucket) ?? 0) + session.durationMs);
    }

    const sessionCount = sessions.length || 1;

    return {
      totalSessions: sessions.length,
      activeSessions,
      averageDurationMs: Math.round(totalDuration / sessionCount),
      averageMessagesPerSession: Math.round(totalMessages / sessionCount),
      averageTokensPerSession: Math.round(totalTokens / sessionCount),
      successRate: sessions.length > 0 ? completedSessions / sessions.length : 0,
      sessionStarts: [{
        metric: "session_starts",
        bucket: query.bucket ?? "day",
        points: [...startBucketMap.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([timestamp, value]) => ({ timestamp, value })),
        total: sessions.length,
        average: sessions.length / (startBucketMap.size || 1),
      }],
      sessionDurations: [{
        metric: "session_duration",
        bucket: query.bucket ?? "day",
        points: [...durationBucketMap.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([timestamp, value]) => ({ timestamp, value: Math.round(value) })),
        total: totalDuration,
        average: totalDuration / (durationBucketMap.size || 1),
      }],
    };
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  /**
   * Build processed sessions from raw events.
   */
  private buildSessions(events: RawRunEvent[]): ProcessedSession[] {
    const sessionMap = new Map<string, ProcessedSession>();

    for (const event of events) {
      const threadId = event.threadId ?? "unknown";
      let session = sessionMap.get(threadId);

      if (!session) {
        session = {
          threadId,
          startedAt: event.timestamp,
          endedAt: event.timestamp,
          messageCount: 0,
          toolCallCount: 0,
          totalTokens: 0,
          durationMs: 0,
          completed: false,
          models: new Set(),
        };
        sessionMap.set(threadId, session);
      }

      session.endedAt = event.timestamp;
      session.durationMs = new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime();

      if (event.eventType === "llm.ai.response" || event.eventType === "llm.human.input") {
        session.messageCount++;
      }

      if (event.eventType === "llm.tool.result") {
        session.toolCallCount++;
      }

      if (event.eventType === "llm.ai.response") {
        const usage = event.metadata["usage"] as Record<string, unknown> | undefined;
        if (usage) {
          const total = (usage["total_tokens"] as number) ?? 0;
          session.totalTokens += total;
        }
        const model = event.metadata["model"] as string | undefined;
        if (model) session.models.add(model);
      }

      if (event.eventType === "run.end") {
        session.completed = true;
      }
    }

    return [...sessionMap.values()];
  }

  /**
   * Get time bucket key for a timestamp.
   */
  private getBucketKey(isoTimestamp: string, bucket: TimeBucket): string {
    const date = new Date(isoTimestamp);
    switch (bucket) {
      case "hour":
        return `${date.toISOString().slice(0, 13)}:00:00.000Z`;
      case "day":
        return date.toISOString().slice(0, 10) + "T00:00:00.000Z";
      case "week": {
        const d = new Date(date);
        d.setDate(d.getDate() - d.getDay());
        return d.toISOString().slice(0, 10) + "T00:00:00.000Z";
      }
      case "month":
        return date.toISOString().slice(0, 7) + "-01T00:00:00.000Z";
    }
  }
}
