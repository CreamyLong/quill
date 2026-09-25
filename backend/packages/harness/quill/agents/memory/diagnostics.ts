/**
 * Memory Diagnostics — health checks, staleness detection, contradiction analysis.
 *
 * Inspired by ZCode's memory diagnostics and awesome-harness-engineering's
 * self-correcting memory with versioned evidence.
 *
 * Provides comprehensive memory health assessment:
 *   - Staleness detection (facts not refreshed within threshold)
 *   - Contradiction analysis (conflicting facts)
 *   - Confidence scoring
 *   - Category coverage analysis
 *   - Health trending
 *
 * Source patterns:
 * - ZCode: Memory diagnostics with health monitoring
 * - awesome-harness-engineering: Self-correcting memory with staleness flags
 * - Hermes Agent: Memory nudges for knowledge persistence
 */

import type {
  FactGraph,
  FactGraphEdge,
  FactGraphNode,
  MemoryDiagnosticsConfig,
  MemoryFact,
  MemoryHealthIssue,
  MemoryHealthReport,
  MemoryHealthScore,
} from "./health_types.js";
import { DEFAULT_DIAGNOSTICS_CONFIG } from "./health_types.js";

// ---------------------------------------------------------------------------
// Diagnostics engine
// ---------------------------------------------------------------------------

/**
 * Memory diagnostics engine.
 */
export class MemoryDiagnostics {
  private config: MemoryDiagnosticsConfig;
  private previousScore: number | null = null;

  constructor(config?: Partial<MemoryDiagnosticsConfig>) {
    this.config = { ...DEFAULT_DIAGNOSTICS_CONFIG, ...config };
  }

  // ------------------------------------------------------------------
  // Health report
  // ------------------------------------------------------------------

  /**
   * Generate a comprehensive memory health report.
   */
  generateReport(facts: MemoryFact[]): MemoryHealthReport {
    const activeFacts = facts.filter((f) => !f.invalidated);
    const now = Date.now();

    // Categorize facts by health
    const healthy: MemoryFact[] = [];
    const stale: MemoryFact[] = [];
    const contradictory: MemoryFact[] = [];
    const lowConfidence: MemoryFact[] = [];

    const staleThresholdMs = this.config.staleThresholdDays * 24 * 60 * 60 * 1000;

    for (const fact of activeFacts) {
      const age = now - new Date(fact.lastReinforcedAt).getTime();
      const isStale = age > staleThresholdMs;
      const isLowConfidence = fact.confidence < this.config.minConfidenceThreshold;

      if (isStale) stale.push(fact);
      if (isLowConfidence) lowConfidence.push(fact);
      if (!isStale && !isLowConfidence) healthy.push(fact);
    }

    // Detect contradictions
    if (this.config.detectContradictions) {
      const contradictions = this.detectContradictions(activeFacts);
      for (const group of contradictions) {
        for (const fact of group) {
          if (!contradictory.find((f) => f.id === fact.id)) {
            contradictory.push(fact);
          }
        }
      }
    }

    // Count by category
    const factsByCategory: Record<string, number> = {};
    for (const fact of activeFacts) {
      factsByCategory[fact.category] = (factsByCategory[fact.category] ?? 0) + 1;
    }

    // Detect issues
    const issues = this.detectIssues(activeFacts, stale, contradictory, lowConfidence, factsByCategory);

    // Calculate score
    const scoreValue = this.calculateScore(activeFacts.length, stale.length, contradictory.length, lowConfidence.length);
    const overallScore = this.scoreToLabel(scoreValue);

    // Build report
    const report: MemoryHealthReport = {
      overallScore,
      scoreValue,
      totalFacts: facts.length,
      activeFacts: activeFacts.length,
      factsByCategory,
      staleFactCount: stale.length,
      contradictionCount: contradictory.length,
      issues,
      factsByHealth: { healthy, stale, contradictory, lowConfidence },
      estimatedTokenSize: this.estimateTokenSize(activeFacts),
      generatedAt: new Date().toISOString(),
    };

    // Add trend
    if (this.previousScore !== null) {
      const delta = scoreValue - this.previousScore;
      report.trend = {
        previousScore: this.previousScore,
        delta,
        direction: delta > 5 ? "improving" : delta < -5 ? "declining" : "stable",
      };
    }
    this.previousScore = scoreValue;

    return report;
  }

  // ------------------------------------------------------------------
  // Contradiction detection
  // ------------------------------------------------------------------

