"use client";

/**
 * Mention / capability picker for the chat input (ZCode composer sync).
 *
 * Ported from ZCode's `MentionPlugin` + `SlashCommandPlugin` interaction
 * model: typing `@` opens a grouped autocomplete panel (agents, skills)
 * with keyboard navigation; selecting an item inserts an atomic mention.
 * The panel is presentation-only — the input box owns trigger detection,
 * filtering, and insertion.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

import { BotIcon, SparklesIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface MentionItem {
  /** Inserted text (without the trigger). */
  name: string;
  description?: string;
  kind: "agent" | "skill";
}

export interface MentionPickerProps {
  items: MentionItem[];
  /** Flat index of the highlighted item. */
  selectedIndex: number;
  onSelect: (item: MentionItem) => void;
  onHover: (index: number) => void;
  trigger: "@" | "/";
  ariaLabel?: string;
}

const KIND_ICON = {
  agent: BotIcon,
  skill: SparklesIcon,
} as const;

const GROUP_LABEL = {
  agent: "Agents",
  skill: "Skills",
} as const;

export function MentionPicker({
  items,
  selectedIndex,
  onSelect,
  onHover,
  trigger,
  ariaLabel = "Mention suggestions",
}: MentionPickerProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the highlighted item in view while navigating with the keyboard.
  useEffect(() => {
    const container = listRef.current;
    const selected = container?.querySelector('[aria-selected="true"]');
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const groups = useMemo(() => {
    const byKind = new Map<MentionItem["kind"], MentionItem[]>();
    for (const item of items) {
      const list = byKind.get(item.kind) ?? [];
      list.push(item);
      byKind.set(item.kind, list);
    }
    return [...byKind.entries()];
  }, [items]);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    // Keep the textarea focused (matching the skill-suggestion behavior).
    event.preventDefault();
  }, []);

  return (
    <div
      className="bg-popover/95 text-popover-foreground border-border max-h-72 overflow-y-auto rounded-xl border p-1 shadow-lg backdrop-blur-sm"
      aria-label={ariaLabel}
      ref={listRef}
      role="listbox"
    >
      {groups.map(([kind, groupItems]) => (
        <div key={kind}>
          <div className="text-muted-foreground px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide uppercase">
            {GROUP_LABEL[kind]}
          </div>
          {groupItems.map((item) => {
            const flatIndex = items.indexOf(item);
            const selected = flatIndex === selectedIndex;
            const Icon = KIND_ICON[item.kind];
            return (
              <button
                aria-selected={selected}
                className={cn(
                  "flex min-h-12 w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                  selected
                    ? "bg-accent text-accent-foreground"
                    : "text-popover-foreground hover:bg-accent/70 hover:text-accent-foreground",
                )}
                key={`${item.kind}:${item.name}`}
                onClick={() => onSelect(item)}
                onMouseDown={handleMouseDown}
                onMouseEnter={() => onHover(flatIndex)}
                role="option"
                type="button"
              >
                <Icon className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {trigger}
                    {item.name}
                  </span>
                  {item.description && (
                    <span className="text-muted-foreground block truncate text-xs">
                      {item.description}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * Detect an active `@`-mention fragment ending at the caret: the text from
 * the last `@` (not at the start of a word) to the caret must be a single
 * word. Returns the fragment (without `@`) or null.
 */
export function getAtMentionQuery(
  value: string,
  caretIndex: number,
): string | null {
  const uptoCaret = value.slice(0, caretIndex);
  const match = /(^|\s)@([\w-]*)$/.exec(uptoCaret);
  if (match === null) {
    return null;
  }
  return match[2] ?? "";
}
