/**
 * Helpers for attaching persisted channel connection ownership to inbound messages.
 */

export interface InboundMessage {
  userId: string;
  connectionId?: string | null;
  ownerUserId?: string | null;
  workspaceId?: string | null;
  [key: string]: unknown;
}

export interface ConnectionRecord {
  id: string;
  ownerUserId: string;
  workspaceId?: string | null;
}

export interface ConnectionRepository {
  findConnectionByExternalIdentity(params: {
    provider: string;
    externalAccountId: string;
    workspaceId: string | null;
  }): Promise<ConnectionRecord | null>;
}

/**
 * Attach connection metadata to an inbound message when a persisted binding exists.
 */
export async function attachConnectionIdentity(
  inbound: InboundMessage,
  options: {
    repo: ConnectionRepository | null;
    provider: string;
    workspaceId: string | null;
    fallbackWithoutWorkspace?: boolean;
  }
): Promise<InboundMessage> {
  const { repo, provider, workspaceId, fallbackWithoutWorkspace = false } = options;
  if (repo === null) {
    return inbound;
  }

  const workspaceCandidates: Array<string | null> = [];
  if (workspaceId) {
    workspaceCandidates.push(workspaceId);
  }
  if (fallbackWithoutWorkspace) {
    workspaceCandidates.push(null);
  }
  if (workspaceCandidates.length === 0) {
    return inbound;
  }

  for (const candidate of workspaceCandidates) {
    const connection = await repo.findConnectionByExternalIdentity({
      provider,
      externalAccountId: inbound.userId,
      workspaceId: candidate,
    });
    if (connection === null) {
      continue;
    }

    inbound.connectionId = connection.id;
    inbound.ownerUserId = connection.ownerUserId;
    inbound.workspaceId = connection.workspaceId ?? null;
    return inbound;
  }

  return inbound;
}
