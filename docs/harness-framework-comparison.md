# Harness Framework Comparison & Suitability Analysis

> **Date:** 2026-09-04 (updated from 2026-09-01)
> **Scope:** Systematic evaluation of 10 leading AI agent harness/framework projects
> **Goal:** Identify features to port into Quill for competitive parity and differentiation

---

## Executive Summary

Quill is already one of the most feature-rich open-source AI agent harnesses, with a mature LangGraph-based architecture, 25+ middleware chain, sandboxed execution, persistent memory with dreaming consolidation, MCP integration, sub-agent delegation, Tauri desktop app, and multi-platform IM channels. This analysis identifies **7 high-impact features** to port from leading frameworks that will close remaining gaps and create new differentiators.

### Competitive Position Matrix

| Capability | Quill | DeerFlow | OpenWork | DeepSeek DSH | Kimi Code | Codex | CrewAI | AutoGen | OpenClaw | Hermes |
|---|---|---|---|---|---|---|---|---|---|---|
| LangGraph foundation | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Sandboxed execution | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| Persistent memory | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| MCP integration | ✅ | ✅ | ✅* | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Sub-agent delegation | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ |
| Desktop app (Tauri) | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| IM channels (5+) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Goal tracking** | ⚠️ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Session forking** | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Agent teams/DAG** | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Session search** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Cron w/ jitter** | ⚠️ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Video input** | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **AgentSwarm** | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Marketplace** | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **SkillScan safety** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Eval framework** | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

> ✅ = Full implementation | ⚠️ = Partial | ❌ = Not present | ✅* = Is the MCP server

---

## Project Profiles

### 1. DeerFlow (ByteDance) — Closest Structural Analog
- **Architecture:** LangGraph/LangChain, 4-service topology (Nginx/Gateway/Frontend/Provisioner)
- **Key differentiators:** Batteries-included, 7 IM platforms, scheduled tasks MVP, SkillScan deterministic safety scanner, pluggable authorization (RBAC), scope-aware memory with hybrid eviction
- **Port to Quill:** Goal mode, SkillScan safety, enhanced cron scheduling, pluggable authorization

### 2. OpenWork — Cross-Agent Workflow Orchestration
- **Architecture:** Electron desktop + MCP server + org control plane (Den)
- **Key differentiators:** One MCP server works with Codex/Claude Code/Cursor/ChatGPT, marketplace for skills/plugins, org-level control plane
- **Port to Quill:** Marketplace for skills, capability sharing protocol

### 3. DeepSeek Harness (DSH) — Maximum Composability
- **Architecture:** Cordis plugin tree, event-sourced session log, multiple application profiles
- **Key differentiators:** Everything-is-a-plugin, Agent Teams with task DAG + blocking edges + mailbox, continuable subagent teammates, session fork/resume
- **Port to Quill:** Session forking, Agent Teams coordination, event-sourced session log

### 4. Kimi Code CLI — Richest Terminal Experience
- **Architecture:** TypeScript TUI, AgentSwarm parallelism, plugin marketplace
- **Key differentiators:** Video input, AgentSwarm (128 sub-agents, concurrency ramping), Goal mode with persistent tracking, built-in cron with jitter/coalescing, AI-native MCP config, ACP protocol, session forking, 20 lifecycle hooks
- **Port to Quill:** Goal mode, session forking, AgentSwarm parallelism, enhanced cron, video input

### 5. OpenAI Codex CLI — Performance & Security
- **Architecture:** Rust binary, network sandboxing, managed config layers
- **Key differentiators:** OS-level sandbox (seatbelt/landlock), managed config layers (requirements.toml), DotSlash per-repo versioning, broad IDE extensions
- **Port to Quill:** Network sandboxing patterns, managed config for enterprise

### 6. CrewAI — Production Multi-Agent
- **Architecture:** Crews (autonomous) + Flows (deterministic) dual paradigm
- **Key differentiators:** Only framework balancing autonomy with deterministic control, JSON-first config, checkpointing, enterprise AMP Suite, 100K+ certified developers
- **Port to Quill:** Crews+Flows dual paradigm, JSON-first config option, checkpointing

