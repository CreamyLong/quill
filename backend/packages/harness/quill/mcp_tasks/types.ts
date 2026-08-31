/**
 * Durable MCP Task Runtime — public contracts.
 *
 * Port of DeerFlow 2.0's `mcp_tasks` module. Long-running MCP work uses a
 * separate durable task runtime so the agent loop is never blocked on slow
 * remote operations. The database is the source of truth; ThreadState receives
 * a bounded projection.
 *
 * Lifecycle: claim → execute → poll → cancel/complete
 * Each task is lease-based: a worker claims a task, executes it, and releases
 * the lease on completion or failure. Dead workers' tasks are reclaimed.
 */

/** Status of a durable MCP task. */
export type McpTaskStatus =
  | "pending" // Waiting to be claimed
  | "claimed" // Claimed by a worker, executing
  | "running" // Actively executing
  | "completed" // Successfully finished
  | "failed" // Failed with error
  | "cancelled" // Cancelled by user or system
  | "timed_out"; // Exceeded max execution time

/** A durable MCP task record. */
export interface McpTask {
  /** Unique task ID. */
  id: string;
  /** MCP server name that owns this task. */
  serverName: string;
  /** MCP tool name to invoke. */
  toolName: string;
  /** Tool input arguments. */
  args: Record<string, unknown>;
  /** Current task status. */
  status: McpTaskStatus;
  /** Worker ID that claimed this task (when claimed/running). */
  workerId: string | null;
  /** Lease expiration timestamp (ms since epoch). */
  leaseExpiresAt: number | null;
  /** Task creation timestamp (ms since epoch). */
  createdAt: number;
  /** Last update timestamp (ms since epoch). */
  updatedAt: number;
  /** Task result (when completed). */
  result: unknown | null;
  /** Error message (when failed). */
  error: string | null;
  /** Number of execution attempts. */
  attemptCount: number;
  /** Maximum attempts before dead-letter. */
  maxAttempts: number;
  /** Parent thread ID (for scoping). */
  threadId: string | null;
  /** Parent run ID (for scoping). */
  runId: string | null;
  /** User ID that created this task. */
  userId: string | null;
  /** Arbitrary metadata. */
  metadata: Record<string, unknown>;
}

/** Options for creating a new durable MCP task. */
export interface CreateMcpTaskOptions {
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
  threadId?: string | null;
  runId?: string | null;
  userId?: string | null;
  maxAttempts?: number;
  metadata?: Record<string, unknown>;
}

/** Options for claiming a pending task. */
export interface ClaimMcpTaskOptions {
  workerId: string;
  /** Lease duration in ms (default: 30000 = 30s). */
  leaseDurationMs?: number;
}

/** Result of a claim operation. */
export interface ClaimResult {
  success: boolean;
  task: McpTask | null;
  /** Reason for failure when success=false. */
  reason?: string;
}

/** Bounded projection of task state for ThreadState. */
export interface McpTaskProjection {
  id: string;
  status: McpTaskStatus;
  serverName: string;
  toolName: string;
  createdAt: number;
  result: unknown | null;
  error: string | null;
}

/** Configuration for the durable task runtime. */
export interface McpTaskRuntimeConfig {
  /** Default lease duration in ms (default: 30000). */
  defaultLeaseMs: number;
  /** Max concurrent tasks per worker (default: 5). */
  maxConcurrentPerWorker: number;
  /** Max attempts before dead-letter (default: 3). */
  maxAttempts: number;
  /** Poll interval for lease reaper in ms (default: 10000). */
  leaseReaperIntervalMs: number;
  /** Max task execution time in ms (default: 600000 = 10min). */
  maxExecutionMs: number;
  /** Whether the runtime is enabled. */
  enabled: boolean;
}

/** Default configuration. */
export const DEFAULT_MCP_TASK_CONFIG: McpTaskRuntimeConfig = {
  defaultLeaseMs: 30000,
  maxConcurrentPerWorker: 5,
  maxAttempts: 3,
  leaseReaperIntervalMs: 10000,
  maxExecutionMs: 600000,
  enabled: true,
};
