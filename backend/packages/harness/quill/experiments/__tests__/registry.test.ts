/**
 * Tests for the experiment registry.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerAlgorithm,
  unregisterAlgorithm,
  getRegistration,
  listModuleKeys,
  listVariants,
  switchVariant,
  createActiveModule,
  createModule,
  recordMetric,
  getMetrics,
  getAllMetrics,
  resetMetrics,
  onRegistryChange,
  createDefaultModule,
  type AlgorithmModule,
  type AlgorithmModuleKey,
} from "../registry.js";

describe("Experiment Registry", () => {
  beforeEach(() => {
    // Clean up any previous registrations
    unregisterAlgorithm("classifier");
  });

  it("registers an algorithm module", () => {
    registerAlgorithm({
      key: "classifier",
      variants: [{ name: "v1", description: "Version 1" }],
      activeVariant: "v1",
      create: (variant) => createDefaultModule("classifier", variant),
    });

    const reg = getRegistration("classifier");
    expect(reg).toBeDefined();
    expect(reg?.activeVariant).toBe("v1");
    expect(reg?.variants).toHaveLength(1);
  });

  it("lists all registered module keys", () => {
    registerAlgorithm({
      key: "classifier",
      variants: [{ name: "v1", description: "Version 1" }],
      activeVariant: "v1",
      create: (variant) => createDefaultModule("classifier", variant),
    });

    const keys = listModuleKeys();
    expect(keys).toContain("classifier");
  });

  it("switches the active variant", () => {
    registerAlgorithm({
      key: "classifier",
      variants: [
        { name: "v1", description: "Version 1" },
        { name: "v2", description: "Version 2" },
      ],
      activeVariant: "v1",
      create: (variant) => createDefaultModule("classifier", variant),
    });

    const success = switchVariant("classifier", "v2");
    expect(success).toBe(true);
    expect(getRegistration("classifier")?.activeVariant).toBe("v2");
  });

  it("fails to switch to a non-existent variant", () => {
    registerAlgorithm({
      key: "classifier",
      variants: [{ name: "v1", description: "Version 1" }],
      activeVariant: "v1",
      create: (variant) => createDefaultModule("classifier", variant),
    });

    const success = switchVariant("classifier", "nonexistent");
    expect(success).toBe(false);
  });

  it("creates an active module instance", () => {
    registerAlgorithm({
      key: "classifier",
      variants: [{ name: "v1", description: "Version 1" }],
      activeVariant: "v1",
      create: (variant) => createDefaultModule("classifier", variant),
    });

    const module = createActiveModule("classifier");
    expect(module).toBeDefined();
    expect(module?.key).toBe("classifier");
    expect(module?.variant).toBe("v1");
  });

  it("records and retrieves metrics", () => {
    registerAlgorithm({
      key: "classifier",
      variants: [{ name: "v1", description: "Version 1" }],
      activeVariant: "v1",
      create: (variant) => createDefaultModule("classifier", variant),
    });

    recordMetric("classifier", "v1", true, 100);
    recordMetric("classifier", "v1", false, 200);
    recordMetric("classifier", "v1", true, 150);

    const metrics = getMetrics("classifier", "v1");
    expect(metrics).toBeDefined();
    expect(metrics?.executions).toBe(3);
    expect(metrics?.successes).toBe(2);
    expect(metrics?.failures).toBe(1);
    expect(metrics?.avgLatencyMs).toBeCloseTo(150, 0);
  });

  it("resets metrics", () => {
    registerAlgorithm({
      key: "classifier",
      variants: [{ name: "v1", description: "Version 1" }],
      activeVariant: "v1",
      create: (variant) => createDefaultModule("classifier", variant),
    });

    recordMetric("classifier", "v1", true, 100);
    resetMetrics("classifier", "v1");

    const metrics = getMetrics("classifier", "v1");
    expect(metrics?.executions).toBe(0);
  });

  it("notifies listeners on variant switch", () => {
    const listener = vi.fn();
    const unsubscribe = onRegistryChange(listener);

    registerAlgorithm({
      key: "classifier",
      variants: [
        { name: "v1", description: "Version 1" },
        { name: "v2", description: "Version 2" },
      ],
      activeVariant: "v1",
      create: (variant) => createDefaultModule("classifier", variant),
    });

    switchVariant("classifier", "v2");
    expect(listener).toHaveBeenCalledWith("classifier", "v2");

    unsubscribe();
  });

  it("creates a default module that passes through input", async () => {
    const module = createDefaultModule("classifier", "default");
    const output = await module.execute({ data: "test", context: {} });
    expect(output.success).toBe(true);
    expect(output.result).toBe("test");
  });
});
