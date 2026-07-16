import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  SUBAGENT_ERROR_KEY,
  SUBAGENT_STATUS_KEY,
  SUBAGENT_STATUS_VALUES,
  extractSubagentStatus,
  makeSubagentAdditionalKwargs,
} from "../../status_contract.ts";
import { toContractStatus } from "../result.ts";
import { SubagentStatus } from "../../executor.ts";

function loadContractFixture(): Record<string, unknown> {
  // From backend/packages/harness/quill/subagents/runtime/__tests__/ up to
  // repo-root deer-flow/contracts/ = 7 levels up:
  // __tests__ → runtime → subagents → quill → harness → packages → backend → root
  const fixturePath = "../../../../../../../contracts/subagent_status_contract.json";
  return JSON.parse(readFileSync(new URL(fixturePath, import.meta.url), "utf-8")) as Record<string, unknown>;
}

describe("backend status_contract ↔ frontend vocabulary", () => {
  it("status keys match the shared contract fixture", () => {
    expect(SUBAGENT_STATUS_KEY).toBe("subagent_status");
    expect(SUBAGENT_ERROR_KEY).toBe("subagent_error");
  });

  it("STATUS_VALUES match the frontend SubtaskStatus vocabulary", () => {
    // Mirror of frontend STRUCTURED_STATUS_TO_SUBTASK values + timed_out +
    // polling_timed_out (which the UI collapses into "failed").
    expect([...SUBAGENT_STATUS_VALUES].sort()).toEqual([
      "cancelled",
      "completed",
      "failed",
      "polling_timed_out",
      "timed_out",
    ]);
  });

  it("executor enum maps onto the contract vocabulary", () => {
    expect(toContractStatus(SubagentStatus.COMPLETED)).toBe("completed");
    expect(toContractStatus(SubagentStatus.FAILED)).toBe("failed");
    expect(toContractStatus(SubagentStatus.CANCELLED)).toBe("cancelled");
    expect(toContractStatus(SubagentStatus.TIMED_OUT)).toBe("timed_out");
    // Pending / running are non-terminal; map to failed defensively.
    expect(toContractStatus(SubagentStatus.RUNNING)).toBe("failed");
  });

  it("makeSubagentAdditionalKwargs stamps subagent_status + optional error", () => {
    const ok = makeSubagentAdditionalKwargs("completed", {});
    expect(ok).toEqual({ subagent_status: "completed" });

    const withError = makeSubagentAdditionalKwargs("failed", { error: "boom" });
    expect(withError).toEqual({ subagent_status: "failed", subagent_error: "boom" });

    // Blank error is NOT stamped (keeps the wire format clean).
    const blankError = makeSubagentAdditionalKwargs("failed", { error: "   " });
    expect(blankError).toEqual({ subagent_status: "failed" });
  });

  it("makeSubagentAdditionalKwargs rejects invalid status strings", () => {
    expect(() => makeSubagentAdditionalKwargs("garbage" as never)).toThrow(
      /invalid subagent status/,
    );
  });

  it("passes every case in the cross-language contract fixture", () => {
    const fixture = loadContractFixture();
    const validValues = (fixture["valid_status_values"] as string[]).sort();
    expect(validValues).toEqual([...SUBAGENT_STATUS_VALUES].sort());

    const cases = fixture["cases"] as Array<Record<string, unknown>>;
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const content = c["content"] as string;
      const expected = c["expected_status"] as string | null;
      const got = extractSubagentStatus(content);
      expect(got, `case "${c["name"]}" with content "${content}"`).toBe(expected);
    }
  });
});