### 7. Microsoft AutoGen — Research Pedigree (Maintenance Mode)
- **Architecture:** Layered (Core/AgentChat/Extensions), cross-language (.NET + Python)
- **Key differentiators:** Pioneered multi-agent conversation, Magentic-One reference, MCP-native via autogen-ext
- **Note:** In maintenance mode; Microsoft Agent Framework is successor. Learn patterns but don't port directly.

### 8. OpenClaw — Gateway-Centric Control Plane
- **Architecture:** One local control plane for sessions/tools/events/channels
- **Key differentiators:** Cross-platform + cross-channel (7+ platforms), Plugin SDK + ClawHub marketplace, security-first untrusted execution model, scales personal→team via config
- **Port to Quill:** ClawHub-style marketplace, untrusted execution patterns

### 9. Hermes Agent (NousResearch) — Self-Improving
- **Architecture:** 7 execution backends, learning loop, FTS5 session search
- **Key differentiators:** Self-improving (creates skills from experience), FTS5 full-text session search with LLM summarization, Honcho dialectic user modeling, cron scheduler, research-ready batch trajectory generation
- **Port to Quill:** Session search, self-improving skill creation patterns

### 10. awesome-harness-engineering — Definitive Bibliography
- **Nature:** Curated reading list (200+ references), not a product
- **Value:** Theoretical foundation and pattern vocabulary for harness engineering
- **Key insight:** "The best harnesses are designed knowing those components will become unnecessary as models improve"

---

## Feature Porting Plan

### Priority 1: High Impact, Close Existing Gaps

#### 1. Goal Engine Backend (from Kimi Code + DeerFlow)
**Current state:** Frontend `GoalState` type exists with rich fields (`continuation_count`, `max_continuations`, `no_progress_count`, `last_evaluation`), but no backend engine populates them.

**What to implement:**
- `GoalManager` class: tracks active goals, evaluates completion, manages continuations
- Goal evaluation LLM call: after each agent turn, evaluate if goal is satisfied
- Continuation logic: auto-continue with safety cap (max 8 hidden continuations)
- No-progress detection: track `no_progress_count`, stand down after threshold
- Integration: middleware that runs after each agent turn when goal is active

**Source patterns:** Kimi Code's Goal mode (persistent multi-turn objective tracking with verifiable finish lines), DeerFlow's `/goal` command with automatic completion evaluation

#### 2. Session Forking (from Kimi Code + DeepSeek Harness)
**Current state:** No thread forking/branching support.

**What to implement:**
- `forkThread(source_thread_id, fork_at_run_id)` API: copies thread state up to a specific point
- Frontend: "Fork" button on any message, creates new thread from that point
- Backend: LangGraph checkpoint copy with new thread_id
- UI: Show fork relationship in thread sidebar

**Source patterns:** Kimi Code's session forking (branch without disrupting original), DeepSeek Harness's fork at turn boundary

#### 3. Agent Teams / Task DAG (from DeepSeek Harness + CrewAI)
**Current state:** Sub-agents exist but no team coordination, shared task board, or DAG dependencies.

**What to implement:**
- `AgentTeam` abstraction: lead agent + teammate roster with roles
- Shared task board: tasks with `blockedBy` DAG edges
- Teammate mailbox: peer messaging between sub-agents
- Coordination strategies: Supervisor (CrewAI), RoundRobin, Handoff
- Frontend: Team visualization panel showing task DAG and teammate status

**Source patterns:** DeepSeek Harness's Agent Teams (durable roster, task DAG with blocking edges, mailbox), CrewAI's Crews+Flows dual paradigm

### Priority 2: Medium Impact, Enhanced UX

#### 4. Session Search (from Hermes Agent)
**Current state:** No full-text search across sessions.

