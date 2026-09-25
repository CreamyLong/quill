/**
 * Memory Repair — auto-repair for stale/contradictory memories.
 *
 * Inspired by awesome-harness-engineering's self-correcting memory with
 * versioned code evidence and ZCode's memory-agent loop.
 *
 * Repair operations:
 *   - refresh: Re-extract fact from recent conversation
 *   - consolidate: Merge duplicate/similar facts
 *   - invalidate: Mark fact as invalid
 *   - boost_confidence: Increase confidence after re-verification
 *   - re_categorize: Move fact to correct category
 *   - unlink: Remove incorrect relationships
 *
 * Source patterns:
 * - awesome-harness-engineering: Self-correcting memory with versioned evidence
 * - ZCode: Memory-agent loop for autonomous memory management
 * - Hermes Agent: Memory nudges for knowledge persistence
 */

import type {
  MemoryDiagnosticsConfig,
  MemoryFact,
  MemoryHealthIssue,
  MemoryRepair,
  RepairAction,
  RepairReport,
} from "./health_types.js";
import { DEFAULT_DIAGNOSTICS_CONFIG } from "./health_types.js";

// ---------------------------------------------------------------------------
// Repair engine
// ---------------------------------------------------------------------------

/**
 * Memory repair engine.
 */
export class MemoryRepairEngine {
  private config: MemoryDiagnosticsConfig;

  constructor(config?: Partial<MemoryDiagnosticsConfig>) {
    this.config = { ...DEFAULT_DIAGNOSTICS_CONFIG, ...config };
  }

  // ------------------------------------------------------------------
  // Repair proposal
  // ------------------------------------------------------------------

  /**
   * Propose repairs for detected health issues.
   *
   * Returns a list of repair operations that can be reviewed
   * before applying.
   */
  proposeRepairs(facts: MemoryFact[], issues: MemoryHealthIssue[]): MemoryRepair[] {
    const repairs: MemoryRepair[] = [];

    for (const issue of issues) {
      if (!issue.autoRepairable) continue;

      switch (issue.type) {
        case "stale_fact":
          repairs.push(...this.proposeStaleRepairs(facts, issue));
          break;
        case "low_confidence":
          repairs.push(...this.proposeLowConfidenceRepairs(facts, issue));
          break;
        case "fact_bloat":
          repairs.push(...this.proposeBloatRepairs(facts, issue));
          break;
        default:
          // Not auto-repairable
          break;
      }
    }

    return repairs;
  }

  /**
   * Propose repairs for stale facts.
   */
  private proposeStaleRepairs(facts: MemoryFact[], issue: MemoryHealthIssue): MemoryRepair[] {
    const repairs: MemoryRepair[] = [];
    const staleFacts = facts.filter(
      (f) => issue.affectedFactIds.includes(f.id) && !f.invalidated,
    );

    // Group similar stale facts for consolidation
    const groups = this.groupSimilarFacts(staleFacts);
    for (const group of groups) {
      if (group.length > 1) {
        repairs.push({
          id: `repair-consolidate-${group[0]!.id}`,
          action: "consolidate",
          factIds: group.map((f) => f.id),
          reason: `Consolidate ${group.length} similar stale facts`,
          expectedOutcome: `Merge into single fact with highest confidence`,
          applied: false,
        });
      } else {
        // Single stale fact — propose invalidation
        repairs.push({
          id: `repair-invalidate-${group[0]!.id}`,
          action: "invalidate",
          factIds: [group[0]!.id],
          reason: `Stale fact not reinforced in ${this.config.staleThresholdDays}+ days`,
          expectedOutcome: `Mark fact as invalid`,
          applied: false,
        });
      }
    }

    return repairs;
  }

