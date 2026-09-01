import { describe, expect, it } from "vitest";

import {
  computeCompositeScore,
  consolidate,
  defaultConsolidationConfig,
  formatDreamEntry,
  type ConsolidatableFact,
} from "../consolidation.ts";

function fact(
  id: string,
  content: string,
  options: Partial<ConsolidatableFact> = {},
): ConsolidatableFact {
  return {
    id,
    content,
    category: "preference",
    confidence: 0.8,
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
    accessCount: 0,
    ...options,
  };
}

describe("computeCompositeScore", () => {
  it("returns a score between 0 and 1", () => {
    const f = fact("f1", "User prefers dark mode");
    const score = computeCompositeScore(f, defaultConsolidationConfig());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("scores high-access facts higher than low-access ones", () => {
    const config = defaultConsolidationConfig();
    const low = fact("f1", "Some preference", { accessCount: 0, confidence: 0.5 });
    const high = fact("f2", "Some preference", { accessCount: 20, confidence: 0.5 });
    expect(computeCompositeScore(high, config)).toBeGreaterThan(
      computeCompositeScore(low, config),
    );
  });

  it("scores recent facts higher than old ones", () => {
    const config = defaultConsolidationConfig();
    const recent = fact("f1", "Recent", {
      createdAt: new Date().toISOString(),
      confidence: 0.5,
    });
    const old = fact("f2", "Old", {
      createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days
      confidence: 0.5,
    });
    expect(computeCompositeScore(recent, config)).toBeGreaterThan(
      computeCompositeScore(old, config),
    );
  });

  it("scores higher-confidence facts higher", () => {
    const config = defaultConsolidationConfig();
    const low = fact("f1", "Low confidence", { confidence: 0.2 });
    const high = fact("f2", "High confidence", { confidence: 0.95 });
    expect(computeCompositeScore(high, config)).toBeGreaterThan(
      computeCompositeScore(low, config),
    );
  });
});

describe("consolidate", () => {
  it("does nothing for empty facts", () => {
    const result = consolidate([]);
    expect(result.promoted).toEqual([]);
    expect(result.archived).toEqual([]);
    expect(result.merged).toEqual([]);
  });

  it("does not consolidate facts younger than minAgeMs", () => {
    const facts = [
      fact("f1", "Brand new fact", {
        createdAt: new Date().toISOString(),
        accessCount: 100,
      }),
    ];
    const result = consolidate(facts);
    expect(result.promoted).toEqual([]);
    expect(result.archived).toEqual([]);
  });

  it("promotes high-scoring facts", () => {
    const facts = [
      fact("f1", "Important preference", {
        confidence: 0.95,
        accessCount: 15,
      }),
    ];
    const config = { ...defaultConsolidationConfig(), promotionThreshold: 0.5 };
    const result = consolidate(facts, config);
    expect(result.promoted.length).toBe(1);
    expect(result.promoted[0].id).toBe("f1");
  });

  it("archives low-scoring facts", () => {
    const facts = [
      fact("f1", "Weak fact", {
        confidence: 0.1,
        accessCount: 0,
        createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
      }),
    ];
    const config = { ...defaultConsolidationConfig(), archivalThreshold: 0.3 };
    const result = consolidate(facts, config);
    expect(result.archived.length).toBe(1);
    expect(result.archived[0].id).toBe("f1");
  });

  it("merges duplicate facts (keeps highest confidence)", () => {
    const facts = [
      fact("f1", "User likes coffee", { confidence: 0.9 }),
      fact("f2", "User likes coffee", { confidence: 0.6 }),
      fact("f3", "User likes tea", { confidence: 0.8 }),
    ];
    const config = { ...defaultConsolidationConfig(), promotionThreshold: 0.95 };
    const result = consolidate(facts, config);
    expect(result.merged.length).toBe(1);
    expect(result.merged[0].into).toBe("f1"); // highest confidence kept
    expect(result.merged[0].merged).toContain("f2");
  });

  it("reports phase statistics", () => {
    const facts = [
      fact("f1", "Frequent fact", { accessCount: 5, confidence: 0.9 }),
      fact("f2", "Rare fact", { accessCount: 0, confidence: 0.3 }),
      fact("f3", "Another frequent", { accessCount: 3, confidence: 0.85, category: "behavior" }),
    ];
    const config = { ...defaultConsolidationConfig(), promotionThreshold: 0.5 };
    const result = consolidate(facts, config);
    expect(result.phases.light.surfacedCount).toBe(2); // accessCount >= 2
    expect(result.phases.rem.clustersFound).toBe(2); // 2 categories
    expect(result.phases.deep.promotedCount).toBeGreaterThan(0);
  });

  it("produces a valid dream entry", () => {
    const facts = [
      fact("f1", "Test fact", { accessCount: 5, confidence: 0.9 }),
    ];
    const config = { ...defaultConsolidationConfig(), promotionThreshold: 0.5 };
    const result = consolidate(facts, config);
    const entry = formatDreamEntry(result);
    expect(entry.phase).toBe("deep");
    expect(entry.factsAffected).toBeGreaterThanOrEqual(0);
    expect(entry.summary).toContain("Dream cycle");
  });
});
