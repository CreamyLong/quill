/**
 * AcpServer — JSON-RPC server implementing the Agent Client Protocol.
 *
 * Provides a lightweight HTTP+WebSocket endpoint that IDE clients (Zed,
 * JetBrains, VS Code extensions) can connect to. The server bridges ACP
 * JSON-RPC requests to Quill's internal agent runtime.
 *
 * Wire format: JSON-RPC 2.0 over HTTP (POST for requests) + WebSocket
 * (for streaming notifications: message deltas, tool approvals, status).
 */

import type {
  AcpRequest,
  AcpResponse,
  AcpNotification,
  AcpSession,
  AcpMessage,
  AcpToolApproval,
} from "./types.js";
import { ACP_METHODS } from "./types.js";

export interface AcpServerOptions {
  /** Port to listen on. */
  port: number;
  /** Host to bind to. */
  host?: string;
  /** Whether to enable WebSocket streaming. */
  enableWebSocket?: boolean;
  /** Maximum sessions to keep in memory. */
  maxSessions?: number;
}

interface InternalSession {
  id: string;
  title: string;
  status: AcpSession["status"];
  messages: AcpMessage[];
  pendingApprovals: AcpToolApproval[];
  createdAt: string;
  updatedAt: string;
  threadId?: string;
}

const PROTOCOL_VERSION = "0.1.0";

export class AcpServer {
  private options: Required<AcpServerOptions>;
  private sessions = new Map<string, InternalSession>();
  private messageCounter = 0;

  constructor(options: AcpServerOptions) {
    this.options = {
      host: "127.0.0.1",
      enableWebSocket: true,
      maxSessions: 50,
      ...options,
    };
  }

