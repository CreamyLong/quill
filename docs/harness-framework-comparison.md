# Harness Framework Comparison & Suitability Analysis

**Date**: 2026-09-01 (updated from 2026-08-31)
**Purpose**: Evaluate the latest agent harness frameworks and identify improvements for Quill.

## Executive Summary

Quill is a mature LangGraph-based super agent system with a comprehensive middleware chain (25+ middlewares), subagent delegation, sandbox execution, memory, skills, MCP integration, and IM channels. Our research shows Quill is already at the forefront of harness engineering, but several patterns from DeerFlow 2.0 (our direct upstream), OpenClaw, OpenWork, DeepSeek Harness, Kimi Code, and the broader harness engineering community can further strengthen it.

**Key Finding**: The 2026 harness engineering landscape has shifted toward **plugin-based architectures** (DeepSeek's Cordis, DeerFlow's extension manager), **durable task runtimes** for long-running MCP work, **context engineering** over specialized tooling, and **eval-driven development** as the primary performance lever. Quill already implements many of these patterns but can deepen them.

## Framework Comparison Matrix

| Dimension | Quill (Current) | DeerFlow 2.0 | OpenClaw | OpenWork | DeepSeek Harness | Kimi Code | Codex/OpenAI |
|-----------|-----------------|--------------|----------|----------|------------------|-----------|--------------|
| **Core Runtime** | LangGraph (TS+Python) | LangGraph (TS+Python) | Custom Gateway | Electron + MCP | Cordis (plugin-based) | Custom loop | Custom (Rust+TS) |
| **Middleware Chain** | 25+ middlewares | 25+ middlewares (similar) | Plugin SDK | N/A | Event-based pipeline | Lifecycle hooks | Hooks (SessionStart, PreToolUse, PostToolUse) |
| **Plugin Architecture** | Extension loader + registry | Python plugin loader + PEP 621 entry points | Plugin SDK + ClawHub | Plugin marketplace | Everything-is-a-plugin (Cordis) | Plugin ecosystem | N/A |
| **Subagent System** | Thread-pool executor, 3 concurrent | Similar + durable MCP tasks | N/A | N/A | Subagent providers + Agent Teams | coder/explore/plan variants | Sandbox-native |
| **Sandbox** | Local + AIO Docker | Local + AIO Docker + E2B | Host + optional sandbox | N/A | ctx.sandbox backend | N/A | Native OS sandbox |
| **Memory** | File-based, LLM extraction | DeerMem with eviction policies | File-based | N/A | Session log as source of truth | N/A | Minimal |
| **Skills** | SKILL.md, slash activation, SkillScan | SKILL.md + review_skill_package + SkillScan | Plugins + ClawHub | Capability marketplace | dsh-plugin ecosystem | Skills + MCP + data sources | N/A |
| **MCP** | Multi-server, OAuth, stdio path translation | + Durable task runtime (mcp_tasks) | Remote MCP | OpenWork MCP | ctx.tools registry | Conversational MCP config | N/A |
| **Extensions** | Community tools + extension loader | Python plugin loader + registry + 5 contribution kinds | Plugin SDK + ClawHub | Plugin marketplace | Capability seams (Service/Provider/Consumer) | Plugin marketplace | N/A |
| **IM Channels** | Feishu, Slack, Telegram, Discord, DingTalk | Similar | WhatsApp, Signal, iMessage, Google Chat | N/A | Webhook + ACP | N/A | N/A |
| **Scheduled Tasks** | Cron/interval scheduler | + Multi-instance lease recovery | Cron/heartbeat | Automations engine | ctx.jobs | N/A | N/A |
| **Benchmarking** | scripts/benchmark/ (memory_eviction) | scripts/benchmark/ with reproducible evals | N/A | N/A | N/A | N/A | Internal evals |
| **Context Engineering** | Summarization + durable context | + Manual context compaction | N/A | N/A | Session log projection | N/A | Plan.md/Implement.md |
| **Multi-model** | Single model per run | + Compound multi-model patterns | Multi-provider | N/A | ctx.llm adapter seam | N/A | Single model |
| **Security** | Guardrails, sandbox audit, env scrub | + review_skill_package, thread-boundary detection | 5-layer defense-in-depth | Pairing/approval | Approval policy + sandbox | N/A | OS-level permissions |
| **Protocols** | HTTP/SSE MCP | + Streamable HTTP | N/A | MCP | ACP + SDK JSON-RPC | ACP | Item/Turn/Thread JSON-RPC |

