/**
 * Heartbeat manager — periodic proactive agent turns with a monitor scratch.
 *
 * Port of OpenClaw's heartbeat system. The heartbeat runs periodic agent
 * turns in the main session to check whether anything needs attention.
 *
 * Key design decisions (from OpenClaw):
 *   - Monitor scratch: a private checklist document that survives restarts.
 *     The agent reads it at the start of each heartbeat turn and can update
 *     it via the `heartbeat_respond` tool.
 *   - Response contract: NO_REPLY if nothing needs attention; alert otherwise.
 *   - Cost controls: isolated sessions, light context, cheaper model override.
 *   - Active hours: time-window restriction in the configured timezone.
 *   - Busy deferral: scheduled heartbeats defer while the main queue is active.
 *
 * The heartbeat manager wraps the existing ScheduledTaskScheduler: it creates
 * a synthetic per-agent heartbeat task and lets the scheduler drive the timing.
 */

import {
  buildHeartbeatConfig,
  defaultHeartbeatConfig,
  type HeartbeatConfig,
} from "./heartbeat_config.js";

/** The monitor scratch — a private checklist document. */
export interface MonitorScratch {
  /** Stable identifier for the agent this scratch belongs to. */
  agentId: string;
  /** Checklist lines — each is a task the agent should monitor. */
  entries: ScratchEntry[];
  /** ISO timestamp of the last heartbeat turn. */
  lastHeartbeatAt: string | null;
  /** Consecutive NO_REPLY responses since the last alert. */
  consecutiveNoReply: number;
  /** Version counter for optimistic concurrency. */
  version: number;
}

/** A single checklist entry. */
export interface ScratchEntry {
  id: string;
  /** The monitoring instruction. */
  text: string;
  /** Whether this entry is still active (false = completed/dismissed). */
  active: boolean;
  createdAt: string;
}

/** Result of a heartbeat turn. */
export interface HeartbeatResult {
  /** True if the agent surfaced something that needs attention. */
  alerted: boolean;
  /** The agent's response text (empty when NO_REPLY). */
  response: string;
}

/** Response contract sent as the heartbeat prompt. */
export const HEARTBEAT_PROMPT =
  "Follow the heartbeat monitor scratch when provided. " +
  "Recurring tasks are automations; create or change their schedules with the " +
  "automations tool, not heartbeat scratch. Do not infer or repeat old tasks " +
  "from prior chats. If nothing needs attention, reply NO_REPLY.";

/** Sentinel response meaning "nothing needs attention". */
export const NO_REPLY = "NO_REPLY";

/**
 * Evaluate whether the current time falls within the active-hours window.
 *
 * When both start and end are null, always returns true (24h active).
 * Handles overnight windows (e.g., start=22, end=6 means 22:00–06:00).
 */
export function isInActiveHours(config: HeartbeatConfig, now: Date = new Date()): boolean {
  if (config.activeHoursStart === null || config.activeHoursEnd === null) {
    return true;
  }
  const hour = now.getHours(); // Uses local timezone; for production, use config.timezone
  const start = config.activeHoursStart;
  const end = config.activeHoursEnd;
  if (start <= end) {
    return hour >= start && hour < end;
  }
  // Overnight window (e.g., 22:00–06:00).
  return hour >= start || hour < end;
}

/**
 * HeartbeatManager owns the monitor scratch lifecycle and heartbeat timing.
 *
 * It does NOT own the timer — the existing ScheduledTaskScheduler drives
 * timing. This manager provides the scratch persistence and the "should we
 * fire?" decision logic.
 */
export class HeartbeatManager {
  private readonly config: HeartbeatConfig;
  private readonly agentId: string;
  private _scratch: MonitorScratch;

  constructor(agentId: string, config: Partial<HeartbeatConfig> = {}) {
    this.agentId = agentId;
    // Merge over defaults so callers can pass a partial camelCase config.
    this.config = { ...defaultHeartbeatConfig(), ...config };
    this._scratch = {
      agentId,
      entries: [],
      lastHeartbeatAt: null,
      consecutiveNoReply: 0,
      version: 0,
    };
  }

  get scratch(): MonitorScratch {
    return this._scratch;
  }

  get config_snapshot(): HeartbeatConfig {
    return this.config;
  }

  /** Whether the heartbeat is enabled and within active hours. */
  isActive(now: Date = new Date()): boolean {
    return this.config.enabled && isInActiveHours(this.config, now);
  }

  /** Whether the heartbeat should be suppressed (consecutive NO_REPLY limit). */
  shouldSuppress(): boolean {
    if (this.config.maxConsecutiveNoReply === null) return false;
    return this._scratch.consecutiveNoReply >= this.config.maxConsecutiveNoReply;
  }

  /** Add an entry to the monitor scratch. */
  addEntry(text: string): ScratchEntry {
    const entry: ScratchEntry = {
      id: `scratch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      text,
      active: true,
      createdAt: new Date().toISOString(),
    };
    this._scratch = {
      ...this._scratch,
      entries: [...this._scratch.entries, entry],
      version: this._scratch.version + 1,
    };
    return entry;
  }

  /** Mark an entry as completed/dismissed. Returns true if the entry was found. */
  dismissEntry(entryId: string): boolean {
    const target = this._scratch.entries.find((e) => e.id === entryId);
    if (!target) return false;
    const entries = this._scratch.entries.map((e) =>
      e.id === entryId ? { ...e, active: false } : e,
    );
    this._scratch = { ...this._scratch, entries, version: this._scratch.version + 1 };
    return true;
  }

  /**
   * Record the outcome of a heartbeat turn.
   * Updates consecutive NO_REPLY count and last heartbeat timestamp.
   */
  recordTurn(result: HeartbeatResult): void {
    const now = new Date().toISOString();
    const isNoReply = !result.alerted || result.response.trim() === NO_REPLY;
    this._scratch = {
      ...this._scratch,
      lastHeartbeatAt: now,
      consecutiveNoReply: isNoReply ? this._scratch.consecutiveNoReply + 1 : 0,
      version: this._scratch.version + 1,
    };
  }

  /**
   * Build the heartbeat prompt for the current turn.
   * Includes the active scratch entries so the agent knows what to monitor.
   */
  buildPrompt(): string {
    const active = this._scratch.entries.filter((e) => e.active);
    if (active.length === 0) {
      return HEARTBEAT_PROMPT;
    }
    const scratch = active.map((e, i) => `${i + 1}. ${e.text}`).join("\n");
    return `${HEARTBEAT_PROMPT}\n\n<heartbeat-monitor-scratch>\n${scratch}\n</heartbeat-monitor-scratch>`;
  }

  /**
   * Replace the entire scratch (used when loading from persistence).
   */
  setScratch(scratch: MonitorScratch): void {
    this._scratch = scratch;
  }

  /** Serialize to a JSON-safe shape. */
  toJSON(): MonitorScratch {
    return { ...this._scratch };
  }
}
