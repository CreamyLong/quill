/**
 * Tests for the `task` tool's acceptance-criteria wiring (DeerFlow sync).
 *
 * Covers criteria flowing from the tool schema into the injected checker,
 * the verdict block being appended to the result content, and the
 * no-criteria / no-checker paths staying unchanged.
 */

import { describe, expect, it } from "vitest";
import type { RunnableConfig } from "@langchain/core/runnables";
import { isToolMessage } from "@langchain/core/messages";

import { createTaskTool } from "../builtins/task_tool.js";
import type { SubagentFinalResult } from "../../subagents/runtime/result.js";

function completedResult(overrides: Partial<SubagentFinalResult> = {}): SubagentFinalResult {
  return {
    taskId: "t1",
    status: "completed",
    result: "did the thing",
    ...overrides,
  } as SubagentFinalResult;
}

describe("task tool acceptance criteria", () => {
  it("runs the injected checker and appends the verdict block", async () => {
    const taskTool = createTaskTool({
      runSubagent: async () => completedResult(),
      acceptanceChecker: (criteria) => `Acceptance criteria: ALL HOLD (${criteria.join("; ")})`,
    });
    const message = await taskTool.invoke({
      description: "write report",
      prompt: "write the report",
      acceptance_criteria: ["file:out/report.md exists"],
    } as never, {} as RunnableConfig);

    expect(isToolMessage(message)).toBe(true);
    expect(message.content).toContain("Task Succeeded.");
    expect(message.content).toContain("Acceptance criteria: ALL HOLD (file:out/report.md exists)");
    expect((message.additional_kwargs as Record<string, unknown>).acceptance_criteria).toEqual([
      "file:out/report.md exists",
    ]);
  });

  it("leaves the result unchanged when no criteria are declared", async () => {
    const taskTool = createTaskTool({
      runSubagent: async () => completedResult(),
      acceptanceChecker: () => {
        throw new Error("checker must not run without criteria");
      },
    });
    const message = await taskTool.invoke({
      description: "write report",
      prompt: "write the report",
    } as never, {} as RunnableConfig);
    expect(message.content).toBe("Task Succeeded. Result: did the thing");
    expect((message.additional_kwargs as Record<string, unknown>).acceptance_criteria).toBeUndefined();
  });

  it("leaves the result unchanged when no checker is wired", async () => {
    const taskTool = createTaskTool({
      runSubagent: async () => completedResult(),
    });
    const message = await taskTool.invoke({
      description: "write report",
      prompt: "write the report",
      acceptance_criteria: ["file:out/report.md exists"],
    } as never, {} as RunnableConfig);
    expect(message.content).toBe("Task Succeeded. Result: did the thing");
  });

  it("appends an empty checker result as-is (no blank block)", async () => {
    const taskTool = createTaskTool({
      runSubagent: async () => completedResult(),
      acceptanceChecker: () => "",
    });
    const message = await taskTool.invoke({
      description: "write report",
      prompt: "write the report",
      acceptance_criteria: ["vibes: good"],
    } as never, {} as RunnableConfig);
    expect(message.content).toBe("Task Succeeded. Result: did the thing");
  });
});
