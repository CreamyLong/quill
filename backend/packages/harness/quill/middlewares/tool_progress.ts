/**
 * Tool progress tracking — monitor tool execution progress and detect stagnation.
 *
 * Mirrors DeerFlow's `ToolProgressMiddleware` with a simpler state machine
 * that tracks per-tool execution outcomes and detects when a tool has stopped
 * producing useful results.
 *
 * ---
 *
 * Architecture:
 *
 *   tool_progress_middleware.ts lives in its own module (not under `agents/middlewares/`)
 *   because it tracks global agent progress, not per-step middleware state.
 *
 *   Integration: registered via lifecycle hooks at `pre_tool` and `post_tool` phases.
 *   The middleware maintains per-tool state (consecutive_problems, last_result_fingerprint)
 *   to detect stagnation and escalation patterns.
 */

// ---------------------------------------------------------------------------
// Progress states
// ---------------------------------------------------------------------------

/** Current state of a tool's execution progress. */
export enum ToolProgressState {
  /** Tool is executing normally. */
  ACTIVE = "active",
  /** Tool has shown problems but can still be retried with different params. */
  WARNED = "warned",
  /** Tool is blocked — no further executions until context changes. */
  BLOCKED = "blocked",
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ToolProgressConfig {
  /** Max consecutive tool calls with problems before warning. Default: 3. */
  stagnationThreshold?: number;
  /** Max consecutive warnings before blocking. Default: 2. */
  warnEscalationCount?: number;
  /** Whether a tool can be recovered by changing model parameters. */
  recoverableByModel?: boolean;
  /** Max total tool calls before hard block. Default: 20. */
  maxTotalCalls?: number;
  /** Enable/disable progress tracking. Default: true. */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Tool progress tracking state
// ---------------------------------------------------------------------------

/** Per-tool execution tracking state. */
export interface ToolProgressState {
  /** Current state of this tool. */
  state: ToolProgressState;
  /** Total number of calls. */
  totalCalls: number;
  /** Consecutive calls with problems. */
  consecutiveProblems: number;
  /** Consecutive warnings. */
  consecutiveWarnings: number;
  /** Fingerprint of the last result (for duplicate detection). */
  lastResultFingerprint?: string;
  /** Reason the tool is blocked (if BLOCKED). */
  blockReason?: string;
  /** List of consecutive problem reasons for debugging. */
  problemHistory?: ProblemRecord[];
}

/** Record of a tool call problem. */
export interface ProblemRecord {
  /** Call index (1-based). */
  call: number;
  /** Short description of the problem. */
  reason: string;
  /** Whether the problem is recoverable by changing model parameters. */
  recoverable: boolean;
}

// ---------------------------------------------------------------------------
// Progress tracker
// ---------------------------------------------------------------------------

/**
 * Track tool progress and detect stagnation.
 *
 * Usage:
 *   const tracker = new ToolProgressTracker();
 *   // Before each tool call:
 *   tracker.recordPreCall(toolName);
 *   // After tool returns:
 *   tracker.recordPostCall(toolName, result, hasError);
 *   // Check if tool should proceed:
 *   const allowed = tracker.isAllowed(toolName);
 */
export class ToolProgressTracker {
  private states: Map<string, ToolProgressState> = new Map();

  constructor(private config: ToolProgressConfig = {}) {}

  /** Get or create state for a tool. */
  private getOrCreateState(toolName: string): ToolProgressState {
    const key = toolName;
    if (!this.states.has(key)) {
      this.states.set(key, {
        state: ToolProgressState.ACTIVE,
        totalCalls: 0,
        consecutiveProblems: 0,
        consecutiveWarnings: 0,
        problemHistory: [],
      });
    }
    return this.states.get(key)!;
  }

  /** Record a pre-call. */
  recordPreCall(toolName: string): void {
    const state = this.getOrCreateState(toolName);
    state.totalCalls++;

    if (this.config.maxTotalCalls && state.totalCalls >= this.config.maxTotalCalls) {
      state.state = ToolProgressState.BLOCKED;
      state.blockReason = `max_total_calls (${this.config.maxTotalCalls}) exceeded`;
    }
  }

  /** Record a post-call result. */
  recordPostCall(
    toolName: string,
    result: unknown,
    hasError: boolean,
    errorMessage?: string,
    resultFingerprint?: string,
  ): void {
    const state = this.getOrCreateState(toolName);
    state.lastResultFingerprint = resultFingerprint;

    if (!hasError) {
      // No error — reset stagnation counters
      state.consecutiveProblems = 0;
      if (state.state === ToolProgressState.WARNED) {
        state.state = ToolProgressState.ACTIVE;
        state.consecutiveWarnings = 0;
      }
      return;
    }

    // Has error — increment problem counter
    state.consecutiveProblems++;

    if (!state.problemHistory) {
      state.problemHistory = [];
    }
    state.problemHistory.push({
      call: state.totalCalls,
      reason: errorMessage ?? "Unknown error",
      recoverable: this.config.recoverableByModel ?? false,
    });

    // Check stagnation threshold
    const threshold = this.config.stagnationThreshold ?? 3;
    if (state.consecutiveProblems >= threshold && state.state === ToolProgressState.ACTIVE) {
      state.state = ToolProgressState.WARNED;
      state.consecutiveWarnings = 1;
    } else if (state.state === ToolProgressState.WARNED) {
      state.consecutiveWarnings++;
      const escalation = this.config.warnEscalationCount ?? 2;
      if (state.consecutiveWarnings >= escalation) {
        state.state = ToolProgressState.BLOCKED;
        state.blockReason = `Tool '${toolName}' blocked after ${state.consecutiveWarnings} consecutive warnings`;
      }
    }
  }

  /** Check if a tool is allowed to execute. */
  isAllowed(toolName: string): boolean {
    const state = this.getOrCreateState(toolName);
    return state.state !== ToolProgressState.BLOCKED;
  }

  /** Get the current state for a tool. */
  getState(toolName: string): ToolProgressState | null {
    const state = this.states.get(toolName);
    return state ?? null;
  }

  /** Get all tracked states. */
  getAllStates(): Map<string, ToolProgressState> {
    return new Map(this.states);
  }

  /** Reset state for a tool (e.g. when context changes). */
  reset(toolName: string): void {
    this.states.set(toolName, {
      state: ToolProgressState.ACTIVE,
      totalCalls: 0,
      consecutiveProblems: 0,
      consecutiveWarnings: 0,
      problemHistory: [],
    });
  }
}

// ---------------------------------------------------------------------------
// Fingerprint helper
// ---------------------------------------------------------------------------

/**
 * Generate a simple fingerprint for a tool result.
 *
 * Used to detect duplicate results (same tool returning the same content).
 */
export function resultFingerprint(content: unknown): string {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  // Simple hash: length + first 50 chars + last 50 chars
  const truncated = text.slice(0, 50) + (text.length > 100 ? "..." + text.slice(-50) : "");
  return `${truncated.length}:${truncated}`;
}

// ---------------------------------------------------------------------------
// Integration with lifecycle hooks
// ---------------------------------------------------------------------------

import type { LifecycleHook } from "./lifecycle_hooks.js";

/**
 * Create a tool progress lifecycle hook.
 *
 * Adds pre_tool and post_tool hooks to the agent's lifecycle hook chain.
 */
export function createToolProgressHook(
  tracker: ToolProgressTracker,
  opts?: {
    preTool?: (toolName: string, state: ToolProgressState) => void;
    postTool?: (toolName: string, hasError: boolean, error?: string) => void;
  },
): { preTool: LifecycleHook; postTool: LifecycleHook } {
  const preTool: LifecycleHook = async (request) => {
    if ("name" in request) {
      const toolName = request.name as string;
      opts?.preTool?.(toolName, tracker.getState(toolName) ?? null);
      tracker.recordPreCall(toolName);
    }
  };

  const postTool: LifecycleHook = async (request, state) => {
    if ("name" in request) {
      const toolName = request.name as string;
      const content = typeof state === "object" && state !== null
        ? (state as Record<string, unknown>).content
        : undefined;
      const hasError = content === undefined ||
        (typeof content === "string" && content.includes("Error:"));
      opts?.postTool?.(toolName, hasError, hasError ? String(content) : undefined);
      const fingerprint = content ? resultFingerprint(content) : undefined;
      tracker.recordPostCall(toolName, content ?? "", hasError, undefined, fingerprint);
    }
  };

  return { preTool, postTool };
}

export { ToolProgressState };
