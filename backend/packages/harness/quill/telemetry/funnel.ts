/**
 * Funnel Telemetry — drop-off analysis for user journeys.
 *
 * Inspired by ZCode's "Funnel Telemetry" which collects usage data at various
 * stages to identify drop-off points. This module tracks the user journey
 * through key stages of interaction with Quill and reports where users
 * abandon or fail to complete flows.
 *
 * Stages tracked:
 * - session_start → message_sent → tool_invoked → result_viewed → session_end
 * - workflow_created → workflow_started → node_completed → workflow_finished
 * - skill_activated → skill_executed → skill_succeeded
 *
 * Drop-off analysis helps identify UX friction points and reliability issues.
 */

export interface FunnelEvent {
  /** Event type / stage name. */
  stage: FunnelStage;
  /** Session/thread ID. */
  sessionId: string;
  /** User ID (if available). */
  userId?: string;
  /** Timestamp. */
  timestamp: string;
  /** Duration since session start (ms). */
  elapsedMs: number;
  /** Whether this is a success or failure at this stage. */
  success: boolean;
  /** Optional metadata (tool name, workflow ID, etc.). */
  metadata?: Record<string, unknown>;
}

export type FunnelStage =
  | "session_start"
  | "message_sent"
  | "tool_invoked"
  | "tool_succeeded"
  | "tool_failed"
  | "result_viewed"
  | "session_end"
  | "workflow_created"
  | "workflow_started"
  | "workflow_node_completed"
  | "workflow_node_failed"
  | "workflow_finished"
  | "workflow_abandoned"
  | "skill_activated"
  | "skill_executed"
  | "skill_succeeded"
  | "skill_failed";

export interface FunnelAnalysis {
  /** Total sessions analyzed. */
  totalSessions: number;
  /** Stage-by-stage counts and conversion rates. */
  stages: Array<{
    stage: FunnelStage;
    count: number;
    /** Conversion rate from previous stage (0-1). */
    conversionRate: number;
    /** Drop-off rate from previous stage (0-1). */
    dropOffRate: number;
    /** Average time to reach this stage from session start (ms). */
    avgElapsedMs: number;
  }>;
  /** Biggest drop-off points (sorted by drop-off rate). */
  dropOffPoints: Array<{
    fromStage: FunnelStage;
    toStage: FunnelStage;
    dropOffRate: number;
    count: number;
  }>;
  /** Overall completion rate (session_start → session_end). */
  overallCompletionRate: number;
}

export interface FunnelTelemetryOptions {
  /** Maximum events to retain in memory. */
  maxEvents: number;
  /** Stage ordering for funnel analysis. */
  stageOrder: FunnelStage[];
}

const DEFAULT_STAGE_ORDER: FunnelStage[] = [
  "session_start",
  "message_sent",
  "tool_invoked",
  "result_viewed",
  "session_end",
];

export class FunnelTelemetry {
  private events: FunnelEvent[] = [];
  private options: FunnelTelemetryOptions;

  constructor(options?: Partial<FunnelTelemetryOptions>) {
    this.options = {
      maxEvents: 10_000,
      stageOrder: DEFAULT_STAGE_ORDER,
      ...options,
    };
  }

  /** Record a funnel event. */
  record(event: FunnelEvent): void {
    this.events.push(event);
    if (this.events.length > this.options.maxEvents) {
      this.events = this.events.slice(-this.options.maxEvents);
    }
  }

  /** Record a simple stage transition. */
  track(
    stage: FunnelStage,
    sessionId: string,
    success = true,
    metadata?: Record<string, unknown>,
  ): void {
    const sessionStart = this.findSessionStart(sessionId);
    const elapsedMs = sessionStart
      ? Date.now() - new Date(sessionStart.timestamp).getTime()
      : 0;

    this.record({
      stage,
      sessionId,
      timestamp: new Date().toISOString(),
      elapsedMs,
      success,
      metadata,
    });
  }

  /**
   * Analyze funnel conversion and drop-off.
   *
   * Produces a stage-by-stage report showing where users drop off.
   */
  analyze(sessionIds?: string[]): FunnelAnalysis {
    const filtered = sessionIds
      ? this.events.filter((e) => sessionIds.includes(e.sessionId))
      : this.events;

    const sessions = new Set(filtered.map((e) => e.sessionId));
    const totalSessions = sessions.size;

    const stageOrder = this.options.stageOrder;
    const stageCounts = new Map<FunnelStage, { count: number; totalElapsed: number }>();

    for (const stage of stageOrder) {
      const stageEvents = filtered.filter(
        (e) => e.stage === stage && e.success,
      );
      stageCounts.set(stage, {
        count: stageEvents.length,
        totalElapsed: stageEvents.reduce((sum, e) => sum + e.elapsedMs, 0),
      });
    }

    const stages = stageCountsToAnalysis(stageOrder, stageCounts);
    const dropOffPoints = computeDropOffPoints(stages);

    const startCount = stageCounts.get(stageOrder[0])?.count ?? 0;
    const endCount = stageCounts.get(stageOrder[stageOrder.length - 1])?.count ?? 0;

    return {
      totalSessions,
      stages,
      dropOffPoints: dropOffPoints.sort((a, b) => b.dropOffRate - a.dropOffRate),
      overallCompletionRate: startCount > 0 ? endCount / startCount : 0,
    };
  }

  /** Get raw events for a session. */
  getSessionEvents(sessionId: string): FunnelEvent[] {
    return this.events.filter((e) => e.sessionId === sessionId);
  }

  /** Clear all events. */
  clear(): void {
    this.events = [];
  }

  /** Get event count. */
  size(): number {
    return this.events.length;
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private findSessionStart(sessionId: string): FunnelEvent | undefined {
    for (const event of this.events) {
      if (event.sessionId === sessionId && event.stage === "session_start") {
        return event;
      }
    }
    return undefined;
  }
}

function stageCountsToAnalysis(
  stageOrder: FunnelStage[],
  counts: Map<FunnelStage, { count: number; totalElapsed: number }>,
): FunnelAnalysis["stages"] {
  const result: FunnelAnalysis["stages"] = [];
  let prevCount = 0;

  for (let i = 0; i < stageOrder.length; i++) {
    const stage = stageOrder[i];
    const data = counts.get(stage) ?? { count: 0, totalElapsed: 0 };
    const prev = i > 0 ? counts.get(stageOrder[i - 1])?.count ?? 0 : data.count;

    prevCount = prev;
    result.push({
      stage,
      count: data.count,
      conversionRate: prev > 0 ? data.count / prev : 1,
      dropOffRate: prev > 0 ? 1 - data.count / prev : 0,
      avgElapsedMs: data.count > 0 ? Math.round(data.totalElapsed / data.count) : 0,
    });
  }

  return result;
}

function computeDropOffPoints(
  stages: FunnelAnalysis["stages"],
): FunnelAnalysis["dropOffPoints"] {
  const points: FunnelAnalysis["dropOffPoints"] = [];
  for (let i = 1; i < stages.length; i++) {
    if (stages[i].dropOffRate > 0) {
      points.push({
        fromStage: stages[i - 1].stage,
        toStage: stages[i].stage,
        dropOffRate: stages[i].dropOffRate,
        count: stages[i - 1].count - stages[i].count,
      });
    }
  }
  return points;
}
