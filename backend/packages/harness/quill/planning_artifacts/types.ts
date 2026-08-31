/**
 * Structured Planning Artifacts — public contracts.
 *
 * Port of OpenAI Codex's Plan.md/Implement.md/Documentation.md pattern.
 * Provides reusable harness artifacts for long-horizon tasks that exceed a
 * single context window.
 *
 * Planning artifacts are markdown documents that serve as durable,
 * version-controlled state for multi-step tasks:
 *   - Plan.md: High-level task decomposition and milestones
 *   - Implement.md: Detailed implementation steps and progress
 *   - Documentation.md: Generated documentation and decisions log
 */

/** Types of planning artifacts. */
export type PlanningArtifactType = "plan" | "implement" | "documentation";

/** A milestone in a Plan.md artifact. */
export interface Milestone {
  /** Unique milestone ID. */
  id: string;
  /** Milestone title. */
  title: string;
  /** Detailed description. */
  description: string;
  /** Current status. */
  status: "pending" | "in_progress" | "completed" | "blocked";
  /** Sub-tasks within this milestone. */
  tasks: PlanningTask[];
  /** Dependencies on other milestone IDs. */
  dependencies: string[];
  /** Estimated effort (optional). */
  estimatedEffort?: string;
  /** Completion timestamp (ms since epoch). */
  completedAt?: number;
}

/** A task within a milestone. */
export interface PlanningTask {
  /** Unique task ID. */
  id: string;
  /** Task title. */
  title: string;
  /** Task description. */
  description: string;
  /** Current status. */
  status: "pending" | "in_progress" | "completed" | "blocked" | "skipped";
  /** Assigned agent/tool (optional). */
  assignee?: string;
  /** Notes or implementation details. */
  notes?: string;
  /** Completion timestamp (ms since epoch). */
  completedAt?: number;
}

/** A planning artifact document. */
export interface PlanningArtifact {
  /** Artifact type. */
  type: PlanningArtifactType;
  /** Thread ID this artifact belongs to. */
  threadId: string;
  /** Run ID that created this artifact. */
  runId: string | null;
  /** Artifact title. */
  title: string;
  /** Full markdown content. */
  content: string;
  /** Structured milestones (for plan type). */
  milestones: Milestone[];
  /** Version number (incremented on each update). */
  version: number;
  /** Creation timestamp (ms since epoch). */
  createdAt: number;
  /** Last update timestamp (ms since epoch). */
  updatedAt: number;
  /** Whether this artifact is archived. */
  archived: boolean;
}

/** Options for creating a planning artifact. */
export interface CreateArtifactOptions {
  type: PlanningArtifactType;
  threadId: string;
  runId?: string | null;
  title: string;
  content?: string;
  milestones?: Milestone[];
}

/** Options for updating a planning artifact. */
export interface UpdateArtifactOptions {
  content?: string;
  milestones?: Milestone[];
  title?: string;
}

/** Configuration for planning artifacts. */
export interface PlanningConfig {
  /** Whether planning artifacts are enabled. */
  enabled: boolean;
  /** Base directory for artifact storage. */
  storageDir: string;
  /** Maximum number of artifacts per thread. */
  maxPerThread: number;
  /** Whether to auto-generate artifacts for long tasks. */
  autoGenerate: boolean;
  /** Minimum task complexity to trigger auto-generation. */
  autoGenerateThreshold: number;
}

/** Default planning configuration. */
export const DEFAULT_PLANNING_CONFIG: PlanningConfig = {
  enabled: true,
  storageDir: ".scitops/planning",
  maxPerThread: 10,
  autoGenerate: false,
  autoGenerateThreshold: 5,
};
