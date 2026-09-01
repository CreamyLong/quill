import { describe, expect, it } from "vitest";

import {
  HEARTBEAT_PROMPT,
  NO_REPLY,
  HeartbeatManager,
  isInActiveHours,
} from "../heartbeat.ts";
import { buildHeartbeatConfig, defaultHeartbeatConfig } from "../heartbeat_config.ts";

describe("heartbeat_config", () => {
  it("defaults to disabled with 30min cadence", () => {
    const cfg = defaultHeartbeatConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.cadenceMinutes).toBe(30);
    expect(cfg.useCheaperModel).toBe(true);
    expect(cfg.isolatedSession).toBe(true);
    expect(cfg.delivery).toBe("owner");
  });

  it("buildHeartbeatConfig converts snake_case to camelCase", () => {
    const cfg = buildHeartbeatConfig({
      enabled: true,
      cadence_minutes: 60,
      model_name: "gpt-4o-mini",
      active_hours_start: 9,
      active_hours_end: 18,
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.cadenceMinutes).toBe(60);
    expect(cfg.modelName).toBe("gpt-4o-mini");
    expect(cfg.activeHoursStart).toBe(9);
    expect(cfg.activeHoursEnd).toBe(18);
  });

  it("enforces minimum cadence of 1 minute", () => {
    const cfg = buildHeartbeatConfig({ cadence_minutes: 0 });
    expect(cfg.cadenceMinutes).toBe(1);
  });
});

describe("isInActiveHours", () => {
  it("returns true when no active hours are configured", () => {
    const cfg = buildHeartbeatConfig({});
    expect(isInActiveHours(cfg, new Date("2026-01-15T03:00:00"))).toBe(true);
  });

  it("returns true within the active window", () => {
    const cfg = buildHeartbeatConfig({ active_hours_start: 9, active_hours_end: 18 });
    expect(isInActiveHours(cfg, new Date(2026, 0, 15, 12, 0, 0))).toBe(true);
  });

  it("returns false outside the active window", () => {
    const cfg = buildHeartbeatConfig({ active_hours_start: 9, active_hours_end: 18 });
    expect(isInActiveHours(cfg, new Date(2026, 0, 15, 20, 0, 0))).toBe(false);
  });

  it("handles overnight windows", () => {
    const cfg = buildHeartbeatConfig({ active_hours_start: 22, active_hours_end: 6 });
    expect(isInActiveHours(cfg, new Date(2026, 0, 15, 23, 0, 0))).toBe(true);
    expect(isInActiveHours(cfg, new Date(2026, 0, 16, 3, 0, 0))).toBe(true);
    expect(isInActiveHours(cfg, new Date(2026, 0, 15, 12, 0, 0))).toBe(false);
  });
});

