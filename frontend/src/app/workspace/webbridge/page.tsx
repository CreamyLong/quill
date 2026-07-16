"use client";

import { SkillSettingsPage } from "@/components/workspace/settings/skill-settings-page";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";

export default function WebBridgePage() {
  return (
    <WorkspaceContainer>
      <WorkspaceHeader />
      <WorkspaceBody>
        <div className="mx-auto w-full max-w-4xl px-4 py-8">
          <SkillSettingsPage />
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
