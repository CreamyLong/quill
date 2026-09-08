/**
 * Adaptive Permissions System.
 *
 * Inspired by the awesome-harness-engineering "Adaptive Permissions" pattern and
 * OpenClaw's tool policy layers. As users gain experience and sessions accumulate,
 * the system progressively reduces approval friction — shifting from per-action
 * approval toward intervention-only oversight.
 *
 * Permission levels (progressive trust):
 *   0 — Strict: Every destructive/external tool action requires explicit approval.
 *   1 — Standard: Read-only tools auto-approved; destructive tools require approval.
 *   2 — Relaxed: Read-only and idempotent tools auto-approved; destructive + open-world require approval.
 *   3 — Trusted: All tools except critical (destructive + external) are auto-approved.
 *   4 — Full: All tools auto-approved; only loop detection and budget guards remain.
 *
 * Progression is based on:
 *   - Session count (more sessions → higher trust)
 *   - Successful tool-call ratio (fewer errors → higher trust)
 *   - Account age (older accounts → higher trust)
 *   - Manual override (user can lock to a specific level)
 *
 * The level is computed per-user and cached. It can be pinned by the user
 * (never auto-advance beyond the pinned level).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionLevel = 0 | 1 | 2 | 3 | 4;

export interface UserTrustProfile {
  user_id: string;
  /** Current computed permission level. */
  level: PermissionLevel;
  /** User-pinned maximum level (optional). If set, auto-advance stops here. */
  pinned_max_level?: PermissionLevel;
  /** Total sessions initiated. */
  session_count: number;
  /** Total tool calls made. */
  total_tool_calls: number;
  /** Successful tool calls (no error). */
  successful_tool_calls: number;
  /** Account creation timestamp. */
  created_at: string;
  /** Last activity timestamp. */
  last_active_at: string;
  /** Manual override: if true, trust scoring is disabled and level is fixed. */
  manual_override?: boolean;
}

export interface ToolPermissionCheck {
  toolName: string;
  /** Tool annotation hints (from MCP tool annotations). */
  readOnly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  openWorld?: boolean;
  /** Whether this tool requires approval at the given level. */
  requiresApproval: boolean;
  /** Reason for the decision (for audit logging). */
  reason: string;
}

// ---------------------------------------------------------------------------
// Trust scoring
// ---------------------------------------------------------------------------

/** Thresholds for auto-advancing to each level. */
const LEVEL_THRESHOLDS: Record<PermissionLevel, {
  minSessions: number;
  minSuccessRatio: number;
  minAccountAgeDays: number;
}> = {
  0: { minSessions: 0, minSuccessRatio: 0, minAccountAgeDays: 0 },
  1: { minSessions: 5, minSuccessRatio: 0.85, minAccountAgeDays: 0 },
  2: { minSessions: 20, minSuccessRatio: 0.90, minAccountAgeDays: 7 },
  3: { minSessions: 50, minSuccessRatio: 0.93, minAccountAgeDays: 30 },
  4: { minSessions: 100, minSuccessRatio: 0.95, minAccountAgeDays: 90 },
};

/**
 * Compute the appropriate permission level for a user based on their trust profile.
 */
export function computePermissionLevel(profile: UserTrustProfile): PermissionLevel {
  if (profile.manual_override && profile.pinned_max_level !== undefined) {
    return profile.pinned_max_level;
  }

  const now = Date.now();
  const accountAgeMs = now - new Date(profile.created_at).getTime();
  const accountAgeDays = accountAgeMs / (1000 * 60 * 60 * 24);

  const successRatio = profile.total_tool_calls > 0
    ? profile.successful_tool_calls / profile.total_tool_calls
    : 0;

  // Find the highest level the user qualifies for.
  let computedLevel: PermissionLevel = 0;
  const levels: PermissionLevel[] = [1, 2, 3, 4];
  for (const level of levels) {
    const threshold = LEVEL_THRESHOLDS[level];
    if (
      profile.session_count >= threshold.minSessions &&
      successRatio >= threshold.minSuccessRatio &&
      accountAgeDays >= threshold.minAccountAgeDays
    ) {
      computedLevel = level;
    }
  }

  // Apply the pin if set.
  if (profile.pinned_max_level !== undefined) {
    return Math.min(computedLevel, profile.pinned_max_level) as PermissionLevel;
  }

  return computedLevel;
}

// ---------------------------------------------------------------------------
// Tool permission checks
// ---------------------------------------------------------------------------

/**
 * Check whether a tool requires approval at a given permission level.
 *
 * @param toolName - Name of the tool being invoked.
 * @param annotations - Tool annotation hints (readOnly, destructive, etc.).
 * @param level - Current permission level for the user.
 * @returns A ToolPermissionCheck result.
 */
