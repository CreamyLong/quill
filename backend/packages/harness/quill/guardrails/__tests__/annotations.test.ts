import { describe, expect, it } from "vitest";

import {
  EMPTY_ANNOTATIONS,
  computeRiskLevel,
  mergeAnnotations,
  normalizeAnnotations,
  type ToolAnnotations,
} from "../annotations.ts";

describe("annotations", () => {
  describe("EMPTY_ANNOTATIONS", () => {
    it("has all hints false", () => {
      expect(EMPTY_ANNOTATIONS).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });
    });
  });

  describe("computeRiskLevel", () => {
    it("returns 'low' for read-only tools", () => {
      const ann: ToolAnnotations = { ...EMPTY_ANNOTATIONS, readOnlyHint: true };
      expect(computeRiskLevel(ann)).toBe("low");
    });

    it("returns 'medium' for idempotent tools", () => {
      const ann: ToolAnnotations = { ...EMPTY_ANNOTATIONS, idempotentHint: true };
      expect(computeRiskLevel(ann)).toBe("medium");
    });

    it("returns 'high' for open-world tools", () => {
      const ann: ToolAnnotations = { ...EMPTY_ANNOTATIONS, openWorldHint: true };
      expect(computeRiskLevel(ann)).toBe("high");
    });

    it("returns 'critical' for destructive tools", () => {
      const ann: ToolAnnotations = { ...EMPTY_ANNOTATIONS, destructiveHint: true };
      expect(computeRiskLevel(ann)).toBe("critical");
    });

    it("returns 'medium' when no hints are declared", () => {
      expect(computeRiskLevel({ ...EMPTY_ANNOTATIONS })).toBe("medium");
    });

    it("classifies by highest-severity hint when multiple are set", () => {
      const ann: ToolAnnotations = {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
        destructiveHint: false,
      };
      expect(computeRiskLevel(ann)).toBe("high");
    });

    it("destructive wins over all other hints", () => {
      const ann: ToolAnnotations = {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
        destructiveHint: true,
      };
      expect(computeRiskLevel(ann)).toBe("critical");
    });
  });

  describe("mergeAnnotations", () => {
    it("applies partial overrides over defaults", () => {
      const result = mergeAnnotations(EMPTY_ANNOTATIONS, { readOnlyHint: true });
      expect(result).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      });
    });

    it("does not mutate the defaults object", () => {
      const defaults = { ...EMPTY_ANNOTATIONS };
      mergeAnnotations(defaults, { destructiveHint: true });
      expect(defaults.destructiveHint).toBe(false);
    });
  });

  describe("normalizeAnnotations", () => {
    it("returns all-false for null input", () => {
      expect(normalizeAnnotations(null)).toEqual(EMPTY_ANNOTATIONS);
    });

    it("returns all-false for undefined input", () => {
      expect(normalizeAnnotations(undefined)).toEqual(EMPTY_ANNOTATIONS);
    });

    it("coerces truthy values to true", () => {
      const result = normalizeAnnotations({
        readOnlyHint: 1,
        destructiveHint: "yes",
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(result.readOnlyHint).toBe(true);
      expect(result.destructiveHint).toBe(true);
      expect(result.idempotentHint).toBe(true);
      expect(result.openWorldHint).toBe(false);
    });

    it("ignores unknown fields", () => {
      const result = normalizeAnnotations({ readOnlyHint: true, unknownField: "ignored" });
      expect(result.readOnlyHint).toBe(true);
      expect(result.destructiveHint).toBe(false);
    });
  });
});
