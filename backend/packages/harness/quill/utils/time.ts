/**
 * ISO 8601 timestamp helpers for the Gateway and embedded runtime.
 *
 * Mirrors `quill.utils.time` from the Python backend.
 */

const UNIX_TIMESTAMP_PATTERN = /^\d{10}(?:\.\d+)?$/;

/**
 * Return the current UTC time as an ISO 8601 string.
 *
 * Example: "2026-04-27T03:19:46.511Z"
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Best-effort coerce a stored timestamp to an ISO 8601 string.
 *
 * Translates legacy unix-timestamp floats / strings into ISO; ISO strings pass
 * through unchanged; Date instances emit `toISOString()`.
 */
export function coerceIso(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "number") {
    try {
      return new Date(value * 1000).toISOString();
    } catch {
      return String(value);
    }
  }
  if (typeof value === "string") {
    if (UNIX_TIMESTAMP_PATTERN.test(value)) {
      try {
        return new Date(Number.parseFloat(value) * 1000).toISOString();
      } catch {
        return value;
      }
    }
    return value;
  }
  return String(value);
}
