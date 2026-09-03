#!/usr/bin/env bash
#
# serve.sh — Unified Quill service launcher
#
# Usage:
#   ./scripts/serve.sh [--dev|--prod] [--daemon] [--stop|--restart]
#
# Modes:
#   --dev       Development mode with hot-reload (default)
#   --prod      Production mode, pre-built frontend, no hot-reload
#   --daemon    Run all services in background (nohup), exit after startup
#
# Actions:
#   --skip-install  Skip dependency installation (faster restart)
#   --stop      Stop all running services and exit
#   --restart   Stop all services, then start with the given mode flags
#
# Examples:
#   ./scripts/serve.sh --dev                 # Gateway dev, hot reload
#   ./scripts/serve.sh --prod                # Gateway prod
#   ./scripts/serve.sh --dev --daemon        # Gateway dev, background
#   ./scripts/serve.sh --stop                # Stop all services
#   ./scripts/serve.sh --restart --dev       # Restart dev services
#
# Must be run from the repo root directory.

set -e

REPO_ROOT="$(builtin cd "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd -P)"
cd "$REPO_ROOT"

# ── Load .env ────────────────────────────────────────────────────────────────

if [ -f "$REPO_ROOT/.env" ]; then
    set -a
    source "$REPO_ROOT/.env"
    set +a
fi

# ── Argument parsing ─────────────────────────────────────────────────────────

DEV_MODE=true
DAEMON_MODE=false
SKIP_INSTALL=false
ACTION="start"   # start | stop | restart

for arg in "$@"; do
    case "$arg" in
        --dev)     DEV_MODE=true ;;
        --prod)    DEV_MODE=false ;;
        --daemon)  DAEMON_MODE=true ;;
        --skip-install) SKIP_INSTALL=true ;;
        --stop)    ACTION="stop" ;;
        --restart) ACTION="restart" ;;
        *)
            echo "Unknown argument: $arg"
            echo "Usage: $0 [--dev|--prod] [--daemon] [--skip-install] [--stop|--restart]"
            exit 1
            ;;
    esac
done

# ── Stop helper ──────────────────────────────────────────────────────────────

# Every quill worktree (the main checkout + each linked worktree) hardcodes
# the same dev ports (8101/3100/2126), so a service started from ANY of them
# must be reclaimable from here — otherwise `make stop`/`make dev` in this
# worktree can neither kill nor take over a port held by a sibling worktree.
# QUILL_ROOTS is that set of roots; processes living outside all of them
# (e.g. an unrelated project on port 3000) are still never touched.
# Sorted most-specific-first (longest path first): a linked worktree lives
# under the main checkout, so both roots are substrings of its files — checking
# the deeper root first attributes a reclaimed port to the right worktree.
QUILL_ROOTS="$(
    {
        printf '%s\n' "$REPO_ROOT"
        git -C "$REPO_ROOT" worktree list --porcelain 2>/dev/null |
            awk '/^worktree /{print $2}'
    } | awk 'NF && !seen[$0]++ {print length($0)"\t"$0}' | sort -rn | sed 's/^[0-9]*\t//'
)"

# ── Port configuration (single source of truth) ─────────────────────────────
# The three ports below are the single source of truth for local dev.
# nginx.local.conf and frontend/next.config.js are validated against these
# values at startup (see validate_port_alignment) — if you change a port here,
# update the corresponding entry in those files too.
GATEWAY_PORT=8101
FRONTEND_PORT=3100
NGINX_PORT=2126

