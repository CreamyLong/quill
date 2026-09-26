/**
 * Skill Attribution — "this answer used skill X".
 *
 * Ported from OpenWork's Library skill attribution: when a skill shapes an
 * answer, the chat UI names it. The tracker watches skill activations during
 * a run, counts tool uses made under each skill, and infers contribution
 * from the final response text (skill name or salient description terms
 * appearing in the answer). The result is a compact attribution record the
 * frontend renders as a chip under the assistant message.
 *
 * @module skills/attribution
 */

import type { SkillEntry } from "../agents/thread_state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillAttribution {
  /** Skill name (directory / manifest name). */
  skill: string;
  /** Skill path or source identifier, when known. */
  path?: string;
  /** Short description, when known. */
  description?: string;
  /** First activation timestamp (ISO). */
  activatedAt: string;
  /** Number of activations (re-reads refresh recency). */
  activations: number;
  /** Tool calls executed while this skill was active. */
  toolUses: number;
  /** Whether the skill contributed to the final answer. */
  contributed: boolean;
  /** Why we think it contributed (evidence string). */
  evidence?: string;
}

export interface AttributionSummary {
  /** Skills that contributed to the answer, most-involved first. */
  skills: SkillAttribution[];
  /** One-line rendering for the UI ("Skills used: a, b"). */
  line?: string;
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

/**
 * SkillAttributionTracker — per-run attribution state. The skill activation
 * middleware feeds activations; tool wrappers feed tool uses; the run
 * finalizer calls `recordAnswer` to lock in contributions and get the
 * summary line.
 */
export class SkillAttributionTracker {
  private records = new Map<string, SkillAttribution>();
  /** Skill currently active (most recent activation) for tool attribution. */
  private activeSkill?: string;

  /** Record a skill activation (idempotent per skill; counts re-reads). */
  trackActivation(skill: Pick<SkillEntry, "name"> & Partial<SkillEntry>): SkillAttribution {
    const existing = this.records.get(skill.name);
    const now = new Date().toISOString();
    if (existing) {
      existing.activations += 1;
      if (skill.description) existing.description = skill.description;
    } else {
      this.records.set(skill.name, {
        skill: skill.name,
        path: skill.path,
        description: skill.description,
        activatedAt: now,
        activations: 1,
        toolUses: 0,
        contributed: false,
      });
    }
    this.activeSkill = skill.name;
    return this.records.get(skill.name)!;
  }

  /** Attribute a tool call to the currently active skill (if any). */
  trackToolUse(): void {
    if (!this.activeSkill) return;
    const record = this.records.get(this.activeSkill);
    if (record) record.toolUses += 1;
  }

  /** Explicitly mark a skill as having contributed (e.g. skill tool output cited). */
  markContributed(skill: string, evidence: string): void {
    const record = this.records.get(skill);
    if (record) {
      record.contributed = true;
      record.evidence = evidence;
    }
  }

  /**
   * Finalize attributions against the assistant's answer text. A skill is
   * inferred to have contributed when its name (or a salient description
   * term) appears in the answer, or when tools ran under it.
   */
  recordAnswer(answerText: string): AttributionSummary {
    const haystack = answerText.toLowerCase();
    for (const record of this.records.values()) {
      if (record.contributed) continue;
      if (record.toolUses > 0) {
        record.contributed = true;
        record.evidence = `${record.toolUses} tool call(s) ran under this skill`;
        continue;
      }
      const nameHit = haystack.includes(record.skill.toLowerCase().replace(/[-_]/g, " "));
      const termHit =
        salientTerms(record.description ?? "").some((term) => haystack.includes(term));
      if (nameHit) {
        record.contributed = true;
        record.evidence = "skill named in the answer";
      } else if (termHit) {
        record.contributed = true;
        record.evidence = "answer references the skill's subject";
      }
    }
    return this.summary();
  }

  /** Current attribution summary (does not mutate). */
  summary(): AttributionSummary {
    const skills = [...this.records.values()]
      .filter((r) => r.contributed)
      .sort((a, b) => b.toolUses - a.toolUses || a.activatedAt.localeCompare(b.activatedAt));
    return {
      skills,
      line: skills.length
        ? `Skills used: ${skills.map((s) => s.skill).join(", ")}`
        : undefined,
    };
  }

  /** All records (diagnostics), whether contributed or not. */
  all(): SkillAttribution[] {
    return [...this.records.values()].sort((a, b) => b.activations - a.activations);
  }

  get size(): number {
    return this.records.size;
  }
}

/**
 * Extract salient terms from a skill description — words likely to appear in
 * an answer shaped by that skill.
 */
function salientTerms(description: string): string[] {
  const STOP = new Set([
    "a", "an", "the", "and", "or", "for", "with", "to", "of", "in", "on",
    "this", "that", "use", "using", "used", "when", "skill", "create",
    "provides", "helps", "generate", "from", "into", "by", "it", "is",
  ]);
  return description
    .toLowerCase()
    .split(/[^a-z0-9+#.-]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .slice(0, 8);
}

// ---------------------------------------------------------------------------
// State integration
// ---------------------------------------------------------------------------

/** Minimal shape the extractor needs from ThreadState. */
export interface SkillContextState {
  skill_context?: SkillEntry[] | null;
}

/**
 * Feed a thread's skill_context entries into a tracker (in load order) and
 * return the tracker. Used at run start to seed attributions from skills
 * loaded earlier in the conversation.
 */
export function seedFromState(
  tracker: SkillAttributionTracker,
  state: SkillContextState,
): SkillAttributionTracker {
  const entries = [...(state.skill_context ?? [])].sort((a, b) => a.loaded_at - b.loaded_at);
  for (const entry of entries) {
    tracker.trackActivation(entry);
  }
  return tracker;
}
