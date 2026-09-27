/**
 * Tests for llm_overlay (CrewAI 1.15.22 sync).
 *
 * Covers scope semantics, whitespace-stripped matching, conflict detection,
 * exception-safe reset, async-context propagation, and the settings-merge
 * rules (generation params yes, credentials only same-provider).
 */

import { describe, expect, it } from "vitest";

import {
  LlmOverlayConflictError,
  activeLlmOverlay,
  mergeOverlaySettings,
  normalizeOverlayMapping,
  overlayModelFor,
  withLlmOverlay,
  withLlmOverlaySync,
} from "../llm_overlay.js";

describe("withLlmOverlay", () => {
  it("routes mapped roles and leaves unmapped roles on the declared model", async () => {
    await withLlmOverlay({ researcher: "deepseek-chat", writer: "claude-opus" }, () => {
      expect(overlayModelFor("researcher", "default-model")).toBe("deepseek-chat");
      expect(overlayModelFor("writer", "default-model")).toBe("claude-opus");
      expect(overlayModelFor("reviewer", "default-model")).toBe("default-model");
    });
  });

  it("returns the declared model outside any scope", () => {
    expect(activeLlmOverlay()).toBeNull();
    expect(overlayModelFor("researcher", "default-model")).toBe("default-model");
  });

  it("matches roles after whitespace stripping", async () => {
    await withLlmOverlay({ "  researcher  ": "deepseek-chat" }, () => {
      expect(overlayModelFor("researcher", "default-model")).toBe("deepseek-chat");
      expect(overlayModelFor(" researcher ", "default-model")).toBe("deepseek-chat");
    });
  });

  it("clears the overlay when the scope exits, including on error", async () => {
    await expect(
      withLlmOverlay({ researcher: "deepseek-chat" }, () => {
        expect(overlayModelFor("researcher", "default")).toBe("deepseek-chat");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(activeLlmOverlay()).toBeNull();
    expect(overlayModelFor("researcher", "default")).toBe("default");
  });

  it("propagates through awaited async continuations", async () => {
    await withLlmOverlay({ researcher: "deepseek-chat" }, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(overlayModelFor("researcher", "default")).toBe("deepseek-chat");
    });
    expect(activeLlmOverlay()).toBeNull();
  });

  it("supports nested scopes where the inner overlay wins", async () => {
    await withLlmOverlay({ researcher: "outer-model" }, async () => {
      expect(overlayModelFor("researcher", "default")).toBe("outer-model");
      await withLlmOverlay({ researcher: "inner-model" }, () => {
        expect(overlayModelFor("researcher", "default")).toBe("inner-model");
      });
      expect(overlayModelFor("researcher", "default")).toBe("outer-model");
    });
  });

  it("offers a synchronous variant for factory code paths", () => {
    const model = withLlmOverlaySync({ researcher: "deepseek-chat" }, () =>
      overlayModelFor("researcher", "default"),
    );
    expect(model).toBe("deepseek-chat");
    expect(activeLlmOverlay()).toBeNull();
  });
});

describe("normalizeOverlayMapping", () => {
  it("rejects whitespace-variant keys mapping to different models", () => {
    expect(() =>
      normalizeOverlayMapping({ "researcher": "deepseek-chat", " researcher ": "claude-opus" }),
    ).toThrow(LlmOverlayConflictError);
  });

  it("dedupes whitespace-variant keys mapping to the same model", () => {
    const normalized = normalizeOverlayMapping({
      "researcher": "deepseek-chat",
      " researcher ": "deepseek-chat",
    });
    expect(normalized).toEqual({ researcher: "deepseek-chat" });
  });
});

describe("mergeOverlaySettings", () => {
  it("copies generation settings the overlay model omits", () => {
    const merged = mergeOverlaySettings(
      { temperature: 0.2 },
      { temperature: 0.9, max_tokens: 4096, stop: ["\n\n"] },
      "openai",
      "anthropic",
    );
    expect(merged).toEqual({ temperature: 0.2, max_tokens: 4096, stop: ["\n\n"] });
  });

  it("keeps the overlay model's own generation settings", () => {
    const merged = mergeOverlaySettings(
      { temperature: 0.2, max_tokens: 1024 },
      { temperature: 0.9, max_tokens: 4096 },
      "openai",
      "openai",
    );
    expect(merged).toEqual({ temperature: 0.2, max_tokens: 1024 });
  });

  it("copies credentials only when providers match", () => {
    const same = mergeOverlaySettings({}, { api_key: "declared-key", base_url: "https://a" }, "openai", "openai");
    expect(same).toEqual({ api_key: "declared-key", base_url: "https://a" });

    const cross = mergeOverlaySettings({}, { api_key: "declared-key", base_url: "https://a" }, "openai", "anthropic");
    expect(cross).toEqual({});
  });
});
