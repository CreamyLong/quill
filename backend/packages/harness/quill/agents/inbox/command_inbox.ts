/**
 * CommandInbox — serial message queueing while the agent is busy.
 *
 * Ported from ZCode's CommandInbox runtime: user messages that arrive while
 * an agent run is in flight are queued (with an optimistic "pending" overlay
 * in the UI) instead of being dropped or interleaved. When the current run
 * finishes, queued messages are admitted one at a time, in order, each
 * starting a fresh run. Users can cancel or reorder queued messages before
 * they are admitted.
 *
 * This module provides:
 * - CommandInbox: per-thread FIFO queue with admission control
 * - QueuedMessage: lifecycle record (queued → admitted | cancelled | dropped)
 *
 * @module agents/inbox/command_inbox
 */

import { randomUUID } from "node:crypto";

export type QueuedMessageStatus = "queued" | "admitted" | "cancelled" | "dropped";

export interface QueuedMessage {
  /** Unique message ID. */
  id: string;
  /** Destination thread. */
  threadId: string;
  /** The user's message text. */
  content: string;
  /** Optional attachments referenced by the message. */
  attachments?: string[];
  /** Current status. */
  status: QueuedMessageStatus;
  /** Position when enqueued (0-based, per thread). */
  position: number;
  /** Monotonic insertion sequence — stable tie-break for equal timestamps. */
  seq: number;
  createdAt: string;
  /** When the message was admitted to a run. */
  admittedAt?: string;
  /** Why the message was cancelled or dropped. */
  statusDetail?: string;
}

export interface CommandInboxOptions {
  /** Maximum queued (pending) messages per thread. Default 32. */
  maxQueuedPerThread?: number;
  /** Maximum queued messages across all threads. Default 256. */
  maxQueuedTotal?: number;
  /** Called when a message is admitted (run should start with it). */
  onAdmit?: (message: QueuedMessage) => void;
  /** Called for every status change. */
  onChange?: (message: QueuedMessage) => void;
}

/**
 * CommandInbox — tracks whether each thread's agent is busy and holds
 * messages that arrived mid-run. The gateway consults `isBusy`/`setBusy`
 * around run dispatch; the frontend renders `pending()` as the queue panel.
 */
export class CommandInbox {
  private readonly maxPerThread: number;
  private readonly maxTotal: number;
  private readonly onAdmit?: (message: QueuedMessage) => void;
  private readonly onChange?: (message: QueuedMessage) => void;

  private messages = new Map<string, QueuedMessage>();
  private busyThreads = new Set<string>();
  private sequence = 0;

  constructor(options: CommandInboxOptions = {}) {
    this.maxPerThread = options.maxQueuedPerThread ?? 32;
    this.maxTotal = options.maxQueuedTotal ?? 256;
    this.onAdmit = options.onAdmit;
    this.onChange = options.onChange;
  }

  private nextSeq(): number {
    this.sequence += 1;
    return this.sequence;
  }

  // ------------------------------------------------------------------
  // Busy tracking
  // ------------------------------------------------------------------

  /** Mark a thread's agent as running. While busy, messages are queued. */
  setBusy(threadId: string): void {
    this.busyThreads.add(threadId);
  }

  /** Mark a thread's agent as idle and admit the next queued message. */
  setIdle(threadId: string): QueuedMessage | undefined {
    this.busyThreads.delete(threadId);
    return this.admitNext(threadId);
  }

  /** True while the thread has an in-flight run. */
  isBusy(threadId: string): boolean {
    return this.busyThreads.has(threadId);
  }

  // ------------------------------------------------------------------
  // Enqueue / admit
  // ------------------------------------------------------------------

