/**
 * Metrics API client — observability dashboard data.
 */

import { getBackendBaseURL } from "@/core/config";

export interface TokenMetrics {
  total_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_runs: number;
  by_model: Record<string, { tokens: number; runs: number }>;
  by_caller: { lead_agent: number; subagent: number; middleware: number };
}

export interface OverviewResponse {
  tokens: TokenMetrics;
  estimated_cost_usd: number;
  generated_at: string;
}

export interface ActivityRun {
  run_id: string;
  thread_id: string;
  model_name: string | null;
  status: string;
  total_tokens: number;
  created_at: string;
  error: string | null;
}

export interface ActivityResponse {
  runs: ActivityRun[];
  generated_at: string;
}

export interface ToolStats {
  total_tool_calls: number;
  by_tool: Record<string, { calls: number; errors: number; avg_duration_ms: number }>;
}

export interface ToolsResponse extends ToolStats {
  generated_at: string;
}

async function fetchJson<T>(path: string): Promise<T> {
  const base = getBackendBaseURL();
  const res = await fetch(`${base}${path}`, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Metrics API error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchMetricsOverview(): Promise<OverviewResponse> {
  return fetchJson<OverviewResponse>("/api/metrics/overview");
}

export async function fetchMetricsActivity(limit = 50): Promise<ActivityResponse> {
  return fetchJson<ActivityResponse>(`/api/metrics/activity?limit=${limit}`);
}

export async function fetchMetricsTools(): Promise<ToolsResponse> {
  return fetchJson<ToolsResponse>("/api/metrics/tools");
}
