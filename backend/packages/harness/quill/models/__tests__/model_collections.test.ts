import { describe, expect, it } from "vitest";

import {
  defaultCollections,
  addFavorite,
  removeFavorite,
  isFavorite,
  toggleFavorite,
  recordRecent,
  removeRecent,
  clearRecent,
  sortModelsByPreference,
  type ModelRef,
} from "../model_collections.ts";

const modelA: ModelRef = { provider: "openai", model: "gpt-4", displayName: "GPT-4" };
const modelB: ModelRef = { provider: "anthropic", model: "claude-3", displayName: "Claude 3" };
const modelC: ModelRef = { provider: "ollama", model: "llama3", displayName: "Llama 3" };

describe("model_collections", () => {
  describe("favorites", () => {
    it("starts with empty favorites", () => {
      const cols = defaultCollections();
      expect(cols.favorites).toEqual([]);
    });

    it("adds a favorite", () => {
      let cols = defaultCollections();
      cols = addFavorite(cols, modelA);
      expect(isFavorite(cols, modelA)).toBe(true);
      expect(cols.favorites.length).toBe(1);
    });

    it("does not duplicate favorites", () => {
      let cols = defaultCollections();
      cols = addFavorite(cols, modelA);
      cols = addFavorite(cols, modelA);
      expect(cols.favorites.length).toBe(1);
    });

    it("removes a favorite", () => {
      let cols = defaultCollections();
      cols = addFavorite(cols, modelA);
      cols = removeFavorite(cols, modelA);
      expect(isFavorite(cols, modelA)).toBe(false);
    });

    it("toggles favorite status", () => {
      let cols = defaultCollections();
      cols = toggleFavorite(cols, modelA);
      expect(isFavorite(cols, modelA)).toBe(true);
      cols = toggleFavorite(cols, modelA);
      expect(isFavorite(cols, modelA)).toBe(false);
    });
  });

  describe("recent", () => {
    it("records recent models", () => {
      let cols = defaultCollections();
      cols = recordRecent(cols, modelA);
      expect(cols.recent[0]).toEqual(modelA);
    });

    it("moves existing model to front", () => {
      let cols = defaultCollections();
      cols = recordRecent(cols, modelA);
      cols = recordRecent(cols, modelB);
      cols = recordRecent(cols, modelA);
      expect(cols.recent[0]).toEqual(modelA);
    });

    it("respects maxRecent limit", () => {
      let cols = defaultCollections(2);
      cols = recordRecent(cols, modelA);
      cols = recordRecent(cols, modelB);
      cols = recordRecent(cols, modelC);
      expect(cols.recent.length).toBe(2);
      expect(cols.recent[0]).toEqual(modelC);
    });

    it("removes from recent", () => {
      let cols = defaultCollections();
      cols = recordRecent(cols, modelA);
      cols = removeRecent(cols, modelA);
      expect(cols.recent).toEqual([]);
    });

    it("clears all recent", () => {
      let cols = defaultCollections();
      cols = recordRecent(cols, modelA);
      cols = recordRecent(cols, modelB);
      cols = clearRecent(cols);
      expect(cols.recent).toEqual([]);
    });
  });

  describe("sortModelsByPreference", () => {
    it("sorts favorites first", () => {
      let cols = defaultCollections();
      cols = addFavorite(cols, modelB);
      const sorted = sortModelsByPreference([modelA, modelB, modelC], cols);
      expect(sorted[0]).toEqual(modelB);
    });

    it("sorts recent after favorites", () => {
      let cols = defaultCollections();
      cols = addFavorite(cols, modelA);
      cols = recordRecent(cols, modelC);
      const sorted = sortModelsByPreference([modelA, modelB, modelC], cols);
      expect(sorted[0]).toEqual(modelA); // favorite
      expect(sorted[1]).toEqual(modelC); // recent
    });

    it("sorts alphabetically when no preference", () => {
      const cols = defaultCollections();
      const sorted = sortModelsByPreference([modelC, modelA, modelB], cols);
      expect(sorted.map((m) => m.displayName)).toEqual(["Claude 3", "GPT-4", "Llama 3"]);
    });
  });
});