  /**
   * Detect contradictory facts.
   *
   * Simple heuristic: facts in the same category with similar content
   * but opposite sentiment are flagged as potential contradictions.
   * In production, this would use LLM-based analysis.
   */
  detectContradictions(facts: MemoryFact[]): MemoryFact[][] {
    const contradictions: MemoryFact[][] = [];
    const processed = new Set<string>();

    for (let i = 0; i < facts.length; i++) {
      if (processed.has(facts[i]!.id)) continue;

      const group: MemoryFact[] = [facts[i]!];
      processed.add(facts[i]!.id);

      for (let j = i + 1; j < facts.length; j++) {
        if (processed.has(facts[j]!.id)) continue;

        // Check if facts are potentially contradictory
        if (this.arePotentiallyContradictory(facts[i]!, facts[j]!)) {
          group.push(facts[j]!);
          processed.add(facts[j]!.id);
        }
      }

      if (group.length > 1) {
        contradictions.push(group);
      }
    }

    return contradictions;
  }

  /**
   * Check if two facts are potentially contradictory.
   *
   * Uses simple heuristics: same category, similar keywords,
   * but contains negation patterns.
   */
  private arePotentiallyContradictory(a: MemoryFact, b: MemoryFact): boolean {
    if (a.category !== b.category) return false;

    // Check for negation patterns
    const negationPatterns = [
      /\bnot\b/i, /\bno\b/i, /\bnever\b/i, /\bdoesn't\b/i, /\bisn't\b/i,
      /\bwon't\b/i, /\bcan't\b/i, /\bdislike\b/i, /\bhate\b/i,
    ];

    const aHasNegation = negationPatterns.some((p) => p.test(a.content));
    const bHasNegation = negationPatterns.some((p) => p.test(b.content));

    // One has negation, the other doesn't — potential contradiction
    if (aHasNegation !== bHasNegation) {
      // Check content similarity (simple word overlap)
      const aWords = new Set(a.content.toLowerCase().split(/\s+/));
      const bWords = new Set(b.content.toLowerCase().split(/\s+/));
      const overlap = [...aWords].filter((w) => bWords.has(w)).length;
      const similarity = overlap / Math.max(aWords.size, bWords.size);

      return similarity > 0.3;
    }

    return false;
  }

  // ------------------------------------------------------------------
  // Issue detection
  // ------------------------------------------------------------------

  /**
   * Detect health issues from analyzed facts.
   */
  private detectIssues(
    activeFacts: MemoryFact[],
    stale: MemoryFact[],
    contradictory: MemoryFact[],
    lowConfidence: MemoryFact[],
    factsByCategory: Record<string, number>,
  ): MemoryHealthIssue[] {
    const issues: MemoryHealthIssue[] = [];

    // Stale facts
    if (stale.length > 0) {
      const staleRatio = stale.length / activeFacts.length;
      issues.push({
        severity: staleRatio > 0.5 ? "error" : staleRatio > 0.2 ? "warning" : "info",
        type: "stale_fact",
        description: `${stale.length} facts (${(staleRatio * 100).toFixed(1)}%) have not been reinforced in ${this.config.staleThresholdDays}+ days`,
        affectedFactIds: stale.map((f) => f.id),
        suggestedAction: "Review stale facts and refresh or invalidate them",
        autoRepairable: true,
      });
    }

    // Contradictions
    if (contradictory.length > 0) {
      issues.push({
        severity: "error",
        type: "contradiction",
        description: `${contradictory.length} facts have potential contradictions`,
        affectedFactIds: contradictory.map((f) => f.id),
        suggestedAction: "Resolve contradictions by updating or invalidating conflicting facts",
        autoRepairable: false,
      });
    }

    // Low confidence
    if (lowConfidence.length > 0) {
      issues.push({
        severity: "warning",
        type: "low_confidence",
        description: `${lowConfidence.length} facts have confidence below ${this.config.minConfidenceThreshold}`,
        affectedFactIds: lowConfidence.map((f) => f.id),
        suggestedAction: "Reinforce or invalidate low-confidence facts",
        autoRepairable: true,
      });
    }

    // Fact bloat
    if (activeFacts.length > this.config.maxFactsError) {
      issues.push({
        severity: "error",
        type: "fact_bloat",
        description: `Memory contains ${activeFacts.length} facts (threshold: ${this.config.maxFactsError})`,
        affectedFactIds: [],
        suggestedAction: "Consolidate or invalidate old facts to reduce memory size",
        autoRepairable: true,
      });
    } else if (activeFacts.length > this.config.maxFactsWarning) {
      issues.push({
        severity: "warning",
        type: "fact_bloat",
        description: `Memory contains ${activeFacts.length} facts (approaching limit: ${this.config.maxFactsError})`,
        affectedFactIds: [],
        suggestedAction: "Consider consolidating similar facts",
        autoRepairable: true,
      });
    }

    // Missing categories
    for (const category of this.config.requiredCategories) {
      if (!factsByCategory[category] || factsByCategory[category] === 0) {
        issues.push({
          severity: "info",
          type: "missing_category",
          description: `No facts in required category: "${category}"`,
          affectedFactIds: [],
          suggestedAction: `Extract ${category} facts from recent conversations`,
          autoRepairable: false,
        });
      }
    }

    return issues;
  }

