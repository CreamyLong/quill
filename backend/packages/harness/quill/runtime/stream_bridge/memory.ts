/**
 * In-memory stream bridge backed by an in-process event log.
 */

import { END_SENTINEL, HEARTBEAT_SENTINEL, StreamBridge, StreamEvent } from "./base.js";

const logger = {
  warning: (...a: unknown[]) => console.warn(...a),
};

class RunStreamState {
  events: StreamEvent[] = [];
  ended = false;
  startOffset = 0;
  waiters: Array<() => void> = [];

  notifyAll(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) {
      w();
    }
  }
}

/**
 * Per-run in-memory event log implementation.
 *
 * Events are retained for a bounded window per run so late subscribers and
 * reconnecting clients can replay buffered events from `Last-Event-ID`.
 */
export class MemoryStreamBridge extends StreamBridge {
  private _maxsize: number;
  private _streams: Map<string, RunStreamState> = new Map();
  private _counters: Map<string, number> = new Map();

  constructor({ queueMaxsize = 256 }: { queueMaxsize?: number } = {}) {
    super();
    this._maxsize = queueMaxsize;
  }

  // -- helpers ---------------------------------------------------------------

  private _getOrCreateStream(runId: string): RunStreamState {
    let stream = this._streams.get(runId);
    if (stream === undefined) {
      stream = new RunStreamState();
      this._streams.set(runId, stream);
      this._counters.set(runId, 0);
    }
    return stream;
  }

  private _nextId(runId: string): string {
    const next = (this._counters.get(runId) ?? 0) + 1;
    this._counters.set(runId, next);
    const ts = Date.now();
    const seq = next - 1;
    return `${ts}-${seq}`;
  }

  /**
   * Extract the per-run sequence number from a `{ts}-{seq}` event id.
   *
   * `seq` increases by one per published event, so it equals the event's
   * absolute offset within the run. Returns `null` for ids that do not match the
   * expected format.
   */
  private static _parseEventSeq(eventId: string): number | null {
    const idx = eventId.lastIndexOf("-");
    if (idx < 0) {
      return null;
    }
    const seqText = eventId.slice(idx + 1);
    if (seqText === "" || !/^-?\d+$/.test(seqText)) {
      return null;
    }
    return Number.parseInt(seqText, 10);
  }

  private _resolveStartOffset(stream: RunStreamState, lastEventId: string | null): number {
    if (lastEventId === null || lastEventId === undefined) {
      return stream.startOffset;
    }

    // Event ids embed a per-run, monotonically increasing `seq` that equals the
    // event's absolute offset, so locate the event by arithmetic in O(1) rather
    // than scanning the retained buffer. The id is verified at the computed
    // index, so a stale/evicted/foreign/malformed id still falls back to
    // replay-from-earliest — identical to the previous linear scan.
    const seq = MemoryStreamBridge._parseEventSeq(lastEventId);
    if (seq !== null) {
      const localIndex = seq - stream.startOffset;
      if (localIndex >= 0 && localIndex < stream.events.length && stream.events[localIndex]!.id === lastEventId) {
        return stream.startOffset + localIndex + 1;
      }
    }

    if (stream.events.length > 0) {
      logger.warning(
        "last_event_id=%s not found in retained buffer; replaying from earliest retained event",
        lastEventId
      );
    }
    return stream.startOffset;
  }

  private _waitForChange(stream: RunStreamState, seconds: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const onNotify = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        const idx = stream.waiters.indexOf(onNotify);
        if (idx >= 0) {
          stream.waiters.splice(idx, 1);
        }
        resolve(false);
      }, Math.max(0, seconds * 1000));
      stream.waiters.push(onNotify);
    });
  }

  // -- StreamBridge API ------------------------------------------------------

  async publish(runId: string, event: string, data: unknown): Promise<void> {
    const stream = this._getOrCreateStream(runId);
    const entry = new StreamEvent(this._nextId(runId), event, data);
    stream.events.push(entry);
    if (stream.events.length > this._maxsize) {
      const overflow = stream.events.length - this._maxsize;
      stream.events.splice(0, overflow);
      stream.startOffset += overflow;
    }
    stream.notifyAll();
  }

  async publishEnd(runId: string): Promise<void> {
    const stream = this._getOrCreateStream(runId);
    stream.ended = true;
    stream.notifyAll();
  }

  async *subscribe(
    runId: string,
    { lastEventId = null, heartbeatInterval = 15.0 }: { lastEventId?: string | null; heartbeatInterval?: number } = {}
  ): AsyncIterableIterator<StreamEvent> {
    const stream = this._getOrCreateStream(runId);
    let nextOffset = this._resolveStartOffset(stream, lastEventId ?? null);

    while (true) {
      let entry: StreamEvent;
      if (nextOffset < stream.startOffset) {
        logger.warning(
          "subscriber for run %s fell behind retained buffer; resuming from offset %s",
          runId,
          stream.startOffset
        );
        nextOffset = stream.startOffset;
      }

      const localIndex = nextOffset - stream.startOffset;
      if (localIndex >= 0 && localIndex < stream.events.length) {
        entry = stream.events[localIndex]!;
        nextOffset += 1;
      } else if (stream.ended) {
        entry = END_SENTINEL;
      } else {
        const notified = await this._waitForChange(stream, heartbeatInterval);
        if (!notified) {
          entry = HEARTBEAT_SENTINEL;
        } else {
          continue;
        }
      }

      if (entry === END_SENTINEL) {
        yield END_SENTINEL;
        return;
      }
      yield entry;
    }
  }

  async cleanup(runId: string, { delay = 0 }: { delay?: number } = {}): Promise<void> {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    }
    this._streams.delete(runId);
    this._counters.delete(runId);
  }

  override async close(): Promise<void> {
    this._streams.clear();
    this._counters.clear();
  }
}
