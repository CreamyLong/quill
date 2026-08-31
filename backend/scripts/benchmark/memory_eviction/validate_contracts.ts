/**
 * Benchmark: memory fact eviction policy contract validation.
 *
 * Mirrors the DeerFlow 2.0 `scripts/benchmark/deermem_eviction/` pattern.
 * Validates the production select_facts_for_capacity() contract without
 * requiring network access, provider credentials, or external datasets.
 *
 * Run from backend/:
 *   npx tsx scripts/benchmark/memory_eviction/validate_contracts.ts
 */

interface Fact {
  id: string;
  content: string;
  confidence: number;
  createdAt: number; // epoch ms
  category: string;
}

interface EvictionResult {
  kept: Fact[];
  evicted: Fact[];
  policy: string;
}

/**
 * Select facts for capacity using confidence-based eviction.
 *
 * Production contract: facts are sorted by confidence (ascending), then
 * by createdAt (oldest first). The lowest-confidence, oldest facts are
 * evicted first until the count is within capacity.
 *
 * This is a pure function — no side effects, deterministic ordering.
 */
export function selectFactsForCapacity(
  facts: Fact[],
  capacity: number,
  options: { policy?: "confidence" | "hybrid-v1" } = {}
): EvictionResult {
  const policy = options.policy ?? "confidence";

  if (facts.length <= capacity) {
    return { kept: [...facts], evicted: [], policy };
  }

  // Create a copy and sort by eviction priority (lowest confidence first,
  // then oldest first for ties).
  const sorted = [...facts].sort((a, b) => {
    if (a.confidence !== b.confidence) {
      return a.confidence - b.confidence;
    }
    return a.createdAt - b.createdAt;
  });

  // Evict the lowest-priority facts until we're within capacity.
  const evictCount = facts.length - capacity;
  const evicted = sorted.slice(0, evictCount);
  const kept = sorted.slice(evictCount);

  return { kept, evicted, policy };
}

/**
 * Hybrid-v1 eviction: combines confidence with category-aware weighting.
 *
 * Facts in "preference" and "goal" categories are weighted higher and
 * evicted less aggressively.
 */
export function selectFactsForCapacityHybrid(
  facts: Fact[],
  capacity: number
): EvictionResult {
  const PROTECTED_CATEGORIES = new Set(["preference", "goal"]);

  const weighted = facts.map((f) => ({
    fact: f,
    weight: f.confidence * (PROTECTED_CATEGORIES.has(f.category) ? 1.5 : 1.0),
  }));

  // Sort by weight ascending (lowest weight evicted first).
  weighted.sort((a, b) => {
    if (a.weight !== b.weight) {
      return a.weight - b.weight;
    }
    return a.fact.createdAt - b.fact.createdAt;
  });

  if (facts.length <= capacity) {
    return { kept: facts.map((f) => f), evicted: [], policy: "hybrid-v1" };
  }

  const evictCount = facts.length - capacity;
  const evicted = weighted.slice(0, evictCount).map((w) => w.fact);
  const kept = weighted.slice(evictCount).map((w) => w.fact);

  return { kept, evicted, policy: "hybrid-v1" };
}

// ---------------------------------------------------------------------------
// Contract validation (run when executed directly)
// ---------------------------------------------------------------------------

function generateSyntheticFacts(count: number): Fact[] {
  const categories = ["preference", "knowledge", "context", "behavior", "goal"];
  const facts: Fact[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    facts.push({
      id: `fact-${i.toString().padStart(4, "0")}`,
      content: `Synthetic fact #${i} for eviction benchmark testing.`,
      confidence: Math.round((Math.random() * 0.5 + 0.3) * 100) / 100, // 0.3 - 0.8
      createdAt: now - (count - i) * 60000, // Spaced 1 minute apart
      category: categories[i % categories.length],
    });
  }

  return facts;
}

interface ContractTest {
  name: string;
  run: () => { pass: boolean; message: string };
}

