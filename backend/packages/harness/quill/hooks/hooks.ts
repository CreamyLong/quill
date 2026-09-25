/**
 * Hook engine — registration, execution, and lifecycle integration.
 *
 * Inspired by ZCode's workspace hook config mutation and Kimi Code's
 * lifecycle hook system with blockable hooks and tool modifications.
 *
 * Hooks execute sequentially within each event phase. A hook that throws
 * or returns abort=true (for pre_* hooks) stops the chain and aborts the
 * current operation.
 */

import type {
  HookConfig,
  HookEvent,
  HookExecutionRecord,
  HookRequest,
  HookResult,
  HookStoreBackend,
  HookTrustGrant,
} from "./types.js";

// ---------------------------------------------------------------------------
// In-memory store (default)
// ---------------------------------------------------------------------------

/**
 * In-memory hook store backend.
 */
export class MemoryHookStoreBackend implements HookStoreBackend {
  private hooks = new Map<string, HookConfig>();
  private trustGrants = new Map<string, HookTrustGrant>();

  async list(): Promise<HookConfig[]> {
    return [...this.hooks.values()];
  }

  async get(id: string): Promise<HookConfig | null> {
    return this.hooks.get(id) ?? null;
  }

  async save(hook: HookConfig): Promise<void> {
    this.hooks.set(hook.id, hook);
  }

  async remove(id: string): Promise<void> {
    this.hooks.delete(id);
    this.trustGrants.delete(id);
  }

  async listTrustGrants(): Promise<HookTrustGrant[]> {
    return [...this.trustGrants.values()];
  }

  async saveTrustGrant(grant: HookTrustGrant): Promise<void> {
    this.trustGrants.set(grant.hookId, grant);
  }

  async revokeTrustGrant(hookId: string): Promise<void> {
    this.trustGrants.delete(hookId);
  }
}

// ---------------------------------------------------------------------------
// Hook engine
// ---------------------------------------------------------------------------

/**
 * Result of executing a chain of hooks for an event.
 */
export interface HookChainResult {
  /** Whether the chain completed without abort. */
  completed: boolean;
  /** Whether the operation should be aborted. */
  aborted: boolean;
  /** Reason for abort. */
  abortReason?: string;
  /** Messages to inject into the conversation. */
  injectMessages: Array<{ role: string; content: string }>;
  /** Tool modifications to apply. */
  toolModifications: Array<{ toolName: string; modifiedArgs: Record<string, unknown> }>;
  /** Prompt modifications to apply. */
  promptModifications: {
    systemPromptAppend: string[];
    systemPromptPrepend: string[];
  };
  /** Execution records for auditing. */
  executionRecords: HookExecutionRecord[];
}

/**
 * Hook engine — manages hook registration and execution.
 */
export class HookEngine {
  private backend: HookStoreBackend;
  private executionHistory: HookExecutionRecord[] = [];
  private maxHistorySize = 1000;

  constructor(backend?: HookStoreBackend) {
    this.backend = backend ?? new MemoryHookStoreBackend();
  }

  // ------------------------------------------------------------------
  // Registration
  // ------------------------------------------------------------------

  /**
   * Register a new hook.
   */
  async registerHook(config: HookConfig): Promise<void> {
    await this.backend.save(config);
  }

  /**
   * Unregister a hook.
   */
  async unregisterHook(id: string): Promise<void> {
    await this.backend.remove(id);
  }

  /**
   * Get a specific hook configuration.
   */
  async getHook(id: string): Promise<HookConfig | null> {
    return this.backend.get(id);
  }

  /**
   * List all registered hooks.
   */
  async listHooks(): Promise<HookConfig[]> {
    return this.backend.list();
  }

