/**
 * State Machine Guardrails — phase-dependent tool access.
 *
 * Inspired by the awesome-harness-engineering "State Machine Guardrails" pattern
 * and DeerFlow's pluggable authorization with per-role RBAC.
 *
 * The idea: constrain which tools the agent can call based on the current
 * workflow phase. This prevents the agent from, e.g., executing bash commands
 * during the planning phase or writing files during the research phase.
 *
 * Phases:
 *   planning      — read-only exploration, no mutations
 *   research      — web search + file reading, no writing
 *   implementation — full tool access for coding
 *   review        — read-only verification and testing
 *   cleanup       — limited destructive access for finalization
 *
 * Each phase declares which tool groups are allowed. Tools not in the allowed
 * set are hidden from the model's schema and blocked at execution time.
 *
 * Source patterns:
 * - awesome-harness-engineering: State Machine Guardrails
 * - DeerFlow 2.0: Pluggable authorization with per-role RBAC
 * - Codex CLI: Tool orchestrator with approval-sandbox-attempt-retry
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Workflow phases with increasing tool access.
 */
export type WorkflowPhase =
  | "planning"
  | "research"
  | "implementation"
  | "review"
  | "cleanup";

/**
 * Tool group identifiers.
 */
export type ToolGroup =
  | "read"         // file read, grep, ls, web search
  | "write"        // file write, edit, create
  | "execute"      // bash, sandbox
  | "web"          // web search, fetch
  | "memory"       // memory read/write
  | "skill"        // skill management
  | "subagent"     // task delegation
  | "mcp"          // external MCP tools
  | "admin"        // configuration, system
  | "vision";      // image viewing

/**
 * Phase definition: which tool groups are allowed.
 */
export interface PhaseDefinition {
  phase: WorkflowPhase;
  allowedGroups: ToolGroup[];
  description: string;
  /** Whether this phase can transition to any phase (false = ordered only). */
  allowAnyTransition: boolean;
  /** Phases this can transition to. */
  allowedTransitions: WorkflowPhase[];
}

/**
 * Tool group mapping for a specific tool name.
 */
export interface ToolGroupMapping {
  toolName: string;
  group: ToolGroup;
}

/**
 * Result of a phase-based tool check.
 */
export interface PhaseToolCheck {
  toolName: string;
  group: ToolGroup;
  allowed: boolean;
  phase: WorkflowPhase;
  reason: string;
}

// ---------------------------------------------------------------------------
// Phase Definitions
// ---------------------------------------------------------------------------

export const WORKFLOW_PHASES: Record<WorkflowPhase, PhaseDefinition> = {
  planning: {
    phase: "planning",
    allowedGroups: ["read", "web", "memory", "skill"],
    description: "Read-only exploration and planning. No mutations allowed.",
    allowAnyTransition: false,
    allowedTransitions: ["research", "implementation"],
  },
  research: {
    phase: "research",
    allowedGroups: ["read", "web", "memory", "skill", "mcp"],
    description: "Research phase: search, read, and gather information.",
    allowAnyTransition: false,
    allowedTransitions: ["planning", "implementation"],
  },
  implementation: {
    phase: "implementation",
    allowedGroups: ["read", "write", "execute", "web", "memory", "skill", "subagent", "mcp", "vision"],
    description: "Full implementation access. All tools available.",
    allowAnyTransition: true,
    allowedTransitions: ["planning", "research", "review", "cleanup"],
  },
  review: {
    phase: "review",
    allowedGroups: ["read", "web", "memory", "skill", "execute", "vision"],
    description: "Review and verification. Read and test, limited execution.",
    allowAnyTransition: false,
    allowedTransitions: ["implementation", "cleanup"],
  },
  cleanup: {
    phase: "cleanup",
    allowedGroups: ["read", "write", "execute", "memory", "skill"],
    description: "Finalization. Limited destructive access for cleanup.",
    allowAnyTransition: false,
    allowedTransitions: ["planning"],
  },
};

// ---------------------------------------------------------------------------
// Default Tool Group Mappings
// ---------------------------------------------------------------------------

export const DEFAULT_TOOL_GROUPS: Record<string, ToolGroup> = {
  // Read group
  read_file: "read",
  grep: "read",
  glob: "read",
  ls: "read",
  present_file: "read",
  list_dir: "read",

  // Write group
  write_file: "write",
  edit_file: "write",
  create_file: "write",
  delete_file: "write",
  apply_patch: "write",

  // Execute group
  bash: "execute",
  run_command: "execute",
  sandbox_exec: "execute",

  // Web group
  web_search: "web",
  web_fetch: "web",

  // Memory group
  memory_read: "memory",
  memory_write: "memory",

  // Skill group
  skill_manage: "skill",
  skill_search: "skill",
  tool_search: "skill",

  // Subagent group
  task: "subagent",
  delegate: "subagent",

  // Vision group
  view_image: "vision",
};

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------

