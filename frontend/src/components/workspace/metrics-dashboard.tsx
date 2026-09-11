"use client";

/**
 * Observability Metrics Dashboard.
 *
 * Displays system-wide analytics: token usage, cost estimation,
 * recent activity, and tool usage statistics.
 */

import {
  Activity,
  BarChart3,
  Coins,
  Cpu,
  Layers,
  TrendingUp,
} from "lucide-react";
import { useMemo } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface MetricsDashboardProps {
  tokens: {
    total_tokens: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_runs: number;
    by_model: Record<string, { tokens: number; runs: number }>;
    by_caller: { lead_agent: number; subagent: number; middleware: number };
  };
  estimatedCostUsd: number;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatTokens(tokens: number): string {
  return formatNumber(tokens);
}

export function MetricsDashboard({ tokens, estimatedCostUsd }: MetricsDashboardProps) {
  const modelEntries = useMemo(
    () =>
      Object.entries(tokens.by_model)
        .sort(([, a], [, b]) => b.tokens - a.tokens)
        .slice(0, 8),
    [tokens.by_model]
  );

  const callerEntries = useMemo(() => {
    const c = tokens.by_caller;
    return [
      { label: "Lead Agent", value: c.lead_agent, color: "bg-blue-500" },
      { label: "Subagents", value: c.subagent, color: "bg-violet-500" },
      { label: "Middleware", value: c.middleware, color: "bg-amber-500" },
    ];
  }, [tokens.by_caller]);

  const totalCallerTokens = callerEntries.reduce((sum, e) => sum + e.value, 0);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Observability Dashboard
        </h2>
        <p className="text-muted-foreground text-sm">
          System-wide token usage, cost, and activity metrics.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
            <Layers className="text-muted-foreground size-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(tokens.total_tokens)}</div>
            <p className="text-muted-foreground text-xs">
              {tokens.total_runs} runs
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Input Tokens</CardTitle>
            <TrendingUp className="text-muted-foreground size-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(tokens.total_input_tokens)}</div>
            <p className="text-muted-foreground text-xs">
              Context + messages
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Output Tokens</CardTitle>
            <Cpu className="text-muted-foreground size-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(tokens.total_output_tokens)}</div>
            <p className="text-muted-foreground text-xs">
              Generated responses
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Est. Cost</CardTitle>
            <Coins className="text-muted-foreground size-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${estimatedCostUsd.toFixed(2)}</div>
            <p className="text-muted-foreground text-xs">
              Approximate USD
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Per-Model Breakdown */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="size-4" />
              Usage by Model
            </CardTitle>
            <CardDescription>Token distribution across models</CardDescription>
          </CardHeader>
          <CardContent>
            {modelEntries.length === 0 ? (
              <p className="text-muted-foreground text-sm">No data yet.</p>
            ) : (
              <div className="space-y-3">
                {modelEntries.map(([model, data]) => {
                  const pct = tokens.total_tokens > 0
                    ? (data.tokens / tokens.total_tokens) * 100
                    : 0;
                  return (
                    <div key={model} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium truncate max-w-[200px]" title={model}>
                          {model}
                        </span>
                        <span className="text-muted-foreground">
                          {formatTokens(data.tokens)} ({data.runs} runs)
                        </span>
                      </div>
                      <div className="bg-muted h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-primary h-full rounded-full transition-all"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4" />
              Usage by Caller
            </CardTitle>
            <CardDescription>Token distribution across agent types</CardDescription>
          </CardHeader>
          <CardContent>
            {totalCallerTokens === 0 ? (
              <p className="text-muted-foreground text-sm">No data yet.</p>
            ) : (
              <div className="space-y-4">
                {callerEntries.map(({ label, value, color }) => {
                  const pct = totalCallerTokens > 0 ? (value / totalCallerTokens) * 100 : 0;
                  return (
                    <div key={label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className={`size-3 rounded-full ${color}`} />
                          <span className="font-medium">{label}</span>
                        </div>
                        <span className="text-muted-foreground">
                          {formatTokens(value)} ({pct.toFixed(0)}%)
                        </span>
                      </div>
                      <div className="bg-muted h-2 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${color}`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
