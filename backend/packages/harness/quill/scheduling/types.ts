/**
 * Scheduled task types.
 *
 * A scheduled task runs the agent autonomously on a schedule: either at a
 * fixed interval (`interval`) or on a 5-field cron expression (`cron`).
 *
 * This mirrors the capability shipped by OpenClaw (cron + heartbeat scheduled
 * runs) and OpenWork (automations engine). Tasks are plain JSON documents
 * (snake_case fields, matching the gateway wire format elsewhere) so the
 * file store and the HTTP API share one shape.
 */

/** How often a scheduled task fires. */
export type ScheduleSpec =
  | { kind: "interval"; everySeconds: number }
  | { kind: "cron"; expression: string };

/** Outcome of a single scheduled run attempt. */
export type ScheduledRunStatus = "success" | "error" | "cancelled" | "skipped";

/** A scheduled task document as persisted and served over the API. */
export interface ScheduledTask {
  /** Stable UUID. */
  id: string;
  /** Human-readable label shown in the UI. */
  name: string;
  /** Prompt sent to the agent each time the task fires. */
  prompt: string;
  /** When the task fires. */
  schedule: ScheduleSpec;
  /**
   * Thread to run in. `null` means each fire creates a fresh thread so
   * runs stay isolated from interactive conversations.
   */
  thread_id: string | null;
  /** Disabled tasks are skipped by the scheduler. */
  enabled: boolean;
  created_at: string;
  updated_at: string;
  /** ISO timestamp of the last fired run (any status). */
  last_run_at: string | null;
  last_status: ScheduledRunStatus | null;
  /** Run id of the last fired run. */
  last_run_id: string | null;
  /** ISO timestamp of the next scheduled fire. */
  next_run_at: string | null;
  /** Number of fired runs so far (skips are not counted). */
  run_count: number;
}

/** Wire input for creating/updating a scheduled task. */
export interface ScheduledTaskInput {
  name?: string;
  prompt?: string;
  schedule?: ScheduleSpec;
  thread_id?: string | null;
  enabled?: boolean;
  /** Maximum jitter in seconds to spread load (default: 0 = no jitter). */
  max_jitter_seconds?: number;
  /** Whether to skip if previous run is still in-flight (default: true). */
  coalesce?: boolean;
  /** Days before a stale task is auto-disabled (default: 7, 0 = never). */
  stale_threshold_days?: number;
  /** Optional model override for this task's runs. */
  model?: string | null;
}

/** Enhanced scheduling features (from Kimi Code + DeerFlow 2.0). */
export interface SchedulingFeatures {
  /** Deterministic jitter: spread load with configurable max jitter. */
  maxJitterSeconds: number;
  /** Coalescing: skip if previous run still in-flight. */
  coalesce: boolean;
  /** Stale cleanup: auto-disable tasks not run in N days (0 = never). */
  staleThresholdDays: number;
}

export const DEFAULT_SCHEDULING_FEATURES: SchedulingFeatures = {
  maxJitterSeconds: 0,
  coalesce: true,
  staleThresholdDays: 7,
};
