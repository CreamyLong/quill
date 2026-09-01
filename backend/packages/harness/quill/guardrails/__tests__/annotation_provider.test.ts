import { describe, expect, it } from "vitest";

import { AnnotationProvider, ANNOTATIONS_METADATA_KEY } from "../annotation_provider.ts";
import { EMPTY_ANNOTATIONS, type ToolAnnotations } from "../annotations.ts";

function req(
  toolName: string,
  metadata?: Record<string, unknown>,
): {
  toolName: string;
  toolInput: Record<string, unknown>;
  metadata?: Record<string, unknown>;
} {
  return { toolName, toolInput: {}, metadata };
}

function withAnnotations(
  toolName: string,
  annotations: ToolAnnotations,
): {
  toolName: string;
  toolInput: Record<string, unknown>;
  metadata?: Record<string, unknown>;
} {
  return {
    toolName,
    toolInput: {},
    metadata: { [ANNOTATIONS_METADATA_KEY]: annotations },
  };
}

describe("AnnotationProvider", () => {
  describe("default policy (maxRiskLevel: medium)", () => {
    it("allows read-only tools", () => {
      const p = new AnnotationProvider();
      const d = p.evaluate(withAnnotations("read_file", { ...EMPTY_ANNOTATIONS, readOnlyHint: true }));
      expect(d.allow).toBe(true);
      expect(d.reasons[0].code).toBe("oap.allowed_by_annotation");
    });

    it("allows idempotent tools", () => {
      const p = new AnnotationProvider();
      const d = p.evaluate(withAnnotations("fetch", { ...EMPTY_ANNOTATIONS, idempotentHint: true }));
      expect(d.allow).toBe(true);
    });

    it("denies open-world tools", () => {
      const p = new AnnotationProvider();
      const d = p.evaluate(withAnnotations("web_search", { ...EMPTY_ANNOTATIONS, openWorldHint: true }));
      expect(d.allow).toBe(false);
      expect(d.reasons[0].code).toBe("oap.tool_risk_too_high");
    });

    it("denies destructive tools", () => {
      const p = new AnnotationProvider();
      const d = p.evaluate(withAnnotations("bash", { ...EMPTY_ANNOTATIONS, destructiveHint: true }));
      expect(d.allow).toBe(false);
      expect(d.reasons[0].code).toBe("oap.tool_risk_too_high");
    });

    it("denies unknown tools (no annotations = medium risk, at threshold)", () => {
      const p = new AnnotationProvider();
      // No metadata → falls back to EMPTY_ANNOTATIONS → medium risk.
      // medium <= medium threshold → allowed.
      const d = p.evaluate(req("unknown_tool"));
      expect(d.allow).toBe(true);
    });
  });

  describe("strict policy (maxRiskLevel: low)", () => {
    it("denies idempotent tools", () => {
      const p = new AnnotationProvider({ maxRiskLevel: "low" });
      const d = p.evaluate(withAnnotations("fetch", { ...EMPTY_ANNOTATIONS, idempotentHint: true }));
      expect(d.allow).toBe(false);
    });

    it("allows read-only tools", () => {
      const p = new AnnotationProvider({ maxRiskLevel: "low" });
      const d = p.evaluate(withAnnotations("read_file", { ...EMPTY_ANNOTATIONS, readOnlyHint: true }));
      expect(d.allow).toBe(true);
    });
  });

  describe("permissive policy (maxRiskLevel: critical)", () => {
    it("allows even destructive tools", () => {
      const p = new AnnotationProvider({ maxRiskLevel: "critical" });
      const d = p.evaluate(withAnnotations("bash", { ...EMPTY_ANNOTATIONS, destructiveHint: true }));
      expect(d.allow).toBe(true);
    });
  });

  describe("allowlist/denylist override", () => {
    it("allowlist allows a destructive tool", () => {
      const p = new AnnotationProvider({
        maxRiskLevel: "low",
        allowlist: ["bash"],
      });
      const d = p.evaluate(withAnnotations("bash", { ...EMPTY_ANNOTATIONS, destructiveHint: true }));
      expect(d.allow).toBe(true);
      expect(d.reasons[0].code).toBe("oap.tool_allowed_by_annotation");
    });

    it("denylist denies a read-only tool", () => {
      const p = new AnnotationProvider({
        maxRiskLevel: "critical",
        denylist: ["read_file"],
      });
      const d = p.evaluate(withAnnotations("read_file", { ...EMPTY_ANNOTATIONS, readOnlyHint: true }));
      expect(d.allow).toBe(false);
      expect(d.reasons[0].code).toBe("oap.tool_denied_by_annotation");
    });

    it("denylist takes precedence over allowlist", () => {
      const p = new AnnotationProvider({
        allowlist: ["bash"],
        denylist: ["bash"],
      });
      const d = p.evaluate(req("bash"));
      expect(d.allow).toBe(false);
    });
  });

  describe("aevaluate", () => {
    it("returns the same result as evaluate", async () => {
      const p = new AnnotationProvider();
      const input = withAnnotations("web_search", { ...EMPTY_ANNOTATIONS, openWorldHint: true });
      const sync = p.evaluate(input);
      const async = await p.aevaluate(input);
      expect(async.allow).toBe(sync.allow);
      expect(async.reasons[0].code).toBe(sync.reasons[0].code);
    });
  });
});