# True if PID has an open file/cwd under any quill worktree root. The
# trailing slash keeps a sibling dir like ".../quill-notes" from matching
# the ".../quill" root.
_is_quill_pid() {
    local pid=$1 files root

    # Daemon children inherit QUILL_DAEMON_ROOT from run_service. Checking
    # it (Linux only — macOS has no /proc) identifies processes like
    # next-server that lsof misses, so the name/port reaps in stop_all can
    # claim them.
    if [ -r "/proc/$pid/environ" ] &&
        tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep -Fxq "QUILL_DAEMON_ROOT=$REPO_ROOT"; then
        return 0
    fi

    files=$(lsof -b -w -p "$pid" 2>/dev/null) || return 1
    while IFS= read -r root; do
        [ -n "$root" ] || continue
        case "$files" in
            *"$root"/*) return 0 ;;
        esac
    done <<< "$QUILL_ROOTS"
    return 1
}

# Fallback recognition for processes whose cwd/open files no longer point
# into the repo (e.g. long-running daemons, manually restarted children).
_is_quill_by_args() {
    local pid=$1
    local args
    args=$(ps -p "$pid" -o args= 2>/dev/null) || return 1
    case "$args" in
        *gateway_server.mjs*) return 0 ;;
        *"QUILL_PORT=${GATEWAY_PORT}"*) return 0 ;;
        *"next dev"*) return 0 ;;
        *"next start"*) return 0 ;;
        *next-server*) return 0 ;;
        *"PORT=3100"*) return 0 ;;
        *"$REPO_ROOT"/docker/nginx/nginx.local.conf*) return 0 ;;
    esac
    return 1
}

# Report ports about to be reclaimed from a *different* worktree, so stopping
# (or starting, which stops first) isn't silently killing someone else's run.
_report_reclaimed_ports() {
    local port pid files root owner
    for port in $GATEWAY_PORT $FRONTEND_PORT $NGINX_PORT; do
        for pid in $(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null); do
            _is_quill_pid "$pid" || continue
            files=$(lsof -b -w -p "$pid" 2>/dev/null)
            case "$files" in *"$REPO_ROOT"/*) continue ;; esac  # this worktree — normal
            owner=""
            while IFS= read -r root; do
                [ -n "$root" ] || continue
                case "$files" in *"$root"/*) owner="$root"; break ;; esac
            done <<< "$QUILL_ROOTS"
            echo "  ↻ Reclaiming port $port from another worktree: ${owner:-?}"
            break
        done
    done
}

_kill_repo_processes() {
    local pattern=$1
    local pid
    local pids=""

    while IFS= read -r pid; do
        if [ -n "$pid" ] && _is_quill_pid "$pid"; then
            case " $pids " in
                *" $pid "*) ;;
                *) pids="$pids $pid" ;;
            esac
        fi
    done < <(pgrep -f "$pattern" 2>/dev/null || true)

    if [ -n "$pids" ]; then
        kill $pids 2>/dev/null || true
    fi
}

_kill_repo_port() {
    local port=$1
    local pid
    local pids=""
    local reported=false

    while IFS= read -r pid; do
        [ -n "$pid" ] || continue
        if _is_quill_pid "$pid" || _is_quill_by_args "$pid"; then
            case " $pids " in
                *" $pid "*) ;;
                *)
                    pids="$pids $pid"
                    if ! $reported; then
                        echo "  ↻ Reclaiming port $port from a stale Quill process"
                        reported=true
                    fi
                    ;;
            esac
        fi
    done < <(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)

    if [ -n "$pids" ]; then
        kill -9 $pids 2>/dev/null || true
    fi
}

_is_port_listening() {
    local port=$1

    if command -v lsof >/dev/null 2>&1; then
        if lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
            return 0
        fi
    fi

    if command -v ss >/dev/null 2>&1; then
        if ss -ltn sport = :"$port" 2>/dev/null | tail -n +2 | grep -q .; then
            return 0
        fi
    fi

    if command -v netstat >/dev/null 2>&1; then
        if netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '(^|[.:])'"$port"'$'; then
            return 0
        fi
    fi

    return 1
}

_is_repo_nginx_pid() {
    local pid=$1
    local command
    local args

    command=$(ps -p "$pid" -o comm= 2>/dev/null) || return 1
    # nginx rewrites argv[0] for master/worker processes. On macOS,
    # `ps -o comm=` can report that rewritten form instead of the binary name.
    case "$command" in
        nginx|*/nginx|nginx:*) ;;
        *) return 1 ;;
    esac

    args=$(ps -p "$pid" -o args= 2>/dev/null) || return 1
    local root
    while IFS= read -r root; do
        [ -n "$root" ] || continue
        case "$args" in
            *"$root"/docker/nginx/nginx.local.conf*|*"$root"/*) return 0 ;;
        esac
    done <<< "$QUILL_ROOTS"

    _is_quill_pid "$pid"
}

_kill_repo_nginx() {
    local pid
    local pids=""

    if [ -f "$REPO_ROOT/logs/nginx.pid" ]; then
        read -r pid < "$REPO_ROOT/logs/nginx.pid" || true
        if [ -n "$pid" ] && _is_repo_nginx_pid "$pid"; then
            pids="$pids $pid"
        fi
    fi

    while IFS= read -r pid; do
        if [ -n "$pid" ] && _is_repo_nginx_pid "$pid"; then
            case " $pids " in
                *" $pid "*) ;;
                *) pids="$pids $pid" ;;
            esac
        fi
    done < <(pgrep -f nginx 2>/dev/null || true)

    if [ -n "$pids" ]; then
        kill -9 $pids 2>/dev/null || true
    fi
}

stop_all() {
    echo "Stopping all services..."
    _report_reclaimed_ports
    _kill_repo_processes "gateway_server.mjs"
    _kill_repo_processes "next dev"
    _kill_repo_processes "next start"
    _kill_repo_processes "next-server"
    nginx -c "$REPO_ROOT/docker/nginx/nginx.local.conf" -p "$REPO_ROOT" -s quit 2>/dev/null || true
    sleep 1
    _kill_repo_nginx
    # Force-kill any survivors still holding the service ports. 2126 is included
    # so a lingering nginx (or any quill process) that _kill_repo_nginx did
    # not match by name still gets reclaimed — otherwise `make dev` fails its
    # nginx port preflight.
    _kill_repo_port $GATEWAY_PORT
    _kill_repo_port $FRONTEND_PORT
    _kill_repo_port $NGINX_PORT
    ./scripts/cleanup-containers.sh quill-sandbox 2>/dev/null || true
    echo "✓ All services stopped"
}

# ── Action routing ───────────────────────────────────────────────────────────

if [ "$ACTION" = "stop" ]; then
    stop_all
    exit 0
fi

ALREADY_STOPPED=false
if [ "$ACTION" = "restart" ]; then
    stop_all
    sleep 1
    ALREADY_STOPPED=true
fi

# Mode label for banner
if $DEV_MODE; then
    MODE_LABEL='DEV (Gateway runtime, hot-reload enabled)'
else
    MODE_LABEL='PROD (Gateway runtime, optimized)'
fi

if $DAEMON_MODE; then
    MODE_LABEL="$MODE_LABEL [daemon]"
fi

# Frontend command
if $DEV_MODE; then
    FRONTEND_CMD="pnpm run dev"
else
    FRONTEND_CMD="pnpm run preview"
fi

# Runtime path defaults. Local `make dev` launches Gateway from `backend/`,
# so pin Quill-owned state to the expected backend runtime directory.
if [ -z "$QUILL_PROJECT_ROOT" ]; then
    export QUILL_PROJECT_ROOT="$REPO_ROOT"
fi

BACKEND_RUNTIME_HOME="$REPO_ROOT/backend/.scitops"
if [ -z "$QUILL_HOME" ]; then
    export QUILL_HOME="$BACKEND_RUNTIME_HOME"
fi

mkdir -p "$QUILL_HOME" "$BACKEND_RUNTIME_HOME"
QUILL_HOME="$(cd "$QUILL_HOME" && pwd -P)"
BACKEND_RUNTIME_HOME="$(cd "$BACKEND_RUNTIME_HOME" && pwd -P)"
export QUILL_HOME

# ── Stop existing services (skip if restart already did it) ──────────────────

if ! $ALREADY_STOPPED; then
    stop_all
    sleep 1
fi

# ── Config check ─────────────────────────────────────────────────────────────

if ! { \
        [ -n "$QUILL_CONFIG_PATH" ] && [ -f "$QUILL_CONFIG_PATH" ] || \
        [ -f backend/config.yaml ] || \
        [ -f config.yaml ]; \
    }; then
    echo "✗ No Quill config file found."
    echo '  Run `make setup` (recommended) or `make config` to generate config.yaml.'
    exit 1
fi

# Config upgrade uses Python+PyYAML. Non-fatal: if Python is unavailable, skip.
if command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
    "$REPO_ROOT/scripts/config-upgrade.sh" || true
fi

# ── Install dependencies ────────────────────────────────────────────────────

if ! $SKIP_INSTALL; then
    echo "Installing dependencies..."
    # Backend: TypeScript (npm). Python `uv sync` was removed in the TS migration.
    (cd backend && npm ci) || { echo "✗ Backend dependency install failed"; exit 1; }
    (cd frontend && pnpm install --silent) || { echo "✗ Frontend dependency install failed"; exit 1; }
    echo "✓ Dependencies installed"
else
    echo '⏩ Skipping dependency install (--skip-install)'
fi

# ── Banner ───────────────────────────────────────────────────────────────────

echo ""
echo "=========================================="
echo "  Starting Quill"
echo "=========================================="
echo ""
echo "  Mode: $MODE_LABEL"
echo ""
echo "  Services:"
  echo "    Gateway     → localhost:$GATEWAY_PORT  — REST API + agent runtime"
  echo "    Frontend    → localhost:$FRONTEND_PORT  — Next.js"
  echo "    Nginx       → localhost:$NGINX_PORT  — reverse proxy"
echo ""

# ── Cleanup handler ──────────────────────────────────────────────────────────

cleanup() {
    local status="${1:-0}"
    trap - INT TERM
    echo ""
    stop_all
    exit "$status"
}

trap 'cleanup 130' INT
trap 'cleanup 143' TERM




# ── Helper: start a service ──────────────────────────────────────────────────

# run_service NAME COMMAND PORT TIMEOUT
# In daemon mode, wraps with nohup. Waits for port to be ready.
run_service() {
    local name="$1" cmd="$2" port="$3" timeout="$4"

    if _is_port_listening "$port"; then
        echo "✗ $name cannot start because port $port is already in use."
        echo "  If it belongs to this worktree, run 'make stop'; otherwise free the port manually."
        cleanup 1
    fi

    echo "Starting $name..."
    if $DAEMON_MODE; then
        # Tag the daemon so every descendant (pnpm → next → next-server)
        # carries QUILL_DAEMON_ROOT in its environment, letting
        # _is_quill_pid recognize it at stop time.
        nohup env QUILL_DAEMON_ROOT="$REPO_ROOT" sh -c "$cmd" > /dev/null 2>&1 &
    else
        sh -c "$cmd" &
    fi

    ./scripts/wait-for-port.sh "$port" "$timeout" "$name" || {
        local logfile="logs/$(echo "$name" | tr '[:upper:]' '[:lower:]' | tr ' ' '-').log"
        echo "✗ $name failed to start."
        [ -f "$logfile" ] && tail -20 "$logfile"
        cleanup 1
    }
    echo "✓ $name started on localhost:$port"
}

# ── Port alignment check ─────────────────────────────────────────────────────
# Refuse to start if nginx.local.conf's gateway upstream port does not match
# $GATEWAY_PORT — otherwise the frontend's /api/* fetches silently fail with
# "Failed to load MCP configuration". A clear startup abort is far easier to
# act on than a cryptic runtime error.

validate_port_alignment() {
  local nginx_conf="$REPO_ROOT/docker/nginx/nginx.local.conf"
  [ -f "$nginx_conf" ] || return 0

  # Extract the port from the `upstream gateway { server 127.0.0.1:<PORT>; }` block.
  local nginx_gateway_port
  nginx_gateway_port="$(
    awk '
      /^[[:space:]]*upstream gateway[[:space:]]*\{/ { in_block=1; next }
      in_block && /server[[:space:]]+127\.0\.0\.1:/ {
        sub(/.*127\.0\.0\.1:/, "")
        sub(/;.*/, "")
        print
        exit
      }
      in_block && /\}/ { in_block=0 }
    ' "$nginx_conf"
  )"

  [ -z "$nginx_gateway_port" ] && return 0

  if [ "$nginx_gateway_port" != "$GATEWAY_PORT" ]; then
    echo "✗ Port mismatch between serve.sh and nginx.local.conf"
    echo "    serve.sh GATEWAY_PORT=$GATEWAY_PORT"
    echo "    nginx.local.conf gateway upstream port=$nginx_gateway_port"
    echo "  Fix: set nginx.local.conf upstream gateway server to 127.0.0.1:$GATEWAY_PORT, or change GATEWAY_PORT."
    exit 1
  fi
}

