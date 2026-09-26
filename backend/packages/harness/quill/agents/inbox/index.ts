/**
 * Command Inbox — serial message queueing while the agent is busy.
 *
 * Ported from ZCode's CommandInbox: mid-run user messages are queued with an
 * optimistic pending overlay and admitted one at a time when the current run
 * finishes, instead of being dropped.
 *
 * @module agents/inbox
 */

export {
  CommandInbox,
  type CommandInboxOptions,
  type QueuedMessage,
  type QueuedMessageStatus,
} from "./command_inbox.js";
