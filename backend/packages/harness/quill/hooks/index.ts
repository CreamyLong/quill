/**
 * Hooks system — workspace lifecycle hooks with trust management.
 *
 * Inspired by ZCode's workspace hooks with config mutation and Kimi Code's
 * lifecycle hooks system.
 *
 * Features:
 *   - 13 hook event types covering the full agent lifecycle
 *   - Trust management (system, workspace, plugin, untrusted)
 *   - Blockable hooks for pre_* events
 *   - Tool input modifications and prompt modifications
 *   - Execution history and auditing
 *   - Built-in hooks (audit log, rate limiter)
 */

export {
  type HookEvent,
  type HookTrustLevel,
  type HookConfig,
  type HookRequest,
  type HookResult,
  type HookExecutionRecord,
  type HookTrustGrant,
  type HookTrustConfig,
  type HookStoreBackend,
} from "./types.js";

export {
  MemoryHookStoreBackend,
  type HookChainResult,
  HookEngine,
  getHookEngine,
  resetHookEngine,
} from "./hooks.js";

export {
  type CreateHookOptions,
  createHookConfig,
  type HookValidationResult,
  validateHookConfig,
  DEFAULT_TRUST_CONFIG,
  createTrustGrant,
  isHookTrusted,
  createBuiltinAuditHook,
  createBuiltinRateLimitHook,
  getBuiltinHooks,
} from "./config.js";
