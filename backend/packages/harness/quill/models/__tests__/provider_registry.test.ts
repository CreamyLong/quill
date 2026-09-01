import { describe, expect, it, beforeEach } from "vitest";

import {
  registerProvider,
  getProvider,
  getProviderByClassPath,
  listProviders,
  hasProvider,
  clearProviders,
  inferProviderId,
  type ProviderPlugin,
} from "../provider_registry.ts";

const mockProvider: ProviderPlugin = {
  id: "test-provider",
  name: "Test Provider",
  authMethods: ["api_key"],
  configFields: [
    { key: "api_key", label: "API Key", type: "password", required: true },
  ],
  defaultCapabilities: {
    reasoning: true,
    vision: true,
    attachments: false,
    tools: true,
  },
  classPath: "langchain_test:ChatTest",
  validateConfig: () => null,
  resolveCapabilities: function () {
    return this.defaultCapabilities;
  },
};

describe("provider_registry", () => {
  beforeEach(() => {
    clearProviders();
  });

  it("registers and retrieves a provider", () => {
    registerProvider(mockProvider);
    expect(hasProvider("test-provider")).toBe(true);
    expect(getProvider("test-provider")).toBe(mockProvider);
  });

  it("returns undefined for unknown provider", () => {
    expect(getProvider("unknown")).toBeUndefined();
    expect(hasProvider("unknown")).toBe(false);
  });

  it("finds provider by class path", () => {
    registerProvider(mockProvider);
    expect(getProviderByClassPath("langchain_test:ChatTest")).toBe(mockProvider);
    expect(getProviderByClassPath("unknown:Class")).toBeUndefined();
  });

  it("lists all registered providers", () => {
    registerProvider(mockProvider);
    registerProvider({ ...mockProvider, id: "other", name: "Other" });
    expect(listProviders().length).toBe(2);
  });

  it("replaces provider with same id", () => {
    registerProvider(mockProvider);
    const updated = { ...mockProvider, name: "Updated" };
    registerProvider(updated);
    expect(getProvider("test-provider")?.name).toBe("Updated");
    expect(listProviders().length).toBe(1);
  });

  it("infers provider id from use field", () => {
    registerProvider(mockProvider);
    expect(inferProviderId("langchain_test:ChatTest")).toBe("test-provider");
    expect(inferProviderId("unknown:Class")).toBeNull();
  });

  it("clears all providers", () => {
    registerProvider(mockProvider);
    clearProviders();
    expect(listProviders().length).toBe(0);
  });
});
