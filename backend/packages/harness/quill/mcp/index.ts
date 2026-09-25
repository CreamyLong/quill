/**
 * MCP (Model Context Protocol) integration for Quill.
 *
 * Dual-role architecture:
 *   - client.ts: Quill as MCP client (consuming external MCP servers)
 *   - server.ts: Quill as MCP server (exposing conversations to external clients)
 *   - conversational_config.ts: Guided dialogue for MCP server setup
 *   - cache.ts: Tool caching with mtime invalidation
 *   - session_manager.ts: Per-user/per-thread stdio session scoping
 *   - oauth.ts: OAuth flow for HTTP/SSE servers
 *   - interceptors.ts: Before/after tool-call hooks
 *   - path_rewrite.ts: Local filesystem path → sandbox virtual path
 */

export * from "./client.js";
export * from "./cache.js";
export * from "./session_manager.js";
export * from "./oauth.js";
export * from "./interceptors.js";
export * from "./path_rewrite.js";
export * from "./server.js";
export * from "./conversational_config.js";

// Universal MCP Rail (v0.5.0)
export * from "./rail_types.js";
export * from "./capability_registry.js";
