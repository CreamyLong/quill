# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, and others) when working with code in this repository. It is the source of truth; the sibling `CLAUDE.md` imports it via `@AGENTS.md`.

It is the **monorepo orientation layer**: it maps the whole repo and points to the
module guides that own the depth. For anything inside a module, read that module's
guide rather than expecting full detail here:

- **[backend/AGENTS.md](backend/AGENTS.md)** — backend depth: harness/app split, agent &
  middleware chain, sandbox, MCP, skills, memory, IM channels, persistence/migrations,
  config system, test layout.
- **[frontend/AGENTS.md](frontend/AGENTS.md)** — frontend depth: Next.js App Router layout,
  thread/streaming data flow, code style, commands.

## What is Quill

Quill is a LangGraph-based AI super-agent system with a full-stack architecture. The
backend runs a "super agent" with sandboxed execution, persistent memory, subagent
delegation, and extensible tools (built-in, MCP, community), all per-thread isolated. The
frontend is a Next.js chat UI. External IM platforms (Feishu, Slack, Telegram, Discord,
DingTalk) bridge into the same agent through the Gateway.

## Service Topology

A single `make dev` / Docker stack runs four cooperating services:

| Service         | Port   | Role                                                                 |
| --------------- | ------ | ------------------------------------------------------------------- |
| **Nginx**       | `2026` | Unified reverse-proxy entry point — open this in the browser        |
| **Gateway API** | `8001` | FastAPI REST API + embedded LangGraph-compatible agent runtime      |
| **Frontend**    | `3000` | Next.js web interface                                               |
| **Provisioner** | `8002` | Optional — only when sandbox is configured for provisioner/K8s mode |

Nginx is the single public entry: it serves the frontend and proxies `/api/langgraph/*`
to the Gateway's LangGraph runtime, rewriting it to Gateway's native `/api/*` routes; all
other `/api/*` go straight to the Gateway REST routers. See
[backend/AGENTS.md](backend/AGENTS.md) for the runtime and router detail.

## Repository Map

```
quill/
├── Makefile                        # Root orchestration: drives the full stack (dev/start/stop, docker, setup)
├── config.example.yaml             # Template → copy to config.yaml (gitignored) at repo root
├── extensions_config.example.json  # Template → copy to extensions_config.json (gitignored): MCP servers + skills
├── backend/                        # Python backend — see backend/AGENTS.md
│   ├── Makefile                    # Per-module backend commands (dev, gateway, test, lint, migrate-rev)
│   ├── packages/
│   │   ├── harness/               # quill-harness package (import: quill.*) — agent framework
│   │   └── extension-api/          # Public, host-independent extension contracts (import: quill_extension_api.*)
│   └── app/                        # FastAPI Gateway + IM channels (import: app.*)
├── frontend/                       # Next.js frontend (pnpm) — see frontend/AGENTS.md
├── docker/                         # docker-compose files, nginx config, provisioner
├── skills/                         # Agent skills: public/ (committed), custom/ (gitignored)
├── contracts/                      # Cross-component JSON contracts (e.g. subagent status)
├── scripts/                        # Root orchestration scripts invoked by the Makefile (check, configure, doctor, support_bundle, serve, nginx, docker, deploy, setup_wizard)
├── tests/                          # Root-level tests (currently tests/skills/ — public skill tests)
└── docs/                           # Cross-cutting docs, plans, and design notes
    └── harness-framework-comparison.md  # Framework comparison & suitability analysis
```

Runtime config lives at the **repo root**: copy `config.example.yaml` → `config.yaml`
(main app config) and `extensions_config.example.json` → `extensions_config.json` (MCP
servers + skills). Both real files are gitignored and may be edited at runtime via the
Gateway API. Config schema and resolution order are documented in
[backend/AGENTS.md](backend/AGENTS.md).

## Commands: Root vs. Module

**Root `make` targets drive the whole stack** (run from the repo root):

```bash
make setup       # Interactive setup wizard (recommended for new users)
make doctor      # Check configuration and system requirements
make support-bundle  # Generate redacted troubleshooting summary, AI issue draft, and optional zip
make config      # Generate local config files from the examples
make check       # Check that required tools are installed
make install     # Install all dependencies (frontend + backend + pre-commit hooks)
make dev         # Start all services with hot-reload (Gateway + Frontend + Nginx)
make start       # Start all services in production mode (local, optimized)
make stop        # Stop all running services
make up / down   # Build/stop the production Docker stack (browser at localhost:2026)
make docker-start / docker-stop / docker-logs   # Docker development environment
```

