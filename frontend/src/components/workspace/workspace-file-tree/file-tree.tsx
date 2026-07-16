"use client";

import { FolderOpen } from "lucide-react";

import { cn } from "@/lib/utils";

import { useArtifacts } from "../artifacts";

import { FileTreeItem } from "./file-tree-item";
import type { FileTreeNode } from "./use-file-tree";

interface FileTreeContentProps {
  tree: FileTreeNode | null;
  loading: boolean;
  error: string | null;
  expandedPaths: Set<string>;
  loadingPaths?: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect?: (path: string) => void;
}

function renderNode(
  node: FileTreeNode,
  depth: number,
  expandedPaths: Set<string>,
  selectedPath: string | null,
  onToggle: (path: string) => void,
  onSelect: (path: string) => void,
  loadingPaths?: Set<string>,
) {
  return (
    <FileTreeItem
      key={node.path || node.name}
      node={node}
      depth={depth}
      expandedPaths={expandedPaths}
      selectedPath={selectedPath}
      loadingPaths={loadingPaths}
      onToggle={onToggle}
      onSelect={onSelect}
    />
  );
}

export function FileTreeContent({
  tree,
  loading,
  error,
  expandedPaths,
  loadingPaths,
  selectedPath,
  onToggle,
  onSelect: _onSelect,
}: FileTreeContentProps) {
  if (loading) {
    return <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>;
  }
  if (error) {
    return <div className="px-3 py-2 text-xs text-red-400">{error}</div>;
  }
  if (!tree) {
    return <div className="px-3 py-2 text-xs text-muted-foreground">No workspace selected</div>;
  }
  if (!tree.children || tree.children.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-xs text-muted-foreground">
        <FolderOpen size={28} className="opacity-40" />
        <span className="max-w-full break-keep">Empty workspace</span>
      </div>
    );
  }
  return (
    <div className="py-1">
      {tree.children.map((child) =>
        renderNode(child, 0, expandedPaths, selectedPath, onToggle, _onSelect ?? (() => { /* no-op */ }), loadingPaths),
      )}
    </div>
  );
}

/** Convenience wrapper that wires the tree state to the artifact preview panel. */
export function FileTreePanel({
  tree,
  loading,
  error,
  expandedPaths,
  loadingPaths,
  selectedPath,
  onToggle,
  className,
}: FileTreeContentProps & { className?: string }) {
  const { select: selectArtifact, setOpen: setArtifactsOpen } = useArtifacts();

  const handleSelect = (path: string) => {
    // BUG 2 fix: open the panel AND select the file. Previously only
    // selectArtifact was called, but setOpen(true) was missing, so the
    // panel stayed hidden.
    selectArtifact(path);
    setArtifactsOpen(true);
  };

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <FileTreeContent
        tree={tree}
        loading={loading}
        error={error}
        expandedPaths={expandedPaths}
        loadingPaths={loadingPaths}
        selectedPath={selectedPath}
        onToggle={onToggle}
        onSelect={handleSelect}
      />
    </div>
  );
}
