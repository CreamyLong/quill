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