  /**
   * Submit a user message for a thread. If the agent is idle the message is
   * admitted immediately; otherwise it is queued for serial admission.
   * Returns the message record; `status` tells the caller what happened.
   */
  submit(threadId: string, content: string, attachments?: string[]): QueuedMessage {
    const queued = this.pending(threadId);
    if (queued.length >= this.maxPerThread) {
      // Queue full — drop the OLDEST message to make room (newest wins),
      // matching ZCode's bounded inbox behaviour.
      const oldest = queued[0];
      this.transition(oldest, "dropped", "inbox full (per-thread limit)");
    }
    if (this.pendingCount() >= this.maxTotal) {
      // Global cap reached — drop this submission outright.
      const message: QueuedMessage = {
        id: `msg_${randomUUID().slice(0, 8)}`,
        threadId,
        content,
        attachments,
        status: "dropped",
        position: queued.length,
        seq: this.nextSeq(),
        createdAt: new Date().toISOString(),
        statusDetail: "inbox full (global limit)",
      };
      this.messages.set(message.id, message);
      this.onChange?.(message);
      return message;
    }

    const message: QueuedMessage = {
      id: `msg_${randomUUID().slice(0, 8)}`,
      threadId,
      content,
      attachments,
      status: "queued",
      position: queued.length,
      seq: this.nextSeq(),
      createdAt: new Date().toISOString(),
    };
    this.messages.set(message.id, message);
    this.onChange?.(message);

    // Idle agent → admit immediately (no run in flight to wait for).
    if (!this.isBusy(threadId)) {
      this.admit(message);
    }
    return message;
  }

  /**
   * Admit the next queued message for a thread (FIFO). Returns undefined
   * when the queue is empty.
   */
  admitNext(threadId: string): QueuedMessage | undefined {
    const next = this.pending(threadId)[0];
    if (!next) return undefined;
    this.admit(next);
    return next;
  }

  /** Admit a specific queued message (used by admitNext and submit). */
  admit(message: QueuedMessage): boolean {
    if (message.status !== "queued") return false;
    this.transition(message, "admitted");
    this.onAdmit?.(message);
    return true;
  }

  // ------------------------------------------------------------------
  // Queue management (user-facing)
  // ------------------------------------------------------------------

  /** Cancel a queued message before it is admitted. */
  cancel(messageId: string): QueuedMessage | undefined {
    const message = this.messages.get(messageId);
    if (!message || message.status !== "queued") return undefined;
    this.transition(message, "cancelled");
    this.resequence(message.threadId);
    return message;
  }

  /**
   * Move a queued message to a new position in its thread queue
   * (drag-and-drop reordering in the queue panel). Other messages shift.
   */
  reorder(messageId: string, newPosition: number): QueuedMessage | undefined {
    const message = this.messages.get(messageId);
    if (!message || message.status !== "queued") return undefined;

    const queue = this.pending(message.threadId);
    const clamped = Math.max(0, Math.min(newPosition, queue.length - 1));
    queue.splice(message.position, 1);
    queue.splice(clamped, 0, message);
    queue.forEach((m, i) => {
      if (m.position !== i) {
        m.position = i;
        this.onChange?.(m);
      }
    });
    return message;
  }

  /** Drop every queued message for a thread (queue-clear button). */
  clear(threadId: string): number {
    const dropped = this.pending(threadId);
    for (const message of dropped) {
      this.transition(message, "dropped", "queue cleared");
    }
    return dropped.length;
  }

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  /** Queued (pending) messages for a thread, in order. */
  pending(threadId: string): QueuedMessage[] {
    return [...this.messages.values()]
      .filter((m) => m.threadId === threadId && m.status === "queued")
      .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  }

  /** Total queued messages across all threads. */
  pendingCount(): number {
    let count = 0;
    for (const message of this.messages.values()) {
      if (message.status === "queued") count += 1;
    }
    return count;
  }

  /** Recent messages for a thread (any status), newest first. */
  recent(threadId: string, limit = 50): QueuedMessage[] {
    return [...this.messages.values()]
      .filter((m) => m.threadId === threadId)
      .sort((a, b) => b.seq - a.seq)
      .slice(0, limit);
  }

  get(messageId: string): QueuedMessage | undefined {
    return this.messages.get(messageId);
  }

  /** Forget terminal messages older than the given retention window. */
  prune(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const [id, message] of this.messages) {
      if (message.status === "queued") continue;
      if (new Date(message.createdAt).getTime() < cutoff) {
        this.messages.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private transition(message: QueuedMessage, status: QueuedMessageStatus, detail?: string): void {
    message.status = status;
    message.statusDetail = detail;
    if (status === "admitted") message.admittedAt = new Date().toISOString();
    this.onChange?.(message);
  }

  /** Recompute positions after removal (cancel/drop). */
  private resequence(threadId: string): void {
    this.pending(threadId).forEach((m, i) => {
      if (m.position !== i) {
        m.position = i;
        this.onChange?.(m);
      }
    });
  }
}
