/**
 * Multi-agent coordinators — strategy implementations.
 *
 * Each coordinator implements a different multi-agent coordination pattern.
 * Choose the coordinator that matches your task structure:
 *
 * - **Supervisor**: One agent dynamically routes tasks to workers.
 *   Best for: task decomposition with specialized workers.
 *
 * - **RoundRobin**: Agents take turns responding to shared history.
 *   Best for: reflection, peer review, debate.
 *
 * - **Handoff**: Agents signal transitions to one another.
 *   Best for: multi-stage pipelines, triage flows.
 *
 * These coordinators extend Quill's existing subagent system (which handles
 * single parent→child delegation) with richer peer-to-peer patterns.
 */

export { runSupervisorCoordination, type SupervisorOptions } from "./supervisor.js";
export { runRoundRobin, type RoundRobinOptions } from "./round_robin.js";
export { runHandoffChain, type HandoffOptions } from "./handoff.js";
