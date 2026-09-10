/**
 * Tests for tool receipt system.
 */

import { describe, expect, it } from "vitest";
import { ToolMessage } from "@langchain/core/messages";

import {
  createReceipt,
  buildLedger,
  renderLedger,
  verifyCitations,
  type ToolReceipt,
} from "../receipt.js";

function makeToolMessage(name: string, content: string, kwargs: Record<string, unknown> = {}): ToolMessage {
  return new ToolMessage({
    content,
    name,
    tool_call_id: "call-1",
    additional_kwargs: kwargs,
  });
}

describe("tool receipts", () => {
  describe("createReceipt", () => {
    it("creates a receipt with positional ID", () => {
      const msg = makeToolMessage("bash", "output");
      const receipt = createReceipt(msg, 1);
      expect(receipt.id).toBe("r1");
      expect(receipt.displayNumber).toBe(1);
      expect(receipt.toolName).toBe("bash");
    });

    it("hashes args and result", () => {
      const msg = makeToolMessage("write_file", "success", { args: { path: "/test.txt" } });
      const receipt = createReceipt(msg, 2);
      expect(receipt.argsHash).toMatch(/^[a-f0-9]{16}$/);
      expect(receipt.resultHash).toMatch(/^[a-f0-9]{16}$/);
    });

    it("marks status as success by default", () => {
      const msg = makeToolMessage("bash", "ok");
      const receipt = createReceipt(msg, 1);
      expect(receipt.status).toBe("success");
    });

    it("marks status as error when error in kwargs", () => {
      const msg = makeToolMessage("bash", "fail", { error: "not found" });
      const receipt = createReceipt(msg, 1);
      expect(receipt.status).toBe("error");
    });

    it("truncates result preview", () => {
      const longResult = "x".repeat(500);
      const msg = makeToolMessage("bash", longResult);
      const receipt = createReceipt(msg, 1);
      expect(receipt.resultPreview.length).toBeLessThanOrEqual(203); // 200 + "..."
    });
  });

  describe("buildLedger", () => {
    it("builds a ledger from tool messages", () => {
      const messages = [
        makeToolMessage("bash", "out1"),
        makeToolMessage("read_file", "out2"),
      ];
      const ledger = buildLedger(messages, 2000);
      expect(ledger.receipts.length).toBe(2);
      expect(ledger.receipts[0].id).toBe("r1");
      expect(ledger.receipts[1].id).toBe("r2");
    });

    it("returns empty ledger for empty input", () => {
      const ledger = buildLedger([], 2000);
      expect(ledger.receipts.length).toBe(0);
      expect(ledger.usedChars).toBe(0);
    });

    it("tracks character budget usage", () => {
      const messages = [makeToolMessage("bash", "output")];
      const ledger = buildLedger(messages, 2000);
      expect(ledger.budget).toBe(2000);
      expect(ledger.usedChars).toBeGreaterThan(0);
    });
  });

  describe("renderLedger", () => {
    it("renders header and receipt lines", () => {
      const receipts: ToolReceipt[] = [
        { id: "r1", displayNumber: 1, toolName: "bash", argsHash: "a", resultHash: "b", status: "success", timestamp: "", resultPreview: "output", cited: false },
      ];
      const { rendered, usedChars } = renderLedger(receipts, 2000);
      expect(rendered).toContain("## Tool Receipts");
      expect(rendered).toContain("[r1]");
      expect(rendered).toContain("bash");
      expect(usedChars).toBeGreaterThan(0);
    });

    it("truncates when budget is exceeded", () => {
      const receipts: ToolReceipt[] = Array.from({ length: 10 }, (_, i) => ({
        id: `r${i + 1}`,
        displayNumber: i + 1,
        toolName: "tool",
        argsHash: "a",
        resultHash: "b",
        status: "success",
        timestamp: "",
        resultPreview: "x".repeat(100),
        cited: false,
      }));
      const { truncated, rendered } = renderLedger(receipts, 100);
      expect(truncated).toBe(true);
      expect(rendered.length).toBeLessThanOrEqual(100 + 20); // header + some body
    });

    it("returns empty string for empty receipts", () => {
      const { rendered, usedChars, truncated } = renderLedger([], 2000);
      expect(rendered).toBe("");
      expect(usedChars).toBe(0);
      expect(truncated).toBe(false);
    });
  });

  describe("verifyCitations", () => {
    const ledger = buildLedger([
      makeToolMessage("write_file", "ok"),
      makeToolMessage("bash", "output"),
    ], 2000);

    it("verifies valid bare citation", () => {
      const result = verifyCitations("According to [r1], the file was written.", ledger);
      expect(result.valid).toBe(true);
      expect(result.totalCitations).toBe(1);
    });

    it("verifies valid anchored citation", () => {
      const result = verifyCitations("[r2 bash] shows the output.", ledger);
      expect(result.valid).toBe(true);
    });

    it("rejects non-existent receipt citation", () => {
      const result = verifyCitations("[r99] is invalid.", ledger);
      expect(result.valid).toBe(false);
      expect(result.invalidCitations.length).toBe(1);
      expect(result.invalidCitations[0].reason).toContain("does not exist");
    });

    it("rejects mismatched anchor", () => {
      const result = verifyCitations("[r1 bash] is wrong because r1 is write_file.", ledger);
      expect(result.valid).toBe(false);
      expect(result.invalidCitations[0].reason).toContain("write_file");
    });

    it("deduplicates repeated citations", () => {
      const result = verifyCitations("[r1] and [r1] again.", ledger);
      expect(result.totalCitations).toBe(1);
    });

    it("handles multiple citations in one output", () => {
      const output = "As shown in [r1] and [r2 bash], both succeeded.";
      const result = verifyCitations(output, ledger);
      expect(result.totalCitations).toBe(2);
      expect(result.valid).toBe(true);
    });

    it("returns valid for output with no citations", () => {
      const result = verifyCitations("No citations here.", ledger);
      expect(result.totalCitations).toBe(0);
      expect(result.valid).toBe(true);
    });
  });
});