## Detailed Analysis

### 1. DeerFlow 2.0 (bytedance/deer-flow) — **Highest Priority** ⭐ 81K stars

DeerFlow 2.0 shares its core architecture with Quill (both are LangGraph-based super agent systems with nearly identical AGENTS.md structures). The 2.0 rewrite introduces several production-grade features:

#### New Features to Adopt:

**a) Extension System v2** (`extensions/`)
- Python plugin loader with registry, placement, and isolation
- **Five contribution kinds**: middleware, lifecycle hooks, observers, Gateway services, HTTP routers
- Managed via `make extension-install/list/enable/disable/remove`
- PEP 621 entry points: `[project.entry-points."deerflow.extensions"]`
- `deerflow-extension-api` contract with no framework dependencies
- Quill already has a basic extension loader; needs the 5 contribution kinds

**b) Durable MCP Task Runtime** (`mcp_tasks`)
- Long-running MCP work uses a separate durable task runtime
- Lease-based claim/cancel/poll lifecycle with dead-letter handling
- Prevents blocking the agent loop on slow remote operations
- Database is source of truth; ThreadState receives bounded projection
- **Not yet implemented in Quill** — highest priority addition

**c) DeerMem with Eviction Policies**
- `select_facts_for_capacity()` implements confidence-based + hybrid-v1 eviction
- Benchmarked against LongMemEval dataset
- Prevents unbounded memory growth in long-running agents
- Quill's memory system has no eviction policy yet

**d) Integration Installers** (`integrations/`) ✅ Already implemented
- Managed first-party integration installers (e.g., Lark CLI skill pack)
- Standardized pattern for bundling skills + MCP configs
- Quill has `integrations/lark/` with the same pattern

**e) Benchmark Framework** (`scripts/benchmark/`) ✅ Already implemented
- Standalone, reproducible backend benchmarks
- Pinned datasets by immutable revision + SHA-256
- Fixed clocks and deterministic ordering for offline selection
- Quill has `scripts/benchmark/memory_eviction/`

**f) Thread-Boundary Detection** (`make detect-thread-boundaries`) ✅ Already implemented
- Inventories backend executor/thread/event-loop boundaries
- Critical for preventing blocking IO on the async event loop
- Quill has `scripts/detect_thread_boundaries.ts`

**g) Package Import Hygiene** ✅ Already implemented
- Heavyweight entrypoints use lazy imports
- Prevents circular imports and reduces startup latency

**h) review_skill_package Tool** ✅ Already implemented
- Validates skill packages before installation
- Security scanning for malicious skill definitions
- Quill has `tools/builtins/review_skill_package.ts`

**i) SkillScan** (NEW in DeerFlow 2.0)
- Deterministic safety scanner for skills (Phase 1: offline, no Semgrep dependency)
- Blocks high-confidence CRITICAL findings (private keys, shell execution)
- LLM-based scanner for contextual review
- Python instance-exfiltration checks with same-scope evidence chain
- Quill has `skills/security_scanner.ts` but could add deterministic phase

**j) Authorization System** (NEW in DeerFlow 2.0)
- Pluggable `AuthorizationProvider` with RBAC
- Per-role tools, routes, models, skills, sandbox allow/deny policies
- Gateway route permissions derived from same provider
- Quill has Guardrails but not full RBAC

**k) Multi-Worker Lease Recovery** (NEW in DeerFlow 2.0)
- Lease heartbeat for run ownership across workers
- Atomic takeover claim with lease re-check
- Sandbox ownership via Redis for multi-worker deployments
- Quill currently single-worker focused

### 2. DeepSeek Harness (deepseek-ai/deepseek-harness) — **High Priority** ⭐ 206K stars

DeepSeek Harness (`dsh`) uses an **everything-is-a-plugin** architecture built on [Cordis](https://github.com/cordiverse/cordis). This is the most architecturally interesting framework in our research.

#### Key Patterns:

**a) Cordis Plugin Framework**
- Every part of the product is a plugin: model adapter, tool registry, session log, agent loop
- No privileged core to patch — extend by mounting plugins beside others
- Registrations are effects that unwind when plugins unload
- **Relevance**: Quill's extension system could evolve toward this model

