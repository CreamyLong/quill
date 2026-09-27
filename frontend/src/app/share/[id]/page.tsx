"use client";

/**
 * Share viewer — read-only rendering of a shared conversation
 * (ZCode ConversationShareService sync, self-hosted).
 *
 * Anyone with the link can view `link_viewer` / `link_editor` shares; the
 * backend sanitizes (system messages dropped, secrets redacted) and
 * integrity-hashes the projection before it is served here.
 */

import { use, useEffect, useState } from "react";

import { fetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

interface ShareRow {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

interface ShareProjection {
  schema_version: number;
  share: {
    id: string;
    title: string;
    access_mode: "private" | "link_viewer" | "link_editor";
    created_at: string;
    message_count: number;
  };
  rows: ShareRow[];
  integrity: { sha256: string };
}

export default function ShareViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [projection, setProjection] = useState<ShareProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${getBackendBaseURL()}/api/shares/${id}`);
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setError(
            response.status === 404
              ? "This share does not exist, was revoked, or is private."
              : `Failed to load share (HTTP ${response.status}).`,
          );
          return;
        }
        setProjection((await response.json()) as ShareProjection);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <main className="bg-background flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground text-sm">
          Loading shared conversation…
        </p>
      </main>
    );
  }

  if (error !== null || projection === null) {
    return (
      <main className="bg-background flex min-h-screen items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-foreground text-lg font-semibold">
            Share unavailable
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {error ?? "Unknown error."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="bg-background min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <header className="border-border mb-8 border-b pb-6">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Shared conversation
          </p>
          <h1 className="text-foreground mt-1 text-xl font-semibold">
            {projection.share.title}
          </h1>
          <p className="text-muted-foreground mt-2 text-xs">
            {projection.share.message_count} messages · shared{" "}
            {new Date(projection.share.created_at).toLocaleString()} · read-only
          </p>
        </header>
        <ol className="space-y-4">
          {projection.rows.map((row, index) => (
            <li
              className={
                row.role === "user"
                  ? "bg-muted flex justify-end"
                  : "bg-popover text-popover-foreground flex justify-start"
              }
              key={index}
            >
              <div
                className={
                  row.role === "user"
                    ? "text-primary-foreground bg-primary max-w-[85%] rounded-2xl rounded-br-sm px-4 py-3 text-sm whitespace-pre-wrap"
                    : "border-border max-w-[85%] rounded-2xl rounded-bl-sm border px-4 py-3 text-sm whitespace-pre-wrap"
                }
              >
                {row.content}
              </div>
            </li>
          ))}
        </ol>
        <footer className="text-muted-foreground border-border mt-10 border-t pt-4 text-center text-xs">
          Shared via Quill · integrity sha256{" "}
          {projection.integrity.sha256.slice(0, 16)}…
        </footer>
      </div>
    </main>
  );
}
