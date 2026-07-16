"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { FileTreePanel } from "./file-tree";
import { useFileTree } from "./use-file-tree";
import { WorkspacePicker } from "./workspace-picker";

/**
 * Self-contained Work-mode file tree panel. Combines directory selection
 * (native picker in Tauri / text input in browser), tree display, and
 * streaming-aware refresh.
 */
export function WorkspaceFileTreePanel({
  threadId,
  workspaceDirectory,
  onWorkspaceDirectoryChange,
  streaming = false,
  className,
}: {
  threadId: string | undefined;
  workspaceDirectory?: string | null;
  onWorkspaceDirectoryChange?: (dir: string | null) => void;
  streaming?: boolean;
  className?: string;
}) {
  const { root, tree, loading, error, expandedPaths, loadingPaths, toggle, selectedPath, refetch } =
    useFileTree(threadId, streaming, workspaceDirectory);
  const [persisting, setPersisting] = useState(false);

  const handleDirChange = useCallback(
    async (absolutePath: string | null) => {
      if (!threadId) {
        onWorkspaceDirectoryChange?.(absolutePath);
        return;
      }

      if (!absolutePath) {
        onWorkspaceDirectoryChange?.(null);
        return;
      }

      setPersisting(true);
      try {
        const { getAPIClient } = await import("@/core/api/api-client");
        await getAPIClient(false).threads.update(threadId, {
          metadata: { workspace_directory: absolutePath },
        });
        // Only update local state after the backend has persisted the new
        // workspace directory, so the subsequent /files/tree fetch sees it.
        onWorkspaceDirectoryChange?.(absolutePath);
        toast.success(`工作目录已设置: ${absolutePath}`);
      } catch (err) {
        toast.error(
          `保存工作目录失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setPersisting(false);
      }
    },
    [onWorkspaceDirectoryChange, threadId],
  );

  return (
    <div className={cn("flex h-full flex-col gap-1", className)}>
      {/* Path picker row */}
      <div className="flex items-center border-b px-3 py-2">
        <WorkspacePicker
          value={workspaceDirectory ?? root}
          onChange={handleDirChange}
          disabled={persisting}
        />
      </div>
      {/* Tree */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FileTreePanel
          tree={tree}
          loading={loading || persisting}
          error={error}
          expandedPaths={expandedPaths}
          loadingPaths={loadingPaths}
          selectedPath={selectedPath}
          onToggle={toggle}
        />
      </div>
    </div>
  );
}
