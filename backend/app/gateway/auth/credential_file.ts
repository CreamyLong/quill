/**
 * Write initial admin credentials to a restricted file instead of logs.
 */

import fs from "node:fs";
import path from "node:path";

const CREDENTIAL_FILENAME = "admin_initial_credentials.txt";

export interface PathsLike {
  baseDir: string;
}

/**
 * Write the admin email + password to `{base_dir}/admin_initial_credentials.txt`.
 *
 * The file is created atomically with mode 0600 so the password is never
 * world-readable.
 */
export function writeInitialCredentials(
  email: string,
  password: string,
  paths: PathsLike,
  { label = "initial" }: { label?: string } = {}
): string {
  const target = path.join(paths.baseDir, CREDENTIAL_FILENAME);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const content =
    `# Quill admin ${label} credentials\n` +
    "# This file is generated on first boot or password reset.\n" +
    "# Change the password after login via Settings -> Account,\n" +
    "# then delete this file.\n#\n" +
    `email: ${email}\n` +
    `password: ${password}\n`;

  // Atomic 0600 create-or-truncate.
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC, 0o600);
  try {
    fs.writeFileSync(fd, content, { encoding: "utf-8" });
  } finally {
    fs.closeSync(fd);
  }

  return path.resolve(target);
}
