# Security Policy

## Supported Versions

We actively maintain the following branches:

| Branch | Version | Support Status |
|--------|---------|----------------|
| `main` | 2.x | ✅ Active development & security updates |
| `main-1.x` | 1.x | ⚠️ Security fixes only |

## Security Features

Quill includes multiple layers of security by design:

- **Sandboxed Execution** — Code runs in isolated environments (local, Docker, or E2B sandboxes)
- **Tool Annotations** — Tools declare safety properties (read-only, destructive, idempotent, open-world)
- **Adaptive Permissions** — Progressive trust levels from Strict → Full based on session history
- **Security Scanner** — Deterministic offline scanning blocks malicious skills before any LLM call
- **Depth-Aware Policy** — Subagents lose dangerous tools as nesting depth increases
- **Input Sanitization** — Prompt injection defense at the middleware layer
- **CSRF Protection** — Double Submit Cookie pattern for all state-changing API calls

## Reporting a Vulnerability

We take security vulnerabilities seriously. Please report them responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities.
2. Go to https://github.com/CreamyLong/quill/security/advisories to report privately.
3. Include a detailed description, reproduction steps, and potential impact.

We will acknowledge your report within 48 hours and provide a fix timeline within 7 days.

## Security Best Practices for Self-Hosters

- Always use the latest release version
- Enable sandbox mode for code execution
- Use adaptive permissions to limit tool access
- Keep your API keys in `.env` (never commit them)
- Run behind a reverse proxy (Nginx) in production
- Enable authentication for multi-user deployments
