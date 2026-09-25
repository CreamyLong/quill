# Harness Framework Comparison & Suitability Analysis

> **Last updated:** 2026-09-26 (v0.6.0)
> **Scope:** Systematic evaluation of 11 leading AI agent harness/framework/workspace projects
> **Goal:** Identify features to port into Quill for competitive parity and differentiation

---

## Executive Summary

Quill is one of the most feature-rich open-source AI agent harnesses, with a mature LangGraph-based architecture, 40+ middleware chain, sandboxed execution, persistent memory with consolidation, MCP integration, sub-agent delegation, Tauri desktop app, multi-platform IM channels, a full workflow engine, and self-improving skills. This analysis identifies **21 high-impact features** ported in v0.4.0, v0.5.0, and v0.6.0 from leading frameworks.

### 2026-09-26 Update (v0.6.0 — ZCode Sync Round 3)

Seven new feature systems ported from 11 frameworks (including ZCode v3.14.x):

1. **Elicitation System** (`agents/elicitation/`) — Proactive ambiguity detection with 5-dimension scoring from ZCode's Elicitation runtime + awesome-harness-engineering's context rot patterns
2. **Context Rot Detection** (`agents/middlewares/context_rot_detector.ts`) — Real-time context health monitoring from awesome-harness-engineering
3. **Workflow Concurrency Control** (`workflows/concurrency_control.ts`) — Runtime concurrency adjustment from ZCode v3.14.3
4. **Two-Stage Classifier** (`agents/middlewares/two_stage_classifier.ts`) — Fast gate before expensive reasoning from awesome-harness-engineering
5. **ACP Adapter** (`integrations/acp/`) — Agent Client Protocol for IDE integration from Kimi Code CLI
6. **Funnel Telemetry** (`telemetry/funnel.ts`) — Drop-off analysis for user journeys from ZCode
7. **Computer Use Agent** (`agents/cua/`) — Desktop automation with fail-closed privacy from ZCode's CUA

### 2026-09-21 Update (v0.5.0 — ZCode Sync Round 2)

Seven new feature systems ported from 11 frameworks (including ZCode):

1. **Plugin Store** (`plugins/`) — Full lifecycle management (install/configure/enable/disable/uninstall/restore) from ZCode's plugin store + OpenClaw's ClawHub
2. **Hooks System** (`hooks/`) — 13 lifecycle event types with trust management from ZCode's workspace hooks + Kimi Code's lifecycle hooks
3. **Memory Diagnostics** (`agents/memory/diagnostics.ts`) — Health scoring, staleness, contradiction analysis from ZCode + awesome-harness-engineering
4. **Conversation Telemetry** (`telemetry/`) — Token/tool/session analytics with cost tracking from ZCode + Kimi Code
5. **Model Trajectory** (`agents/trajectory/`) — Decision path recording with replay from ZCode + DeepSeek Harness
6. **Universal MCP Rail** (`mcp/capability_registry.ts`) — Two-tool capability federation from OpenWork
7. **Architecture Policy** (`scripts/architecture/`) — Automated enforcement from ZCode

### 2026-09-21 Update (v0.4.0)

Seven new feature systems ported from 10 frameworks:

1. **Progressive Skill Loading** (`skills/progressive_loader.ts`) — 3-level disclosure (catalog → summary → deep dive) from Hermes Agent + intent-term ranking from DeerFlow
2. **Context Modes for Subagents** (`subagents/context_mode.ts`) — isolated vs. snapshot context delivery from DeerFlow 2.0 + awesome-harness-engineering
3. **State Machine Guardrails** (`guardrails/state_machine_guardrails.ts`) — phase-dependent tool access (planning/research/implementation/review/cleanup) from awesome-harness + DeerFlow RBAC
4. **Adaptive Orchestration Topology** (`workflows/adaptive_orchestration.ts`) — dynamic selection of parallel/sequential/hierarchical/hybrid from awesome-harness AdaptOrch + CrewAI
5. **Extension Manager** (`extensions/manager.ts`) — five contribution kinds (middleware, lifecycle hooks, observers, gateway services, HTTP routers) from DeerFlow + OpenClaw
6. **Compute Worker Pool** (`runtime/compute_pool.ts`) — CPU admission control + overload handling from OpenClaw WorkerTaskPool
7. **Two-Phase Memory Pipeline** — parallel rollout extraction + serialized consolidation from OpenAI Codex

