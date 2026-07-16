"use client";

import {
  FolderOpen,
  FolderX,
  FolderCheck,
  ChevronDown,
  AlertCircle,
  Check,
} from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/core/i18n/hooks";
import { isTauri } from "@/core/tauri/tauri-fs-client";
import { cn } from "@/lib/utils";

export interface WorkspaceDirectoryPickerProps {
  /** Currently selected absolute directory path (or undefined if none). */
  value: string | undefined;
  /** Called when the user picks or clears a directory. */
  onChange: (value: string | undefined) => void;
}

/**
 * Compact directory picker above the chat input for new conversations.
 *
 * - Browser: user pastes an absolute path (browsers cannot reveal full paths).
 * - Tauri desktop: a native folder dialog is available.
 */
export function WorkspaceDirectoryPicker({
  value,
  onChange,
}: WorkspaceDirectoryPickerProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const tauri = isTauri();

  const basename = value
    ? value.split(/[\\/]/).filter(Boolean).pop() ?? value
    : "";

  const handlePick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const first = files[0];
      if (first) {
        const rel = first.webkitRelativePath;
        const dirName = rel.split("/")[0];
        if (dirName) {
          onChange(`/${dirName}`);
        }
      }
    }
    e.target.value = "";
  };

  const handleClear = () => {
    onChange(undefined);
    setExpanded(false);
  };

  // ── Collapsed: nothing selected ─────────────────────────────────────────
  if (!expanded && !value) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
          "border-dashed border-border bg-muted/20 text-muted-foreground hover:border-violet-500/40 hover:bg-violet-500/5 hover:text-violet-700",
          "dark:hover:text-violet-300",
        )}
      >
        <FolderOpen size={14} />
        <span>{t.inputBox.workspaceDirectoryLabel}</span>
        {!tauri && (
          <span title="浏览器需手动粘贴路径">
            <AlertCircle size={11} className="opacity-60" />
          </span>
        )}
      </button>
    );
  }

  // ── Collapsed: path selected ────────────────────────────────────────────
  if (!expanded && value) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          "group inline-flex h-8 max-w-[320px] items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
          "border-violet-500/30 bg-violet-500/10 text-violet-700 hover:border-violet-500/50 hover:bg-violet-500/15",
          "dark:text-violet-300",
        )}
        title={value}
      >
        <FolderCheck size={14} className="shrink-0" />
        <span className="truncate">{basename}</span>
        <ChevronDown
          size={12}
          className="shrink-0 opacity-50 transition-transform group-hover:opacity-100"
        />
        <span
          role="button"
          tabIndex={0}
          aria-label={t.inputBox.workspaceDirectoryClear}
          onClick={(e) => {
            e.stopPropagation();
            handleClear();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              handleClear();
            }
          }}
          className={cn(
            "-ml-0.5 grid size-5 shrink-0 place-items-center rounded-full transition-colors",
            "hover:bg-violet-500/20",
          )}
        >
          <FolderX size={12} />
        </span>
      </button>
    );
  }

  // ── Expanded: input + actions ──────────────────────────────────────────
  return (
    <div
      className={cn(
        "flex w-full max-w-md flex-col gap-2 rounded-xl border px-3 py-2.5 transition-colors",
        "border-violet-500/30 bg-violet-500/5",
      )}
    >
      <div className="flex items-center gap-2">
        <FolderOpen size={16} className="shrink-0 text-violet-500" />
        <Input
          type="text"
          autoFocus
          className="h-7 flex-1 border-none bg-transparent px-1 text-sm shadow-none outline-none focus-visible:ring-0"
          placeholder={t.inputBox.workspaceDirectoryPlaceholder}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") setExpanded(false);
          }}
        />
        {tauri && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              // @ts-expect-error — non-standard but supported in all major browsers
              webkitdirectory=""
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 px-2.5 text-xs"
              onClick={handlePick}
            >
              {t.inputBox.workspaceDirectoryBrowse}
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-7 w-7 shrink-0"
          onClick={() => setExpanded(false)}
          aria-label={t.common.close}
        >
          <Check size={14} />
        </Button>
      </div>
      {!tauri && (
        <p className="flex items-start gap-1.5 text-[10px] leading-tight text-muted-foreground">
          <AlertCircle size={11} className="mt-0.5 shrink-0" />
          浏览器安全限制无法直接选择本地文件夹，请从终端复制绝对路径后粘贴。
        </p>
      )}
    </div>
  );
}
