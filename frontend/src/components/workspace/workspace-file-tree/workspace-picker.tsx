"use client";

import { FolderOpen, Check, X, Loader2, FolderInput, AlertCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isTauri, pickFolder, validatePath } from "@/core/tauri/tauri-fs-client";

/**
 * Work-mode workspace picker.
 *
 * In the **Tauri desktop app**: opens the native folder dialog → absolute path.
 * In the **browser fallback**: shows a text input for the absolute path.
 *
 * Either way, the resolved absolute path is validated on the host and emitted
 * via `onChange`. The caller persists it to thread metadata so the backend
 * sandbox mounts it.
 */
export function WorkspacePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (absolutePath: string | null) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(!value);
  const [draft, setDraft] = useState(value ?? "");
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const tauri = isTauri();

  const handleNativePick = async () => {
    if (!tauri) return;
    try {
      const result = await pickFolder();
      if (result) {
        const v = await validatePath(result.path);
        if (v.valid && v.absolutePath) {
          onChange(v.absolutePath);
          setDraft(v.absolutePath);
          setValidationError(null);
          setEditing(false);
        } else {
          setValidationError(v.error ?? "Invalid directory");
        }
      }
    } catch {
      // User cancelled or Tauri unavailable.
    }
  };

  const handleConfirmPath = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onChange(null);
      setEditing(false);
      return;
    }
    setValidating(true);
    setValidationError(null);
    try {
      const v = await validatePath(trimmed);
      if (v.valid && v.absolutePath) {
        onChange(v.absolutePath);
        setEditing(false);
      } else {
        setValidationError(v.error ?? "Path not found or not a directory");
      }
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "Validation failed");
    } finally {
      setValidating(false);
    }
  };

  const handleClear = () => {
    onChange(null);
    setDraft("");
    setEditing(true);
    setValidationError(null);
  };

  if (editing) {
    return (
      <div className="w-full rounded-lg border bg-muted/30 p-2">
        <div className="flex items-center gap-1.5">
          <FolderInput size={14} className="shrink-0 text-muted-foreground" />
          <Input
            className="h-8 flex-1 border-none bg-transparent px-1 text-xs shadow-none"
            placeholder={tauri ? "/Users/you/projects/my-folder" : "粘贴绝对路径，如 /Users/you/project"}
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleConfirmPath();
              if (e.key === "Escape") {
                setDraft(value ?? "");
                setEditing(false);
              }
            }}
            autoFocus
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7"
            onClick={handleConfirmPath}
            disabled={disabled || validating}
            title="确认"
          >
            {validating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-7 w-7"
              onClick={() => {
                setDraft(value ?? "");
                setEditing(false);
              }}
              disabled={disabled}
              title="取消"
            >
              <X size={14} />
            </Button>
          )}
        </div>
        {!tauri && (
          <p className="mt-1.5 flex items-start gap-1 text-[10px] leading-tight text-muted-foreground">
            <AlertCircle size={11} className="mt-0.5 shrink-0" />
            浏览器无法直接选择本地文件夹。请从终端复制绝对路径后粘贴到这里。
          </p>
        )}
        {tauri && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 h-7 w-full text-xs"
            onClick={handleNativePick}
            disabled={disabled}
          >
            <FolderOpen size={13} className="mr-1.5" />
            打开文件夹选择器
          </Button>
        )}
        {validationError && (
          <div className="mt-1.5 flex items-start gap-1 text-[10px] leading-tight text-red-500">
            <AlertCircle size={11} className="mt-0.5 shrink-0" />
            {validationError}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="group relative w-full rounded-lg border border-transparent bg-muted/20 px-2 py-1.5 hover:bg-muted/40">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left text-xs disabled:opacity-50"
        disabled={disabled}
        onClick={() => {
          setDraft(value ?? "");
          setEditing(true);
          setValidationError(null);
        }}
        title={value ?? "选择工作目录"}
      >
        <FolderOpen size={14} className="shrink-0 text-muted-foreground" />
        {value ? (
          <span className="min-w-0 flex-1 truncate font-medium">{value}</span>
        ) : (
          <span className="flex-1 text-muted-foreground">选择工作目录…</span>
        )}
      </button>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute right-3 top-2 h-6 w-6 opacity-0 hover:opacity-100 group-hover:opacity-100"
          onClick={handleClear}
          title="清除"
        >
          <X size={12} />
        </Button>
      )}
    </div>
  );
}
