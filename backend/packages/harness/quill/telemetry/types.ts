/**
 * Telemetry system — conversation analytics and usage tracking.
 *
 * Inspired by ZCode's conversation telemetry and Kimi Code's usage analytics.
 *
 * Provides comprehensive analytics on:
 *   - Token usage (by model, by time period, by thread)
 *   - Tool call frequency and patterns
 *   - Session duration and message counts
 *   - Success/failure rates
 *   - Cost tracking
 *   - Usage patterns over time
 *
 * Source patterns:
 * - ZCode: Conversation telemetry with detailed analytics
 * - Kimi Code: Usage analytics and token tracking
 * - OpenClaw: Usage stats and activity metrics
 * - CrewAI: AMP Suite observability
 */

// ---------------------------------------------------------------------------
// Time series
// ---------------------------------------------------------------------------

/**
 * Time bucket granularity.
 */
export type TimeBucket = "hour" | "day" | "week" | "month";

/**
 * A single time-series data point.
 */
export interface TimeSeriesPoint {
  /** ISO timestamp for the start of the bucket. */
  timestamp: string;
  /** Numeric value for this bucket. */
  value: number;
}

/**
 * Time series with metadata.
 */
export interface TimeSeries {
  /** Metric name. */
  metric: string;
  /** Time bucket granularity. */
  bucket: TimeBucket;
  /** Data points. */
  points: TimeSeriesPoint[];
  /** Total across all buckets. */
  total: number;
  /** Average per bucket. */
  average: number;
}

// ---------------------------------------------------------------------------
// Token analytics
// ---------------------------------------------------------------------------

/**
 * Token usage breakdown by model.
 */
export interface ModelTokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  callCount: number;
  /** Estimated cost in USD (if pricing available). */
  estimatedCostUsd?: number;
}

/**
 * Token usage summary.
 */
export interface TokenUsageSummary {
  /** Total input tokens. */
  totalInputTokens: number;
  /** Total output tokens. */
  totalOutputTokens: number;
  /** Total tokens. */
  totalTokens: number;
  /** Total LLM calls. */
  totalCalls: number;
  /** Breakdown by model. */
  byModel: ModelTokenUsage[];
  /** Time series of token usage. */
  timeSeries: TimeSeries[];
  /** Estimated total cost. */
  estimatedTotalCostUsd?: number;
}

// ---------------------------------------------------------------------------
// Tool analytics
// ---------------------------------------------------------------------------

/**
 * Tool call statistics.
 */
export interface ToolStats {
  toolName: string;
  callCount: number;
  successCount: number;
  failureCount: number;
  /** Average execution time in ms. */
  averageDurationMs: number;
  /** Total execution time in ms. */
  totalDurationMs: number;
  /** Last called timestamp. */
  lastCalledAt: string;
}

/**
 * Tool usage summary.
 */
export interface ToolUsageSummary {
  /** Total tool calls. */
  totalCalls: number;
  /** Per-tool statistics. */
  byTool: ToolStats[];
  /** Most used tools (top N). */
  mostUsed: ToolStats[];
  /** Least reliable tools (highest failure rate). */
  leastReliable: ToolStats[];
}

// ---------------------------------------------------------------------------
// Session analytics
// ---------------------------------------------------------------------------

/**
 * Session statistics.
 */
export interface SessionStats {
  threadId: string;
  messageCount: number;
  toolCallCount: number;
  totalTokens: number;
  durationMs: number;
  /** Whether the session completed successfully. */
  completed: boolean;
  /** Session start timestamp. */
  startedAt: string;
  /** Session end timestamp. */
  endedAt: string;
  /** Models used in this session. */
  modelsUsed: string[];
}

/**
 * Session analytics summary.
 */
export interface SessionAnalyticsSummary {
  /** Total sessions. */
  totalSessions: number;
  /** Active sessions (last 24h). */
  activeSessions: number;
  /** Average session duration in ms. */
  averageDurationMs: number;
  /** Average messages per session. */
  averageMessagesPerSession: number;
  /** Average tokens per session. */
  averageTokensPerSession: number;
  /** Success rate (0-1). */
  successRate: number;
  /** Time series of session starts. */
  sessionStarts: TimeSeries[];
  /** Time series of session duration. */
  sessionDurations: TimeSeries[];
}

// ---------------------------------------------------------------------------
// Cost tracking
// ---------------------------------------------------------------------------

/**
 * Cost entry for a model.
 */
export interface ModelCostEntry {
  model: string;
  /** Cost per 1M input tokens. */
  inputCostPerMillion: number;
  /** Cost per 1M output tokens. */
  outputCostPerMillion: number;
}

/**
 * Cost summary.
 */
export interface CostSummary {
  /** Total estimated cost in USD. */
  totalCostUsd: number;
  /** Cost by model. */
  byModel: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  /** Daily cost time series. */
  dailyCosts: TimeSeries[];
  /** Projected monthly cost based on current usage. */
  projectedMonthlyCostUsd?: number;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * Complete telemetry dashboard data.
 */
export interface TelemetryDashboard {
  /** When this data was generated. */
  generatedAt: string;
  /** Time range for the data. */
  timeRange: {
    start: string;
    end: string;
    bucket: TimeBucket;
  };
  /** Token usage summary. */
  tokens: TokenUsageSummary;
  /** Tool usage summary. */
  tools: ToolUsageSummary;
  /** Session analytics. */
  sessions: SessionAnalyticsSummary;
  /** Cost summary. */
  costs: CostSummary;
  /** Key metrics at a glance. */
  overview: {
    totalSessions: number;
    totalTokens: number;
    totalToolCalls: number;
    totalCostUsd: number;
    averageTokensPerSession: number;
    successRate: number;
    mostUsedModel: string;
    mostUsedTool: string;
  };
}

// ---------------------------------------------------------------------------
// Query parameters
// ---------------------------------------------------------------------------

/**
 * Telemetry query parameters.
 */
export interface TelemetryQuery {
  /** Start of time range (ISO string). */
  startDate?: string;
  /** End of time range (ISO string). */
  endDate?: string;
  /** Time bucket granularity. */
  bucket?: TimeBucket;
  /** Filter by model name. */
  model?: string;
  /** Filter by thread ID. */
  threadId?: string;
  /** Maximum number of results. */
  limit?: number;
}
