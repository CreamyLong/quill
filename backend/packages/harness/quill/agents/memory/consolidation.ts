/**
 * Memory consolidation — background "dreaming" that promotes short-term
 * signals to durable long-term memory.
 *
 * Port of OpenClaw's three-phase dreaming system (Light → REM → Deep).
 * Inspired by sleep-time compute research (arXiv:2504.13171) and Generative
 * Agents research.
 *
 * Three phases:
 *   1. Light:  Surface recent facts that appear frequently (high access count).
 *   2. REM:    Cluster related facts, identify contradictions and redundancies.
 *   3. Deep:   Promote strong composite-score signals to durable long-term
 *               memory; demote or archive weak ones.
 *
 * Uses weighted scoring (relevance, frequency, query diversity, recency,
 * consolidation, conceptual richness) with threshold gates. Produces a
 * DREAMS.md diary for human review.
 */

/** A fact eligible for consolidation. */
export interface ConsolidatableFact {
  id: string;
  content: string;
  category: string;
  confidence: number;
  createdAt: string;
  source?: string;
  /** Number of times this fact has been accessed/retrieved. */
  accessCount?: number;
  /** Timestamp of last access (ISO). */
  lastAccessedAt?: string;
}

/** Configuration for the consolidation engine. */
export interface ConsolidationConfig {
  /** Master switch. Default: false. */
  enabled: boolean;
  /**
   * Composite score threshold for promotion (Deep phase).
   * Facts at or above this threshold get promoted. Default: 0.7.
   */
  promotionThreshold: number;
  /**
   * Composite score threshold for archival (Deep phase).
   * Facts below this threshold get archived/evicted. Default: 0.2.
   */
  archivalThreshold: number;
  /**
   * Minimum fact age (milliseconds) before a fact is eligible for
   * consolidation. Prevents brand-new facts from being immediately
   * promoted or archived. Default: 24 hours.
   */
  minAgeMs: number;
  /** Scoring weights (must sum to ~1.0). */
  weights: ConsolidationWeights;
}

/** Weights for the composite score. */
export interface ConsolidationWeights {
  /** Relevance to current user context. */
  relevance: number;
  /** How frequently the fact is accessed. */
  frequency: number;
  /** Diversity of queries that surface this fact. */
  queryDiversity: number;
  /** Recency of creation and last access. */
  recency: number;
  /** Whether the fact has been previously consolidated. */
  consolidation: number;
  /** Conceptual richness (length, specificity). */
  conceptualRichness: number;
}

export const DEFAULT_WEIGHTS: ConsolidationWeights = {
  relevance: 0.25,
  frequency: 0.2,
  queryDiversity: 0.15,
  recency: 0.15,
  consolidation: 0.1,
  conceptualRichness: 0.15,
};

export function defaultConsolidationConfig(): ConsolidationConfig {
  return {
    enabled: false,
    promotionThreshold: 0.7,
    archivalThreshold: 0.2,
    minAgeMs: 24 * 60 * 60 * 1000, // 24 hours
    weights: { ...DEFAULT_WEIGHTS },
  };
}

/** Result of a consolidation run. */
export interface ConsolidationResult {
  /** Facts promoted to durable long-term memory. */
  promoted: ConsolidatableFact[];
  /** Facts archived/evicted. */
  archived: ConsolidatableFact[];
  /** Facts merged (duplicates/redundancies resolved). */
  merged: Array<{ into: string; merged: string[] }>;
  /** Composite scores for all evaluated facts. */
  scores: Array<{ factId: string; score: number }>;
  /** The three-phase report. */
  phases: {
    light: { surfacedCount: number };
    rem: { clustersFound: number; contradictionsFound: number };
    deep: { promotedCount: number; archivedCount: number };
  };
}

/** Diary entry written to DREAMS.md. */
export interface DreamEntry {
  timestamp: string;
  phase: "light" | "rem" | "deep";
  summary: string;
  factsAffected: number;
}

/**
 * Compute a composite consolidation score for a fact.
 *
 * Score = relevance * w.r + frequency * w.f + queryDiversity * w.q +
 *         recency * w.c + consolidation * w.o + conceptualRichness * w.x
 *
 * Each sub-score is normalized to [0, 1].
 */
export function computeCompositeScore(
  fact: ConsolidatableFact,
  config: ConsolidationConfig,
  now: Date = new Date(),
): number {
  const w = config.weights;

  // Relevance: use confidence as a proxy (0-1).
  const relevance = fact.confidence;

  // Frequency: log-scaled access count, capped at 1.0.
  const accessCount = fact.accessCount ?? 0;
  const frequency = Math.min(1.0, Math.log2(1 + accessCount) / 5);

  // Query diversity: placeholder (would require query tracking).
  // Falls back to source diversity as a heuristic.
  const queryDiversity = fact.source ? 0.5 : 0.1;

  // Recency: exponential decay with 30-day half-life.
  const createdAt = new Date(fact.createdAt).getTime();
  const ageDays = (now.getTime() - createdAt) / (24 * 60 * 60 * 1000);
  const recency = Math.exp(-0.0231 * ageDays); // 30-day half-life

  // Consolidation: previously consolidated facts get a small boost.
  // We use a simple heuristic: facts with higher access counts have been
  // implicitly consolidated.
  const consolidation = Math.min(1.0, accessCount / 10);

  // Conceptual richness: based on content length and specificity.
  // Longer, more specific facts score higher.
  const contentLength = fact.content.length;
  const conceptualRichness = Math.min(1.0, contentLength / 200);

  return (
    relevance * w.relevance +
    frequency * w.frequency +
    queryDiversity * w.queryDiversity +
    recency * w.recency +
    consolidation * w.consolidation +
    conceptualRichness * w.conceptualRichness
  );
}

