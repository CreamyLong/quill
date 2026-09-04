/**
 * Agent Team Manager — multi-agent coordination with task DAG.
 *
 * Manages a team of agents working together on a shared task board.
 * Supports task dependencies (DAG), mailbox communication, and
 * multiple coordination strategies.
 *
 * Source patterns:
 * - DeepSeek Harness: Agent Teams with durable roster, task DAG, mailbox
 * - CrewAI: Crews with sequential/hierarchical processes
 */

import { randomUUID } from "node:crypto";
import type {
  AgentTeamState,
  CreateTeamRequest,
  MailboxMessage,
  Teammate,
  TeamTask,
} from "./types.js";

/**
 * Manages an agent team's lifecycle and task board.
 */
export class AgentTeamManager {
  /**
   * Create a new agent team.
   */
  createTeam(request: CreateTeamRequest): AgentTeamState {
    const now = new Date().toISOString();
    const teamId = randomUUID();

    // Create teammates
    const teammates: Teammate[] = request.teammates.map((t) => ({
      id: randomUUID(),
      name: t.name,
      role: t.role,
      systemPrompt: t.systemPrompt ?? `You are ${t.name}, a ${t.role}.`,
      status: "idle",
      subagentType: t.subagentType ?? "general-purpose",
    }));

    // Create tasks
    const tasks: TeamTask[] = (request.tasks ?? []).map((t) => {
      const assignee = teammates.find((tm) => tm.name === t.assignee);
      return {
        id: randomUUID(),
        description: t.description,
        prompt: t.prompt,
        assignee: assignee?.id ?? "unassigned",
        blockedBy: t.blockedBy ?? [],
        status: t.blockedBy && t.blockedBy.length > 0 ? "blocked" : "ready",
        created_at: now,
        updated_at: now,
      };
    });

    return {
      id: teamId,
      strategy: request.strategy ?? "supervisor",
      teammates,
      tasks,
      mailbox: [],
      phase: "forming",
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Get tasks that are ready to execute (all dependencies met).
   */
  getReadyTasks(team: AgentTeamState): TeamTask[] {
    const completedTaskIds = new Set(
      team.tasks.filter((t) => t.status === "completed").map((t) => t.id),
    );

    return team.tasks.filter((t) => {
      if (t.status !== "pending" && t.status !== "blocked") return false;
      // All blocking tasks must be completed
      return t.blockedBy.every((depId) => completedTaskIds.has(depId));
    });
  }

  /**
   * Mark a task as completed and update dependent tasks.
   */
  completeTask(
    team: AgentTeamState,
    taskId: string,
    result: string,
  ): AgentTeamState {
    const now = new Date().toISOString();
    const tasks = team.tasks.map((t) => {
      if (t.id === taskId) {
        return { ...t, status: "completed" as const, result, updated_at: now };
      }
      // Check if this task was blocked by the completed task
      if (t.blockedBy.includes(taskId)) {
        const allDepsMet = t.blockedBy.every(
          (depId) => depId === taskId || team.tasks.some((tt) => tt.id === depId && tt.status === "completed"),
        );
        if (allDepsMet && t.status === "blocked") {
          return { ...t, status: "ready" as const, updated_at: now };
        }
      }
      return t;
    });

    // Check if all tasks are done
    const allDone = tasks.every((t) => t.status === "completed" || t.status === "failed");

    return {
      ...team,
      tasks,
      phase: allDone ? "synthesizing" : team.phase,
      updated_at: now,
    };
  }

  /**
   * Mark a task as failed.
   */
  failTask(team: AgentTeamState, taskId: string, error: string): AgentTeamState {
    const now = new Date().toISOString();
    const tasks = team.tasks.map((t) => {
      if (t.id === taskId) {
        return { ...t, status: "failed" as const, result: error, updated_at: now };
      }
      return t;
    });

    return { ...team, tasks, updated_at: now };
  }

  /**
   * Send a message via the mailbox.
   */
  sendMessage(
    team: AgentTeamState,
    from: string,
    to: string,
    content: string,
  ): AgentTeamState {
    const message: MailboxMessage = {
      id: randomUUID(),
      from,
      to,
      content,
      created_at: new Date().toISOString(),
      read: false,
    };
    return {
      ...team,
      mailbox: [...team.mailbox, message],
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Get unread messages for a teammate.
   */
  getUnreadMessages(team: AgentTeamState, teammateId: string): MailboxMessage[] {
    return team.mailbox.filter(
      (m) => !m.read && (m.to === teammateId || m.to === "broadcast"),
    );
  }

  /**
   * Mark messages as read.
   */
  markMessagesRead(team: AgentTeamState, messageIds: string[]): AgentTeamState {
    const idSet = new Set(messageIds);
    const mailbox = team.mailbox.map((m) =>
      idSet.has(m.id) ? { ...m, read: true } : m,
    );
    return { ...team, mailbox };
  }

  /**
   * Get the next task for a teammate.
   */
  getNextTaskForTeammate(team: AgentTeamState, teammateId: string): TeamTask | null {
    const readyTasks = this.getReadyTasks(team);
    return readyTasks.find((t) => t.assignee === teammateId) ?? null;
  }

  /**
   * Get team progress summary.
   */
  getProgress(team: AgentTeamState): {
    total: number;
    completed: number;
    failed: number;
    ready: number;
    blocked: number;
    running: number;
  } {
    const tasks = team.tasks;
    return {
      total: tasks.length,
      completed: tasks.filter((t) => t.status === "completed").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      ready: tasks.filter((t) => t.status === "ready").length,
      blocked: tasks.filter((t) => t.status === "blocked").length,
      running: tasks.filter((t) => t.status === "running").length,
    };
  }
}
