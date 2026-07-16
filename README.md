# 🪶 Quill

> Open-source AI work assistant — research, code, and create, all in one place

Quill is an open-source super agent framework. With sub-agent orchestration, sandbox execution, and an extensible skills system, it helps you accomplish multimodal work — research, coding, data analysis, document generation, and more.

## ✨ Core Capabilities

- **Deep Research** — multi-source search + cross-validation + cited reports
- **Code Execution** — safely run Python / Bash / file operations in a sandbox
- **Sub-Agent Collaboration** — main agent dispatches sub-agents for parallel complex tasks
- **Extensible Skills** — install skills to extend capabilities (academic review, PPT, charts, GitHub research, and more)
- **Long-Term Memory** — continuously records user profile and conversation history
- **Multi-Model** — DeepSeek / OpenAI / Anthropic / vLLM / Ollama and more

## 🚀 Quick Start

### Prerequisites

- Node.js 22+ / pnpm 10+
- Python 3.12+ (optional, for sandbox execution)

### Local Development

```bash
git clone https://github.com/<your-org>/quill.git
cd quill
make setup        # interactive wizard, done in ~2 minutes
make dev          # start services, open http://localhost:2126
```

### Docker Deployment

```bash
docker compose up -d
```

## 🛠️ Tech Stack

TypeScript · Next.js · LangGraph · Tailwind CSS · SQLite / Postgres

## 📦 Skills Ecosystem

Quill ships with 20+ built-in skills: academic review, deep research, data analysis, PPT generation, chart visualization, image / video / music generation, frontend design, GitHub research, newsletter, and more. Connect additional MCP services via `extensions_config.json`.

## 🤝 Contributing

Issues and PRs are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## 📜 License

[Apache 2.0](./LICENSE)
