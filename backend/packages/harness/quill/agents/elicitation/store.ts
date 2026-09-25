/**
 * ElicitationStore — tracks pending and resolved elicitation sessions.
 *
 * Maintains the lifecycle of elicitation interactions:
 * - pending: questions asked, awaiting user answers
 * - resolved: user answered, context enriched
 * - dismissed: user chose to proceed without answering
 */

import type { ElicitationQuestion } from "./engine.js";

export type ElicitationStatus = "pending" | "resolved" | "dismissed" | "expired";

export interface ElicitationSession {
  /** Unique session ID (derived from thread + message). */
  id: string;
  /** The thread this elicitation belongs to. */
  threadId: string;
  /** Original user message that triggered elicitation. */
  originalMessage: string;
  /** Questions presented to the user. */
  questions: ElicitationQuestion[];
  /** User answers (questionId → answer). */
  answers: Record<string, string | string[]>;
  /** Current status. */
  status: ElicitationStatus;
  /** When the elicitation was created. */
  createdAt: string;
  /** When the elicitation was resolved/dismissed. */
  resolvedAt?: string;
  /** Enriched message after applying answers. */
  enrichedMessage?: string;
}

const Elicitation_SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class ElicitationStore {
  private sessions = new Map<string, ElicitationSession>();

  /** Create a new elicitation session. */
  create(threadId: string, originalMessage: string, questions: ElicitationQuestion[]): ElicitationSession {
    const id = `${threadId}:${Date.now()}`;
    const session: ElicitationSession = {
      id,
      threadId,
      originalMessage,
      questions,
      answers: {},
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(id, session);
    this.evictExpired();
    return session;
  }

  /** Get a session by ID. */
  get(id: string): ElicitationSession | undefined {
    const session = this.sessions.get(id);
    if (session && this.isExpired(session)) {
      session.status = "expired";
    }
    return session;
  }

  /** Get the latest pending session for a thread. */
  getPending(threadId: string): ElicitationSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.threadId === threadId && session.status === "pending" && !this.isExpired(session)) {
        return session;
      }
    }
    return undefined;
  }

  /** Record user answers and produce an enriched message. */
  resolve(id: string, answers: Record<string, string | string[]>): ElicitationSession | undefined {
    const session = this.sessions.get(id);
    if (!session || session.status !== "pending") return undefined;

    session.answers = answers;
    session.status = "resolved";
    session.resolvedAt = new Date().toISOString();
    session.enrichedMessage = this.enrich(session);
    return session;
  }

  /** Dismiss an elicitation session (user chose to skip). */
  dismiss(id: string): ElicitationSession | undefined {
    const session = this.sessions.get(id);
    if (!session || session.status !== "pending") return undefined;

    session.status = "dismissed";
    session.resolvedAt = new Date().toISOString();
    session.enrichedMessage = session.originalMessage;
    return session;
  }

  /** Remove a session entirely. */
  delete(id: string): void {
    this.sessions.delete(id);
  }

  /** List all sessions for a thread. */
  listForThread(threadId: string): ElicitationSession[] {
    const results: ElicitationSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.threadId === threadId) {
        results.push(session);
      }
    }
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private isExpired(session: ElicitationSession): boolean {
    const created = new Date(session.createdAt).getTime();
    return Date.now() - created > Elicitation_SESSION_TTL_MS;
  }

  private enrich(session: ElicitationSession): string {
    const parts: string[] = [session.originalMessage];
    for (const [qId, answer] of Object.entries(session.answers)) {
      const question = session.questions.find((q) => q.id === qId);
      if (!question) continue;
      const display = Array.isArray(answer) ? answer.join(", ") : answer;
      parts.push(`\n[Clarification: ${question.question}\nAnswer: ${display}]`);
    }
    return parts.join("\n");
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      const created = new Date(session.createdAt).getTime();
      if (now - created > Elicitation_SESSION_TTL_MS * 2) {
        this.sessions.delete(id);
      }
    }
  }
}
