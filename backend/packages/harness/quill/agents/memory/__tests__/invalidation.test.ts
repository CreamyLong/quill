/**
 * Tests for memory invalidation system.
 */

import { describe, expect, it } from "vitest";

import {
  isStale,
  recencyScore,
  factValueScore,
  runInvalidation,
  filterFactsForContext,
  DEFAULT_INVALIDATION_CONFIG,
  type MemoryFact,
  type InvalidationConfig,
} from "../invalidation.js";

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  const now = new Date();
  return {
    id: "fact-1",
    content: "User prefers TypeScript",
    category: "preference",
    confidence: 0.8,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    last_accessed_at: now.toISOString(),
    source: "conversation",
    valid: true,
    tags: ["language", "typescript"],
    access_count: 5,
    halfLifeDays: 30,
    ...overrides,
  };
}

const defaultConfig: InvalidationConfig = DEFAULT_INVALIDATION_CONFIG;

describe("memory invalidation", () => {
  describe("isStale", () => {
    it("returns false for a fresh, high-confidence fact", () => {
      const fact = makeFact();
      expect(isStale(fact, defaultConfig)).toBe(false);
    });

    it("returns true for facts older than maxAgeDays", () => {
      const old = makeFact({
        updated_at: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(), // 100 days ago
      });
      expect(isStale(old, defaultConfig)).toBe(true);
    });

    it("returns true for facts below minConfidence", () => {
      const lowConf = makeFact({ confidence: 0.1 });
      expect(isStale(lowConf, defaultConfig)).toBe(true);
    });

    it("never marks protected facts as stale", () => {
      const old = makeFact({
        confidence: 0.95,
        updated_at: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year old
      });
      expect(isStale(old, defaultConfig)).toBe(false);
    });
  });

  describe("recencyScore", () => {
    it("returns 1.0 for a just-accessed fact", () => {
      const fact = makeFact();
      expect(recencyScore(fact)).toBeCloseTo(1.0, 5);
    });

    it("decays to ~0.5 after one half-life", () => {
      const fact = makeFact({
        last_accessed_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      expect(recencyScore(fact)).toBeCloseTo(0.5, 1);
    });

    it("approaches 0 for very old facts", () => {
      const fact = makeFact({
        last_accessed_at: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
      expect(recencyScore(fact)).toBeLessThan(0.01);
    });
  });

  describe("factValueScore", () => {
    it("gives higher scores to recent, high-confidence facts", () => {
      const fresh = makeFact({ confidence: 0.9, access_count: 10 });
      const stale = makeFact({
        confidence: 0.4,
        access_count: 1,
        last_accessed_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      });
      expect(factValueScore(fresh)).toBeGreaterThan(factValueScore(stale));
    });

    it("weights preferences higher than context", () => {
      const pref = makeFact({ category: "preference" });
      const ctx = makeFact({ category: "context" });
      expect(factValueScore(pref)).toBeGreaterThan(factValueScore(ctx));
    });
  });

  describe("runInvalidation", () => {
    it("returns empty result for empty facts", () => {
      const result = runInvalidation([]);
      expect(result.checked).toBe(0);
      expect(result.invalidated).toBe(0);
    });

    it("invalidates stale facts", () => {
      const facts = [
        makeFact({ id: "fresh", confidence: 0.8 }),
        makeFact({
          id: "stale",
          confidence: 0.3,
          updated_at: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ];
      const result = runInvalidation(facts);
      expect(result.checked).toBe(2);
      expect(result.invalidated).toBeGreaterThanOrEqual(1);
      expect(result.details.some((d) => d.factId === "stale")).toBe(true);
    });

    it("archives very old facts", () => {
      const facts = [
        makeFact({
          id: "very-old",
          confidence: 0.5,
          updated_at: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ];
      const result = runInvalidation(facts);
      expect(result.archived).toBeGreaterThanOrEqual(1);
    });

    it("protects high-confidence facts from invalidation", () => {
      const facts = [
        makeFact({
          id: "protected",
          confidence: 0.95,
          updated_at: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ];
      const result = runInvalidation(facts);
      expect(result.invalidated).toBe(0);
      expect(result.archived).toBe(0);
    });

    it("detects contradictions between opposing facts", () => {
      // Use nearly-identical content with a negation flip so Jaccard > 0.5.
      const facts = [
        makeFact({ id: "a", content: "The preferred language is TypeScript", tags: ["lang"] }),
        makeFact({ id: "b", content: "The preferred language is not TypeScript", tags: ["lang"] }),
      ];
      const result = runInvalidation(facts, { ...defaultConfig, detectContradictions: true });
      expect(result.contradictionsFound).toBeGreaterThanOrEqual(1);
    });

    it("skips invalid facts", () => {
      const facts = [
        makeFact({ id: "invalid", valid: false, confidence: 0.1 }),
      ];
      const result = runInvalidation(facts);
      expect(result.checked).toBe(1);
      expect(result.invalidated).toBe(0);
    });
  });

  describe("filterFactsForContext", () => {
    it("excludes stale and invalid facts", () => {
      const facts = [
        makeFact({ id: "good" }),
        makeFact({
          id: "stale",
          confidence: 0.1,
          valid: true,
        }),
        makeFact({ id: "invalid", valid: false }),
      ];
      const result = filterFactsForContext(facts, 20, defaultConfig);
      const ids = result.map((f) => f.id);
      expect(ids).toContain("good");
      expect(ids).not.toContain("stale");
      expect(ids).not.toContain("invalid");
    });

    it("sorts by value score descending", () => {
      const facts = [
        makeFact({ id: "low", confidence: 0.4, access_count: 1 }),
        makeFact({ id: "high", confidence: 0.95, access_count: 20 }),
      ];
      const result = filterFactsForContext(facts, 20, defaultConfig);
      expect(result[0].id).toBe("high");
    });

    it("respects maxFacts limit", () => {
      const facts = Array.from({ length: 10 }, (_, i) =>
        makeFact({ id: `fact-${i}`, confidence: 0.5 + i * 0.05 })
      );
      const result = filterFactsForContext(facts, 5, defaultConfig);
      expect(result.length).toBeLessThanOrEqual(5);
    });
  });
});