  /**
   * Process an ACP JSON-RPC request and return a response.
   *
   * This is the core dispatch method — wire it to your HTTP handler.
   */
  async handleRequest(request: AcpRequest): Promise<AcpResponse> {
    const { id, method, params = {} } = request;

    try {
      let result: unknown;

      switch (method) {
        // ---- Session lifecycle ----
        case ACP_METHODS.SESSION_CREATE:
          result = await this.handleSessionCreate(params);
          break;
        case ACP_METHODS.SESSION_RESUME:
          result = await this.handleSessionResume(params);
          break;
        case ACP_METHODS.SESSION_STOP:
          result = await this.handleSessionStop(params);
          break;
        case ACP_METHODS.SESSION_FORK:
          result = await this.handleSessionFork(params);
          break;
        case ACP_METHODS.SESSION_LIST:
          result = await this.handleSessionList();
          break;
        case ACP_METHODS.SESSION_STATUS:
          result = await this.handleSessionStatus(params);
          break;

        // ---- Messaging ----
        case ACP_METHODS.MESSAGE_SEND:
          result = await this.handleMessageSend(params);
          break;
        case ACP_METHODS.MESSAGE_STREAM:
          result = await this.handleMessageStream(params);
          break;

        // ---- Tool approval ----
        case ACP_METHODS.TOOL_APPROVE:
          result = await this.handleToolApprove(params);
          break;
        case ACP_METHODS.TOOL_REJECT:
          result = await this.handleToolReject(params);
          break;

        // ---- Capabilities ----
        case ACP_METHODS.CAPABILITIES_GET:
          result = this.handleCapabilitiesGet();
          break;

        default:
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          };
      }

      return { jsonrpc: "2.0", id, result };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  /**
   * Create a notification for streaming to connected clients.
   */
  createNotification(method: string, params?: Record<string, unknown>): AcpNotification {
    return { jsonrpc: "2.0", method, params };
  }

  // ------------------------------------------------------------------
  // Session handlers
  // ------------------------------------------------------------------

  private async handleSessionCreate(params: Record<string, unknown>): Promise<AcpSession> {
    const title = (params.title as string) ?? "New Session";
    const sessionId = `acp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const session: InternalSession = {
      id: sessionId,
      title,
      status: "idle",
      messages: [],
      pendingApprovals: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.sessions.set(sessionId, session);
    this.evictOldSessions();

    return this.toAcpSession(session);
  }

  private async handleSessionResume(params: Record<string, unknown>): Promise<AcpSession> {
    const sessionId = params.sessionId as string;
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.status = "idle";
    session.updatedAt = new Date().toISOString();
    return this.toAcpSession(session);
  }

  private async handleSessionStop(params: Record<string, unknown>): Promise<{ stopped: boolean }> {
    const sessionId = params.sessionId as string;
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.status = "stopped";
    session.updatedAt = new Date().toISOString();
    return { stopped: true };
  }

  private async handleSessionFork(params: Record<string, unknown>): Promise<AcpSession> {
    const sourceId = params.sessionId as string;
    const source = this.sessions.get(sourceId);
    if (!source) {
      throw new Error(`Session not found: ${sourceId}`);
    }

    const newId = `acp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const forked: InternalSession = {
      id: newId,
      title: `${source.title} (fork)`,
      status: "idle",
      messages: [...source.messages],
      pendingApprovals: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.sessions.set(newId, forked);
    return this.toAcpSession(forked);
  }

  private async handleSessionList(): Promise<AcpSession[]> {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((s) => this.toAcpSession(s));
  }

  private async handleSessionStatus(params: Record<string, unknown>): Promise<AcpSession> {
    const sessionId = params.sessionId as string;
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return this.toAcpSession(session);
  }

  // ------------------------------------------------------------------
  // Messaging handlers
  // ------------------------------------------------------------------

  private async handleMessageSend(params: Record<string, unknown>): Promise<AcpMessage> {
    const sessionId = params.sessionId as string;
    const content = params.content as string;
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Add user message.
    const userMsg: AcpMessage = {
      id: `msg-${++this.messageCounter}`,
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };
    session.messages.push(userMsg);
    session.status = "running";
    session.updatedAt = new Date().toISOString();

    // In a full implementation, this would trigger the agent runtime.
    // For now, we acknowledge receipt — the gateway wires the actual call.
    return userMsg;
  }

  private async handleMessageStream(params: Record<string, unknown>): Promise<{ streamId: string }> {
    const sessionId = params.sessionId as string;
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return { streamId: `stream-${sessionId}-${Date.now()}` };
  }

  // ------------------------------------------------------------------
  // Tool approval handlers
  // ------------------------------------------------------------------

  private async handleToolApprove(params: Record<string, unknown>): Promise<{ approved: boolean }> {
    const sessionId = params.sessionId as string;
    const approvalId = params.approvalId as string;
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.pendingApprovals = session.pendingApprovals.filter(
      (a) => a.id !== approvalId,
    );
    if (session.pendingApprovals.length === 0 && session.status === "waiting_approval") {
      session.status = "running";
    }
    session.updatedAt = new Date().toISOString();

    return { approved: true };
  }

  private async handleToolReject(params: Record<string, unknown>): Promise<{ rejected: boolean }> {
    const sessionId = params.sessionId as string;
    const approvalId = params.approvalId as string;
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.pendingApprovals = session.pendingApprovals.filter(
      (a) => a.id !== approvalId,
    );
    if (session.pendingApprovals.length === 0 && session.status === "waiting_approval") {
      session.status = "idle";
    }
    session.updatedAt = new Date().toISOString();

    return { rejected: true };
  }

  // ------------------------------------------------------------------
  // Capabilities
  // ------------------------------------------------------------------

  private handleCapabilitiesGet(): Record<string, unknown> {
    return {
      protocol: "acp",
      version: PROTOCOL_VERSION,
      capabilities: {
        sessions: {
          create: true,
          resume: true,
          stop: true,
          fork: true,
          list: true,
        },
        messaging: {
          send: true,
          stream: this.options.enableWebSocket,
        },
        tools: {
          approval: true,
          riskLevels: ["low", "medium", "high"],
        },
        agent: {
          models: ["*"],
          features: ["sandbox", "memory", "subagents", "skills", "mcp"],
        },
      },
    };
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private toAcpSession(session: InternalSession): AcpSession {
    return {
      id: session.id,
      title: session.title,
      status: session.status,
      messages: session.messages,
      pendingApprovals: session.pendingApprovals,
      metadata: {
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        threadId: session.threadId,
      },
    };
  }

  private evictOldSessions(): void {
    if (this.sessions.size <= this.options.maxSessions) return;
    const sorted = Array.from(this.sessions.entries()).sort((a, b) =>
      a[1].updatedAt.localeCompare(b[1].updatedAt),
    );
    const toRemove = sorted.slice(0, sorted.length - this.options.maxSessions);
    for (const [id] of toRemove) {
      this.sessions.delete(id);
    }
  }
}
