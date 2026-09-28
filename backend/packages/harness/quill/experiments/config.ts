/**
 * Experiment Configuration — A/B testing config + hot-reload.
 *
 * Researchers define experiments as JSON documents that specify:
 *   - Which algorithm module to test (e.g., "classifier")
 *   - Which variants to compare (e.g., ["baseline", "experimental"])
 *   - Traffic split (e.g., 50/50)
 *   - Success criteria and metrics to collect
 *
 * The config is stored as a JSON file under `.scitops/experiments/` and
 * hot-reloaded via cache invalidation (same pattern as AppConfig).
 *
 * @module experiments/config
 */

import fs from "node:fs";
import path from "node:path";

import { projectRoot } from "../config/runtime_paths.js";
import type { AlgorithmModuleKey } from "./registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single variant assignment in an experiment. */
export interface VariantAssignment {
  /** Variant name. */
  variant: string;
  /** Traffic percentage [0-100]. */
  weight: number;
}

/** Success criteria for an experiment. */
export interface SuccessCriteria {
  /** Minimum success rate [0-1]. */
  minSuccessRate?: number;
  /** Maximum average latency in ms. */
  maxAvgLatencyMs?: number;
  /** Custom metric thresholds. */
  customThresholds?: Record<string, { min?: number; max?: number }>;
}

/** A single experiment definition. */
export interface ExperimentConfig {
  /** Unique experiment ID. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description of what this experiment tests. */
  description?: string;
  /** The algorithm module being tested. */
  moduleKey: AlgorithmModuleKey;
  /** Variants to compare, with traffic weights. */
  variants: VariantAssignment[];
  /** Success criteria. */
  criteria?: SuccessCriteria;
  /** Whether the experiment is currently running. */
  enabled: boolean;
  /** Optional metadata (tags, owner, etc.). */
  metadata?: Record<string, unknown>;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
}

/** Collection of all experiments. */
export interface ExperimentSuite {
  /** Schema version. */
  version: number;
  /** All experiments. */
  experiments: ExperimentConfig[];
}

// ---------------------------------------------------------------------------
// Config Store (hot-reloadable)
// ---------------------------------------------------------------------------

const EXPERIMENTS_DIR = path.join(projectRoot(), ".scitops", "experiments");
const EXPERIMENTS_FILE = path.join(EXPERIMENTS_DIR, "experiments.json");

/** Cached experiment suite. */
let cachedSuite: ExperimentSuite | null = null;

/** Listeners for config changes. */
type ConfigListener = (suite: ExperimentSuite) => void;
const configListeners: ConfigListener[] = [];

/**
 * Load the experiment suite from disk.
 * Returns an empty suite if the file doesn't exist.
 */
export function loadExperimentSuite(): ExperimentSuite {
  if (cachedSuite) return cachedSuite;

  if (!fs.existsSync(EXPERIMENTS_FILE)) {
    cachedSuite = { version: 1, experiments: [] };
    return cachedSuite;
  }

  try {
    const raw = fs.readFileSync(EXPERIMENTS_FILE, "utf-8");
    cachedSuite = JSON.parse(raw) as ExperimentSuite;
  } catch {
    cachedSuite = { version: 1, experiments: [] };
  }
  return cachedSuite;
}

/**
 * Get the cached experiment suite (or load from disk).
 */
export function getExperimentSuite(): ExperimentSuite {
  return loadExperimentSuite();
}

/**
 * Get a single experiment by ID.
 */
export function getExperiment(id: string): ExperimentConfig | undefined {
  return loadExperimentSuite().experiments.find((e) => e.id === id);
}

/**
 * Get all experiments for a module key.
 */
export function getExperimentsForModule(moduleKey: AlgorithmModuleKey): ExperimentConfig[] {
  return loadExperimentSuite().experiments.filter((e) => e.moduleKey === moduleKey);
}

/**
 * Get the active experiment for a module (first enabled one).
 */
