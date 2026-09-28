"use client";

import { BriefcaseIcon, MessagesSquare, FlaskConical } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

export function WorkspaceSidebarTabs() {
  const { t } = useI18n();
  const pathname = usePathname();
  const isWork = pathname.startsWith("/workspace/work");
  const isChat = pathname.startsWith("/workspace/chats");
  const isExperiments = pathname.startsWith("/workspace/experiments");

  return (
    <div className="flex items-center gap-1 px-2 py-2">
      <Link
        href="/workspace/work"
        className={cn(
          "group relative flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
          isWork
            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
        <BriefcaseIcon className={cn("size-4 transition-transform duration-200", isWork && "scale-110")} />
        <span>{t.work.title}</span>
        {isWork && (
          <span className="absolute -bottom-0.5 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-sidebar-primary" />
        )}
      </Link>
      <Link
        href="/workspace/chats/new"
        className={cn(
          "group relative flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
          isChat
            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
        <MessagesSquare className={cn("size-4 transition-transform duration-200", isChat && "scale-110")} />
        <span>{t.sidebar.chats}</span>
        {isChat && (
          <span className="absolute -bottom-0.5 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-sidebar-primary" />
        )}
      </Link>
      <Link
        href="/workspace/experiments"
        className={cn(
          "group relative flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
          isExperiments
            ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
        <FlaskConical className={cn("size-4 transition-transform duration-200", isExperiments && "scale-110")} />
        <span>Experiments</span>
        {isExperiments && (
          <span className="absolute -bottom-0.5 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-sidebar-primary" />
        )}
      </Link>
    </div>
  );
}