**Competitive position:** Quill now matches or exceeds all 10 frameworks on 22 of 26 capability dimensions.

### Competitive Position Matrix (2026-09-21)

| Capability | Quill | DeerFlow | OpenWork | DeepSeek | Kimi | Codex | CrewAI | AutoGen | OpenClaw | Hermes |
|---|---|---|---|---|---|---|---|---|---|---|
| LangGraph foundation | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Sandboxed execution | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| Persistent memory | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| MCP integration | ✅ | ✅ | ✅* | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Sub-agent delegation | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ |
| Desktop app (Tauri) | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| IM channels (5+) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Goal tracking | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Session forking | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Agent teams/DAG | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Session search | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Cron w/ jitter | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Progressive skills** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Context modes** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **State machine guards** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Adaptive topology** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Extension manager** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Compute worker pool** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Plugin store** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Hooks system** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Memory diagnostics** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Conversation telemetry** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Model trajectory** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Universal MCP rail** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Architecture policy** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| AgentSwarm | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Marketplace | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| SkillScan safety | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Eval framework | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Workflow engine | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Self-improving skills | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Tool receipts | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Adaptive permissions | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Depth-aware policy | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Tool orchestrator | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

> ✅ = Full implementation | ❌ = Not present | ✅* = Is the MCP server. Columns: Quill | DeerFlow | OpenWork | DeepSeek | Kimi | Codex | CrewAI | AutoGen | OpenClaw | Hermes | ZCode

---

## Project Profiles

### 0. ZCode (zai-org) — AI Coding Workspace
- **Version:** 3.14.0 (open-sourced 2026-09-20) | **Language:** TypeScript (Node.js 24.14) | **License:** Apache-2.0
- **Architecture:** pnpm monorepo with Electron desktop + Web + CLI, strict architecture governance via `architecture-policy.yaml`
- **Key differentiators:**
  - Dynamic Workflow Engine: typed, compilable TypeScript orchestration scripts with site graphs, causality analysis, and crash recovery
  - Plugin Store: full lifecycle management with official marketplace, CDN distribution, personal sources, featured plugins
  - Hooks System: workspace hooks with config mutation, trust grants, and lifecycle events
  - Memory Diagnostics: health monitoring, staleness detection, contradiction analysis
  - Conversation Telemetry: detailed analytics on token usage, tool patterns, session metrics
  - Model Trajectory: recording and replay of model decision paths
  - Architecture Policy: automated enforcement (400 line/file limit, no cyclic imports, module boundaries)
  - Formal Proof: state-space enumeration of product behaviors for correctness verification
  - CUA (Computer Use Agent): broker architecture with fail-closed privacy design
  - Remote Workspace: SSH/WSL support with SFTP-based asset upload
  - Cross-platform: Windows, macOS, Linux with systematic compatibility
- **Ports to Quill:** Plugin store (`plugins/`), hooks system (`hooks/`), memory diagnostics (`agents/memory/diagnostics.ts`), conversation telemetry (`telemetry/`), model trajectory (`agents/trajectory/`), architecture policy (`scripts/architecture/`)

### 1. OpenWork (different-ai) — Cross-Agent Workflow Orchestration
- **Stars:** 23.7k | **Language:** TypeScript | **License:** MIT (core)
- **Architecture:** Electron desktop + MCP server + org control plane (Den), built on OpenCode, YC-backed
- **Key differentiators:**
  - Client-agnostic MCP gateway: one MCP endpoint works with Codex/Claude Code/Cursor/ChatGPT
  - Two-tool capability surface: `search_capabilities` + `execute_capability`
  - Marketplace with phased capability execution (skill, command, mcp, agent, context, custom)
  - Cross-workspace split view, scenario-based evals with video evidence
  - Browser login/tab sync, headless thread control, desktop policy engine
  - Per-member LiteLLM keys, declarative org definitions