/**
 * Run the three-phase consolidation over a set of facts.
 *
 * Phase 1 (Light): Filter to facts old enough for consolidation, surface
 * those with high access counts.
 *
 * Phase 2 (REM): Identify clusters of related facts (by category) and
 * detect potential contradictions (same content, different confidence).
 *
 * Phase 3 (Deep): Promote high-scoring facts, archive low-scoring ones,
 * merge duplicates.
 */
export function consolidate(
  facts: ConsolidatableFact[],
  config: ConsolidationConfig = defaultConsolidationConfig(),
  now: Date = new Date(),
): ConsolidationResult {
  const promoted: ConsolidatableFact[] = [];
  const archived: ConsolidatableFact[] = [];
  const merged: Array<{ into: string; merged: string[] }> = [];
  const scores: Array<{ factId: string; score: number }> = [];

  // --- Phase 1: Light — filter to eligible facts ---
  const eligible = facts.filter((f) => {
    const age = now.getTime() - new Date(f.createdAt).getTime();
    return age >= config.minAgeMs;
  });
  const lightSurfaced = eligible.filter((f) => (f.accessCount ?? 0) >= 2);

  // --- Phase 2: REM — cluster by category ---
  const byCategory = new Map<string, ConsolidatableFact[]>();
  for (const f of eligible) {
    const list = byCategory.get(f.category) ?? [];
    list.push(f);
    byCategory.set(f.category, list);
  }

  // Detect contradictions: same content (case-insensitive), different confidence.
  let contradictionsFound = 0;
  for (const group of byCategory.values()) {
    const byContent = new Map<string, ConsolidatableFact[]>();
    for (const f of group) {
      const key = f.content.trim().toLowerCase();
      const list = byContent.get(key) ?? [];
      list.push(f);
      byContent.set(key, list);
    }
    for (const duplicates of byContent.values()) {
      if (duplicates.length > 1) {
        contradictionsFound += duplicates.length - 1;
      }
    }
  }

  // --- Phase 3: Deep — promote / archive / merge ---
  const survivors: ConsolidatableFact[] = [];
  const seenContent = new Set<string>();

  // Sort by confidence descending so the highest-confidence duplicate wins.
  const sorted = [...eligible].sort((a, b) => b.confidence - a.confidence);

  for (const fact of sorted) {
    const score = computeCompositeScore(fact, config, now);
    scores.push({ factId: fact.id, score });

    // Deduplicate: keep the highest-confidence version.
    const contentKey = fact.content.trim().toLowerCase();
    if (seenContent.has(contentKey)) {
      const target = survivors.find(
        (s) => s.content.trim().toLowerCase() === contentKey,
      );
      if (target) {
        const existing = merged.find((m) => m.into === target.id);
        if (existing) {
          existing.merged.push(fact.id);
        } else {
          merged.push({ into: target.id, merged: [fact.id] });
        }
      }
      continue;
    }
    seenContent.add(contentKey);

    if (score >= config.promotionThreshold) {
      promoted.push(fact);
      survivors.push(fact);
    } else if (score < config.archivalThreshold) {
      archived.push(fact);
      // Not added to survivors — effectively evicted.
    } else {
      survivors.push(fact);
    }
  }

  return {
    promoted,
    archived,
    merged,
    scores,
    phases: {
      light: { surfacedCount: lightSurfaced.length },
      rem: { clustersFound: byCategory.size, contradictionsFound },
      deep: { promotedCount: promoted.length, archivedCount: archived.length },
    },
  };
}

/**
 * Generate a DREAMS.md diary entry from a consolidation result.
 */
export function formatDreamEntry(
  result: ConsolidationResult,
  now: Date = new Date(),
): DreamEntry {
  const parts: string[] = [];
  parts.push(
    `Dream cycle at ${now.toISOString()}: Light surfaced ${result.phases.light.surfacedCount} facts, ` +
      `REM found ${result.phases.rem.clustersFound} clusters and ${result.phases.rem.contradictionsFound} contradictions, ` +
      `Deep promoted ${result.phases.deep.promotedCount} and archived ${result.phases.deep.archivedCount}.`,
  );
  if (result.merged.length > 0) {
    parts.push(`Merged ${result.merged.length} duplicate groups.`);
  }
  return {
    timestamp: now.toISOString(),
    phase: "deep",
    summary: parts.join(" "),
    factsAffected:
      result.promoted.length + result.archived.length + result.merged.length,
  };
}
