/**
 * Dynamic Workflow Engine — execute a lowered workflow script against a
 * driver, journaling every step.
 *
 * Ported from ZCode's `@zcode/dynamic-workflow-runtime`
 * (`runWorkflowScript` + `AskScheduler` + `WorkflowDriver`): the engine is
 * deterministic orchestration only; all side effects (spawning actor
 * sessions, running asks, executing shell commands) live behind the
 * `WorkflowDriver` interface. The script runs in a `node:vm` context whose
 * only globals are the `__host` facade and a whitelist of JS builtins — no
 * `require`, no `process`, no I/O (upstream uses a child process speaking
 * NDJSON; a vm isolate gives the same boundary with less machinery).
 *
 * Escalations (the standout upstream mechanism): a workflow (or an actor
 * inside an ask) can call `escalate(question)` — the engine parks a
 * deferred promise, journals `escalation_raised`, and waits. The host
 * resolves it through the service (`resolveQuestion`), which journals
 * `escalation_resolved` and unblocks the script. Budget: max 3 escalations
 * per ask (upstream constant).
 *
 * Warm cache: `resume`/`amend` seed the engine with an `ImportedRunCache`;
 * asks whose cache key is present return the settled result immediately
 * (journal replays it as `ask_settled`) so finished work is never re-paid.
 *
 * @module workflows/dynamic/engine
 */

import vm from "node:vm";

import type { CompiledWorkflow } from "./compiler.js";
import { askCacheKey, type ImportedRunCache, type WorkflowJournal } from "./journal.js";

/** Max escalations per ask (upstream budget). */
export const MAX_ESCALATIONS_PER_ASK = 3;

/** Side-effect boundary: the engine never touches the world directly. */
export interface WorkflowDriver {
  /** Spawn (or reuse) an actor session and run it to completion. */
  createActorSession(name: string, prompt: string): Promise<unknown>;
  /** Run one ask (a subagent-style task) to completion. */
  startAsk(prompt: string, opts?: Record<string, unknown>): Promise<unknown>;
  /** Execute a shell command (compile-time literal only, enforced by the compiler). */
  runCommand(command: string): Promise<unknown>;
}

export interface RunWorkflowOptions {
  /** Journal for this run (required — "no journal, no service" upstream). */
  journal: WorkflowJournal;
  /** Driver providing the side effects. */
  driver: WorkflowDriver;
  /** Warm cache from a predecessor run (amend) or this run's journal (resume). */
  cache?: ImportedRunCache;
  /** Max concurrent asks (upstream AskScheduler). Default 4. */
  maxConcurrency?: number;
  /** Abort signal (stop / supersede). */
  signal?: AbortSignal;
  /** Per-run escalation budget override. Default: MAX_ESCALATIONS_PER_ASK. */
  maxEscalationsPerAsk?: number;
}

/** A parked escalation waiting for the host's answer. */
export interface ParkedEscalation {
  id: string;
  question: string;
  /** Resolves when the host answers; rejects when the run aborts. */
  deferred: Promise<string>;
  resolve: (answer: string) => void;
  reject: (err: Error) => void;
}

/** Handle over one running workflow. */
export interface RunningWorkflow {
  /** Settles with the script's final value. */
  completion: Promise<unknown>;
  /** Escalations currently parked (keyed by id). */
  escalations: Map<string, ParkedEscalation>;
  /** Ask the engine to stop: aborts in-flight asks and the script. */
  stop(): void;
}

/** Whitelisted globals the sandboxed script may use. */
const SANDBOX_GLOBALS: Record<string, unknown> = {
  Math,
  JSON,
  Date,
  console: { log: () => {}, warn: () => {}, error: () => {} }, // no-op: use log()
  isFinite,
  isNaN,
  parseInt,
  parseFloat,
  String,
  Number,
  Boolean,
  Array,
  Object,
  Error,
  RegExp,
  Map,
  Set,
  Promise,
};

/**
 * Run a compiled workflow script. Returns a `RunningWorkflow` handle; the
 * engine journals actor/ask/escalation events as they happen and settles
 * the journal when the script settles.
 */
