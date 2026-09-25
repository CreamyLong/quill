/**
 * Hook configuration — create, validate, and manage hook configs.
 *
 * Inspired by ZCode's workspace hook config mutation and trust management.
 */

import type {
  HookConfig,
  HookEvent,
  HookTrustConfig,
  HookTrustGrant,
  HookTrustLevel,
} from "./types.js";

// ---------------------------------------------------------------------------
// Hook creation
// ---------------------------------------------------------------------------

/**
 * Options for creating a new hook.
 */
export interface CreateHookOptions {
  name: string;
  description?: string;
  events: HookEvent[];
  command: string;
  workingDirectory?: string;
  environment?: Record<string, string>;
  timeoutMs?: number;
  canBlock?: boolean;
  priority?: number;
  onError?: "abort" | "warn" | "ignore";
  trustLevel?: HookTrustLevel;
  pluginName?: string;
}

/**
 * Create a new hook configuration with sensible defaults.
 */
export function createHookConfig(options: CreateHookOptions): HookConfig {
  const now = new Date().toISOString();
  return {
    id: generateHookId(options.name),
    name: options.name,
    description: options.description ?? "",
    events: options.events,
    command: options.command,
    workingDirectory: options.workingDirectory,
    environment: options.environment,
    timeoutMs: options.timeoutMs ?? 30000,
    trustLevel: options.trustLevel ?? "workspace",
    canBlock: options.canBlock ?? false,
    enabled: false, // Start disabled until trusted
    priority: options.priority ?? 100,
    onError: options.onError ?? "warn",
    pluginName: options.pluginName,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Generate a unique hook ID from a name.
 */
function generateHookId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Result of hook configuration validation.
 */
export interface HookValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a hook configuration.
 */
export function validateHookConfig(config: HookConfig): HookValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!config.name || config.name.trim().length === 0) {
    errors.push("Hook name is required");
  }

  if (!config.command || config.command.trim().length === 0) {
    errors.push("Hook command is required");
  }

  if (!config.events || config.events.length === 0) {
    errors.push("At least one event is required");
  }

  // Validate events
  const validEvents: HookEvent[] = [
    "pre_model", "post_model", "pre_tool", "post_tool",
    "session_start", "session_end", "user_message", "assistant_message",
    "agent_start", "agent_end", "on_error", "subagent_start", "subagent_end",
  ];

  if (config.events) {
    for (const event of config.events) {
      if (!validEvents.includes(event)) {
        errors.push(`Invalid event type: "${event}"`);
      }
    }
  }

  // pre_tool hooks should have canBlock if they want to abort
  if (config.events?.includes("pre_tool") && !config.canBlock) {
    warnings.push("pre_tool hooks without canBlock=true cannot abort tool execution");
  }

  // Timeout validation
  if (config.timeoutMs !== undefined && config.timeoutMs <= 0) {
    errors.push("timeoutMs must be positive");
  }

  // System hooks should have canBlock
  if (config.trustLevel === "system" && !config.canBlock) {
    warnings.push("System hooks typically should have canBlock=true");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Trust management
// ---------------------------------------------------------------------------

/**
 * Default trust configuration.
 */
export const DEFAULT_TRUST_CONFIG: HookTrustConfig = {
  promptOnNewHook: true,
  allowUntrustedReadOnly: true,
  untrustedOnError: "warn",
};

/**
 * Create a trust grant for a hook.
 */
export function createTrustGrant(
  hookId: string,
  grantedBy: string,
  permanent = true,
): HookTrustGrant {
  return {
    hookId,
    grantedBy,
    grantedAt: new Date().toISOString(),
    permanent,
  };
}

/**
 * Check if a hook is currently trusted.
 */
export function isHookTrusted(
  config: HookConfig,
  grants: HookTrustGrant[],
): boolean {
  // System hooks are always trusted
  if (config.trustLevel === "system") return true;

  // Plugin hooks inherit trust from plugin
  if (config.trustLevel === "plugin") return true;

  // Check for valid trust grant
  const now = Date.now();
  for (const grant of grants) {
    if (grant.hookId !== config.id) continue;
    if (grant.permanent) return true;
    if (grant.expiresAt && new Date(grant.expiresAt).getTime() > now) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Built-in hooks
// ---------------------------------------------------------------------------

/**
 * Create the built-in audit hook.
 */
export function createBuiltinAuditHook(): HookConfig {
  return createHookConfig({
    name: "Built-in Audit Log",
    description: "Logs all tool calls and session events for auditing",
    events: ["pre_tool", "session_start", "session_end", "on_error"],
    command: "builtin:audit",
    canBlock: false,
    priority: 1000, // Run last
    onError: "ignore",
    trustLevel: "system",
  });
}

/**
 * Create the built-in rate limit hook.
 */
export function createBuiltinRateLimitHook(maxToolCallsPerMinute = 60): HookConfig {
  return {
    ...createHookConfig({
      name: "Built-in Rate Limiter",
      description: `Limits tool calls to ${maxToolCallsPerMinute} per minute`,
      events: ["pre_tool"],
      command: "builtin:rate-limit",
      canBlock: true,
      priority: 1, // Run first
      onError: "abort",
      trustLevel: "system",
    }),
    // Store config in environment for the built-in handler
    environment: { MAX_CALLS_PER_MINUTE: String(maxToolCallsPerMinute) },
  };
}

/**
 * Get all built-in hooks.
 */
export function getBuiltinHooks(): HookConfig[] {
  return [
    createBuiltinAuditHook(),
    createBuiltinRateLimitHook(),
  ];
}
