/**
 * Multi-Agent Coordination — peer-to-peer agent orchestration patterns.
 *
 * Extends Quill's existing subagent system (which handles single
 * parent→child delegation) with richer coordination patterns from
 * CrewAI, AutoGen, and Kimi Code's Tower protocol.
 *
 * Patterns:
 * - **Supervisor**: One agent routes tasks to worker agents
 * - **RoundRobin**: Agents take turns with shared history
 * - **Handoff**: Agents signal transitions to one another
 *
 * Quick start:
 *   import { runSupervisorCoordination } from "quill.multi_agent";
 *
 *   const result = await runSupervisorCoordination({
 *     supervisor: { name: "lead", role: "Coordinator", goal: "..." },
 *     workers: [
 *       { name: "researcher", role: "Researcher", goal: "..." },
 *       { name: "coder", role: "Developer", goal: "..." },
 *     ],
 *   task: "Build a web scraper for news articles",
 *     runner: myAgentRunner,
 *   });
 */

// Types
export type {
  CoordAgent,
  AgentMessage,
  HandoffMessage,
  CoordinationStrategy,
  SharedState,
  Mission,
  CoordinationResult,
  AgentRunner,
  SelectorFn,
  TerminationFn,
} from "./types.js";

// Coordinators
export {
  runSupervisorCoordination,
  runRoundRobin,
  runHandoffChain,
} from "./coordinators/index.js";

export type {
  SupervisorOptions,
} from "./coordinators/supervisor.js";
export type {
  RoundRobinOptions,
} from "./coordinators/round_robin.js";
export type {
  HandoffOptions,
} from "./coordinators/handoff.js";
