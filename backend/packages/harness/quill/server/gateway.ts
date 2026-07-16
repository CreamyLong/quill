/**
 * LangGraph-SDK-compatible HTTP gateway for the TypeScript Quill runtime.
 *
 * This server replaces the Python API gateway for local development. It speaks
 * the subset of the LangGraph Platform HTTP protocol that the Quill frontend
 * (`@langchain/langgraph-sdk` `useStream`) actually exercises, plus the custom
 * REST routes the frontend calls via plain `fetch`.
 *
 * The heavy lifting (graph, agents, middlewares, config) lives in the compiled
 * TS runtime; this module is the HTTP surface. Runtime wiring (model + graph)
 * is injected by the launcher so this module stays free of provider details.
 *
 * Scope:
 *   - Threads CRUD + search + state + history (in-memory cache, optional
 *     durable ThreadPersistence store).
 *   - Streaming runs over SSE (metadata / messages / values events).
 *   - Run message history, feedback (create/list/stats/delete), regenerate
 *     (checkpoint reset), uploads (+ limits) + artifact serving.
 *   - Memory, Skills and Agents management routes backed by optional injected
 *     stores (SQLite in the launcher; empty/default responses when absent).
 *   - Follow-up suggestions, and minimal stubs for models, mcp and channels so
 *     the frontend renders and chats.
 *
 * Persistence, auth and the memory/skills/agents stores are injected by the
 * launcher (see backend/scripts/*_store.mjs); this module stays free of
 * provider details. Not implemented: run cancellation is best-effort only.
 */

import http from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";

import Busboy from "busboy";

import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";

import {
  setCurrentUser,
  resetCurrentUser,
} from "../runtime/user_context.js";
import {
  ensureUploadsDir,
  normalizeFilename,
  claimUniqueFilename,
  listFilesInDir,
  enrichFileListing,
  deleteFileSafe,
  uploadVirtualPath,
  uploadArtifactUrl,
  VIRTUAL_PATH_PREFIX,
  type UploadFileEntry,
} from "../uploads/manager.js";
import { getAppConfig } from "../config/app_config.js";
import { getPaths } from "../config/paths.js";
import { ExtensionsConfig } from "../config/extensions_config.js";

import {
  RunEventStore,
  type RunEventRecord,
} from "../runtime/events/store/base.js";
import { MemoryRunEventStore } from "../runtime/events/store/memory.js";
import { cancelChildren } from "../subagents/runtime/children.js";

/** Minimal shape of the compiled LangGraph graph this server drives. */
export interface RunnableGraph {
  stream(
    input: unknown,
    options?: Record<string, unknown>,
  ): Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>;
  getState(
    config: Record<string, unknown>,
  ): Promise<{ values?: Record<string, unknown> } | undefined>;
}

/** Model entry exposed to the frontend `/api/models` route. */
export interface GatewayModel {
  id: string;
  name: string;
  model: string;
  display_name: string;
  description?: string | null;
  supports_thinking?: boolean;
  supports_reasoning_effort?: boolean;
}

export interface AuthResult {
  user?: unknown;
  token?: string;
  error?: string;
}
export interface AuthProvider {
  setupStatus(): { needs_setup: boolean };
  initialize(email: string, password: string, name?: string): AuthResult;
  register(email: string, password: string, name?: string): AuthResult;
  login(email: string, password: string): AuthResult;
  me(token: string | undefined): unknown | null;
  changePassword(
    token: string | undefined,
    oldPassword: string,
    newPassword: string,
  ): { success?: boolean; error?: string };
  logout(token: string | undefined): { success: boolean };
}

export interface ThreadPersistence {
  loadAll(): Record<string, unknown>[];
  saveThread(threadId: string, data: Record<string, unknown>): void;
  deleteThread(threadId: string): void;
}

/**
 * Global memory store (Memory panel). Methods return the full memory document
 * and throw an `Error` with a `code` of `"content" | "confidence" | "not_found"`
 * on validation/lookup failures, which the router maps to 400/404.
 */
export interface MemoryStore {
  get(): Record<string, unknown>;
  clear(): Record<string, unknown>;
  import(data: Record<string, unknown>): Record<string, unknown>;
  createFact(input: { content: string; category?: string; confidence?: number }): Record<string, unknown>;
  updateFact(
    factId: string,
    patch: { content?: string; category?: string; confidence?: number },
  ): Record<string, unknown>;
  deleteFact(factId: string): Record<string, unknown>;
}

/** A skill as exposed by the Skills panel (`SkillResponse` in the Python API). */
export interface SkillRecord {
  name: string;
  description: string;
  license: string | null;
  category: "public" | "custom";
  enabled: boolean;
}
/** A custom skill plus its raw `SKILL.md` content. */
export interface CustomSkillContent extends SkillRecord {
  content: string;
}
/**
 * Skills store (Skills panel). Custom-skill mutators throw an `Error` with a
 * `code` of `"no_history" | "out_of_range" | "no_prev"` for rollback failures.
 */
export interface SkillsStore {
  list(): SkillRecord[];
  get(name: string): SkillRecord | null;
  listCustom(): SkillRecord[];
  getCustom(name: string): CustomSkillContent | null;
  setEnabled(name: string, enabled: boolean): SkillRecord | null;
  saveCustom(name: string, content: string): CustomSkillContent;
  deleteCustom(name: string): boolean;
  history(name: string): Record<string, unknown>[];
  hasHistory(name: string): boolean;
  rollback(name: string, historyIndex: number): CustomSkillContent;
}

/** A custom agent as exposed by the Agents panel (`AgentResponse`). */
export interface AgentRecord {
  name: string;
  description: string;
  model: string | null;
  tool_groups: string[] | null;
  skills: string[] | null;
  soul: string | null;
}
/** Custom-agents store (Agents panel). */
export interface AgentsStore {
  list(): AgentRecord[];
  get(name: string): AgentRecord | null;
  exists(name: string): boolean;
  save(agent: AgentRecord): AgentRecord;
  delete(name: string): boolean;
}

export interface GatewayDeps {
  /** Agent graph for this gateway. Can be a single graph or a factory that
   * receives the run context and returns a graph (used for mode-dependent
   * graphs such as pro/ultra plan mode + subagents). */
  graph: RunnableGraph | ((context: Record<string, unknown>) => RunnableGraph);
  models: GatewayModel[];
  /** Default system prompt label, used only for logging. */
  modelLabel?: string;
  /** MCP config served at GET /api/mcp/config (frontend MCP settings UI). */
  mcpConfig?: { mcp_servers?: Record<string, unknown>; mcpServers?: Record<string, unknown> } | null;
  /** Callback to reload MCP tools after a config change (PUT /api/mcp/config). */
  reloadMcp?: () => Promise<void>;
  /** Wipe a thread's checkpointer state (used by regenerate). */
  deleteThreadCheckpoint?: (threadId: string) => void | Promise<void>;
  /** Root dir for uploaded files (default: <cwd>/.scitops/uploads). */
  uploadsRoot?: string;
  /** Durable thread store; when set, threads survive a restart. */
  store?: ThreadPersistence;
  /** Durable task repository for the work workspace. */
  taskRepository?: {
    create: (id: string, opts: { name: string; folder_path: string; user_id?: string | null }) => Promise<Record<string, unknown>>;
    get: (id: string, opts?: { user_id?: string | null }) => Promise<Record<string, unknown> | null>;
    search: (opts?: { folder_path?: string; limit?: number; offset?: number; user_id?: string | null }) => Promise<Array<Record<string, unknown>>>;
    findByFolderPath: (path: string, opts?: { user_id?: string | null }) => Promise<Record<string, unknown> | null>;
    rename: (id: string, name: string, opts?: { user_id?: string | null }) => Promise<boolean>;
    delete: (id: string, opts?: { user_id?: string | null }) => Promise<void>;
  } | null;
  /** When set, real auth is enforced on /v1/auth/*; otherwise no-auth mode. */
  auth?: AuthProvider;
  /** Durable global-memory store backing the Memory panel routes. */
  memory?: MemoryStore;
  /** Durable skills store backing the Skills panel routes. */
  skills?: SkillsStore;
  /** Local skill storage for archive upload/install (POST /api/skills/install). */
  skillUploadStorage?: {
    installFromArchive: (filePath: string) => Promise<{ skillName: string }>;
  };
  /** Durable custom-agents store backing the Agents panel routes. */
  agents?: AgentsStore;
  /** Callbacks (e.g. tracing) attached to every run's graph.stream config. */
  runCallbacks?: unknown[];
  /**
   * Aggregate token usage for a thread from the run store. When set, the
   * `GET /threads/{threadId}/token-usage` route returns real per-thread totals
   * (by model, by caller); otherwise it falls back to a zero-valued shape.
   */
  aggregateTokenUsage?: (
    threadId: string,
    opts?: { include_active?: boolean },
  ) => Promise<Record<string, unknown>>;
  /**
   * Durable run-event store backing `subagent.{start,step,end}` timeline events
   * and the `GET /threads/{threadId}/runs/{runId}/events` endpoint. When unset
   * the gateway falls back to an in-memory store so the endpoint still works in
   * dev (events are lost on restart); the provisioner/launcher injects a
   * `JsonlRunEventStore` (or `DbRunEventStore`) for durability.
   */
  eventStore?: RunEventStore | null;
  logger?: (message: string) => void;
}

type MessageLike = Record<string, unknown>;

interface ThreadRecord {
  thread_id: string;
  created_at: string;
  updated_at: string;
  state_updated_at: string;
  status: "idle" | "busy" | "error" | "interrupted";
  metadata: Record<string, unknown>;
  values: Record<string, unknown>;
  context?: Record<string, unknown>;
  runs: Map<string, RunRecord>;
  feedback: Map<string, FeedbackRecord>;
  uploads: Record<string, unknown>[];
}

interface FeedbackRecord {
  feedback_id: string;
  rating: number;
  comment: string | null;
  message_id?: string | null;
  user_id?: string | null;
  created_at?: string;
}

interface RunRecord {
  run_id: string;
  thread_id: string;
  status: "pending" | "running" | "success" | "error" | "cancelled";
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  /** Messages produced during this run, for GET /runs/{id}/messages. */
  messages: RunMessageRecord[];
}

interface RunMessageRecord {
  run_id: string;
  seq: number;
  content: MessageLike;
  metadata: { caller: string; [key: string]: unknown };
  created_at: string;
}

const KNOWN_STREAM_MODES = new Set([
  "values",
  "updates",
  "messages",
  "messages-tuple",
  "custom",
  "debug",
  "tasks",
  "checkpoints",
  "events",
]);

const DEFAULT_USER = {
  id: "default",
  email: "default@test.local",
  system_role: "admin",
  needs_setup: false,
  oauth_provider: null,
};

