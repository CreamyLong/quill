/**
 * Experiment Evaluation — statistical comparison + reports.
 *
 * After running an experiment, researchers need to compare variant
 * performance and determine if the results are statistically significant.
 * This module provides:
 *   - Descriptive statistics (mean, median, stddev, percentiles)
 *   - Statistical significance testing (two-proportion z-test for success rates)
 *   - Effect size calculation (Cohen's d for latency)
 *   - Automated report generation
 *
 * @module experiments/evaluation
 */

import type { ModuleMetrics, AlgorithmModuleKey } from "./registry.js";
import { getAllMetrics } from "./registry.js";
import type { ExperimentConfig } from "./config.js";
import { checkSuccessCriteria, type VariantComparison } from "./runtime.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Descriptive statistics for a numeric sample. */
export interface DescriptiveStats {
  count: number;
  mean: number;
  median: number;
  stddev: number;
  min: number;
  max: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

/** Result of a two-proportion z-test. */
export interface ZTestResult {
  /** Z-statistic. */
  z: number;
  /** Two-tailed p-value. */
  pValue: number;
  /** Whether the difference is significant at the given alpha. */
  significant: boolean;
  /** The difference in proportions (variantA - variantB). */
  difference: number;
  /** 95% confidence interval for the difference. */
  ci95: [number, number];
}

/** Result of an effect size calculation. */
export interface EffectSize {
  /** Cohen's d value. */
  cohensD: number;
  /** Interpretation of the effect size. */
  interpretation: "negligible" | "small" | "medium" | "large";
}

/** A complete experiment report. */
export interface ExperimentReport {
  /** The experiment configuration. */
  experiment: ExperimentConfig;
  /** Per-variant metrics. */
  variants: VariantReport[];
  /** Pairwise comparisons between variants. */
  comparisons: VariantComparisonResult[];
  /** Overall verdict. */
  verdict: ExperimentVerdict;
  /** ISO timestamp of report generation. */
  generatedAt: string;
}

/** Per-variant report data. */
export interface VariantReport {
  variant: string;
  metrics: ModuleMetrics;
  stats: DescriptiveStats | null;
  criteriaCheck: { passed: boolean; reasons: string[] };
}

/** Pairwise comparison between two variants. */
export interface VariantComparisonResult {
  variantA: string;
  variantB: string;
  successRateDiff: number;
  successRateTest: ZTestResult;
  latencyDiff: number;
  latencyEffectSize: EffectSize;
  winner: string | null;
}

/** Overall experiment verdict. */
export interface ExperimentVerdict {
  /** Whether the experiment has enough data to draw conclusions. */
  hasEnoughData: boolean;
  /** The winning variant (or null if inconclusive). */
  winner: string | null;
  /** Human-readable summary. */
  summary: string;
  /** Recommendations. */
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Compute descriptive statistics for a numeric sample.
 */
export function computeStats(sample: number[]): DescriptiveStats | null {
  if (sample.length === 0) return null;

  const sorted = [...sample].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];

  const variance = sorted.reduce((sum, x) => sum + (x - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);

  const percentile = (p: number) => {
    const idx = Math.ceil((p / 100) * n) - 1;
    return sorted[Math.max(0, Math.min(idx, n - 1))];
  };

  return {
    count: n,
    mean,
    median,
    stddev,
    min: sorted[0],
    max: sorted[n - 1],
    p50: percentile(50),
    p90: percentile(90),
    p95: percentile(95),
    p99: percentile(99),
  };
}

/**
 * Two-proportion z-test for comparing success rates.
 */
export function twoProportionZTest(
  successesA: number,
  totalA: number,
  successesB: number,
  totalB: number,
  alpha = 0.05,
): ZTestResult {
  if (totalA === 0 || totalB === 0) {
    return { z: 0, pValue: 1, significant: false, difference: 0, ci95: [0, 0] };
  }

  const pA = successesA / totalA;
  const pB = successesB / totalB;
  const pPool = (successesA + successesB) / (totalA + totalB);

  const se = Math.sqrt(pPool * (1 - pPool) * (1 / totalA + 1 / totalB));
  if (se === 0) {
    return { z: 0, pValue: 1, significant: false, difference: 0, ci95: [0, 0] };
  }

  const z = (pA - pB) / se;
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));
  const significant = pValue < alpha;

  const diff = pA - pB;
  const ci95: [number, number] = [
    diff - 1.96 * se,
    diff + 1.96 * se,
  ];

  return { z, pValue, significant, difference: diff, ci95 };
}

/**
 * Cohen's d effect size for comparing two samples.
 */
export function cohensDSample(meanA: number, stddevA: number, meanB: number, stddevB: number): EffectSize {
  const pooledStddev = Math.sqrt((stddevA ** 2 + stddevB ** 2) / 2);
  if (pooledStddev === 0) {
    return { cohensD: 0, interpretation: "negligible" };
  }
  const d = Math.abs(meanA - meanB) / pooledStddev;
  let interpretation: EffectSize["interpretation"];
  if (d < 0.2) interpretation = "negligible";
  else if (d < 0.5) interpretation = "small";
  else if (d < 0.8) interpretation = "medium";
  else interpretation = "large";
  return { cohensD: d, interpretation };
}

