# 🪶 Quill — Open-Source AI Super-Agent Framework

> **The open-source alternative to OpenAI Codex, Cursor, Claude Code, and DeerFlow.**
> AI agent framework with sandboxed code execution, sub-agent orchestration, MCP, skills marketplace, session forking, FTS5 search, multi-agent teams, and a native Tauri desktop app.

<div align="center">

**English** · [中文](README_zh.md) · [한국어](README_ko.md) · [日本語](README_ja.md) · [Français](README_fr.md) · [Русский](README_ru.md) · [Español](README_es.md) · [العربية](README_ar.md)

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000.svg?logo=next.js&logoColor=white)](https://nextjs.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph-1.x-1C1C1C.svg)](https://langchain-ai.github.io/langgraph/)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-FFC131.svg?logo=tauri&logoColor=white)](https://tauri.app/)
[![MCP](https://img.shields.io/badge/MCP-Protocol-0098FF.svg)](https://modelcontextprotocol.io/)
[![Stars](https://img.shields.io/github/stars/CreamyLong/quill?style=social)](https://github.com/CreamyLong/quill/stargazers)
[![Tests](https://img.shields.io/badge/tests-408%20passed-brightgreen.svg)](./backend/)
[![Downloads](https://img.shields.io/github/downloads/CreamyLong/quill/total)](https://github.com/CreamyLong/quill/releases)

[Website](https://github.com/CreamyLong/quill) · [Docs](./docs/) · [Quick Start](#-quick-start) · [Desktop App](#-desktop-app-tauri-2) · [Skills](./skills/) · [Contributing](./CONTRIBUTING.md)

</div>

---

## 🤔 Why Quill?

Quill is a **super-agent framework** — an AI that can research, code, analyze data, generate documents, and orchestrate sub-agents to do almost anything. Unlike closed-source alternatives, Quill is fully open-source, self-hostable, and extensible.

| Feature | Quill | OpenAI Codex | Cursor | Claude Code | DeerFlow | OpenClaw |
|---|---|---|---|---|---|---|
| **Open source** | ✅ Apache 2.0 | ❌ | ❌ | ❌ | ✅ MIT | ✅ MIT |
| **Self-hosted** | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Sandboxed execution** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Sub-agent orchestration** | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **Desktop app** | ✅ Tauri | ✅ | ✅ | ❌ | ❌ | ❌ |
| **MCP integration** | ✅ Dual-role | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Skills marketplace** | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Session forking** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **FTS5 search** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Multi-agent teams** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Workflow engine** | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Self-improving skills** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Adaptive permissions** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **IM channels (5+)** | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Tool receipts** | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |

---

## ✨ Core Capabilities

### 🔬 Deep Research
Multi-source search with cross-validation and cited reports. Quill orchestrates multiple sub-agents to investigate topics in depth.

### 💻 Sandboxed Code Execution
Safely run Python / Bash / file operations in an isolated sandbox environment with full filesystem access. OS-level security with network isolation.

### 🤖 Sub-Agent Orchestration
Main agent dispatches specialized sub-agents for parallel complex tasks — general-purpose, bash, research, and custom agents. Up to 128 concurrent sub-agents with AgentSwarm.

### 🧩 Skills Marketplace
Install skills to extend capabilities. Build custom extensions with lifecycle hooks (pre_model, post_model, pre_tool, post_tool). Install from GitHub repos or any URL.

### 🔀 Session Forking
Branch any conversation at any point. Forked threads carry full conversation history via checkpoint copy — experiment without disrupting the original.

### 🔍 FTS5 Session Search
BM25-ranked full-text search across all thread messages with snippet extraction and prefix matching. Find any past conversation instantly.

### 🧠 Long-Term Memory & Dreaming
Continuously records user profile and conversation history with confidence-based fact eviction. Background "dreaming" consolidation promotes short-term signals to durable long-term memory.

### 🤝 Multi-Agent Teams
Supervisor, round-robin, handoff, and hierarchical team patterns. Shared task board with DAG dependencies and peer messaging.

### 🔄 Workflow Engine
DAG-based agent orchestration with parallel execution, retry, and conditional branching. Build complex multi-step automations.

### 🛡️ Safety & Guardrails
Tools declare safety properties (read-only, destructive, idempotent, open-world) that feed into risk-level-based authorization. Deterministic security scanner blocks malicious skills offline.

### 💓 Proactive Heartbeat
Periodic agent turns that check whether anything needs attention — with a persistent monitor checklist, active-hours windows, and cost-controlled isolated sessions.

### 🌐 Multi-Model & Multi-Platform
DeepSeek / OpenAI / Anthropic / vLLM / Ollama and more. UI supports 8 languages. IM channels: Telegram, Slack, Discord, Feishu, DingTalk.

### 🖥️ Native Desktop App
Tauri 2 desktop app with native filesystem access, system tray, workspace sync, and auto-updates. Available for macOS, Windows, and Linux.

---

## 🚀 Quick Start

### Option 1: Desktop App (Recommended)

Download the latest release for your platform from the [Releases](https://github.com/CreamyLong/quill/releases) page.

```bash
# macOS
brew install --cask quill  # coming soon

# Or download .dmg/.msi/.AppImage from Releases
```

### Option 2: Local Development

```bash
# Clone the repository
git clone https://github.com/CreamyLong/quill.git
cd quill

# Interactive setup wizard (2 minutes)
make setup

# Start all services with hot-reload
make dev

# Open http://localhost:2126 in your browser
```

### Option 3: Docker

```bash
docker compose up -d
# Open http://localhost:2126
```

### Option 4: Desktop Development

```bash
# One-command desktop (builds frontend, starts Gateway, launches Tauri)
make desktop

# Or manually:
cd desktop
npm install
npm run tauri dev    # first build ~3-5 min, then incremental

# Production build → .dmg/.msi/.AppImage
npm run tauri build
```

---

## 📸 Feature Showcase

### 🔬 Deep Research
Multi-source search with cross-validation and cited reports. Quill orchestrates multiple sub-agents to investigate topics in depth.

### 💻 Code Execution
Safely run Python / Bash / file operations in an isolated sandbox environment with full filesystem access.

### 🤖 Sub-Agent Collaboration
Main agent dispatches specialized sub-agents for parallel complex tasks — general-purpose, bash, and custom agents.

### 🧩 Extensible Skills & Extensions
Install skills to extend capabilities. Build custom extensions with lifecycle hooks (pre_model, post_model, pre_tool, post_tool).

### 🧠 Long-Term Memory & Dreaming
Continuously records user profile and conversation history with confidence-based fact eviction policies. Background "dreaming" consolidation promotes strong short-term signals to durable long-term memory (Light → REM → Deep phases).

### 💓 Proactive Heartbeat
Periodic agent turns that check whether anything needs attention — with a persistent monitor scratch checklist, active-hours windows, and cost-controlled isolated sessions.

### 🛡️ Tool Annotations & Guardrails
Tools declare safety properties (read-only, destructive, idempotent, open-world) that feed into risk-level-based authorization. Deterministic security scanner blocks malicious skills offline before any LLM call.

### 🌐 Multi-Model & Multi-Language
DeepSeek / OpenAI / Anthropic / vLLM / Ollama and more. UI supports English, 中文, and 한국어.

---

## 🏗️ System Architecture

### High-Level Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        WEB[Next.js Frontend<br/>React + Tailwind]
        IM[IM Channels<br/>Telegram, Slack, Discord<br/>Feishu, DingTalk]
        DESK[Desktop App<br/>Tauri 2]
    end

    subgraph "Gateway Layer (Port 8001)"
        GW[Gateway API<br/>LangGraph Runtime]
        SB[Stream Bridge<br/>SSE Delivery]
        RM[Run Manager<br/>Task Lifecycle]
    end

    subgraph "Agent Runtime"
        LA[Lead Agent<br/>StateGraph]
        MW[Middleware Chain<br/>38+ Middlewares]
        SA[Sub-Agent Executor<br/>Thread Pool]
    end

    subgraph "Infrastructure"
        DB[(Database<br/>SQLite / Postgres)]
        SK[Skills System<br/>SKILL.md + Marketplace]
        MCP[MCP Servers<br/>Dual-Role]
        MEM[Memory System<br/>LLM Extraction + Eviction]
    end

    WEB -->|HTTP/SSE| GW
    IM -->|Webhook| GW
    DESK -->|HTTP/SSE| GW
    GW --> LA
    GW --> SB
    GW --> RM
    LA --> MW
    LA --> SA
    LA -->|Tool Calls| MCP
    LA -->|Read/Write| DB
    LA -->|Load/Save| SK
    LA -->|Extract/Inject| MEM
    SA -->|Background| LA
```

### Agent Loop & Middleware Chain

```mermaid
flowchart LR
    START([START]) --> PREP[Prepare<br/>Inject System Prompt]
    PREP --> BM[beforeModel<br/>38+ Hooks]
    BM --> MODEL[Model Call<br/>LLM Inference]
    MODEL --> AM[afterModel<br/>Post-Processing]
    AM --> TOOLS{Tool Calls?}
    TOOLS -->|Yes| EXEC[Execute Tools<br/>Sandbox + MCP]
    EXEC --> AA[afterAgent<br/>State Updates]
    AA -->|Continue| BM
    TOOLS -->|No| END([END])
    AA -->|Finish| END

    style START fill:#4ade80,stroke:#166534
    style END fill:#f87171,stroke:#991b1b
    style MODEL fill:#60a5fa,stroke:#1e40af
    style EXEC fill:#fbbf24,stroke:#92400e
```

### Middleware Pipeline (Lead Agent)

```mermaid
flowchart TB
    subgraph "Input Layer"
        M1[1. Input Sanitization<br/>Prompt Injection Defense]
        M2[2. Tool Output Budget<br/>Size Caps]
        M3[3. Thread Data<br/>Per-Thread Directories]
    end

    subgraph "Context Layer"
        M4[4. Dynamic Context<br/>Date + Memory Reminders]
        M5[5. Skill Activation<br/>/skill-name Slash Commands]
        M6[6. Durable Context<br/>Delegation + Skill References]
    end

    subgraph "Safety Layer"
        M7[7. Guardrail<br/>Pre-Tool Authorization]
        M8[8. Sandbox Audit<br/>Security Logging]
        M9[9. Tool Error Handling<br/>Graceful Recovery]
    end

    subgraph "Model Layer"
        M10[10. LLM Error Handling<br/>Retry + Backoff]
        M11[11. System Message Coalescing<br/>Provider Compatibility]
        M12[12. Deferred Tool Filter<br/>MCP Schema Hiding]
    end

    subgraph "Output Layer"
        M13[13. Summarization<br/>Context Reduction]
        M14[14. Loop Detection<br/>Repetition Breaker]
        M15[15. Token Budget<br/>Per-Run Limits]
        M16[16. Clarification<br/>User Interaction]
    end

    M1 --> M2 --> M3 --> M4 --> M5 --> M6
    M6 --> M7 --> M8 --> M9 --> M10 --> M11 --> M12
    M12 --> M13 --> M14 --> M15 --> M16

    style M1 fill:#dbeafe,stroke:#1e40af
    style M4 fill:#fef3c7,stroke:#92400e
    style M7 fill:#fee2e2,stroke:#991b1b
    style M10 fill:#dcfce7,stroke:#166534
    style M13 fill:#f3e8ff,stroke:#6b21a8
```

### Sub-Agent Delegation Flow

```mermaid
sequenceDiagram
    participant U as User
    participant LA as Lead Agent
    participant EX as Sub-Agent Executor
    participant SA as Sub-Agent
    participant T as Tools

    U->>LA: Send message
    LA->>LA: Model generates tool_call
    LA->>EX: task(description, type)
    EX->>SA: Create sub-agent graph
    loop Execute turns
        SA->>T: Tool calls (bash, read, write)
        T-->>SA: Results
        SA->>SA: Model reasoning
    end
    SA-->>EX: Final result
    EX-->>LA: task_completed event
    LA-->>U: Response with results
```

---

## 📦 Skills & Extensions Ecosystem

Quill ships with 20+ built-in skills: academic review, deep research, data analysis, PPT generation, chart visualization, image / video / music generation, frontend design, GitHub research, newsletter, and more.

**Extensions** enable third-party developers to build plugins that hook into the agent lifecycle:
- `pre_model` / `post_model` — intercept and modify model calls
- `pre_tool` / `post_tool` — intercept and modify tool execution
- `on_agent_start` / `on_agent_end` — setup and cleanup

Connect additional MCP services via `extensions_config.json`.

### Install from Marketplace

```bash
# Install from GitHub repo
curl -X POST http://localhost:8001/skills/marketplace/install \
  -H "Content-Type: application/json" \
  -d '{"source": "github", "target": "owner/repo"}'

# Install from URL
curl -X POST http://localhost:8001/skills/marketplace/install \
  -H "Content-Type: application/json" \
  -d '{"source": "url", "target": "https://example.com/skill.md"}'
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 15 · React 19 · Tailwind CSS · shadcn/ui |
| **Backend** | LangGraph · TypeScript · node:sqlite |
| **Desktop** | Tauri 2 (Rust + WebView) |
| **Database** | SQLite / PostgreSQL · LangGraph Checkpointer |
| **Agent Runtime** | StateGraph · 38+ Middlewares · Sub-Agent Executor |
| **Protocols** | MCP (Model Context Protocol) · SSE · HTTP/SSE/Stdio |

---

## 🌐 Internationalization

Quill supports eight languages:

| Language | Locale | Status |
|----------|--------|--------|
| English | `en-US` | ✅ Complete |
| 中文 (Chinese) | `zh-CN` | ✅ Complete |
| 한국어 (Korean) | `ko-KR` | ✅ Complete |
| 日本語 (Japanese) | `ja-JP` | ✅ Complete |
| Français (French) | `fr-FR` | ✅ Complete |
| Русский (Russian) | `ru-RU` | ✅ Complete |
| Español (Spanish) | `es-ES` | ✅ Complete |
| العربية (Arabic) | `ar-SA` | ✅ Complete |

Switch languages in Settings → Appearance → Language.

---

## 📊 Competitive Analysis

Quill was systematically evaluated against 10 leading harness frameworks. See [harness-framework-comparison.md](./docs/harness-framework-comparison.md) for the full analysis.

**Quill matches or exceeds all 10 frameworks on 18 of 22 capability dimensions.**

| Framework | Stars | LangGraph | Sandbox | Memory | MCP | Sub-Agent | Desktop | Teams | Search |
|---|---|---|---|---|---|---|---|---|---|
| **Quill** | ⭐ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| DeerFlow | ⭐⭐⭐⭐⭐ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| OpenWork | ⭐⭐⭐ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| DeepSeek Harness | ⭐⭐⭐ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ |
| Kimi Code | ⭐⭐⭐⭐ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| OpenAI Codex | ⭐⭐⭐⭐⭐ | ❌ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| CrewAI | ⭐⭐⭐⭐⭐ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| AutoGen | ⭐⭐⭐⭐ | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ |
| OpenClaw | ⭐⭐⭐ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Hermes Agent | ⭐⭐⭐ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |

---

## 🤝 Contributing

Issues and PRs are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

Areas where we especially need help:
- 🌍 **Translations** — help us support more languages
- 🧩 **Skills** — create and share new skills
- 📖 **Documentation** — improve docs, write tutorials
- 🐛 **Bug reports** — file issues with reproduction steps
- ⭐ **Star the repo** — if you find Quill useful, a star goes a long way!

---

## 📜 License

[Apache 2.0](./LICENSE)

---

## ⭐ Star History

If Quill is useful to you, please consider giving it a star! Stars help others discover the project and motivate continued development.

<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=CreamyLong/quill&type=Date)](https://star-history.com/#CreamyLong/quill&Date)

</div>

---

<div align="center">

**Built with ❤️ by the Quill team · Inspired by OpenWork, DeerFlow, OpenClaw, Hermes Agent, Kimi Code, Codex, CrewAI, AutoGen, and awesome-harness-engineering**

</div>