# ── Start services ───────────────────────────────────────────────────────────

# Abort early if our ports have drifted out of sync with nginx.local.conf —
# better a clear message now than "Failed to load MCP configuration" at runtime.
validate_port_alignment

mkdir -p logs
mkdir -p temp/client_body_temp temp/proxy_temp temp/fastcgi_temp temp/uwsgi_temp temp/scgi_temp

# 1. Gateway API (TypeScript runtime)
if $DEV_MODE; then
    GATEWAY_CMD="cd backend && QUILL_PORT=$GATEWAY_PORT npm run gateway:dev > ../logs/gateway.log 2>&1"
else
    GATEWAY_CMD="cd backend && npm run build && QUILL_PORT=$GATEWAY_PORT npm run gateway > ../logs/gateway.log 2>&1"
fi
run_service "Gateway" "$GATEWAY_CMD" $GATEWAY_PORT 30

# 2. Frontend
run_service "Frontend" \
    "cd frontend && PORT=$FRONTEND_PORT QUILL_INTERNAL_GATEWAY_BASE_URL=http://127.0.0.1:$GATEWAY_PORT $FRONTEND_CMD > ../logs/frontend.log 2>&1" \
    $FRONTEND_PORT 120

# 3. Nginx
run_service "Nginx" \
    "nginx -g 'daemon off;' -c '$REPO_ROOT/docker/nginx/nginx.local.conf' -p '$REPO_ROOT' > logs/nginx.log 2>&1" \
    $NGINX_PORT 10

# ── Ready ────────────────────────────────────────────────────────────────────

echo ""
echo "=========================================="
echo "  ✓ Quill is running!  [$MODE_LABEL]"
echo "=========================================="
echo ""
echo "  🌐 http://localhost:2126"
echo ""
echo "  Routing: Frontend → Nginx → Gateway"
echo "  API:     /api/langgraph/*  →  Gateway agent runtime"
echo "           /api/*              →  Gateway REST API [$GATEWAY_PORT]"
echo ""
echo "  📋 Logs: logs/{gateway,frontend,nginx}.log"
echo ""

if $DAEMON_MODE; then
    echo "  🛑 Stop: make stop"
    # Detach — trap is no longer needed
    trap - INT TERM
else
    echo "  Press Ctrl+C to stop all services"
    wait
fi
