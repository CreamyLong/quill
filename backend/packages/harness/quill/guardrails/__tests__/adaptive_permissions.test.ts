/**
 * Tests for adaptive permissions system.
 */

import { describe, expect, it } from "vitest";

import {
  computePermissionLevel,
  checkToolPermission,
  toolsRequiringApproval,
  AdaptivePermissionStore,
  type UserTrustProfile,
  type PermissionLevel,
} from "../adaptive_permissions.js";

function makeProfile(overrides: Partial<UserTrustProfile> = {}): UserTrustProfile {
  return {
    user_id: "test-user",
    level: 0,
    session_count: 0,
    total_tool_calls: 0,
    successful_tool_calls: 0,
    created_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("adaptive permissions", () => {
  describe("computePermissionLevel", () => {
    it("returns 0 for new users", () => {
      const profile = makeProfile();
      expect(computePermissionLevel(profile)).toBe(0);
    });

    it("advances to level 1 with enough sessions", () => {
      const profile = makeProfile({
        session_count: 10,
        total_tool_calls: 100,
        successful_tool_calls: 90, // 90% success
      });
      expect(computePermissionLevel(profile)).toBe(1);
    });

    it("advances to level 2 with enough sessions and account age", () => {
      const profile = makeProfile({
        session_count: 25,
        total_tool_calls: 200,
        successful_tool_calls: 185, // 92.5% success
        created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      });
      expect(computePermissionLevel(profile)).toBe(2);
    });

    it("does not advance without enough account age", () => {
      const profile = makeProfile({
        session_count: 25,
        total_tool_calls: 200,
        successful_tool_calls: 185,
        created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day old
      });
      expect(computePermissionLevel(profile)).toBe(1);
    });

    it("respects pinned max level", () => {
      const profile = makeProfile({
        session_count: 200,
        total_tool_calls: 1000,
        successful_tool_calls: 980,
        created_at: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
        pinned_max_level: 2,
      });
      expect(computePermissionLevel(profile)).toBe(2);
    });

    it("respects manual override", () => {
      const profile = makeProfile({
        manual_override: true,
        pinned_max_level: 4,
      });
      expect(computePermissionLevel(profile)).toBe(4);
    });
  });

  describe("checkToolPermission", () => {
    it("level 0 requires approval for everything", () => {
      const result = checkToolPermission("bash", {}, 0);
      expect(result.requiresApproval).toBe(true);
    });

    it("level 1 auto-approves read-only tools", () => {
      const result = checkToolPermission("read_file", { readOnly: true }, 1);
      expect(result.requiresApproval).toBe(false);
    });

    it("level 1 requires approval for destructive tools", () => {
      const result = checkToolPermission("bash", { destructive: true }, 1);
      expect(result.requiresApproval).toBe(true);
    });

    it("level 2 auto-approves idempotent tools", () => {
      const result = checkToolPermission("web_search", { idempotent: true }, 2);
      expect(result.requiresApproval).toBe(false);
    });

    it("level 3 auto-approves non-destructive tools", () => {
      const result = checkToolPermission("web_search", { openWorld: true }, 3);
      expect(result.requiresApproval).toBe(false);
    });

    it("level 3 requires approval for destructive tools", () => {
      const result = checkToolPermission("delete_file", { destructive: true }, 3);
      expect(result.requiresApproval).toBe(true);
    });

    it("level 4 requires approval only for destructive + open-world", () => {
      const result = checkToolPermission("curl", { destructive: true, openWorld: true }, 4);
      expect(result.requiresApproval).toBe(true);
    });

    it("level 4 auto-approves destructive-only tools", () => {
      const result = checkToolPermission("delete_file", { destructive: true }, 4);
      expect(result.requiresApproval).toBe(false);
    });
  });

  describe("toolsRequiringApproval", () => {
    it("returns only tools that require approval", () => {
      const tools = [
        { name: "read_file", annotations: { readOnly: true } },
        { name: "bash", annotations: { destructive: true } },
        { name: "web_search", annotations: { idempotent: true } },
      ];
      const result = toolsRequiringApproval(tools, 2);
      expect(result.length).toBe(1);
      expect(result[0].toolName).toBe("bash");
    });

    it("returns empty when all tools are auto-approved", () => {
      const tools = [
        { name: "read_file", annotations: { readOnly: true } },
        { name: "list_dir", annotations: { readOnly: true } },
      ];
      const result = toolsRequiringApproval(tools, 1);
      expect(result.length).toBe(0);
    });
  });

  describe("AdaptivePermissionStore", () => {
    it("creates a default profile for new users", () => {
      const store = new AdaptivePermissionStore();
      const profile = store.getProfile("new-user");
      expect(profile.user_id).toBe("new-user");
      expect(profile.level).toBe(0);
      expect(profile.session_count).toBe(0);
    });

    it("returns existing profile on second get", () => {
      const store = new AdaptivePermissionStore();
      const p1 = store.getProfile("user-1");
      const p2 = store.getProfile("user-1");
      expect(p1).toBe(p2);
    });

    it("updates level after recording sessions", () => {
      const store = new AdaptivePermissionStore();
      const userId = "advancing-user";

      // Record many successful sessions.
      for (let i = 0; i < 30; i++) {
        store.recordSession(userId);
        store.recordToolCall(userId, true);
      }

      const profile = store.getProfile(userId);
      expect(profile.session_count).toBe(30);
      expect(profile.level).toBeGreaterThan(0);
    });

    it("respects pin level", () => {
      const store = new AdaptivePermissionStore();
      const userId = "pinned-user";

      // Record enough to advance to level 4.
      for (let i = 0; i < 110; i++) {
        store.recordSession(userId);
        store.recordToolCall(userId, true);
      }

      store.pinLevel(userId, 2);
      const profile = store.getProfile(userId);
      expect(profile.level).toBeLessThanOrEqual(2);
    });

    it("allows unpinning", () => {
      const store = new AdaptivePermissionStore();
      const userId = "unpin-user";

      store.pinLevel(userId, 1);
      expect(store.getProfile(userId).level).toBeLessThanOrEqual(1);

      store.unpinLevel(userId);
      expect(store.getProfile(userId).manual_override).toBe(false);
    });

    it("setManualOverride fixes the level", () => {
      const store = new AdaptivePermissionStore();
      const userId = "override-user";

      store.setManualOverride(userId, 3);
      const profile = store.getProfile(userId);
      expect(profile.level).toBe(3);
      expect(profile.manual_override).toBe(true);
    });
  });
});
