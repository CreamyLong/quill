"use client";

import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

import type { FileTreeNode } from "./use-file-tree";

function fileIcon(_name: string) {
  return <File className="size-3.5 shrink-0" />;
}

export function FileTreeItem({
  node,
  depth,
  expandedPaths,
  selectedPath,
  loadingPaths,
  onToggle,
  onSelect,
}: {
  node: FileTreeNode;
  depth: number;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  loadingPaths?: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isDir = node.type === "directory";
  const expanded = isDir && expandedPaths.has(node.path);
  const selected = !isDir && selectedPath === node.path;
  const isLoading = loadingPaths?.has(node.path) ?? false;

  const handleClick = () => {
    if (isDir) {
      onToggle(node.path);
    } else {
      onSelect(node.path);
    }
  };

  return (
    <div className="select-none">
      <div
        className={cn(
          "flex min-w-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-accent/60",
          selected && "bg-accent text-accent-foreground",
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={handleClick}
        title={node.name}
      >
        {isDir ? (
          isLoading ? (
            <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
          ) : expanded ? (
            <ChevronDown className="size-3 shrink-0" />
          ) : (
            <ChevronRight className="size-3 shrink-0" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isDir ? (
          expanded ? (
            <FolderOpen className="size-3.5 shrink-0 text-blue-400" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-blue-400" />
          )
        ) : (
          fileIcon(node.name)
        )}
        <span className="truncate">{node.name}</span>
      </div>
      {isDir && expanded && isLoading && !node.children && (
        <div
          className="text-muted-foreground py-0.5 text-xs italic"
          style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
        >
          加载中...
        </div>
      )}
      {isDir && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              loadingPaths={loadingPaths}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