**b) Profiles and Bundles**
- Named compositions stored in Harness home
- Bundles are distribution formats for Cordis config rows
- Layers apply in order: bundles → profile patch → home patch → CLI overlay
- Live patch reload for development profiles
- **Relevance**: Could enhance Quill's config system for multi-environment deployments

**c) Capability Seams**
- Three roles: Service Definition, Service Provider, Consumer
- One provider swap changes the whole product
- Filesystem/subprocess providers share execution world
- Subagent providers vary behind one interface
- **Relevance**: Quill's sandbox providers already follow this pattern (LocalSandboxProvider, AioSandboxProvider)

**d) Session Log as Source of Truth**
- Append-only SessionEvent log
- Model-visible means logged (runtime invariant)
- Fork, resume, transcripts, telemetry all derive from this stream
- `deriveMessages()` projects model history from log
- **Relevance**: Quill uses LangGraph checkpoints; could add session log projection

**e) Event-Based Extension Points**
- Session events (durable facts), Agent events (live interception), Capability events (policy)
- Waterfall events with `next()` delegation
- Turn flow: turn/start → agent/pre-step → step/start → agent/request → llm/stream → tool/call* → step/end → agent/turn-stopping → turn/end
- **Relevance**: Quill's middleware chain is similar but sequential; event-based could be more flexible

**f) Agent Teams** (Experimental)
- Coordination seam on `ctx.agentTeams`
- Durable roster, task board, mailbox over continuable subagents
- **Relevance**: Quill's subagent system could evolve toward team coordination

### 3. OpenWork (different-ai/openwork) — **Medium Priority** ⭐ 23K stars

OpenWork is a desktop app for sharing AI workflows via MCP. Key patterns:

**a) Capability Marketplace Pattern**
- `search_capability` + `execute_capability` tools
- Standardized interface for discovering and invoking shared capabilities
- Could enhance Quill's skill discovery mechanism

**b) Headless + Desktop Dual Mode**
- Same codebase runs as Electron app or headless web server
- World-based deployment configuration (`worlds/*.ts`)

**c) Organization Management (Den)**
- Admin interface for publishing capabilities, managing access
- Per-user connections and credential management

**Relevance**: The capability marketplace pattern could enhance Quill's skill/MCP discovery, but the desktop app architecture is not directly applicable.

### 4. OpenClaw (openclaw/openclaw) — **Medium Priority** ⭐ 388K stars

OpenClaw is a personal AI assistant that runs on your devices:

**a) Plugin SDK + ClawHub**
- Formal plugin SDK for extending the agent
- ClawHub marketplace for sharing plugins
- More structured than Quill's current community tools approach

**b) Cross-Platform Companion Apps**
- Voice, Canvas, camera, screen, device-local actions
- Node-based architecture for device capabilities

**c) Pairing/Approval Model**
- DM-capable channels pair unknown senders by default
- Explicit approval workflow for new connections

**d) Gateway as Local Control Plane**
- Sessions, tools, events, channel connections managed by Gateway
- CLI, TUI, and Control UI all connect to Gateway

**Relevance**: The plugin SDK pattern and formal marketplace (ClawHub) could enhance Quill's extension ecosystem. The pairing model is a good security pattern for IM channels.

### 5. Kimi Code (moonshotai/kimi-code) — **Medium Priority** ⭐ 7K stars

Kimi Code CLI is positioned as "The Starting Point for Next-Gen Agents":

**a) Feedback-Driven Agent Loop**
- Agent performs actions, selects subsequent steps based on feedback
- Isolated execution contexts for subagents

**b) Built-in Subagents**
- coder, explore, plan variants
- Run in isolated contexts to keep main conversation clean

**c) Lifecycle Hooks**
- Local commands at key lifecycle points
- Gating risky calls, connecting to external automation

**d) ACP Integration**
- `kimi acp` subcommand for ACP-compatible editors (Zed, JetBrains)
- Standardized editor/IDE integration

**e) Video Input Support**
- Screen recordings or demo clips into chat
- Multimodal beyond static images

**f) AI-Native MCP Configuration**
- `/mcp-config` for conversational MCP setup
- No manual JSON editing required

**Relevance**: The conversational MCP configuration and video input are valuable UX patterns. The subagent isolation model aligns with Quill's approach.

