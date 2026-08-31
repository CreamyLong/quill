# 🪶 Quill

> Asistente de IA de código abierto — investiga, codifica y crea, todo en un solo lugar

<div align="center">

[English](README.md) · [中文](README_zh.md) · [한국어](README_ko.md) · [日本語](README_ja.md) · [Français](README_fr.md) · [Русский](README_ru.md) · **Español** · [العربية](README_ar.md)

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15.x-000000.svg)](https://nextjs.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph-Agent%20Runtime-1C1C1C.svg)](https://langchain-ai.github.io/langgraph/)

</div>

Quill es un framework de superagente de código abierto. Con orquestación de subagentes, ejecución en sandbox y un sistema de habilidades extensible, te ayuda a realizar trabajos multimodales — investigación, codificación, análisis de datos, generación de documentos y más.

---

## 📸 Vitrina de Funcionalidades

### 🔬 Investigación Profunda
Búsqueda multi-fuentes con validación cruzada y reportes citados. Quill orquesta múltiples subagentes para investigar temas en profundidad.

### 💻 Ejecución de Código
Ejecuta de forma segura Python / Bash / operaciones de archivos en un entorno aislado.

### 🤖 Colaboración de Subagentes
El agente principal despacha subagentes especializados para tareas complejas en paralelo.

### 🧩 Habilidades y Extensiones Extensibles
Instala habilidades para extender capacidades. Crea extensiones personalizadas con hooks de ciclo de vida.

### 🧠 Memoria a Largo Plazo
Registra continuamente el perfil del usuario e historial de conversaciones con políticas de desalojo basadas en confianza.

### 🌐 Multi-Modelo y Multi-Idioma
DeepSeek / OpenAI / Anthropic / vLLM / Ollama y más. La interfaz soporta 8 idiomas.

---

## ✨ Capabilidades Principales

| Capabilidad | Descripción |
|------------|-------------|
| **Investigación Profunda** | Búsqueda multi-fuentes + validación cruzada + reportes citados |
| **Ejecución de Código** | Ejecuta de forma segura Python / Bash / operaciones de archivos |
| **Colaboración de Subagentes** | El agente principal despacha subagentes en paralelo |
| **Habilidades Extensibles** | Instala habilidades (revisión académica, PPT, gráficos, etc.) |
| **Sistema de Extensiones** | Crea plugins con hooks de ciclo de vida |
| **Memoria a Largo Plazo** | Registro continuo con políticas de desalojo |
| **Multi-Modelo** | DeepSeek / OpenAI / Anthropic / vLLM / Ollama y más |
| **Multi-Idioma** | Interfaz en 8 idiomas |
| **Canales IM** | Integración Telegram, Slack, Discord, Feishu, DingTalk |
| **Tareas Programadas** | Ejecuciones programadas cron/intervalo con soporte multi-instancia |

---

## 🚀 Inicio Rápido

### Prerrequisitos

- Node.js 22+ / pnpm 10+
- Python 3.12+ (opcional, para ejecución en sandbox)

### Desarrollo Local

```bash
git clone https://github.com/<your-org>/quill.git
cd quill
make setup        # asistente interactivo, terminado en ~2 minutos
make dev          # iniciar servicios, abrir http://localhost:2126
```

### Despliegue Docker

```bash
docker compose up -d
```

---

## 🛠️ Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| **Frontend** | Next.js 15 · React 19 · Tailwind CSS · shadcn/ui |
| **Backend** | LangGraph · TypeScript · FastAPI (Python) |
| **Base de Datos** | SQLite / PostgreSQL · LangGraph Checkpointer |
| **Runtime del Agente** | StateGraph · 25+ Middlewares · Sub-Agent Executor |
| **Protocolos** | MCP (Model Context Protocol) · SSE · HTTP/SSE/Stdio |

---

## 🌐 Internacionalización

Quill soporta 8 idiomas:

| Idioma | Locale | Estado |
|--------|--------|--------|
| English | `en-US` | ✅ Completo |
| 中文 | `zh-CN` | ✅ Completo |
| 한국어 | `ko-KR` | ✅ Completo |
| 日本語 | `ja-JP` | ✅ Completo |
| Français | `fr-FR` | ✅ Completo |
| Русский | `ru-RU` | ✅ Completo |
| Español | `es-ES` | ✅ Completo |
| العربية | `ar-SA` | ✅ Completo |

Cambia el idioma en Configuración → Apariencia → Idioma.

---

## 🤝 Contribuir

Los issues y PRs son bienvenidos. Consulta [CONTRIBUTING.md](./CONTRIBUTING.md) para más detalles.

## 📜 Licencia

[Apache 2.0](./LICENSE)
