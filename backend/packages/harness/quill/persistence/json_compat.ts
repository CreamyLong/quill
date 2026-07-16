/**
 * Dialect-aware JSON value matching for the persistence layer (SQLite).
 *
 * Ports ``quill.persistence.json_compat``. The Python original compiles a
 * SQLAlchemy ``ColumnElement`` for both SQLite and PostgreSQL. This TypeScript
 * port targets ``node:sqlite`` only, so it emits a parameterized SQLite
 * predicate: ``column[key] == value`` becomes a ``json_type`` / ``json_extract``
 * comparison with a placeholder bound value. The PostgreSQL dialect has no
 * ``node:sqlite`` analogue and is intentionally omitted.
 */

import type { SQLInputValue } from "node:sqlite";

// Key is interpolated into compiled SQL; restrict charset to prevent injection.
const KEY_CHARSET_RE = /^[A-Za-z0-9_\-]+$/;

// SQLite raises an overflow when binding values outside signed 64-bit range.
// Reject at validation time instead. Use BigInt bounds so we can also validate
// integer numbers that exceed JS's safe-integer range.
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

/** A parameterized SQL fragment: a WHERE clause snippet plus its bound values. */
export interface SqlFragment {
  sql: string;
  params: SQLInputValue[];
}

/**
 * Return ``true`` if *key* is safe for use as a JSON metadata filter key.
 *
 * A key is "safe" when it is a string matching ``[A-Za-z0-9_-]+``. The charset
 * is restricted because the key is interpolated into the compiled SQL path
 * expression (``$."<key>"``), so any laxer pattern would open a SQL/JSONPath
 * injection surface.
 */
export function validateMetadataFilterKey(key: unknown): key is string {
  return typeof key === "string" && KEY_CHARSET_RE.test(key);
}

/**
 * Return ``true`` if *value* is an allowed type for a JSON metadata filter.
 *
 * Matches the set of types the clause builder knows how to compile into a
 * portable predicate: ``null``, ``boolean``, ``number``, ``bigint``, ``string``.
 * Anything else (array/object/…) is rejected rather than silently coerced.
 *
 * Integer values are additionally restricted to the signed 64-bit range
 * ``[-2**63, 2**63 - 1]``: SQLite overflows when binding larger values.
 */
export function validateMetadataFilterValue(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  const t = typeof value;
  if (t === "boolean" || t === "string") {
    return true;
  }
  if (t === "bigint") {
    return (value as bigint) >= INT64_MIN && (value as bigint) <= INT64_MAX;
  }
  if (t === "number") {
    const n = value as number;
    if (Number.isInteger(n)) {
      const b = BigInt(n);
      return b >= INT64_MIN && b <= INT64_MAX;
    }
    // Finite floats are accepted; NaN / Infinity are not JSON-representable.
    return Number.isFinite(n);
  }
  return false;
}

function isIntegerValue(value: unknown): boolean {
  if (typeof value === "bigint") {
    return true;
  }
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Dialect-portable ``column[key] == value`` for a JSON column, SQLite flavour.
 *
 * Mirrors ``JsonMatch`` compiled with the ``@compiles(JsonMatch, "sqlite")``
 * handler. *key* must be a single literal key matching ``[A-Za-z0-9_-]+``;
 * *value* must be ``null``, ``boolean``, ``number``, ``bigint`` (signed 64-bit),
 * or ``string``.
 *
 * @throws Error when *key* fails validation (mirrors ``ValueError``).
 * @throws Error when *value* fails validation (mirrors ``TypeError``).
 */
export function jsonMatch(column: string, key: string, value: unknown): SqlFragment {
  if (!validateMetadataFilterKey(key)) {
    throw new Error(`JsonMatch key must match ${KEY_CHARSET_RE.source}; got: ${JSON.stringify(key)}`);
  }
  if (!validateMetadataFilterValue(value)) {
    if (isIntegerValue(value)) {
      throw new Error(`JsonMatch int value out of signed 64-bit range [-2**63, 2**63-1]: ${String(value)}`);
    }
    throw new Error(`JsonMatch value must be null, boolean, number, bigint, or string; got: ${typeof value}`);
  }

  const path = `$."${key}"`;
  const typeof_ = `json_type(${column}, '${path}')`;
  const extract = `json_extract(${column}, '${path}')`;

  // null -> missing key or JSON null
  if (value === null) {
    return { sql: `${typeof_} = 'null'`, params: [] };
  }
  // bool check must precede int check (booleans are numbers-adjacent here)
  if (typeof value === "boolean") {
    // SQLite json_extract returns 1/0 for JSON booleans and json_type returns
    // 'integer', so compare the extracted value against 1/0.
    return { sql: `(${typeof_} = 'integer' AND ${extract} = ?)`, params: [value ? 1 : 0] };
  }
  if (isIntegerValue(value)) {
    const bound: SQLInputValue = typeof value === "bigint" ? value : (value as number);
    return { sql: `(${typeof_} = 'integer' AND CAST(${extract} AS INTEGER) = ?)`, params: [bound] };
  }
  if (typeof value === "number") {
    return { sql: `(${typeof_} IN ('integer', 'real') AND CAST(${extract} AS REAL) = ?)`, params: [value] };
  }
  // string
  return { sql: `(${typeof_} = 'text' AND ${extract} = ?)`, params: [String(value)] };
}
