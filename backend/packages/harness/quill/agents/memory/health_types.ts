/**
 * Memory health — diagnostic types for memory system monitoring.
 *
 * Inspired by ZCode's memory diagnostics and awesome-harness-engineering's
 * self-correcting memory patterns.
 *
 * Memory health tracking provides:
 *   - Staleness detection (facts not refreshed within expected time)
 *   - Contradiction analysis (facts that conflict with each other)
 *   - Fact graph visualization data
 *   - Health scoring and trend tracking
 *   - Auto-repair recommendations
 *
 * Source patterns:
 * - ZCode: Memory diagnostics with health monitoring
 * - awesome-harness-engineering: Self-correcting memory with versioned evidence
 * - Hermes Agent: Memory nudges and cross-session recall
 */

// ---------------------------------------------------------------------------
// Fact model
// ---------------------------------------------------------------------------

/**
 * A single memory fact extracted from conversations.
 */
export interface MemoryFact {
  /** Unique fact identifier. */
  id: string;
  /** The fact content (natural language statement). */
  content: string;
  /** Fact category. */
  category: "preference" | "knowledge" | "context" | "behavior" | "goal" | "correction";
  /** Confidence level (0-1). */
  confidence: number;
  /** Source session/thread where this fact was extracted. */
  sourceThreadId?: string;
  /** Source message reference. */
  sourceMessageRef?: string;
  /** When this fact was created. */
  createdAt: string;
  /** When this fact was last reinforced/updated. */
  lastReinforcedAt: string;
  /** Number of times this fact has been reinforced. */
  reinforcementCount: number;
  /** Version counter for change tracking. */
  version: number;
  /** Whether this fact has been invalidated. */
  invalidated: boolean;
  /** Tags for grouping. */
  tags: string[];
  /** Related fact IDs. */
  relatedFactIds: string[];
}

// ---------------------------------------------------------------------------
// Health assessment
// ---------------------------------------------------------------------------

/**
 * Overall memory health score.
 */
export type MemoryHealthScore = "excellent" | "good" | "fair" | "poor" | "critical";

/**
 * A health issue detected in the memory system.
 */
export interface MemoryHealthIssue {
  /** Issue severity. */
  severity: "info" | "warning" | "error" | "critical";
  /** Issue type. */
  type: "stale_fact" | "contradiction" | "orphaned_fact" | "low_confidence" | "fact_bloat" | "missing_category";
  /** Human-readable description. */
  description: string;
  /** Affected fact IDs. */
  affectedFactIds: string[];
  /** Suggested repair action. */
  suggestedAction: string;
  /** Whether this issue can be auto-repaired. */
  autoRepairable: boolean;
}

/**
 * Complete memory health report.
 */
export interface MemoryHealthReport {
  /** Overall health score. */
  overallScore: MemoryHealthScore;
  /** Health score as numeric value (0-100). */
  scoreValue: number;
  /** Total number of facts. */
  totalFacts: number;
  /** Number of active (non-invalidated) facts. */
  activeFacts: number;
  /** Facts by category. */
  factsByCategory: Record<string, number>;
  /** Number of stale facts (not reinforced within threshold). */
  staleFactCount: number;
  /** Number of contradictions detected. */
  contradictionCount: number;
  /** Detected health issues. */
  issues: MemoryHealthIssue[];
  /** Facts grouped by health status. */
  factsByHealth: {
    healthy: MemoryFact[];
    stale: MemoryFact[];
    contradictory: MemoryFact[];
    lowConfidence: MemoryFact[];
  };
  /** Memory size estimate in tokens. */
  estimatedTokenSize: number;
  /** When this report was generated. */
  generatedAt: string;
  /** Trend compared to previous report (if available). */
  trend?: {
    previousScore: number;
    delta: number;
    direction: "improving" | "stable" | "declining";
  };
}

// ---------------------------------------------------------------------------
// Fact graph
// ---------------------------------------------------------------------------

/**
 * Node in the fact relationship graph.
 */
export interface FactGraphNode {
  factId: string;
  content: string;
  category: MemoryFact["category"];
  confidence: number;
  stale: boolean;
  /** Graph metrics. */
  metrics: {
    /** Number of connections. */
    degree: number;
    /** PageRank-like importance score. */
    centrality: number;
    /** Cluster assignment. */
    cluster: number;
  };
}

/**
 * Edge in the fact relationship graph.
 */
export interface FactGraphEdge {
  sourceFactId: string;
  targetFactId: string;
  /** Relationship type. */
  relationship: "supports" | "contradicts" | "related" | "derived_from";
  /** Relationship strength (0-1). */
  strength: number;
}

/**
 * Complete fact graph for visualization.
 */
export interface FactGraph {
  nodes: FactGraphNode[];
  edges: FactGraphEdge[];
  /** Graph-level metrics. */
  metrics: {
    totalNodes: number;
    totalEdges: number;
    clusters: number;
    density: number;
    averageConfidence: number;
  };
}

// ---------------------------------------------------------------------------
// Repair types
// ---------------------------------------------------------------------------

/**
 * Repair action types.
 */
export type RepairAction =
  | "refresh"       // Re-extract fact from recent conversation
  | "consolidate"   // Merge duplicate/similar facts
  | "invalidate"    // Mark fact as invalid
  | "boost_confidence" // Increase confidence after re-verification
  | "re_categorize" // Move fact to correct category
  | "unlink";       // Remove incorrect relationships

/**
 * A repair operation to be performed.
 */
export interface MemoryRepair {
  id: string;
  action: RepairAction;
  factIds: string[];
  reason: string;
  /** Expected outcome description. */
  expectedOutcome: string;
  /** Whether this repair was applied. */
  applied: boolean;
  /** Timestamp of repair. */
  appliedAt?: string;
  /** Repair result (success/failure). */
  result?: {
    success: boolean;
    message: string;
    newFactIds?: string[];
    removedFactIds?: string[];
  };
}

/**
 * Repair report — result of a repair operation.
 */
export interface RepairReport {
  repairs: MemoryRepair[];
  totalProposed: number;
  totalApplied: number;
  totalFailed: number;
  /** Facts modified. */
  factsModified: number;
  /** Health score improvement. */
  scoreImprovement: number;
  /** When the repair was performed. */
  performedAt: string;
}

// ---------------------------------------------------------------------------
// Diagnostics configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for memory diagnostics.
 */
export interface MemoryDiagnosticsConfig {
  /** Staleness threshold in days (default: 30). */
  staleThresholdDays: number;
  /** Minimum confidence threshold (default: 0.3). */
  minConfidenceThreshold: number;
  /** Maximum number of facts before triggering fact_bloat warning. */
  maxFactsWarning: number;
  /** Maximum number of facts before triggering fact_bloat error. */
  maxFactsError: number;
  /** Whether to detect contradictions automatically. */
  detectContradictions: boolean;
  /** Whether to auto-repair when possible. */
  autoRepair: boolean;
  /** Categories that should always be present. */
  requiredCategories: MemoryFact["category"][];
}

/**
 * Default diagnostics configuration.
 */
export const DEFAULT_DIAGNOSTICS_CONFIG: MemoryDiagnosticsConfig = {
  staleThresholdDays: 30,
  minConfidenceThreshold: 0.3,
  maxFactsWarning: 500,
  maxFactsError: 1000,
  detectContradictions: true,
  autoRepair: false,
  requiredCategories: ["preference", "knowledge"],
};
