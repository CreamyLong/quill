"use client";

import { FilesIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  ArtifactFileDetail,
  ArtifactFileList,
  useArtifacts,
} from "../artifacts";
import { useThread } from "../messages/context";
import { WorkspaceFileTreePanel } from "../workspace-file-tree/workspace-file-tree-panel";

const FILE_TREE_WIDTH = 460;
const ARTIFACTS_WIDTH = 680;

const ChatBox: React.FC<{
  children: React.ReactNode;
  threadId: string;
  workWorkspaceDir?: string | null;
  onWorkWorkspaceDirChange?: (dir: string | null) => void;
}> = ({
  children,
  threadId,
  workWorkspaceDir,
  onWorkWorkspaceDirChange,
}) => {
  const { thread } = useThread();
  const workspaceDirectory = workWorkspaceDir ?? null;
  const isWorkMode = typeof workspaceDirectory === "string";

  const {
    artifacts,
    open: artifactsOpen,
    setOpen: setArtifactsOpen,
    setArtifacts,
    deselect,
    selectedArtifact,
  } = useArtifacts();

  const prevThreadRef = useRef(threadId);
  useEffect(() => {
    if (prevThreadRef.current !== threadId) {
      deselect();
      setArtifacts([]);
      prevThreadRef.current = threadId;
    }
    const threadArtifacts = Array.isArray(thread.values.artifacts)
      ? Array.from(new Set(thread.values.artifacts))
      : undefined;
    if (threadArtifacts) {
      setArtifacts(threadArtifacts);
    }
  }, [threadId, thread.values.artifacts, deselect, setArtifacts]);

  return (
    <>
      {isWorkMode && (
        <div className="flex items-center justify-between border-b px-3 py-1.5">
          <span
            className="ml-auto truncate text-xs text-muted-foreground"
            title={workspaceDirectory}
          >
            📁 {workspaceDirectory}
          </span>
        </div>
      )}

      {/* Main area: chat + optional fixed file-tree + optional artifacts */}
      <div className="flex h-full w-full overflow-hidden">
        <div className="relative flex-1 min-w-0">{children}</div>

        {isWorkMode && (
          <div
            className="shrink-0 border-l bg-background"
            style={{ width: FILE_TREE_WIDTH }}
          >
            <WorkspaceFileTreePanel
              threadId={threadId}
              workspaceDirectory={workspaceDirectory}
              onWorkspaceDirectoryChange={onWorkWorkspaceDirChange}
              streaming={thread.isLoading}
            />
          </div>
        )}

        <div
          className={cn(
            "shrink-0 overflow-hidden border-l bg-background transition-all duration-300 ease-in-out",
            artifactsOpen ? "opacity-100" : "w-0 border-l-0 opacity-0",
          )}
          style={{ width: artifactsOpen ? ARTIFACTS_WIDTH : 0 }}
        >
          <div className="relative h-full w-full p-4">
            {selectedArtifact ? (
              <ArtifactFileDetail
                className="size-full"
                filepath={selectedArtifact}
                threadId={threadId}
              />
            ) : (
              <div className="relative flex size-full justify-center">
                <div className="absolute top-1 right-1 z-30">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => setArtifactsOpen(false)}
                  >
                    <XIcon />
                  </Button>
                </div>
                {artifacts.length === 0 ? (
                  <ConversationEmptyState
                    icon={<FilesIcon />}
                    title="No artifact selected"
                    description="Select an artifact to view its details"
                  />
                ) : (
                  <div className="flex size-full max-w-(--container-width-sm) flex-col justify-center p-4 pt-8">
                    <header className="shrink-0">
                      <h2 className="text-lg font-medium">Artifacts</h2>
                    </header>
                    <main className="min-h-0 grow">
                      <ArtifactFileList
                        className="max-w-(--container-width-sm) p-4 pt-12"
                        files={artifacts}
                        threadId={threadId}
                      />
                    </main>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export { ChatBox };
