/**
 * Memory update queue types.
 */

export interface ConversationContext {
  /** The thread ID. */
  thread_id: string;
  /** The conversation messages. */
  messages: unknown[];
  /** Capture timestamp (ISO string in TS). */
  timestamp: string;
  /** If provided, memory is stored per-agent. If null, uses global memory. */
  agent_name?: string | null;
  /** The user ID captured at enqueue time. */
  user_id?: string | null;
  /** Whether recent turns include an explicit correction signal. */
  correction_detected?: boolean;
  /** Whether recent turns include a positive reinforcement signal. */
  reinforcement_detected?: boolean;
}

export type QueueKey = [string, string | null, string | null];

/**
 * Queue for memory updates with debounce mechanism.
 *
 * Note: the Python implementation uses threading.Timer. In TypeScript this is
 * modelled with setTimeout and an async processing function injected by the
 * caller.
 */
export interface MemoryUpdateQueue {
  add(context: ConversationContext): void;
  addNowait(context: ConversationContext): void;
  reset(): void;
}

export function queueKey(
  threadId: string,
  userId: string | null | undefined,
  agentName: string | null | undefined
): QueueKey {
  return [threadId, userId ?? null, agentName ?? null];
}
