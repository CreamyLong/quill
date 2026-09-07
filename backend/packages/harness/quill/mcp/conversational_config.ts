/**
 * Conversational MCP Configuration.
 *
 * Inspired by Kimi Code CLI's AI-native MCP configuration and OpenClaw's guided
 * setup wizard. Instead of hand-editing JSON, users can add, configure, authenticate,
 * and manage MCP servers through a structured conversational interface.
 *
 * The system exposes a set of "config actions" that the agent can invoke:
 *   - add_server: Guide the user through adding a new MCP server
 *   - configure_server: Modify an existing server's settings
 *   - authenticate: Run OAuth or token-based auth for a server
 *   - remove_server: Remove a server configuration
 *   - test_connection: Verify a server is reachable and its tools load
 *   - list_servers: Show configured servers with status
 *
 * Each action produces a structured "conversation step" that the frontend
 * renders as a form or confirmation dialog.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpTransportType = "stdio" | "sse" | "http" | "streamable_http";

/** A conversational step in the MCP configuration dialogue. */
export interface ConversationalStep {
  /** Unique step ID. */
  id: string;
  /** The action this step represents. */
  action: "add_server" | "configure_server" | "authenticate" | "remove_server" | "test_connection" | "list_servers";
  /** Current phase within the action. */
  phase: "select_transport" | "enter_details" | "authenticate" | "confirm" | "result";
  /** The server being configured (if applicable). */
  serverName?: string;
  /** Current draft configuration. */
  draft?: Partial<McpServerDraft>;
  /** For "result" phase: the outcome. */
  result?: {
    success: boolean;
    message: string;
    details?: Record<string, unknown>;
  };
  /** Available choices for the current phase (for UI rendering). */
  choices?: ConversationalChoice[];
}

/** A selectable choice in a conversational step. */
export interface ConversationalChoice {
  id: string;
  label: string;
  description?: string;
  /** Whether this choice requires further input. */
  requiresInput?: boolean;
  inputType?: "text" | "password" | "command" | "url";
  inputPlaceholder?: string;
}

/** Draft configuration for an MCP server. */
export interface McpServerDraft {
  name: string;
  transport: McpTransportType;
  enabled: boolean;
  description?: string;
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // sse / http
  url?: string;
  headers?: Record<string, string>;
}

/** Result of a server test. */
export interface ServerTestResult {
  name: string;
  reachable: boolean;
  toolsLoaded?: number;
  error?: string;
  toolNames?: string[];
  latencyMs?: number;
}

// ---------------------------------------------------------------------------
// Conversation state machine
// ---------------------------------------------------------------------------

/**
 * Create the initial "add server" conversation.
 */
export function startAddServerConversation(): ConversationalStep {
  return {
    id: `add-${Date.now()}`,
    action: "add_server",
    phase: "select_transport",
    draft: {
      enabled: true,
    },
    choices: [
      {
        id: "stdio",
        label: "Local command (stdio)",
        description: "Run a local MCP server process (e.g., npx, python).",
        requiresInput: true,
        inputType: "command",
        inputPlaceholder: "npx -y @modelcontextprotocol/server-filesystem",
      },
      {
        id: "sse",
        label: "Server-Sent Events (SSE)",
        description: "Connect to a remote MCP server via SSE transport.",
        requiresInput: true,
        inputType: "url",
        inputPlaceholder: "https://example.com/mcp/sse",
      },
      {
        id: "http",
        label: "Streamable HTTP",
        description: "Connect to a remote MCP server via streamable HTTP.",
        requiresInput: true,
        inputType: "url",
        inputPlaceholder: "https://example.com/mcp",
      },
    ],
  };
}

/**
 * Create the "list servers" conversation step.
 */
export function createListStep(
  servers: Array<{ name: string; transport: McpTransportType; enabled: boolean; reachable?: boolean }>
): ConversationalStep {
  return {
    id: `list-${Date.now()}`,
    action: "list_servers",
    phase: "result",
    result: {
      success: true,
      message: `${servers.length} server(s) configured.`,
      details: { servers },
    },
    choices: servers.map((s) => ({
      id: s.name,
      label: `${s.name} (${s.transport})${s.enabled ? "" : " [disabled]"}`,
      description: s.reachable !== undefined
        ? s.reachable ? "✓ Reachable" : "✗ Unreachable"
        : undefined,
    })),
  };
}

/**
 * Process a user response in the conversation and produce the next step.
 */
