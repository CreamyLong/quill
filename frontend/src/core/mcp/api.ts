import { fetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

import type { MCPConfig, ConversationalStep, McpServerDraft, UserTrustProfile, TraceInfo } from "./types";

export class MCPConfigRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "MCPConfigRequestError";
    this.status = status;
  }
  get isAdminRequired(): boolean {
    return this.status === 403;
  }
}

async function readErrorDetail(
  response: Response,
  fallback: string,
): Promise<string> {
  const error = (await response.json().catch(() => ({}))) as {
    detail?: unknown;
  };
  return typeof error.detail === "string" ? error.detail : fallback;
}

export async function loadMCPConfig() {
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/config`);
  if (!response.ok) {
    throw new MCPConfigRequestError(
      response.status,
      await readErrorDetail(response, "Failed to load MCP configuration"),
    );
  }
  return response.json() as Promise<MCPConfig>;
}

export async function updateMCPConfig(config: MCPConfig) {
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/config`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    throw new MCPConfigRequestError(
      response.status,
      await readErrorDetail(response, "Failed to update MCP configuration"),
    );
  }
  return response.json();
}

export interface MCPTestResult {
  connected: boolean;
  tools?: string[];
  toolCount?: number;
  error?: string;
}

export async function testMCPConnection(
  config: Record<string, unknown>,
): Promise<MCPTestResult> {
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/config/test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ config }),
  });
  if (!response.ok) {
    throw new MCPConfigRequestError(
      response.status,
      await readErrorDetail(response, "Failed to test MCP connection"),
    );
  }
  return (await response.json()) as MCPTestResult;
}

// ---------------------------------------------------------------------------
// Conversational MCP Configuration API
// ---------------------------------------------------------------------------

/**
 * Start a new conversational MCP server addition flow.
 */
export async function startMCPConvo(): Promise<ConversationalStep> {
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/convo/start`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new MCPConfigRequestError(
      response.status,
      await readErrorDetail(response, "Failed to start MCP conversation"),
    );
  }
  return (await response.json()) as ConversationalStep;
}

/**
 * Send a user response in the conversational MCP config flow.
 */
export async function sendMCPConvoResponse(
  stepId: string,
  choiceId: string,
  input?: string,
): Promise<ConversationalStep> {
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/convo/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step_id: stepId, choice_id: choiceId, input }),
  });
  if (!response.ok) {
    throw new MCPConfigRequestError(
      response.status,
      await readErrorDetail(response, "Failed to process MCP conversation response"),
    );
  }
  return (await response.json()) as ConversationalStep;
}

/**
 * Validate a draft MCP server configuration.
 */
export async function validateMCPDraft(
  draft: Partial<McpServerDraft>,
): Promise<{ valid: boolean; errors: string[] }> {
  const response = await fetch(`${getBackendBaseURL()}/api/mcp/convo/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!response.ok) {
    throw new MCPConfigRequestError(
      response.status,
      await readErrorDetail(response, "Failed to validate MCP draft"),
    );
  }
  return (await response.json()) as { valid: boolean; errors: string[] };
}

// ---------------------------------------------------------------------------
// Adaptive Permissions API
// ---------------------------------------------------------------------------

/**
 * Get the current user's trust profile and permission level.
 */
export async function getTrustProfile(): Promise<UserTrustProfile> {
  const response = await fetch(`${getBackendBaseURL()}/api/permissions/trust-profile`);
  if (!response.ok) {
    throw new MCPConfigRequestError(
      response.status,
      await readErrorDetail(response, "Failed to load trust profile"),
    );
  }
  return (await response.json()) as UserTrustProfile;
}

/**
 * Pin the user's permission level (manual override).
 */
export async function pinPermissionLevel(
  level: number,
): Promise<UserTrustProfile> {
  const response = await fetch(`${getBackendBaseURL()}/api/permissions/pin`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level }),
  });
  if (!response.ok) {
    throw new MCPConfigRequestError(
      response.status,
      await readErrorDetail(response, "Failed to pin permission level"),
    );
  }
  return (await response.json()) as UserTrustProfile;
}

// ---------------------------------------------------------------------------
// Trace Correlation API
// ---------------------------------------------------------------------------

/**
 * Get trace info for a specific run.
 */
export async function getRunTrace(runId: string): Promise<TraceInfo> {
  const response = await fetch(`${getBackendBaseURL()}/api/runs/${runId}/trace`);
  if (!response.ok) {
    throw new MCPConfigRequestError(
      response.status,
      await readErrorDetail(response, "Failed to get run trace"),
    );
  }
  return (await response.json()) as TraceInfo;
}
