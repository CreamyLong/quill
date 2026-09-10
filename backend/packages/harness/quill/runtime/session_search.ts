/**
 * FTS5 Session Search — full-text search across all thread conversations.
 *
 * Implements the session search pattern from Hermes Agent:
 * - FTS5 (SQLite full-text search) index over thread messages
 * - Relevance scoring with title boost
 * - Snippet extraction with match highlighting
 * - Optional LLM summarization of search results
 *
 * Source patterns:
 * - Hermes Agent: FTS5 session search with LLM summarization
 * - Kimi Code: session forking (complements search for navigation)
 */

import type { DatabaseSync } from "node:sqlite";

/**
 * A single search result.
 */
export interface SessionSearchResult {
  /** Thread ID. */
  thread_id: string;
  /** Thread title (if available). */
  title: string;
  /** Message content snippet around the match. */
  snippet: string;
  /** Relevance score (higher = more relevant). */
  score: number;
  /** Role of the matched message (human/ai/tool). */
  role: string;
  /** Timestamp of the matched message. */
  timestamp: string | null;
}

/**
 * Search options.
 */
export interface SessionSearchOptions {
  /** Search query. */
  query: string;
  /** Maximum results to return (default: 20). */
  limit?: number;
  /** Filter by user ID (optional). */
  userId?: string | null;
  /** Include message content in snippets (default: true). */
  includeSnippets?: boolean;
}

/**
 * FTS5-backed session search index.
 *
 * Creates and maintains a SQLite FTS5 virtual table for full-text search
 * across thread messages. Supports incremental indexing and relevance scoring.
 */
export class SessionSearchIndex {
  private readonly _db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this._db = db;
    this._setup();
  }

  /**
   * Create the FTS5 virtual table and triggers.
   */
  private _setup(): void {
    // FTS5 virtual table for full-text search over thread messages
    this._db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS session_search USING fts5(
        thread_id UNINDEXED,
        title,
        content,
        role UNINDEXED,
        timestamp UNINDEXED,
        tokenize = 'porter unicode61'
      );
    `);
  }

  /**
   * Index a thread's messages for search.
   * Replaces any existing index for this thread.
   */
  indexThread(threadId: string, title: string, messages: Array<{ content: string; role: string; timestamp?: string }>): void {
    // Remove existing entries for this thread
    this._db.prepare(`DELETE FROM session_search WHERE thread_id = ?`).run(threadId);

    // Insert new entries
    const insert = this._db.prepare(
      `INSERT INTO session_search (thread_id, title, content, role, timestamp) VALUES (?, ?, ?, ?, ?)`
    );

    for (const msg of messages) {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      insert.run(threadId, title, content, msg.role, msg.timestamp ?? null);
    }
  }

  /**
   * Remove a thread from the search index.
   */
  removeThread(threadId: string): void {
    this._db.prepare(`DELETE FROM session_search WHERE thread_id = ?`).run(threadId);
  }

  /**
   * Search across all indexed threads.
   */
  search(options: SessionSearchOptions): SessionSearchResult[] {
    const { query, limit = 20 } = options;

    if (!query.trim()) {
      return [];
    }

    // Build FTS5 query: support phrase queries and prefix matching
    const ftsQuery = buildFtsQuery(query);

    // Search with BM25 ranking (FTS5 built-in)
    // Boost title matches by searching both title and content
    const sql = `
      SELECT
        thread_id,
        title,
        snippet(session_search, 2, '[', ']', '...', 10) AS snippet,
        role,
        timestamp,
        bm25(session_search, 1.0, 2.0, 0.5) AS bm25_score
      FROM session_search
      WHERE session_search MATCH ?
      ORDER BY bm25_score ASC
      LIMIT ?
    `;

    // BM25 returns lower values for better matches, so we negate for display
    const rows = this._db.prepare(sql).all(ftsQuery, limit) as Array<Record<string, unknown>>;

    return rows.map((row) => {
      const bm25 = Number(row["bm25_score"]) || 0;
      return {
        thread_id: String(row["thread_id"]),
        title: String(row["title"] ?? "Untitled"),
        snippet: String(row["snippet"] ?? ""),
        score: -bm25, // Negate so higher = better
        role: String(row["role"] ?? "unknown"),
        timestamp: (row["timestamp"] as string) ?? null,
      };
    });
  }

  /**
   * Get the total number of indexed threads.
   */
  getIndexedCount(): number {
    const row = this._db.prepare(`SELECT COUNT(DISTINCT thread_id) AS cnt FROM session_search`).get() as Record<string, unknown>;
    return Number(row["cnt"]) || 0;
  }

  /**
   * Get the total number of indexed messages.
   */
  getMessageCount(): number {
    const row = this._db.prepare(`SELECT COUNT(*) AS cnt FROM session_search`).get() as Record<string, unknown>;
    return Number(row["cnt"]) || 0;
  }
}

/**
 * Build an FTS5 query string from a user query.
 *
 * Supports:
 * - Phrase queries: "exact phrase"
 * - Prefix matching: test*
 * - AND/OR: term1 AND term2, term1 OR term2
 * - NOT: term1 NOT term2
 */
function buildFtsQuery(query: string): string {
  // Trim and normalize
  const trimmed = query.trim();
  if (!trimmed) {
    return "";
  }

  // If the query contains explicit FTS5 operators, pass it through
  if (trimmed.includes('"') || trimmed.includes("*") || trimmed.includes(" AND ") || trimmed.includes(" OR ") || trimmed.includes(" NOT ")) {
    return trimmed;
  }

  // Split into terms and add prefix matching
  const terms = trimmed.split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return "";
  }

  // Join with implicit AND, add prefix matching to each term
  return terms.map((t) => `${t}*`).join(" ");
}
