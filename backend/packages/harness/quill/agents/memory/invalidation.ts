/**
 * Memory Invalidation System.
 *
 * Inspired by the awesome-harness-engineering research showing that "stale memories
 * are more dangerous than no memory" and "memory invalidation is as important as
 * storage." Also draws from the three-tier memory architecture (Letta/MemGPT).
 *
 * Key principles:
 *   1. Freshness > quantity: Stale memories degrade agent performance.
 *   2. Every stored fact carries metadata (timestamp, source, confidence).
 *   3. Facts are checked for staleness before injection into context.
 *   4. Contradictory facts trigger automatic invalidation of the older one.
 *   5. A background consolidation pass archives or removes low-value facts.
 *
 * Three-tier memory model:
 *   - Core: In-context, always present (system prompt, active goals).
 *   - Recall: Conversation history (summarized when compacted).
 *   - Archival: Long-term stored facts, searchable, subject to invalidation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryFact {
  id: string;
  content: string;
  category: "preference" | "goal" | "behavior" | "knowledge" | "context";
  confidence: number; // 0-1
  created_at: string;
  updated_at: string;
  /** Last time this fact was accessed/used. */
  last_accessed_at: string;
  /** Source of the fact: "conversation", "user_stated", "inferred", "consolidated". */
  source: string;
  /** Whether this fact is still valid (false = archived/soft-deleted). */
  valid: boolean;
  /** Tags for grouping and search. */
  tags: string[];
  /** Access count (for LRU eviction). */
  access_count: number;
  /** Half-life in days for recency decay (default: 30). */
  halfLifeDays?: number;
}

export interface InvalidationConfig {
  /** Max age in days before a fact is considered stale (default: 90). */
  maxAgeDays: number;
  /** Minimum confidence to keep a fact (default: 0.3). */
  minConfidence: number;
  /** Enable contradiction detection (default: true). */
  detectContradictions: boolean;
  /** Number of facts to consolidate per cycle (default: 50). */
  consolidationBatchSize: number;
  /** Protected facts above this confidence are never auto-invalidated (default: 0.9). */
  protectedConfidenceThreshold: number;
}

export const DEFAULT_INVALIDATION_CONFIG: InvalidationConfig = {
  maxAgeDays: 90,
  minConfidence: 0.3,
  detectContradictions: true,
  consolidationBatchSize: 50,
  protectedConfidenceThreshold: 0.9,
};

export interface InvalidationResult {
  checked: number;
  invalidated: number;
  archived: number;
  contradictionsFound: number;
  details: InvalidationDetail[];
}

