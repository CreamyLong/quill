/**
 * Abstract stream bridge protocol.
 *
 * StreamBridge decouples agent workers (producers) from SSE endpoints
 * (consumers), aligning with LangGraph Platform's Queue + StreamManager
 * architecture.
 */

/**
 * Single stream event.
 *
 * - id: Monotonically increasing event ID (used as SSE `id:` field, supports
 *   `Last-Event-ID` reconnection).
 * - event: SSE event name, e.g. `"metadata"`, `"updates"`, `"events"`,
 *   `"error"`, `"end"`.
 * - data: JSON-serialisable payload.
 */
export class StreamEvent {
  readonly id: string;
  readonly event: string;
  readonly data: unknown;

  constructor(id: string, event: string, data: unknown) {
    this.id = id;
    this.event = event;
    this.data = data;
  }
}

export const HEARTBEAT_SENTINEL = new StreamEvent("", "__heartbeat__", null);
export const END_SENTINEL = new StreamEvent("", "__end__", null);

/** Abstract base for stream bridges. */
export abstract class StreamBridge {
  /** Enqueue a single event for *run_id* (producer side). */
  abstract publish(runId: string, event: string, data: unknown): Promise<void>;

  /** Signal that no more events will be produced for *run_id*. */
  abstract publishEnd(runId: string): Promise<void>;

  /**
   * Async iterator that yields events for *run_id* (consumer side).
   *
   * Yields {@link HEARTBEAT_SENTINEL} when no event arrives within
   * *heartbeatInterval* seconds. Yields {@link END_SENTINEL} once the producer
   * calls {@link publishEnd}.
   */
  abstract subscribe(
    runId: string,
    options?: { lastEventId?: string | null; heartbeatInterval?: number }
  ): AsyncIterableIterator<StreamEvent>;

  /**
   * Release resources associated with *run_id*.
   *
   * If *delay* > 0 the implementation should wait before releasing, giving late
   * subscribers a chance to drain remaining events.
   */
  abstract cleanup(runId: string, options?: { delay?: number }): Promise<void>;

  /** Release backend resources. Default is a no-op. */
  async close(): Promise<void> {
    return undefined;
  }
}
