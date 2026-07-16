/**
 * Shared pagination helpers for gateway routers.
 */

export interface RunMessageRow {
  [key: string]: unknown;
}

/**
 * Trim a `limit + 1` run-message page while preserving page boundaries.
 */
export function trimRunMessagePage(
  rows: RunMessageRow[],
  { limit, afterSeq }: { limit: number; afterSeq: number | null }
): [RunMessageRow[], boolean] {
  const hasMore = rows.length > limit;
  if (!hasMore) {
    return [rows, false];
  }

  if (afterSeq !== null) {
    return [rows.slice(0, limit), true];
  }

  return [rows.slice(-limit), true];
}