function buildContractTests(): ContractTest[] {
  return [
    {
      name: "capacity_zero_evicts_all",
      run: () => {
        const facts = generateSyntheticFacts(10);
        const result = selectFactsForCapacity(facts, 0);
        return {
          pass: result.evicted.length === 10 && result.kept.length === 0,
          message: `Expected 10 evicted, 0 kept. Got ${result.evicted.length} evicted, ${result.kept.length} kept.`,
        };
      },
    },
    {
      name: "capacity_exceeds_count_keeps_all",
      run: () => {
        const facts = generateSyntheticFacts(5);
        const result = selectFactsForCapacity(facts, 100);
        return {
          pass: result.kept.length === 5 && result.evicted.length === 0,
          message: `Expected 5 kept, 0 evicted. Got ${result.kept.length} kept, ${result.evicted.length} evicted.`,
        };
      },
    },
    {
      name: "exact_capacity_boundary",
      run: () => {
        const facts = generateSyntheticFacts(10);
        const result = selectFactsForCapacity(facts, 10);
        return {
          pass: result.kept.length === 10 && result.evicted.length === 0,
          message: `Expected 10 kept at exact capacity. Got ${result.kept.length} kept.`,
        };
      },
    },
    {
      name: "evicts_lowest_confidence_first",
      run: () => {
        const facts = generateSyntheticFacts(20);
        const result = selectFactsForCapacity(facts, 10);
        // The evicted facts should have lower average confidence than kept.
        const evictedAvg =
          result.evicted.reduce((s, f) => s + f.confidence, 0) / result.evicted.length;
        const keptAvg =
          result.kept.reduce((s, f) => s + f.confidence, 0) / result.kept.length;
        return {
          pass: evictedAvg <= keptAvg,
          message: `Evicted avg confidence (${evictedAvg.toFixed(3)}) should be <= kept avg (${keptAvg.toFixed(3)}).`,
        };
      },
    },
    {
      name: "deterministic_ordering",
      run: () => {
        const facts = generateSyntheticFacts(15);
        const run1 = selectFactsForCapacity(facts, 8);
        const run2 = selectFactsForCapacity(facts, 8);
        const ids1 = run1.evicted.map((f) => f.id).join(",");
        const ids2 = run2.evicted.map((f) => f.id).join(",");
        return {
          pass: ids1 === ids2,
          message: "Two runs with the same input should produce identical eviction order.",
        };
      },
    },
    {
      name: "hybrid_protects_preference_facts",
      run: () => {
        const facts: Fact[] = [
          { id: "p1", content: "User prefers dark mode", confidence: 0.4, createdAt: 0, category: "preference" },
          { id: "k1", content: "Knowledge fact", confidence: 0.9, createdAt: 1, category: "knowledge" },
          { id: "k2", content: "Another knowledge", confidence: 0.85, createdAt: 2, category: "knowledge" },
          { id: "k3", content: "Third knowledge", confidence: 0.8, createdAt: 3, category: "knowledge" },
        ];
        // Capacity 2: pure confidence would evict p1 (0.4) and k3 (0.8).
        // Hybrid should protect p1 (preference, weighted 0.4*1.5=0.6) and
        // evict k3 (0.8) and k2 (0.85) instead.
        const result = selectFactsForCapacityHybrid(facts, 2);
        const keptIds = new Set(result.kept.map((f) => f.id));
        return {
          pass: keptIds.has("p1") && keptIds.has("k1"),
          message: `Expected p1 and k1 kept. Got: ${[...keptIds].join(", ")}`,
        };
      },
    },
  ];
}

/** Run all contract tests and report results. */
export function validateContracts(): { passed: number; failed: number; results: Array<{ name: string; pass: boolean; message: string }> } {
  const tests = buildContractTests();
  const results = tests.map((t) => {
    const r = t.run();
    return { name: t.name, ...r };
  });
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  return { passed, failed, results };
}

// Run when executed directly.
if (require.main === module) {
  console.log("=== Memory Eviction Contract Validation ===\n");
  const { passed, failed, results } = validateContracts();
  for (const r of results) {
    const status = r.pass ? "PASS" : "FAIL";
    console.log(`  [${status}] ${r.name}: ${r.message}`);
  }
  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}