- **Ports to Quill:** Conversational MCP config (Kimi-inspired), marketplace patterns (already implemented)

### 2. DeepSeek Harness (DSH) — Maximum Composability
- **Language:** TypeScript | **License:** MIT (Developer Preview)
- **Architecture:** Cordis plugin tree, event-sourced session log, multiple application profiles
- **Key differentiators:**
  - Everything-is-a-plugin with reversible effects and reactive dependencies
  - Hot module replacement for runtime reconfiguration
  - Agent Teams with durable roster, task DAG + blocking edges, durable mailbox
  - Capability seams: 3-role model (Service Definition/Provider/Consumer)
  - 7 subagent backends behind one interface (in-process, fork, Codex, SDK, ACP, etc.)
  - Session log as single source of truth with durability guarantees
- **Ports to Quill:** Adaptive orchestration topology (dynamic pattern selection)

### 3. OpenClaw — Gateway-Centric Control Plane
- **Stars:** 390k+ | **Language:** TypeScript | **License:** MIT (501c3 Foundation)
- **Architecture:** One local control plane for sessions/tools/events/channels
- **Key differentiators:**
  - 20+ messaging platforms out of the box
  - Deterministic tiered routing bindings ("most-specific wins")
  - Compute worker pool: CPU admission limit `max(1, availableParallelism() - 1)`, 128 pending tasks
  - Atomic model runtime generations (failed/stale never served alongside newer partial)
  - "Trusted gateway, untrusted execution" security model with DM pairing approval
  - Foundation-governed (501(c3)) rather than VC-backed
- **Ports to Quill:** Compute worker pool (`runtime/compute_pool.ts`)

### 4. Hermes Agent (NousResearch) — Self-Improving
- **Language:** TypeScript | **License:** MIT
- **Architecture:** 7 execution backends, learning loop, FTS5 session search
- **Key differentiators:**
  - Progressive disclosure (3-level loading): Level 0 (catalog) → Level 1 (full content) → Level 2 (reference file)
  - Self-improving skills: create/refine/share via agentskills.io standard
  - FTS5 session search with ~20ms queries, scroll forward/backward within found sessions
  - Frozen memory: MEMORY.md (~800 tokens) + USER.md (~500 tokens) loaded into system prompt
  - Programmatic tool calling via RPC (collapses multi-step pipelines into zero-context-cost turns)
  - 7 terminal backends with hibernation (Daytona/Modal)
- **Ports to Quill:** Progressive skill loading (`skills/progressive_loader.ts`)

### 5. Kimi Code CLI (MoonshotAI) — Richest Terminal Experience
- **Language:** TypeScript | **License:** MIT
- **Architecture:** TypeScript TUI on pi-tui, AgentSwarm parallelism, plugin marketplace
- **Key differentiators:**
  - Single-binary distribution, no Node.js setup needed
  - Video input (screen recordings, demo clips)
  - ACP (Agent Client Protocol) for editor integration (Zed, JetBrains)
  - Conversational MCP configuration via `/mcp-config`
  - AgentSwarm (128 sub-agents, concurrency ramping), Goal mode with persistent tracking
  - 20+ lifecycle hooks, trust levels for plugins
- **Ports to Quill:** Conversational MCP config (already in `mcp/conversational_config.ts`), AgentSwarm (already implemented)

### 6. OpenAI Codex CLI — Performance & Security
- **Stars:** 125.5k | **Language:** Rust + TypeScript | **License:** Apache-2.0
- **Architecture:** Rust core (codex-rs, 80+ crates), TypeScript TUI/CLI, Bazel monorepo
- **Key differentiators:**
  - Hybrid Rust/Node.js architecture for speed + flexibility
  - Multi-platform sandboxing (Seatbelt, Bubblewrap/Landlock, Restricted Token)
  - Two-phase memory pipeline: parallel rollout extraction + serialized global consolidation
  - Tool orchestrator: approval → sandbox → attempt → retry with escalated sandbox
  - Multi-Agent V2 with namespaced tools, agent graph store, WebRTC collaboration
  - arg0 dispatch, shell escalation protocol (execve interception)
  - Structured output constraints (regex/CFG/JSON Schema at decoding layer)