export function processConversationResponse(
  currentStep: ConversationalStep,
  selectedChoiceId: string,
  inputValue?: string
): ConversationalStep {
  const draft = currentStep.draft ?? {};

  switch (currentStep.action) {
    case "add_server":
      return processAddServerStep(currentStep, selectedChoiceId, inputValue);
    case "configure_server":
      return processConfigureStep(currentStep, selectedChoiceId, inputValue);
    default:
      return {
        ...currentStep,
        phase: "result",
        result: {
          success: false,
          message: `Unknown action: ${currentStep.action}`,
        },
      };
  }
}

function processAddServerStep(
  step: ConversationalStep,
  choiceId: string,
  inputValue?: string
): ConversationalStep {
  switch (step.phase) {
    case "select_transport": {
      const transport = choiceId as McpTransportType;
      const newDraft: Partial<McpServerDraft> = {
        ...step.draft,
        transport,
      };
      return {
        ...step,
        phase: "enter_details",
        draft: newDraft,
        choices: transport === "stdio"
          ? [
              {
                id: "command",
                label: "Server name",
                description: "A unique name for this MCP server.",
                requiresInput: true,
                inputType: "text",
                inputPlaceholder: "my-mcp-server",
              },
            ]
          : [
              {
                id: "url",
                label: "Server name",
                description: "A unique name for this MCP server.",
                requiresInput: true,
                inputType: "text",
                inputPlaceholder: "my-remote-server",
              },
            ],
      };
    }

    case "enter_details": {
      // Build the draft from the input.
      const name = inputValue ?? choiceId;
      const newDraft: Partial<McpServerDraft> = {
        ...step.draft,
        name,
      };

      return {
        ...step,
        phase: "confirm",
        serverName: name,
        draft: newDraft,
        choices: [
          {
            id: "confirm",
            label: "Add server",
            description: `Save and enable the "${name}" MCP server.`,
          },
          {
            id: "test_first",
            label: "Test connection first",
            description: "Verify the server is reachable before saving.",
          },
        ],
      };
    }

    case "confirm": {
      if (choiceId === "test_first") {
        return {
          ...step,
          phase: "result",
          result: {
            success: true,
            message: `Connection test for "${step.serverName}" initiated.`,
            details: { testPending: true },
          },
        };
      }
      return {
        ...step,
        phase: "result",
        result: {
          success: true,
          message: `MCP server "${step.serverName}" has been added.`,
          details: { draft: step.draft },
        },
      };
    }

    default:
      return step;
  }
}

function processConfigureStep(
  step: ConversationalStep,
  choiceId: string,
  inputValue?: string
): ConversationalStep {
  return {
    ...step,
    phase: "result",
    result: {
      success: true,
      message: `Server "${step.serverName}" updated.`,
      details: { field: choiceId, value: inputValue },
    },
  };
}

// ---------------------------------------------------------------------------
// Server testing
// ---------------------------------------------------------------------------

/**
 * Validate an MCP server draft configuration.
 * Returns a list of validation errors (empty if valid).
 */
export function validateMcpServerDraft(draft: Partial<McpServerDraft>): string[] {
  const errors: string[] = [];

  if (!draft.name || draft.name.trim().length === 0) {
    errors.push("Server name is required.");
  } else if (!/^[a-zA-Z0-9_-]+$/.test(draft.name)) {
    errors.push("Server name must contain only letters, numbers, hyphens, and underscores.");
  }

  if (!draft.transport) {
    errors.push("Transport type is required.");
    return errors;
  }

  if (draft.transport === "stdio") {
    if (!draft.command || draft.command.trim().length === 0) {
      errors.push("Command is required for stdio transport.");
    }
  } else if (draft.transport === "sse" || draft.transport === "http" || draft.transport === "streamable_http") {
    if (!draft.url || draft.url.trim().length === 0) {
      errors.push(`URL is required for ${draft.transport} transport.`);
    } else {
      try {
        const parsed = new URL(draft.url);
        if (!parsed.protocol.startsWith("http")) {
          errors.push("URL must use http:// or https:// protocol.");
        }
      } catch {
        errors.push("URL is not valid.");
      }
    }
  }

  return errors;
}

/**
 * Generate the config JSON for a validated MCP server draft.
 * This is what gets written to extensions_config.json.
 */
export function draftToServerConfig(draft: Partial<McpServerDraft>): Record<string, unknown> {
  const config: Record<string, unknown> = {
    enabled: draft.enabled ?? true,
  };

  if (draft.description) config.description = draft.description;

  if (draft.transport === "stdio") {
    config.transport = "stdio";
    if (draft.command) config.command = draft.command;
    if (draft.args && draft.args.length > 0) config.args = draft.args;
    if (draft.env && Object.keys(draft.env).length > 0) config.env = draft.env;
  } else {
    config.transport = draft.transport;
    if (draft.url) config.url = draft.url;
    if (draft.headers && Object.keys(draft.headers).length > 0) config.headers = draft.headers;
  }

  return config;
}