  /**
   * List hooks for a specific event.
   */
  async listHooksForEvent(event: HookEvent): Promise<HookConfig[]> {
    const all = await this.backend.list();
    return all
      .filter((h) => h.enabled && h.events.includes(event))
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Enable a hook.
   */
  async enableHook(id: string): Promise<boolean> {
    const hook = await this.backend.get(id);
    if (!hook) return false;
    hook.enabled = true;
    hook.updatedAt = new Date().toISOString();
    await this.backend.save(hook);
    return true;
  }

  /**
   * Disable a hook.
   */
  async disableHook(id: string): Promise<boolean> {
    const hook = await this.backend.get(id);
    if (!hook) return false;
    hook.enabled = false;
    hook.updatedAt = new Date().toISOString();
    await this.backend.save(hook);
    return true;
  }

  // ------------------------------------------------------------------
  // Execution
  // ------------------------------------------------------------------

  /**
   * Fire an event, executing all registered hooks in priority order.
   *
   * Hooks execute sequentially. If a hook returns abort=true (pre_* hooks),
   * the chain stops and the operation is aborted.
   */
  async fireEvent(
    event: HookEvent,
    request: HookRequest,
  ): Promise<HookChainResult> {
    const hooks = await this.listHooksForEvent(event);
    const result: HookChainResult = {
      completed: true,
      aborted: false,
      injectMessages: [],
      toolModifications: [],
      promptModifications: { systemPromptAppend: [], systemPromptPrepend: [] },
      executionRecords: [],
    };

    for (const hook of hooks) {
      const startTime = Date.now();
      let hookResult: HookResult;

      try {
        hookResult = await this.executeHook(hook, request);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        hookResult = { success: false, error: errorMessage };

        // Handle error based on hook configuration
        if (hook.onError === "abort") {
          result.aborted = true;
          result.abortReason = `Hook "${hook.name}" error: ${errorMessage}`;
          result.executionRecords.push(this.createRecord(hook, request, startTime, false, false, errorMessage));
          result.completed = false;
          return result;
        }
        // "warn" and "ignore" continue the chain
        if (hook.onError === "warn") {
          console.warn(`[HookEngine] Hook "${hook.name}" error: ${errorMessage}`);
        }
      }

      const durationMs = Date.now() - startTime;
      result.executionRecords.push(
        this.createRecord(hook, request, startTime, hookResult.success, hookResult.abort ?? false, hookResult.error),
      );

      // Collect results
      if (hookResult.injectMessages) {
        result.injectMessages.push(...hookResult.injectMessages);
      }

      if (hookResult.toolModifications) {
        result.toolModifications.push(hookResult.toolModifications);
      }

      if (hookResult.promptModifications) {
        if (hookResult.promptModifications.systemPromptAppend) {
          result.promptModifications.systemPromptAppend.push(hookResult.promptModifications.systemPromptAppend);
        }
        if (hookResult.promptModifications.systemPromptPrepend) {
          result.promptModifications.systemPromptPrepend.push(hookResult.promptModifications.systemPromptPrepend);
        }
      }

      // Check for abort (only pre_* hooks can abort)
      if (hookResult.abort && hook.canBlock && event.startsWith("pre_")) {
        result.aborted = true;
        result.abortReason = hookResult.abortReason ?? `Hook "${hook.name}" requested abort`;
        result.completed = false;
        return result;
      }
    }

    return result;
  }

  // ------------------------------------------------------------------
  // Execution history
  // ------------------------------------------------------------------

  /**
   * Get execution history for a thread.
   */
  getExecutionHistory(threadId: string | null, limit = 100): HookExecutionRecord[] {
    let records = this.executionHistory;
    if (threadId) {
      records = records.filter((r) => r.threadId === threadId);
    }
    return records.slice(-limit);
  }

  /**
   * Clear execution history.
   */
  clearHistory(): void {
    this.executionHistory = [];
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  /**
   * Execute a single hook.
   *
   * In a full implementation, this would run the hook's command in a sandboxed
   * subprocess and parse the JSON result. For now, this is a stub that returns
   * a successful result — the actual command execution is platform-specific.
   */
  private async executeHook(config: HookConfig, request: HookRequest): Promise<HookResult> {
    // In production, this would:
    // 1. Serialize the request as JSON
    // 2. Spawn the config.command process with the request as stdin
    // 3. Set environment variables and working directory
    // 4. Apply the timeout
    // 5. Parse the JSON result from stdout

    // Stub implementation — logs and returns success
    console.debug(`[HookEngine] Executing hook "${config.name}" for event "${request.event}"`);
    return { success: true };
  }

  private createRecord(
    hook: HookConfig,
    request: HookRequest,
    startTime: number,
    success: boolean,
    aborted: boolean,
    error?: string,
  ): HookExecutionRecord {
    const record: HookExecutionRecord = {
      hookId: hook.id,
      hookName: hook.name,
      event: request.event,
      threadId: request.threadId,
      timestamp: request.timestamp,
      durationMs: Date.now() - startTime,
      success,
      aborted,
      error,
    };

    this.executionHistory.push(record);
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory = this.executionHistory.slice(-this.maxHistorySize);
    }

    return record;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let globalHookEngine: HookEngine | null = null;

/**
 * Get the global hook engine instance.
 */
export function getHookEngine(): HookEngine {
  if (!globalHookEngine) {
    globalHookEngine = new HookEngine();
  }
  return globalHookEngine;
}

/**
 * Reset the global hook engine (for testing).
 */
export function resetHookEngine(): void {
  globalHookEngine = null;
}
