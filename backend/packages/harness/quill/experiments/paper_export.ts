/**
 * Paper Export — generate publication-ready documents from experiment results.
 *
 * Researchers can export their benchmark results as:
 *   - LaTeX papers (with tables, figures, and statistical analysis)
 *   - Markdown reports (for arXiv, GitHub, or documentation)
 *   - CSV data (for further analysis in R, Python, etc.)
 *
 * Inspired by:
 *   - DeerFlow's benchmark.md report generation
 *   - OpenWork's eval report with assertions and evidence
 *   - awesome-harness-engineering's reproducible research practices
 *
 * @module experiments/paper_export
 */

import type { BenchmarkRunResult } from "./benchmark.js";

// ---------------------------------------------------------------------------
// LaTeX Export
// ---------------------------------------------------------------------------

/**
 * Generate a LaTeX paper from benchmark results.
 */
export function generateLatexPaper(result: BenchmarkRunResult, options?: {
  title?: string;
  authors?: string;
  abstract?: string;
}): string {
  const title = options?.title ?? "Benchmark Analysis: " + result.name;
  const authors = options?.authors ?? "Quill Research Platform";
  const abstract = options?.abstract ?? result.summary;

  const lines: string[] = [];

  lines.push("\\documentclass{article}");
  lines.push("\\usepackage{booktabs}");
  lines.push("\\usepackage{graphicx}");
  lines.push("\\usepackage{siunitx}");
  lines.push("\\usepackage{hyperref}");
  lines.push("");
  lines.push("\\title{" + escapeLatex(title) + "}");
  lines.push("\\author{" + escapeLatex(authors) + "}");
  lines.push("\\date{" + new Date().toISOString().split("T")[0] + "}");
  lines.push("");
  lines.push("\\begin{document}");
  lines.push("\\maketitle");
  lines.push("");

  // Abstract
  lines.push("\\begin{abstract}");
  lines.push(escapeLatex(abstract));
  lines.push("\\end{abstract}");
  lines.push("");

  // Introduction
  lines.push("\\section{Introduction}");
  lines.push("This paper presents a comprehensive benchmark analysis comparing " + result.models.length + " models across " + (result.models[0]?.perTaskResults.length ?? 0) + " tasks. The evaluation was conducted using the Quill research platform, ensuring reproducible and statistically rigorous results.");
  lines.push("");

  // Methodology
  lines.push("\\section{Methodology}");
  lines.push("\\subsection{Models}");
  lines.push("We evaluated the following models:");
  lines.push("\\begin{itemize}");
  for (const m of result.models) {
    lines.push("  \\item \\textbf{" + escapeLatex(m.model.name) + "} (" + escapeLatex(m.model.provider) + ")");
  }
  lines.push("\\end{itemize}");
  lines.push("");

  lines.push("\\subsection{Benchmark Suite}");
  lines.push("The benchmark suite consisted of " + (result.models[0]?.perTaskResults.length ?? 0) + " tasks designed to evaluate model performance across various categories and difficulty levels.");
  lines.push("");

  // Results
  lines.push("\\section{Results}");
  lines.push("\\subsection{Overall Performance}");
  lines.push("");
  lines.push("\\begin{table}[h]");
  lines.push("\\centering");
  lines.push("\\caption{Model Performance Summary}");
  lines.push("\\begin{tabular}{lrrrr}");
  lines.push("\\toprule");
  lines.push("Model & Pass Rate & Mean Score & Latency (ms) & Cost (\\$) \\\\");
  lines.push("\\midrule");
  for (const m of result.models) {
    lines.push(escapeLatex(m.model.name) + " & " + (m.passRate * 100).toFixed(1) + "\\% & " + m.meanScore.toFixed(3) + " & " + m.meanLatencyMs.toFixed(0) + " & " + m.totalCost.toFixed(4) + " \\\\");
  }
  lines.push("\\bottomrule");
  lines.push("\\end{tabular}");
  lines.push("\\end{table}");
  lines.push("");

  // Comparisons
  if (result.comparisons.length > 0) {
    lines.push("\\subsection{Pairwise Comparisons}");
    lines.push("");
    lines.push("\\begin{table}[h]");
    lines.push("\\centering");
    lines.push("\\caption{Pairwise Model Comparisons}");
    lines.push("\\begin{tabular}{lrrrr}");
    lines.push("\\toprule");
    lines.push("Comparison & $\\Delta$ Pass Rate & $\\Delta$ Score & $\\Delta$ Latency & Winner \\\\");
    lines.push("\\midrule");
    for (const c of result.comparisons) {
      const winner = c.winner ?? "Tie";
      lines.push(escapeLatex(c.modelA) + " vs " + escapeLatex(c.modelB) + " & " + (c.passRateDiff * 100).toFixed(1) + "\\% & " + c.scoreDiff.toFixed(3) + " & " + c.latencyDiff.toFixed(0) + " & " + escapeLatex(winner) + " \\\\");
    }
    lines.push("\\bottomrule");
    lines.push("\\end{tabular}");
    lines.push("\\end{table}");
    lines.push("");
  }

  // Recommendations
  if (result.recommendations.length > 0) {
    lines.push("\\section{Recommendations}");
    lines.push("\\begin{itemize}");
    for (const rec of result.recommendations) {
      lines.push("  \\item " + escapeLatex(rec));
    }
    lines.push("\\end{itemize}");
    lines.push("");
  }

  // Conclusion
  lines.push("\\section{Conclusion}");
  lines.push(escapeLatex(result.summary));
  if (result.winner) {
    lines.push("");
    lines.push("The \\textbf{" + escapeLatex(result.winner) + "} model demonstrated the best overall performance in this benchmark.");
  }
  lines.push("");

  // References
  lines.push("\\begin{thebibliography}{9}");
  lines.push("\\bibitem{quill} Quill Research Platform. \\textit{https://github.com/quill-research/quill}");
  lines.push("\\end{thebibliography}");
  lines.push("");

  lines.push("\\end{document}");

  return lines.join("\n");
}

