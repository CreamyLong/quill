"use client";

import { ToolSettingsPage } from "@/components/workspace/settings/tool-settings-page";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";

export default function PluginsPage() {
  return (
    <WorkspaceContainer>
      <WorkspaceHeader />
      <WorkspaceBody>
        <div className="mx-auto w-full max-w-4xl px-4 py-8">
          <ToolSettingsPage />
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
