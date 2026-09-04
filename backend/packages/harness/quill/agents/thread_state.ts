import type { BaseMessage } from "@langchain/core/messages";

/**
 *
 * These types mirror the LangGraph AgentState schema and are consumed by
 * gateway routers (e.g. threads API) as well as the frontend via JSON
 * serialization. Keep them serializable — no class instances.
 */

export interface SandboxState {
  sandbox_id?: string | null;
}

export interface ThreadDataState {
  workspace_path?: string | null;
  uploads_path?: string | null;
  outputs_path?: string | null;
}

export interface ViewedImageData {
  base64: string;
  mime_type: string;
}

export interface PromotedTools {
  catalog_hash: string;
  names: string[];
}

/**
 * One `task` delegation extracted from AI tool calls and paired ToolMessage
 * results. Mirrors Python `DelegationEntry` TypedDict.
 */
export interface DelegationEntry {
  id: string;
  description: string;
  subagent_type: string;
  status: string;
  result_brief?: string;
  result_sha256?: string;
  result_ref?: string;
  created_at?: string;
}

/** One skill file loaded earlier in the conversation. Mirrors Python `SkillEntry`. */
export interface SkillEntry {
  name: string;
  path: string;
  description: string;
  loaded_at: number;
}

/** Terminal subagent statuses — once terminal, a status never regresses. */
export const TERMINAL_STATUSES = new Set<string>([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "polling_timed_out",
]);

const DELEGATION_LEDGER_MAX_ENTRIES = 50;

export type SandboxStateField = SandboxState | null | undefined;

/** Reducer for sandbox state - accepts idempotent writes only. */
export function mergeSandbox(
  existing: SandboxState | null | undefined,
  incoming: SandboxState | null | undefined
): SandboxState | null | undefined {
  if (incoming === null || incoming === undefined) {
    return existing;
  }
  if (existing === null || existing === undefined) {
    return incoming;
  }
  const existingId = existing.sandbox_id;
  const newId = incoming.sandbox_id;
  if (existingId === newId) {
    return existing;
  }
  throw new Error(`Conflicting sandbox state updates: ${String(existingId)} != ${String(newId)}`);
}

/** Reducer for artifacts list - merges and deduplicates artifacts. */
export function mergeArtifacts(
  existing: string[] | null | undefined,
  incoming: string[] | null | undefined
): string[] {
  if (existing === null || existing === undefined) {
    return incoming ?? [];
  }
  if (incoming === null || incoming === undefined) {
    return existing;
  }
  return Array.from(new Set([...existing, ...incoming]));
}

/** Reducer for viewed_images dict - merges image dictionaries. */
export function mergeViewedImages(
  existing: Record<string, ViewedImageData> | null | undefined,
  incoming: Record<string, ViewedImageData> | null | undefined
): Record<string, ViewedImageData> {
  if (existing === null || existing === undefined) {
    return incoming ?? {};
  }
  if (incoming === null || incoming === undefined) {
    return existing;
  }
  if (Object.keys(incoming).length === 0) {
    return {};
  }
  return { ...existing, ...incoming };
}

/** Reducer for todos list - keeps the last non-None value. */
export function mergeTodos(
  existing: unknown[] | null | undefined,
  incoming: unknown[] | null | undefined
): unknown[] | null | undefined {
  if (incoming === null || incoming === undefined) {
    return existing;
  }
  return incoming;
}

/** Reducer for deferred-tool promotions, scoped by catalog hash. */
export function mergePromoted(
  existing: PromotedTools | null | undefined,
  incoming: PromotedTools | null | undefined
): PromotedTools | null | undefined {
  if (!incoming) {
    return existing;
  }
  if (existing === null || existing === undefined || existing.catalog_hash !== incoming.catalog_hash) {
    return {
      catalog_hash: incoming.catalog_hash,
      names: Array.from(new Set(incoming.names)),
    };
  }
  return {
    catalog_hash: existing.catalog_hash,
    names: Array.from(new Set([...existing.names, ...incoming.names])),
  };
}

/**
 * Reducer for the delegation ledger. Appends new entries, replacing same-id
 * entries with the latest version while preserving first-seen order. A terminal
 * status is never overwritten by a non-terminal status. Caps at
 * DELEGATION_LEDGER_MAX_ENTRIES, keeping the most recent.
 */
export function mergeDelegations(
  existing: DelegationEntry[] | null | undefined,
  incoming: DelegationEntry[] | null | undefined
): DelegationEntry[] | null | undefined {
  if (!incoming || incoming.length === 0) return existing ?? [];
  const byId = new Map<string, DelegationEntry>();
  const order: string[] = [];
  for (const rawEntry of [...(existing ?? []), ...incoming]) {
    const entryId = rawEntry.id;
    const previous = byId.get(entryId);
    if (
      previous !== undefined &&
      TERMINAL_STATUSES.has(previous.status) &&
      !TERMINAL_STATUSES.has(rawEntry.status)
    ) {
      continue; // never regress a terminal status
    }
    if (!byId.has(entryId)) order.push(entryId);
    // Preserve first-seen created_at when updating an existing entry.
    const entry = previous?.created_at
      ? { ...rawEntry, created_at: previous.created_at }
      : rawEntry;
    byId.set(entryId, entry);
  }
  let merged = order.map((id) => byId.get(id)!);
  if (merged.length > DELEGATION_LEDGER_MAX_ENTRIES) {
    merged = merged.slice(merged.length - DELEGATION_LEDGER_MAX_ENTRIES);
  }
  return merged;
}

