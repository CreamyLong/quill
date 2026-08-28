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
}
