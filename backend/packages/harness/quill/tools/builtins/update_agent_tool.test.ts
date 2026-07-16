/**
 * Unit tests for the update_agent tool.
 *
 * Mirrors the Python test suite in `backend/tests/test_update_agent_tool.py`.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createUpdateAgentTool } from "./update_agent_tool.ts";
import type { Paths } from "../../config/paths.ts";
import type { AppConfig } from "../../config/app_config.ts";

/** Create a mock Paths instance that resolves under a temp directory. */
function makeMockPaths(tmpDir: string): Paths {
  return {
    baseDir: tmpDir,
    userAgentDir: (userId: string, agentName: string) =>
      path.join(tmpDir, "users", userId, "agents", agentName.toLowerCase()),
    agentsDir: path.join(tmpDir, "agents"),
    agentDir: (name: string) => path.join(tmpDir, "agents", name.toLowerCase()),
    userDir: (userId: string) => path.join(tmpDir, "users", userId),
  } as unknown as Paths;
}

/** Create a minimal AppConfig mock for model validation. */
function makeMockAppConfig(): AppConfig {
  return {
    models: [
      { name: "gpt-4", display_name: "GPT-4", model: "gpt-4", supportsThinking: false },
      { name: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4", model: "claude-sonnet-4-20250514", supportsThinking: true },
    ],
  } as unknown as AppConfig;
}

/** Seed an agent directory with config.yaml and SOUL.md. */
function seedAgent(tmpDir: string, agentName: string, config: Record<string, unknown>, soul: string, userId = "default") {
  const agentDir = path.join(tmpDir, "users", userId, "agents", agentName.toLowerCase());
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "config.yaml"), JSON.stringify(config), "utf-8");
  fs.writeFileSync(path.join(agentDir, "SOUL.md"), soul, "utf-8");
  return agentDir;
}

/** Helper to invoke the tool and parse the JSON result. */
async function invoke(
  tmpDir: string,
  input: { soul?: string; description?: string; skills?: string[]; tool_groups?: string[]; model?: string },
  context: Record<string, unknown> = {},
) {
  const tool = createUpdateAgentTool({
    getPaths: () => makeMockPaths(tmpDir),
    getAppConfig: () => makeMockAppConfig(),
  });
  const result = await tool.invoke(input, { configurable: context });
  return JSON.parse(result as string);
}

