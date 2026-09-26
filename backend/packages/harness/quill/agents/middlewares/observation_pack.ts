/**
 * ObservationPack — stable handles for large, repeated tool results.
 *
 * Ported from the SoL-Pi "ObservationPack" mechanism (NVIDIA, via
 * awesome-harness-engineering): when a tool returns a very large payload
 * (or the same payload repeatedly), the full text is parked in a store and
 * the model context receives only a compact summary plus a stable handle
 * (`obs://<id>`). The model can recall exact pages of the original content
 * on demand via the `recall_observation` tool — zero loss, far fewer tokens.
 *
 * Handles are content-addressed: identical payloads map to the same handle,
 * so repeated tool results stop re-inflating the context.
 *
 * @module agents/middlewares/observation_pack
 */

import { createHash } from "node:crypto";

import type { MiddlewareDefinition, ToolCallWrapper } from "../factory.js";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface ObservationRecord {
  /** Stable handle id (content hash prefix). */
  id: string;
  /** Full original content. */
  content: string;
  /** Which tool produced it. */
  tool: string;
  /** Total length in characters. */
  length: number;
  createdAt: string;
  /** Times this content has been seen (dedupe counter). */
  hits: number;
}

export interface ObservationStoreOptions {
  /** Results at or above this many characters get packed. Default 4000. */
  thresholdChars?: number;
  /** Maximum stored observations (LRU eviction). Default 64. */
  maxEntries?: number;
  /** Observation lifetime (ms). Default 30 minutes. */
  ttlMs?: number;
}

export interface ObservationPage {
  handle: string;
  offset: number;
  limit: number;
  total: number;
  /** The exact slice requested (character-exact recall). */
  text: string;
  /** True when offset+limit reaches the end. */
  hasMore: boolean;
}

/**
 * ObservationStore — content-addressed parking lot for large tool results.
 * `pack()` decides whether a result is large enough; `recall()` returns
 * exact character pages.
 */
export class ObservationStore {
  readonly thresholdChars: number;
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private records = new Map<string, ObservationRecord>();

  constructor(options: ObservationStoreOptions = {}) {
    this.thresholdChars = options.thresholdChars ?? 4_000;
    this.maxEntries = options.maxEntries ?? 64;
    this.ttlMs = options.ttlMs ?? 30 * 60_000;
  }

  /**
   * Pack a tool result if it exceeds the threshold. Returns the text that
   * should enter the model context: either the original (small results) or
   * a summary card with a stable handle.
   */
  pack(tool: string, content: string): string {
    if (content.length < this.thresholdChars) return content;

    const id = this.contentId(content);
    const existing = this.records.get(id);
    if (existing) {
      existing.hits += 1;
      // Refresh recency for LRU.
      this.records.delete(id);
      this.records.set(id, existing);
    } else {
      this.evict();
      this.records.set(id, {
        id,
        content,
        tool,
        length: content.length,
        createdAt: new Date().toISOString(),
        hits: 1,
      });
    }
    return this.summaryCard(this.records.get(id)!);
  }

  /** Recall an exact character page of a stored observation. */
  recall(handle: string, offset = 0, limit = 2_000): ObservationPage | undefined {
    const id = parseHandle(handle);
    const record = this.records.get(id);
    if (!record) return undefined;

    const clampedOffset = Math.max(0, Math.min(offset, record.length));
    const clampedLimit = Math.max(1, limit);
    const text = record.content.slice(clampedOffset, clampedOffset + clampedLimit);
    return {
      handle: `obs://${id}`,
      offset: clampedOffset,
      limit: clampedLimit,
      total: record.length,
      text,
      hasMore: clampedOffset + clampedLimit < record.length,
    };
  }

  /** Full content behind a handle (for UI expansion). */
  resolve(handle: string): ObservationRecord | undefined {
    const id = parseHandle(handle);
    return this.records.get(id);
  }

  /** All live records (diagnostics). */
  list(): ObservationRecord[] {
    this.evictExpired();
    return [...this.records.values()].sort((a, b) => b.hits - a.hits);
  }

  get size(): number {
    return this.records.size;
  }

  private summaryCard(record: ObservationRecord): string {
    const preview = record.content.slice(0, 200).replace(/\s+/g, " ");
    return [
      `[ObservationPack] Large result from ${record.tool} (${record.length} chars`,
      record.hits > 1 ? `, seen ${record.hits}×` : "",
      `) parked as obs://${record.id}.`,
      ` Preview: ${preview}…`,
      ` Use recall_observation with this handle to read exact pages (offset/limit).`,
    ].join("");
  }

  private contentId(content: string): string {
    return createHash("sha256").update(content).digest("hex").slice(0, 12);
  }

  private evict(): void {
    this.evictExpired();
    while (this.records.size >= this.maxEntries) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) break;
      this.records.delete(oldest);
    }
  }

  private evictExpired(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, record] of this.records) {
      if (new Date(record.createdAt).getTime() < cutoff) this.records.delete(id);
    }
  }
}

function parseHandle(handle: string): string {
  return handle.replace(/^obs:\/\//, "");
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export interface ObservationPackMiddlewareOptions extends ObservationStoreOptions {
  /** Pre-built store (tests / shared instances). */
  store?: ObservationStore;
}

/**
 * ObservationPackMiddleware — wraps every tool call; results at or above the
 * threshold are replaced in the model context by a stable handle card. The
 * middleware also contributes the `recall_observation` tool so the model can
 * page through parked content exactly when needed.
 */
export function createObservationPackMiddleware(
  options: ObservationPackMiddlewareOptions = {},
): MiddlewareDefinition & { store: ObservationStore } {
  const store = options.store ?? new ObservationStore(options);

  const wrapToolCall: ToolCallWrapper = async (request, handler) => {
    const result = await handler(request);

    // Tool results arrive as AIMessage-like objects with content; only pack
    // string content (multimodal blocks pass through untouched).
    const content = (result as { content?: unknown }).content;
    if (typeof content !== "string") return result;

    const packed = store.pack(request.name, content);
    if (packed === content) return result;
    return { ...(result as object), content: packed } as typeof result;
  };

  return {
    name: "observation_pack",
    wrapToolCall,
    store,
  };
}
