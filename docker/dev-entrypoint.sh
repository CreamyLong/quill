#!/usr/bin/env sh
#
# Quill gateway dev entrypoint — runs inside the docker-compose-dev gateway
# container. Extracted from docker/docker-compose-dev.yaml's inline `command:`.
#
# Responsibilities:
#   1. Install backend dependencies (npm ci).
#   2. Build TypeScript (tsc) so the gateway can start.
#   3. Hand off to the TypeScript gateway with hot-reload (node --watch),
#      replacing this shell so the gateway becomes PID 1 inside the container.
#
# Anchored at /bin/sh (not bash) since alpine-based base images may not ship
# bash. Uses POSIX-only constructs throughout.

set -e

# Mirror the legacy command's behavior: redirect both stdout and stderr to the
# host-mounted log file (../logs/gateway.log → /app/logs/gateway.log).
exec >/app/logs/gateway.log 2>&1

# Keep runtime-owned files in a known location.
: "${QUILL_HOME:=/app/backend/.scitops}"
export QUILL_HOME
mkdir -p "$QUILL_HOME" /app/backend/.scitops

# ── Install + build ─────────────────────────────────────────────────────────

cd /app/backend

# Install dependencies (ci = clean install from lockfile)
if ! npm ci; then
    echo "[startup] npm ci failed; retrying once"
    npm ci
fi

# Compile TypeScript → dist/
npm run build

# ── Hand off to the TypeScript gateway ──────────────────────────────────────

echo "[startup] Starting TypeScript gateway on port 8001"
exec npm run gateway:dev