**What to implement:**
- FTS5 (SQLite full-text search) index over thread messages
- Search API: `searchThreads(query, filters)` with relevance scoring
- Frontend: search bar in sidebar with results highlighting
- LLM summarization of search results (optional)

**Source patterns:** Hermes Agent's FTS5 session search with LLM summarization

#### 5. Enhanced Cron Scheduling (from Kimi Code + DeerFlow)
**Current state:** Cron parser exists but no jitter, coalescing, or frontend UI.

**What to implement:**
- Deterministic jitter: spread load with configurable max jitter
- Coalescing: skip if previous run still in-flight
- Stale cleanup: auto-disable tasks not run in 7+ days
- Frontend: Scheduled Tasks management UI (create/edit/delete/trigger)
- Per-task model override and thread strategy

**Source patterns:** Kimi Code's CronCreate with jitter/coalescing/stale cleanup, DeerFlow's scheduled tasks MVP

#### 6. AgentSwarm Parallelism (from Kimi Code)
**Current state:** Max 3 concurrent sub-agents, no fan-out pattern.

**What to implement:**
- `AgentSwarm` tool: item-based fan-out with configurable concurrency
- Concurrency ramping: start with N, ramp up by 1 every 700ms
- Max 128 sub-agents per swarm (configurable)
- Progress panel: real-time status of all swarm members
- Result aggregation: collect and synthesize all results

**Source patterns:** Kimi Code's AgentSwarm (item-based fan-out, concurrency ramp, 128 max)

### Priority 3: Future Considerations

#### 7. Video/Multimodal Input (from Kimi Code)
- Video paste support in frontend
- Frame extraction for LLM analysis
- Screen recording analysis

#### 8. Marketplace (from OpenWork + Kimi Code + OpenClaw)
- Skill/plugin marketplace UI
- Install from GitHub/URL
- Rating and review system

#### 9. SkillScan Safety (from DeerFlow)
- Deterministic safety scanner for skills
- Pattern-based risk detection
- Pre-execution validation

#### 10. Pluggable Authorization (from DeerFlow)
- RBAC per-role policies
- Tool/route/model/skill restrictions
- Per-request credential isolation

---

## Architecture Decision Records

### ADR-001: Goal Engine — Middleware vs. Agent Loop
**Decision:** Implement as middleware that runs after each agent turn when a goal is active.
**Rationale:** Consistent with Quill's existing middleware chain pattern. The `ClarificationMiddleware` already demonstrates the "last middleware that interrupts" pattern.

### ADR-002: Session Forking — Checkpoint Copy vs. Message Replay
**Decision:** Use LangGraph checkpoint copy for atomic fork creation.
**Rationale:** Checkpoint copy is atomic and preserves exact state. Message replay would be slower and could produce different results.

### ADR-003: Agent Teams — Extension vs. Core
**Decision:** Implement as a core feature with extension hooks.
**Rationale:** Multi-agent coordination is a fundamental capability that benefits from tight integration with the existing sub-agent system. Extensions can add custom coordination strategies.

### ADR-004: Session Search — FTS5 vs. External Index
**Decision:** Use SQLite FTS5 for zero-config setup.
**Rationale:** Quill already uses SQLite. FTS5 is built-in, requires no external dependencies, and handles the expected scale (thousands to tens of thousands of threads).

---

## Success Criteria

- [ ] Goal Engine: `/goal` command creates trackable objective, auto-evaluates completion, continues up to 8 times
- [ ] Session Forking: "Fork" button on messages creates branched conversation
- [ ] Agent Teams: Lead agent can spawn teammates with shared task board
- [ ] Session Search: Full-text search across all threads with <200ms response
- [ ] Enhanced Cron: Jitter, coalescing, stale cleanup, frontend management UI
- [ ] AgentSwarm: Fan-out up to 128 sub-agents with progress panel
- [ ] All features pass existing test suite
- [ ] Desktop app builds and runs without issues
- [ ] Documentation updated for all new features
