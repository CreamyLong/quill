/**
 * Tests for delegation acceptance criteria (DeerFlow 2.1.0 sync).
 *
 * Covers the criterion grammar (file exists / non-empty, file_written,
 * tests_passed anchoring), workspace path scoping, unverified fallbacks,
 * and result rendering.
 */

import { describe, expect, it } from "vitest";

import {
  checkAcceptanceCriteria,
  checkAcceptanceCriterion,
  executionAnchorsTestsPassed,
  hasTestSummaryShape,
  renderAcceptanceResults,
  scopeCriterionPath,
  type AcceptanceCheckContext,
} from "../acceptance_checks.js";

function makeCtx(files: Record<string, string> = {}, executions: AcceptanceCheckContext["executions"] = []): AcceptanceCheckContext {
  return {
    workspaceRoot: "/tmp/ws",
    statFile: (rel) => (rel in files ? { size: files[rel].length } : null),
    readFile: (rel) => (rel in files ? files[rel] : null),
    executions,
  };
}

describe("scopeCriterionPath", () => {
  it("resolves relative paths inside the root", () => {
    expect(scopeCriterionPath("src/a.ts", "/tmp/ws")).toBe("src/a.ts");
    expect(scopeCriterionPath("./src/../src/a.ts", "/tmp/ws")).toBe("src/a.ts");
  });

  it("accepts absolute paths inside the root", () => {
    expect(scopeCriterionPath("/tmp/ws/out/report.md", "/tmp/ws")).toBe("out/report.md");
  });

  it("rejects escapes via .. and absolute paths outside the root", () => {
    expect(scopeCriterionPath("../outside.txt", "/tmp/ws")).toBeNull();
    expect(scopeCriterionPath("/etc/passwd", "/tmp/ws")).toBeNull();
    expect(scopeCriterionPath("", "/tmp/ws")).toBeNull();
  });
});

describe("checkAcceptanceCriterion", () => {
  it("verifies file exists", () => {
    const ctx = makeCtx({ "src/a.ts": "export {};" });
    expect(checkAcceptanceCriterion("file:src/a.ts exists", ctx).verdict).toBe("holds");
    expect(checkAcceptanceCriterion("file:src/missing.ts exists", ctx).verdict).toBe("does_not_hold");
  });

  it("verifies file non-empty", () => {
    const ctx = makeCtx({ "full.txt": "data", "empty.txt": "" });
    expect(checkAcceptanceCriterion("file:full.txt non-empty", ctx).verdict).toBe("holds");
    expect(checkAcceptanceCriterion("file:empty.txt non-empty", ctx).verdict).toBe("does_not_hold");
  });

  it("verifies file_written as exists + readable", () => {
    const ctx = makeCtx({ "out.md": "# report" });
    expect(checkAcceptanceCriterion("file_written:out.md", ctx).verdict).toBe("holds");
    expect(checkAcceptanceCriterion("file_written:gone.md", ctx).verdict).toBe("does_not_hold");
  });

  it("rejects criterion paths that escape the workspace", () => {
    const ctx = makeCtx({});
    const result = checkAcceptanceCriterion("file:../etc/passwd exists", ctx);
    expect(result.verdict).toBe("does_not_hold");
    expect(result.detail).toContain("escapes the workspace root");
  });

  it("anchors tests_passed to a successful recorded run with test-summary output", () => {
    const ctx = makeCtx(
      {},
      [
        { command: "npm test -- --run", status: "success", output: "Test Files 3 passed (3)\nTests 12 passed (12)" },
      ],
    );
    expect(checkAcceptanceCriterion("tests_passed:npm test", ctx).verdict).toBe("holds");
  });

  it("does not hold when the recorded run failed", () => {
    const ctx = makeCtx(
      {},
      [{ command: "npm test", status: "error", output: "Tests 1 failed | 2 passed" }],
    );
    const result = checkAcceptanceCriterion("tests_passed:npm test", ctx);
    expect(result.verdict).toBe("does_not_hold");
  });

  it("does not hold when the recorded run succeeded but output has no test-summary shape", () => {
    const ctx = makeCtx(
      {},
      [{ command: "npm test", status: "success", output: "build finished ok" }],
    );
    expect(checkAcceptanceCriterion("tests_passed:npm test", ctx).verdict).toBe("does_not_hold");
  });

  it("does not hold when no run of the command was recorded at all", () => {
    const ctx = makeCtx({}, [{ command: "ls -la", status: "success", output: "file1\nfile2" }]);
    const result = checkAcceptanceCriterion("tests_passed:npm test", ctx);
    expect(result.verdict).toBe("does_not_hold");
    expect(result.detail).toContain("no successful recorded run");
  });

  it("returns unverified for unrecognized criterion formats", () => {
    const ctx = makeCtx({});
    expect(checkAcceptanceCriterion("the code looks good", ctx).verdict).toBe("unverified");
    expect(checkAcceptanceCriterion("lint_passed:eslint .", ctx).verdict).toBe("unverified");
  });
});

describe("executionAnchorsTestsPassed", () => {
  it("matches exact, suffixed, and substring commands", () => {
    const exec = { command: "npm test -- --run", status: "success" as const, output: "3 tests passed" };
    expect(executionAnchorsTestsPassed(exec, "npm test -- --run")).toBe(true);
    expect(executionAnchorsTestsPassed(exec, "npm test")).toBe(true);
    expect(executionAnchorsTestsPassed(exec, "test -- --run")).toBe(true);
    expect(executionAnchorsTestsPassed(exec, "pytest")).toBe(false);
  });
});

describe("hasTestSummaryShape", () => {
  it("recognizes common test runner outputs", () => {
    expect(hasTestSummaryShape("Tests 12 passed (12)")).toBe(true);
    expect(hasTestSummaryShape("3 tests, 2 passed, 1 failed")).toBe(true);
    expect(hasTestSummaryShape("✓ does the thing")).toBe(true);
    expect(hasTestSummaryShape("PASS src/a.test.ts")).toBe(true);
    expect(hasTestSummaryShape("Test Files  5 passed")).toBe(true);
  });

  it("rejects non-test output", () => {
    expect(hasTestSummaryShape("hello world")).toBe(false);
    expect(hasTestSummaryShape("")).toBe(false);
  });
});

describe("checkAcceptanceCriteria + renderAcceptanceResults", () => {
  it("checks every criterion and renders a verdict block", () => {
    const ctx = makeCtx(
      { "out/report.md": "# Report", "empty.txt": "" },
      [{ command: "npm test", status: "success", output: "Tests 5 passed (5)" }],
    );
    const results = checkAcceptanceCriteria(
      ["file:out/report.md exists", "file:empty.txt non-empty", "tests_passed:npm test", "vibes: good"],
      ctx,
    );
    expect(results.map((r) => r.verdict)).toEqual([
      "holds",
      "does_not_hold",
      "holds",
      "unverified",
    ]);
    const rendered = renderAcceptanceResults(results);
    expect(rendered).toContain("NOT fully verified");
    expect(rendered).toContain("✓ file:out/report.md exists — holds");
    expect(rendered).toContain("✗ file:empty.txt non-empty — does_not_hold");
    expect(rendered).toContain("? vibes: good — unverified");
  });

  it("renders an all-hold header when everything holds", () => {
    const ctx = makeCtx({ "a.txt": "x" });
    const rendered = renderAcceptanceResults(checkAcceptanceCriteria(["file:a.txt exists"], ctx));
    expect(rendered).toContain("ALL HOLD");
  });

  it("renders nothing for an empty criteria list", () => {
    expect(renderAcceptanceResults([])).toBe("");
  });
});
