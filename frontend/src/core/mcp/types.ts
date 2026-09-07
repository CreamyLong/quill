export interface MCPServerConfig {
  enabled: boolean;
  type?: string;
  transport?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  description?: string;
  [key: string]: unknown;
}

export interface MCPConfig {
  mcp_servers?: Record<string, MCPServerConfig>;
  mcpServers?: Record<string, MCPServerConfig>;
}

// ---------------------------------------------------------------------------
// Conversational MCP Configuration types
// ---------------------------------------------------------------------------

export type McpTransportType = "stdio" | "sse" | "http" | "streamable_http";

export interface ConversationalChoice {
  id: string;
  label: string;
  description?: string;
  requiresInput?: boolean;
  inputType?: "text" | "password" | "command" | "url";
  inputPlaceholder?: string;
}

export interface ConversationalStep {
  id: string;
  action: "add_server" | "configure_server" | "authenticate" | "remove_server" | "test_connection" | "list_servers";
  phase: "select_transport" | "enter_details" | "authenticate" | "confirm" | "result";
  serverName?: string;
  draft?: Partial<McpServerDraft>;
  result?: {
    success: boolean;
    message: string;
    details?: Record<string, unknown>;
  };
  choices?: ConversationalChoice[];
}

export interface McpServerDraft {
  name: string;
  transport: McpTransportType;
  enabled: boolean;
  description?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Adaptive Permissions types
// ---------------------------------------------------------------------------

export type PermissionLevel = 0 | 1 | 2 | 3 | 4;

export const PERMISSION_LEVEL_LABELS: Record<PermissionLevel, string> = {
  0: "Strict",
  1: "Standard",
  2: "Relaxed",
  3: "Trusted",
  4: "Full",
};

export const PERMISSION_LEVEL_DESCRIPTIONS: Record<PermissionLevel, string> = {
  0: "Every destructive/external tool action requires explicit approval.",
  1: "Read-only tools auto-approved; destructive tools require approval.",
  2: "Read-only and idempotent tools auto-approved; destructive + external require approval.",
  3: "All tools except destructive are auto-approved.",
  4: "All tools auto-approved; only loop detection and budget guards remain.",
};

export interface UserTrustProfile {
  user_id: string;
  level: PermissionLevel;
  pinned_max_level?: PermissionLevel;
  session_count: number;
  total_tool_calls: number;
  successful_tool_calls: number;
  created_at: string;
  last_active_at: string;
  manual_override?: boolean;
}

// ---------------------------------------------------------------------------
// Trace Correlation types
// ---------------------------------------------------------------------------

export interface TraceInfo {
  trace_id: string;
  parent_trace_id?: string;
  subagent_name?: string;
}