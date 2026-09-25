/**
 * Telemetry system — conversation analytics and usage tracking.
 *
 * Inspired by ZCode's conversation telemetry and Kimi Code's usage analytics.
 *
 * Features:
 *   - Token usage analytics (by model, by time, by thread)
 *   - Tool call frequency and pattern analysis
 *   - Session duration and success rate tracking
 *   - Cost tracking with configurable model pricing
 *   - Time-bucketed analytics queries
 */

export {
  type TimeBucket,
  type TimeSeriesPoint,
  type TimeSeries,
  type ModelTokenUsage,
  type TokenUsageSummary,
  type ToolStats,
  type ToolUsageSummary,
  type SessionStats,
  type SessionAnalyticsSummary,
  type ModelCostEntry,
  type CostSummary,
  type TelemetryDashboard,
  type TelemetryQuery,
} from "./types.js";

export {
  DEFAULT_MODEL_COSTS,
  type RawRunEvent,
  TelemetryAnalytics,
} from "./analytics.js";