/** Coerce a plain message dict (from the SDK run input) into a BaseMessage instance. */
function toMessageInstance(m: MessageLike): BaseMessage {
  const type = (m.type ?? (m as { role?: unknown }).role) as string | undefined;
  const fields = {
    content: (m.content ?? "") as never,
    additional_kwargs: (m.additional_kwargs as Record<string, unknown>) ?? {},
    ...(typeof m.id === "string" ? { id: m.id } : {}),
    ...(typeof m.name === "string" ? { name: m.name } : {}),
  };
  if (type === "human" || type === "user") return new HumanMessage(fields);
  if (type === "system") return new SystemMessage(fields);
  if (type === "tool") {
    return new ToolMessage({ ...fields, tool_call_id: String(m.tool_call_id ?? "") });
  }
  return new AIMessage({
    ...fields,
    ...(Array.isArray(m.tool_calls) ? { tool_calls: m.tool_calls as never } : {}),
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function log(deps: GatewayDeps, message: string): void {
  (deps.logger ?? console.log)(message);
}

/** Read a request body and parse it as JSON (empty body → {}). */
function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf-8");
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/** Serialize a (possibly class-instance) message into the flat dict the SDK expects. */
function serializeMessage(msg: unknown): MessageLike {
  if (!msg || typeof msg !== "object") {
    return { type: "ai", content: String(msg ?? "") };
  }
  const m = msg as Record<string, unknown>;

  // Handle LangChain serialized message format: { lc: 1, type: "constructor", id: [...], kwargs: {...} }
  const lcVersion = m.lc as number | undefined;
  const rawId = m.id as unknown[] | string | undefined;
  if (lcVersion === 1 && m.type === "constructor" && Array.isArray(rawId) && m.kwargs && typeof m.kwargs === "object") {
    const kwargs = m.kwargs as Record<string, unknown>;
    const className = rawId[rawId.length - 1] as string;
    const typeMap: Record<string, string> = {
      HumanMessage: "human",
      AIMessage: "ai",
      SystemMessage: "system",
      ToolMessage: "tool",
      AIMessageChunk: "ai",
      HumanMessageChunk: "human",
      SystemMessageChunk: "system",
      ToolMessageChunk: "tool",
    };
    const type = typeMap[className] ?? "ai";
    const out: MessageLike = {
      type,
      content: kwargs.content ?? "",
    };
    if (kwargs.id != null && typeof kwargs.id === "string") out.id = kwargs.id;
    if (kwargs.name != null) out.name = kwargs.name;
    if (kwargs.tool_calls != null) out.tool_calls = kwargs.tool_calls;
    if (kwargs.tool_call_id != null) out.tool_call_id = kwargs.tool_call_id;
    if (kwargs.additional_kwargs != null) out.additional_kwargs = kwargs.additional_kwargs;
    if (kwargs.response_metadata != null) out.response_metadata = kwargs.response_metadata;
    if (kwargs.usage_metadata != null) out.usage_metadata = kwargs.usage_metadata;
    return out;
  }

  // Handle live LangChain message instances (with getters)
  const getType = m.getType as undefined | (() => string);
  let type = typeof getType === "function" ? getType.call(m) : (m.type as string | undefined);
  if (typeof type === "string" && type.endsWith("MessageChunk")) {
    type = type.slice(0, -"MessageChunk".length).toLowerCase();
  }
  if (type === "human" || type === "user") type = "human";
  if (type === "assistant") type = "ai";
  const out: MessageLike = {
    type: type ?? "ai",
    content: m.content ?? "",
  };
  if (m.id != null && typeof m.id === "string") out.id = m.id;
  if (m.name != null) out.name = m.name;
  if (m.tool_calls != null) out.tool_calls = m.tool_calls;
  if ((m as { toolCalls?: unknown }).toolCalls != null && out.tool_calls == null) {
    out.tool_calls = (m as { toolCalls?: unknown }).toolCalls;
  }
  if (m.tool_call_id != null) out.tool_call_id = m.tool_call_id;
  if ((m as { tool_call_chunks?: unknown }).tool_call_chunks != null) {
    out.tool_call_chunks = (m as { tool_call_chunks?: unknown }).tool_call_chunks;
  }
  if (m.additional_kwargs != null) out.additional_kwargs = m.additional_kwargs;
  if (m.response_metadata != null) out.response_metadata = m.response_metadata;
  if (m.usage_metadata != null) out.usage_metadata = m.usage_metadata;
  if (m.status != null) out.status = m.status;
  return out;
}

function serializeValues(values: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!values) return {};
  const out: Record<string, unknown> = { ...values };
  if (Array.isArray(values.messages)) {
    out.messages = values.messages.map(serializeMessage);
  }
  return out;
}

/** Extract plain text from message content (string or content blocks). */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block) {
          return String((block as { text: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

export interface GatewayServerHandle {
  server: http.Server;
  getThreadMetadata: (threadId: string) => Record<string, unknown> | undefined;
}

export function createGatewayServer(deps: GatewayDeps): GatewayServerHandle {
  const threads = new Map<string, ThreadRecord>();
  /** Active runs → their AbortController, for cancellation. */
  const activeRuns = new Map<string, AbortController>();
  /**
   * Effective run-event store. The launcher injects a durable
   * `JsonlRunEventStore`/`DbRunEventStore` via `deps.eventStore`; when absent we
   * fall back to an in-memory store so the `/events` route works in dev (events
   * are lost on a restart — acceptable for local development only).
   */
  const eventStore: RunEventStore = deps.eventStore ?? new MemoryRunEventStore();

  // --- Durable persistence (write-through cache) ---
  function serializeThreadRecord(t: ThreadRecord): Record<string, unknown> {
    return {
      thread_id: t.thread_id,
      created_at: t.created_at,
      updated_at: t.updated_at,
      state_updated_at: t.state_updated_at,
      status: t.status === "busy" ? "idle" : t.status,
      metadata: t.metadata,
      values: serializeValues(t.values),
      context: t.context,
      runs: Array.from(t.runs.values()),
      feedback: Array.from(t.feedback.entries()),
      uploads: t.uploads,
    };
  }
  function hydrateThreadRecord(d: Record<string, any>): ThreadRecord {
    return {
      thread_id: d.thread_id,
      created_at: d.created_at,
      updated_at: d.updated_at,
      state_updated_at: d.state_updated_at ?? d.updated_at,
      status: "idle", // any in-flight status from before the restart is stale
      metadata: d.metadata ?? {},
      values: d.values ?? { messages: [] },
      context: d.context,
      runs: new Map((d.runs ?? []).map((r: RunRecord) => [r.run_id, r])),
      feedback: new Map(d.feedback ?? []),
      uploads: d.uploads ?? [],
    };
  }
  function persistThread(t: ThreadRecord): void {
    try {
      deps.store?.saveThread(t.thread_id, serializeThreadRecord(t));
    } catch (err) {
      log(deps, `[gateway] persist failed for ${t.thread_id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (deps.store) {
    try {
      for (const data of deps.store.loadAll()) {
        const t = hydrateThreadRecord(data as Record<string, unknown>);
        threads.set(t.thread_id, t);
      }
      log(deps, `[gateway] restored ${threads.size} thread(s) from store`);
    } catch (err) {
      log(deps, `[gateway] store load failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** MCP servers as the frontend expects them — env/header secrets redacted. */
  function mcpServersView(): Record<string, unknown> {
    const raw = deps.mcpConfig?.mcp_servers ?? deps.mcpConfig?.mcpServers ?? {};
    const out: Record<string, unknown> = {};
    for (const [name, cfg] of Object.entries(raw)) {
      const c = (cfg ?? {}) as Record<string, unknown>;
      out[name] = {
        enabled: c.enabled !== false,
        description: (c.description as string) ?? "",
        type: c.type ?? c.transport ?? (c.url ? "http" : "stdio"),
        ...(c.command ? { command: c.command } : {}),
        ...(c.url ? { url: c.url } : {}),
        // env/headers intentionally omitted (may contain secrets)
      };
    }
    return out;
  }

  /**
   * Read MCP servers directly from extensions_config.json (the canonical
   * on-disk source). Used by the GET /api/mcp/config route so the frontend
   * sees what is actually persisted.
   */
  function loadExtensionsConfigView(): Record<string, unknown> {
    try {
      const cfg = ExtensionsConfig.fromFile();
      return cfg.toJSON().mcpServers as Record<string, unknown>;
    } catch {
      return mcpServersView();
    }
  }

  function getOrCreateThread(threadId: string, metadata?: Record<string, unknown>): ThreadRecord {
    let t = threads.get(threadId);
    if (!t) {
      const ts = nowIso();
      t = {
        thread_id: threadId,
        created_at: ts,
        updated_at: ts,
        state_updated_at: ts,
        status: "idle",
        metadata: metadata ?? {},
        values: { messages: [] },
        runs: new Map(),
        feedback: new Map(),
        uploads: [],
      };
      threads.set(threadId, t);
    }
    return t;
  }

  function threadUploadDir(threadId: string): string {
    const override = threads.get(threadId)?.metadata?.workspace_directory;
    if (typeof override === "string" && override.trim()) {
      const dir = path.join(path.resolve(override.trim()), "uploads");
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    return ensureUploadsDir(threadId, null);
  }
  function safeName(name: string): string {
    return path.basename(name).replace(/[^A-Za-z0-9._ -]/g, "_") || "file";
  }
  function uploadedFileInfo(threadId: string, filename: string, size: number): Record<string, unknown> {
    return {
      filename,
      size,
      path: path.join(threadUploadDir(threadId), filename),
      virtual_path: uploadVirtualPath(filename),
      artifact_url: uploadArtifactUrl(threadId, filename),
      extension: path.extname(filename).replace(/^\./, "") || undefined,
      modified: Date.now(),
    };
  }

  function threadView(t: ThreadRecord): Record<string, unknown> {
    return {
      thread_id: t.thread_id,
      created_at: t.created_at,
      updated_at: t.updated_at,
      state_updated_at: t.state_updated_at,
      status: t.status,
      metadata: t.metadata,
      values: serializeValues(t.values),
      context: t.context,
      interrupts: {},
    };
  }

  function stateView(t: ThreadRecord): Record<string, unknown> {
    return {
      values: serializeValues(t.values),
      next: [],
      tasks: [],
      metadata: t.metadata,
      created_at: t.state_updated_at,
      checkpoint: {
        thread_id: t.thread_id,
        checkpoint_ns: "",
        checkpoint_id: t.state_updated_at,
      },
      parent_checkpoint: null,
    };
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      try {
        sendJson(req, res, 500, { detail: err instanceof Error ? err.message : String(err) });
      } catch {
        /* response already sent */
      }
    });
  });

  function corsHeaders(req: http.IncomingMessage): Record<string, string> {
    const origin = req.headers.origin;
    return {
      "Access-Control-Allow-Origin": origin ?? "*",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers":
        req.headers["access-control-request-headers"] ??
        "Content-Type,Authorization,X-CSRF-Token,Last-Event-ID",
      "Access-Control-Expose-Headers": "Content-Location",
      Vary: "Origin",
    };
  }

  function sendJson(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    status: number,
    body: unknown,
    extraHeaders?: Record<string, string>,
  ): void {
    res.writeHead(status, {
      "Content-Type": "application/json",
      ...corsHeaders(req),
      ...(extraHeaders ?? {}),
    });
    res.end(JSON.stringify(body));
  }

  const SESSION_COOKIE = "quill_session";
  function getSessionToken(req: http.IncomingMessage): string | undefined {
    const cookie = req.headers.cookie;
    if (cookie) {
      for (const part of cookie.split(";")) {
        const [k, ...v] = part.trim().split("=");
        if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="));
      }
    }
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) return auth.slice(7);
    return undefined;
  }
  function setSessionCookie(token: string): Record<string, string> {
    return {
      "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`,
    };
  }
  function clearSessionCookie(): Record<string, string> {
    return { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` };
  }

  /** Resolve the current user id from session/auth, or DEFAULT_USER in no-auth mode. */
  function resolveUserId(req: http.IncomingMessage): string {
    const sessionToken = getSessionToken(req);
    if (deps.auth) {
      const u = deps.auth.me(sessionToken);
      if (u) return (u as { id: string }).id;
    }
    return DEFAULT_USER.id;
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "GET";
    // Normalize: tolerate both `/api/...` and bare `/...` (LangGraph base URL ends in /api).
    const pathname = url.pathname;
    const p = pathname.startsWith("/api/") ? pathname.slice(4) : pathname; // strip leading /api

    if (method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }

    // --- Health ---
    if (method === "GET" && (pathname === "/health" || p === "/health")) {
      sendJson(req, res, 200, { status: "ok" });
      return;
    }

    // --- Auth ---
    if (p.startsWith("/v1/auth/")) {
      if (await handleAuth(req, res, p, method)) return;
    }

    // --- Models ---
    if (p === "/models" && method === "GET") {
      sendJson(req, res, 200, { models: deps.models, token_usage: { enabled: false } });
      return;
    }

    // --- Assistants (LangGraph SDK compatibility) ---
    // The @langchain/langgraph-sdk queries `/assistants/search` (by name) or
    // `/assistants/{id}` during initialization. Our TS runtime pins a single
    // lead agent, so every lookup resolves to that same assistant object.
    if ((p === "/assistants/search" || p.match(/^\/assistants\/[^/]+$/)) && method === "GET") {
      const assistant = {
        assistant_id: "lead_agent",
        name: "lead_agent",
        graph_id: "lead_agent",
        config: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {},
      };
      if (p === "/assistants/search") {
        sendJson(req, res, 200, [assistant]);
      } else {
        sendJson(req, res, 200, assistant);
      }
      return;
    }

    // --- Skills / Agents / Memory (Settings panels) ---
    if (p === "/skills/install" && method === "POST") {
      await handleSkillsInstall(req, res);
      return;
    }
    if (p === "/skills" || p.startsWith("/skills/")) {
      if (await handleSkills(req, res, p, method)) return;
    }
    if (p === "/agents" || p.startsWith("/agents/")) {
      if (await handleAgents(req, res, url, p, method)) return;
    }
    if (p === "/memory" || p.startsWith("/memory/")) {
      if (await handleMemory(req, res, p, method)) return;
    }

    // --- MCP / Channels / Suggestions ---
    if (p === "/mcp/config" && method === "GET") {
      const cfg = loadExtensionsConfigView();
      sendJson(req, res, 200, { mcpServers: cfg });
      return;
    }
    if (p === "/mcp/config" && method === "PUT") {
      const body = (await readJson(req)) as Record<string, unknown>;
      const servers = (body.mcpServers ?? body.mcp_servers ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      try {
        const current = ExtensionsConfig.fromFile();
        for (const [name, cfg] of Object.entries(servers)) {
          const existing = current.mcpServers[name] ?? {};
          current.mcpServers[name] = {
            ...existing,
            ...cfg,
            enabled: cfg.enabled !== false,
          };
        }
        current.save();
        // Reload MCP tools so enable/disable takes effect immediately.
        await deps.reloadMcp?.();
        const updated = loadExtensionsConfigView();
        sendJson(req, res, 200, { mcpServers: updated });
      } catch (err) {
        sendJson(req, res, 500, {
          detail: err instanceof Error ? err.message : "Failed to save MCP config",
        });
      }
      return;
    }
    if (p === "/mcp/config/test" && method === "POST") {
      const body = (await readJson(req)) as Record<string, unknown>;
      const serverCfg = (body.config ?? body) as Record<string, unknown>;
      let transport =
        (serverCfg.transport as string) ??
        (serverCfg.type as string) ??
        (serverCfg.url ? "http" : "stdio");
      // If stdio is indicated but there is no command and a URL is present,
      // fall back to http so the connection test matches loadMcpTools behavior.
      if (transport === "stdio" && !serverCfg.command && serverCfg.url) {
        transport = "http";
      }
      try {
        // Build a temporary client config and attempt to list tools.
        // The SDK's MultiServerMCPClient schema accepts stdio/sse/http — map
        // streamable_http to http so the transport literal validates.
        const sdkTransport =
          transport === "streamable_http" ? "http" : transport;
        const serverName = "__test__";
        const testConfig: Record<string, unknown> = { transport: sdkTransport };
        if (transport === "stdio") {
          testConfig.command = serverCfg.command ?? "";
          testConfig.args = serverCfg.args ?? [];
          testConfig.env = { ...process.env, ...(serverCfg.env as Record<string, string> ?? {}) };
        } else {
          testConfig.url = serverCfg.url ?? "";
          testConfig.headers = serverCfg.headers ?? {};
        }
        const { MultiServerMCPClient } = await import("@langchain/mcp-adapters");
        const client = new MultiServerMCPClient({ [serverName]: testConfig } as never);
        const tools = await client.getTools();
        sendJson(req, res, 200, {
          connected: true,
          tools: tools.map((t) => t.name),
          toolCount: tools.length,
        });
      } catch (err) {
        sendJson(req, res, 200, {
          connected: false,
          tools: [],
          toolCount: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }
    if (p === "/channels/providers" && method === "GET") {
      sendJson(req, res, 200, { enabled: false, providers: [] });
      return;
    }
    if (p === "/channels/connections" && method === "GET") {
      sendJson(req, res, 200, { connections: [] });
      return;
    }
    if (p === "/suggestions/config" && method === "GET") {
      // Reflect the config-driven enabled flag (mirrors Python suggestions_config endpoint).
      sendJson(req, res, 200, { enabled: getAppConfig().suggestions?.enabled ?? true });
      return;
    }

    // --- Threads collection ---
    if (p === "/threads" && method === "POST") {
      const body = await readJson(req);
      const threadId = (body.thread_id as string) || randomUUID();
      const metadata = (body.metadata as Record<string, unknown>) ?? {};
      // Tag the thread with task_id if provided (work workspace)
      if (typeof body.task_id === "string") {
        metadata.task_id = body.task_id;
      }
      const t = getOrCreateThread(threadId, metadata);
      persistThread(t);
      sendJson(req, res, 200, threadView(t));
      return;
    }
    if (p === "/threads/search" && method === "POST") {
      const body = await readJson(req);
      const limit = typeof body.limit === "number" ? body.limit : 50;
      const offset = typeof body.offset === "number" ? body.offset : 0;
      const all = Array.from(threads.values()).sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at),
      );
      sendJson(req, res, 200, all.slice(offset, offset + limit).map(threadView));
      return;
    }
    if (p === "/threads/count" && method === "POST") {
      sendJson(req, res, 200, { count: threads.size });
      return;
    }

    // --- Tasks (work workspace) ---
    // GET /tasks — list tasks (optionally filtered by folder_path)
    if (p === "/tasks" && method === "GET") {
      if (!deps.taskRepository) {
        sendJson(req, res, 503, { detail: "Task repository not available" });
        return;
      }
      const userId = resolveUserId(req);
      const url = new URL(req.url ?? "/", "http://localhost");
      const folderPath = url.searchParams.get("folder_path") ?? undefined;
      const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
      const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
      const tasks = await deps.taskRepository.search({ folder_path: folderPath, limit, offset, user_id: userId });
      sendJson(req, res, 200, tasks);
      return;
    }
    // POST /tasks — create a task (or return existing one for the folder)
    if (p === "/tasks" && method === "POST") {
      if (!deps.taskRepository) {
        sendJson(req, res, 503, { detail: "Task repository not available" });
        return;
      }
      const userId = resolveUserId(req);
      const body = await readJson(req);
      const folderPath = body.folder_path as string;
      const name = (body.name as string) || path.basename(folderPath);
      if (!folderPath) {
        sendJson(req, res, 400, { detail: "folder_path is required" });
        return;
      }
      // Dedup: reuse existing task for the same folder
      const existing = await deps.taskRepository.findByFolderPath(folderPath, { user_id: userId });
      if (existing) {
        sendJson(req, res, 200, existing);
        return;
      }
      const taskId = randomUUID();
      const task = await deps.taskRepository.create(taskId, { name, folder_path: folderPath, user_id: userId });
      sendJson(req, res, 201, task);
      return;
    }
    // GET /tasks/:taskId — get a single task
    const taskPatch = p.match(/^\/tasks\/([^/]+)$/);
    if (taskPatch && method === "GET") {
      if (!deps.taskRepository) {
        sendJson(req, res, 503, { detail: "Task repository not available" });
        return;
      }
      const userId = resolveUserId(req);
      const taskId = decodeURIComponent(taskPatch[1]);
      const task = await deps.taskRepository.get(taskId, { user_id: userId });
      if (!task) {
        sendJson(req, res, 404, { detail: "Task not found" });
        return;
      }
      sendJson(req, res, 200, task);
      return;
    }
    // PATCH /tasks/:taskId — rename
    if (taskPatch && method === "PATCH") {
      if (!deps.taskRepository) {
        sendJson(req, res, 503, { detail: "Task repository not available" });
        return;
      }
      const userId = resolveUserId(req);
      const body = await readJson(req);
      const taskId = decodeURIComponent(taskPatch[1]);
      if (typeof body.name === "string" && body.name.trim()) {
        await deps.taskRepository.rename(taskId, body.name.trim(), { user_id: userId });
      }
      const task = await deps.taskRepository.get(taskId, { user_id: userId });
      sendJson(req, res, 200, task);
      return;
    }
    // DELETE /tasks/:taskId
    if (taskPatch && method === "DELETE") {
      if (!deps.taskRepository) {
        sendJson(req, res, 503, { detail: "Task repository not available" });
        return;
      }
      const taskId = decodeURIComponent(taskPatch[1]);
      await deps.taskRepository.delete(taskId);
      sendJson(req, res, 200, { success: true });
      return;
    }
    // GET /tasks/:taskId/threads — list threads belonging to a task
    const taskThreads = p.match(/^\/tasks\/([^/]+)\/threads$/);
    if (taskThreads && method === "GET") {
      const taskId = decodeURIComponent(taskThreads[1]);
      const all = Array.from(threads.values())
        .filter((t) => t.metadata?.task_id === taskId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map(threadView);
      sendJson(req, res, 200, all);
      return;
    }

    // --- Per-thread routes ---
    const threadStream = p.match(/^\/threads\/([^/]+)\/runs\/stream$/);
    if (threadStream && method === "POST") {
      await handleRunStream(req, res, decodeURIComponent(threadStream[1]));
      return;
    }

    const cancelRun = p.match(/^\/threads\/([^/]+)\/runs\/([^/]+)\/cancel$/);
    if (cancelRun && method === "POST") {
      const t = threads.get(decodeURIComponent(cancelRun[1]));
      const runId = decodeURIComponent(cancelRun[2]);
      const controller = activeRuns.get(runId);
      if (controller) {
        controller.abort();
        const run = t?.runs.get(runId);
        if (run) run.status = "cancelled";
        // Cascade the explicit cancel to every live child subagent of this run.
        const cancelled = cancelChildren(runId);
        if (cancelled > 0) {
          console.log(`[cancel ${runId}] cascading cancel → ${cancelled} subagent task(s)`);
        }
        sendJson(req, res, 200, { success: true, status: "cancelled", cancelled_children: cancelled });
      } else {
        sendJson(req, res, 200, { success: false, detail: "Run not active" });
      }
      return;
    }

    const joinStream = p.match(/^\/threads\/([^/]+)\/runs\/([^/]+)\/stream$/);
    if (joinStream && method === "GET") {
      // No live run to rejoin in this MVP; signal the SDK to no-op the reconnect.
      sendJson(req, res, 409, {
        detail: `Run ${decodeURIComponent(joinStream[2])} is not active on this worker and cannot be streamed.`,
        message: "Run is not active on this worker and cannot be streamed.",
      });
      return;
    }

    // --- Subagent timeline + general run events (Phase E) ---
    // Backs the subtask-card backfill query (`GET …/events?task_id=<id>`) and
    // any future event-sourced views. Filters: `event_types` (comma list),
    // `task_id`, `after_seq` (forward cursor), `limit`, `category`.
    const runEvents = p.match(/^\/threads\/([^/]+)\/runs\/([^/]+)\/events$/);
    if (runEvents && method === "GET") {
      const threadId = decodeURIComponent(runEvents[1]);
      const runId = decodeURIComponent(runEvents[2]);
      const sp = url.searchParams;

      const eventTypesRaw = sp.get("event_types");
      const eventTypes = eventTypesRaw
        ? eventTypesRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : null;
      const taskId = sp.get("task_id");
      const category = sp.get("category");

      const afterSeqRaw = sp.get("after_seq");
      const afterSeqNum = afterSeqRaw != null && afterSeqRaw.trim() !== "" ? Number(afterSeqRaw) : null;
      const afterSeq = afterSeqNum != null && Number.isFinite(afterSeqNum) ? afterSeqNum : null;

      const limitRaw = sp.get("limit");
      const limitNum = limitRaw != null && limitRaw.trim() !== "" ? Number(limitRaw) : 500;
      const limit = Number.isFinite(limitNum) ? Math.max(1, Math.min(5000, limitNum)) : 500;

      try {
        const records = await eventStore.listEvents(threadId, runId, {
          event_types: eventTypes,
          task_id: taskId && taskId.trim() ? taskId : null,
          category: category && category.trim() ? category : null,
          after_seq: afterSeq,
          limit,
        });
        const lastSeq = records.length > 0 ? records[records.length - 1]!.seq : null;
        res.setHeader("Cache-Control", "no-store");
        sendJson(req, res, 200, {
          data: records,
          last_seq: lastSeq,
          has_more: records.length >= limit,
        });
      } catch (err) {
        sendJson(req, res, 500, {
          detail: `Failed to list events: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    const runMessages = p.match(/^\/threads\/([^/]+)\/runs\/([^/]+)\/messages$/);
    if (runMessages && method === "GET") {
      const t = threads.get(decodeURIComponent(runMessages[1]));
      const run = t?.runs.get(decodeURIComponent(runMessages[2]));
      const all = run?.messages ?? [];
      const beforeSeqRaw = url.searchParams.get("before_seq");
      const beforeSeq = beforeSeqRaw != null ? Number(beforeSeqRaw) : undefined;
      const data =
        beforeSeq != null && Number.isFinite(beforeSeq)
          ? all.filter((m) => m.seq < beforeSeq)
          : all;
      sendJson(req, res, 200, { data, has_more: false });
      return;
    }

    // --- Feedback ---
    const feedbackStats = p.match(/^\/threads\/([^/]+)\/runs\/([^/]+)\/feedback\/stats$/);
    if (feedbackStats && method === "GET") {
      const runId = decodeURIComponent(feedbackStats[2]);
      const t = threads.get(decodeURIComponent(feedbackStats[1]));
      const rec = t?.feedback.get(runId);
      const positive = rec && rec.rating > 0 ? 1 : 0;
      const negative = rec && rec.rating < 0 ? 1 : 0;
      sendJson(req, res, 200, {
        run_id: runId,
        total: rec ? 1 : 0,
        positive,
        negative,
      });
      return;
    }
    const feedbackById = p.match(/^\/threads\/([^/]+)\/runs\/([^/]+)\/feedback\/([^/]+)$/);
    if (feedbackById && method === "DELETE") {
      const threadId = decodeURIComponent(feedbackById[1]);
      const runId = decodeURIComponent(feedbackById[2]);
      const feedbackId = decodeURIComponent(feedbackById[3]);
      const t = threads.get(threadId);
      const rec = t?.feedback.get(runId);
      if (!t || !rec || rec.feedback_id !== feedbackId) {
        sendJson(req, res, 404, { detail: `Feedback ${feedbackId} not found in run ${runId}` });
        return;
      }
      t.feedback.delete(runId);
      persistThread(t);
      sendJson(req, res, 200, { success: true });
      return;
    }
    const feedback = p.match(/^\/threads\/([^/]+)\/runs\/([^/]+)\/feedback$/);
    if (feedback) {
      const threadId = decodeURIComponent(feedback[1]);
      const runId = decodeURIComponent(feedback[2]);
      if (method === "GET") {
        const t = threads.get(threadId);
        const rec = t?.feedback.get(runId);
        sendJson(req, res, 200, rec ? [feedbackView(threadId, runId, rec)] : []);
        return;
      }
      const t = getOrCreateThread(threadId);
      if (method === "PUT") {
        const body = await readJson(req);
        const record: FeedbackRecord = {
          feedback_id: t.feedback.get(runId)?.feedback_id ?? randomUUID(),
          rating: Number(body.rating ?? 0),
          comment: (body.comment as string | null) ?? null,
        };
        t.feedback.set(runId, record);
        persistThread(t);
        sendJson(req, res, 200, record);
        return;
      }
      if (method === "POST") {
        const body = await readJson(req);
        const rating = Number(body.rating ?? 0);
        if (rating !== 1 && rating !== -1) {
          sendJson(req, res, 400, { detail: "rating must be +1 or -1" });
          return;
        }
        const record: FeedbackRecord = {
          feedback_id: randomUUID(),
          rating,
          comment: (body.comment as string | null) ?? null,
          message_id: (body.message_id as string | null) ?? null,
          created_at: nowIso(),
        };
        t.feedback.set(runId, record);
        persistThread(t);
        sendJson(req, res, 200, feedbackView(threadId, runId, record));
        return;
      }
      if (method === "DELETE") {
        t.feedback.delete(runId);
        persistThread(t);
        sendJson(req, res, 200, { success: true });
        return;
      }
    }

    // --- Suggestions: LLM-generated follow-up prompts from recent conversation ---
    const suggestions = p.match(/^\/threads\/([^/]+)\/suggestions$/);
    if (suggestions && method === "POST") {
      const body = await readJson(req);
      const appConfig = getAppConfig();
      if (!appConfig.suggestions?.enabled) {
        sendJson(req, res, 200, { suggestions: [] });
        return;
      }
      sendJson(req, res, 200, { suggestions: await buildSuggestions(body, appConfig) });
      return;
    }

    // --- Regenerate: reset thread to before the target assistant message ---
    const regenerate = p.match(/^\/threads\/([^/]+)\/runs\/regenerate\/prepare$/);
    if (regenerate && method === "POST") {
      await handleRegeneratePrepare(req, res, decodeURIComponent(regenerate[1]));
      return;
    }

    // --- Uploads ---
    const uploadsLimits = p.match(/^\/threads\/([^/]+)\/uploads\/limits$/);
    if (uploadsLimits && method === "GET") {
      sendJson(req, res, 200, uploadLimits());
      return;
    }
    const uploadsList = p.match(/^\/threads\/([^/]+)\/uploads\/list$/);
    if (uploadsList && method === "GET") {
      const threadId = decodeURIComponent(uploadsList[1]);
      try {
        const listing = listFilesInDir(threadUploadDir(threadId));
        const enriched = enrichFileListing(listing, threadId);
        sendJson(req, res, 200, enriched);
      } catch {
        sendJson(req, res, 200, { files: [], count: 0 });
      }
      return;
    }
    const uploadDelete = p.match(/^\/threads\/([^/]+)\/uploads\/([^/]+)$/);
    if (uploadDelete && method === "DELETE") {
      const threadId = decodeURIComponent(uploadDelete[1]);
      const rawFilename = decodeURIComponent(uploadDelete[2]);
      const t = getOrCreateThread(threadId);
      try {
        const result = deleteFileSafe(threadUploadDir(threadId), rawFilename, null);
        t.uploads = t.uploads.filter((f) => f.filename !== path.basename(rawFilename));
        persistThread(t);
        sendJson(req, res, 200, result);
      } catch (error) {
        sendJson(req, res, 400, {
          success: false,
          message: error instanceof Error ? error.message : "Failed to delete file",
        });
      }
      return;
    }
    const uploadPost = p.match(/^\/threads\/([^/]+)\/uploads$/);
    if (uploadPost && method === "POST") {
      await handleUpload(req, res, decodeURIComponent(uploadPost[1]));
      return;
    }

    // --- Workspace file tree (Work mode) ---
    const filesTree = p.match(/^\/threads\/([^/]+)\/files\/tree$/);
    if (filesTree && method === "GET") {
      handleFilesTree(req, res, decodeURIComponent(filesTree[1]), url);
      return;
    }

    // --- Artifacts (serve uploaded/generated files) ---
    const artifacts = p.match(/^\/threads\/([^/]+)\/artifacts(\/.*)$/);
    if (artifacts && method === "GET") {
      handleArtifact(
        req,
        res,
        decodeURIComponent(artifacts[1]),
        decodeURIComponent(artifacts[2]),
        url.searchParams.get("download") === "true",
      );
      return;
    }

    const runGet = p.match(/^\/threads\/([^/]+)\/runs\/([^/]+)$/);
    if (runGet && method === "GET") {
      const t = threads.get(decodeURIComponent(runGet[1]));
      const run = t?.runs.get(decodeURIComponent(runGet[2]));
      if (!run) {
        sendJson(req, res, 404, { detail: "Run not found" });
        return;
      }
      sendJson(req, res, 200, run);
      return;
    }

    const runsList = p.match(/^\/threads\/([^/]+)\/runs$/);
    if (runsList && method === "GET") {
      const t = threads.get(decodeURIComponent(runsList[1]));
      sendJson(req, res, 200, t ? Array.from(t.runs.values()) : []);
      return;
    }

    const tokenUsage = p.match(/^\/threads\/([^/]+)\/token-usage$/);
    if (tokenUsage && method === "GET") {
      const tid = decodeURIComponent(tokenUsage[1]);
      if (deps.aggregateTokenUsage) {
        try {
          const usage = await deps.aggregateTokenUsage(tid);
          sendJson(req, res, 200, { thread_id: tid, ...usage });
          return;
        } catch (err) {
          log(deps, `[gateway] token-usage aggregation failed for thread ${tid}: ${err instanceof Error ? err.message : err}`);
        }
      }
      sendJson(req, res, 200, emptyTokenUsage(tid));
      return;
    }

    const history = p.match(/^\/threads\/([^/]+)\/history$/);
    if (history && method === "POST") {
      const t = threads.get(decodeURIComponent(history[1]));
      if (!t) {
        sendJson(req, res, 200, []);
        return;
      }
      sendJson(req, res, 200, [stateView(t)]);
      return;
    }

    const stateRoute = p.match(/^\/threads\/([^/]+)\/state$/);
    if (stateRoute) {
      const t = threads.get(decodeURIComponent(stateRoute[1]));
      if (method === "GET") {
        if (!t) {
          sendJson(req, res, 200, { values: {}, next: [], checkpoint: null });
          return;
        }
        sendJson(req, res, 200, stateView(t));
        return;
      }
      if (method === "POST") {
        const body = await readJson(req);
        const values = (body.values as Record<string, unknown>) ?? {};
        const target = t ?? getOrCreateThread(decodeURIComponent(stateRoute[1]));
        target.values = { ...target.values, ...values };
        target.updated_at = nowIso();
        target.state_updated_at = target.updated_at;
        persistThread(target);
        sendJson(req, res, 200, {
          checkpoint: {
            thread_id: target.thread_id,
            checkpoint_ns: "",
            checkpoint_id: target.state_updated_at,
          },
        });
        return;
      }
    }

    const threadItem = p.match(/^\/threads\/([^/]+)$/);
    if (threadItem) {
      const id = decodeURIComponent(threadItem[1]);
      if (method === "GET") {
        const t = threads.get(id);
        if (!t) {
          sendJson(req, res, 404, { detail: "Thread not found" });
          return;
        }
        sendJson(req, res, 200, threadView(t));
        return;
      }
      if (method === "PATCH") {
        const body = await readJson(req);
        const t = getOrCreateThread(id);
        if (body.metadata && typeof body.metadata === "object") {
          t.metadata = { ...t.metadata, ...(body.metadata as Record<string, unknown>) };
        }
        t.updated_at = nowIso();
        persistThread(t);
        sendJson(req, res, 200, threadView(t));
        return;
      }
      if (method === "DELETE") {
        threads.delete(id);
        try {
          deps.store?.deleteThread(id);
        } catch {
          /* ignore */
        }
        sendJson(req, res, 200, { success: true });
        return;
      }
    }

    sendJson(req, res, 404, { detail: "Not found" });
  }

  // --- Auth routes (real when deps.auth set; else no-auth default user) ---
  async function handleAuth(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    p: string,
    method: string,
  ): Promise<boolean> {
    const token = getSessionToken(req);
    const auth = deps.auth;

    if (!auth) {
      // No-auth mode: satisfy the frontend with a default user.
      if (p === "/v1/auth/me" && method === "GET") return sendJson(req, res, 200, DEFAULT_USER), true;
      if (p === "/v1/auth/setup-status" && method === "GET")
        return sendJson(req, res, 200, { needs_setup: false }), true;
      if (p === "/v1/auth/providers" && method === "GET")
        return sendJson(req, res, 200, { providers: [] }), true;
      if (p === "/v1/auth/logout" && method === "POST")
        return sendJson(req, res, 200, { success: true }), true;
      // No password to change in no-auth mode — acknowledge as a no-op so the
      // frontend change-password form does not surface a confusing 404.
      if (p === "/v1/auth/change-password" && method === "POST")
        return sendJson(req, res, 200, { success: true }), true;
      return false;
    }

    if (p === "/v1/auth/setup-status" && method === "GET")
      return sendJson(req, res, 200, auth.setupStatus()), true;
    if (p === "/v1/auth/providers" && method === "GET")
      return sendJson(req, res, 200, { providers: [] }), true;
    if (p === "/v1/auth/me" && method === "GET") {
      const u = auth.me(token);
      if (!u) return sendJson(req, res, 401, { detail: "unauthenticated" }), true;
      return sendJson(req, res, 200, u), true;
    }
    if (p === "/v1/auth/logout" && method === "POST") {
      auth.logout(token);
      return sendJson(req, res, 200, { success: true }, clearSessionCookie()), true;
    }
    if ((p === "/v1/auth/login/local" || p === "/v1/auth/login") && method === "POST") {
      const b = await readJson(req);
      const r = auth.login(String(b.email ?? ""), String(b.password ?? ""));
      if (r.error || !r.token) return sendJson(req, res, 401, { detail: r.error ?? "login_failed" }), true;
      return sendJson(req, res, 200, r.user, setSessionCookie(r.token)), true;
    }
    if (p === "/v1/auth/register" && method === "POST") {
      const b = await readJson(req);
      const r = auth.register(String(b.email ?? ""), String(b.password ?? ""), b.name as string | undefined);
      if (r.error || !r.token) return sendJson(req, res, 400, { detail: r.error ?? "register_failed" }), true;
      return sendJson(req, res, 201, r.user, setSessionCookie(r.token)), true;
    }
    if (p === "/v1/auth/initialize" && method === "POST") {
      const b = await readJson(req);
      const r = auth.initialize(String(b.email ?? ""), String(b.password ?? ""), b.name as string | undefined);
      if (r.error || !r.token) return sendJson(req, res, 400, { detail: r.error ?? "init_failed" }), true;
      return sendJson(req, res, 201, r.user, setSessionCookie(r.token)), true;
    }
    if (p === "/v1/auth/change-password" && method === "POST") {
      const b = await readJson(req);
      const r = auth.changePassword(
        token,
        String(b.old_password ?? b.current_password ?? ""),
        String(b.new_password ?? ""),
      );
      if (r.error) return sendJson(req, res, 400, { detail: r.error }), true;
      return sendJson(req, res, 200, { success: true }), true;
    }
    return false;
  }

  // --- Memory panel: global memory document + manual facts ---
  async function handleMemory(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    p: string,
    method: string,
  ): Promise<boolean> {
    const mem = deps.memory;
    const respond = (status: number, body: unknown): true => (sendJson(req, res, status, body), true);
    const mapError = (err: unknown): true => {
      const code = (err as { code?: string })?.code;
      const detail = err instanceof Error ? err.message : String(err);
      if (code === "not_found") return respond(404, { detail });
      if (code === "content" || code === "confidence") return respond(400, { detail });
      return respond(500, { detail });
    };

    if ((p === "/memory" || p === "/memory/export") && method === "GET")
      return respond(200, mem ? mem.get() : emptyMemory());
    if (p === "/memory" && method === "DELETE")
      return respond(200, mem ? mem.clear() : emptyMemory());
    if (p === "/memory/reload" && method === "POST")
      return respond(200, mem ? mem.get() : emptyMemory());
    if (p === "/memory/config" && method === "GET") return respond(200, memoryConfig());
    if (p === "/memory/status" && method === "GET")
      return respond(200, { config: memoryConfig(), data: mem ? mem.get() : emptyMemory() });

    if (p === "/memory/import" && method === "POST") {
      const body = await readJson(req);
      if (!mem) return respond(200, emptyMemory());
      try {
        return respond(200, mem.import(body));
      } catch (err) {
        return mapError(err);
      }
    }
    if (p === "/memory/facts" && method === "POST") {
      const body = await readJson(req);
      if (!mem) return respond(200, emptyMemory());
      try {
        return respond(
          200,
          mem.createFact({
            content: String(body.content ?? ""),
            category: body.category as string | undefined,
            confidence: body.confidence as number | undefined,
          }),
        );
      } catch (err) {
        return mapError(err);
      }
    }
    const factRoute = p.match(/^\/memory\/facts\/([^/]+)$/);
    if (factRoute) {
      const factId = decodeURIComponent(factRoute[1]);
      if (!mem) return respond(200, emptyMemory());
      if (method === "DELETE") {
        try {
          return respond(200, mem.deleteFact(factId));
        } catch (err) {
          return mapError(err);
        }
      }
      if (method === "PATCH") {
        const body = await readJson(req);
        try {
          return respond(
            200,
            mem.updateFact(factId, {
              content: body.content as string | undefined,
              category: body.category as string | undefined,
              confidence: body.confidence as number | undefined,
            }),
          );
        } catch (err) {
          return mapError(err);
        }
      }
    }
    return false;
  }

  // --- Skills panel: list + enable + custom-skill CRUD/history/rollback ---
  async function handleSkills(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    p: string,
    method: string,
  ): Promise<boolean> {
    const skills = deps.skills;
    const respond = (status: number, body: unknown): true => (sendJson(req, res, status, body), true);

    if (p === "/skills" && method === "GET")
      return respond(200, { skills: skills ? skills.list() : [] });
    if (p === "/skills/custom" && method === "GET")
      return respond(200, { skills: skills ? skills.listCustom() : [] });

    const customHistory = p.match(/^\/skills\/custom\/([^/]+)\/history$/);
    if (customHistory && method === "GET") {
      const name = skillName(customHistory[1]);
      if (!skills) return respond(200, { history: [] });
      if (!skills.getCustom(name) && !skills.hasHistory(name))
        return respond(404, { detail: `Custom skill '${name}' not found` });
      return respond(200, { history: skills.history(name) });
    }

    const customRollback = p.match(/^\/skills\/custom\/([^/]+)\/rollback$/);
    if (customRollback && method === "POST") {
      const name = skillName(customRollback[1]);
      const body = await readJson(req);
      if (!skills || (!skills.getCustom(name) && !skills.hasHistory(name)))
        return respond(404, { detail: `Custom skill '${name}' not found` });
      const index = typeof body.history_index === "number" ? body.history_index : -1;
      try {
        return respond(200, skills.rollback(name, index));
      } catch (err) {
        return respond(400, { detail: err instanceof Error ? err.message : "Rollback failed" });
      }
    }

    const customItem = p.match(/^\/skills\/custom\/([^/]+)$/);
    if (customItem) {
      const name = skillName(customItem[1]);
      if (method === "GET") {
        const skill = skills?.getCustom(name) ?? null;
        return skill ? respond(200, skill) : respond(404, { detail: `Custom skill '${name}' not found` });
      }
      if (method === "PUT") {
        const body = await readJson(req);
        if (!skills) return respond(503, { detail: "Skills store unavailable" });
        return respond(200, skills.saveCustom(name, String(body.content ?? "")));
      }
      if (method === "DELETE") {
        return skills && skills.deleteCustom(name)
          ? respond(200, { success: true })
          : respond(404, { detail: `Custom skill '${name}' not found` });
      }
    }

    const skillItem = p.match(/^\/skills\/([^/]+)$/);
    if (skillItem) {
      const name = skillName(skillItem[1]);
      if (method === "GET") {
        const skill = skills?.get(name) ?? null;
        return skill ? respond(200, skill) : respond(404, { detail: `Skill '${name}' not found` });
      }
      if (method === "PUT") {
        const body = await readJson(req);
        const updated = skills?.setEnabled(name, Boolean(body.enabled)) ?? null;
        return updated ? respond(200, updated) : respond(404, { detail: `Skill '${name}' not found` });
      }
    }
    return false;
  }

  // --- Skills install: upload a .zip/.skill archive and install it ---
  async function handleSkillsInstall(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (!deps.skillUploadStorage) {
      sendJson(req, res, 503, { detail: "Skill storage unavailable" });
      return;
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "quill-skill-install-"));
    const tmpFile = path.join(tmpDir, "upload.zip");
    let bb: ReturnType<typeof Busboy>;
    try {
      bb = Busboy({ headers: req.headers });
    } catch {
      sendJson(req, res, 400, { detail: "Invalid multipart request" });
      return;
    }
    const pending: Promise<void>[] = [];
    let hasFile = false;
    bb.on("file", (_name, stream, info) => {
      hasFile = true;
      const ext = path.extname(info.filename || "").toLowerCase();
      const dest = path.join(tmpDir, `upload${ext || ".zip"}`);
      const ws = fs.createWriteStream(dest);
      pending.push(
        new Promise<void>((done) => {
          ws.on("close", () => {
            // Copy to standard name for the installer
            try { fs.copyFileSync(dest, tmpFile); } catch { /* ignore */ }
            done();
          });
          ws.on("error", () => done());
        }),
      );
      stream.pipe(ws);
    });
    bb.on("close", async () => {
      await Promise.all(pending);
      if (!hasFile) {
        sendJson(req, res, 400, { detail: "No file uploaded" });
        return;
      }
      try {
        const result = await deps.skillUploadStorage!.installFromArchive(tmpFile);
        sendJson(req, res, 200, {
          success: true,
          skill_name: result.skillName,
          message: `Skill "${result.skillName}" installed successfully`,
        });
      } catch (err) {
        sendJson(req, res, 400, {
          success: false,
          skill_name: "",
          message: err instanceof Error ? err.message : "Install failed",
        });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
    bb.on("error", () => {
      sendJson(req, res, 400, { detail: "Upload failed" });
    });
    req.pipe(bb);
  }

  // --- Agents panel: custom-agent CRUD ---
  async function handleAgents(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
    p: string,
    method: string,
  ): Promise<boolean> {
    const agents = deps.agents;
    const respond = (status: number, body: unknown): true => (sendJson(req, res, status, body), true);
    const invalidName = (name: string): true =>
      respond(422, {
        detail: `Invalid agent name '${name}'. Must match ^[A-Za-z0-9-]+$ (letters, digits, and hyphens only).`,
      });

    if (p === "/agents" && method === "GET")
      return respond(200, { agents: agents ? agents.list() : [] });

    if (p === "/agents/check" && method === "GET") {
      const raw = url.searchParams.get("name") ?? "";
      if (!AGENT_NAME_PATTERN.test(raw)) return invalidName(raw);
      const normalized = raw.toLowerCase();
      return respond(200, { available: agents ? !agents.exists(normalized) : true, name: normalized });
    }

    if (p === "/agents" && method === "POST") {
      const body = await readJson(req);
      const rawName = String(body.name ?? "");
      if (!AGENT_NAME_PATTERN.test(rawName)) return invalidName(rawName);
      const name = rawName.toLowerCase();
      if (!agents) return respond(503, { detail: "Agents store unavailable" });
      if (agents.exists(name)) return respond(409, { detail: `Agent '${name}' already exists` });
      const record: AgentRecord = {
        name,
        description: typeof body.description === "string" ? body.description : "",
        model: (body.model as string | null) ?? null,
        tool_groups: (body.tool_groups as string[] | null) ?? null,
        skills: (body.skills as string[] | null) ?? null,
        soul: typeof body.soul === "string" ? body.soul : "",
      };
      return respond(201, agents.save(record));
    }

    const agentItem = p.match(/^\/agents\/([^/]+)$/);
    if (agentItem) {
      const rawName = decodeURIComponent(agentItem[1]);
      if (!AGENT_NAME_PATTERN.test(rawName)) return invalidName(rawName);
      const name = rawName.toLowerCase();

      if (method === "GET") {
        const agent = agents?.get(name) ?? null;
        return agent ? respond(200, agent) : respond(404, { detail: `Agent '${name}' not found` });
      }
      if (method === "PUT") {
        const body = await readJson(req);
        const existing = agents?.get(name) ?? null;
        if (!agents || !existing) return respond(404, { detail: `Agent '${name}' not found` });
        // Preserve the tri-state of tool_groups/skills: only overwrite a field
        // that is actually present in the request body (null = clear/inherit).
        const merged: AgentRecord = {
          name,
          description:
            "description" in body
              ? typeof body.description === "string"
                ? body.description
                : ""
              : existing.description,
          model: "model" in body ? ((body.model as string | null) ?? null) : existing.model,
          tool_groups:
            "tool_groups" in body ? ((body.tool_groups as string[] | null) ?? null) : existing.tool_groups,
          skills: "skills" in body ? ((body.skills as string[] | null) ?? null) : existing.skills,
          soul: "soul" in body && typeof body.soul === "string" ? body.soul : existing.soul,
        };
        return respond(200, agents.save(merged));
      }
      if (method === "DELETE") {
        if (agents && agents.delete(name)) {
          res.writeHead(204, corsHeaders(req));
          res.end();
          return true;
        }
        return respond(404, { detail: `Agent '${name}' not found` });
      }
    }
    return false;
  }


  async function handleRunStream(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    threadId: string,
  ): Promise<void> {
    let body: Record<string, unknown>;
    try {
      body = await readJson(req);
    } catch {
      sendJson(req, res, 400, { detail: "Invalid JSON body" });
      return;
    }

    const t = getOrCreateThread(threadId);

    // Persist workspace_directory from the run's configurable (sent by the
    // frontend when creating a new conversation with a custom working dir)
    // into thread metadata so the sandbox override resolver can find it. This
    // is the primary path — the standalone PATCH route also works, but doing
    // it here guarantees the value lands on the thread even if the frontend's
    // pre-submit PATCH races the first run request.
    // workspace_directory can arrive via two paths:
    //   A) the run's configurable (sent by the frontend within sendMessage's
    //      context closure — may be stale if the user picked a directory and
    //      submitted in the same render cycle), or
    //   B) a prior PATCH (client.threads.update) that already persisted it to
    //      thread metadata. Prefer A, fall back to B, and always persist so the
    //      sandbox override resolver (which reads thread metadata) finds it.
    const configurable = (body.configurable as Record<string, unknown> | undefined) ?? {};
    const wsFromConfig = configurable["workspace_directory"];
    const wsExisting = t.metadata.workspace_directory;
    const workspaceDir =
      typeof wsFromConfig === "string" && wsFromConfig.trim()
        ? wsFromConfig
        : typeof wsExisting === "string" && wsExisting.trim()
          ? wsExisting
          : undefined;
    console.log(`[workspace-debug] thread=${threadId} fromConfig=${JSON.stringify(wsFromConfig)} fromMeta=${JSON.stringify(wsExisting)} resolved=${JSON.stringify(workspaceDir)}`);
    if (workspaceDir && t.metadata.workspace_directory !== workspaceDir) {
      t.metadata = { ...t.metadata, workspace_directory: workspaceDir };
      t.updated_at = nowIso();
      persistThread(t);
      console.log(`[workspace-debug] persisted workspace_directory=${workspaceDir} for thread=${threadId}`);
    }

    const runId = randomUUID();
    const run: RunRecord = {
      run_id: runId,
      thread_id: threadId,
      status: "running",
      created_at: nowIso(),
      updated_at: nowIso(),
      metadata: (body.metadata as Record<string, unknown>) ?? {},
      messages: [],
    };
    t.runs.set(runId, run);
    t.status = "busy";

    // Abort controller so the run can be cancelled (via /cancel or client disconnect).
    const controller = new AbortController();
    activeRuns.set(runId, controller);
    // Guard against double-cancel: once cancelled (explicitly or via stream
    // terminal), a client disconnect should not fire a redundant cascading
    // cancel. `didCancel` is set by both the /cancel route and the stream's
    // terminal branch.
    let didCancel = false;
    const cancelAll = (): void => {
      if (didCancel) {
        return;
      }
      didCancel = true;
      if (run.status === "running") {
        controller.abort();
      }
      // Cascading cooperative cancel: every background subagent the parent run
      // spawned (tracked via the children registry) gets its CancelEvent set.
      const cancelled = cancelChildren(runId);
      if (cancelled > 0) {
        console.log(`[run ${runId}] cascading cancel → ${cancelled} subagent task(s)`);
      }
    };
    res.on("close", cancelAll);

    // SDK reads run_id from the Content-Location response header.
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Location": `/threads/${threadId}/runs/${runId}`,
      ...corsHeaders(req),
    });

    const writeEvent = (event: string, data: unknown): void => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    writeEvent("metadata", { run_id: runId, thread_id: threadId });

    // Resolve the authenticated user (or the default user in no-auth mode) and
    // push it into the runtime user-context so repository code, tools and
    // middlewares read the same identity. The token is restored in `finally`
    // to avoid cross-request leakage (mirrors Python's contextvar reset).
    const sessionToken = getSessionToken(req);
    let effectiveUser: { id: string } = DEFAULT_USER;
    if (deps.auth) {
      const u = deps.auth.me(sessionToken);
      if (u) effectiveUser = u as { id: string };
    }
    const userCtxToken = setCurrentUser(effectiveUser);

    try {
      const input = body.input as { messages?: MessageLike[] } | undefined;
      const inputMessages = Array.isArray(input?.messages) ? input!.messages : [];

      // Only feed messages the graph hasn't already seen (dedupe by id against
      // the checkpointer state) so multi-turn conversations don't duplicate.
      let existingIds = new Set<string>();
      try {
        const graphForState = typeof deps.graph === "function" ? deps.graph({}) : deps.graph;
        const prior = await graphForState.getState({ configurable: { thread_id: threadId } });
        const priorMsgs = prior?.values?.messages;
        if (Array.isArray(priorMsgs)) {
          for (const m of priorMsgs) {
            const id = (m as { id?: unknown })?.id;
            if (typeof id === "string") existingIds.add(id);
          }
        }
      } catch {
        existingIds = new Set();
      }

      const newMessages = inputMessages.filter((m) => {
        const id = (m as { id?: unknown }).id;
        return typeof id !== "string" || !existingIds.has(id);
      });
      const toSend = (newMessages.length > 0 ? newMessages : inputMessages.slice(-1)).map(
        toMessageInstance,
      );

      const context = {
        user_id: effectiveUser.id,
        ...((body.config as Record<string, unknown>)?.configurable as Record<string, unknown> ?? {}),
        ...((body.context as Record<string, unknown>) ?? {}),
      };
      const config = (body.config as Record<string, unknown>) ?? {};
      // Set a generous default recursion limit for complex multi-step tasks.
      // The client can override by passing recursion_limit in config.
      if (typeof config.recursion_limit !== "number") {
        config.recursion_limit = 100;
      }

      const graphForRun = typeof deps.graph === "function" ? deps.graph(context) : deps.graph;

      const streamModes = ["messages", "values", "updates", "custom"];
      const iterable = await graphForRun.stream(
        { messages: toSend },
        {
          configurable: { thread_id: threadId, ...context },
          context,
          streamMode: streamModes,
          // NOTE: intentionally NOT passing controller.signal here.
          // Passing an external abort signal into LangGraph propagates it to
          // subagents and causes cascade aborts: when one parallel subagent
          // task fails, LangGraph's exceptionSignal aborts the others. We
          // still want to honour client disconnect / explicit cancellation, so
          // we poll controller.signal in the consumer loop instead (mirrors
          // the Python backend's abort_event pattern).
          metadata: { thread_id: threadId, run_id: runId },
          ...(deps.runCallbacks && deps.runCallbacks.length > 0
            ? { callbacks: deps.runCallbacks }
            : {}),
          ...(typeof config.recursion_limit === "number"
            ? { recursionLimit: config.recursion_limit }
            : {}),
        },
      );

      let finalValues: Record<string, unknown> | undefined;

      for await (const chunk of iterable as AsyncIterable<unknown>) {
        // Honour client disconnect / explicit cancellation without propagating
        // an abort signal into LangGraph (avoids cascade-aborting subagents).
        if (controller.signal.aborted) {
          // Throw so the catch block handles cancellation bookkeeping uniformly.
          throw new Error("Run aborted by client");
        }
        // With an array streamMode, langgraph yields [mode, data] tuples.
        if (
          Array.isArray(chunk) &&
          chunk.length === 2 &&
          typeof chunk[0] === "string" &&
          KNOWN_STREAM_MODES.has(chunk[0])
        ) {
          const [mode, data] = chunk as [string, unknown];
          if (mode === "messages") {
            const [msg, meta] = (Array.isArray(data) ? data : [data, {}]) as [unknown, unknown];
            writeEvent("messages", [serializeMessage(msg), meta ?? {}]);
          } else if (mode === "values") {
            finalValues = data as Record<string, unknown>;
            writeEvent("values", serializeValues(finalValues));
          } else if (mode === "updates") {
            writeEvent("updates", serializeUpdates(data));
          } else if (mode === "custom") {
            // Forward custom events (e.g. task_started/task_running/task_completed
            // emitted by the task tool) so the frontend subtask cards update.
            writeEvent("custom", data);
          }
        } else {
          // Single-mode fallback: treat as a values snapshot.
          finalValues = chunk as Record<string, unknown>;
          writeEvent("values", serializeValues(finalValues));
        }
      }

      // Persist final state to the in-memory thread for search/history/state.
      if (finalValues && Array.isArray(finalValues.messages)) {
        t.values = { ...t.values, ...finalValues };
        if (!t.values.title) {
          const firstHuman = (finalValues.messages as MessageLike[]).find(
            (m) => serializeMessage(m).type === "human",
          );
          if (firstHuman) {
            const text = contentToText(serializeMessage(firstHuman).content).trim();
            if (text) t.values.title = text.slice(0, 80);
          }
        }

        // Record the messages produced during THIS run (delta vs prior state)
        // for GET /threads/{id}/runs/{runId}/messages. System messages are
        // tagged `middleware:*` so the frontend hides them.
        const ts = nowIso();
        let seq = 0;
        for (const raw of finalValues.messages as MessageLike[]) {
          const msg = serializeMessage(raw);
          const id = typeof msg.id === "string" ? msg.id : undefined;
          if (id && existingIds.has(id)) continue; // already existed before this run
          const caller = msg.type === "system" ? "middleware:system" : "lead_agent";
          run.messages.push({
            run_id: runId,
            seq: seq++,
            content: msg,
            metadata: { caller },
            created_at: ts,
          });
        }
      }
      t.updated_at = nowIso();
      t.state_updated_at = t.updated_at;
      t.status = "idle";
      run.status = "success";
      run.updated_at = nowIso();
      activeRuns.delete(runId);
      persistThread(t);

      res.end();
    } catch (err) {
      activeRuns.delete(runId);
      const aborted =
        controller.signal.aborted ||
        (err instanceof Error && (err.name === "AbortError" || /abort/i.test(err.message)));
      if (aborted) {
        run.status = "cancelled";
        t.status = "idle";
        run.updated_at = nowIso();
        // Persist whatever partial state the graph produced before the abort.
        try {
          const graphForState = typeof deps.graph === "function" ? deps.graph({}) : deps.graph;
          const partial = await graphForState.getState({ configurable: { thread_id: threadId } });
          if (partial?.values && Array.isArray(partial.values.messages)) {
            t.values = { ...t.values, ...partial.values };
          }
        } catch {
          /* ignore */
        }
        writeEvent("error", { error: "RunCancelled", message: "Run cancelled." });
        persistThread(t);
        log(deps, `[gateway] run ${runId} cancelled`);
        res.end();
        return;
      }
      run.status = "error";
      t.status = "error";
      const message = err instanceof Error ? err.message : String(err);
      writeEvent("error", { error: "RunError", message });
      persistThread(t);
      log(deps, `[gateway] run ${runId} failed: ${message}`);
      res.end();
    } finally {
      // Restore the previous user context so a subsequent request on the same
      // process does not inherit this run's identity.
      resetCurrentUser(userCtxToken);
    }
  }

  // --- Regenerate: reset thread to before the target assistant message ---
  async function handleRegeneratePrepare(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    threadId: string,
  ): Promise<void> {
    const body = await readJson(req);
    const messageId = String(body.message_id ?? "");
    const t = threads.get(threadId);
    if (!t || !Array.isArray(t.values.messages)) {
      sendJson(req, res, 404, { detail: "Thread not found" });
      return;
    }
    const msgs = t.values.messages as MessageLike[];
    const targetIndex = msgs.findIndex((m) => serializeMessage(m).id === messageId);
    if (targetIndex < 0) {
      sendJson(req, res, 404, { detail: "Message not found" });
      return;
    }
    // Keep everything before the target assistant message, minus internal
    // system messages (the graph re-adds a fresh system prompt on rerun).
    const kept = msgs.slice(0, targetIndex).filter((m) => serializeMessage(m).type !== "system");

    let targetRunId: string = randomUUID();
    for (const run of t.runs.values()) {
      if (run.messages.some((rm) => rm.content.id === messageId)) {
        targetRunId = run.run_id;
        break;
      }
    }

    // Reset in-memory state + graph checkpointer so the resubmit regenerates.
    t.values = { ...t.values, messages: kept };
    t.updated_at = nowIso();
    t.state_updated_at = t.updated_at;
    persistThread(t);
    try {
      await deps.deleteThreadCheckpoint?.(threadId);
    } catch (err) {
      log(deps, `[gateway] deleteThreadCheckpoint failed: ${err instanceof Error ? err.message : err}`);
    }

    sendJson(req, res, 200, {
      input: { messages: kept.map(serializeMessage) },
      checkpoint: { checkpoint_ns: "", checkpoint_id: "", checkpoint_map: null },
      metadata: {},
      target_run_id: targetRunId,
    });
  }

  // --- Uploads: store multipart files under the thread's workspace ---
  function handleUpload(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    threadId: string,
  ): Promise<void> {
    return new Promise((resolve) => {
      const t = getOrCreateThread(threadId);
      const dir = threadUploadDir(threadId);
      fs.mkdirSync(dir, { recursive: true });
      let bb: ReturnType<typeof Busboy>;
      try {
        bb = Busboy({ headers: req.headers });
      } catch {
        sendJson(req, res, 400, { detail: "Invalid multipart request" });
        resolve();
        return;
      }
      const saved: Record<string, unknown>[] = [];
      const skipped: string[] = [];
      const pending: Promise<void>[] = [];
      bb.on("file", (_name, stream, info) => {
        const filename = safeName(info.filename || "file");
        const dest = path.join(dir, filename);
        let size = 0;
        stream.on("data", (d: Buffer) => {
          size += d.length;
        });
        const ws = fs.createWriteStream(dest);
        pending.push(
          new Promise<void>((done) => {
            ws.on("close", () => {
              saved.push(uploadedFileInfo(threadId, filename, size));
              done();
            });
            ws.on("error", () => {
              skipped.push(filename);
              done();
            });
          }),
        );
        stream.pipe(ws);
      });
      bb.on("close", async () => {
        await Promise.all(pending);
        for (const f of saved) {
          t.uploads = t.uploads.filter((u) => u.filename !== f.filename);
          t.uploads.push(f);
        }
        persistThread(t);
        sendJson(req, res, 200, {
          success: true,
          files: saved,
          message: `Uploaded ${saved.length} file(s)`,
          skipped_files: skipped,
        });
        resolve();
      });
      bb.on("error", () => {
        sendJson(req, res, 400, { detail: "Upload failed" });
        resolve();
      });
      req.pipe(bb);
    });
  }

  // --- Artifacts: serve a stored file from the thread's upload dir or sandbox workspace ---
  function threadSandboxWorkspace(threadId: string): string {
    // BUG 3 fix: honor the workspace_directory override so artifact serving
    // finds files in the user-picked host folder, not just the default sandbox.
    const override = threads.get(threadId)?.metadata?.workspace_directory;
    if (typeof override === "string" && override.trim()) {
      return path.resolve(override);
    }
    return getPaths().sandboxUserDataDir(threadId);
  }
  function resolveArtifactPath(threadId: string, filepath: string): string | null {
    const stripped = filepath.replace(/^\/+/, "");
    const prefix = VIRTUAL_PATH_PREFIX.replace(/^\/+/, "");

    let relative: string;
    if (stripped === prefix || stripped.startsWith(prefix + "/")) {
      relative = stripped.slice(prefix.length).replace(/^\/+/, "");
    } else {
      relative = stripped;
    }
    if (!relative) {
      return null;
    }

    const segments = relative.split("/").filter(Boolean);
    const uploadDir = path.resolve(threadUploadDir(threadId));
    const userDataDir = path.dirname(uploadDir);

    const resolveAndCheck = (baseDir: string): string | null => {
      const candidate = path.resolve(baseDir, ...segments);
      const resolvedBase = path.resolve(baseDir);
      if (!candidate.startsWith(resolvedBase + path.sep) && candidate !== resolvedBase) {
        return null;
      }
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
      return null;
    };

    const uploadCandidate = resolveAndCheck(uploadDir);
    if (uploadCandidate) {
      return uploadCandidate;
    }

    const userDataCandidate = resolveAndCheck(userDataDir);
    if (userDataCandidate) {
      return userDataCandidate;
    }

    const workspace = path.resolve(threadSandboxWorkspace(threadId));
    const sandboxCandidate = resolveAndCheck(workspace);
    if (sandboxCandidate) {
      return sandboxCandidate;
    }

    return null;
  }
  function handleArtifact(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    threadId: string,
    filepath: string,
    download: boolean,
  ): void {
    const resolved = resolveArtifactPath(threadId, filepath);
    if (!resolved) {
      sendJson(req, res, 404, { detail: "Artifact not found" });
      return;
    }
    const headers: Record<string, string> = {
      "Content-Type": mimeForExt(path.extname(resolved)),
      ...corsHeaders(req),
    };
    if (download) headers["Content-Disposition"] = buildContentDisposition(resolved);
    res.writeHead(200, headers);
    fs.createReadStream(resolved).pipe(res);
  }

  /**
   * Return the thread metadata for a given thread id (or undefined if the
   * thread does not exist in this gateway's in-memory store). Used by the
   * startup wiring to resolve per-thread workspace_directory overrides.
   */
  function getThreadMetadata(threadId: string): Record<string, unknown> | undefined {
    return threads.get(threadId)?.metadata;
  }

  // ── Workspace file tree (Work mode) ──────────────────────────────────────

  /** Names skipped during workspace walk (mirrors sandbox search ignores). */
  const TREE_IGNORE = new Set([
    ".git", ".svn", ".hg", "node_modules", "__pycache__", ".venv", "venv",
    ".next", "dist", "build", ".turbo", ".DS_Store",
  ]);

  const TREE_MAX_DEPTH = 4;
  const TREE_MAX_ENTRIES = 500;
  /** Per-directory cap so a single folder with many files does not starve its siblings. */
  const TREE_MAX_ENTRIES_PER_DIR = 100;

  interface FileTreeNode {
    name: string;
    path: string; // host-relative path from workspace root (POSIX-style)
    type: "file" | "directory";
    size?: number;
    modified?: string;
    children?: FileTreeNode[];
    /** True when this directory's children were truncated by the per-dir cap. */
    truncated?: boolean;
  }

  /**
   * Walk `root` recursively and return a tree of `FileTreeNode`. Each node's
   * `path` is the POSIX-style path relative to `root` — the same value that
   * the agent uses in tool results. Stops at TREE_MAX_DEPTH / TREE_MAX_ENTRIES.
   *
   * The entry budget is per-directory (not global): a single folder with tens
   * of thousands of files saturates its own budget but never starves siblings.
   */
  function walkWorkspace(root: string, maxDepth = TREE_MAX_DEPTH, maxTotal = TREE_MAX_ENTRIES): FileTreeNode {
    let totalCount = 0;

    function walk(dir: string, depth: number): FileTreeNode[] {
      if (depth > maxDepth || totalCount >= maxTotal) return [];
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return [];
      }
      const result: FileTreeNode[] = [];
      // Directories first, then files, each sorted by name.
      const dirs: fs.Dirent[] = [];
      const files: fs.Dirent[] = [];
      for (const e of entries) {
        if (TREE_IGNORE.has(e.name)) continue;
        if (e.isDirectory()) dirs.push(e);
        else files.push(e);
      }
      dirs.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));

      const allEntries = [...dirs, ...files];
      // Per-dir cap: each directory contributes at most TREE_MAX_ENTRIES_PER_DIR entries.
      const capped = allEntries.slice(0, TREE_MAX_ENTRIES_PER_DIR);
      const truncated = allEntries.length > capped.length;

      for (const e of capped) {
        if (totalCount >= maxTotal) break;
        totalCount++;
        const hostPath = path.join(dir, e.name);
        const rel = path.relative(root, hostPath).split(path.sep).join("/");
        let stat: fs.Stats;
        try {
          stat = fs.statSync(hostPath);
        } catch {
          continue;
        }
        if (e.isDirectory()) {
          const child = walk(hostPath, depth + 1);
          result.push({
            name: e.name,
            path: rel,
            type: "directory",
            modified: stat.mtime.toISOString(),
            children: child,
          });
        } else {
          result.push({
            name: e.name,
            path: rel,
            type: "file",
            size: stat.size,
            modified: stat.mtime.toISOString(),
          });
        }
      }

      // If this directory was capped, append a synthetic "[+N more]" sentinel.
      if (truncated) {
        const omitted = allEntries.length - capped.length;
        result.push({
          name: `[+${omitted} more]`,
          path: "__truncated__",
          type: "file",
          size: 0,
          truncated: true,
        });
      }

      return result;
    }

    let rootStat: fs.Stats;
    try {
      rootStat = fs.statSync(root);
    } catch {
      return { name: path.basename(root), path: "", type: "directory", children: [] };
    }
    return {
      name: path.basename(root),
      path: "",
      type: "directory",
      modified: rootStat.mtime.toISOString(),
      children: walk(root, 1),
    };
  }

  /**
   * List the immediate children of `dir` (one level only). Each directory node
   * gets `children: undefined` so the frontend can lazy-load on expand.
   * Returns the root node with its direct children populated.
   */
  function listSingleLevel(root: string, subPath: string): FileTreeNode {
    const dir = subPath ? path.resolve(root, subPath) : root;

    let dirStat: fs.Stats;
    try {
      dirStat = fs.statSync(dir);
    } catch {
      return { name: path.basename(dir) || root, path: subPath, type: "directory", children: [] };
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return { name: path.basename(dir) || root, path: subPath, type: "directory", children: [] };
    }

    const dirs: fs.Dirent[] = [];
    const files: fs.Dirent[] = [];
    for (const e of entries) {
      if (TREE_IGNORE.has(e.name)) continue;
      if (e.isDirectory()) dirs.push(e);
      else files.push(e);
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));

    const allEntries = [...dirs, ...files].slice(0, 200);

    const children: FileTreeNode[] = [];
    for (const e of allEntries) {
      const hostPath = path.join(dir, e.name);
      const rel = path.relative(root, hostPath).split(path.sep).join("/");
      let stat: fs.Stats;
      try {
        stat = fs.statSync(hostPath);
      } catch {
        continue;
      }
      if (e.isDirectory()) {
        // children: undefined → frontend knows it hasn't been loaded yet
        children.push({
          name: e.name,
          path: rel,
          type: "directory",
          modified: stat.mtime.toISOString(),
        });
      } else {
        children.push({
          name: e.name,
          path: rel,
          type: "file",
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      }
    }

    return {
      name: path.basename(dir) || root,
      path: subPath,
      type: "directory",
      modified: dirStat.mtime.toISOString(),
      children,
    };
  }

  /** Handle GET /threads/{id}/files/tree — workspace listing. */
  function handleFilesTree(req: http.IncomingMessage, res: http.ServerResponse, threadId: string, url: URL): void {
    // For new threads that haven't been created on the backend yet (client-
    // generated UUID), auto-create with empty metadata so the tree endpoint
    // returns an empty tree instead of 404. This is the same pattern used
    // by the PATCH route (getOrCreateThread).
    const t = getOrCreateThread(threadId);
    // Resolve workspace root: override > default sandbox user-data dir.
    let root: string;
    const override = t.metadata?.workspace_directory;
    if (typeof override === "string" && override.trim()) {
      root = path.resolve(override);
    } else {
      root = path.resolve(getPaths().sandboxUserDataDir(threadId));
    }
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      sendJson(req, res, 200, {
        path: root,
        name: path.basename(root),
        type: "directory",
        children: [],
      });
      return;
    }
    try {
      const subPath = url.searchParams.get("path") ?? "";
      const tree = listSingleLevel(root, subPath);
      sendJson(req, res, 200, tree);
    } catch (err) {
      sendJson(req, res, 500, {
        detail: `Failed to list workspace: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return { server, getThreadMetadata };
}

function buildContentDisposition(filePath: string): string {
  const basename = path.basename(filePath);
  // Legacy `filename` field: sanitize to printable ASCII and escape quotes/backslashes
  // so the header stays valid for older browsers / HTTP clients.
  const asciiName = basename
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  // RFC 5987 `filename*` field preserves the original Unicode name.
  const utf8Name = encodeURIComponent(basename);
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`;
}

const MIME_MAP: Record<string, string> = {
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
};
function mimeForExt(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] ?? "application/octet-stream";
}

function serializeUpdates(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [node, value] of Object.entries(data as Record<string, unknown>)) {
    if (value && typeof value === "object" && "messages" in value) {
      const v = value as Record<string, unknown>;
      out[node] = {
        ...v,
        messages: Array.isArray(v.messages) ? v.messages.map(serializeMessage) : v.messages,
      };
    } else {
      out[node] = value;
    }
  }
  return out;
}

function emptyTokenUsage(threadId: string): Record<string, unknown> {
  return {
    thread_id: threadId,
    total_tokens: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_runs: 0,
    by_model: {},
    by_caller: { lead_agent: 0, subagent: 0, middleware: 0 },
  };
}

function emptyMemory(): Record<string, unknown> {
  const blank = () => ({ summary: "", updatedAt: "" });
  return {
    version: "1.0",
    lastUpdated: nowIso(),
    user: { workContext: blank(), personalContext: blank(), topOfMind: blank() },
    history: { recentMonths: blank(), earlierContext: blank(), longTermBackground: blank() },
    facts: [],
  };
}

/** Default memory-system configuration reported by GET /memory/config|status. */
function memoryConfig(): Record<string, unknown> {
  return {
    enabled: true,
    storage_path: ".scitops/memory.db",
    debounce_seconds: 30,
    max_facts: 100,
    fact_confidence_threshold: 0.5,
    injection_enabled: true,
    max_injection_tokens: 2000,
    token_counting: "char",
    guaranteed_categories: [],
    guaranteed_token_budget: 0,
  };
}

/** Agent-name validation pattern — mirrors the Python router. */
const AGENT_NAME_PATTERN = /^[A-Za-z0-9-]+$/;

/** Normalize a skill name from the URL (strip CRLF like the Python router). */
function skillName(segment: string): string {
  return decodeURIComponent(segment).replace(/\r\n/g, "").replace(/\n/g, "");
}

/** Application-level upload limits (bytes) — matches uploads.py defaults. */
function uploadLimits(): Record<string, unknown> {
  return {
    max_files: 10,
    max_file_size: 50 * 1024 * 1024,
    max_total_size: 100 * 1024 * 1024,
  };
}

/** Build a FeedbackResponse from a stored feedback record. */
function feedbackView(
  threadId: string,
  runId: string,
  rec: { feedback_id: string; rating: number; comment: string | null; message_id?: string | null; user_id?: string | null; created_at?: string },
): Record<string, unknown> {
  return {
    feedback_id: rec.feedback_id,
    run_id: runId,
    thread_id: threadId,
    user_id: rec.user_id ?? null,
    message_id: rec.message_id ?? null,
    rating: rec.rating,
    comment: rec.comment ?? null,
    created_at: rec.created_at ?? "",
  };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, num));
}

// ── Suggestion generation (LLM-powered, mirrors Python suggestions.py) ──

/**
 * Derive follow-up questions from the recent conversation. Mirrors the Python
 * `generate_suggestions` endpoint: formats the conversation, asks the LLM for a
 * JSON array of short questions, and parses the result. Falls back to an empty
 * list on any failure so the frontend degrades gracefully.
 */
async function buildSuggestions(
  body: Record<string, unknown>,
  appConfig: import("../config/app_config.js").AppConfig,
): Promise<string[]> {
  const rawMessages = Array.isArray(body.messages)
    ? (body.messages as Record<string, unknown>[])
    : [];
  if (rawMessages.length === 0) return [];
  const n = clampInt(body.n, 3, 1, 5);

  // Format conversation as "User: ...\nAssistant: ..." (matches Python _format_conversation).
  const parts: string[] = [];
  for (const msg of rawMessages) {
    const role = String(msg?.role ?? "").toLowerCase();
    const content = String(msg?.content ?? "").trim();
    if (!content) continue;
    if (role === "user" || role === "human") {
      parts.push(`User: ${content}`);
    } else if (role === "assistant" || role === "ai") {
      parts.push(`Assistant: ${content}`);
    }
  }
  const conversation = parts.join("\n").trim();
  if (!conversation) return [];

  const modelName = typeof body.model_name === "string" ? body.model_name : null;

  try {
    const { createChatModel } = await import("../models/factory.js");
    const model = createChatModel(modelName, false, {
      appConfig,
      attachTracing: false,
    });

    const systemInstruction = [
      "You are generating follow-up questions to help the user continue the conversation.",
      `Based on the conversation below, produce EXACTLY ${n} short questions the user might ask next.`,
      "Requirements:",
      "- Questions must be relevant to the preceding conversation.",
      "- Questions must be written in the same language as the user.",
      "- Keep each question concise (ideally <= 20 words / <= 40 Chinese characters).",
      "- Do NOT include numbering, markdown, or any extra text.",
      "- Output MUST be a JSON array of strings only.",
    ].join("\n");

    const userContent = `Conversation Context:\n${conversation}\n\nGenerate ${n} follow-up questions`;

    const response = await model.invoke([
      new SystemMessage(systemInstruction),
      new HumanMessage(userContent),
    ]);

    const raw = extractResponseText(response.content);
    const parsed = parseJsonStringList(raw);
    if (!parsed || parsed.length === 0) return [];
    return parsed.map((s) => s.replace(/\n/g, " ").trim()).filter(Boolean).slice(0, n);
  } catch {
    // Never let suggestion failures reach the caller — degrade to empty.
    return [];
  }
}

/** Extract plain text from an LLM response (handles string and content-block shapes). */
function extractResponseText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        typeof block === "string"
          ? block
          : block && typeof block === "object" && "text" in block
            ? String((block as { text: unknown }).text ?? "")
            : "",
      )
      .join("");
  }
  return "";
}

/** Locate and parse a JSON array of strings inside free text (handles markdown fences, think blocks). */
function parseJsonStringList(text: string): string[] | null {
  let candidate = text.trim();
  // Strip common <think>...</think> blocks.
  candidate = candidate.replace(/<think[\s\S]*?<\/think>/gi, "");
  // Strip markdown code fences.
  candidate = candidate.replace(/```(?:json)?\s*/gi, "");
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const data = JSON.parse(candidate.slice(start, end + 1));
    if (!Array.isArray(data)) return null;
    return data.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return null;
  }
}

