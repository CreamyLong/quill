/**
 * Conversation Sharing — publish a sanitized, read-only projection of a
 * thread and import shared conversations as new threads.
 *
 * Ported from ZCode's `ConversationShareService` publish/import pipeline,
 * self-hosted: instead of ZCode's cloud share service, share records are
 * stored as JSON files under `.scitops/shares/` and served by the gateway
 * (`GET /api/shares/:id` renders in the web viewer at `/share/[id]`).
 *
 * Publish pipeline (mirrors upstream):
 * 1. `sanitizeForShare` — strip system messages, redact secret-shaped
 *    strings, drop tool internals, cap content length. The system does NOT
 *    auto-detect all sensitive content (upstream shows an explicit
 *    disclosure to the sharer); redaction is a safety net, not a guarantee.
 * 2. `buildShareProjection` — public-facing rows + share metadata +
 *    schema version + SHA-256 integrity hash of the payload.
 * 3. `ConversationShareStore.create` — persist and mint a share id.
 *
 * Access modes (upstream `ConversationShareAccessMode`):
 * - `private`      — only the sharer; personal archive
 * - `link_viewer`  — anyone with the link can view
 * - `link_editor`  — view + import into the reader's own Quill to continue
 *   (upstream default)
 *
 * @module runtime/sharing
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { projectRoot } from "../config/runtime_paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Who can read (and import) a share. */
export type ConversationShareAccessMode = "private" | "link_viewer" | "link_editor";

/** Current share projection schema version. */
export const SHARE_SCHEMA_VERSION = 1;

/** A shareable conversation row (already sanitized). */
export interface ShareRow {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

/** The public projection served to viewers. */
export interface ConversationShareProjection {
  schema_version: number;
  share: {
    id: string;
    title: string;
    access_mode: ConversationShareAccessMode;
    created_at: string;
    message_count: number;
  };
  rows: ShareRow[];
  integrity: {
    /** SHA-256 of the canonical rows payload — viewers can verify. */
    sha256: string;
  };
}

/** A stored share record (projection + bookkeeping). */
export interface ConversationShareRecord {
  projection: ConversationShareProjection;
  /** Thread the share was published from. */
  sourceThreadId: string;
  revoked: boolean;
}

/** Raw thread message before sanitization. */
export interface RawShareMessage {
  role: string;
  content: unknown;
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/** Secret-shaped patterns redacted before anything leaves the machine. */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI-style keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access keys
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./g, // JWT prefixes
  /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?[^\s"']{8,}/gi,
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/g,
];

export const REDACTION_PLACEHOLDER = "[REDACTED]";

/** Redact secret-shaped substrings (safety net; not a guarantee). */
export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, REDACTION_PLACEHOLDER);
  }
  return result;
}

/** Max characters per shared message row. */
const ROW_CONTENT_MAX_CHARS = 8000;

/**
 * Sanitize raw thread messages into share rows: keep user/assistant text
 * only, drop system messages and tool internals, redact secrets, cap length.
 */
export function sanitizeForShare(messages: RawShareMessage[]): ShareRow[] {
  const rows: ShareRow[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }
    const text = extractText(message.content);
    if (text.trim() === "") {
      continue;
    }
    const redacted = redactSecrets(text);
    rows.push({
      role: message.role,
      content:
        redacted.length > ROW_CONTENT_MAX_CHARS
          ? `${redacted.slice(0, ROW_CONTENT_MAX_CHARS)}…`
          : redacted,
      timestamp: message.timestamp,
    });
  }
  return rows;
}

/** Extract human-readable text from string or content-block content. */
function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block !== null && typeof block === "object" && (block as { type?: string }).type === "text"
          ? String((block as { text?: unknown }).text ?? "")
          : "",
      )
      .filter((t) => t !== "")
      .join("\n");
  }
  return "";
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/** Canonical serialization used for the integrity hash. */
function canonicalRowsJson(rows: ShareRow[]): string {
  return JSON.stringify(rows.map((r) => [r.role, r.content, r.timestamp ?? null]));
}

