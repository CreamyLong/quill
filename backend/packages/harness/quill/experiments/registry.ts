/**
 * Experiment Registry — unified algorithm interfaces + registration.
 *
 * Researchers can swap algorithm implementations at runtime by registering
 * multiple variants under the same algorithm key, then selecting which one
 * to use via experiment configuration. This enables rapid A/B testing,
 * benchmark comparison, and hot-swapping of agent algorithm modules.
 *
 * The registry is the single source of truth for:
 *   - Which algorithm modules exist (classifier, coordinator, reviewer, etc.)
 *   - Which variants are available for each module
 *   - Which variant is currently active
 *   - How to instantiate a variant from config
 *
 * @module experiments/registry
 */

// ---------------------------------------------------------------------------
// Core Types
// ---------------------------------------------------------------------------

/** All swappable algorithm module keys. */
export type AlgorithmModuleKey =
  | "classifier"
  | "coordinator"
  | "reviewer"
  | "compaction"
  | "contextBuilder"
  | "toolSelector"
  | "goalJudge"
  | "memoryConsolidator";

/** A single variant metadata entry. */
export interface VariantInfo {
  /** Unique variant name (e.g., "v2", "experimental", "baseline"). */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Optional tags for filtering/grouping. */
  tags?: string[];
}

/** Registration entry for one algorithm module. */
export interface AlgorithmRegistration {
  /** The module key this registration belongs to. */
  key: AlgorithmModuleKey;
  /** All available variants for this module. */
  variants: VariantInfo[];
  /** The currently active variant name. */
  activeVariant: string;
  /** Factory to create the active variant's implementation. */
  create: (variantName: string) => AlgorithmModule;
}

/** The unified algorithm module interface — every swappable algorithm implements this. */
export interface AlgorithmModule {
  /** The module key. */
  readonly key: AlgorithmModuleKey;
  /** The variant name. */
  readonly variant: string;
  /** Initialize the module (called once on activation). */
  init?(config: Record<string, unknown>): void | Promise<void>;
  /** Execute the module's primary function. */
  execute(input: AlgorithmInput): Promise<AlgorithmOutput>;
  /** Collect metrics from this module's execution. */
  collectMetrics(): ModuleMetrics;
  /** Shutdown the module (called on deactivation). */
  destroy?(): void | Promise<void>;
}

/** Input passed to an algorithm module. */
export interface AlgorithmInput {
  /** The input data (task description, messages, tool results, etc.). */
  data: unknown;
  /** Context metadata (thread ID, user ID, run ID, etc.). */
  context: Record<string, unknown>;
  /** Configuration overrides for this execution. */
  config?: Record<string, unknown>;
}

/** Output returned from an algorithm module. */
export interface AlgorithmOutput {
  /** The result data. */
  result: unknown;
  /** Whether the execution succeeded. */
  success: boolean;
  /** Optional error message. */
  error?: string;
  /** Execution metadata (latency, tokens used, etc.). */
  metadata?: Record<string, unknown>;
}