describe("HeartbeatManager", () => {
  it("starts inactive when disabled", () => {
    const mgr = new HeartbeatManager("agent-1");
    expect(mgr.isActive()).toBe(false);
  });

  it("is active when enabled and within active hours", () => {
    const mgr = new HeartbeatManager("agent-1", {
      enabled: true,
      activeHoursStart: 0,
      activeHoursEnd: 24,
    });
    expect(mgr.isActive()).toBe(true);
  });

  it("is inactive outside active hours", () => {
    const mgr = new HeartbeatManager("agent-1", {
      enabled: true,
      activeHoursStart: 9,
      activeHoursEnd: 18,
    });
    // Test at 20:00 local (outside 9-18)
    const evening = new Date(2026, 0, 15, 20, 0, 0);
    expect(mgr.isActive(evening)).toBe(false);
  });

  describe("monitor scratch", () => {
    it("starts with empty scratch", () => {
      const mgr = new HeartbeatManager("agent-1");
      expect(mgr.scratch.entries).toEqual([]);
      expect(mgr.scratch.consecutiveNoReply).toBe(0);
    });

    it("addEntry adds an active entry", () => {
      const mgr = new HeartbeatManager("agent-1");
      const entry = mgr.addEntry("Check inbox for urgent messages");
      expect(entry.active).toBe(true);
      expect(entry.text).toBe("Check inbox for urgent messages");
      expect(mgr.scratch.entries.length).toBe(1);
    });

    it("dismissEntry marks an entry as inactive", () => {
      const mgr = new HeartbeatManager("agent-1");
      const entry = mgr.addEntry("Check inbox");
      const dismissed = mgr.dismissEntry(entry.id);
      expect(dismissed).toBe(true);
      expect(mgr.scratch.entries[0].active).toBe(false);
    });

    it("dismissEntry returns false for unknown id", () => {
      const mgr = new HeartbeatManager("agent-1");
      expect(mgr.dismissEntry("nonexistent")).toBe(false);
    });
  });

  describe("prompt building", () => {
    it("returns base prompt when no active entries", () => {
      const mgr = new HeartbeatManager("agent-1");
      expect(mgr.buildPrompt()).toBe(HEARTBEAT_PROMPT);
    });

    it("includes active scratch entries in the prompt", () => {
      const mgr = new HeartbeatManager("agent-1");
      mgr.addEntry("Check inbox");
      mgr.addEntry("Review calendar");
      const prompt = mgr.buildPrompt();
      expect(prompt).toContain("Check inbox");
      expect(prompt).toContain("Review calendar");
      expect(prompt).toContain("<heartbeat-monitor-scratch>");
    });

    it("excludes dismissed entries from the prompt", () => {
      const mgr = new HeartbeatManager("agent-1");
      const entry = mgr.addEntry("Check inbox");
      mgr.addEntry("Review calendar");
      mgr.dismissEntry(entry.id);
      const prompt = mgr.buildPrompt();
      expect(prompt).not.toContain("Check inbox");
      expect(prompt).toContain("Review calendar");
    });
  });

  describe("turn recording", () => {
    it("increments consecutiveNoReply on NO_REPLY", () => {
      const mgr = new HeartbeatManager("agent-1");
      mgr.recordTurn({ alerted: false, response: NO_REPLY });
      expect(mgr.scratch.consecutiveNoReply).toBe(1);
    });

    it("resets consecutiveNoReply on alert", () => {
      const mgr = new HeartbeatManager("agent-1");
      mgr.recordTurn({ alerted: false, response: NO_REPLY });
      mgr.recordTurn({ alerted: false, response: NO_REPLY });
      mgr.recordTurn({ alerted: true, response: "Inbox has 3 urgent messages" });
      expect(mgr.scratch.consecutiveNoReply).toBe(0);
    });

    it("updates lastHeartbeatAt on each turn", () => {
      const mgr = new HeartbeatManager("agent-1");
      expect(mgr.scratch.lastHeartbeatAt).toBeNull();
      mgr.recordTurn({ alerted: false, response: NO_REPLY });
      expect(mgr.scratch.lastHeartbeatAt).not.toBeNull();
    });
  });

  describe("suppression", () => {
    it("does not suppress when maxConsecutiveNoReply is null", () => {
      const mgr = new HeartbeatManager("agent-1", { enabled: true });
      mgr.recordTurn({ alerted: false, response: NO_REPLY });
      mgr.recordTurn({ alerted: false, response: NO_REPLY });
      expect(mgr.shouldSuppress()).toBe(false);
    });

    it("suppresses after reaching the consecutive NO_REPLY limit", () => {
      const mgr = new HeartbeatManager("agent-1", {
        enabled: true,
        maxConsecutiveNoReply: 3,
      });
      mgr.recordTurn({ alerted: false, response: NO_REPLY });
      mgr.recordTurn({ alerted: false, response: NO_REPLY });
      expect(mgr.shouldSuppress()).toBe(false);
      mgr.recordTurn({ alerted: false, response: NO_REPLY });
      expect(mgr.shouldSuppress()).toBe(true);
    });
  });

  describe("serialization", () => {
    it("toJSON returns a copy of the scratch", () => {
      const mgr = new HeartbeatManager("agent-1");
      mgr.addEntry("Check inbox");
      const json = mgr.toJSON();
      expect(json.agentId).toBe("agent-1");
      expect(json.entries.length).toBe(1);
      expect(json.version).toBe(1);
    });

    it("setScratch replaces the scratch", () => {
      const mgr = new HeartbeatManager("agent-1");
      mgr.addEntry("Old entry");
      mgr.setScratch({
        agentId: "agent-1",
        entries: [],
        lastHeartbeatAt: "2026-01-15T00:00:00.000Z",
        consecutiveNoReply: 5,
        version: 10,
      });
      expect(mgr.scratch.entries).toEqual([]);
      expect(mgr.scratch.consecutiveNoReply).toBe(5);
      expect(mgr.scratch.version).toBe(10);
    });
  });
});
