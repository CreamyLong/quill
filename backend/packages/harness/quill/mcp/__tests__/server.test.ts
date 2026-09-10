/**
 * Tests for MCP dual-role server.
 *
 * The createMcpServer factory uses dynamic require() for the MCP SDK,
 * so we test the type contracts and the factory's exported interface
 * without instantiating the actual server (which requires the SDK).
 */

import { describe, expect, it } from "vitest";

import type {
  ConversationSummary,
  ConversationMessage,
  RunEvent,
  PermissionRequest,
  McpServerDeps,
  McpCustomTool,
} from "../server.js";

describe("MCP server types", () => {
  describe("ConversationSummary", () => {
    it("accepts a valid summary", () => {
      const summary: ConversationSummary = {
        thread_id: "thread-1",
        title: "Test Thread",
        updated_at: new Date().toISOString(),
        message_count: 5,
        status: "active",
      };
      expect(summary.thread_id).toBe("thread-1");
      expect(summary.message_count).toBe(5);
    });

    it("allows null title", () => {
      const summary: ConversationSummary = {
        thread_id: "thread-2",
        title: null,
        updated_at: new Date().toISOString(),
        message_count: 0,
        status: "completed",
      };
      expect(summary.title).toBeNull();
    });
  });

  describe("ConversationMessage", () => {
    it("accepts a message with tool calls", () => {
      const msg: ConversationMessage = {
        type: "ai",
        content: "Running command",
        timestamp: new Date().toISOString(),
        tool_calls: [{ name: "bash", args: { command: "ls" } }],
      };
      expect(msg.tool_calls?.length).toBe(1);
    });
  });

  describe("RunEvent", () => {
    it("accepts a valid event", () => {
      const event: RunEvent = {
        seq: 1,
        type: "tool_call",
        data: { tool: "bash" },
        timestamp: new Date().toISOString(),
      };
      expect(event.seq).toBe(1);
    });
  });

  describe("PermissionRequest", () => {
    it("accepts a valid permission request", () => {
      const req: PermissionRequest = {
        id: "perm-1",
        tool_name: "bash",
        thread_id: "thread-1",
        description: "Run rm -rf",
        created_at: new Date().toISOString(),
      };
      expect(req.tool_name).toBe("bash");
    });
  });

  describe("McpServerDeps contract", () => {
    it("can be implemented as mock deps", async () => {
      const mockDeps: McpServerDeps = {
        listConversations: async (limit = 20) => [],
        getConversation: async () => [],
        sendMessage: async (_tid, _msg) => ({ run_id: "run-1", thread_id: "thread-1" }),
        readMessages: async () => [],
        pollEvents: async () => [],
        waitEvents: async () => [],
        listPermissions: async () => [],
        respondPermission: async () => true,
      };

      const conversations = await mockDeps.listConversations(10);
      expect(conversations).toEqual([]);

      const result = await mockDeps.sendMessage("thread-1", "hello");
      expect(result.run_id).toBe("run-1");
    });
  });

  describe("McpCustomTool contract", () => {
    it("defines a custom tool interface", () => {
      const customTool: McpCustomTool = {
        name: "my_tool",
        description: "A custom tool",
        inputSchema: { type: "object", properties: { input: { type: "string" } } },
        handler: async (_args) => ({
          content: [{ type: "text" as const, text: "result" }],
        }),
      };
      expect(customTool.name).toBe("my_tool");
    });
  });
});
