/**
 * Replace sandbox virtual paths with human-readable host paths.
 *
 * In local mode the agent sees `/mnt/user-data/...` which maps to the thread's
 * workspace directory. When a workspace override is set, this helper translates
 * that prefix back to the real folder path so users don't see internal sandbox
 * paths in the UI.
 */
export function humanizeVirtualPaths(
  content: string,
  workspaceDir?: string | null,
): string {
  if (!workspaceDir) {
    return content.replace(/\/mnt\/user-data(?:\/|$|(?![\w-]))/g, (match) =>
      match.endsWith("/") ? "workspace/" : "workspace",
    );
  }
  const normalized = workspaceDir.replace(/\/$/, "");
  return content.replace(/\/mnt\/user-data(?:\/|$|(?![\w-]))/g, (match) =>
    match.endsWith("/") ? `${normalized}/` : normalized,
  );
}
