/**
 * Row-serialization helper shared by every persistence repository.
 *
 * The Python backend derives this from SQLAlchemy's declarative ``Base`` and its
 * ``inspect()``-driven ``to_dict()``. Under ``node:sqlite`` there is no ORM
 * mapper: query results already arrive as plain column/value records. This
 * module therefore keeps only the semantic contract of ``Base.to_dict`` —
 * "return a plain dict of the mapped columns, optionally excluding some keys" —
 * as a tiny pure helper the repositories call while building their public dicts.
 */

/** A raw table row as returned by ``node:sqlite`` (column name → value). */
export type Row = Record<string, unknown>;

/**
 * Convert a row record to a plain dict, optionally omitting some keys.
 *
 * Mirrors ``quill.persistence.base.Base.to_dict``: a shallow copy of the
 * column values with an optional ``exclude`` set applied.
 */
export function toDict(row: Row, exclude?: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (exclude && exclude.has(key)) {
      continue;
    }
    out[key] = row[key];
  }
  return out;
}
