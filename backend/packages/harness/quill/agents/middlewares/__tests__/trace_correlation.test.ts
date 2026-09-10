/**
 * Tests for trace correlation ID middleware.
 */

import { describe, expect, it } from "vitest";

import {
  generateTraceId,
  getTraceId,
  setTraceId,
  injectTraceIntoMetadata,
  formatTraceLogPrefix,
  buildSubagentTraceConfig,
} from "../trace_correlation_middleware.js";

import type { ThreadState } from "../../factory.js";

function makeState(overrides: Record<string, unknown> = {}): ThreadState {
  return {
    messages: [],
    ...overrides,
  } as unknown as ThreadState;
}

describe("trace correlation", () => {
  describe("generateTraceId", () => {
    it("generates a trace ID with q- prefix", () => {
      const id = generateTraceId();
      expect(id.startsWith("q-")).toBe(true);
    });

    it("generates 8 hex chars after prefix", () => {
      const id = generateTraceId();
      const hexPart = id.slice(2);
      expect(hexPart).toMatch(/^[a-f0-9]{8}$/);
    });

    it("generates unique IDs", () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
      expect(ids.size).toBe(100);
    });
  });

  describe("getTraceId", () => {
    it("returns undefined when no trace ID is set", () => {
      const state = makeState();
      expect(getTraceId(state)).toBeUndefined();
    });

    it("reads trace ID from state", () => {
      const state = makeState({ _trace_id: "q-test1234" });
      expect(getTraceId(state)).toBe("q-test1234");
    });

    it("reads trace ID from config metadata", () => {
      const state = makeState({
        _config: { metadata: { trace_id: "q-config567" } },
      });
      expect(getTraceId(state)).toBe("q-config567");
    });

    it("prefers state over config", () => {
      const state = makeState({
        _trace_id: "q-state",
        _config: { metadata: { trace_id: "q-config" } },
      });
      expect(getTraceId(state)).toBe("q-state");
    });
  });

  describe("setTraceId", () => {
    it("sets trace ID in state", () => {
      const state = makeState();
      const result = setTraceId(state, "q-newtrace");
      expect((result as Record<string, unknown>)._trace_id).toBe("q-newtrace");
    });
  });

  describe("injectTraceIntoMetadata", () => {
    it("injects trace ID into metadata", () => {
      const state = makeState({ _config: { metadata: { existing: "value" } } });
      const metadata = injectTraceIntoMetadata(state, "q-trace123");
      expect(metadata.trace_id).toBe("q-trace123");
      expect(metadata.existing).toBe("value");
    });

    it("works with empty config", () => {
      const state = makeState();
      const metadata = injectTraceIntoMetadata(state, "q-trace123");
      expect(metadata.trace_id).toBe("q-trace123");
    });
  });

  describe("formatTraceLogPrefix", () => {
    it("formats with trace ID", () => {
      expect(formatTraceLogPrefix("q-abc12345")).toBe("[trace=q-abc12345]");
    });

    it("formats without trace ID", () => {
      expect(formatTraceLogPrefix(undefined)).toBe("[trace=none]");
    });
  });

  describe("buildSubagentTraceConfig", () => {
    it("propagates parent trace ID", () => {
      const config = buildSubagentTraceConfig("q-parent123", "research-agent");
      expect(config.metadata.trace_id).toBe("q-parent123");
      expect(config.metadata.parent_trace_id).toBe("q-parent123");
      expect(config.metadata.subagent_name).toBe("research-agent");
    });
  });
});
