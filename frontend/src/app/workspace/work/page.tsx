"use client";

import { BriefcaseIcon, FolderOpen, MessageSquarePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AuroraText } from "@/components/ui/aurora-text";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  WorkspaceBody,
  WorkspaceContainer,
  WorkspaceHeader,
} from "@/components/workspace/workspace-container";
import { WorkspaceDirectoryPicker } from "@/components/workspace/workspace-directory-picker";
import { getAPIClient } from "@/core/api/api-client";
import { useI18n } from "@/core/i18n/hooks";
import {
  createTask,
  listTasks,
  type WorkTask,
} from "@/core/tasks/work-api";

export default function WorkPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await listTasks();
      setTasks(list);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    document.title = `${t.work.title} - Quill`;
  }, [t.work.title]);

  const handleFolderSelected = async (folderPath: string | undefined) => {
    if (!folderPath) return;
    try {
      const task = await createTask(folderPath);
      const client = getAPIClient();
      const threadId = crypto.randomUUID();
      await client.threads.create({
        threadId,
        metadata: {
          task_id: task.task_id,
          workspace_directory: folderPath,
        },
      });
      router.push(`/workspace/work/${task.task_id}/${threadId}`);
    } catch {
      // ignore
    }
  };

  const handleNewDefaultConversation = async () => {
    try {
      const client = getAPIClient();
      const threadId = crypto.randomUUID();
      await client.threads.create({
        threadId,
        metadata: { workspace_mode: "work" },
      });
      router.push(`/workspace/work/default/${threadId}`);
    } catch {
      // ignore
    }
  };

  const handleOpenProject = async (task: WorkTask) => {
    try {
      const client = getAPIClient();
      const threadId = crypto.randomUUID();
      await client.threads.create({
        threadId,
        metadata: {
          task_id: task.task_id,
          workspace_directory: task.folder_path,
        },
      });
      router.push(`/workspace/work/${task.task_id}/${threadId}`);
    } catch {
      // ignore
    }
  };

  return (
    <WorkspaceContainer>
      <WorkspaceHeader></WorkspaceHeader>
      <WorkspaceBody>
        <div className="flex size-full flex-col">
          <header className="flex shrink-0 flex-col items-center justify-center pt-12 sm:pt-20">
            <div className="flex max-w-(--container-width-md) flex-col items-center gap-4 px-4">
              <div className="flex items-center gap-3">
                <div className="bg-primary/10 flex size-12 items-center justify-center rounded-2xl">
                  <BriefcaseIcon className="text-primary size-6" />
                </div>
              </div>
              <h1 className="text-center text-2xl font-semibold sm:text-3xl">
                <AuroraText colors={["#e9c665", "#efefbb", "#e3a812", "#e9c665"]} className="drop-shadow-[0_0_25px_rgba(233,198,101,0.45)]">
                  让 Quill 来帮你完成任务
                </AuroraText>
              </h1>
              <p className="text-muted-foreground text-center text-sm">
                {t.work.subtitle}
              </p>
            </div>
          </header>
          <main className="min-h-0 flex-1">
            <ScrollArea className="size-full py-8">
              <div className="mx-auto flex size-full max-w-(--container-width-md) flex-col gap-6 px-4">
                <div className="flex flex-col gap-3 rounded-2xl border p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{t.work.selectFolder}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={handleNewDefaultConversation}
                    >
                      <MessageSquarePlus className="size-4" />
                      {t.work.newConversation}
                    </Button>
                  </div>
                  <WorkspaceDirectoryPicker
                    value={undefined}
                    onChange={handleFolderSelected}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <h2 className="text-muted-foreground px-1 text-xs font-medium uppercase tracking-wide">
                    {t.work.projects}
                  </h2>
                  {loading ? (
                    <div className="text-muted-foreground p-4 text-sm">
                      {t.common.loading}
                    </div>
                  ) : tasks.length === 0 ? (
                    <div className="text-muted-foreground p-4 text-sm">
                      {t.work.noTasks}
                    </div>
                  ) : (
                    tasks.map((task) => (
                      <button
                        key={task.task_id}
                        type="button"
                        onClick={() => void handleOpenProject(task)}
                        className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
                      >
                        <FolderOpen className="size-5 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{task.name}</div>
                          <div className="text-muted-foreground truncate text-xs">
                            {task.folder_path}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </ScrollArea>
          </main>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
