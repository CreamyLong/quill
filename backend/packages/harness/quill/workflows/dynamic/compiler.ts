/**
 * Dynamic Workflow Compiler — validate, lower, and fingerprint workflow
 * scripts.
 *
 * Ported from ZCode's `@zcode/dynamic-workflow` compiler pipeline
 * (`collectDiagnostics` → `collectSites` → `lowerWorkflow` → `scriptHash`),
 * pragmatically scoped: instead of a full `ts.Program` with JSON-schema
 * synthesis, this compiler performs lightweight static validation and
 * lowers the script onto a `__host` facade executed in a vm sandbox.
 *
 * Script contract (mirrors ZCode's facade):
 * - plain async body: top-level `await`, final expression = result
 * - facade calls: `agent(name, prompt)`, `ask(prompt, opts?)`,
 *   `run(command)` (compile-time string literal only — the
 *   security/user-confirmation gate), `log(...)`, `sleep(ms)`
 * - forbidden: `import` / `export` / `require` / `process` / `fs` / `fetch`
 *   (type-check failure upstream; hard error here)
 *
 * @module workflows/dynamic/compiler
 */

import crypto from "node:crypto";

/** Compile diagnostic (mirrors upstream `collectDiagnostics`). */
export interface WorkflowDiagnostic {
  message: string;
  /** 1-based line number when locatable. */
  line?: number;
}

/** Result of compiling a workflow script. */
export interface CompiledWorkflow {
  /** Lowered source: an async function body receiving `__host`. */
  lowered: string;
  /** SHA-256 of the original script text (upstream `scriptHash`). */
  scriptHash: string;
  /** Facade call sites found (upstream `collectSites`). */
  sites: WorkflowSites;
  /** Non-fatal warnings. */
  warnings: WorkflowDiagnostic[];
}

/** Facade call sites collected from the script (upstream `collectSites`). */
export interface WorkflowSites {
  agent: number;
  ask: number;
  run: number;
  log: number;
  sleep: number;
}

/** Patterns that must not appear in a workflow script. */
const FORBIDDEN_PATTERNS: Array<{ re: RegExp; message: string }> = [
  { re: /\bimport\s+[\w{"'*\s]/, message: "import statements are not allowed" },
  { re: /\bexport\s+(default\s+)?(function|class|const|let|var|type|interface)\b/, message: "export statements are not allowed" },
  { re: /\brequire\s*\(/, message: "require() is not allowed" },
  { re: /\bprocess\b/, message: "process is not available in workflow scripts" },
  { re: /\bglobalThis\b/, message: "globalThis is not available in workflow scripts" },
  { re: /\bfetch\s*\(/, message: "fetch() is not available — use run() for shell commands" },
  { re: /\b__host\b/, message: "__host is reserved for the lowered facade" },
  { re: /\bFunction\s*\(/, message: "dynamic Function() is not allowed" },
];

/** Count facade call sites (best-effort regex walk, upstream uses AST). */
function collectSites(script: string): WorkflowSites {
  const count = (re: RegExp): number => (script.match(re) ?? []).length;
  return {
    agent: count(/\bagent\s*\(/g),
    ask: count(/\bask\s*\(/g),
    run: count(/\brun\s*\(/g),
    log: count(/\blog\s*\(/g),
    sleep: count(/\bsleep\s*\(/g),
  };
}

/**
 * Compile a workflow script. Throws `WorkflowCompileError` on any forbidden
 * pattern or a non-literal `run(...)` command (the upstream compile-time
 * string-literal gate for shell commands).
 */
export function compileWorkflowScript(script: string): CompiledWorkflow {
  const warnings: WorkflowDiagnostic[] = [];

  for (const { re, message } of FORBIDDEN_PATTERNS) {
    const match = re.exec(script);
    if (match !== null) {
      const line = script.slice(0, match.index).split("\n").length;
      throw new WorkflowCompileError(message, line);
    }
  }

  // String-literal gate: every run("...") command must be a compile-time
  // literal (upstream: `world.run`'s first argument must be a string
  // literal — the security/user-confirmation gate).
  const runCall = /\brun\s*\(\s*([^)]*?)\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = runCall.exec(script)) !== null) {
    const firstArg = match[1].split(",")[0].trim();
    if (firstArg === "" || !/^(['"]).*\1$/.test(firstArg)) {
      const line = script.slice(0, match.index).split("\n").length;
      throw new WorkflowCompileError(
        `run() commands must be string literals (got: ${firstArg.slice(0, 40) || "empty"})`,
        line,
      );
    }
  }

  // Balanced braces/parens sanity (cheap structural check).
  const pairs: Array<[string, string]> = [
    ["{", "}"],
    ["(", ")"],
    ["[", "]"],
  ];
  for (const [open, close] of pairs) {
    const opens = (script.match(new RegExp(`\\${open}`, "g")) ?? []).length;
    const closes = (script.match(new RegExp(`\\${close}`, "g")) ?? []).length;
    if (opens !== closes) {
      throw new WorkflowCompileError(`unbalanced ${open}${close} (${opens} vs ${closes})`);
    }
  }

  const sites = collectSites(script);
  if (sites.agent === 0 && sites.ask === 0 && sites.run === 0) {
    warnings.push({
      message: "script calls no facade APIs (agent/ask/run) — it will do no work",
    });
  }

  // Lower: wrap as an async function body receiving the __host facade.
  // Bare identifiers (agent, ask, run, log, sleep) are rewritten onto it.
  const body = script
    .replace(/\bagent\s*\(/g, "__host.agent(")
    .replace(/\bask\s*\(/g, "__host.ask(")
    .replace(/\brun\s*\(/g, "__host.run(")
    .replace(/\blog\s*\(/g, "__host.log(")
    .replace(/\bsleep\s*\(/g, "__host.sleep(")
    .replace(/\bescalate\s*\(/g, "__host.escalate(");
  const lowered = `(async (__host) => {\n${body}\n})`;

  return {
    lowered,
    scriptHash: crypto.createHash("sha256").update(script).digest("hex"),
    sites,
    warnings,
  };
}

/** Error thrown when a workflow script fails compilation. */
export class WorkflowCompileError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(line !== undefined ? `${message} (line ${line})` : message);
    this.name = "WorkflowCompileError";
  }
}
