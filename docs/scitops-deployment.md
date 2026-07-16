# Quill 部署指南

Quill 是基于 Quill 架构重构的 TypeScript 智能体平台，提供统一的 Web 聊天界面、子代理（Subagent）协作、AIO 容器沙箱执行和持久化记忆能力。

---

## 1. 系统要求

| 组件 | 版本/要求 |
|---|---|
| Node.js | ≥ 22 |
| pnpm | ≥ 9 |
| Python | 仅用于外部 MCP 服务器（如 pandoc、duckduckgo），核心网关不依赖 Python |
| Docker | AIO 沙箱模式需要 Docker 引擎 |
| 内存 | 本地开发 ≥ 8 GB；生产 ≥ 16 GB |
| 磁盘 | ≥ 10 GB 可用空间 |

---

## 2. 快速启动（本地开发）

```bash
# 1. 克隆仓库并切换到 ts-only 分支
git clone <your-quill-repo>
cd quill
git checkout ts-only

# 2. 安装后端依赖
cd backend
npm install

# 3. 安装前端依赖
cd ../frontend
pnpm install

# 4. 复制配置文件（从示例生成）
cd ..
cp .env.example .env
cp config.example.yaml config.yaml
# 编辑 config.yaml 和 .env，填入模型 API 密钥

# 5. 启动后端（端口 8123）
cd backend
npm run build
QUILL_API_KEY=<your-key> npm run gateway

# 6. 另开终端启动前端（端口 3000）
cd frontend
pnpm dev
```

浏览器访问：http://localhost:3000/workspace

---

## 3. 配置说明

### 3.1 根目录 `.env`

```env
# 模型 API 密钥（以 DeepSeek 为例）
DEEPSEEK_API_KEY=sk-...

# 可选：Tavily 搜索
TAVILY_API_KEY=tvly-...

# 可选：LangSmith 追踪
LANGCHAIN_API_KEY=ls-...
LANGCHAIN_PROJECT=quill
```

### 3.2 `config.yaml` 核心项

```yaml
app:
  name: "Quill"

models:
  - name: "deepseek-v4-flash"
    model: "deepseek-v4-flash"
    provider: "deepseek"
    api_key: "${DEEPSEEK_API_KEY}"
    base_url: "https://api.deepseek.com/v1"

sandbox:
  use: "quill.community.aio_sandbox.aio_sandbox_provider:AioSandboxProvider"
  port: 8090
  replicas: 3
  idle_timeout: 600
  allow_host_bash: false

mcp:
  servers:
    # 示例：Sciverse MCP
    sciverse:
      command: "npx"
      args: ["-y", "@sciverse/mcp-server"]
      env:
        SCIVERSE_API_KEY: "${SCIVERSE_API_KEY}"

skills:
  enabled: true
  paths:
    - "./skills/public"
```

> 注意： Quill 使用 `quill.*` 作为配置模块路径，旧版 `quill.*` 路径已废弃。

---

## 4. 生产部署（Docker Compose）

```bash
# 1. 准备配置
cp .env.example .env
cp config.example.yaml config.yaml
# 编辑后保存

# 2. 启动完整栈
docker compose -f docker/docker-compose.yaml up -d

# 3. 查看日志
docker compose -f docker/docker-compose.yaml logs -f gateway
```

默认入口：http://localhost:2026（Nginx 反向代理）

---

## 5. AIO 沙箱说明

Quill 推荐生产环境使用 AIO（All-in-One）容器沙箱：

- 每个对话线程分配独立容器
- 代码执行在隔离环境中运行
- 默认关闭 `allow_host_bash`，无需担心宿主机安全
- 端口基线默认 `8090`，可配置 `sandbox.port`

---

## 6. 模型接入

Quill TS Gateway 通过 OpenAI 兼容接口接入模型。支持：

- DeepSeek
- OpenAI
- Anthropic（OpenAI 兼容模式）
- 自定义 vLLM/OneAPI 端点

在 `config.yaml` 的 `models` 段配置即可。

---

## 7. 常见问题

### Q: 启动 Gateway 提示缺少 API key
A: 确保环境变量或 `config.yaml` 中模型 `api_key` 已填写。本地开发可用 `.env` 文件。

### Q: AIO 沙箱容器启动失败
A: 检查 Docker 是否运行，以及 `sandbox.port` 是否被占用。AIO 默认使用 `8090`、`8091`、`8092` 连续端口。

### Q: 前端报 `Failed to fetch`
A: 确认 Gateway 已启动在 `http://localhost:8123`，并且前端代理配置指向该地址。

### Q: 子代理任务卡在运行中
A: 检查 Gateway 日志中的模型响应；若模型返回 `INVALID_TOOL_RESULTS`，通常是工具消息格式与当前模型不兼容，可尝试切换模型。

---

## 8. 目录结构

```
quill/
├── backend/
│   ├── packages/harness/quill/   # 核心智能体运行时（TypeScript）
│   ├── app/gateway/                # Gateway API 类型定义
│   ├── scripts/gateway_server.mjs  # 启动入口
│   └── dist/                       # 编译产物
├── frontend/                       # Next.js 聊天界面
├── docker/                         # Docker Compose 与 Nginx 配置
├── skills/public/                  # 内置技能
└── docs/                           # 文档
```

---

## 9. 技术支持

部署过程中如遇问题，请提供：

- `config.yaml`（脱敏后）
- Gateway 日志：`docker logs <gateway-container>` 或 `/tmp/gateway.log`
- 前端报错截图