export interface InvalidationDetail {
  factId: string;
  action: "invalidated" | "archived" | "contradiction";
  reason: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Staleness detection
// ---------------------------------------------------------------------------

/**
 * Check if a fact is stale based on age and confidence.
 */
export function isStale(fact: MemoryFact, config: InvalidationConfig, now: Date = new Date()): boolean {
  // Protected facts are never stale.
  if (fact.confidence >= config.protectedConfidenceThreshold) return false;

  const ageMs = now.getTime() - new Date(fact.updated_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays > config.maxAgeDays) return true;
  if (fact.confidence < config.minConfidence) return true;

  return false;
}

/**
 * Compute a recency score with exponential decay.
 */
export function recencyScore(fact: MemoryFact, now: Date = new Date()): number {
  const halfLife = fact.halfLifeDays ?? 30;
  const ageMs = now.getTime() - new Date(fact.last_accessed_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / halfLife);
}

/**
 * Compute the composite value score of a fact for ranking.
 * Higher = more valuable = less likely to be evicted.
 */
export function factValueScore(fact: MemoryFact, now: Date = new Date()): number {
  const recency = recencyScore(fact, now);
  const frequency = Math.log1p(fact.access_count) / 5; // Normalize to ~0-1
  const categoryWeights: Record<string, number> = {
    preference: 1.0,
    goal: 0.9,
    behavior: 0.8,
    knowledge: 0.7,
    context: 0.6,
  };
  const categoryWeight = categoryWeights[fact.category] ?? 0.5;

  return fact.confidence * 0.35 + recency * 0.3 + frequency * 0.15 + categoryWeight * 0.2;
}

// ---------------------------------------------------------------------------
// Invalidation engine
// ---------------------------------------------------------------------------

/**
 * Run an invalidation pass over a set of memory facts.
 * Returns the result with details about what was invalidated/archived.
 */
export function runInvalidation(
  facts: MemoryFact[],
  config: InvalidationConfig = DEFAULT_INVALIDATION_CONFIG,
  now: Date = new Date()
): InvalidationResult {
  const result: InvalidationResult = {
    checked: facts.length,
    invalidated: 0,
    archived: 0,
    contradictionsFound: 0,
    details: [],
  };

  const validFacts = facts.filter((f) => f.valid);

  for (const fact of validFacts) {
    if (isStale(fact, config)) {
      if (fact.confidence >= config.protectedConfidenceThreshold) {
        // Protect: don't invalidate, but mark for review.
        continue;
      }

      const ageMs = now.getTime() - new Date(fact.updated_at).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      if (ageDays > config.maxAgeDays * 2) {
        // Very old: archive.
        result.archived++;
        result.details.push({
          factId: fact.id,
          action: "archived",
          reason: `Fact is ${Math.round(ageDays)} days old (threshold: ${config.maxAgeDays * 2})`,
          content: fact.content.substring(0, 80),
        });
      } else {
        // Stale: invalidate.
        result.invalidated++;
        result.details.push({
          factId: fact.id,
          action: "invalidated",
          reason: `Stale: confidence=${fact.confidence.toFixed(2)}, age=${Math.round(ageDays)}d`,
          content: fact.content.substring(0, 80),
        });
      }
    }
  }

  // Contradiction detection (simplified: same tag, opposite sentiment).
  if (config.detectContradictions) {
    const contradictions = detectContradictions(validFacts);
    result.contradictionsFound = contradictions.length;
    for (const { older } of contradictions) {
      result.invalidated++;
      result.details.push({
        factId: older.id,
        action: "contradiction",
        reason: "Contradicted by a newer fact",
        content: older.content.substring(0, 80),
      });
    }
  }

  return result;
}

/**
 * Simple contradiction detection: find facts in the same category with
 * overlapping tags where one directly negates the other.
 * This is a heuristic — for production, use an LLM-based check.
 */
function detectContradictions(facts: MemoryFact[]): Array<{ newer: MemoryFact; older: MemoryFact }> {
  const contradictions: Array<{ newer: MemoryFact; older: MemoryFact }> = [];

  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      const a = facts[i];
      const b = facts[j];

      // Must share at least one tag.
      const sharedTags = a.tags.filter((t) => b.tags.includes(t));
      if (sharedTags.length === 0) continue;

      // Check for simple negation patterns.
      if (areContradictory(a.content, b.content)) {
        const newer = new Date(a.updated_at) > new Date(b.updated_at) ? a : b;
        const older = newer === a ? b : a;
        contradictions.push({ newer, older });
      }
    }
  }

  return contradictions;
}

/**
 * Heuristic check for contradictory statements.
 * Looks for negation patterns between two short text snippets.
 */
function areContradictory(a: string, b: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const normA = normalize(a);
  const normB = normalize(b);

  // Simple negation detection.
  const negationPatterns = [
    ["is", "is not"],
    ["likes", "does not like"],
    ["prefers", "does not prefer"],
    ["wants", "does not want"],
    ["uses", "does not use"],
    ["enabled", "disabled"],
    ["true", "false"],
    ["yes", "no"],
  ];

  for (const [pos, neg] of negationPatterns) {
    if (
      (normA.includes(pos) && normB.includes(neg)) ||
      (normA.includes(neg) && normB.includes(pos))
    ) {
      // Additional check: the rest of the statement should be similar.
      const similarity = jaccardSimilarity(normA.split(/\s+/), normB.split(/\s+/));
      if (similarity > 0.5) return true;
    }
  }

  return false;
}

/**
 * Jaccard similarity between two sets of tokens.
 */
function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// ---------------------------------------------------------------------------
// Filtering for context injection
// ---------------------------------------------------------------------------

/**
 * Filter memory facts for context injection.
 * Only returns valid, non-stale facts sorted by value score.
 *
 * @param facts - All stored facts.
 * @param maxFacts - Maximum number to return.
 * @param config - Invalidation config.
 * @returns Filtered, sorted facts ready for context injection.
 */
export function filterFactsForContext(
  facts: MemoryFact[],
  maxFacts: number = 20,
  config: InvalidationConfig = DEFAULT_INVALIDATION_CONFIG,
  now: Date = new Date()
): MemoryFact[] {
  return facts
    .filter((f) => f.valid && !isStale(f, config, now))
    .sort((a, b) => factValueScore(b, now) - factValueScore(a, now))
    .slice(0, maxFacts);
}