/** Build a public projection (sanitize → hash → wrap). */
export function buildShareProjection(input: {
  id: string;
  title: string;
  accessMode: ConversationShareAccessMode;
  messages: RawShareMessage[];
  createdAt?: string;
}): ConversationShareProjection {
  const rows = sanitizeForShare(input.messages);
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    schema_version: SHARE_SCHEMA_VERSION,
    share: {
      id: input.id,
      title: input.title.trim() === "" ? "Shared conversation" : input.title.trim(),
      access_mode: input.accessMode,
      created_at: createdAt,
      message_count: rows.length,
    },
    rows,
    integrity: {
      sha256: crypto.createHash("sha256").update(canonicalRowsJson(rows)).digest("hex"),
    },
  };
}

/** Verify a projection's integrity hash against its rows. */
export function verifyShareProjection(projection: ConversationShareProjection): boolean {
  const expected = crypto
    .createHash("sha256")
    .update(canonicalRowsJson(projection.rows))
    .digest("hex");
  return expected === projection.integrity.sha256;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** File-backed share store (`.scitops/shares/<id>.json`). */
export class ConversationShareStore {
  private readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? path.join(projectRoot(), ".scitops", "shares");
  }

  /** Persist a projection; returns the share id. */
  create(
    projection: ConversationShareProjection,
    sourceThreadId: string,
  ): string {
    fs.mkdirSync(this.dir, { recursive: true });
    const record: ConversationShareRecord = {
      projection,
      sourceThreadId,
      revoked: false,
    };
    const file = this.fileFor(projection.share.id);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2));
    fs.renameSync(tmp, file);
    return projection.share.id;
  }

  /** Fetch a live (non-revoked, non-private) projection for viewers. */
  getForViewer(shareId: string): ConversationShareProjection | null {
    const record = this.getRecord(shareId);
    if (record === null || record.revoked) {
      return null;
    }
    if (record.projection.share.access_mode === "private") {
      return null;
    }
    return record.projection;
  }

  /** Fetch a projection for import (`link_editor` only). */
  getForImport(shareId: string): ConversationShareProjection | null {
    const projection = this.getForViewer(shareId);
    if (projection === null || projection.share.access_mode !== "link_editor") {
      return null;
    }
    return verifyShareProjection(projection) ? projection : null;
  }

  /** Raw record access (admin / owner views). */
  getRecord(shareId: string): ConversationShareRecord | null {
    const file = this.fileFor(shareId);
    try {
      const raw = fs.readFileSync(file, "utf-8");
      return JSON.parse(raw) as ConversationShareRecord;
    } catch {
      return null;
    }
  }

  /** List all records' projections (owner view). */
  list(): ConversationShareProjection[] {
    try {
      return fs
        .readdirSync(this.dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => this.getRecord(f.replace(/\.json$/, "")))
        .filter((r): r is ConversationShareRecord => r !== null)
        .map((r) => r.projection);
    } catch {
      return [];
    }
  }

  /** Revoke a share (viewers get 404 semantics). Invalid ids = not found. */
  revoke(shareId: string): boolean {
    let record: ConversationShareRecord | null;
    try {
      record = this.getRecord(shareId);
    } catch {
      return false;
    }
    if (record === null) {
      return false;
    }
    record.revoked = true;
    fs.writeFileSync(this.fileFor(shareId), JSON.stringify(record, null, 2));
    return true;
  }

  private fileFor(shareId: string): string {
    // Share ids are generated (hex); refuse anything path-shaped.
    if (!/^[a-f0-9-]{8,64}$/i.test(shareId)) {
      throw new Error("invalid share id");
    }
    return path.join(this.dir, `${shareId}.json`);
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Injected thread creator (the gateway wires this to its thread repository). */
export type CreateThreadFromShare = (input: {
  name: string;
  messages: ShareRow[];
  importedFromShareId: string;
}) => Promise<{ threadId: string }>;

/**
 * Import a shared conversation as a new Quill thread (link_editor shares
 * only). Mirrors upstream `importShare` minus the cloud fetch: the gateway
 * already resolved the share locally.
 */
export async function importSharedConversation(
  projection: ConversationShareProjection,
  createThread: CreateThreadFromShare,
): Promise<{ threadId: string; messageCount: number }> {
  const created = await createThread({
    name: projection.share.title,
    messages: projection.rows,
    importedFromShareId: projection.share.id,
  });
  return { threadId: created.threadId, messageCount: projection.rows.length };
}

/** Mint a new share id. */
export function newShareId(): string {
  return crypto.randomUUID();
}
