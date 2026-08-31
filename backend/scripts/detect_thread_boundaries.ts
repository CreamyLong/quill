#!/usr/bin/env tsx
/**
 * detect-thread-boundaries — Inventory backend executor/thread/event-loop
 * boundaries.
 *
 * Mirrors the DeerFlow 2.0 `make detect-thread-boundaries` target.
 *
 * Scans the backend source for:
 *   - Async functions that may run blocking I/O on the event loop
 *   - Thread pool usage (scheduler, execution pools)
 *   - Event loop boundary crossings (async → sync → async)
 *   - Process-local singletons that need multi-worker coordination
 *
 * Run from backend/:
 *   npx tsx scripts/detect_thread_boundaries.ts
 *
 * Run from repo root:
 *   npx tsx backend/scripts/detect_thread_boundaries.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SEARCH_DIRS = ["packages/harness/quill", "app", "scripts"];
const FILE_EXTENSIONS = [".ts"];
const EXCLUDE_DIRS = ["node_modules", "dist", ".scitops", "tests", "__tests__"];

// Patterns that indicate potential event-loop boundary issues.
const BOUNDARY_PATTERNS = [
  {
    pattern: /\bsetTimeout\s*\(/g,
    description: "setTimeout usage (potential timer drift in tests)",
    severity: "info" as const,
  },
  {
    pattern: /\bsetInterval\s*\(/g,
    description: "setInterval usage (potential timer drift in tests)",
    severity: "info" as const,
  },
  {
    pattern: /\bnew\s+Thread\b/g,
    description: "Explicit thread creation",
    severity: "warn" as const,
  },
  {
    pattern: /\.invoke\s*\(/g,
    description: "Synchronous LangChain invoke (consider .ainvoke)",
    severity: "warn" as const,
  },
  {
    pattern: /\bexecSync\s*\(/g,
    description: "Synchronous process execution (blocks event loop)",
    severity: "error" as const,
  },
  {
    pattern: /\breadFileSync\s*\(/g,
    description: "Synchronous file read (blocks event loop)",
    severity: "error" as const,
  },
  {
    pattern: /\bwriteFileSync\s*\(/g,
    description: "Synchronous file write (blocks event loop)",
    severity: "error" as const,
  },
  {
    pattern: /\bThreadPool\b/g,
    description: "Thread pool usage (document event-loop boundary)",
    severity: "warn" as const,
  },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BoundaryFinding {
  file: string;
  line: number;
  column: number;
  severity: "info" | "warn" | "error";
  description: string;
  code: string;
}

interface BoundaryReport {
  findings: BoundaryFinding[];
  scannedFiles: number;
  scannedLines: number;
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

function resolveSearchRoots(): string[] {
  const cwd = process.cwd();
  const roots: string[] = [];

  for (const dir of SEARCH_DIRS) {
    const resolved = path.isAbsolute(dir) ? dir : path.join(cwd, dir);
    if (fs.existsSync(resolved)) {
      roots.push(resolved);
    }
  }

  return roots;
}

function collectFiles(dir: string, exts: string[]): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.includes(entry.name)) {
        continue;
      }
      files.push(...collectFiles(fullPath, exts));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (exts.includes(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function scanFile(filePath: string): BoundaryFinding[] {
  const findings: BoundaryFinding[] = [];
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const bp of BOUNDARY_PATTERNS) {
      // Reset lastIndex for global regexes.
      bp.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = bp.pattern.exec(line)) !== null) {
        findings.push({
          file: filePath,
          line: i + 1,
          column: match.index + 1,
          severity: bp.severity,
          description: bp.description,
          code: line.trim(),
        });
      }
    }
  }

  return findings;
}

function scanBoundaryFiles(roots: string[]): BoundaryReport {
  const allFiles: string[] = [];
  for (const root of roots) {
    allFiles.push(...collectFiles(root, FILE_EXTENSIONS));
  }

  const findings: BoundaryFinding[] = [];
  let scannedLines = 0;

  for (const file of allFiles) {
    const content = fs.readFileSync(file, "utf-8");
    scannedLines += content.split("\n").length;
    findings.push(...scanFile(file));
  }

  return {
    findings,
    scannedFiles: allFiles.length,
    scannedLines,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function formatReport(report: BoundaryReport): string {
  const lines: string[] = [];
  lines.push("=== Thread Boundary Detection Report ===\n");
  lines.push(`Scanned ${report.scannedFiles} files (${report.scannedLines} lines)\n`);

  // Group by severity.
  const errors = report.findings.filter((f) => f.severity === "error");
  const warns = report.findings.filter((f) => f.severity === "warn");
  const infos = report.findings.filter((f) => f.severity === "info");

  if (errors.length > 0) {
    lines.push(`\n--- ERRORS (${errors.length}) ---`);
    for (const f of errors) {
      lines.push(`  [ERROR] ${f.file}:${f.line}:${f.column}  ${f.description}`);
      lines.push(`          ${f.code}`);
    }
  }

  if (warns.length > 0) {
    lines.push(`\n--- WARNINGS (${warns.length}) ---`);
    for (const f of warns) {
      lines.push(`  [WARN] ${f.file}:${f.line}:${f.column}  ${f.description}`);
      lines.push(`         ${f.code}`);
    }
  }

  if (infos.length > 0) {
    lines.push(`\n--- INFO (${infos.length}) ---`);
    for (const f of infos) {
      lines.push(`  [INFO] ${f.file}:${f.line}:${f.column}  ${f.description}`);
    }
  }

  if (report.findings.length === 0) {
    lines.push("\nNo boundary issues detected.");
  }

  lines.push(
    `\nSummary: ${errors.length} errors, ${warns.length} warnings, ${infos.length} info.`
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const roots = resolveSearchRoots();
  if (roots.length === 0) {
    console.error("No search directories found. Run from the backend/ or repo root.");
    process.exit(1);
  }

  console.log(`Scanning: ${roots.join(", ")}\n`);
  const report = scanBoundaryFiles(roots);
  console.log(formatReport(report));

  // Exit with error code if there are blocking-IO errors.
  const errorCount = report.findings.filter((f) => f.severity === "error").length;
  if (errorCount > 0) {
    process.exit(1);
  }
}

main();
