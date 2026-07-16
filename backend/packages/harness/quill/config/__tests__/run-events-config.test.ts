import { describe, expect, it } from "vitest";

import { buildRunEventsConfig } from "../run_events_config.ts";

describe("run_events config default", () => {
  it("defaults the backend to jsonl so subagent timelines survive restarts", () => {
    const cfg = buildRunEventsConfig();
    expect(cfg.backend).toBe("jsonl");
    expect(cfg.trackTokenUsage).toBe(true);
    expect(cfg.maxTraceContent).toBe(10240);
  });

  it("honors a user-specified backend", () => {
    expect(buildRunEventsConfig({ backend: "memory" }).backend).toBe("memory");
    expect(buildRunEventsConfig({ backend: "db" }).backend).toBe("db");
  });
});
