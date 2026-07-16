/**
 * Memory update queue with debounce mechanism.
 *
 * Mirrors `quill.agents.memory.queue` from the Python backend.
 */

import { getMemoryConfig } from "../../config/memory_config.js";
import type { ConversationContext, QueueKey } from "./queue.js";
import { queueKey } from "./queue.js";

export type ProcessQueueCallback = (contexts: ConversationContext[]) => Promise<void>;

export class MemoryUpdateQueueImpl {
  private queue: ConversationContext[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;
  private processCallback: ProcessQueueCallback;

  constructor(processCallback: ProcessQueueCallback) {
    this.processCallback = processCallback;
  }

  private enqueueLocked(context: ConversationContext): void {
    const key = queueKey(context.thread_id, context.user_id, context.agent_name);
    const existingIndex = this.queue.findIndex(
      (c) => queueKey(c.thread_id, c.user_id, c.agent_name).toString() === key.toString()
    );
    if (existingIndex >= 0) {
      const existing = this.queue[existingIndex];
      context.correction_detected =
        context.correction_detected || existing.correction_detected || false;
      context.reinforcement_detected =
        context.reinforcement_detected || existing.reinforcement_detected || false;
      this.queue.splice(existingIndex, 1);
    }
    this.queue.push(context);
  }

  private scheduleTimer(delaySeconds: number): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      void this.processQueue();
    }, delaySeconds * 1000);
  }

  add(context: ConversationContext): void {
    const config = getMemoryConfig();
    if (!config.enabled) {
      return;
    }
    this.enqueueLocked(context);
    this.scheduleTimer(config.debounceSeconds);
  }

  addNowait(context: ConversationContext): void {
    const config = getMemoryConfig();
    if (!config.enabled) {
      return;
    }
    this.enqueueLocked(context);
    this.scheduleTimer(0);
  }

  async processQueue(): Promise<void> {
    if (this.processing) {
      this.scheduleTimer(0);
      return;
    }
    if (this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const contexts = [...this.queue];
    this.queue = [];
    this.timer = null;

    try {
      await this.processCallback(contexts);
    } finally {
      this.processing = false;
    }
  }

  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.processQueue();
  }

  flushNowait(): void {
    this.scheduleTimer(0);
  }

  clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.queue = [];
    this.processing = false;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get isProcessing(): boolean {
    return this.processing;
  }
}

let _memoryQueue: MemoryUpdateQueueImpl | null = null;

export function getMemoryQueue(processCallback: ProcessQueueCallback): MemoryUpdateQueueImpl {
  if (_memoryQueue === null) {
    _memoryQueue = new MemoryUpdateQueueImpl(processCallback);
  }
  return _memoryQueue;
}

export function resetMemoryQueue(): void {
  if (_memoryQueue !== null) {
    _memoryQueue.clear();
  }
  _memoryQueue = null;
}