  // ------------------------------------------------------------------
  // Scoring
  // ------------------------------------------------------------------

  /**
   * Calculate health score (0-100).
   */
  private calculateScore(
    total: number,
    stale: number,
    contradictory: number,
    lowConfidence: number,
  ): number {
    if (total === 0) return 100; // Empty memory is healthy

    let score = 100;

    // Deduct for stale facts (up to 30 points)
    const staleRatio = stale / total;
    score -= staleRatio * 30;

    // Deduct for contradictions (up to 30 points)
    const contradictionRatio = contradictory / total;
    score -= contradictionRatio * 30;

    // Deduct for low confidence (up to 20 points)
    const lowConfRatio = lowConfidence / total;
    score -= lowConfRatio * 20;

    // Deduct for fact bloat (up to 20 points)
    if (total > this.config.maxFactsWarning) {
      const bloatRatio = Math.min(
        (total - this.config.maxFactsWarning) / (this.config.maxFactsError - this.config.maxFactsWarning),
        1,
      );
      score -= bloatRatio * 20;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Convert numeric score to label.
   */
  private scoreToLabel(score: number): MemoryHealthScore {
    if (score >= 90) return "excellent";
    if (score >= 75) return "good";
    if (score >= 50) return "fair";
    if (score >= 25) return "poor";
    return "critical";
  }

  // ------------------------------------------------------------------
  // Token estimation
  // ------------------------------------------------------------------

  /**
   * Estimate memory size in tokens.
   */
  private estimateTokenSize(facts: MemoryFact[]): number {
    // Rough estimate: ~4 characters per token
    let totalChars = 0;
    for (const fact of facts) {
      totalChars += fact.content.length + fact.tags.join(" ").length;
    }
    return Math.ceil(totalChars / 4);
  }
}

// ---------------------------------------------------------------------------
// Fact graph builder
// ---------------------------------------------------------------------------

/**
 * Build a fact relationship graph for visualization.
 */
export function buildFactGraph(facts: MemoryFact[]): FactGraph {
  const activeFacts = facts.filter((f) => !f.invalidated);
  const nodes: FactGraphNode[] = [];
  const edges: FactGraphEdge[] = [];

  // Build nodes
  const staleThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const fact of activeFacts) {
    const isStale = new Date(fact.lastReinforcedAt).getTime() < staleThreshold;

    nodes.push({
      factId: fact.id,
      content: fact.content.slice(0, 100), // Truncate for display
      category: fact.category,
      confidence: fact.confidence,
      stale: isStale,
      metrics: {
        degree: 0,
        centrality: 0,
        cluster: 0,
      },
    });
  }

  // Build edges from relatedFactIds
  for (const fact of activeFacts) {
    for (const relatedId of fact.relatedFactIds) {
      if (activeFacts.find((f) => f.id === relatedId)) {
        edges.push({
          sourceFactId: fact.id,
          targetFactId: relatedId,
          relationship: "related",
          strength: 0.5,
        });
      }
    }
  }

  // Calculate degree for each node
  for (const node of nodes) {
    node.metrics.degree = edges.filter(
      (e) => e.sourceFactId === node.factId || e.targetFactId === node.factId,
    ).length;
  }

  // Simple centrality: degree / max degree
  const maxDegree = Math.max(...nodes.map((n) => n.metrics.degree), 1);
  for (const node of nodes) {
    node.metrics.centrality = node.metrics.degree / maxDegree;
  }

  // Simple clustering: group by category
  const categories = [...new Set(activeFacts.map((f) => f.category))];
  for (const node of nodes) {
    node.metrics.cluster = categories.indexOf(node.category);
  }

  const avgConfidence = nodes.length > 0
    ? nodes.reduce((sum, n) => sum + n.confidence, 0) / nodes.length
    : 0;

  return {
    nodes,
    edges,
    metrics: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      clusters: categories.length,
      density: nodes.length > 1 ? edges.length / (nodes.length * (nodes.length - 1) / 2) : 0,
      averageConfidence: avgConfidence,
    },
  };
}