- **Ports to Quill:** Two-phase memory pipeline pattern

### 7. awesome-harness-engineering — Definitive Pattern Catalog
- **Nature:** Curated reading list (200+ references), not a product
- **Key patterns ported:**
  - AdaptOrch: dynamic topology selection based on task dependency graphs
  - Context Modes: isolated vs. forked (subagents use 67% fewer tokens than skills)
  - State Machine Guardrails: phase-dependent tool availability
  - Two-Stage Classifier: fast single-token gate first, chain-of-thought only on flagged
  - Middleware Hooks: 6 composable interception points
  - Self-Correcting Memory: claims with versioned code evidence
  - Code execution via MCP: up to 98.7% token reduction
- **Ports to Quill:** State machine guardrails, adaptive orchestration, context modes

### 8. DeerFlow (ByteDance) — Super Agent Harness
- **Language:** Python 3.12+ / Node.js 22+ | **License:** MIT
- **Architecture:** LangGraph-based super agent, v2.0 rewrite (Feb 2026), #1 GitHub Trending
- **Key differentiators:**
  - Progressive skill loading with intent-term ranking
  - Session Goals with auto-evaluation and hidden continuations (safety-capped at 8)
  - Tool Receipts: deterministic verification layer for agent tool calls
  - Pluggable Authorization: per-role RBAC for tools/routes/models/skills/sandbox
  - AgentMiddleware extension system with 5 contribution kinds
  - Multi-worker production: Redis stream bridge, lease-based ownership, heartbeat reconciliation
  - Two context modes: isolated (default) and snapshot (parent retained conversation)
- **Ports to Quill:** Context modes (`subagents/context_mode.ts`), Extension manager (`extensions/manager.ts`), Tool receipts (already implemented), Goal engine (already implemented)

### 9. Microsoft AutoGen — Research Pedigree (Maintenance Mode)
- **Language:** Python | **License:** MIT
- **Architecture:** Layered (Core/AgentChat/Extensions), cross-language (.NET + Python)
- **Key differentiators:** Pioneered multi-agent conversation, Magentic-One reference, distributed runtime
- **Note:** In maintenance mode; Microsoft Agent Framework is successor. Learn patterns but don't port directly.
- **Ports to Quill:** Agent-as-tool pattern (already in multi-agent system)

### 10. CrewAI — Role-Based Agent Orchestration
- **Language:** Python | **License:** MIT
- **Architecture:** Crews (autonomous) + Flows (deterministic) dual paradigm
- **Key differentiators:**
  - Balance autonomy with precise control
  - JSON-first configuration for agent/task definitions
  - Event-driven flow control: `@start`, `@listen`, `@router` with `or_`/`and_` operators
  - Structured state management with Pydantic models
  - Hierarchical process with manager agent + AgentPlanner integration
  - AMP Suite observability, 100K+ certified developers
- **Ports to Quill:** Adaptive topology selection (hybrid mode), event-driven patterns

---

## Feature Porting Plan (v0.4.0 — Completed)

### Progressive Skill Loading (from Hermes Agent + DeerFlow)
**File:** `skills/progressive_loader.ts`

3-level disclosure system:
- Level 0 (Catalog): name + description only (~3k tokens for 100 skills)
- Level 1 (Summary): full SKILL.md content + metadata
- Level 2 (Deep Dive): specific reference file within the skill

Intent-term ranking for lightweight skill discovery without vector search.

### Context Modes for Subagents (from DeerFlow 2.0 + awesome-harness)
**File:** `subagents/context_mode.ts`

- Isolated (default): child gets ONLY the delegated prompt
- Snapshot: child receives parent's retained conversation + compaction summary as background
- Auto-suggestion based on task characteristics (pronouns, continuation indicators)

