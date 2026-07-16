/**
 * MCP API request/response contracts.
 */

export type McpServerType = "stdio" | "sse" | "http";
export type McpOAuthGrantType = "client_credentials" | "refresh_token";

export interface McpOAuthConfigResponse {
  enabled?: boolean;
  token_url?: string;
  grant_type?: McpOAuthGrantType;
  client_id?: string | null;
  client_secret?: string | null;
  refresh_token?: string | null;
  scope?: string | null;
  audience?: string | null;
  token_field?: string;
  token_type_field?: string;
  expires_in_field?: string;
  default_token_type?: string;
  refresh_skew_seconds?: number;
  extra_token_params?: Record<string, string>;
}

export interface McpServerConfigResponse {
  enabled?: boolean;
  type?: McpServerType;
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  url?: string | null;
  headers?: Record<string, string>;
  oauth?: McpOAuthConfigResponse | null;
  description?: string;
}

export interface McpConfigResponse {
  mcp_servers: Record<string, McpServerConfigResponse>;
}

export interface McpConfigUpdateRequest {
  mcp_servers: Record<string, McpServerConfigResponse>;
}

export interface McpCacheResetResponse {
  success: boolean;
  message: string;
}