describe("update_agent", () => {
  it("updates soul only, preserving description", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-agent-"));
    try {
      seedAgent(tmpDir, "test-agent", { name: "test-agent", description: "keep me" }, "old soul");

      const result = await invoke(
        tmpDir,
        { soul: "brand new soul" },
        { agent_name: "test-agent" },
      );

      expect(result.ok).toBe(true);
      expect(result.updated_fields).toContain("soul");

      const agentDir = path.join(tmpDir, "users", "default", "agents", "test-agent");
      expect(fs.readFileSync(path.join(agentDir, "SOUL.md"), "utf-8")).toBe("brand new soul");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("updates description only, preserving soul", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-agent-"));
    try {
      seedAgent(tmpDir, "test-agent", { name: "test-agent", description: "old desc" }, "keep this soul");

      const result = await invoke(
        tmpDir,
        { description: "new desc" },
        { agent_name: "test-agent" },
      );

      expect(result.ok).toBe(true);
      expect(result.updated_fields).toContain("description");

      const agentDir = path.join(tmpDir, "users", "default", "agents", "test-agent");
      expect(fs.readFileSync(path.join(agentDir, "SOUL.md"), "utf-8")).toBe("keep this soul");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("preserves non-managed fields (e.g. github bindings)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-agent-"));
    try {
      const githubBlock = {
        installation_id: 140594274,
        bot_login: "my-app-bot",
      };
      seedAgent(
        tmpDir,
        "test-agent",
        { name: "test-agent", description: "old desc", github: githubBlock },
        "soul",
      );

      const result = await invoke(
        tmpDir,
        { description: "refined desc" },
        { agent_name: "test-agent" },
      );

      expect(result.ok).toBe(true);

      const agentDir = path.join(tmpDir, "users", "default", "agents", "test-agent");
      const configRaw = fs.readFileSync(path.join(agentDir, "config.yaml"), "utf-8");
      // The github field should be preserved in some form (YAML parse check).
      expect(configRaw).toContain("github");
      expect(configRaw).toContain("140594274");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("skills=[] disables all skills", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-agent-"));
    try {
      seedAgent(
        tmpDir,
        "test-agent",
        { name: "test-agent", skills: ["a", "b"] },
        "soul",
      );

      const result = await invoke(
        tmpDir,
        { skills: [] },
        { agent_name: "test-agent" },
      );

      expect(result.ok).toBe(true);
      expect(result.updated_fields).toContain("skills");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("omitting skills preserves the existing whitelist", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-agent-"));
    try {
      seedAgent(
        tmpDir,
        "test-agent",
        { name: "test-agent", description: "old", skills: ["alpha", "beta"] },
        "soul",
      );

      const result = await invoke(
        tmpDir,
        { description: "bumped" },
        { agent_name: "test-agent" },
      );

      expect(result.ok).toBe(true);

      const agentDir = path.join(tmpDir, "users", "default", "agents", "test-agent");
      const configRaw = fs.readFileSync(path.join(agentDir, "config.yaml"), "utf-8");
      expect(configRaw).toContain("alpha");
      expect(configRaw).toContain("beta");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns no-op message when values match existing", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-agent-"));
    try {
      seedAgent(
        tmpDir,
        "test-agent",
        { name: "test-agent", description: "same" },
        "soul",
      );

      const result = await invoke(
        tmpDir,
        { description: "same" },
        { agent_name: "test-agent" },
      );

      expect(result.ok).toBe(true);
      expect(result.message).toContain("No changes applied");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses on webhook channel (github)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-agent-"));
    try {
      const agentDir = seedAgent(
        tmpDir,
        "test-agent",
        { name: "test-agent", description: "seeded" },
        "seeded soul",
      );

      const result = await invoke(
        tmpDir,
        { description: "hijacked", soul: "malicious content" },
        { agent_name: "test-agent", channel_name: "github" },
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain("github");
      expect(result.error).toContain("operator-trusted");

      // Filesystem must be untouched.
      expect(fs.readFileSync(path.join(agentDir, "SOUL.md"), "utf-8")).toBe("seeded soul");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("proceeds on non-webhook channel (telegram)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-agent-"));
    try {
      seedAgent(
        tmpDir,
        "test-agent",
        { name: "test-agent", description: "seeded" },
        "soul",
      );

      const result = await invoke(
        tmpDir,
        { description: "bumped" },
        { agent_name: "test-agent", channel_name: "telegram" },
      );

      expect(result.ok).toBe(true);

      const agentDir = path.join(tmpDir, "users", "default", "agents", "test-agent");
      const configRaw = fs.readFileSync(path.join(agentDir, "config.yaml"), "utf-8");
      expect(configRaw).toContain("bumped");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects unknown model names", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-agent-"));
    try {
      seedAgent(
        tmpDir,
        "test-agent",
        { name: "test-agent", description: "desc", model: "gpt-4" },
        "soul",
      );

      const result = await invoke(
        tmpDir,
        { model: "nonexistent-model-xyz" },
        { agent_name: "test-agent" },
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Unknown model");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("enforces per-user isolation", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "update-agent-"));
    try {
      // Seed agents for two different users.
      const aliceDir = seedAgent(
        tmpDir,
        "shared",
        { name: "shared", description: "alice-desc" },
        "alice soul",
        "alice",
      );
      const bobDir = seedAgent(
        tmpDir,
        "shared",
        { name: "shared", description: "bob-desc" },
        "bob soul",
        "bob",
      );

      // Alice updates her agent.
      const result = await invoke(
        tmpDir,
        { description: "alice-bumped" },
        { agent_name: "shared", user_id: "alice" },
      );

      expect(result.ok).toBe(true);

      // Bob's agent must be untouched.
      const bobConfigRaw = fs.readFileSync(path.join(bobDir, "config.yaml"), "utf-8");
      expect(bobConfigRaw).toContain("bob-desc");
      expect(fs.readFileSync(path.join(bobDir, "SOUL.md"), "utf-8")).toBe("bob soul");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