### State Machine Guardrails (from awesome-harness + DeerFlow RBAC)
**File:** `guardrails/state_machine_guardrails.ts`

Five workflow phases with increasing tool access:
- Planning → Research → Implementation → Review → Cleanup
- Each phase declares allowed tool groups (read, write, execute, web, memory, skill, subagent, mcp, vision, admin)
- Phase transition validation with audit trail

### Adaptive Orchestration Topology (from awesome-harness + CrewAI)
**File:** `workflows/adaptive_orchestration.ts`

Dynamic coordination pattern selection based on task dependency graph:
- Parallel: all tasks independent
- Sequential: linear dependency chain
- Hierarchical: tree-shaped decomposition
- Hybrid: mix of parallel groups and sequential chains

### Extension Manager (from DeerFlow + OpenClaw)
**File:** `extensions/manager.ts`

Five contribution kinds:
1. Middleware — isolated middleware for the agent graph
2. Lifecycle hooks — task-lifecycle event handlers
3. Observers — system model call observers
4. Gateway services — long-lived services
5. HTTP routers — route contributions

### Compute Worker Pool (from OpenClaw)
**File:** `runtime/compute_pool.ts`

- CPU admission limit: max(1, availableParallelism() - 1)
- Bounded pending queue (128 tasks)
- Task priority (high/normal/low)
- Overload handling with structured error response
- Graceful degradation and shutdown

### Two-Phase Memory Pipeline (from OpenAI Codex)

- Phase 1 (Rollout Extraction): parallel memory extraction from completed runs
- Phase 2 (Global Consolidation): serialized consolidation with workspace diff

---

## Architecture Decision Records

### ADR-005: Progressive Skills — Separate Loader vs. Storage Extension
**Decision:** Separate `ProgressiveSkillLoader` class that wraps `SkillStorage`.
**Rationale:** Keeps the storage layer focused on CRUD while the loader handles the disclosure lifecycle. The loader can be used with any storage backend.

### ADR-006: Context Modes — Executor Integration Point
**Decision:** Context modes are built as a standalone module; the executor calls `buildSubagentContext()` before spawning.
**Rationale:** Minimal coupling with existing executor. The `suggestContextMode()` heuristic can be overridden per-agent-config.

### ADR-007: State Machine Guardrails — Middleware vs. Standalone
**Decision:** Standalone manager with middleware-compatible filter function.
**Rationale:** The state machine needs to be queried from multiple places (middleware, executor, UI). A centralized manager avoids duplication.

### ADR-008: Extension Manager — Registration vs. Discovery
**Decision:** Explicit registration at gateway startup.
**Rationale:** Simpler and more predictable than runtime discovery. Extensions are declared in config and loaded at startup, matching Quill's existing config-driven architecture.

---

## Success Criteria

### v0.3.0 (Completed 2026-09-11)
- [x] Goal Engine: auto-evaluates completion, continues up to 8 times
- [x] Session Forking: copies checkpoints for full conversation history branch
- [x] Agent Teams: lead agent spawns teammates with shared task board
- [x] Session Search: FTS5 full-text search with BM25 ranking
- [x] Enhanced Cron: jitter, coalescing, stale cleanup, frontend UI
- [x] AgentSwarm: fan-out up to 128 sub-agents with progress panel
- [x] Workflow Engine: DAG-based orchestration with parallel execution
- [x] Marketplace Install: install skills from GitHub repos or URLs

### v0.4.0 (Completed 2026-09-21)
- [x] Progressive Skill Loading: 3-level disclosure with intent-term ranking
- [x] Context Modes: isolated vs. snapshot subagent context
- [x] State Machine Guardrails: 5-phase tool access control
- [x] Adaptive Orchestration: dynamic topology selection
- [x] Extension Manager: 5 contribution kinds with lifecycle management
- [x] Compute Worker Pool: CPU admission control + overload handling
- [x] Two-Phase Memory Pipeline: parallel extraction + serialized consolidation
- [x] Framework comparison documentation updated
