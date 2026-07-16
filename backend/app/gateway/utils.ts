/**
 * Shared utility helpers for the Gateway layer.
 */

/**
 * Strip control characters to prevent log injection.
 */
export function sanitizeLogParam(value: string): string {
  return value.replace(/\n/g, "").replace(/\r/g, "").replace(/\0/g, "");
}
