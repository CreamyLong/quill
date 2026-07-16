"use client";

import { FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";

/**
 * Pick a local workspace directory via the File System Access API
 * (window.showDirectoryPicker). Falls back gracefully when unsupported.
 */
export function DirectoryPicker({
  directoryName,
  onSelect,
}: {
  directoryName?: string | null;
  onSelect: (name: string) => void;
}) {
  const { t } = useI18n();

  const handlePick = async () => {
    // File System Access API — works on localhost / HTTPS.
    const w = window as unknown as {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    };
    if (typeof w.showDirectoryPicker !== "function") {
      alert("当前浏览器不支持目录选择器");
      return;
    }
    try {
      const handle = await w.showDirectoryPicker();
      onSelect(handle.name);
    } catch (err: unknown) {
      // User dismissed the picker (AbortError) — not an error worth surfacing.
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 gap-1.5 px-2 text-xs text-muted-foreground"
      onClick={handlePick}
      title={directoryName ?? t.inputBox.workspaceDirectoryPicker}
    >
      <FolderOpen size={14} />
      {directoryName ?? t.inputBox.workspaceDirectoryPicker}
    </Button>
  );
}