const SKILL_CONTEXT_MAX_ENTRIES = 8;
const SKILL_DESCRIPTION_MAX_CHARS = 500;

function normalizeSkillEntry(entry: Record<string, unknown>): SkillEntry {
  const description = entry.description;
  const loadedAt = entry.loaded_at;
  return {
    name: String(entry.name ?? ""),
    path: String(entry.path),
    description:
      typeof description === "string"
        ? description.split(/\s+/).join(" ").slice(0, SKILL_DESCRIPTION_MAX_CHARS)
        : "",
    loaded_at: typeof loadedAt === "number" ? loadedAt : 0,
  };
}

/**
 * Reducer for the skill-context channel. Dedups by path; later reads refresh
 * recency and replace the reference. Caps by keeping the most recently read.
 */
export function mergeSkillContext(
  existing: SkillEntry[] | null | undefined,
  incoming: SkillEntry[] | null | undefined
): SkillEntry[] | null | undefined {
  const normalizedExisting = (existing ?? []).map((e) =>
    normalizeSkillEntry(e as unknown as Record<string, unknown>)
  );
  if (!incoming || incoming.length === 0) return normalizedExisting;
  const byPath = new Map<string, SkillEntry>();
  const order: string[] = [];
  for (const entry of normalizedExisting) {
    if (!byPath.has(entry.path)) order.push(entry.path);
    byPath.set(entry.path, entry);
  }
  for (const entry of incoming.map((e) => normalizeSkillEntry(e as unknown as Record<string, unknown>))) {
    if (byPath.has(entry.path)) order.splice(order.indexOf(entry.path), 1);
    order.push(entry.path);
    byPath.set(entry.path, entry);
  }
  let merged = order.map((p) => byPath.get(p)!);
  if (merged.length > SKILL_CONTEXT_MAX_ENTRIES) {
    merged = merged.slice(merged.length - SKILL_CONTEXT_MAX_ENTRIES);
  }
  return merged;
}

/** Reducer for internal middleware counters and windows. */
export function mergeInternal(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!incoming) {
    return existing ?? {};
  }
  if (!existing) {
    return { ...incoming };
  }
  return { ...existing, ...incoming };
}

/**
 * Runtime state of a Quill thread.
 *
 * This is the JSON-serializable contract exposed by the threads API. LangGraph
 * runtime specifics are intentionally omitted at the type level.
 */
export interface ThreadState {
  messages?: BaseMessage[];
  sandbox?: SandboxStateField;
  thread_data?: ThreadDataState | null;
  title?: string | null;
  artifacts?: string[];
  todos?: unknown[] | null;
  uploaded_files?: Array<Record<string, unknown>> | null;
  viewed_images?: Record<string, ViewedImageData>;
  promoted?: PromotedTools | null;
  /** Delegation ledger — captured task delegations and their outcomes. */
  delegations?: DelegationEntry[] | null;
  /** Skill context — skill files loaded earlier in the conversation. */
  skill_context?: SkillEntry[] | null;
  /** Internal middleware scratchpad (loop windows, counters, budgets). */
  internal?: Record<string, unknown> | null;
  /** Forced re-engagement signal set by middleware (e.g. TodoMiddleware). */
  jump_to?: string | null;
  /** Active goal state for persistent multi-turn objective tracking. */
  goal?: GoalState | null;
  [key: string]: unknown;
}

/** Goal state for persistent multi-turn objective tracking (Goal Mode). */
export interface GoalState {
  /** The objective text. */
  objective: string;
  /** Current status of the goal. */
  status: "active" | "satisfied" | "abandoned" | "paused";
  /** Creation timestamp. */
  created_at: string;
  /** Last update timestamp. */
  updated_at: string;
  /** Number of automatic continuations performed. */
  continuation_count: number;
  /** Maximum number of automatic continuations allowed. */
  max_continuations: number;
  /** Number of consecutive evaluations with no progress. */
  no_progress_count: number;
  /** Maximum no-progress continuations before standing down. */
  max_no_progress_continuations: number;
  /** The most recent evaluation result. */
  last_evaluation?: {
    satisfied: boolean;
    blocker: "none" | "missing_evidence" | "needs_user_input" | "run_failed" | "external_wait" | "goal_not_met_yet";
    reason: string;
    evidence_summary?: string;
    run_id?: string;
    evaluated_at?: string;
    progress_key?: string;
    stand_down_reason?: string;
  };
}

/** Reducer for goal state — preserves terminal states (satisfied/abandoned). */
export function mergeGoal(
  existing: GoalState | null | undefined,
  incoming: GoalState | null | undefined,
): GoalState | null | undefined {
  if (incoming === null || incoming === undefined) {
    return existing;
  }
  if (existing === null || existing === undefined) {
    return incoming;
  }
  // Once satisfied or abandoned, don't regress
  if (existing.status === "satisfied" || existing.status === "abandoned") {
    return existing;
  }
  return incoming;
}