  /**
   * Propose repairs for low-confidence facts.
   */
  private proposeLowConfidenceRepairs(facts: MemoryFact[], issue: MemoryHealthIssue): MemoryRepair[] {
    const repairs: MemoryRepair[] = [];
    const lowConfFacts = facts.filter(
      (f) => issue.affectedFactIds.includes(f.id) && !f.invalidated,
    );

    for (const fact of lowConfFacts) {
      if (fact.confidence < 0.1) {
        // Very low confidence — invalidate
        repairs.push({
          id: `repair-invalidate-${fact.id}`,
          action: "invalidate",
          factIds: [fact.id],
          reason: `Very low confidence (${fact.confidence.toFixed(2)})`,
          expectedOutcome: `Mark fact as invalid`,
          applied: false,
        });
      } else {
        // Moderate confidence — could be boosted
        repairs.push({
          id: `repair-boost-${fact.id}`,
          action: "boost_confidence",
          factIds: [fact.id],
          reason: `Low confidence (${fact.confidence.toFixed(2)}) — attempt re-verification`,
          expectedOutcome: `Increase confidence after verification`,
          applied: false,
        });
      }
    }

    return repairs;
  }

  /**
   * Propose repairs for fact bloat.
   */
  private proposeBloatRepairs(facts: MemoryFact[], _issue: MemoryHealthIssue): MemoryRepair[] {
    const repairs: MemoryRepair[] = [];
    const activeFacts = facts.filter((f) => !f.invalidated);

    // Sort by confidence (ascending) and reinforcement count (ascending)
    // Target the least valuable facts for removal
    const sorted = [...activeFacts].sort((a, b) => {
      const scoreA = a.confidence * a.reinforcementCount;
      const scoreB = b.confidence * b.reinforcementCount;
      return scoreA - scoreB;
    });

    // Propose removing bottom 10% of facts
    const removeCount = Math.ceil(sorted.length * 0.1);
    const toRemove = sorted.slice(0, removeCount);

    if (toRemove.length > 0) {
      repairs.push({
        id: "repair-bloat-cleanup",
        action: "invalidate",
        factIds: toRemove.map((f) => f.id),
        reason: `Fact bloat: removing ${removeCount} lowest-value facts`,
        expectedOutcome: `Reduce memory size by ${removeCount} facts`,
        applied: false,
      });
    }

    return repairs;
  }

  // ------------------------------------------------------------------
  // Repair application
  // ------------------------------------------------------------------

  /**
   * Apply a list of repairs to the fact set.
   *
   * Returns the modified facts and a repair report.
   */
  applyRepairs(facts: MemoryFact[], repairs: MemoryRepair[]): {
    modifiedFacts: MemoryFact[];
    report: RepairReport;
  } {
    const modifiedFacts = facts.map((f) => ({ ...f }));
    const appliedRepairs: MemoryRepair[] = [];
    let failedCount = 0;
    let modifiedCount = 0;

    for (const repair of repairs) {
      try {
        const result = this.applyRepair(modifiedFacts, repair);
        repair.applied = true;
        repair.appliedAt = new Date().toISOString();
        repair.result = result;

        if (result.success) {
          appliedRepairs.push(repair);
          modifiedCount += repair.factIds.length;
        } else {
          failedCount++;
        }
      } catch (error) {
        repair.applied = true;
        repair.appliedAt = new Date().toISOString();
        repair.result = {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        };
        failedCount++;
      }
    }

    const report: RepairReport = {
      repairs: appliedRepairs,
      totalProposed: repairs.length,
      totalApplied: appliedRepairs.length,
      totalFailed: failedCount,
      factsModified: modifiedCount,
      scoreImprovement: 0, // Would need before/after comparison
      performedAt: new Date().toISOString(),
    };

    return { modifiedFacts, report };
  }

  /**
   * Apply a single repair operation.
   */
  private applyRepair(facts: MemoryFact[], repair: MemoryRepair): {
    success: boolean;
    message: string;
    newFactIds?: string[];
    removedFactIds?: string[];
  } {
    switch (repair.action) {
      case "invalidate":
        return this.applyInvalidate(facts, repair.factIds);

      case "consolidate":
        return this.applyConsolidate(facts, repair);

      case "boost_confidence":
        return this.applyBoostConfidence(facts, repair.factIds);

      case "re_categorize":
        return { success: false, message: "re_categorize not yet implemented" };

      case "refresh":
        return { success: false, message: "refresh requires LLM integration" };

      case "unlink":
        return this.applyUnlink(facts, repair.factIds);

      default:
        return { success: false, message: `Unknown repair action: ${repair.action}` };
    }
  }

