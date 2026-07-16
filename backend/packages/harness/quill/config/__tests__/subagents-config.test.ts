import { describe, expect, it } from "vitest";

import {
  getSubagentsAppConfig,
  isSubagentsEnabled,
  loadSubagentsConfigFromDict,
} from "../subagents_config.ts";

describe("subagents config", () => {
  it("defaults to enabled with a global 1800s timeout", () => {
    const cfg = getSubagentsAppConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.timeoutSeconds).toBe(1800);
  });

  it("isSubagentsEnabled reads the flag", () => {
    expect(isSubagentsEnabled({ ...getSubagentsAppConfig(), enabled: true })).toBe(true);
    expect(isSubagentsEnabled({ ...getSubagentsAppConfig(), enabled: false })).toBe(false);
  });

  it("loadSubagentsConfigFromDict parses enabled (default true)", () => {
    loadSubagentsConfigFromDict({ timeoutSeconds: 60 });
    expect(getSubagentsAppConfig().enabled).toBe(true);
    expect(getSubagentsAppConfig().timeoutSeconds).toBe(60);
  });

  it("loadSubagentsConfigFromDict parses enabled: false", () => {
    loadSubagentsConfigFromDict({ enabled: false });
    expect(getSubagentsAppConfig().enabled).toBe(false);
    // restore default for other tests
    loadSubagentsConfigFromDict({ enabled: true });
  });
});
