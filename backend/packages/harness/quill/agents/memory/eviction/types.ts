/**
 * Memory Eviction Policies — public contracts.
 *
 * Port of DeerFlow 2.0's DeerMem eviction policies. Prevents unbounded memory
 * growth in long-running agents by evicting low-value facts when capacity is
 * exceeded.
 *
 * Two eviction strategies are provided:
 *   1. Confidence-based: evicts lowest-confidence facts first.
 *   2. Hybrid-v1: combines confidence, recency, and category weights.
 */

/** A memory fact with eviction metadata. */
export interface EvictableFact {
  /** Unique fact ID. */
  id: string;
  /** Fact content. */
  content: string;
  /** Fact category. */
  category: "preference" | "knowledge" | "context" | "behavior" | "goal";
  /** Confidence score (0-1). */
  confidence: number;
  /** Creation timestamp (ms since epoch). */
  createdAt: number;
  /** Last access timestamp (ms since epoch). */
  lastAccessedAt: number;
  /** Source of the fact (e.g., "conversation", "extraction"). */
  source?: string;
}

/** Configuration for memory eviction. */
export interface EvictionConfig {
  /** Maximum number of facts to retain. */
  maxFacts: number;
  /** Minimum confidence to never evict (0-1, default: 0.9). */
  protectedConfidenceThreshold: number;
  /** Category weights for hybrid eviction (higher = more likely to keep). */
  categoryWeights: Record<string, number>;
  /** Recency half-life in ms (default: 30 days). */
  recencyHalfLifeMs: number;
  /** Whether eviction is enabled. */
  enabled: boolean;
}

/** Default eviction configuration. */
export const DEFAULT_EVICTION_CONFIG: EvictionConfig = {
  maxFacts: 100,
  protectedConfidenceThreshold: 0.9,
  categoryWeights: {
    preference: 1.0,
    goal: 0.9,
    behavior: 0.8,
    knowledge: 0.7,
    context: 0.6,
  },
  recencyHalfLifeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  enabled: true,
};

/** Result of an eviction run. */
export interface EvictionResult {
  /** Facts that were retained. */
  retained: EvictableFact[];
  /** Facts that were evicted. */
  evicted: EvictableFact[];
  /** Total facts before eviction. */
  totalBefore: number;
  /** Total facts after eviction. */
  totalAfter: number;
}

/** Score assigned to a fact during hybrid eviction. */
export interface FactScore {
  fact: EvictableFact;
  /** Composite score (lower = more likely to evict). */
  score: number;
  /** Score components for debugging. */
  components: {
    confidence: number;
    recency: number;
    category: number;
  };
}
