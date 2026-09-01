/**
 * Heartbeat configuration.
 *
 * Port of OpenClaw's heartbeat system. The heartbeat is a periodic agent
 * turn in the main session that checks whether anything needs attention.
 * Unlike ordinary scheduled tasks, the heartbeat:
 *
 *   - Runs in the main session (not an isolated thread).
 *   - Maintains a private "monitor scratch" checklist that survives restarts.
 *   - Defaults to NO_REPLY when nothing needs attention (cost control).
 *   - Supports active-hours windows and busy deferral.
 */

/** Delivery target for heartbeat alerts. */
export type HeartbeatDelivery = "owner" | "last" | "none";

/** Configuration for the heartbeat system. */
export interface HeartbeatConfig {
  /** Master switch. Default: false. */
  enabled: boolean;
  /**
   * Cadence in minutes. Default: 30.
   * The heartbeat fires every `cadenceMinutes` minutes.
   */
  cadenceMinutes: number;
  /**
   * Model override for heartbeat turns. When null, uses a cheaper model
   * if `useCheaperModel` is true, otherwise the default model.
   */
  modelName: string | null;
  /** Use a cheaper model for heartbeat turns. Default: true. */
  useCheaperModel: boolean;
  /**
   * Active hours window (24h format, configured timezone).
   * Outside this window, heartbeats are skipped.
   * Null means always active.
   */
  activeHoursStart: number | null; // 0-23
  activeHoursEnd: number | null; // 0-23
  /** Timezone for active hours. Default: "UTC". */
  timezone: string;
  /**
   * Isolated session mode: each heartbeat runs in a fresh session with
   * no conversation history (reduces token usage from ~100K to ~2-5K).
   * Default: true.
   */
  isolatedSession: boolean;
  /**
   * Light context mode: skip workspace bootstrap to reduce tokens.
   * Default: true.
   */
  lightContext: boolean;
  /** Delivery target for alerts. Default: "owner". */
  delivery: HeartbeatDelivery;
  /**
   * Maximum number of consecutive NO_REPLY responses before suppressing
   * the heartbeat (cost control). Null means no limit.
   */
  maxConsecutiveNoReply: number | null;
}

/** Default heartbeat configuration. */
export function defaultHeartbeatConfig(): HeartbeatConfig {
  return {
    enabled: false,
    cadenceMinutes: 30,
    modelName: null,
    useCheaperModel: true,
    activeHoursStart: null,
    activeHoursEnd: null,
    timezone: "UTC",
    isolatedSession: true,
    lightContext: true,
    delivery: "owner",
    maxConsecutiveNoReply: null,
  };
}

/**
 * Build a HeartbeatConfig from a raw config section (snake_case YAML → camelCase).
 */
export function buildHeartbeatConfig(
  input: Record<string, unknown> = {},
): HeartbeatConfig {
  const defaults = defaultHeartbeatConfig();
  return {
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : defaults.enabled,
    cadenceMinutes:
      input.cadence_minutes !== undefined
        ? Math.max(1, Number(input.cadence_minutes))
        : defaults.cadenceMinutes,
    modelName:
      input.model_name !== undefined
        ? (input.model_name as string | null)
        : defaults.modelName,
    useCheaperModel:
      input.use_cheaper_model !== undefined
        ? Boolean(input.use_cheaper_model)
        : defaults.useCheaperModel,
    activeHoursStart:
      input.active_hours_start !== undefined
        ? Number(input.active_hours_start)
        : defaults.activeHoursStart,
    activeHoursEnd:
      input.active_hours_end !== undefined
        ? Number(input.active_hours_end)
        : defaults.activeHoursEnd,
    timezone:
      input.timezone !== undefined ? String(input.timezone) : defaults.timezone,
    isolatedSession:
      input.isolated_session !== undefined
        ? Boolean(input.isolated_session)
        : defaults.isolatedSession,
    lightContext:
      input.light_context !== undefined
        ? Boolean(input.light_context)
        : defaults.lightContext,
    delivery:
      input.delivery !== undefined
        ? (input.delivery as HeartbeatDelivery)
        : defaults.delivery,
    maxConsecutiveNoReply:
      input.max_consecutive_no_reply !== undefined
        ? Number(input.max_consecutive_no_reply)
        : defaults.maxConsecutiveNoReply,
  };
}
