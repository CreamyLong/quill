/**
 * CuaAuditLog — immutable audit trail for computer use actions.
 *
 * Every CUA action (whether allowed, confirmed, or blocked) is recorded
 * for accountability and debugging. The audit log supports time-range
 * queries and export.
 */

export type AuditActionStatus = "allowed" | "confirmed" | "blocked" | "failed";

export interface AuditEntry {
  /** Unique entry ID. */
  id: string;
  /** Timestamp. */
  timestamp: string;
  /** Action type (file.read, shell.exec, etc.). */
  actionType: string;
  /** Action detail (file path, command, URL). */
  detail?: string;
  /** Outcome. */
  status: AuditActionStatus;
  /** User who triggered/approved the action. */
  userId?: string;
  /** Reason for the decision. */
  reason: string;
  /** Session context. */
  sessionId?: string;
  /** Error message if the action failed. */
  error?: string;
}

export interface AuditQuery {
  /** Filter by action type. */
  actionType?: string;
  /** Filter by status. */
  status?: AuditActionStatus;
  /** Filter by session. */
  sessionId?: string;
  /** Filter by user. */
  userId?: string;
  /** Start time (ISO). */
  after?: string;
  /** End time (ISO). */
  before?: string;
  /** Maximum results. */
  limit?: number;
}

export class CuaAuditLog {
  private entries: AuditEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 50_000) {
    this.maxEntries = maxEntries;
  }

  /** Record an action in the audit log. */
  record(entry: Omit<AuditEntry, "id" | "timestamp">): AuditEntry {
    const full: AuditEntry = {
      ...entry,
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };

    this.entries.push(full);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    return full;
  }

  /** Query the audit log. */
  query(filter: AuditQuery = {}): AuditEntry[] {
    let results = this.entries;

    if (filter.actionType) {
      results = results.filter((e) => e.actionType === filter.actionType);
    }
    if (filter.status) {
      results = results.filter((e) => e.status === filter.status);
    }
    if (filter.sessionId) {
      results = results.filter((e) => e.sessionId === filter.sessionId);
    }
    if (filter.userId) {
      results = results.filter((e) => e.userId === filter.userId);
    }
    if (filter.after) {
      results = results.filter((e) => e.timestamp >= filter.after!);
    }
    if (filter.before) {
      results = results.filter((e) => e.timestamp <= filter.before!);
    }

    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (filter.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /** Get recent entries. */
  recent(count = 50): AuditEntry[] {
    return this.entries.slice(-count).reverse();
  }

  /** Export all entries as JSON. */
  export(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /** Clear the audit log. */
  clear(): void {
    this.entries = [];
  }

  /** Get total entry count. */
  size(): number {
    return this.entries.length;
  }

  /** Get statistics by action type. */
  statsByAction(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const entry of this.entries) {
      stats[entry.actionType] = (stats[entry.actionType] ?? 0) + 1;
    }
    return stats;
  }

  /** Get statistics by status. */
  statsByStatus(): Record<AuditActionStatus, number> {
    const stats: Record<AuditActionStatus, number> = {
      allowed: 0,
      confirmed: 0,
      blocked: 0,
      failed: 0,
    };
    for (const entry of this.entries) {
      stats[entry.status]++;
    }
    return stats;
  }
}
