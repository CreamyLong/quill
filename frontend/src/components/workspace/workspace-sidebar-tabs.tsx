"use client";

import { BriefcaseIcon, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

export function WorkspaceSidebarTabs() {
  const { t } = useI18n();
  const pathname = usePathname();
  const isWork = pathname.startsWith("/workspace/work");
  const isChat = !isWork;

  return (
    <div className="flex items-center gap-1 px-2 py-2">
      <Link
        href="/workspace/work"
        className={cn(
          "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isWork
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
        )}
      >
        <BriefcaseIcon className="size-4" />
        <span>{t.work.title}</span>
      </Link>
      <Link
        href="/workspace/chats/new"
        className={cn(
          "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isChat
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
        )}
      >
        <MessagesSquare className="size-4" />
        <span>{t.sidebar.chats}</span>
      </Link>
    </div>
  );
}
