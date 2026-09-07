/**
 * MCP server capability for Quill — dual-role architecture.
 *
 * Inspired by OpenClaw's MCP dual-role pattern: Quill is both an MCP client
 * (consuming external MCP servers) AND an MCP server (exposing its own
 * conversations and tools to external MCP clients like Claude Code, Codex, etc.).
 *
 * This module implements the server side: it exposes Quill's thread conversations,
 * run capabilities, and agent tools as MCP tools over stdio or HTTP transport.
 *
 * Bridge tools exposed:
 *   - conversations_list — list recent thread conversations
 *   - conversation_get   — fetch a thread's message history
 *   - messages_send      — send a message to a thread (creates a run)
 *   - messages_read      — read messages from a specific run
 *   - events_poll        — poll for run events (streaming status)
 *   - events_wait        — wait for the next run event (long-poll)
 *   - permissions_list   — list open permission requests
 *   - permissions_respond — respond to a permission request
 *
 * The server reads its configuration from the gateway deps (injected at startup)
 * and connects to the same in-memory / persistent stores the gateway uses.
 */

import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal thread summary for listing. */
export interface ConversationSummary {
  thread_id: string;
  title?: string | null;
  updated_at: string;
  message_count: number;
  status: string;
}

/** A single message in a conversation. */
export interface ConversationMessage {
  type: string;
  content: string;
  timestamp?: string;
  tool_calls?: Array<{ name: string; args: Record<string, unknown> }>;
}

/** Pollable event from a run. */
export interface RunEvent {
  seq: number;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

/** Permission request awaiting user response. */
export interface PermissionRequest {
  id: string;
  tool_name: string;
  thread_id: string;
  description: string;
  created_at: string;
}

/** Dependencies injected by the gateway to back the MCP server tools. */
export interface McpServerDeps {
  /** List recent conversations (threads). */
  listConversations: (limit?: number) => Promise<ConversationSummary[]>;
  /** Get a thread's messages. */
  getConversation: (threadId: string) => Promise<ConversationMessage[]>;
  /** Send a message to a thread and start a run. Returns the run ID. */
  sendMessage: (threadId: string, message: string) => Promise<{ run_id: string; thread_id: string }>;
  /** Read messages from a specific run. */
  readMessages: (runId: string, afterSeq?: number) => Promise<ConversationMessage[]>;
  /** Poll events for a run. */
  pollEvents: (runId: string, afterSeq?: number) => Promise<RunEvent[]>;
  /** Wait for new events (long-poll, returns when available or timeout). */
  waitEvents: (runId: string, afterSeq?: number, timeoutMs?: number) => Promise<RunEvent[]>;
  /** List pending permission requests. */
  listPermissions: () => Promise<PermissionRequest[]>;
  /** Respond to a permission request. */
  respondPermission: (id: string, approved: boolean, reason?: string) => Promise<boolean>;
  /** Optional: custom tool registry for additional MCP tools. */
  customTools?: Record<string, McpCustomTool>;
}

/** A custom tool registered via the MCP server. */
export interface McpCustomTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

/**
 * Create an MCP server instance backed by the gateway's stores.
 *
 * This factory wires the bridge tools into a McpServer. The caller is responsible
 * for connecting the server to a transport (stdio, SSE, or HTTP).
 *
 * @param deps - Gateway-injected data accessors.
 * @param serverName - Server name reported in the MCP handshake.
 * @returns The configured McpServer instance (not yet connected).
 */
export function createMcpServer(deps: McpServerDeps, serverName: string = "quill"): McpServer {
  // Dynamic import so the SDK is only loaded when the server is actually used.
  // The caller must have @modelcontextprotocol/sdk installed.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { McpServer: SdkMcpServer } = require("@modelcontextprotocol/sdk/server/mcp.js") as {
    McpServer: new (info: { name: string; version: string; capabilities: Record<string, unknown> }) => McpServer;
  };

  const server = new SdkMcpServer({
    name: serverName,
    version: "1.0.0",
    capabilities: {
      tools: {},
      resources: {},
      logging: {},
    },
  });

