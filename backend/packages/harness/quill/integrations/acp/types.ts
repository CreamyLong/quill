/**
 * ACP (Agent Client Protocol) type definitions.
 *
 * Defines the message contract between an IDE client and Quill's ACP server.
 */

/** A message in an ACP session. */
export interface AcpMessage {
  /** Unique message ID. */
  id: string;
  /** Message role. */
  role: "user" | "assistant" | "system";
  /** Message content. */
  content: string;
  /** Timestamp. */
  timestamp: string;
  /** For assistant messages: tool calls made. */
  toolCalls?: AcpToolCall[];
  /** For tool messages: the tool result. */
  toolResult?: AcpToolResult;
}

export interface AcpToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AcpToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

/** ACP session state. */
export interface AcpSession {
  /** Session ID. */
  id: string;
  /** Session title (auto-generated from first message). */
  title: string;
  /** Current session status. */
  status: "idle" | "running" | "waiting_approval" | "stopped" | "error";
  /** Messages in this session. */
  messages: AcpMessage[];
  /** Pending tool approval requests. */
  pendingApprovals: AcpToolApproval[];
  /** Session metadata. */
  metadata: {
    createdAt: string;
    updatedAt: string;
    model?: string;
    threadId?: string;
  };
}

/** Tool approval request sent to the IDE. */
export interface AcpToolApproval {
  /** Approval request ID. */
  id: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  /** Human-readable description of what the tool will do. */
  description: string;
  /** Risk level for UI coloring. */
  riskLevel: "low" | "medium" | "high";
}

/** ACP JSON-RPC request envelope. */
export interface AcpRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

/** ACP JSON-RPC response envelope. */
export interface AcpResponse {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

/** ACP JSON-RPC notification (no response expected). */
export interface AcpNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

// ---- ACP Methods ----
export const ACP_METHODS = {
  // Session lifecycle
  SESSION_CREATE: "session/create",
  SESSION_RESUME: "session/resume",
  SESSION_STOP: "session/stop",
  SESSION_FORK: "session/fork",
  SESSION_LIST: "session/list",
  SESSION_STATUS: "session/status",

  // Messaging
  MESSAGE_SEND: "message/send",
  MESSAGE_STREAM: "message/stream",

  // Tool approval
  TOOL_APPROVE: "tool/approve",
  TOOL_REJECT: "tool/reject",

  // Capabilities
  CAPABILITIES_GET: "capabilities/get",
} as const;

export type AcpMethod = (typeof ACP_METHODS)[keyof typeof ACP_METHODS];