/** Standard normal CDF. */
function normalCDF(x: number): number {
  // Abramowitz and Stegun approximation
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1 + sign * y);
}

// ---------------------------------------------------------------------------
// Report Generation
// ---------------------------------------------------------------------------

/**
 * Generate a complete experiment report.
 */
export function generateReport(experiment: ExperimentConfig): ExperimentReport {
  const metrics = getAllMetrics(experiment.moduleKey);
  const variants: VariantReport[] = metrics.map((m) => ({
    variant: m.variant,
    metrics: m,
    stats: null, // Would need raw latency samples for full stats
    criteriaCheck: checkSuccessCriteria(experiment, m),
  }));

  // Pairwise comparisons
  const comparisons: VariantComparisonResult[] = [];
  for (let i = 0; i < metrics.length; i++) {
    for (let j = i + 1; j < metrics.length; j++) {
      const a = metrics[i];
      const b = metrics[j];
      const successRateTest = twoProportionZTest(a.successes, a.executions, b.successes, b.executions);
      const latencyEffect = cohensDSample(a.avgLatencyMs, 0, b.avgLatencyMs, 0);

      let winner: string | null = null;
      if (successRateTest.significant) {
        winner = successRateTest.difference > 0 ? a.variant : b.variant;
      }

      comparisons.push({
        variantA: a.variant,
        variantB: b.variant,
        successRateDiff: successRateTest.difference,
        successRateTest,
        latencyDiff: a.avgLatencyMs - b.avgLatencyMs,
        latencyEffectSize: latencyEffect,
        winner,
      });
    }
  }

  // Determine verdict
  const verdict = determineVerdict(experiment, metrics, comparisons);

  return {
    experiment,
    variants,
    comparisons,
    verdict,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Determine the overall experiment verdict.
 */
function determineVerdict(
  experiment: ExperimentConfig,
  metrics: ModuleMetrics[],
  comparisons: VariantComparisonResult[],
): ExperimentVerdict {
  const totalExecutions = metrics.reduce((sum, m) => sum + m.executions, 0);
  const hasEnoughData = totalExecutions >= 30; // Minimum sample size

  const recommendations: string[] = [];

  if (!hasEnoughData) {
    recommendations.push(`Need at least 30 total executions (currently ${totalExecutions})`);
  }

  // Find the best variant by success rate
  let bestVariant: string | null = null;
  let bestRate = -1;
  for (const m of metrics) {
    const rate = m.executions > 0 ? m.successes / m.executions : 0;
    if (rate > bestRate) {
      bestRate = rate;
      bestVariant = m.variant;
    }
  }

  // Check if any comparison is statistically significant
  const significantComparisons = comparisons.filter((c) => c.successRateTest.significant);
  if (significantComparisons.length > 0 && bestVariant) {
    recommendations.push(`Variant "${bestVariant}" shows statistically significant improvement`);
  } else if (hasEnoughData) {
    recommendations.push("No statistically significant difference between variants detected");
  }

  // Check success criteria
  for (const m of metrics) {
    const check = checkSuccessCriteria(experiment, m);
    if (!check.passed) {
      recommendations.push(`Variant "${m.variant}" failed criteria: ${check.reasons.join(", ")}`);
    }
  }

  const summary = hasEnoughData
    ? `Experiment "${experiment.name}" analyzed ${totalExecutions} executions across ${metrics.length} variants.`
    : `Experiment "${experiment.name}" has insufficient data (${totalExecutions} executions).`;

  return {
    hasEnoughData,
    winner: hasEnoughData ? bestVariant : null,
    summary,
    recommendations,
  };
}

/**
 * Format a report as a human-readable string.
 */
export function formatReport(report: ExperimentReport): string {
  const lines: string[] = [];
  lines.push(`# Experiment Report: ${report.experiment.name}`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");

  lines.push("## Variants");
  for (const v of report.variants) {
    const rate = v.metrics.executions > 0
      ? ((v.metrics.successes / v.metrics.executions) * 100).toFixed(1)
      : "N/A";
    lines.push(`- **${v.variant}**: ${v.metrics.executions} executions, ${rate}% success, ${v.metrics.avgLatencyMs.toFixed(1)}ms avg latency`);
    if (!v.criteriaCheck.passed) {
      lines.push(`  - ❌ Failed: ${v.criteriaCheck.reasons.join(", ")}`);
    }
  }
  lines.push("");

  if (report.comparisons.length > 0) {
    lines.push("## Comparisons");
    for (const c of report.comparisons) {
      const sig = c.successRateTest.significant ? "✅ significant" : "❌ not significant";
      lines.push(`- ${c.variantA} vs ${c.variantB}: ${(c.successRateDiff * 100).toFixed(1)}% diff (${sig}, p=${c.successRateTest.pValue.toFixed(4)})`);
      if (c.winner) {
        lines.push(`  - Winner: ${c.winner}`);
      }
    }
    lines.push("");
  }

  lines.push("## Verdict");
  lines.push(`- ${report.verdict.summary}`);
  if (report.verdict.winner) {
    lines.push(`- Winner: ${report.verdict.winner}`);
  }
  for (const rec of report.verdict.recommendations) {
    lines.push(`- 💡 ${rec}`);
  }

  return lines.join("\n");
}
