/**
 * Tests for dynamic workflows (ZCode `@zcode/dynamic-workflow` sync).
 *
 * Covers compiler validation (forbidden patterns, string-literal gate,
 * lowering), engine execution (facade calls, warm cache, concurrency,
 * escalations with budget), journal replay, and the service lifecycle
 * (submit / amend with warm cache / resume / stop / orphan reconciliation).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DynamicWorkflowService,
  WorkflowCompileError,
  compileWorkflowScript,
  runWorkflowScript,
  type WorkflowDriver,
} from "../index.js";
import { WorkflowJournal } from "../journal.js";

const tempDirs: string[] = [];
function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quill-dwf-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Deterministic driver: asks echo their prompt, agents echo their name. */
function echoDriver(log: string[] = []): WorkflowDriver {
  return {
    createActorSession: async (name, prompt) => {
      log.push(`agent:${name}`);
      return `actor ${name} ran: ${prompt}`;
    },
    startAsk: async (prompt) => {
      log.push(`ask:${prompt}`);
      return `result of ${prompt}`;
    },
    runCommand: async (command) => {
      log.push(`run:${command}`);
      return `output of ${command}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

describe("compileWorkflowScript", () => {
  it("compiles a simple script and collects sites", () => {
    const compiled = compileWorkflowScript(`
      const a = await ask("research topic A");
      const b = await agent("writer", "write about " + a);
      log("done", b);
      return b;
    `);
    expect(compiled.sites).toEqual({ agent: 1, ask: 1, run: 0, log: 1, sleep: 0 });
    expect(compiled.scriptHash).toHaveLength(64);
    expect(compiled.lowered).toContain("__host.ask(");
    expect(compiled.lowered).toContain("__host.agent(");
    expect(compiled.lowered.startsWith("(async (__host) => {")).toBe(true);
  });

  it("rejects imports, require, process, and fetch", () => {
    expect(() => compileWorkflowScript('import x from "y";')).toThrow(WorkflowCompileError);
    expect(() => compileWorkflowScript('const f = require("fs");')).toThrow(WorkflowCompileError);
    expect(() => compileWorkflowScript("process.exit(1);")).toThrow(WorkflowCompileError);
    expect(() => compileWorkflowScript('await fetch("https://evil");')).toThrow(WorkflowCompileError);
    expect(() => compileWorkflowScript("globalThis.foo = 1;")).toThrow(WorkflowCompileError);
  });

  it("enforces the string-literal gate on run()", () => {
    expect(() => compileWorkflowScript('await run("ls -la");')).not.toThrow();
    expect(() => compileWorkflowScript('const c = "rm -rf"; await run(c);')).toThrow(
      /string literals/,
    );
    expect(() => compileWorkflowScript("await run(getCommand());")).toThrow(/string literals/);
  });

  it("rejects unbalanced braces", () => {
    expect(() => compileWorkflowScript("const a = { b: 1;")).toThrow(/unbalanced/);
  });

  it("warns when the script uses no facade APIs", () => {
    const compiled = compileWorkflowScript("return 42;");
    expect(compiled.warnings.some((w) => w.message.includes("no facade APIs"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

describe("runWorkflowScript", () => {
  it("executes facade calls and journals them", async () => {
    const dir = makeDir();
    const journal = new WorkflowJournal("r1", dir);
    journal.start({
      id: "r1",
      parentSessionId: null,
      scriptText: "await ask('x')",
      scriptHash: "h",
      status: "running",
      resultJson: null,
      created_at: new Date().toISOString(),
      superseded_from: null,
      resumed_from: null,
    });
    const compiled = compileWorkflowScript(`
      const research = await ask("research topic");
      const cmd = await run("git status");
      log("progress", research);
      return { research, cmd };
    `);
    const driver = echoDriver();
    const running = runWorkflowScript(compiled, { journal, driver });
    const result = (await running.completion) as { research: string; cmd: string };

    expect(result.research).toBe("result of research topic");
    expect(result.cmd).toBe("output of git status");
    const events = journal.readEvents().map((e) => e.type);
    expect(events).toContain("ask_started");
    expect(events).toContain("ask_settled");
    expect(events).toContain("log");
    expect(journal.readRecord()?.status).toBe("completed");
  });

  it("returns cached results for warm-cache hits without calling the driver", async () => {
    const dir = makeDir();
    const journal = new WorkflowJournal("r2", dir);
    journal.start({
      id: "r2",
      parentSessionId: null,
      scriptText: "await ask('x')",
      scriptHash: "h",
      status: "running",
      resultJson: null,
      created_at: new Date().toISOString(),
      superseded_from: null,
      resumed_from: null,
    });
    const calls: string[] = [];
    const driver: WorkflowDriver = {
      createActorSession: async (n) => `agent ${n}`,
      startAsk: async (p) => {
        calls.push(p);
        return "fresh";
      },
      runCommand: async (c) => `out ${c}`,
    };
    const compiled = compileWorkflowScript(`return await ask("expensive analysis", { label: "analysis" });`);
    const { askCacheKey } = await import("../journal.js");
    const cache = {
      entries: new Map([[askCacheKey("analysis", { prompt: "expensive analysis", opts: { label: "analysis" } }), "cached-result"]]),
      inFlight: new Set<string>(),
    };
    const running = runWorkflowScript(compiled, { journal, driver, cache });
    await expect(running.completion).resolves.toBe("cached-result");
    expect(calls).toEqual([]); // driver never called — cache hit
  });

  it("parks escalations and resolves them from the host", async () => {
    const dir = makeDir();
    const journal = new WorkflowJournal("r3", dir);
    journal.start({
      id: "r3",
      parentSessionId: null,
      scriptText: "escalate('q')",
      scriptHash: "h",
      status: "running",
      resultJson: null,
      created_at: new Date().toISOString(),
      superseded_from: null,
      resumed_from: null,
    });
    const compiled = compileWorkflowScript(`
      const answer = await escalate("which database?", "ask:choice");
      return answer;
    `);
    const driver = echoDriver();
    const running = runWorkflowScript(compiled, { journal, driver });

    // Wait for the escalation to park.
    let parked = [...running.escalations.values()][0];
    for (let i = 0; i < 50 && parked === undefined; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
      parked = [...running.escalations.values()][0];
    }
    expect(parked?.question).toBe("which database?");

    const { respondToParkedEscalation } = await import("../engine.js");
    respondToParkedEscalation(journal, parked, "postgres");
    await expect(running.completion).resolves.toBe("postgres");
    const types = journal.readEvents().map((e) => e.type);
    expect(types).toContain("escalation_raised");
    expect(types).toContain("escalation_resolved");
  });

  it("stops cleanly and settles the journal as stopped", async () => {
    const dir = makeDir();
    const journal = new WorkflowJournal("r4", dir);
    journal.start({
      id: "r4",
      parentSessionId: null,
      scriptText: "sleep",
      scriptHash: "h",
      status: "running",
      resultJson: null,
      created_at: new Date().toISOString(),
      superseded_from: null,
      resumed_from: null,
    });
    const compiled = compileWorkflowScript(`
      await sleep(5000);
      return "never";
    `);
    const running = runWorkflowScript(compiled, { journal, driver: echoDriver() });
    setTimeout(() => running.stop(), 20);
    await expect(running.completion).rejects.toThrow();
    expect(journal.readRecord()?.status).toBe("stopped");
  });
});

// ---------------------------------------------------------------------------
// Service lifecycle
// ---------------------------------------------------------------------------

describe("DynamicWorkflowService", () => {
  it("submit → run → completed, and get/list reflect it", async () => {
    const dir = makeDir();
    const service = new DynamicWorkflowService({ journalDir: dir, driver: echoDriver() });
    const { runId } = service.submit(
      'const a = await ask("summarize");\nreturn "done:" + a;',
      { parentSessionId: "sess-1" },
    );
    await new Promise((r) => setTimeout(r, 100));

    const run = service.get(runId);
    expect(run?.status).toBe("completed");
    expect(run?.parentSessionId).toBe("sess-1");
    expect(run?.resultJson).toContain("done:");
    expect(service.list().map((r) => r.id)).toEqual([runId]);
    expect(service.events(runId).length).toBeGreaterThan(0);
  });

  it("rejects invalid scripts at submit time", () => {
    const dir = makeDir();
    const service = new DynamicWorkflowService({ journalDir: dir, driver: echoDriver() });
    expect(() => service.submit('import x from "y";')).toThrow(WorkflowCompileError);
  });

  it("amend supersedes the predecessor and imports its cache", async () => {
    const dir = makeDir();
    const calls: string[] = [];
    const service = new DynamicWorkflowService({
      journalDir: dir,
      driver: {
        createActorSession: async (n) => `agent ${n}`,
        startAsk: async (p) => {
          calls.push(p);
          return `result of ${p}`;
        },
        runCommand: async (c) => `out ${c}`,
      },
    });
    const first = service.submit(
      'const a = await ask("same question");\nreturn a;',
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toEqual(["same question"]);

    const second = service.amend(first.runId, 'const a = await ask("same question");\nreturn a + "!"');
    await new Promise((r) => setTimeout(r, 100));

    // The identical ask was served from the imported warm cache.
    expect(calls).toEqual(["same question"]);
    expect(service.get(first.runId)?.status).toBe("superseded");
    expect(service.get(second.runId)?.superseded_from).toBe(first.runId);
    const run = service.get(second.runId);
    expect(run?.status).toBe("completed");
    expect(run?.resultJson).toContain("!");
  });

  it("resume rebuilds the cache from the run's own journal", async () => {
    const dir = makeDir();
    const calls: string[] = [];
    const service = new DynamicWorkflowService({
      journalDir: dir,
      driver: {
        createActorSession: async (n) => `agent ${n}`,
        startAsk: async (p) => {
          calls.push(p);
          return `result of ${p}`;
        },
        runCommand: async (c) => `out ${c}`,
      },
    });
    const first = service.submit('const a = await ask("only ask");\nreturn a;');
    await new Promise((r) => setTimeout(r, 100));
    expect(service.get(first.runId)?.status).toBe("completed");

    const resumed = service.resume(first.runId);
    await new Promise((r) => setTimeout(r, 100));
    // "only ask" was settled in the predecessor journal → served warm.
    expect(calls).toEqual(["only ask"]);
    expect(service.get(resumed.runId)?.resumed_from).toBe(first.runId);
    expect(service.get(resumed.runId)?.status).toBe("completed");
  });

  it("stop aborts a live run and settles it", async () => {
    const dir = makeDir();
    const service = new DynamicWorkflowService({ journalDir: dir, driver: echoDriver() });
    const { runId } = service.submit("await sleep(30000);\nreturn 1;");
    await new Promise((r) => setTimeout(r, 50));
    expect(await service.stop(runId)).toBe(true);
    expect(service.get(runId)?.status).toBe("stopped");
    expect(await service.stop(runId)).toBe(false); // no longer live
  });

  it("reconciles orphaned running journals on construction", () => {
    const dir = makeDir();
    // Simulate a crashed run: journal says running, no live engine.
    const orphan = new WorkflowJournal("orphan-1", dir);
    orphan.start({
      id: "orphan-1",
      parentSessionId: null,
      scriptText: "1",
      scriptHash: "h",
      status: "running",
      resultJson: null,
      created_at: new Date().toISOString(),
      superseded_from: null,
      resumed_from: null,
    });
    const service = new DynamicWorkflowService({ journalDir: dir, driver: echoDriver() });
    expect(service.get("orphan-1")?.status).toBe("stopped");
  });

  it("resolveQuestion answers a live run's escalation", async () => {
    const dir = makeDir();
    const service = new DynamicWorkflowService({ journalDir: dir, driver: echoDriver() });
    const { runId } = service.submit('return await escalate("pick one", "ask:pick");');
    await new Promise((r) => setTimeout(r, 50));
    const escalations = service.listEscalations(runId);
    expect(escalations).toHaveLength(1);
    expect(service.resolveQuestion(runId, escalations[0].id, "choice B")).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(service.get(runId)?.status).toBe("completed");
  });
});
