/**
 * ACP (Agent Client Protocol) Adapter — IDE integration bridge.
 *
 * Inspired by Kimi Code CLI's ACP adapter: implements the Agent Client
 * Protocol for IDE integration (Zed, JetBrains, VS Code). This allows
 * external editors to drive Quill sessions via a standardized JSON-RPC
 * interface.
 *
 * The adapter exposes:
 * - Session lifecycle (create, resume, stop, fork)
 * - Message submission with streaming
 * - Tool approval flow
 * - Session status & health queries
 *
 * @module integrations/acp
 */

export { AcpServer, type AcpServerOptions } from "./server.js";
export { type AcpSession, type AcpMessage, type AcpToolApproval } from "./types.js";
