/**
 * Hooks system — workspace lifecycle hooks with trust management.
 *
 * Inspired by ZCode's workspace hooks with config mutation and Kimi Code's
 * lifecycle hooks system (PreToolUse, PostToolUse, SessionStart, etc.).
 *
 * Workspace hooks are user-configurable scripts that run at specific points
 * in the agent lifecycle. They can:
 *   - Log events for auditing
 *   - Transform prompts or tool inputs
 *   - Block operations (pre_tool hooks can abort)
 *   - Trigger external integrations
 *   - Inject context into conversations
 *
 * Trust model:
 *   - System hooks: built-in, always trusted, cannot be disabled
 *   - Workspace hooks: user-configured, require trust grant
 *   - Plugin hooks: installed from plugins, trust inherited from plugin
 *
 * Source patterns:
 * - ZCode: Workspace hooks with config mutation and trust grants
 * - Kimi Code: 12+ lifecycle hook event types with blockable hooks
 * - OpenClaw: Plugin hooks with provenance verification
 * - Codex CLI: Tool orchestrator with approval-sandbox-attempt-retry
 */

// ---------------------------------------------------------------------------
// Hook events
// ---------------------------------------------------------------------------

/**
 * Hook event types — when in the agent lifecycle a hook fires.
 *
 * Mirrors Kimi Code's comprehensive hook event taxonomy.
 */
export type HookEvent =
  | "pre_model"         // Before LLM call (inspect/transform prompt)
  | "post_model"        // After LLM response (inspect/transform response)
  | "pre_tool"          // Before tool execution (gate/transform)
  | "post_tool"         // After tool result (audit/transform)
  | "session_start"     // New session created
  | "session_end"       // Session ends (normal termination)
  | "user_message"      // User sends a message
  | "assistant_message" // Assistant produces a message
  | "agent_start"       // Agent begins processing
  | "agent_end"         // Agent finishes processing
  | "on_error"          // Error occurs during processing
  | "subagent_start"    // Subagent spawned
  | "subagent_end";     // Subagent completes

/**
 * Trust level for a hook.
 */
export type HookTrustLevel =
  | "system"    // Built-in, always trusted
  | "workspace" // User-configured, trust grant required
  | "plugin"    // From a plugin, trust inherited
  | "untrusted"; // Not yet granted trust

/**
 * Hook configuration entry.
 */
export interface HookConfig {
  /** Unique hook identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description of what this hook does. */
  description: string;
  /** Events this hook listens to. */
  events: HookEvent[];
  /** Hook script or command to execute. */
  command: string;
  /** Working directory for the command. */
  workingDirectory?: string;
  /** Environment variables to pass. */
  environment?: Record<string, string>;
  /** Timeout in milliseconds. */
  timeoutMs?: number;
  /** Trust level. */
  trustLevel: HookTrustLevel;
  /** Whether the hook can block operations (abort). */
  canBlock: boolean;
  /** Whether the hook is currently enabled. */
  enabled: boolean;
  /** Execution order (lower = earlier). */
  priority: number;
  /** Error handling: "abort" | "warn" | "ignore". */
  onError: "abort" | "warn" | "ignore";
  /** Plugin that owns this hook (if from plugin). */
  pluginName?: string;
  /** Creation timestamp. */
  createdAt: string;
  /** Last modification timestamp. */
  updatedAt: string;
}

/**
 * Hook execution request — passed to the hook command.
 */
export interface HookRequest {
  /** The event that fired. */
  event: HookEvent;
  /** Thread/session ID. */
  threadId: string | null;
  /** User ID. */
  userId: string | null;
  /** Run ID. */
  runId: string | null;
  /** Timestamp of the event. */
  timestamp: string;
  /** Event-specific data. */
  data: Record<string, unknown>;
}

/**
 * Hook execution result — returned by the hook command.
 */
export interface HookResult {
  /** Whether the hook succeeded. */
  success: boolean;
  /** Whether to abort the current operation (pre_* hooks only). */
  abort?: boolean;
  /** Reason for abort. */
  abortReason?: string;
  /** Messages to inject into the conversation. */
  injectMessages?: Array<{ role: string; content: string }>;
  /** Tool input modifications (pre_tool hooks only). */
  toolModifications?: {
    toolName: string;
    modifiedArgs: Record<string, unknown>;
  };
  /** Prompt modifications (pre_model hooks only). */
  promptModifications?: {
    systemPromptAppend?: string;
    systemPromptPrepend?: string;
  };
  /** Metadata to record. */
  metadata?: Record<string, unknown>;
  /** Error message if failed. */
  error?: string;
}

/**
 * Hook execution record — for auditing.
 */
export interface HookExecutionRecord {
  hookId: string;
  hookName: string;
  event: HookEvent;
  threadId: string | null;
  timestamp: string;
  durationMs: number;
  success: boolean;
  aborted: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Trust management
// ---------------------------------------------------------------------------

/**
 * Trust grant for a workspace hook.
 */
export interface HookTrustGrant {
  hookId: string;
  /** Who granted trust. */
  grantedBy: string;
  /** When trust was granted. */
  grantedAt: string;
  /** Whether trust is permanent or session-only. */
  permanent: boolean;
  /** Optional expiry for session-only grants. */
  expiresAt?: string;
}

/**
 * Trust configuration for hooks.
 */
export interface HookTrustConfig {
  /** Whether to prompt for trust on new hooks. */
  promptOnNewHook: boolean;
  /** Whether to allow untrusted hooks to run (read-only). */
  allowUntrustedReadOnly: boolean;
  /** Default error behavior for untrusted hooks. */
  untrustedOnError: "abort" | "warn" | "ignore";
}

// ---------------------------------------------------------------------------
// Storage backend
// ---------------------------------------------------------------------------

/**
 * Storage backend for hook configuration.
 */
export interface HookStoreBackend {
  /** List all hook configurations. */
  list(): Promise<HookConfig[]>;
  /** Get a specific hook by ID. */
  get(id: string): Promise<HookConfig | null>;
  /** Save a hook configuration. */
  save(hook: HookConfig): Promise<void>;
  /** Delete a hook configuration. */
  remove(id: string): Promise<void>;
  /** List trust grants. */
  listTrustGrants(): Promise<HookTrustGrant[]>;
  /** Save a trust grant. */
  saveTrustGrant(grant: HookTrustGrant): Promise<void>;
  /** Revoke a trust grant. */
  revokeTrustGrant(hookId: string): Promise<void>;
}