function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

// ---------------------------------------------------------------------------
// Markdown Export
// ---------------------------------------------------------------------------

/**
 * Generate a Markdown report from benchmark results.
 */
export function generateMarkdownReport(result: BenchmarkRunResult, options?: {
  title?: string;
}): string {
  const title = options?.title ?? "Benchmark Report: " + result.name;
  const lines: string[] = [];

  lines.push("# " + title);
  lines.push("");
  lines.push("**Generated:** " + result.finishedAt);
  lines.push("**Run ID:** " + result.runId);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(result.summary);
  lines.push("");

  // Results Table
  lines.push("## Model Performance");
  lines.push("");
  lines.push("| Model | Pass Rate | Mean Score | Avg Latency | Total Tokens | Cost |");
  lines.push("|-------|-----------|------------|-------------|--------------|------|");
  for (const m of result.models) {
    lines.push("| " + m.model.name + " | " + (m.passRate * 100).toFixed(1) + "% | " + m.meanScore.toFixed(3) + " | " + m.meanLatencyMs.toFixed(0) + "ms | " + m.totalTokens.toLocaleString() + " | $" + m.totalCost.toFixed(4) + " |");
  }
  lines.push("");

  // Comparisons
  if (result.comparisons.length > 0) {
    lines.push("## Pairwise Comparisons");
    lines.push("");
    lines.push("| Comparison | Pass Rate Diff | Score Diff | Latency Diff | Winner |");
    lines.push("|------------|---------------|------------|--------------|--------|");
    for (const c of result.comparisons) {
      lines.push("| " + c.modelA + " vs " + c.modelB + " | " + (c.passRateDiff * 100).toFixed(1) + "% | " + c.scoreDiff.toFixed(3) + " | " + c.latencyDiff.toFixed(0) + "ms | " + (c.winner ?? "Tie") + " |");
    }
    lines.push("");
  }

  // Per-Task Results
  lines.push("## Per-Task Results");
  lines.push("");
  for (const m of result.models) {
    lines.push("### " + m.model.name);
    lines.push("");
    lines.push("| Task | Category | Difficulty | Score | Passed | Duration | Tokens |");
    lines.push("|------|----------|------------|-------|--------|----------|--------|");
    for (const t of m.perTaskResults) {
      lines.push("| " + t.taskName + " | " + t.category + " | " + (t.difficulty ?? "N/A") + " | " + t.score.toFixed(3) + " | " + (t.passed ? "✓" : "✗") + " | " + t.durationMs.toFixed(0) + "ms | " + t.tokens.toLocaleString() + " |");
    }
    lines.push("");
  }

  // Recommendations
  if (result.recommendations.length > 0) {
    lines.push("## Recommendations");
    lines.push("");
    for (const rec of result.recommendations) {
      lines.push("- " + rec);
    }
    lines.push("");
  }

  // Footer
  lines.push("---");
  lines.push("*Generated by Quill Research Platform*");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CSV Export
// ---------------------------------------------------------------------------

/**
 * Generate CSV data from benchmark results.
 */
export function generateCSV(result: BenchmarkRunResult): string {
  const lines: string[] = [];

  // Header
  lines.push("model_id,model_name,provider,task_id,task_name,category,difficulty,score,passed,duration_ms,tokens,cost");

  // Data rows
  for (const m of result.models) {
    for (const t of m.perTaskResults) {
      const cost = (m.model.costPerInputToken ?? 0) * t.tokens;
      lines.push([
        m.model.id,
        '"' + m.model.name + '"',
        m.model.provider,
        t.taskId,
        '"' + t.taskName + '"',
        t.category,
        t.difficulty ?? "",
        t.score.toFixed(4),
        t.passed ? "true" : "false",
        t.durationMs.toFixed(0),
        t.tokens,
        cost.toFixed(6),
      ].join(","));
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// JSON Export
// ---------------------------------------------------------------------------

/**
 * Generate a JSON export of benchmark results.
 */
export function generateJSON(result: BenchmarkRunResult): string {
  return JSON.stringify(result, null, 2);
}