export interface StateMachineState {
  currentPhase: WorkflowPhase;
  /** History of phase transitions. */
  transitions: Array<{
    from: WorkflowPhase;
    to: WorkflowPhase;
    timestamp: string;
    reason?: string;
  }>;
  /** Tools blocked in the current phase (for audit). */
  blockedAttempts: Array<{
    toolName: string;
    phase: WorkflowPhase;
    timestamp: string;
  }>;
}

/**
 * State machine guardrail manager.
 *
 * Tracks the current workflow phase and enforces tool access policies.
 */
export class StateMachineGuardrails {
  private state: StateMachineState;
  private toolGroups: Record<string, ToolGroup>;

  constructor(
    initialPhase: WorkflowPhase = "planning",
    toolGroups: Record<string, ToolGroup> = DEFAULT_TOOL_GROUPS,
  ) {
    this.toolGroups = toolGroups;
    this.state = {
      currentPhase: initialPhase,
      transitions: [],
      blockedAttempts: [],
    };
  }

  /**
   * Get the current phase.
   */
  getCurrentPhase(): WorkflowPhase {
    return this.state.currentPhase;
  }

  /**
   * Get the current state (for persistence).
   */
  getState(): StateMachineState {
    return { ...this.state };
  }

  /**
   * Restore state from a previously saved snapshot.
   */
  restoreState(state: StateMachineState): void {
    this.state = { ...state };
  }

  /**
   * Attempt to transition to a new phase.
   *
   * Returns true if the transition is allowed, false otherwise.
   */
  transitionTo(
    targetPhase: WorkflowPhase,
    reason?: string,
  ): { success: boolean; reason: string } {
    const currentDef = WORKFLOW_PHASES[this.state.currentPhase];

    // Check if transition is allowed
    if (
      !currentDef.allowAnyTransition &&
      !currentDef.allowedTransitions.includes(targetPhase)
    ) {
      return {
        success: false,
        reason: `Cannot transition from "${this.state.currentPhase}" to "${targetPhase}". Allowed: [${currentDef.allowedTransitions.join(", ")}]`,
      };
    }

    const from = this.state.currentPhase;
    this.state.currentPhase = targetPhase;
    this.state.transitions.push({
      from,
      to: targetPhase,
      timestamp: new Date().toISOString(),
      reason,
    });

    return { success: true, reason: `Transitioned from "${from}" to "${targetPhase}"` };
  }

  /**
   * Check if a tool is allowed in the current phase.
   */
  checkTool(toolName: string): PhaseToolCheck {
    const group = this.toolGroups[toolName];
    if (!group) {
      // Unknown tools default to allowed (defensive: don't break existing tools)
      return {
        toolName,
        group: "admin",
        allowed: true,
        phase: this.state.currentPhase,
        reason: `Unknown tool "${toolName}" — defaulting to allowed.`,
      };
    }

    const phaseDef = WORKFLOW_PHASES[this.state.currentPhase];
    const allowed = phaseDef.allowedGroups.includes(group);

    if (!allowed) {
      this.state.blockedAttempts.push({
        toolName,
        phase: this.state.currentPhase,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      toolName,
      group,
      allowed,
      phase: this.state.currentPhase,
      reason: allowed
        ? `"${toolName}" (${group}) allowed in "${this.state.currentPhase}".`
        : `"${toolName}" (${group}) blocked in "${this.state.currentPhase}". Phase allows: [${phaseDef.allowedGroups.join(", ")}].`,
    };
  }

  /**
   * Batch-check multiple tools for the current phase.
   */
  checkTools(toolNames: string[]): PhaseToolCheck[] {
    return toolNames.map((name) => this.checkTool(name));
  }

  /**
   * Get the allowed tool groups for the current phase.
   */
  getAllowedGroups(): ToolGroup[] {
    return WORKFLOW_PHASES[this.state.currentPhase].allowedGroups;
  }

  /**
   * Get the set of allowed tool names for the current phase.
   */
  getAllowedToolNames(allToolNames: string[]): string[] {
    const allowedGroups = new Set(this.getAllowedGroups());
    return allToolNames.filter((name) => {
      const group = this.toolGroups[name];
      return group && allowedGroups.has(group);
    });
  }

  /**
   * Register a custom tool group mapping.
   */
  registerToolGroup(toolName: string, group: ToolGroup): void {
    this.toolGroups[toolName] = group;
  }

  /**
   * Get blocked attempts for audit purposes.
   */
  getBlockedAttempts(): StateMachineState["blockedAttempts"] {
    return [...this.state.blockedAttempts];
  }
}

/**
 * Create a middleware-compatible function for phase-based tool filtering.
 *
 * Returns a filter function that can be applied to tool lists.
 */
export function createPhaseToolFilter(guardrails: StateMachineGuardrails) {
  return (toolNames: string[]): string[] => {
    return guardrails.getAllowedToolNames(toolNames);
  };
}
