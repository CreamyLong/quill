/**
 * Shared command definitions used by all channel implementations.
 */

export const KNOWN_CHANNEL_COMMANDS: ReadonlySet<string> = new Set([
  "/bootstrap",
  "/new",
  "/status",
  "/models",
  "/memory",
  "/help",
]);

/**
 * Extract the one-time channel binding code from a connect command.
 */
export function extractConnectCode(text: string): string | null {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) {
    return null;
  }
  const command = parts[0].toLowerCase();
  if (command === "/connect" || command === "connect") {
    return parts[1];
  }
  return null;
}

/**
 * Return whether text starts with a registered channel control command.
 */
export function isKnownChannelCommand(text: string): boolean {
  if (!text.startsWith("/")) {
    return false;
  }
  return KNOWN_CHANNEL_COMMANDS.has(text.split(/\s+/, 2)[0].toLowerCase());
}
