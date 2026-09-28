/**
 * Experiment Runtime — variant selection + metric collection.
 *
 * The runtime is the execution engine for experiments. It:
 *   1. Receives an algorithm input
 *   2. Looks up the active experiment for the module
 *   3. Selects a variant based on the subject ID (consistent hashing)
 *   4. Executes the selected variant's algorithm
 *   5. Collects metrics (latency, success/failure, custom metrics)
 *   6. Returns the output with experiment metadata
 *
 * This enables researchers to A/B test algorithm implementations by
 * routing different users/threads to different variants and comparing
 * outcomes.
 *
 * @module experiments/runtime
 */

import {
  createModule,
  getAllMetrics,
  recordMetric,
  type AlgorithmInput,
  type AlgorithmModuleKey,
  type AlgorithmOutput,
  type ModuleMetrics,
} from "./registry.js";
import {
  getActiveExperiment,
  selectVariant,
  type ExperimentConfig,
} from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of an experiment execution. */
export interface ExperimentResult {
  /** The algorithm output. */
  output: AlgorithmOutput;
  /** The experiment that was used (null if no active experiment). */
  experiment: ExperimentConfig | null;
  /** The variant that was selected. */
  variant: string | null;
  /** The subject ID used for variant selection. */
  subjectId: string;
  /** Latency in ms. */
  latencyMs: number;
}

/** Options for experiment execution. */
export interface ExperimentRunOptions {
  /** Subject ID for variant selection (e.g., thread ID, user ID). */
  subjectId: string;
  /** Force a specific variant (bypasses experiment assignment). */
  forceVariant?: string;
  /** Custom config overrides for this execution. */
  config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/**
 * Execute an algorithm module with experiment routing.
 *
 * If an active experiment exists for the module, a variant is selected
 * based on the subject ID. Otherwise, the active variant from the
 * registry is used.
 */
export async function runExperiment(
  key: AlgorithmModuleKey,
  input: AlgorithmInput,
  options: ExperimentRunOptions,
): Promise<ExperimentResult> {
  const startTime = Date.now();
  const subjectId = options.subjectId;

  // Look up active experiment
  const experiment = getActiveExperiment(key) ?? null;

  // Select variant
  let variant: string | null = null;
  if (options.forceVariant) {
    variant = options.forceVariant;
  } else if (experiment) {
    variant = selectVariant(experiment, subjectId);
  }

  // Fall back to the registry's active variant
  if (!variant) {
    // Use the default module
    const defaultOutput = await executeDefault(key, input);
    const latencyMs = Date.now() - startTime;
    return {
      output: defaultOutput,
      experiment: null,
      variant: null,
      subjectId,
      latencyMs,
    };
  }

  // Execute the selected variant
  const module = createModule(key, variant);
  if (!module) {
    const latencyMs = Date.now() - startTime;
    return {
      output: {
        result: null,
        success: false,
        error: `Module not found: ${key}/${variant}`,
      },
      experiment,
      variant,
      subjectId,
      latencyMs,
    };
  }

  try {
    if (module.init && options.config) {
      await module.init(options.config);
    }

    const output = await module.execute(input);
    const latencyMs = Date.now() - startTime;

    // Record metrics
    recordMetric(key, variant, output.success, latencyMs, output.metadata as Record<string, number>);

    return {
      output,
      experiment,
      variant,
      subjectId,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    recordMetric(key, variant, false, latencyMs);
    return {
      output: {
        result: null,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      experiment,
      variant,
      subjectId,
      latencyMs,
    };
  }
}

/**
 * Execute the default (no-experiment) path for a module.
 */
async function executeDefault(
  key: AlgorithmModuleKey,
  input: AlgorithmInput,
): Promise<AlgorithmOutput> {
  // Import here to avoid circular dependency
  const { createDefaultModule } = await import("./registry.js");
  const module = createDefaultModule(key, "default");
  return module.execute(input);
}

/**
 * Get a comparison report for all variants of a module.
 */
export function getVariantComparison(key: AlgorithmModuleKey): VariantComparison[] {
  return getAllMetrics(key).map((m) => ({
    variant: m.variant,
    executions: m.executions,
    successes: m.successes,
    failures: m.failures,
    successRate: m.executions > 0 ? m.successes / m.executions : 0,
    avgLatencyMs: m.avgLatencyMs,
    custom: { ...m.custom },
  }));
}

/** Variant comparison data. */
export interface VariantComparison {
  variant: string;
  executions: number;
  successes: number;
  failures: number;
  successRate: number;
  avgLatencyMs: number;
  custom: Record<string, number>;
}

/**
 * Check if an experiment's success criteria are met.
 */
export function checkSuccessCriteria(
  experiment: ExperimentConfig,
  metrics: ModuleMetrics,
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const criteria = experiment.criteria;

  if (!criteria) return { passed: true, reasons };

  if (criteria.minSuccessRate !== undefined) {
    const rate = metrics.executions > 0 ? metrics.successes / metrics.executions : 0;
    if (rate < criteria.minSuccessRate) {
      reasons.push(
        `Success rate ${rate.toFixed(3)} < minimum ${criteria.minSuccessRate}`,
      );
    }
  }

  if (criteria.maxAvgLatencyMs !== undefined) {
    if (metrics.avgLatencyMs > criteria.maxAvgLatencyMs) {
      reasons.push(
        `Avg latency ${metrics.avgLatencyMs.toFixed(1)}ms > maximum ${criteria.maxAvgLatencyMs}ms`,
      );
    }
  }

  if (criteria.customThresholds) {
    for (const [metricName, threshold] of Object.entries(criteria.customThresholds)) {
      const value = metrics.custom[metricName];
      if (value === undefined) continue;
      if (threshold.min !== undefined && value < threshold.min) {
        reasons.push(`Metric ${metricName}=${value} < minimum ${threshold.min}`);
      }
      if (threshold.max !== undefined && value > threshold.max) {
        reasons.push(`Metric ${metricName}=${value} > maximum ${threshold.max}`);
      }
    }
  }

  return { passed: reasons.length === 0, reasons };
}
