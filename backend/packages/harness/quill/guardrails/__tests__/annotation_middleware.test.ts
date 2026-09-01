import { afterEach, describe, expect, it } from "vitest";

import {
  MemoryAnnotationRegistry,
  attachAnnotations,
  getGlobalAnnotationRegistry,
  resolveToolAnnotations,
  setGlobalAnnotationRegistry,
} from "../annotation_middleware.ts";
import { ANNOTATIONS_METADATA_KEY, EMPTY_ANNOTATIONS } from "../annotations.ts";

function req(toolName: string): {
  toolName: string;
  toolInput: Record<string, unknown>;
  metadata?: Record<string, unknown>;
} {
  return { toolName, toolInput: {} };
}

describe("MemoryAnnotationRegistry", () => {
  it("returns all-false defaults for unknown tools", () => {
    const reg = new MemoryAnnotationRegistry();
    expect(reg.getAnnotations("unknown")).toEqual(EMPTY_ANNOTATIONS);
  });

  it("returns declared annotations for known tools", () => {
    const reg = new MemoryAnnotationRegistry({
      read_file: { readOnlyHint: true },
      bash: { destructiveHint: true, openWorldHint: false },
    });
    expect(reg.getAnnotations("read_file")).toEqual({
      ...EMPTY_ANNOTATIONS,
      readOnlyHint: true,
    });
    expect(reg.getAnnotations("bash")).toEqual({
      ...EMPTY_ANNOTATIONS,
      destructiveHint: true,
    });
  });

  it("supports incremental set()", () => {
    const reg = new MemoryAnnotationRegistry();
    reg.set("web_search", { openWorldHint: true });
    expect(reg.getAnnotations("web_search").openWorldHint).toBe(true);
    reg.set("web_search", { openWorldHint: false, idempotentHint: true });
    expect(reg.getAnnotations("web_search").openWorldHint).toBe(false);
    expect(reg.getAnnotations("web_search").idempotentHint).toBe(true);
  });
});

describe("attachAnnotations", () => {
  it("returns request unchanged when registry is null", () => {
    const input = req("bash");
    const output = attachAnnotations(input, null);
    expect(output).toBe(input);
  });

  it("attaches annotations from the registry", () => {
    const reg = new MemoryAnnotationRegistry({
      bash: { destructiveHint: true },
    });
    const output = attachAnnotations(req("bash"), reg);
    expect(output.metadata?.[ANNOTATIONS_METADATA_KEY]).toEqual({
      ...EMPTY_ANNOTATIONS,
      destructiveHint: true,
    });
  });

  it("preserves existing metadata", () => {
    const reg = new MemoryAnnotationRegistry({
      bash: { destructiveHint: true },
    });
    const input = { ...req("bash"), metadata: { existingKey: "value" } };
    const output = attachAnnotations(input, reg);
    expect(output.metadata?.existingKey).toBe("value");
    expect(output.metadata?.[ANNOTATIONS_METADATA_KEY]).toBeDefined();
  });
});

describe("resolveToolAnnotations", () => {
  it("returns defaults when registry is null", () => {
    expect(resolveToolAnnotations("anything", null)).toEqual(EMPTY_ANNOTATIONS);
  });

  it("returns declared annotations from registry", () => {
    const reg = new MemoryAnnotationRegistry({
      read_file: { readOnlyHint: true },
    });
    expect(resolveToolAnnotations("read_file", reg)).toEqual({
      ...EMPTY_ANNOTATIONS,
      readOnlyHint: true,
    });
  });
});

describe("global registry", () => {
  afterEach(() => {
    setGlobalAnnotationRegistry(null);
  });

  it("defaults to null", () => {
    expect(getGlobalAnnotationRegistry()).toBeNull();
  });

  it("sets and gets the global registry", () => {
    const reg = new MemoryAnnotationRegistry({ bash: { destructiveHint: true } });
    setGlobalAnnotationRegistry(reg);
    expect(getGlobalAnnotationRegistry()).toBe(reg);
  });
});
