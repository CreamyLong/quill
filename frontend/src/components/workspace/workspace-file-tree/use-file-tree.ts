"use client";

import { useCallback, useEffect, useState } from "react";

import { useDebouncedValue } from "@/core/hooks/use-debounced-value";

/**
 * File tree node shape returned by `GET /threads/{id}/files/tree`.
 */
export interface FileTreeNode {
  name: string;
  path: string; // POSIX-style relative path from workspace root
  type: "file" | "directory";
  size?: number;
  modified?: string;
  /** Undefined when a directory's children haven't been lazy-loaded yet. */
  children?: FileTreeNode[];
}

export interface FileTreeState {
  /** The workspace root path being displayed (or null when none set). */
  root: string | null;
  tree: FileTreeNode | null;
  loading: boolean;
  error: string | null;
  expandedPaths: Set<string>;
  /** Paths currently fetching their children (lazy loading). */
  loadingPaths: Set<string>;
  toggle: (path: string) => void;
  /** Refetch the tree. */
  refetch: () => void;
  /** Currently selected file path (for preview in right panel). */
  selectedPath: string | null;
  select: (path: string | null) => void;
}

const DEBOUNCE_MS = 300;
const POLL_INTERVAL_MS = 3000;

/**
 * Recursively find a node by path in the tree and apply a transform.
 * Returns a new tree (immutable) — original is untouched.
 */
function updateNodeInTree(
  tree: FileTreeNode,
  targetPath: string,
  transform: (node: FileTreeNode) => FileTreeNode,
): FileTreeNode {
  if (tree.path === targetPath) {
    return transform(tree);
  }
  if (!tree.children) return tree;
  let changed = false;
  const newChildren = tree.children.map((child) => {
    // Only recurse into directories that could contain the target.
    if (child.type === "directory" && targetPath.startsWith(child.path + "/")) {
      const updated = updateNodeInTree(child, targetPath, transform);
      if (updated !== child) changed = true;
      return updated;
    }
    // Also check exact match.
    if (child.path === targetPath) {
      changed = true;
      return transform(child);
    }
    return child;
  });
  return changed ? { ...tree, children: newChildren } : tree;
}

export function useFileTree(
  threadId: string | undefined,
  streaming = false,
  workspaceDirectory?: string | null,
): FileTreeState {
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set([""]));
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const debouncedTick = useDebouncedValue(refreshTick, DEBOUNCE_MS);

  const buildTreeUrl = (subPath?: string) => {
    const base = `/api/threads/${encodeURIComponent(threadId!)}/files/tree`;
    return subPath ? `${base}?path=${encodeURIComponent(subPath)}` : base;
  };

  /** Fetch the root level (direct children of the workspace root). */
  const fetchTree = useCallback(async () => {
    if (!threadId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildTreeUrl());
      if (!res.ok) throw new Error(`Tree fetch failed: ${res.status}`);
      const data = (await res.json()) as FileTreeNode;
      setTree(data);
      setRoot(data.path || "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  /** Lazy-load children for a specific directory path. */
  const fetchChildren = useCallback(
    async (dirPath: string) => {
      if (!threadId || !tree) return;
      setLoadingPaths((prev) => new Set(prev).add(dirPath));
      try {
        const res = await fetch(buildTreeUrl(dirPath));
        if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
        const data = (await res.json()) as FileTreeNode;
        const children = data.children ?? [];
        setTree((prevTree) => {
          if (!prevTree) return prevTree;
          return updateNodeInTree(prevTree, dirPath, (node) => ({
            ...node,
            children,
          }));
        });
      } catch {
        // On error, remove from loading and collapse.
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
      } finally {
        setLoadingPaths((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
      }
    },
    [threadId, tree],
  );

  // Initial fetch + refetch when the workspace directory changes.
  useEffect(() => {
    if (threadId) {
      setTree(null);
      setExpandedPaths(new Set([""]));
      void fetchTree();
    }
  }, [threadId, fetchTree, workspaceDirectory]);

  // Refetch on explicit refetch() calls.
  useEffect(() => {
    if (threadId && debouncedTick > 0) {
      void fetchTree();
    }
  }, [threadId, fetchTree, debouncedTick]);

  // Poll while streaming: refresh root + all expanded dirs.
  useEffect(() => {
    if (!streaming || !threadId) return;
    const interval = setInterval(() => {
      void fetchTree();
      // Re-fetch each expanded directory that has been loaded.
      for (const p of expandedPaths) {
        if (p === "") continue;
        void fetchChildren(p);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [streaming, threadId, fetchTree, fetchChildren, expandedPaths]);

  /**
   * Toggle a directory: expand or collapse.
   * On first expand, if children are undefined, lazy-load them first.
   */
  const toggle = useCallback(
    (nodePath: string) => {
      // Check if currently expanded.
      setExpandedPaths((prevExpanded) => {
        const next = new Set(prevExpanded);
        if (next.has(nodePath)) {
          // Collapse — just remove from set.
          next.delete(nodePath);
          return next;
        }
        // Expand.
        next.add(nodePath);

        // Lazy-load if children haven't been fetched yet.
        // Use setTree callback to check current tree state synchronously.
        if (tree && nodePath !== "") {
          // Walk the tree to find this node.
          const findNode = (n: FileTreeNode): FileTreeNode | null => {
            if (n.path === nodePath) return n;
            if (!n.children) return null;
            for (const child of n.children) {
              const found = findNode(child);
              if (found) return found;
            }
            return null;
          };
          const target = findNode(tree);
          if (target?.type === "directory" && target.children === undefined) {
            void fetchChildren(nodePath);
          }
        }
        return next;
      });
    },
    [tree, fetchChildren],
  );

  const select = useCallback((path: string | null) => {
    setSelectedPath(path);
  }, []);

  const refetch = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  return {
    root,
    tree,
    loading,
    error,
    expandedPaths,
    loadingPaths,
    toggle,
    refetch,
    selectedPath,
    select,
  };
}
