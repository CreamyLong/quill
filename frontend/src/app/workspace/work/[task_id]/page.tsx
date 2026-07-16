"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import { getAPIClient } from "@/core/api/api-client";

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = typeof params.task_id === "string" ? params.task_id : "";

  useEffect(() => {
    if (!taskId || taskId === "default") return;
    let cancelled = false;
    const client = getAPIClient();
    const threadId = crypto.randomUUID();
    client.threads
      .create({
        threadId,
        metadata: { task_id: taskId },
      })
      .then(() => {
        if (!cancelled) {
          router.replace(`/workspace/work/${taskId}/${threadId}`);
        }
      })
      .catch(() => {
        // ignore
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, router]);

  return null;
}
