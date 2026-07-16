"use client";

import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";

import { RecentChatList } from "./recent-chat-list";
import { WorkProjectList } from "./work-project-list";
import { WorkspaceActionMenu } from "./workspace-action-menu";
import { WorkspaceNavMenu } from "./workspace-nav-menu";
import { WorkspaceSidebarTabs } from "./workspace-sidebar-tabs";

export function WorkspaceSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { open: isSidebarOpen } = useSidebar();
  const pathname = usePathname();
  const isWork = pathname.startsWith("/workspace/work");
  const isChat = !isWork;

  return (
    <>
      <Sidebar variant="sidebar" collapsible="none" {...props}>
        <SidebarHeader className="py-0">
          <WorkspaceSidebarTabs />
          <WorkspaceActionMenu />
        </SidebarHeader>
        <SidebarContent>
          {isWork && <WorkProjectList />}
          {isChat && <RecentChatList />}
        </SidebarContent>
        <SidebarFooter>
          <WorkspaceNavMenu />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </>
  );
}