Run `make help` for the full list.

**Per-module commands drive a single module** (run inside that module):

```bash
# Backend (see backend/AGENTS.md for the full set)
cd backend && make dev        # Gateway API with reload (port 8001)
cd backend && make test       # Backend test suite
cd backend && make lint       # ruff check
cd backend && make format     # ruff format

# Frontend (see frontend/AGENTS.md for the full set)
cd frontend && pnpm dev       # Dev server with Turbopack (port 3000)
cd frontend && pnpm check     # Lint + type check (run before committing)
cd frontend && pnpm test      # Unit tests
```

Rule of thumb: **root `make` = the full application**; **`backend/Makefile` and `frontend/`
(`pnpm`) = per-module work.**

## Recent Competitive Updates (2026-09)

Quill was systematically evaluated against 11 leading harness frameworks/products (ZCode, OpenWork, DeepSeek Harness, awesome-harness-engineering, DeerFlow, CrewAI, AutoGen, Kimi Code CLI, OpenAI Codex, OpenClaw, Hermes Agent). The following capabilities were added or enhanced based on that analysis:

### v0.8.0 (ZCode Sync — Round 5)

- **Dynamic Workflows** (`workflows/dynamic/`) — ZCode's flagship `@zcode/dynamic-workflow` ported: TS-script authoring (facade `agent()/ask()/run()/log()/sleep()/escalate()`), compiler validation with a string-literal gate on `run()`, vm-sandboxed execution with an append-only JSONL journal, escalations (parked promises, budget 3/ask), and `DynamicWorkflowService` with submit/amend/resume/stop implementing the seven upstream lifecycle invariants (warm-cache amend/resume, orphan reconciliation). Gateway: `/api/dynamic-workflows/*`.
- **Protocol Versioning** (`server/protocol_version.ts`) — ZCode Protocol V4 transport patterns: `/api/protocol/hello` handshake with capability echo, `X-Quill-Protocol-Version` negotiation (older = deprecation header, newer = 400 + supported range), plus the three compat utilities (`stripUnknownFields`, `isMethodNotFoundError`, `checkPayloadSchemaVersion`).
- **Conversation Sharing** (`runtime/sharing.ts`) — ZCode's `ConversationShareService` self-hosted: sanitize (secret redaction, tool-internals stripping) → integrity-hashed public projection → file-backed store; access modes private/link_viewer/link_editor; import as a new thread; read-only viewer at `/share/[id]`. Gateway: `/api/shares/*`.
- **Automation → IM Delivery** (`scheduling/automation_delivery.ts`) — implements what ZCode's `bot_delivery_target` column promises but never delivers: scheduled-task outcomes pushed to Slack/Feishu/DingTalk/Telegram/generic webhooks, event-filtered, best-effort.
- **Claude Code Session Migration** (`migrations/claude_code.ts`) — ZCode's claudeNativeSessionImport: scan `~/.claude/projects` JSONL, tolerant parse, import as threads tagged `migrationSource: "claudeCode"`. Gateway: `/api/migrations/claude-code/*`.
- **@-Mention Pickers** (`frontend/.../mention-picker.tsx`) — ZCode's composer `MentionPlugin` model: caret-aware `@` trigger opens a grouped Agents+Skills autocomplete with keyboard navigation.
- **LLM Overlay** (`models/llm_overlay.ts`) — CrewAI 1.15.22's `llm_overlay`: AsyncLocalStorage-scoped role→model routing with whitespace-stripped exact match, conflict detection, and the faithful settings-merge rule (generation params copy, credentials only same-provider); wired into `createChatModel(role)`.
- **Delegation Acceptance Criteria** (`multi_agent/acceptance_checks.ts`) — DeerFlow 2.1.0's deterministic checks: `file: exists/non-empty`, `file_written:`, `tests_passed:` anchored to recorded executions; workspace-scoped paths; verdict block appended to `task` tool results.
- **Goal Judge** (`agents/goal/judge.ts`) — Hermes `/goal` judge model: four verdicts (done/blocked/wait/continue), fail-open on judge errors (turn budget as backstop), quality gates before the judge, wait-parking with `wakeWaiting`.