  // --- conversations_list ---
  server.registerTool(
    "conversations_list",
    {
      description: "List recent Quill conversation threads with metadata (id, title, updated_at, message_count, status).",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of conversations to return (default: 20).",
          },
        },
      } as Record<string, unknown>,
    },
    async (args: Record<string, unknown>) => {
      const limit = typeof args.limit === "number" ? Math.min(args.limit, 100) : 20;
      const conversations = await deps.listConversations(limit);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(conversations, null, 2) }],
      };
    }
  );

  // --- conversation_get ---
  server.registerTool(
    "conversation_get",
    {
      description: "Fetch the full message history of a Quill conversation thread.",
      inputSchema: {
        type: "object",
        properties: {
          thread_id: {
            type: "string",
            description: "The thread/conversation ID.",
          },
        },
        required: ["thread_id"],
      } as Record<string, unknown>,
    },
    async (args: Record<string, unknown>) => {
      const threadId = String(args.thread_id);
      const messages = await deps.getConversation(threadId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(messages, null, 2) }],
      };
    }
  );

  // --- messages_send ---
  server.registerTool(
    "messages_send",
    {
      description: "Send a message to a Quill conversation thread. Creates a new run and returns the run_id for polling.",
      inputSchema: {
        type: "object",
        properties: {
          thread_id: {
            type: "string",
            description: "The thread/conversation ID.",
          },
          message: {
            type: "string",
            description: "The user message to send.",
          },
        },
        required: ["thread_id", "message"],
      } as Record<string, unknown>,
    },
    async (args: Record<string, unknown>) => {
      const threadId = String(args.thread_id);
      const message = String(args.message);
      const result = await deps.sendMessage(threadId, message);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // --- messages_read ---
  server.registerTool(
    "messages_read",
    {
      description: "Read messages from a specific run, optionally after a sequence number for incremental reads.",
      inputSchema: {
        type: "object",
        properties: {
          run_id: {
            type: "string",
            description: "The run ID to read messages from.",
          },
          after_seq: {
            type: "number",
            description: "Only return messages after this sequence number (for incremental reads).",
          },
        },
        required: ["run_id"],
      } as Record<string, unknown>,
    },
    async (args: Record<string, unknown>) => {
      const runId = String(args.run_id);
      const afterSeq = typeof args.after_seq === "number" ? args.after_seq : undefined;
      const messages = await deps.readMessages(runId, afterSeq);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(messages, null, 2) }],
      };
    }
  );

  // --- events_poll ---
  server.registerTool(
    "events_poll",
    {
      description: "Poll for run events (streaming status, tool calls, assistant text deltas). Non-blocking.",
      inputSchema: {
        type: "object",
        properties: {
          run_id: {
            type: "string",
            description: "The run ID to poll events for.",
          },
          after_seq: {
            type: "number",
            description: "Only return events after this sequence number.",
          },
        },
        required: ["run_id"],
      } as Record<string, unknown>,
    },
    async (args: Record<string, unknown>) => {
      const runId = String(args.run_id);
      const afterSeq = typeof args.after_seq === "number" ? args.after_seq : undefined;
      const events = await deps.pollEvents(runId, afterSeq);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(events, null, 2) }],
      };
    }
  );

  // --- events_wait ---
  server.registerTool(
    "events_wait",
    {
      description: "Wait for new run events (long-poll). Returns when events are available or timeout elapses.",
      inputSchema: {
        type: "object",
        properties: {
          run_id: {
            type: "string",
            description: "The run ID to wait on.",
          },
          after_seq: {
            type: "number",
            description: "Wait for events after this sequence number.",
          },
          timeout_ms: {
            type: "number",
            description: "Maximum wait time in milliseconds (default: 30000, max: 120000).",
          },
        },
        required: ["run_id"],
      } as Record<string, unknown>,
    },
    async (args: Record<string, unknown>) => {
      const runId = String(args.run_id);
      const afterSeq = typeof args.after_seq === "number" ? args.after_seq : undefined;
      const timeoutMs = typeof args.timeout_ms === "number"
        ? Math.min(args.timeout_ms, 120000)
        : 30000;
      const events = await deps.waitEvents(runId, afterSeq, timeoutMs);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(events, null, 2) }],
      };
    }
  );

  // --- permissions_list ---
  server.registerTool(
    "permissions_list",
    {
      description: "List open permission requests awaiting user approval (e.g., tool guardrail denials).",
      inputSchema: {
        type: "object",
        properties: {},
      } as Record<string, unknown>,
    },
    async () => {
      const requests = await deps.listPermissions();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(requests, null, 2) }],
      };
    }
  );

  // --- permissions_respond ---
  server.registerTool(
    "permissions_respond",
    {
      description: "Approve or deny a permission request by ID.",
      inputSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The permission request ID.",
          },
          approved: {
            type: "boolean",
            description: "true to approve, false to deny.",
          },
          reason: {
            type: "string",
            description: "Optional reason for the decision.",
          },
        },
        required: ["id", "approved"],
      } as Record<string, unknown>,
    },
    async (args: Record<string, unknown>) => {
      const id = String(args.id);
      const approved = Boolean(args.approved);
      const reason = typeof args.reason === "string" ? args.reason : undefined;
      const success = await deps.respondPermission(id, approved, reason);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success, id, approved }, null, 2) }],
      };
    }
  );

  // --- custom tools ---
  if (deps.customTools) {
    for (const [name, tool] of Object.entries(deps.customTools)) {
      server.registerTool(
        name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
        tool.handler
      );
    }
  }

  return server;
}

// ---------------------------------------------------------------------------
// Transport helpers
// ---------------------------------------------------------------------------

/**
 * Stdio transport options for running the MCP server.
 */
export interface StdioTransportOptions {
  /** Called when the server starts listening. */
  onReady?: () => void;
  /** Called on transport error. */
  onError?: (err: Error) => void;
}

/**
 * Connect an MCP server to stdio transport.
 * This is the primary transport for editor integrations (Claude Code, Codex, etc.).
 *
 * @param server - The MCP server instance from createMcpServer.
 * @param options - Optional callbacks.
 */
export async function connectStdioTransport(
  server: McpServer,
  options: StdioTransportOptions = {}
): Promise<void> {
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
  options.onReady?.();
}

/**
 * Start the MCP server over HTTP+SSE on the given port.
 * Useful for remote MCP clients that connect over the network.
 *
 * @param server - The MCP server instance.
 * @param port - Port to listen on.
 * @param host - Host to bind (default: 127.0.0.1).
 */
export async function startHttpTransport(
  server: McpServer,
  port: number,
  host: string = "127.0.0.1"
): Promise<{ url: string; close: () => Promise<void> }> {
  const http = await import("node:http");
  const { SSEServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/sse.js"
  );

  const transports = new Map<string, InstanceType<typeof SSEServerTransport>>();

  const httpServer = http.createServer(async (req, res) => {
    if (req.url === "/sse") {
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);
      res.on("close", () => transports.delete(transport.sessionId));
      await server.connect(transport);
    } else if (req.url === "/messages" && req.method === "POST") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.writeHead(400);
        res.end("No transport found for session");
      }
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  const url = `http://${host}:${port}/sse`;

  return {
    url,
    close: async () => {
      for (const t of transports.values()) {
        await t.close().catch(() => {});
      }
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

export { randomUUID };