### 6. Codex/OpenAI (openai/codex) — **Reference Patterns** ⭐ 120K stars

From the awesome-harness-engineering list and Codex documentation:

**a) Hooks Framework**
- SessionStart, PreToolUse, PostToolUse lifecycle hooks
- Deterministic scripts at loop events (vs. prompt-level trust)
- Quill already has similar lifecycle hooks (middleware chain)

**b) Plan.md / Implement.md / Documentation.md**
- Reusable harness artifacts for long-horizon tasks
- Structured planning before implementation

**c) Item/Turn/Thread Protocol**
- JSON-RPC/JSONL over stdio for client-agent communication
- Purpose-built protocol for approval flows, streaming diffs, thread persistence

**d) 5-Layer Defense-in-Depth Safety**
- Multiple independent safety layers
- Schema-filtered planning subagents

**e) Compound Multi-Model Architecture**
- Different model instances for execution, reasoning, critique, vision
- Quill currently uses single model per run

**Relevance**: The compound multi-model architecture and structured planning artifacts are valuable patterns to consider.

### 7. Awesome Harness Engineering Best Practices (2026)

From the curated list (ai-boost/awesome-harness-engineering, 3.9K stars):

**a) Context Engineering > Specialized Tools**
- Microsoft's Azure SRE Agent finding: exposing everything as files and letting the agent use read_file, grep, find, and shell outperformed specialized tooling
- "Intent Met" score rose from 45% to 75%
- Quill already follows this pattern with its sandbox file tools

**b) Eval-Driven Development**
- "Evals are the training data for harness work"
- Harness-only changes can move agents 20+ ranking positions without swapping the model
- LangChain case study: harness changes moved coding agent from rank 30 to top 5 on Terminal Bench 2.0

**c) Harness Assumptions Expire**
- Every harness component assumes the model can't do something
- Those assumptions expire as models improve
- Regular review of which middlewares are still needed

**d) Natural-Language Agent Harnesses (NLAHs)**
- Externalize control logic as portable artifacts
- Enables inspection, versioning, and transfer of harness design

**e) Eager-Construction Scaffolding**
- Pre-build all components before the first message
- Eliminates first-call latency and race conditions

**f) MCP 2026 Roadmap**
- Stateless protocol core drops `initialize` handshake and `Mcp-Session-Id`
- `.well-known` discovery for capability advertisement
- Tasks primitive with retry/expiry semantics
- Enterprise extensions (audit trails, SSO, gateway behavior)
- **Relevance**: Quill's MCP system should prepare for stateless transport

**g) AG-UI Protocol**
- Lightweight event-driven protocol for agent-to-frontend communication
- Streaming state updates, tool call rendering, HITL interrupts
- **Relevance**: Could enhance Quill's frontend streaming beyond SSE

**h) A2A Protocol**
- Agent-to-Agent protocol: JSON-RPC over HTTP(S)/SSE
- Agent Card service discovery
- **Relevance**: Could enable cross-framework agent interoperability

**i) State Machine Guardrails (statewright)**
- Constrains which tools an agent can call in each phase
- Local models went from 2/10 to 10/10 passing on SWE-bench subset purely by shrinking tool space
- **Relevance**: Could enhance Quill's tool policy system

## Implementation Status in Quill

### ✅ Already Implemented

| Feature | Location | Notes |
|---------|----------|-------|
| Extension loader + registry | `packages/harness/quill/extensions/` | Basic loader, needs 5 contribution kinds |
| Integration installers | `packages/harness/quill/integrations/` | Lark/Feishu CLI skill pack |
| Benchmark framework | `backend/scripts/benchmark/` | Memory eviction benchmark |
| Thread-boundary detection | `backend/scripts/detect_thread_boundaries.ts` | Blocking IO inventory |
| Package import hygiene | `agents/lead_agent/entrypoint.ts` | Lazy imports |
| review_skill_package tool | `tools/builtins/review_skill_package.ts` | Security scanning |
| SkillScan (basic) | `skills/security_scanner.ts` | LLM-based scanner |
| Skills system | `packages/harness/quill/skills/` | SKILL.md, slash activation, tool policy |
| MCP system | `packages/harness/quill/mcp/` | Multi-server, OAuth, path rewrite |
| Memory system | `packages/harness/quill/agents/memory/` | File-based, LLM extraction |
| Subagent system | `packages/harness/quill/subagents/` | Thread-pool executor, 3 concurrent |
| Sandbox system | `packages/harness/quill/sandbox/` | Local + AIO Docker |
| Community tools | `packages/harness/quill/community/` | 17+ providers |
| Scheduled tasks | `packages/harness/quill/scheduling/` | Cron/interval scheduler |
| TUI | `packages/harness/quill/tui/` | Terminal workbench |
| Extension API | `packages/extension-api/` | Public contracts |

