/**
 * Experiment Charts — statistical visualization for experiment results.
 *
 * Lightweight SVG-based charts for comparing variant performance:
 *   - Bar chart for success rates
 *   - Line chart for latency comparison
 *   - Distribution plot for execution counts
 *
 * No external chart library — pure SVG for zero dependencies.
 *
 * @module components/workspace/experiment-charts
 */

"use client";

import { useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VariantData {
  variant: string;
  executions: number;
  successes: number;
  failures: number;
  successRate: number;
  avgLatencyMs: number;
}

interface ChartProps {
  variants: VariantData[];
  width?: number;
  height?: number;
}

// ---------------------------------------------------------------------------
// Bar Chart — Success Rate Comparison
// ---------------------------------------------------------------------------

export function SuccessRateBarChart({ variants, width = 400, height = 200 }: ChartProps) {
  const barData = useMemo(() => {
    const maxRate = Math.max(...variants.map((v) => v.successRate), 1);
    const barWidth = Math.min(60, (width - 80) / variants.length - 10);
    const chartHeight = height - 60;

    return variants.map((v, i) => {
      const barHeight = (v.successRate / maxRate) * chartHeight;
      const x = 50 + i * (barWidth + 10);
      const y = chartHeight - barHeight + 20;
      return { ...v, x, y, barWidth, barHeight };
    });
  }, [variants, width, height]);

  const maxRate = Math.max(...variants.map((v) => v.successRate), 1);

  return (
    <svg width={width} height={height} className="rounded-lg border border-border bg-background">
      {/* Y-axis */}
      <line x1={40} y1={20} x2={40} y2={height - 40} stroke="currentColor" strokeWidth={1} className="text-muted-foreground" />
      {/* X-axis */}
      <line x1={40} y1={height - 40} x2={width - 10} y2={height - 40} stroke="currentColor" strokeWidth={1} className="text-muted-foreground" />

      {/* Y-axis labels */}
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
        const y = height - 40 - tick * (height - 60);
        return (
          <g key={tick}>
            <line x1={35} y1={y} x2={40} y2={y} stroke="currentColor" strokeWidth={1} className="text-muted-foreground" />
            <text x={30} y={y + 4} textAnchor="end" fontSize={10} className="fill-muted-foreground">
              {(tick * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {barData.map((bar) => (
        <g key={bar.variant}>
          <rect
            x={bar.x}
            y={bar.y}
            width={bar.barWidth}
            height={bar.barHeight}
            className="fill-primary/80"
            rx={2}
          />
          <text
            x={bar.x + bar.barWidth / 2}
            y={bar.y - 5}
            textAnchor="middle"
            fontSize={10}
            className="fill-foreground"
          >
            {(bar.successRate * 100).toFixed(1)}%
          </text>
          <text
            x={bar.x + bar.barWidth / 2}
            y={height - 25}
            textAnchor="middle"
            fontSize={10}
            className="fill-muted-foreground"
          >
            {bar.variant}
          </text>
        </g>
      ))}

      {/* Title */}
      <text x={width / 2} y={15} textAnchor="middle" fontSize={12} fontWeight="bold" className="fill-foreground">
        Success Rate by Variant
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Line Chart — Latency Comparison
// ---------------------------------------------------------------------------

export function LatencyLineChart({ variants, width = 400, height = 200 }: ChartProps) {
  const points = useMemo(() => {
    const maxLatency = Math.max(...variants.map((v) => v.avgLatencyMs), 1);
    const chartWidth = width - 80;
    const chartHeight = height - 60;
    const stepX = variants.length > 1 ? chartWidth / (variants.length - 1) : 0;

    return variants.map((v, i) => ({
      ...v,
      x: 50 + i * stepX,
      y: 20 + chartHeight - (v.avgLatencyMs / maxLatency) * chartHeight,
    }));
  }, [variants, width, height]);

  const maxLatency = Math.max(...variants.map((v) => v.avgLatencyMs), 1);

  return (
    <svg width={width} height={height} className="rounded-lg border border-border bg-background">
      {/* Y-axis */}
      <line x1={40} y1={20} x2={40} y2={height - 40} stroke="currentColor" strokeWidth={1} className="text-muted-foreground" />
      {/* X-axis */}
      <line x1={40} y1={height - 40} x2={width - 10} y2={height - 40} stroke="currentColor" strokeWidth={1} className="text-muted-foreground" />

      {/* Y-axis labels */}
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
        const y = height - 40 - tick * (height - 60);
        return (
          <g key={tick}>
            <line x1={35} y1={y} x2={40} y2={y} stroke="currentColor" strokeWidth={1} className="text-muted-foreground" />
            <text x={30} y={y + 4} textAnchor="end" fontSize={10} className="fill-muted-foreground">
              {(maxLatency * tick).toFixed(0)}ms
            </text>
          </g>
        );
      })}

      {/* Line */}
      {points.length > 1 && (
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="stroke-primary"
        />
      )}

      {/* Points */}
      {points.map((p) => (
        <g key={p.variant}>
          <circle cx={p.x} cy={p.y} r={4} className="fill-primary" />
          <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize={10} className="fill-foreground">
            {p.avgLatencyMs.toFixed(0)}ms
          </text>
          <text x={p.x} y={height - 25} textAnchor="middle" fontSize={10} className="fill-muted-foreground">
            {p.variant}
          </text>
        </g>
      ))}

      {/* Title */}
      <text x={width / 2} y={15} textAnchor="middle" fontSize={12} fontWeight="bold" className="fill-foreground">
        Average Latency by Variant
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Stacked Bar — Execution Distribution
// ---------------------------------------------------------------------------

export function ExecutionStackedBar({ variants, width = 400, height = 200 }: ChartProps) {
  const barData = useMemo(() => {
    const maxExecutions = Math.max(...variants.map((v) => v.executions), 1);
    const barWidth = Math.min(60, (width - 80) / variants.length - 10);
    const chartHeight = height - 60;

    return variants.map((v, i) => {
      const successHeight = (v.successes / maxExecutions) * chartHeight;
      const failureHeight = (v.failures / maxExecutions) * chartHeight;
      const x = 50 + i * (barWidth + 10);
      const ySuccess = chartHeight - successHeight + 20;
      const yFailure = ySuccess - failureHeight;
      return { ...v, x, ySuccess, yFailure, barWidth, successHeight, failureHeight };
    });
  }, [variants, width, height]);

  const maxExecutions = Math.max(...variants.map((v) => v.executions), 1);

  return (
    <svg width={width} height={height} className="rounded-lg border border-border bg-background">
      {/* Y-axis */}
      <line x1={40} y1={20} x2={40} y2={height - 40} stroke="currentColor" strokeWidth={1} className="text-muted-foreground" />
      {/* X-axis */}
      <line x1={40} y1={height - 40} x2={width - 10} y2={height - 40} stroke="currentColor" strokeWidth={1} className="text-muted-foreground" />

      {/* Y-axis labels */}
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
        const y = height - 40 - tick * (height - 60);
        return (
          <g key={tick}>
            <line x1={35} y1={y} x2={40} y2={y} stroke="currentColor" strokeWidth={1} className="text-muted-foreground" />
            <text x={30} y={y + 4} textAnchor="end" fontSize={10} className="fill-muted-foreground">
              {(maxExecutions * tick).toFixed(0)}
            </text>
          </g>
        );
      })}

      {/* Stacked bars */}
      {barData.map((bar) => (
        <g key={bar.variant}>
          {/* Success portion */}
          <rect
            x={bar.x}
            y={bar.ySuccess}
            width={bar.barWidth}
            height={bar.successHeight}
            className="fill-green-500/80"
            rx={2}
          />
          {/* Failure portion */}
          {bar.failureHeight > 0 && (
            <rect
              x={bar.x}
              y={bar.yFailure}
              width={bar.barWidth}
              height={bar.failureHeight}
              className="fill-red-500/80"
              rx={2}
            />
          )}
          <text
            x={bar.x + bar.barWidth / 2}
            y={bar.ySuccess - 5}
            textAnchor="middle"
            fontSize={10}
            className="fill-foreground"
          >
            {bar.executions}
          </text>
          <text
            x={bar.x + bar.barWidth / 2}
            y={height - 25}
            textAnchor="middle"
            fontSize={10}
            className="fill-muted-foreground"
          >
            {bar.variant}
          </text>
        </g>
      ))}

      {/* Legend */}
      <rect x={width - 100} y={30} width={12} height={12} className="fill-green-500/80" rx={2} />
      <text x={width - 85} y={40} fontSize={10} className="fill-muted-foreground">Success</text>
      <rect x={width - 100} y={48} width={12} height={12} className="fill-red-500/80" rx={2} />
      <text x={width - 85} y={58} fontSize={10} className="fill-muted-foreground">Failure</text>

      {/* Title */}
      <text x={width / 2} y={15} textAnchor="middle" fontSize={12} fontWeight="bold" className="fill-foreground">
        Execution Distribution by Variant
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Confidence Interval Plot
// ---------------------------------------------------------------------------

export function ConfidenceIntervalPlot({ variants, width = 400, height = 200 }: ChartProps) {
  const points = useMemo(() => {
    const chartWidth = width - 80;
    const chartHeight = height - 60;
    const stepX = variants.length > 1 ? chartWidth / (variants.length - 1) : 0;

    return variants.map((v, i) => {
      const p = v.successRate;
      const n = v.executions;
      // Wilson score interval
      const z = 1.96; // 95% CI
      const denominator = 1 + (z * z) / n;
      const centre = (p + (z * z) / (2 * n)) / denominator;
      const halfWidth = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;

      return {
        ...v,
        x: 50 + i * stepX,
        y: 20 + chartHeight - p * chartHeight,
        yLow: 20 + chartHeight - Math.min(p + halfWidth, 1) * chartHeight,
        yHigh: 20 + chartHeight - Math.max(p - halfWidth, 0) * chartHeight,
      };
    });
  }, [variants, width, height]);

  return (
    <svg width={width} height={height} className="rounded-lg border border-border bg-background">
      {/* Y-axis */}
      <line x1={40} y1={20} x2={40} y2={height - 40} stroke="currentColor" strokeWidth={1} className="text-muted-foreground" />
      {/* X-axis */}
      <line x1={40} y1={height - 40} x2={width - 10} y2={height - 40} stroke="currentColor" strokeWidth={1} className="text-muted-foreground" />

      {/* Y-axis labels */}
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
        const y = height - 40 - tick * (height - 60);
        return (
          <g key={tick}>
            <line x1={35} y1={y} x2={40} y2={y} stroke="currentColor" strokeWidth={1} className="text-muted-foreground" />
            <text x={30} y={y + 4} textAnchor="end" fontSize={10} className="fill-muted-foreground">
              {(tick * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}

      {/* Confidence intervals */}
      {points.map((p) => (
        <g key={p.variant}>
          {/* CI bar */}
          <line
            x1={p.x}
            y1={p.yLow}
            x2={p.x}
            y2={p.yHigh}
            stroke="currentColor"
            strokeWidth={2}
            className="stroke-primary/50"
          />
          {/* Point */}
          <circle cx={p.x} cy={p.y} r={4} className="fill-primary" />
          {/* Label */}
          <text x={p.x} y={height - 25} textAnchor="middle" fontSize={10} className="fill-muted-foreground">
            {p.variant}
          </text>
        </g>
      ))}

      {/* Title */}
      <text x={width / 2} y={15} textAnchor="middle" fontSize={12} fontWeight="bold" className="fill-foreground">
        Success Rate with 95% CI
      </text>
    </svg>
  );
}