/** Metrics collected from a module execution. */
export interface ModuleMetrics {
  /** Module key. */
  key: AlgorithmModuleKey;
  /** Variant name. */
  variant: string;
  /** Execution count. */
  executions: number;
  /** Success count. */
  successes: number;
  /** Failure count. */
  failures: number;
  /** Total latency in ms. */
  totalLatencyMs: number;
  /** Average latency in ms. */
  avgLatencyMs: number;
  /** Custom metrics (key-value pairs). */
  custom: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Internal storage for registrations. */
const registrations = new Map<AlgorithmModuleKey, AlgorithmRegistration>();

/** Metric collectors per module+variant. */
const metricsStore = new Map<string, ModuleMetrics>();

/** Listener for registry change events. */
type RegistryListener = (key: AlgorithmModuleKey, activeVariant: string) => void;
const listeners: RegistryListener[] = [];

/**
 * Register an algorithm module with its variants.
 * If the key already exists, the new registration replaces the old one.
 */
export function registerAlgorithm(registration: AlgorithmRegistration): void {
  registrations.set(registration.key, registration);
  // Initialize metrics for each variant
  for (const v of registration.variants) {
    const mkey = `${registration.key}:${v.name}`;
    if (!metricsStore.has(mkey)) {
      metricsStore.set(mkey, {
        key: registration.key,
        variant: v.name,
        executions: 0,
        successes: 0,
        failures: 0,
        totalLatencyMs: 0,
        avgLatencyMs: 0,
        custom: {},
      });
    }
  }
  // Notify listeners
  for (const l of listeners) {
    l(registration.key, registration.activeVariant);
  }
}

/**
 * Unregister an algorithm module.
 */
export function unregisterAlgorithm(key: AlgorithmModuleKey): void {
  registrations.delete(key);
}

/**
 * Get the registration for a module key.
 */
export function getRegistration(key: AlgorithmModuleKey): AlgorithmRegistration | undefined {
  return registrations.get(key);
}

/**
 * List all registered module keys.
 */
export function listModuleKeys(): AlgorithmModuleKey[] {
  return Array.from(registrations.keys());
}

/**
 * List all variants for a module.
 */
export function listVariants(key: AlgorithmModuleKey): VariantInfo[] {
  return registrations.get(key)?.variants ?? [];
}

/**
 * Switch the active variant for a module.
 * Returns true if the switch was successful.
 */
export function switchVariant(key: AlgorithmModuleKey, variantName: string): boolean {
  const reg = registrations.get(key);
  if (!reg) return false;
  if (!reg.variants.some((v) => v.name === variantName)) return false;
  reg.activeVariant = variantName;
  for (const l of listeners) {
    l(key, variantName);
  }
  return true;
}

/**
 * Create an instance of the active variant for a module.
 */
export function createActiveModule(key: AlgorithmModuleKey): AlgorithmModule | undefined {
  const reg = registrations.get(key);
  if (!reg) return undefined;
  return reg.create(reg.activeVariant);
}

/**
 * Create an instance of a specific variant for a module.
 */
export function createModule(key: AlgorithmModuleKey, variantName: string): AlgorithmModule | undefined {
  const reg = registrations.get(key);
  if (!reg) return undefined;
  return reg.create(variantName);
}

/**
 * Record a metric for a module+variant execution.
 */
export function recordMetric(
  key: AlgorithmModuleKey,
  variant: string,
  success: boolean,
  latencyMs: number,
  custom?: Record<string, number>,
): void {
  const mkey = `${key}:${variant}`;
  const m = metricsStore.get(mkey);
  if (!m) return;
  m.executions++;
  if (success) m.successes++;
  else m.failures++;
  m.totalLatencyMs += latencyMs;
  m.avgLatencyMs = m.totalLatencyMs / m.executions;
  if (custom) {
    for (const [k, v] of Object.entries(custom)) {
      m.custom[k] = (m.custom[k] ?? 0) + v;
    }
  }
}

/**
 * Get metrics for a module+variant.
 */
export function getMetrics(key: AlgorithmModuleKey, variant: string): ModuleMetrics | undefined {
  return metricsStore.get(`${key}:${variant}`);
}

/**
 * Get all metrics for a module (all variants).
 */
export function getAllMetrics(key: AlgorithmModuleKey): ModuleMetrics[] {
  const reg = registrations.get(key);
  if (!reg) return [];
  return reg.variants
    .map((v) => metricsStore.get(`${key}:${v.name}`))
    .filter((m): m is ModuleMetrics => m !== undefined);
}

/**
 * Reset metrics for a module+variant.
 */
export function resetMetrics(key: AlgorithmModuleKey, variant: string): void {
  const mkey = `${key}:${variant}`;
  const m = metricsStore.get(mkey);
  if (!m) return;
  m.executions = 0;
  m.successes = 0;
  m.failures = 0;
  m.totalLatencyMs = 0;
  m.avgLatencyMs = 0;
  m.custom = {};
}

/**
 * Subscribe to registry change events.
 */
export function onRegistryChange(listener: RegistryListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

// ---------------------------------------------------------------------------
// Default Module Implementations
// ---------------------------------------------------------------------------

/**
 * Create a no-op default module for a key+variant.
 * Used as a fallback when no custom implementation is registered.
 */
export function createDefaultModule(key: AlgorithmModuleKey, variant: string): AlgorithmModule {
  return {
    key,
    variant,
    async execute(input: AlgorithmInput): Promise<AlgorithmOutput> {
      return {
        result: input.data,
        success: true,
        metadata: { moduleKey: key, variant, passthrough: true },
      };
    },
    collectMetrics(): ModuleMetrics {
      return getMetrics(key, variant) ?? {
        key,
        variant,
        executions: 0,
        successes: 0,
        failures: 0,
        totalLatencyMs: 0,
        avgLatencyMs: 0,
        custom: {},
      };
    },
  };
}