export function getActiveExperiment(moduleKey: AlgorithmModuleKey): ExperimentConfig | undefined {
  return loadExperimentSuite().experiments.find(
    (e) => e.moduleKey === moduleKey && e.enabled,
  );
}

/**
 * Save the experiment suite to disk and invalidate cache.
 */
export function saveExperimentSuite(suite: ExperimentSuite): void {
  fs.mkdirSync(EXPERIMENTS_DIR, { recursive: true });
  const tmp = `${EXPERIMENTS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(suite, null, 2), "utf-8");
  fs.renameSync(tmp, EXPERIMENTS_FILE);
  cachedSuite = suite;
  for (const l of configListeners) {
    l(suite);
  }
}

/**
 * Add or update an experiment.
 */
export function upsertExperiment(experiment: ExperimentConfig): ExperimentSuite {
  const suite = loadExperimentSuite();
  const idx = suite.experiments.findIndex((e) => e.id === experiment.id);
  const now = new Date().toISOString();
  if (idx >= 0) {
    suite.experiments[idx] = { ...experiment, updatedAt: now };
  } else {
    suite.experiments.push({ ...experiment, createdAt: now, updatedAt: now });
  }
  saveExperimentSuite(suite);
  return suite;
}

/**
 * Remove an experiment by ID.
 */
export function removeExperiment(id: string): ExperimentSuite {
  const suite = loadExperimentSuite();
  suite.experiments = suite.experiments.filter((e) => e.id !== id);
  saveExperimentSuite(suite);
  return suite;
}

/**
 * Invalidate the cache (force reload on next access).
 */
export function resetExperimentCache(): void {
  cachedSuite = null;
}

/**
 * Subscribe to config changes.
 */
export function onConfigChange(listener: ConfigListener): () => void {
  configListeners.push(listener);
  return () => {
    const idx = configListeners.indexOf(listener);
    if (idx >= 0) configListeners.splice(idx, 1);
  };
}

// ---------------------------------------------------------------------------
// Variant Selection
// ---------------------------------------------------------------------------

/** Simple hash function for deterministic variant assignment. */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Select a variant for a given subject (e.g., thread ID) based on traffic weights.
 * Uses consistent hashing so the same subject always gets the same variant.
 */
export function selectVariant(experiment: ExperimentConfig, subjectId: string): string | null {
  if (!experiment.enabled || experiment.variants.length === 0) return null;

  // Normalize weights
  const totalWeight = experiment.variants.reduce((sum, v) => sum + v.weight, 0);
  if (totalWeight <= 0) return experiment.variants[0]?.variant ?? null;

  // Hash the subject ID to a value in [0, totalWeight)
  const hash = hashString(`${experiment.id}:${subjectId}`);
  const bucket = hash % totalWeight;

  // Find which variant this bucket falls into
  let cumulative = 0;
  for (const v of experiment.variants) {
    cumulative += v.weight;
    if (bucket < cumulative) {
      return v.variant;
    }
  }
  return experiment.variants[experiment.variants.length - 1]?.variant ?? null;
}

/**
 * Validate an experiment config.
 * Returns an array of error messages (empty if valid).
 */
export function validateExperiment(experiment: ExperimentConfig): string[] {
  const errors: string[] = [];
  if (!experiment.id) errors.push("id is required");
  if (!experiment.name) errors.push("name is required");
  if (!experiment.moduleKey) errors.push("moduleKey is required");
  if (experiment.variants.length === 0) errors.push("at least one variant is required");

  const totalWeight = experiment.variants.reduce((sum, v) => sum + v.weight, 0);
  if (totalWeight !== 100) {
    errors.push(`variant weights must sum to 100 (got ${totalWeight})`);
  }

  for (const v of experiment.variants) {
    if (!v.variant) errors.push("variant name is required");
    if (v.weight < 0 || v.weight > 100) {
      errors.push(`variant ${v.variant} weight must be in [0, 100]`);
    }
  }

  return errors;
}
