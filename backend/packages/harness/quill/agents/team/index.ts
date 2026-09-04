/**
 * Agent Teams Module — multi-agent coordination with task DAG.
 *
 * Provides team creation, task board management, mailbox communication,
 * and coordination strategies.
 */

export {
  type AgentTeamState,
  type CoordinationStrategy,
  type CreateTeamRequest,
  type MailboxMessage,
  type Teammate,
  type TeamTask,
} from "./types.js";

export { AgentTeamManager } from "./manager.js";
