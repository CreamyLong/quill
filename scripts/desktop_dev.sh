#!/usr/bin/env bash
# desktop_dev.sh — one-command Quill desktop stack (Gateway + frontend + Tauri shell).
#
# Why this exists: the frontend defaults to ports (8101) and the TS gateway to
# (8123) that other processes on this machine (e.g. IDE port-forwarding) may
# hold in a zombie state — accepting TCP but never answering HTTP — which makes
# every config page (models/skills/MCP) fail silently. This launcher probes
# candidate ports, skips unresponsive ones, wires the frontend to the real
# gateway, and starts the Tauri shell pointed at the chosen frontend port.
#
# Usage: ./scripts/desktop_dev.sh [--no-tauri]
#   --no-tauri   Start gateway + frontend only (Tauri shell must be launched
#                manually; useful when iterating on Rust separately).

set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

START_TAURI=1
if [[ "${1:-}" == "--no-tauri" ]]; then
  START_TAURI=0
fi

# ── Port probing ─────────────────────────────────────────────────────────────
# A port is "zombie" when something LISTENs on it but HTTP gets no reply —
# the signature of a hung tunnel/forwarder. Quill services never start there.

port_listening() {
  lsof -i TCP:"$1" -P -sTCP:LISTEN >/dev/null 2>&1
}

port_answers_http() {
  # Any well-formed HTTP status (2xx-5xx) means a real server owns the port.
  local code
  code=$(curl -s -o /dev/null -m 3 --noproxy '*' -w '%{http_code}' "http://127.0.0.1:$1/health" 2>/dev/null || true)
  [[ "$code" =~ ^[0-9]+$ ]] && [[ "$code" != "000" ]]
}

# Pick the first candidate port that is free OR answered HTTP (a live Quill
# service from a previous run is fine to reuse for the frontend/gateway probe
# step below; only zombies are rejected outright).
pick_port() {
  local role="$1" candidates="$2"
  for p in $candidates; do
    if ! port_listening "$p"; then
      echo "$p"; return 0
    fi
    if port_answers_http "$p"; then
      echo "$p"; return 0
    fi
    echo "[desktop] WARN: port $p ($role) is held by an unresponsive process" \
         "(zombie port-forward?). Skipping to the next candidate." >&2
  done
  echo "[desktop] ERROR: no free port found for $role in: $candidates" >&2
  return 1
}

GATEWAY_PORT="$(pick_port gateway "8200 8201 8202")"
FRONTEND_PORT="$(pick_port frontend "3200 3201 3202")"

# ── Gateway ──────────────────────────────────────────────────────────────────
# Reuse a healthy gateway that already answers on the picked port; otherwise
# build (if needed) and start one.

gateway_url="http://127.0.0.1:${GATEWAY_PORT}"
GATEWAY_PID=""

if port_listening "$GATEWAY_PORT" && port_answers_http "$GATEWAY_PORT"; then
  echo "[desktop] reusing healthy gateway at $gateway_url"
else
  if [[ ! -f "$ROOT_DIR/backend/dist/packages/harness/quill/server/gateway.js" ]]; then
    echo "[desktop] building TS backend (first run)..."
    (cd "$ROOT_DIR/backend" && npx tsc)
  fi
  echo "[desktop] starting gateway on $GATEWAY_PORT ..."
  (cd "$ROOT_DIR/backend" && QUILL_PORT="$GATEWAY_PORT" node scripts/gateway_server.mjs) &
  GATEWAY_PID=$!

  for _ in $(seq 1 30); do
    if port_answers_http "$GATEWAY_PORT"; then break; fi
    sleep 1
  done
  if ! port_answers_http "$GATEWAY_PORT"; then
    echo "[desktop] ERROR: gateway did not become healthy on $GATEWAY_PORT" >&2
    kill "$GATEWAY_PID" 2>/dev/null || true
    exit 1
  fi
fi

# ── Frontend ─────────────────────────────────────────────────────────────────
# QUILL_AUTH_DISABLED=1 removes the login wall for the local desktop flow
# (built-in mode; automatically inert when QUILL_ENV=production).

frontend_url="http://127.0.0.1:${FRONTEND_PORT}"
FRONTEND_PID=""

if port_listening "$FRONTEND_PORT" && port_answers_http "$FRONTEND_PORT"; then
  echo "[desktop] reusing healthy frontend at $frontend_url"
else
  echo "[desktop] starting frontend on $FRONTEND_PORT (auth disabled for desktop) ..."
  (cd "$ROOT_DIR/frontend" \
    && QUILL_AUTH_DISABLED=1 \
       QUILL_INTERNAL_GATEWAY_BASE_URL="$gateway_url" \
       pnpm exec next dev --turbo -p "$FRONTEND_PORT") &
  FRONTEND_PID=$!

  for _ in $(seq 1 60); do
    if port_answers_http "$FRONTEND_PORT"; then break; fi
    sleep 1
  done
  if ! port_answers_http "$FRONTEND_PORT"; then
    echo "[desktop] ERROR: frontend did not become healthy on $FRONTEND_PORT" >&2
    kill "$FRONTEND_PID" 2>/dev/null || true
    [[ -n "$GATEWAY_PID" ]] && kill "$GATEWAY_PID" 2>/dev/null || true
    exit 1
  fi
fi

cleanup() {
  echo "[desktop] shutting down..."
  [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  [[ -n "$GATEWAY_PID" ]] && kill "$GATEWAY_PID" 2>/dev/null || true
}
trap cleanup EXIT

# ── Tauri shell ──────────────────────────────────────────────────────────────
if [[ "$START_TAURI" == "1" ]]; then
  echo "[desktop] launching Tauri shell → $frontend_url"
  cd "$ROOT_DIR/desktop"
  PATH="$HOME/.cargo/bin:$PATH" \
    npx tauri dev --config "{\"build\":{\"devUrl\":\"$frontend_url\"}}"
else
  echo "[desktop] gateway:  $gateway_url"
  echo "[desktop] frontend: $frontend_url"
  echo "[desktop] (--no-tauri) press Ctrl-C to stop"
  wait
fi
