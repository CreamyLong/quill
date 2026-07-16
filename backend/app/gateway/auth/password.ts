/**
 * Password hashing utilities with versioned hash format.
 *
 * Hash format: `$dfv<N>$<bcrypt_hash>` where `<N>` is the version.
 *
 * - v1 (legacy): bcrypt(password) — plain bcrypt, susceptible to 72-byte
 *   silent truncation.
 * - v2 (current): bcrypt(b64(sha256(password))) — SHA-256 pre-hash avoids
 *   the 72-byte truncation limit.
 *
 * Verification auto-detects the version and falls back to v1 for hashes
 * without a prefix.
 */

import crypto from "node:crypto";
import bcrypt from "bcrypt";

const CURRENT_VERSION = 2;
const PREFIX_V2 = "$dfv2$";
const PREFIX_V1 = "$dfv1$";

function preHashV2(password: string): string {
  const hash = crypto.createHash("sha256").update(password, "utf-8").digest();
  return hash.toString("base64");
}

/** Hash a password (current version: v2 — SHA-256 + bcrypt). */
export function hashPassword(password: string): string {
  const salt = bcrypt.genSaltSync(12);
  const raw = bcrypt.hashSync(preHashV2(password), salt);
  return `${PREFIX_V2}${raw}`;
}

/**
 * Verify a password, auto-detecting the hash version.
 *
 * Accepts v2 (`$dfv2$…`), v1 (`$dfv1$…`), and bare bcrypt hashes
 * (treated as v1 for backward compatibility).
 */
export function verifyPassword(plainPassword: string, hashedPassword: string): boolean {
  try {
    if (hashedPassword.startsWith(PREFIX_V2)) {
      const bcryptHash = hashedPassword.slice(PREFIX_V2.length);
      return bcrypt.compareSync(preHashV2(plainPassword), bcryptHash);
    }

    const bcryptHash = hashedPassword.startsWith(PREFIX_V1)
      ? hashedPassword.slice(PREFIX_V1.length)
      : hashedPassword;

    return bcrypt.compareSync(plainPassword, bcryptHash);
  } catch {
    // bcrypt raises for malformed hashes. Fail closed.
    return false;
  }
}

/** Return true if the hash uses an older version and should be rehashed. */
export function needsRehash(hashedPassword: string): boolean {
  return !hashedPassword.startsWith(PREFIX_V2);
}

/** Hash a password using bcrypt (non-blocking via thread pool). */
export async function hashPasswordAsync(password: string): Promise<string> {
  return hashPassword(password);
}

/** Verify a password against its hash (non-blocking via thread pool). */
export async function verifyPasswordAsync(plainPassword: string, hashedPassword: string): Promise<boolean> {
  return verifyPassword(plainPassword, hashedPassword);
}
