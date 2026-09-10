/**
 * Observability metrics router — system-wide analytics dashboard data.
 *
 * Provides aggregated metrics for the admin dashboard:
 *   - Token usage (total, per-model, per-user, time series)
 *   - Session/run statistics
 *   - Tool usage heatmap
 *   - Error rates
 *
 * Inspired by the awesome-harness-engineering observability patterns and
 * Codex/DeerFlow dashboard designs.
 */

import type { Router } from "express";

export interface MetricsDeps {
  /** Aggregate token usage across all threads. */
  aggregateAllTokens?: () => Promise<{
    total_tokens: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_runs: number;
    by_model: Record<string, { tokens: number; runs: number }>;
    by_caller: { lead_agent: number; subagent: number; middleware: number };
  }>;
  /** Get recent runs for the activity timeline. */
  listRecentRuns?: (limit: number) => Promise<Array<{
    run_id: string;
    thread_id: string;
    model_name: string | null;
    status: string;
    total_tokens: number;
    created_at: string;
    error: string | null;
  }>>;
  /** Get tool usage statistics. */
  getToolStats?: () => Promise<{
    total_tool_calls: number;
    by_tool: Record<string, { calls: number; errors: number; avg_duration_ms: number }>;
  }>;
}

/** Model cost rates (USD per 1M tokens) — approximate. */
const MODEL_COST_RATES: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-sonnet-4-20250514-1M": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.25, output: 1.25 },
  "claude-opus-4-20250514": { input: 15, output: 75 },
  "deepseek-chat": { input: 0.27, output: 1.1 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
  "gemini-2.5-flash": { input: 0.15, output: 0.6 },
  "gemini-2.5-pro": { input: 1.25, output: 5 },
  "kimi-k2-turbo-preview": { input: 0.6, output: 2 },
  "kimi-k2-0711-preview": { input: 0.6, output: 2 },
};

/**
 * Estimate cost in USD for given token usage.
 */
export function estimateCost(
  modelName: string | null,
  inputTokens: number,
  outputTokens: number
): number {
  const rates = MODEL_COST_RATES[modelName ?? ""] ?? { input: 1, output: 3 };
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

export function createMetricsRouter(deps: MetricsDeps): Router {
  const router = require("express").Router() as Router;

  // GET /api/metrics/overview — high-level system metrics
  router.get("/overview", async (_req, res) => {
    try {
      const tokens = deps.aggregateAllTokens
        ? await deps.aggregateAllTokens()
        : {
            total_tokens: 0,
            total_input_tokens: 0,
            total_output_tokens: 0,
            total_runs: 0,
            by_model: {},
            by_caller: { lead_agent: 0, subagent: 0, middleware: 0 },
          };

      // Estimate total cost.
      let totalCost = 0;
      for (const [model, data] of Object.entries(tokens.by_model)) {
        // Approximate: assume 40% input, 60% output split when not tracked separately.
        const inputTokens = Math.floor(data.tokens * 0.4);
        const outputTokens = Math.floor(data.tokens * 0.6);
        totalCost += estimateCost(model, inputTokens, outputTokens);
      }

      res.json({
        tokens,
        estimated_cost_usd: Math.round(totalCost * 100) / 100,
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/metrics/activity — recent runs timeline
  router.get("/activity", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) ?? 50, 200);
      const runs = deps.listRecentRuns ? await deps.listRecentRuns(limit) : [];
      res.json({ runs, generated_at: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/metrics/tools — tool usage statistics
  router.get("/tools", async (_req, res) => {
    try {
      const stats = deps.getToolStats
        ? await deps.getToolStats()
        : { total_tool_calls: 0, by_tool: {} };
      res.json({ ...stats, generated_at: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