  /**
   * Invalidate facts by ID.
   */
  private applyInvalidate(facts: MemoryFact[], factIds: string[]): {
    success: boolean;
    message: string;
    removedFactIds: string[];
  } {
    const removed: string[] = [];
    for (const fact of facts) {
      if (factIds.includes(fact.id) && !fact.invalidated) {
        fact.invalidated = true;
        fact.version += 1;
        removed.push(fact.id);
      }
    }

    return {
      success: true,
      message: `Invalidated ${removed.length} facts`,
      removedFactIds: removed,
    };
  }

  /**
   * Consolidate multiple facts into one.
   */
  private applyConsolidate(facts: MemoryFact[], repair: MemoryRepair): {
    success: boolean;
    message: string;
    newFactIds: string[];
    removedFactIds: string[];
  } {
    const toConsolidate = facts.filter((f) => repair.factIds.includes(f.id) && !f.invalidated);
    if (toConsolidate.length < 2) {
      return { success: false, message: "Need at least 2 facts to consolidate", newFactIds: [], removedFactIds: [] };
    }

    // Pick the fact with highest confidence as the base
    const base = toConsolidate.reduce((best, f) =>
      f.confidence > best.confidence ? f : best,
    );

    // Merge reinforcement counts
    const totalReinforcements = toConsolidate.reduce((sum, f) => sum + f.reinforcementCount, 0);
    const allTags = [...new Set(toConsolidate.flatMap((f) => f.tags))];
    const allRelated = [...new Set(toConsolidate.flatMap((f) => f.relatedFactIds))];

    base.reinforcementCount = totalReinforcements;
    base.tags = allTags;
    base.relatedFactIds = allRelated.filter((id) => !repair.factIds.includes(id));
    base.version += 1;
    base.lastReinforcedAt = new Date().toISOString();

    // Invalidate others
    const removed: string[] = [];
    for (const fact of toConsolidate) {
      if (fact.id !== base.id) {
        fact.invalidated = true;
        fact.version += 1;
        removed.push(fact.id);
      }
    }

    return {
      success: true,
      message: `Consolidated ${toConsolidate.length} facts into "${base.content.slice(0, 50)}..."`,
      newFactIds: [base.id],
      removedFactIds: removed,
    };
  }

  /**
   * Boost confidence of facts.
   */
  private applyBoostConfidence(facts: MemoryFact[], factIds: string[]): {
    success: boolean;
    message: string;
  } {
    let boosted = 0;
    for (const fact of facts) {
      if (factIds.includes(fact.id) && !fact.invalidated) {
        fact.confidence = Math.min(1.0, fact.confidence + 0.2);
        fact.version += 1;
        boosted++;
      }
    }

    return {
      success: true,
      message: `Boosted confidence for ${boosted} facts`,
    };
  }

  /**
   * Unlink relationships between facts.
   */
  private applyUnlink(facts: MemoryFact[], factIds: string[]): {
    success: boolean;
    message: string;
  } {
    let unlinked = 0;
    for (const fact of facts) {
      if (factIds.includes(fact.id) && !fact.invalidated) {
        const before = fact.relatedFactIds.length;
        fact.relatedFactIds = fact.relatedFactIds.filter((id) => !factIds.includes(id) || id === fact.id);
        unlinked += before - fact.relatedFactIds.length;
      }
    }

    return {
      success: true,
      message: `Removed ${unlinked} relationships`,
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Group similar facts using simple word overlap.
   */
  private groupSimilarFacts(facts: MemoryFact[]): MemoryFact[][] {
    const groups: MemoryFact[][] = [];
    const processed = new Set<string>();

    for (const fact of facts) {
      if (processed.has(fact.id)) continue;

      const group: MemoryFact[] = [fact];
      processed.add(fact.id);

      const factWords = new Set(fact.content.toLowerCase().split(/\s+/));

      for (const other of facts) {
        if (processed.has(other.id)) continue;
        if (other.category !== fact.category) continue;

        const otherWords = new Set(other.content.toLowerCase().split(/\s+/));
        const overlap = [...factWords].filter((w) => otherWords.has(w)).length;
        const similarity = overlap / Math.max(factWords.size, otherWords.size);

        if (similarity > 0.3) {
          group.push(other);
          processed.add(other.id);
        }
      }

      groups.push(group);
    }

    return groups;
  }
}
