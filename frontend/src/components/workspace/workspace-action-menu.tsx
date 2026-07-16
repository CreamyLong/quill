"use client";

import {
  BrainIcon,
  MessageSquarePlus,
  PlusCircleIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useI18n } from "@/core/i18n/hooks";

export function WorkspaceActionMenu() {
  const { t } = useI18n();
  const pathname = usePathname();
  const isWork = pathname.startsWith("/workspace/work");
  const isPlugins = pathname.startsWith("/workspace/plugins");
  const isScheduledTasks = pathname.startsWith("/workspace/scheduled-tasks");
  const isWebBridge = pathname.startsWith("/workspace/webbridge");

  return (
    <SidebarMenu className="px-2">
      <SidebarMenuItem>
        <SidebarMenuButton asChild>
          <Link
            className="text-muted-foreground"
            href={isWork ? "/workspace/work" : "/workspace/chats/new"}
          >
            {isWork ? (
              <>
                <PlusCircleIcon size={16} />
                <span>{t.work.newTask}</span>
              </>
            ) : (
              <>
                <MessageSquarePlus size={16} />
                <span>{t.sidebar.newChat}</span>
              </>
            )}
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={isPlugins}>
          <Link href="/workspace/plugins">
            <WrenchIcon size={16} />
            <span>{t.sidebar.plugins}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={isScheduledTasks}>
          <Link href="/workspace/scheduled-tasks">
            <BrainIcon size={16} />
            <span>{t.sidebar.scheduledTasks}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={isWebBridge}>
          <Link href="/workspace/webbridge">
            <SparklesIcon size={16} />
            <span>{t.sidebar.webBridge}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
