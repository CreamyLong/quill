/**
 * Memory Eviction Policies — confidence-based and hybrid-v1 strategies.
 *
 * Port of DeerFlow 2.0's `select_facts_for_capacity()` implementation.
 * Evaluated against the LongMemEv
 * dataset.
 *
 * Usage:
 *   import { selectFactsForCapacity, DEFAULT_EVICTION_CONFIG } from "./eviction/";
 *
 *   const result = selectFactsForCapacity(facts, DEFAULT_EVICTION_CONFIG);
 *   console.log(`Evicted ${result.evicted.length}, retained ${result.retained.length}`);
 */

import type {
  EvictionConfig,
  EvictionResult,
  EvictableFact,
  FactScore,
} from "./types.js";
import { DEFAULT_EVICTION_CONFIG } from "./types.js";

/**
 * Confidence-based eviction: evicts lowest-confidence facts first.
 *
 * Facts at or above the protected confidence threshold are never evicted.
 * Among remaining facts, the lowest-confidence ones are evicted first.
 */
export function confidenceBasedEviction(
  facts: EvictableFact[],
  config: EvictionConfig = DEFAULT_EVICTION_CONFIG,
): EvictionResult {
  if (!config.enabled || facts.length <= config.maxFacts) {
    return {
      retained: [...facts],
      evicted: [],
      totalBefore: facts.length,
      totalAfter: facts.length,
    };
  }

  // Separate protected facts (high confidence).
  const protected_facts = facts.filter(
    (f) => f.confidence >= config.protectedConfidenceThreshold,
  );
  const evictable = facts.filter(
    (f) => f.confidence < config.protectedConfidenceThreshold,
  );

  // If protected facts already exceed capacity, we still keep them all
  // (they're high-confidence) and evict from the rest.
  const slotsRemaining = Math.max(0, config.maxFacts - protected_facts.length);

  // Sort evictable by confidence ascending (lowest first = evict first).
  const sorted = [...evictable].sort((a, b) => a.confidence - b.confidence);

  const retained = [...protected_facts, ...sorted.slice(0, slotsRemaining)];
  const evicted = sorted.slice(slotsRemaining);

  return {
    retained,
    evicted,
    totalBefore: facts.length,
    totalAfter: retained.length,
  };
}

/**
 * Hybrid-v1 eviction: combines confidence, recency, and category weights.
 *
 * Score = (confidence * 0.5) + (recency_score * 0.3) + (category_weight * 0.2)
 *
 * Facts with lower composite scores are evicted first. Protected facts
 * (above confidence threshold) are never evicted.
 */
export function hybridV1Eviction(
  facts: EvictableFact[],
  config: EvictionConfig = DEFAULT_EVICTION_CONFIG,
): EvictionResult {
  if (!config.enabled || facts.length <= config.maxFacts) {
    return {
      retained: [...facts],
      evicted: [],
      totalBefore: facts.length,
      totalAfter: facts.length,
    };
  }

  const now = Date.now();

  // Score each fact.
  const scored: FactScore[] = facts.map((fact) => {
    // Confidence component (0-1, already normalized).
    const confidence = fact.confidence;

    // Recency component: exponential decay based on age.
    const ageMs = now - fact.lastAccessedAt;
    const recency = Math.exp(-0.693 * (ageMs / config.recencyHalfLifeMs)); // ln(2) ≈ 0.693

    // Category component: normalized weight.
    const categoryWeight = config.categoryWeights[fact.category] ?? 0.5;
    const category = categoryWeight;

    // Composite score.
    const score = confidence * 0.5 + recency * 0.3 + category * 0.2;

    return {
      fact,
      score,
      components: { confidence, recency, category },
    };
  });

  // Separate protected facts.
  const protected_scores = scored.filter(
    (s) => s.fact.confidence >= config.protectedConfidenceThreshold,
  );
  const evictable_scores = scored.filter(
    (s) => s.fact.confidence < config.protectedConfidenceThreshold,
  );

  // Sort evictable by score ascending (lowest first = evict first).
  evictable_scores.sort((a, b) => a.score - b.score);

  const slotsRemaining = Math.max(0, config.maxFacts - protected_scores.length);

  const retained = [
    ...protected_scores.map((s) => s.fact),
    ...evictable_scores.slice(0, slotsRemaining).map((s) => s.fact),
  ];
  const evicted = evictable_scores.slice(slotsRemaining).map((s) => s.fact);

  return {
    retained,
    evicted,
    totalBefore: facts.length,
    totalAfter: retained.length,
  };
}

/**
 * Select facts for capacity using the configured eviction strategy.
 *
 * This is the primary entry point (mirrors DeerFlow 2.0's
 * `select_facts_for_capacity()`).
 *
 * @param facts - The full list of facts to filter.
 * @param config - Eviction configuration.
 * @param strategy - Eviction strategy: "confidence" or "hybrid-v1".
 * @returns Eviction result with retained and evicted facts.
 */
export function selectFactsForCapacity(
  facts: EvictableFact[],
  config: EvictionConfig = DEFAULT_EVICTION_CONFIG,
  strategy: "confidence" | "hybrid-v1" = "hybrid-v1",
): EvictionResult {
  switch (strategy) {
    case "confidence":
      return confidenceBasedEviction(facts, config);
    case "hybrid-v1":
      return hybridV1Eviction(facts, config);
    default:
      throw new Error(`Unknown eviction strategy: ${strategy}`);
  }
}

/**
 * Check if eviction would be triggered (without actually evicting).
 */
export function wouldEvict(
  facts: EvictableFact[],
  config: EvictionConfig = DEFAULT_EVICTION_CONFIG,
): boolean {
  if (!config.enabled) return false;
  if (facts.length <= config.maxFacts) return false;

  // Check if there are any evictable facts (below protected threshold).
  const evictable = facts.filter(
    (f) => f.confidence < config.protectedConfidenceThreshold,
  );
  return evictable.length > 0;
}

/**
 * Get eviction statistics without modifying facts.
 */
export function getEvictionStats(
  facts: EvictableFact[],
  config: EvictionConfig = DEFAULT_EVICTION_CONFIG,
): {
  totalFacts: number;
  protectedFacts: number;
  evictableFacts: number;
  wouldEvict: boolean;
  projectedAfterEviction: number;
} {
  const protectedFacts = facts.filter(
    (f) => f.confidence >= config.protectedConfidenceThreshold,
  ).length;
  const evictableFacts = facts.length - protectedFacts;
  const _wouldEvict = wouldEvict(facts, config);

  // Project how many would remain after eviction.
  const slotsRemaining = Math.max(0, config.maxFacts - protectedFacts);
  const projectedAfterEviction = Math.min(
    facts.length,
    protectedFacts + slotsRemaining,
  );

  return {
    totalFacts: facts.length,
    protectedFacts,
    evictableFacts,
    wouldEvict: _wouldEvict,
    projectedAfterEviction,
  };
}