### ❌ Not Yet Implemented

| Feature | Priority | Source |
|---------|----------|--------|
| Durable MCP Task Runtime | High | DeerFlow 2.0 |
| Memory Eviction Policies | High | DeerFlow 2.0 (DeerMem) |
| Extension 5 Contribution Kinds | Medium | DeerFlow 2.0 |
| Capability Marketplace Pattern | Medium | OpenWork |
| Structured Planning Artifacts | Medium | OpenAI Codex |
| Authorization System (RBAC) | Medium | DeerFlow 2.0 |
| Session Log as Source of Truth | Low | DeepSeek Harness |
| Agent Teams Coordination | Low | DeepSeek Harness |
| AG-UI Protocol | Low | awesome-harness-engineering |
| A2A Protocol | Low | awesome-harness-engineering |
| Compound Multi-Model | Low | OpenAI Codex |
| Multi-Worker Lease Recovery | Low | DeerFlow 2.0 |

## Recommended Improvements for Quill

### Priority 1: High Impact, Directly Applicable

1. **Add Durable MCP Task Runtime** (`mcp_tasks`)
   - Lease-based claim/cancel/poll lifecycle
   - Database as source of truth
   - Prevents blocking agent loop on slow remote operations
   - Source: DeerFlow 2.0

2. **Add Memory Eviction Policies** (DeerMem pattern)
   - Confidence-based + hybrid-v1 eviction
   - Prevents unbounded memory growth
   - Source: DeerFlow 2.0

3. **Enhance Extension System** (5 contribution kinds)
   - Middleware, lifecycle hooks, observers, Gateway services, HTTP routers
   - Source: DeerFlow 2.0

4. **Add Structured Planning Artifacts** (Plan.md/Implement.md)
   - Reusable harness artifacts for long-horizon tasks
   - Source: OpenAI Codex

### Priority 2: Medium Impact, Strategic

5. **Add Capability Marketplace Pattern**
   - search_capability + execute_capability tools
   - Source: OpenWork

6. **Add Authorization System (RBAC)**
   - Per-role tools, routes, models, skills, sandbox policies
   - Source: DeerFlow 2.0

7. **Add SkillScan Deterministic Phase**
   - Offline security scanning without LLM dependency
   - Source: DeerFlow 2.0

### Priority 3: Long-term, Research

8. **Compound Multi-Model Architecture**
   - Different models for execution, reasoning, critique, vision
   - Source: OpenAI Codex

9. **Session Log as Source of Truth**
   - Append-only event log with projection seam
   - Source: DeepSeek Harness

10. **Agent Teams Coordination**
    - Durable roster, task board, mailbox
    - Source: DeepSeek Harness

11. **AG-UI Protocol Integration**
    - Event-driven agent-to-frontend communication
    - Source: awesome-harness-engineering

## Implementation Plan

The implementation will proceed in phases:

**Phase 1**: Core infrastructure (durable MCP tasks, memory eviction, extension enhancement, planning artifacts)
**Phase 2**: Advanced features (capability marketplace, RBAC, SkillScan deterministic phase)
**Phase 3**: Research items (compound multi-model, session log, agent teams, AG-UI)

## Conclusion

Quill is already a state-of-the-art agent harness. The most valuable improvements come from:
1. **DeerFlow 2.0** (our direct upstream) — durable MCP tasks, memory eviction, extension v2
2. **DeepSeek Harness** — plugin architecture, capability seams, session log
3. **OpenWork** — capability marketplace pattern
4. **OpenAI Codex** — structured planning artifacts
5. **Awesome Harness Engineering** — eval-driven development, context engineering, MCP 2026 roadmap

The broader harness engineering community reinforces that **harness design is the primary performance lever, not model capability**. Eval-driven development, context engineering, and structured safety layers are the key differentiators.