### v0.7.0 (ZCode Sync — Round 4)

- **Off-Peak Tasks** (`scheduling/offpeak.ts`) — Deferred execution with server-admitted tickets, ported from ZCode's "闲时任务" runtime. Ticket state machine (queued/ready/active/settled/expired) with TTL expiry detection and automatic re-ticket; shared `OffPeakScheduler` tick loop gated on an injectable system-idle predicate.
- **CommandInbox** (`agents/inbox/`) — Serial message queueing while the agent is busy, ported from ZCode's CommandInbox. Bounded FIFO queues (per-thread + global), cancel/reorder/clear, change listeners for the queue panel.
- **Git Checkpoints & Rewind** (`runtime/checkpoints.ts`) — Workspace snapshots in a hidden git repo (`.quill/checkpoints.git`) that never touches the user's own git history. Per-file rewind, whole-workspace rewind, read-at-checkpoint.
- **Bash Read-Only Policy** (`guardrails/bash_readonly_policy.ts`) — Structured argv/flag analysis that auto-approves genuinely read-only commands (git/gh/npm/pip/brew/kubectl subcommand semantics, sed -i / find -delete detection, pipeline-wide analysis, hard-deny patterns). Ported from ZCode's bash-readonly-policy handlers.
- **Auto Review** (`guardrails/auto_review.ts`) — Risk-tiered per-call review by actual effect, ported from DeepSeek Harness: low → allow, medium (irreversible/prod) → require authorization, high (exfiltration across trust boundaries) → hard deny. Structured `AutoReviewDeniedError`; LLM reviewer prompt with the 5 fixed DeepSeek partitions.
- **Durable Kanban Board** (`multi_agent/kanban.ts`) — Crash-recovering task board ported from Hermes Agent: atomic file persistence, lease-based claims with stale reclaim, attempt exhaustion → blocked, backlog promotion, `KanbanDispatcher` (reclaim → promote → spawn).
- **ObservationPack** (`agents/middlewares/observation_pack.ts`) — Content-addressed handles (`obs://<id>`) for large/repeated tool results with exact paged recall, ported from the SoL-Pi mechanism (awesome-harness-engineering). LRU + TTL.
- **Skill Attribution** (`skills/attribution.ts`) — "This answer used skill X" ported from OpenWork: activation tracking, tool-use attribution, contribution inference from the final answer, UI summary line.

### v0.6.0 (ZCode Sync — Round 3)

- **Elicitation System** (`agents/elicitation/`) — Proactive ambiguity detection that generates structured clarifying questions before the agent commits to expensive runs. Scores 5 dimensions (missing context, vagueness, underspecified goal, contradiction, insufficient detail). Inspired by ZCode's Elicitation runtime.
- **Context Rot Detection** (`agents/middlewares/context_rot_detector.ts`) — Real-time context health monitoring (token bloat, tool staleness, repetition, fragmentation). Auto-triggers compaction/forking. Inspired by awesome-harness-engineering.
- **Workflow Concurrency Control** (`workflows/concurrency_control.ts`) — Runtime concurrency adjustment for running workflows without stopping. Event-driven queue management. Inspired by ZCode v3.14.3.
- **Two-Stage Classifier** (`agents/middlewares/two_stage_classifier.ts`) — Fast heuristic gate before expensive reasoning. Classifies minimal/standard/deep. Inspired by awesome-harness-engineering.
- **ACP Adapter** (`integrations/acp/`) — Agent Client Protocol JSON-RPC server for IDE integration (Zed, JetBrains, VS Code). Inspired by Kimi Code CLI's ACP adapter.
- **Funnel Telemetry** (`telemetry/funnel.ts`) — Drop-off analysis for user journeys across interaction stages. Inspired by ZCode's Funnel Telemetry.
- **Computer Use Agent** (`agents/cua/`) — Desktop automation broker with fail-closed privacy (PrivacyGuard) and immutable audit trail (CuaAuditLog). Inspired by ZCode's CUA.

### v0.5.0 (ZCode Sync — Round 2)

