"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { type PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { ChatBox } from "@/components/workspace/chats/chat-box";
import { useSpecificChatMode } from "@/components/workspace/chats/use-chat-mode";
import { useThreadChat } from "@/components/workspace/chats/use-thread-chat";
import { InputBox } from "@/components/workspace/input-box";
import { ThreadContext } from "@/components/workspace/messages/context";
import {
  MessageList,
  MESSAGE_LIST_DEFAULT_PADDING_BOTTOM,
} from "@/components/workspace/messages/message-list";
import { getAPIClient } from "@/core/api/api-client";
import { useModels } from "@/core/models/hooks";
import { useThreadSettings } from "@/core/settings/hooks";
import {
  createTask,
  getTask,
  listTasks,
  type WorkTask,
} from "@/core/tasks/work-api";
import { useThreadStream } from "@/core/threads/hooks";
import { cn } from "@/lib/utils";

const DEFAULT_TASK_ID = "default";

export default function WorkThreadPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = typeof params.task_id === "string" ? params.task_id : "";
  const threadId =
    typeof params.thread_id === "string" ? params.thread_id : "";
  const isDefaultTask = taskId === DEFAULT_TASK_ID;

  const { setThreadId, isNewThread, setIsNewThread, isMock } = useThreadChat();
  const [settings, setSettings] = useThreadSettings(threadId);
  const { tokenUsageEnabled } = useModels();
  useSpecificChatMode();

  const [task, setTask] = useState<WorkTask | null>(null);
  const [taskLoading, setTaskLoading] = useState(!isDefaultTask);

  useEffect(() => {
    if (isDefaultTask) {
      setTaskLoading(false);
      return;
    }
    setTaskLoading(true);
    getTask(taskId)
      .then((t) => {
        setTask(t);
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        setTaskLoading(false);
      });
  }, [taskId, isDefaultTask]);

  // Effective workspace directory: task folder for project-bound threads,
  // undefined for default threads (backend falls back to default workspace).
  const effectiveWorkspaceDir = isDefaultTask ? null : (task?.folder_path ?? null);

  const {
    thread,
    sendMessage,
    isHistoryLoading,
    hasMoreHistory,
    loadMoreHistory,
  } = useThreadStream({
    threadId: isNewThread ? undefined : threadId,
    displayThreadId: threadId,
    context: settings.context,
    isMock,
    onSend: () => {
      // no-op
    },
    onStart: (createdThreadId) => {
      setThreadId(createdThreadId);
      setIsNewThread(false);
    },
  });

  const handleSubmit = async (message: PromptInputMessage) => {
    const sendOptions =
      effectiveWorkspaceDir && !isDefaultTask
        ? { workspaceDirectory: effectiveWorkspaceDir }
        : undefined;

    if (effectiveWorkspaceDir && !isDefaultTask) {
      void (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const client = getAPIClient(isMock);
            await client.threads.update(threadId, {
              metadata: { workspace_directory: effectiveWorkspaceDir, task_id: taskId },
            });
            return;
          } catch {
            await new Promise((r) => setTimeout(r, 50 * (attempt + 1) ** 2));
          }
        }
      })();
    }

    const sendPromise = sendMessage(threadId, message, undefined, sendOptions);
    if (message.files.length > 0) {
      return sendPromise;
    }
    return sendPromise.catch(() => {
      // ignore
    });
  };

  const handleStop = async () => {
    await thread.stop();
  };

  return (
    <ThreadContext.Provider value={{ thread, isMock, workspaceDirectory: effectiveWorkspaceDir }}>
      <ChatBox
        threadId={threadId}
        workWorkspaceDir={effectiveWorkspaceDir}
        onWorkWorkspaceDirChange={async (dir) => {
          if (!dir) return;
          try {
            // Find or create a task for the selected folder.
            const existing = await listTasks(dir);
            const task =
              existing[0] ?? (await createTask(dir));
            const client = getAPIClient(isMock);
            await client.threads.update(threadId, {
              metadata: {
                workspace_directory: dir,
                task_id: task.task_id,
              },
            });
            // Navigate to the project-bound route so the sidebar shows it.
            if (task.task_id !== taskId) {
              router.replace(`/workspace/work/${task.task_id}/${threadId}`);
            }
          } catch {
            // ignore
          }
        }}
      >
        <div className="relative flex size-full min-h-0 justify-between">
          <main className="flex min-h-0 max-w-full grow flex-col">
            <div className="flex min-h-0 flex-1 justify-center">
              <MessageList
                className={cn("size-full", "!pt-10")}
                threadId={threadId}
                thread={thread}
                paddingBottom={MESSAGE_LIST_DEFAULT_PADDING_BOTTOM}
                hasMoreHistory={hasMoreHistory}
                loadMoreHistory={loadMoreHistory}
                isHistoryLoading={isHistoryLoading || taskLoading}
                tokenUsageInlineMode={
                  tokenUsageEnabled ? "off" : "off"
                }
                canRegenerate={!isNewThread && !isMock}
              />
            </div>
          </main>
        </div>
        <div className="sticky bottom-0 w-full shrink-0">
          <InputBox
            threadId={threadId}
            context={settings.context}
            onContextChange={(context) => setSettings("context", context)}
            onSubmit={handleSubmit}
            onStop={handleStop}
          />
        </div>
      </ChatBox>
    </ThreadContext.Provider>
  );
}