export function runWorkflowScript(
  compiled: CompiledWorkflow,
  options: RunWorkflowOptions,
): RunningWorkflow {
  const { journal, driver } = options;
  const maxConcurrency = options.maxConcurrency ?? 4;
  const maxEscalations = options.maxEscalationsPerAsk ?? MAX_ESCALATIONS_PER_ASK;
  const cache = options.cache ?? { entries: new Map<string, unknown>(), inFlight: new Set<string>() };

  const escalations = new Map<string, ParkedEscalation>();
  let escalationCounter = 0;
  let askEscalationCounts = new Map<string, number>();
  let stopped = false;

  // Internal abort controller: `stop()` trips it so in-flight sleeps and
  // asks actually interrupt (an external signal is forwarded into it).
  const controller = new AbortController();
  const signal = options.signal;
  if (signal !== undefined) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }
  const internalSignal = controller.signal;

  const abortError = new Error("workflow stopped");

  function checkAborted(): void {
    if (stopped || internalSignal.aborted) {
      throw abortError;
    }
  }

  // --- AskScheduler: bounded-concurrency ask execution with warm cache ---
  let activeAsks = 0;
  const waiters: Array<() => void> = [];
  function acquireSlot(): Promise<void> {
    if (activeAsks < maxConcurrency) {
      activeAsks += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      waiters.push(() => {
        activeAsks += 1;
        resolve();
      });
    });
  }
  function releaseSlot(): void {
    activeAsks -= 1;
    const next = waiters.shift();
    if (next !== undefined) {
      next();
    }
  }

  async function performAsk(prompt: string, opts?: Record<string, unknown>): Promise<unknown> {
    checkAborted();
    const label = typeof opts?.label === "string" ? opts.label : "ask";
    const key = askCacheKey(label, { prompt, opts });
    // Warm cache: a predecessor (amend) or this run's earlier journal
    // (resume) already settled this exact ask.
    if (cache.entries.has(key)) {
      const cached = cache.entries.get(key);
      journal.append("ask_settled", { key, prompt, result: cached, cached: true });
      return cached;
    }
    await acquireSlot();
    journal.append("ask_started", { key, prompt, label });
    try {
      const result = await driver.startAsk(prompt, opts);
      checkAborted();
      journal.append("ask_settled", { key, prompt, result });
      return result;
    } finally {
      releaseSlot();
    }
  }

  // --- Facade handed to the sandboxed script ---
  const host = {
    agent: async (name: string, prompt: string): Promise<unknown> => {
      checkAborted();
      journal.append("actor_spawned", { name, prompt });
      return driver.createActorSession(name, prompt);
    },
    ask: performAsk,
    run: async (command: string): Promise<unknown> => {
      checkAborted();
      return driver.runCommand(command);
    },
    log: (...args: unknown[]): void => {
      journal.append("log", { message: args.map((a) => stringify(a)).join(" ") });
    },
    sleep: (ms: number): Promise<void> => {
      const bounded = Math.min(Math.max(Number(ms) || 0, 0), 60_000);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, bounded);
        internalSignal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(abortError);
          },
          { once: true },
        );
      });
    },
    escalate: (question: string, askKey = "ask:anonymous"): Promise<string> => {
      const used = askEscalationCounts.get(askKey) ?? 0;
      if (used >= maxEscalations) {
        throw new Error(`escalation budget exhausted for ${askKey} (max ${maxEscalations})`);
      }
      askEscalationCounts.set(askKey, used + 1);
      escalationCounter += 1;
      const id = `esc-${escalationCounter}`;
      let resolve!: (answer: string) => void;
      let reject!: (err: Error) => void;
      const deferred = new Promise<string>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const parked: ParkedEscalation = { id, question, deferred, resolve, reject };
      escalations.set(id, parked);
      journal.append("escalation_raised", { id, question, askKey });
      return deferred;
    },
  };

  function stringify(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }

  // --- Sandbox execution ---
  const context = vm.createContext({ ...SANDBOX_GLOBALS, __host: host });
  const completion = (async (): Promise<unknown> => {
    try {
      const factory = vm.runInContext(`(${compiled.lowered})`, context, {
        timeout: 5_000,
      }) as (h: typeof host) => Promise<unknown>;
      const result = await factory(host);
      journal.settle("completed", stringify(result));
      return result;
    } catch (err) {
      if (stopped || internalSignal.aborted || err === abortError) {
        journal.settle("stopped", null);
      } else {
        journal.settle("errored", stringify(err instanceof Error ? err.message : err));
      }
      throw err;
    } finally {
      // Reject any still-parked escalations so nothing dangles.
      for (const parked of escalations.values()) {
        parked.reject(abortError);
      }
      escalations.clear();
    }
  })();

  return {
    completion,
    escalations,
    stop(): void {
      stopped = true;
      controller.abort();
      for (const parked of escalations.values()) {
        parked.reject(abortError);
      }
      escalations.clear();
    },
  };
}

/**
 * Resolve a parked escalation from the host side (wired by the service's
 * `resolveQuestion`). Journals the resolution.
 */
export function respondToParkedEscalation(
  journal: WorkflowJournal,
  parked: ParkedEscalation,
  answer: string,
): void {
  journal.append("escalation_resolved", { id: parked.id, answer });
  parked.resolve(answer);
}