- **Plugin Store** (`plugins/`) — Full plugin lifecycle (install/configure/enable/disable/uninstall/restore) with marketplace, CDN distribution, personal sources. Inspired by ZCode's plugin store.
- **Hooks System** (`hooks/`) — 13 lifecycle event types with trust management, blockable hooks, tool/prompt modifications. Inspired by ZCode + Kimi Code.
- **Memory Diagnostics** (`agents/memory/diagnostics.ts`) — Health scoring, staleness detection, contradiction analysis, fact graph, auto-repair. Inspired by ZCode.
- **Conversation Telemetry** (`telemetry/`) — Token usage by model/time, tool patterns, cost tracking, session analytics. Inspired by ZCode + Kimi Code.
- **Model Trajectory** (`agents/trajectory/`) — Decision path recording with directed graph, replay capability. Inspired by ZCode + DeepSeek Harness.
- **Universal MCP Rail** (`mcp/capability_registry.ts`) — Two-tool capability federation (search_capabilities + execute_capability). Inspired by OpenWork.
- **Architecture Policy** (`scripts/architecture/`) — Automated enforcement: file size limits, import cycle detection, module boundaries. Inspired by ZCode.

### v0.4.0 (Round 1)

- **Self-Improving Skills** (`tools/skill_manage_tool.ts`) — Agent autonomously creates/patches/deletes skills in `skills/custom/` after complex tasks. Gated by `skill_evolution.enabled` in config. Ports Hermes Agent's learning loop.
- **Adaptive Permissions** (`guardrails/adaptive_permissions.ts`) — Progressive trust levels (0-4) that auto-advance based on session count, success ratio, and account age. Inspired by OpenClaw + awesome-harness-engineering.
- **Multi-Agent Coordination** (`multi_agent/`) — Supervisor, round-robin, handoff, and hierarchical team patterns. Ports CrewAI/AutoGen/LangGraph patterns.
- **Workflow Engine** (`workflows/`) — DAG-based agent orchestration with parallel execution, retry, and conditional branching. Ports DeerFlow + CrewAI Flows.
- **Tool Receipts** (`tools/receipts/`) — Deterministic verification layer for agent tool calls. Ports DeerFlow 2.0's receipt system.
- **Memory Invalidation** (`agents/memory/invalidation.ts`) — Stale/contradictory fact detection with three-tier memory model. Ports awesome-harness-engineering research.
- **MCP Dual-Role** (`mcp/server.ts`) — Quill is both MCP client and server (8 bridge tools). Ports OpenClaw's dual-role pattern.
- **Depth-Aware Policy** (`agents/middlewares/depth_aware_tool_policy_middleware.ts`) — Subagents lose dangerous tools as nesting depth increases.
- **Tool Discovery** (`tools/discovery/`) — Budgeted catalog with fair token allocation. Ports OpenWork CodeMode.
- **Observability Dashboard** (`app/gateway/routers/metrics.ts`, `frontend/.../metrics-dashboard.tsx`) — System-wide token usage, cost analytics, and activity metrics.
- **Tool Management** (`tools/tools.ts`) — Wired `skill_manage` tool into the tool registry when skill evolution is enabled.

## Where to Go Next

- Backend work → **[backend/AGENTS.md](backend/AGENTS.md)**
- Frontend work → **[frontend/AGENTS.md](frontend/AGENTS.md)**
- Setup & install → **[Install.md](Install.md)**, **[CONTRIBUTING.md](CONTRIBUTING.md)**
- Project overview & usage → **[README.md](README.md)** (translations: `README_zh.md`,
  `README_ja.md`, `README_fr.md`, `README_ru.md`)
- Security policy → **[SECURITY.md](SECURITY.md)**
- Changes → **[CHANGELOG.md](CHANGELOG.md)**

## Cross-Cutting Conventions

These apply repo-wide; module guides own the module-specific detail.

- **Documentation update policy** — keep docs in sync with code: update `README.md` for
  user-facing changes and the relevant `AGENTS.md` for development/architecture changes in
  the same change set.
- **Test-driven development** — features and bug fixes ship with tests. Backend tests live
  in `backend/tests/` (TDD is mandatory there; see [backend/AGENTS.md](backend/AGENTS.md));
  frontend tests live in `frontend/tests/`.
- **Format before pushing** — run `make format` (backend) / `pnpm check` (frontend). Backend
  CI enforces `ruff format --check`, so formatting must be clean before a push.
