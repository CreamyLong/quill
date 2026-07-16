"use client";

import { MemorySettingsPage } from "@/components/workspace/settings/memory-settings-page";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";

export default function ScheduledTasksPage() {
  return (
    <WorkspaceContainer>
      <WorkspaceHeader />
      <WorkspaceBody>
        <div className="mx-auto w-full max-w-4xl px-4 py-8">
          <MemorySettingsPage />
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
