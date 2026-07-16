"use client";

import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { getAPIClient } from "@/core/api/api-client";
import { useI18n } from "@/core/i18n/hooks";
import {
  listTasks,
  listTaskThreads,
  type WorkTask,
} from "@/core/tasks/work-api";
import { textOfMessage, titleOfThread } from "@/core/threads/utils";
import { cn } from "@/lib/utils";

interface TaskWithThreads extends WorkTask {
  threads: Array<Record<string, unknown>>;
  loaded: boolean;
  loading: boolean;
}

function displayNameOfThread(
  thread: Record<string, unknown>,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const title = titleOfThread(thread as never);
  if (title && title !== "Untitled") {
    return title;
  }
  const messages = (thread.values as Record<string, unknown> | undefined)?.messages;
  if (Array.isArray(messages)) {
    const firstUser = messages.find(
      (m) =>
        m != null &&
        typeof m === "object" &&
        ("type" in m ? (m as Record<string, unknown>).type === "human" : true),
    );
    if (firstUser) {
      const text = textOfMessage(firstUser as never);
      if (text) {
        return text.length > 30 ? text.slice(0, 30) + "…" : text;
      }
    }
  }
  return t.work.newConversation;
}

export function WorkProjectList() {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams();
  const currentTaskId =
    typeof params.task_id === "string" ? params.task_id : "";
  const currentThreadId =
    typeof params.thread_id === "string" ? params.thread_id : "";

  const [tasks, setTasks] = useState<TaskWithThreads[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const refreshTasks = useCallback(async () => {
    try {
      const list = await listTasks();
      setTasks((prev) =>
        list.map((task) => {
          const existing = prev.find((p) => p.task_id === task.task_id);
          return {
            ...task,
            threads: existing?.threads ?? [],
            loaded: existing?.loaded ?? false,
            loading: existing?.loading ?? false,
          };
        }),
      );
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTasks();
  }, [refreshTasks, pathname]);

  // Auto-expand the current task and load its threads
  useEffect(() => {
    if (!currentTaskId || currentTaskId === "default") return;
    setExpanded((prev) => new Set(prev).add(currentTaskId));
    const task = tasks.find((t) => t.task_id === currentTaskId);
    if (task && !task.loaded && !task.loading) {
      setTasks((prev) =>
        prev.map((t) =>
          t.task_id === currentTaskId ? { ...t, loading: true } : t,
        ),
      );
      listTaskThreads(currentTaskId)
        .then((threads) => {
          setTasks((prev) =>
            prev.map((t) =>
              t.task_id === currentTaskId
                ? { ...t, threads, loaded: true, loading: false }
                : t,
            ),
          );
        })
        .catch(() => {
          setTasks((prev) =>
            prev.map((t) =>
              t.task_id === currentTaskId
                ? { ...t, loaded: true, loading: false }
                : t,
            ),
          );
        });
    }
  }, [currentTaskId, tasks]);

  const toggleTask = useCallback(
    async (taskId: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(taskId)) {
          next.delete(taskId);
        } else {
          next.add(taskId);
        }
        return next;
      });

      const task = tasks.find((t) => t.task_id === taskId);
      if (task && !task.loaded && !task.loading) {
        setTasks((prev) =>
          prev.map((t) =>
            t.task_id === taskId ? { ...t, loading: true } : t,
          ),
        );
        try {
          const threads = await listTaskThreads(taskId);
          setTasks((prev) =>
            prev.map((t) =>
              t.task_id === taskId
                ? { ...t, threads, loaded: true, loading: false }
                : t,
            ),
          );
        } catch {
          setTasks((prev) =>
            prev.map((t) =>
              t.task_id === taskId
                ? { ...t, loaded: true, loading: false }
                : t,
            ),
          );
        }
      }
    },
    [tasks],
  );

  const handleNewConversation = useCallback(
    async (taskId: string) => {
      try {
        const client = getAPIClient();
        const threadId = crypto.randomUUID();
        await client.threads.create({
          threadId,
          metadata: { task_id: taskId },
        });
        router.push(`/workspace/work/${taskId}/${threadId}`);
      } catch {
        // ignore
      }
    },
    [router],
  );

  if (!pathname.startsWith("/workspace/work")) {
    return null;
  }

  return (
    <SidebarGroup className="pt-1">
      <SidebarGroupLabel>{t.work.projects}</SidebarGroupLabel>
      <SidebarGroupContent>
        {loading ? (
          <div className="text-muted-foreground px-4 py-2 text-xs">
            {t.common.loading}
          </div>
        ) : tasks.length === 0 ? (
          <Link
            href="/workspace/work"
            className="text-muted-foreground hover:text-foreground block px-4 py-2 text-xs"
          >
            {t.work.noTasks}
          </Link>
        ) : (
          <SidebarMenu className="gap-0.5">
            {tasks.map((task) => {
              const isExpanded = expanded.has(task.task_id);
              const isActiveTask = currentTaskId === task.task_id;
              return (
                <Collapsible
                  key={task.task_id}
                  open={isExpanded}
                  onOpenChange={() => void toggleTask(task.task_id)}
                >
                  <SidebarMenuItem className="flex flex-col">
                    <div className="flex w-full items-center">
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-md"
                          aria-label={isExpanded ? "Collapse" : "Expand"}
                        >
                          {isExpanded ? (
                            <ChevronDownIcon className="size-3.5" />
                          ) : (
                            <ChevronRightIcon className="size-3.5" />
                          )}
                        </button>
                      </CollapsibleTrigger>
                      <SidebarMenuButton
                        isActive={isActiveTask && !currentThreadId}
                        className="min-w-0 flex-1"
                        onClick={() => void toggleTask(task.task_id)}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {isActiveTask ? (
                            <FolderOpenIcon className="size-4 shrink-0" />
                          ) : (
                            <FolderIcon className="size-4 shrink-0" />
                          )}
                          <span className="min-w-0 truncate" title={task.name}>
                            {task.name}
                          </span>
                        </span>
                      </SidebarMenuButton>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-foreground size-7 shrink-0"
                        onClick={() => void handleNewConversation(task.task_id)}
                        title={t.work.newConversation}
                      >
                        <MessageSquarePlusIcon className="size-3.5" />
                      </Button>
                    </div>
                    <CollapsibleContent>
                      <div className="pl-6">
                        {task.loading ? (
                          <div className="text-muted-foreground px-4 py-2 text-xs">
                            {t.common.loading}
                          </div>
                        ) : task.threads.length === 0 ? (
                          <button
                            type="button"
                            onClick={() => void handleNewConversation(task.task_id)}
                            className="text-muted-foreground hover:text-foreground block px-4 py-1.5 text-xs"
                          >
                            {t.work.noConversations}
                          </button>
                        ) : (
                          <SidebarMenu className="gap-0">
                            {task.threads.map((thread) => {
                              const threadId =
                                (thread.thread_id as string) ?? "";
                              const displayName = displayNameOfThread(thread, t);
                              const isActiveThread =
                                currentThreadId === threadId;
                              return (
                                <SidebarMenuItem key={threadId}>
                                  <SidebarMenuButton
                                    isActive={isActiveThread}
                                    asChild
                                    className="min-w-0"
                                  >
                                    <Link
                                      href={`/workspace/work/${task.task_id}/${threadId}`}
                                      className={cn(
                                        "text-muted-foreground min-w-0",
                                        isActiveThread && "text-foreground",
                                      )}
                                      title={displayName}
                                    >
                                      <MessageSquareIcon className="size-3.5 shrink-0" />
                                      <span className="min-w-0 truncate text-xs">
                                        {displayName}
                                      </span>
                                    </Link>
                                  </SidebarMenuButton>
                                </SidebarMenuItem>
                              );
                            })}
                          </SidebarMenu>
                        )}
                      </div>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              );
            })}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
