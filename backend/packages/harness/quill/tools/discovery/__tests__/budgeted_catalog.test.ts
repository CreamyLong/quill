/**
 * Tests for budgeted tool catalog.
 */

import { describe, expect, it } from "vitest";

import { BudgetedCatalog, estimateTokenCost, type CatalogTool } from "../budgeted_catalog.js";

function makeTool(name: string, namespace: string, tokenCost: number, tags: string[] = []): CatalogTool {
  return {
    name,
    description: `Tool ${name} in ${namespace}`,
    namespace,
    tokenCost,
    tags,
    inputSchema: { type: "object", properties: { input: { type: "string" } } },
  };
}

describe("budgeted catalog", () => {
  describe("estimateTokenCost", () => {
    it("estimates based on total character length", () => {
      const cost = estimateTokenCost({
        name: "test",
        description: "a".repeat(100),
        namespace: "ns",
      });
      // (100 + 4 + 50) / 4 = 38.5 -> ceil = 39
      expect(cost).toBe(39);
    });

    it("includes schema in cost estimation", () => {
      const cost = estimateTokenCost({
        name: "test",
        description: "desc",
        namespace: "ns",
        inputSchema: { type: "object", properties: { a: { type: "string" }, b: { type: "number" } } },
      });
      expect(cost).toBeGreaterThan(0);
    });
  });

  describe("round_robin strategy", () => {
    it("allocates one tool per namespace before a second", () => {
      const tools = [
        makeTool("a1", "ns-a", 10),
        makeTool("a2", "ns-a", 10),
        makeTool("b1", "ns-b", 10),
        makeTool("b2", "ns-b", 10),
      ];
      const catalog = new BudgetedCatalog(tools, { tokenBudget: 30, strategy: "round_robin" });
      const visible = catalog.getVisibleTools();

      // Should get a1, b1, a2 (round-robin), but not b2 (budget: 30 = 3 tools)
      expect(visible.length).toBe(3);
      const nsANames = visible.filter((t) => t.namespace === "ns-a").map((t) => t.name);
      const nsBNames = visible.filter((t) => t.namespace === "ns-b").map((t) => t.name);
      expect(nsANames).toContain("a1");
      expect(nsBNames).toContain("b1");
    });

    it("respects token budget", () => {
      const tools = [
        makeTool("big", "ns", 100),
        makeTool("small", "ns", 10),
      ];
      const catalog = new BudgetedCatalog(tools, { tokenBudget: 50, strategy: "round_robin" });
      const visible = catalog.getVisibleTools();
      expect(visible.length).toBe(1);
      expect(visible[0].name).toBe("small");
    });
  });

  describe("greedy strategy", () => {
    it("fills largest namespaces first", () => {
      const tools = [
        makeTool("a1", "ns-a", 50),
        makeTool("a2", "ns-a", 50),
        makeTool("b1", "ns-b", 10),
        makeTool("b2", "ns-b", 10),
      ];
      const catalog = new BudgetedCatalog(tools, { tokenBudget: 70, strategy: "greedy" });
      const visible = catalog.getVisibleTools();
      // ns-a total=100, ns-b total=20. Greedy picks ns-a first but can't fit.
      // Then ns-b fits both tools.
      const totalCost = catalog.getUsedBudget();
      expect(totalCost).toBeLessThanOrEqual(70);
    });
  });

  describe("priority strategy", () => {
    it("respects namespace priority ordering", () => {
      const tools = [
        makeTool("a1", "ns-a", 10),
        makeTool("b1", "ns-b", 10),
        makeTool("c1", "ns-c", 10),
      ];
      const catalog = new BudgetedCatalog(tools, {
        tokenBudget: 20,
        strategy: "priority",
        namespacePriority: ["ns-c", "ns-a"],
      });
      const visible = catalog.getVisibleTools();
      const namespaces = visible.map((t) => t.namespace);
      // ns-c and ns-a should be included, ns-c first
      expect(namespaces).toContain("ns-c");
      expect(namespaces).toContain("ns-a");
    });
  });

  describe("search", () => {
    const tools = [
      makeTool("create-issue", "github", 10, ["issue", "create"]),
      makeTool("list-repos", "github", 10, ["repo", "list"]),
      makeTool("send-message", "slack", 10, ["message", "send"]),
    ];

    it("scores exact name match highest", () => {
      const catalog = new BudgetedCatalog(tools, { tokenBudget: 100 });
      const results = catalog.search("create-issue");
      expect(results[0].name).toBe("create-issue");
    });

    it("matches by tag", () => {
      const catalog = new BudgetedCatalog(tools, { tokenBudget: 100 });
      const results = catalog.search("message");
      expect(results.some((t) => t.name === "send-message")).toBe(true);
    });

    it("matches by namespace", () => {
      const catalog = new BudgetedCatalog(tools, { tokenBudget: 100 });
      const results = catalog.search("slack");
      expect(results.some((t) => t.name === "send-message")).toBe(true);
    });

    it("returns empty for no match", () => {
      const catalog = new BudgetedCatalog(tools, { tokenBudget: 100 });
      const results = catalog.search("nonexistent-xyz");
      expect(results.length).toBe(0);
    });

    it("respects limit parameter", () => {
      const catalog = new BudgetedCatalog(tools, { tokenBudget: 100 });
      const results = catalog.search("", 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("budget tracking", () => {
    it("tracks used and remaining budget", () => {
      const tools = [makeTool("a", "ns", 30), makeTool("b", "ns", 40)];
      const catalog = new BudgetedCatalog(tools, { tokenBudget: 100 });
      catalog.getVisibleTools();
      expect(catalog.getUsedBudget()).toBe(70);
      expect(catalog.getRemainingBudget()).toBe(30);
    });
  });

  describe("getTool and getAllTools", () => {
    it("finds tool by exact name", () => {
      const tools = [makeTool("find-me", "ns", 10)];
      const catalog = new BudgetedCatalog(tools, { tokenBudget: 100 });
      expect(catalog.getTool("find-me")?.name).toBe("find-me");
      expect(catalog.getTool("not-found")).toBeNull();
    });

    it("returns all tools regardless of budget", () => {
      const tools = [makeTool("a", "ns", 100), makeTool("b", "ns", 100)];
      const catalog = new BudgetedCatalog(tools, { tokenBudget: 50 });
      expect(catalog.getAllTools().length).toBe(2);
    });
  });
});
