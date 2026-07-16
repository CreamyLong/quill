/**
 * Shared path resolution for thread virtual paths (e.g. mnt/user-data/outputs/...).
 */

import path from "node:path";

export interface ThreadPathResolver {
  resolveVirtualPath(threadId: string, virtualPath: string, options?: { userId?: string }): string;
}

export interface PathResolutionError extends Error {
  cause?: unknown;
}

/**
 * Resolve a virtual path to the actual filesystem path under thread user-data.
 *
 * @param threadId The thread ID.
 * @param virtualPath The virtual path as seen inside the sandbox
 *                    (e.g., /mnt/user-data/outputs/file.txt).
 * @param paths Resolver implementation injected by caller.
 * @param getUserId Function returning the effective user id.
 * @returns The resolved filesystem path.
 * @throws {PathResolutionError} If the path is invalid or outside allowed directories.
 */
export function resolveThreadVirtualPath(
  threadId: string,
  virtualPath: string,
  paths: ThreadPathResolver,
  getUserId: () => string | undefined
): string {
  try {
    const resolved = paths.resolveVirtualPath(threadId, virtualPath, { userId: getUserId() });
    return path.normalize(resolved);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.toLowerCase().includes("traversal") ? 403 : 400;
    const err = new Error(message) as PathResolutionError;
    err.cause = error;
    // Attach HTTP status as a custom property so Fastify/Express handlers can map it.
    (err as unknown as { status: number }).status = status;
    throw err;
  }
}
