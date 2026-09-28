/**
 * Algorithm Arena — compare models, configs, and thinking levels.
 *
 * Researchers can:
 *   - Select different models to compare
 *   - Configure parameters (temperature, thinking level, etc.)
 *   - Run benchmark tasks
 *   - View side-by-side comparisons
 *   - Generate statistical reports
 *
 * @module components/workspace/experiment-dashboard
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Play,
  BarChart3,
  Settings,
  Trophy,
  TrendingUp,
  Clock,
  Cpu,
  Zap,
} from "lucide-react";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";
import {
  SuccessRateBarChart,
  LatencyLineChart,
  ExecutionStackedBar,
  ConfidenceIntervalPlot,
} from "./experiment-charts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  temperature: number;
  thinkingLevel: "none" | "low" | "medium" | "high";
  maxTokens: number;
}

interface ArenaResult {
  configId: string;
  modelName: string;
  thinkingLevel: string;
  temperature: number;
  taskCount: number;
  passedCount: number;
  passRate: number;
  meanScore: number;
  avgLatencyMs: number;
  totalTokens: number;
  cost: number;
}

interface BenchmarkTask {
  id: string;
  name: string;
  category: string;
  difficulty: string;
  prompt: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExperimentDashboard() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<"arena" | "configs" | "results">("arena");
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [results, setResults] = useState<ArenaResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  // Fetch available models
  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models");
      const data = await res.json();
      const modelList: ModelConfig[] = (data.models ?? []).map((m: Record<string, unknown>) => ({
        id: m.id as string,
        name: (m.display_name as string) || (m.name as string),
        provider: (m.model as string) || "unknown",
        temperature: 0.7,
        thinkingLevel: "medium" as const,
        maxTokens: 4096,
      }));
      setModels(modelList);
    } catch (err) {
      console.error("Failed to load models:", err);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Toggle model selection
  const toggleModel = (modelId: string) => {
    setSelectedModels((prev) =>
      prev.includes(modelId)
        ? prev.filter((id) => id !== modelId)
        : [...prev, modelId],
    );
  };

  // Update model config
  const updateModelConfig = (modelId: string, updates: Partial<ModelConfig>) => {
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, ...updates } : m)),
    );
  };

  // Run benchmark
  const runBenchmark = async () => {
    if (selectedModels.length === 0) return;
    setIsRunning(true);
    setProgress(0);

    const benchmarkTasks: BenchmarkTask[] = [
      { id: "t1", name: "Code Generation", category: "coding", difficulty: "medium", prompt: "Write a function to calculate fibonacci numbers" },
      { id: "t2", name: "Data Analysis", category: "research", difficulty: "hard", prompt: "Analyze the given dataset and provide insights" },
      { id: "t3", name: "Math Problem", category: "math", difficulty: "medium", prompt: "Solve the equation: x^2 + 5x + 6 = 0" },
      { id: "t4", name: "Writing Task", category: "writing", difficulty: "easy", prompt: "Write a summary of the given article" },
      { id: "t5", name: "Debug Code", category: "coding", difficulty: "hard", prompt: "Find and fix the bug in the given code" },
    ];

    const newResults: ArenaResult[] = [];

    for (let i = 0; i < selectedModels.length; i++) {
      const modelId = selectedModels[i];
      const model = models.find((m) => m.id === modelId);
      if (!model) continue;

      // Simulate benchmark run
      for (let j = 0; j < benchmarkTasks.length; j++) {
        setProgress(((i * benchmarkTasks.length + j + 1) / (selectedModels.length * benchmarkTasks.length)) * 100);
        await new Promise((r) => setTimeout(r, 200));
      }

      // Generate simulated results
      const passedCount = Math.floor(Math.random() * 3) + 2; // 2-4 passed
      newResults.push({
        configId: model.id,
        modelName: model.name,
        thinkingLevel: model.thinkingLevel,
        temperature: model.temperature,
        taskCount: benchmarkTasks.length,
        passedCount,
        passRate: passedCount / benchmarkTasks.length,
        meanScore: 0.5 + Math.random() * 0.4,
        avgLatencyMs: 500 + Math.random() * 2000,
        totalTokens: 1000 + Math.floor(Math.random() * 5000),
        cost: 0.01 + Math.random() * 0.1,
      });
    }

    setResults(newResults);
    setIsRunning(false);
    setProgress(100);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 p-4 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
              Algorithm Arena
            </h2>
            <p className="text-sm text-muted-foreground">
              Compare models, configurations, and thinking levels
            </p>
          </div>
          <button
            onClick={runBenchmark}
            disabled={isRunning || selectedModels.length === 0}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
              isRunning || selectedModels.length === 0
                ? "cursor-not-allowed bg-muted text-muted-foreground"
                : "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
            )}
          >
            {isRunning ? (
              <>
                <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                <span>Running... {progress.toFixed(0)}%</span>
              </>
            ) : (
              <>
                <Play className="size-4" />
                <span>Run Benchmark</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-card/30">
        {(["arena", "configs", "results"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "relative flex-1 px-4 py-3 text-sm font-medium transition-colors",
              activeTab === tab
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="flex items-center justify-center gap-2">
              {tab === "arena" && <Trophy className="size-4" />}
              {tab === "configs" && <Settings className="size-4" />}
              {tab === "results" && <BarChart3 className="size-4" />}
              <span className="capitalize">{tab}</span>
            </span>
            {activeTab === tab && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === "arena" && (
          <div className="space-y-6">
            {/* Model Selection */}
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="mb-4 flex items-center gap-2 font-semibold text-foreground">
                <Cpu className="size-4 text-primary" />
                Select Models to Compare
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {models.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => toggleModel(model.id)}
                    className={cn(
                      "group relative rounded-lg border p-4 text-left transition-all",
                      selectedModels.includes(model.id)
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border hover:border-primary/50 hover:bg-muted/50",
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium text-foreground">{model.name}</div>
                        <div className="text-xs text-muted-foreground">{model.provider}</div>
                      </div>
                      <div
                        className={cn(
                          "flex size-5 items-center justify-center rounded-full border-2 transition-colors",
                          selectedModels.includes(model.id)
                            ? "border-primary bg-primary"
                            : "border-border",
                        )}
                      >
                        {selectedModels.includes(model.id) && (
                          <div className="size-2 rounded-full bg-primary-foreground" />
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <Zap className="size-3" />
                      <span>Thinking: {model.thinkingLevel}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Stats */}
            {results.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Trophy className="size-4" />
                    <span>Best Pass Rate</span>
                  </div>
                  <div className="mt-2 text-2xl font-bold text-foreground">
                    {(Math.max(...results.map((r) => r.passRate)) * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="size-4" />
                    <span>Fastest</span>
                  </div>
                  <div className="mt-2 text-2xl font-bold text-foreground">
                    {Math.min(...results.map((r) => r.avgLatencyMs)).toFixed(0)}ms
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <TrendingUp className="size-4" />
                    <span>Most Efficient</span>
                  </div>
                  <div className="mt-2 text-2xl font-bold text-foreground">
                    {Math.min(...results.map((r) => r.totalTokens)).toFixed(0)} tokens
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <BarChart3 className="size-4" />
                    <span>Cheapest</span>
                  </div>
                  <div className="mt-2 text-2xl font-bold text-foreground">
                    ${Math.min(...results.map((r) => r.cost)).toFixed(3)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "configs" && (
          <div className="space-y-4">
            <h3 className="font-semibold text-foreground">Model Configurations</h3>
            {models.map((model) => (
              <div key={model.id} className="rounded-xl border border-border bg-card p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">{model.name}</div>
                    <div className="text-xs text-muted-foreground">{model.provider}</div>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Temperature
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={model.temperature}
                      onChange={(e) => updateModelConfig(model.id, { temperature: parseFloat(e.target.value) })}
                      className="w-full"
                    />
                    <div className="mt-1 text-center text-sm text-foreground">
                      {model.temperature.toFixed(1)}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Thinking Level
                    </label>
                    <select
                      value={model.thinkingLevel}
                      onChange={(e) => updateModelConfig(model.id, { thinkingLevel: e.target.value as ModelConfig["thinkingLevel"] })}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="none">None</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Max Tokens
                    </label>
                    <input
                      type="number"
                      value={model.maxTokens}
                      onChange={(e) => updateModelConfig(model.id, { maxTokens: parseInt(e.target.value) })}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "results" && (
          <div className="space-y-6">
            {results.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                <BarChart3 className="mb-4 size-12 opacity-50" />
                <p>No results yet. Run a benchmark to see comparisons.</p>
              </div>
            ) : (
              <>
                {/* Results Table */}
                <div className="rounded-xl border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="p-3 text-left font-medium text-muted-foreground">Model</th>
                        <th className="p-3 text-left font-medium text-muted-foreground">Thinking</th>
                        <th className="p-3 text-right font-medium text-muted-foreground">Pass Rate</th>
                        <th className="p-3 text-right font-medium text-muted-foreground">Avg Latency</th>
                        <th className="p-3 text-right font-medium text-muted-foreground">Tokens</th>
                        <th className="p-3 text-right font-medium text-muted-foreground">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r) => (
                        <tr key={r.configId} className="border-b border-border last:border-0">
                          <td className="p-3 font-medium text-foreground">{r.modelName}</td>
                          <td className="p-3 text-muted-foreground">{r.thinkingLevel}</td>
                          <td className="p-3 text-right text-foreground">
                            {(r.passRate * 100).toFixed(1)}%
                          </td>
                          <td className="p-3 text-right text-muted-foreground">
                            {r.avgLatencyMs.toFixed(0)}ms
                          </td>
                          <td className="p-3 text-right text-muted-foreground">
                            {r.totalTokens.toLocaleString()}
                          </td>
                          <td className="p-3 text-right text-muted-foreground">
                            ${r.cost.toFixed(3)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Charts */}
                <div className="grid gap-4 lg:grid-cols-2">
                  <SuccessRateBarChart
                    variants={results.map((r) => ({
                      variant: r.modelName,
                      executions: r.taskCount,
                      successes: r.passedCount,
                      failures: r.taskCount - r.passedCount,
                      successRate: r.passRate,
                      avgLatencyMs: r.avgLatencyMs,
                    }))}
                  />
                  <LatencyLineChart
                    variants={results.map((r) => ({
                      variant: r.modelName,
                      executions: r.taskCount,
                      successes: r.passedCount,
                      failures: r.taskCount - r.passedCount,
                      successRate: r.passRate,
                      avgLatencyMs: r.avgLatencyMs,
                    }))}
                  />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <ExecutionStackedBar
                    variants={results.map((r) => ({
                      variant: r.modelName,
                      executions: r.taskCount,
                      successes: r.passedCount,
                      failures: r.taskCount - r.passedCount,
                      successRate: r.passRate,
                      avgLatencyMs: r.avgLatencyMs,
                    }))}
                  />
                  <ConfidenceIntervalPlot
                    variants={results.map((r) => ({
                      variant: r.modelName,
                      executions: r.taskCount,
                      successes: r.passedCount,
                      failures: r.taskCount - r.passedCount,
                      successRate: r.passRate,
                      avgLatencyMs: r.avgLatencyMs,
                    }))}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
