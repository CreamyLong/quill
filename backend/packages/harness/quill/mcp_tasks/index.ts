/**
 * Durable MCP Task Runtime — public API.
 *
 * Port of DeerFlow 2.0's `mcp_tasks` module. Provides lease-based task
 * execution for long-running MCP work that would otherwise block the agent
 * loop.
 *
 * Usage:
 *   import { getTaskRuntime } from "./mcp_tasks/";
 *
 *   const runtime = getTaskRuntime();
 *   runtime.setExecutor(async (task) => {
 *     // Execute the MCP tool call.
 *     return await callMcpTool(task.serverName, task.toolName, task.args);
 *   });
 *   runtime.start();
 *
 *   // Create and auto-execute a task:
 *   const task = runtime.createTask({
 *     serverName: "my-server",
 *     toolName: "long-running-tool",
 *     args: { query: "..." },
 *   });
 *   await runtime.autoExecuteNext();
 */

export * from "./types.js";
export { McpTaskStore, getTaskStore, resetTaskStore } from "./store.js";
export {
  McpTaskRuntime,
  getTaskRuntime,
  resetTaskRuntime,
  type TaskExecutor,
  type TaskStatusCallback,
} from "./runtime.js";