export function checkToolPermission(
  toolName: string,
  annotations: {
    readOnly?: boolean;
    destructive?: boolean;
    idempotent?: boolean;
    openWorld?: boolean;
  },
  level: PermissionLevel
): ToolPermissionCheck {
  const { readOnly, destructive, idempotent, openWorld } = annotations;

  // Level 4 (Full): only critical combinations require approval.
  if (level >= 4) {
    if (destructive && openWorld) {
      return {
        toolName,
        ...annotations,
        requiresApproval: true,
        reason: "Level 4: destructive + external tools still require approval.",
      };
    }
    return { toolName, ...annotations, requiresApproval: false, reason: "Level 4: full trust." };
  }

  // Level 3 (Trusted): auto-approve everything except destructive.
  if (level >= 3) {
    if (destructive) {
      return {
        toolName,
        ...annotations,
        requiresApproval: true,
        reason: "Level 3: destructive tools require approval.",
      };
    }
    return { toolName, ...annotations, requiresApproval: false, reason: "Level 3: trusted." };
  }

  // Level 2 (Relaxed): auto-approve readOnly and idempotent.
  if (level >= 2) {
    if (readOnly || idempotent) {
      return { toolName, ...annotations, requiresApproval: false, reason: "Level 2: read-only/idempotent auto-approved." };
    }
    return {
      toolName,
      ...annotations,
      requiresApproval: true,
      reason: "Level 2: destructive or open-world tools require approval.",
    };
  }

  // Level 1 (Standard): auto-approve readOnly only.
  if (level >= 1) {
    if (readOnly) {
      return { toolName, ...annotations, requiresApproval: false, reason: "Level 1: read-only auto-approved." };
    }
    return {
      toolName,
      ...annotations,
      requiresApproval: true,
      reason: "Level 1: non-read-only tools require approval.",
    };
  }

  // Level 0 (Strict): everything requires approval.
  return {
    toolName,
    ...annotations,
    requiresApproval: true,
    reason: "Level 0: all tools require explicit approval.",
  };
}

/**
 * Batch-check multiple tools for a given level.
 * Returns the tools that would require approval.
 */
export function toolsRequiringApproval(
  tools: Array<{ name: string; annotations?: Record<string, boolean> }>,
  level: PermissionLevel
): ToolPermissionCheck[] {
  return tools
    .map((t) =>
      checkToolPermission(t.name, t.annotations ?? {}, level)
    )
    .filter((check) => check.requiresApproval);
}

// ---------------------------------------------------------------------------
// Profile store (in-memory; can be replaced with persistent store)
// ---------------------------------------------------------------------------

/**
 * In-memory store for user trust profiles.
 * In production, this should be backed by a database.
 */
export class AdaptivePermissionStore {
  private profiles = new Map<string, UserTrustProfile>();

  getProfile(userId: string): UserTrustProfile {
    let profile = this.profiles.get(userId);
    if (!profile) {
      profile = {
        user_id: userId,
        level: 0,
        session_count: 0,
        total_tool_calls: 0,
        successful_tool_calls: 0,
        created_at: new Date().toISOString(),
        last_active_at: new Date().toISOString(),
      };
      this.profiles.set(userId, profile);
    }
    return profile;
  }

  updateLevel(userId: string): PermissionLevel {
    const profile = this.getProfile(userId);
    const newLevel = computePermissionLevel(profile);
    if (newLevel !== profile.level) {
      console.log(
        `[AdaptivePermissions] User ${userId}: level ${profile.level} → ${newLevel} (sessions=${profile.session_count}, ratio=${(profile.total_tool_calls > 0 ? profile.successful_tool_calls / profile.total_tool_calls : 0).toFixed(2)})`
      );
    }
    profile.level = newLevel;
    profile.last_active_at = new Date().toISOString();
    return newLevel;
  }

  recordSession(userId: string): void {
    const profile = this.getProfile(userId);
    profile.session_count++;
    this.updateLevel(userId);
  }

  recordToolCall(userId: string, success: boolean): void {
    const profile = this.getProfile(userId);
    profile.total_tool_calls++;
    if (success) profile.successful_tool_calls++;
    // Re-evaluate level every 25 tool calls.
    if (profile.total_tool_calls % 25 === 0) {
      this.updateLevel(userId);
    }
  }

  pinLevel(userId: string, maxLevel: PermissionLevel): void {
    const profile = this.getProfile(userId);
    profile.pinned_max_level = maxLevel;
    profile.manual_override = true;
    this.updateLevel(userId);
  }

  unpinLevel(userId: string): void {
    const profile = this.getProfile(userId);
    profile.pinned_max_level = undefined;
    profile.manual_override = false;
    this.updateLevel(userId);
  }

  setManualOverride(userId: string, level: PermissionLevel): void {
    const profile = this.getProfile(userId);
    profile.manual_override = true;
    profile.pinned_max_level = level;
    profile.level = level;
  }
}
