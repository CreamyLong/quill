import { describe, expect, it, beforeEach } from "vitest";

import {
  resolveCapabilities,
  validateCapabilities,
  hasCapability,
  getCapabilityLabel,
  getCapabilityIcon,
  DEFAULT_CAPABILITIES,
  type ModelCapabilities,
} from "../capabilities.ts";
import { registerProvider, clearProviders, type ProviderPlugin } from "../provider_registry.ts";

const mockProvider: ProviderPlugin = {
  id: "test",
  name: "Test",
  authMethods: ["api_key"],
  configFields: [],
  defaultCapabilities: {
    reasoning: true,
    vision: false,
    attachments: false,
    tools: true,
  },
  classPath: "langchain_test:ChatTest",
  validateConfig: () => null,
  resolveCapabilities: function () {
    return this.defaultCapabilities;
  },
};

describe("capabilities", () => {
  beforeEach(() => {
    clearProviders();
  });

  describe("resolveCapabilities", () => {
    it("returns defaults for unknown provider", () => {
      const caps = resolveCapabilities({ use: "unknown:Class", name: "test" });
      expect(caps.reasoning).toBe(false);
      expect(caps.vision).toBe(false);
      expect(caps.tools).toBe(true);
    });

    it("parses supports_thinking flag from config", () => {
      const caps = resolveCapabilities({
        use: "unknown:Class",
        name: "test",
        supports_thinking: true,
      });
      expect(caps.reasoning).toBe(true);
    });

    it("parses supports_vision flag from config", () => {
      const caps = resolveCapabilities({
        use: "unknown:Class",
        name: "test",
        supports_vision: true,
      });
      expect(caps.vision).toBe(true);
      expect(caps.attachments).toBe(true);
    });

    it("uses provider plugin when available", () => {
      registerProvider(mockProvider);
      const caps = resolveCapabilities({
        use: "langchain_test:ChatTest",
        name: "test",
      });
      expect(caps.reasoning).toBe(true);
      expect(caps.vision).toBe(false);
    });

    it("resolves reasoning_effort from config", () => {
      const caps = resolveCapabilities({
        use: "unknown:Class",
        name: "test",
        supports_thinking: true,
        supports_reasoning_effort: true,
      });
      expect(caps.reasoningEffort).toBe(true);
    });

    it("resolves max_tokens from config", () => {
      const caps = resolveCapabilities({
        use: "unknown:Class",
        name: "test",
        max_tokens: 128000,
      });
      expect(caps.maxTokens).toBe(128000);
    });
  });

  describe("validateCapabilities", () => {
    it("returns no warnings for valid config", () => {
      const warnings = validateCapabilities({
        use: "unknown:Class",
        name: "test",
        supports_thinking: true,
        reasoning_effort: "high",
      });
      expect(warnings).toEqual([]);
    });

    it("warns when reasoning_effort set without reasoning support", () => {
      const warnings = validateCapabilities({
        use: "unknown:Class",
        name: "test",
        supports_thinking: false,
        reasoning_effort: "high",
      });
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain("reasoning_effort");
    });

    it("warns when when_thinking_enabled set without reasoning", () => {
      const warnings = validateCapabilities({
        use: "unknown:Class",
        name: "test",
        supports_thinking: false,
        when_thinking_enabled: { thinking: { type: "enabled" } },
      });
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain("when_thinking_enabled");
    });
  });

  describe("hasCapability", () => {
    it("returns boolean capability value", () => {
      const caps: ModelCapabilities = {
        ...DEFAULT_CAPABILITIES,
        reasoning: true,
        vision: false,
      };
      expect(hasCapability(caps, "reasoning")).toBe(true);
      expect(hasCapability(caps, "vision")).toBe(false);
    });

    it("returns true for numeric capabilities > 0", () => {
      const caps: ModelCapabilities = {
        ...DEFAULT_CAPABILITIES,
        maxTokens: 128000,
      };
      expect(hasCapability(caps, "maxTokens")).toBe(true);
    });
  });

  describe("getCapabilityLabel", () => {
    it("returns human-readable labels", () => {
      expect(getCapabilityLabel("reasoning")).toBe("Reasoning");
      expect(getCapabilityLabel("vision")).toBe("Vision");
      expect(getCapabilityLabel("tools")).toBe("Tool Calling");
    });
  });

  describe("getCapabilityIcon", () => {
    it("returns icon names", () => {
      expect(getCapabilityIcon("reasoning")).toBe("brain");
      expect(getCapabilityIcon("vision")).toBe("eye");
      expect(getCapabilityIcon("tools")).toBe("wrench");
    });
  });
});
