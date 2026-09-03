#!/usr/bin/env bash
#
# deploy.sh - Build, start, or stop Quill production services
#
# Commands:
#   deploy.sh                    — build + start
#   deploy.sh build              — build all images (mode-agnostic)
#   deploy.sh start              — start from pre-built images
#   deploy.sh down               — stop and remove containers
#
# Sandbox mode (local / aio / provisioner) is auto-detected from config.yaml.
#
# Examples:
#   deploy.sh                    # build + start
#   deploy.sh build              # build all images
#   deploy.sh start              # start pre-built images
#   deploy.sh down               # stop and remove containers
#
# Must be run from the repo root directory.

set -e

case "${1:-}" in
    build|start|down)
        CMD="$1"
        if [ -n "${2:-}" ]; then
            echo "Unknown argument: $2"
            echo "Usage: deploy.sh [build|start|down]"
            exit 1
        fi
        ;;
    "")
        CMD=""
        ;;
    *)
        echo "Unknown argument: $1"
        echo "Usage: deploy.sh [build|start|down]"
        exit 1
        ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/.env"
DOCKER_DIR="$REPO_ROOT/docker"
if [ -f "$ENV_FILE" ]; then
    COMPOSE_CMD=(docker compose --env-file "$ENV_FILE" -p quill -f "$DOCKER_DIR/docker-compose.yaml")
else
    COMPOSE_CMD=(docker compose -p quill -f "$DOCKER_DIR/docker-compose.yaml")
fi

load_uv_extras_from_dotenv() {
    local line=""
    local value=""

    [ -f "$ENV_FILE" ] || return 0
    [ -z "${UV_EXTRAS+x}" ] || return 0

    line="$(grep -E '^[[:space:]]*(export[[:space:]]+)?UV_EXTRAS[[:space:]]*=' "$ENV_FILE" | tail -n 1 || true)"
    [ -n "$line" ] || return 0

    value="${line#*=}"
    value="${value%$'\r'}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    case "$value" in
        \"*\") value="${value#\"}"; value="${value%\"}" ;;
        \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    export UV_EXTRAS="$value"
}

load_uv_extras_from_dotenv

# ── Colors ────────────────────────────────────────────────────────────────────

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# ── QUILL_HOME ────────────────────────────────────────────────────────────

if [ -z "$QUILL_HOME" ]; then
    export QUILL_HOME="$REPO_ROOT/backend/.scitops"
fi
echo -e "${BLUE}QUILL_HOME=$QUILL_HOME${NC}"
mkdir -p "$QUILL_HOME"

# ── QUILL_REPO_ROOT (for skills host path in DooD) ───────────────────────

export QUILL_REPO_ROOT="$REPO_ROOT"

# ── config.yaml ───────────────────────────────────────────────────────────────

if [ -z "$QUILL_CONFIG_PATH" ]; then
    export QUILL_CONFIG_PATH="$REPO_ROOT/config.yaml"
fi

if  [ "$CMD" != "down" ] && [ ! -f "$QUILL_CONFIG_PATH" ]; then
    # Try to seed from repo (config.example.yaml is the canonical template)
    if [ -f "$REPO_ROOT/config.example.yaml" ]; then
        cp "$REPO_ROOT/config.example.yaml" "$QUILL_CONFIG_PATH"
        echo -e "${GREEN}✓ Seeded config.example.yaml → $QUILL_CONFIG_PATH${NC}"
        echo -e "${YELLOW}⚠ config.yaml was seeded from the example template.${NC}"
        echo "  Run 'make setup' to generate a minimal config, or edit $QUILL_CONFIG_PATH manually before use."
    else
        echo -e "${RED}✗ No config.yaml found.${NC}"
        echo "  Run 'make setup' from the repo root (recommended),"
        echo "  or 'make config' for the full template, then set the required model API keys."
        exit 1
    fi
else
    echo -e "${GREEN}✓ config.yaml: $QUILL_CONFIG_PATH${NC}"
fi

# ── extensions_config.json ───────────────────────────────────────────────────

if [ -z "$QUILL_EXTENSIONS_CONFIG_PATH" ]; then
    export QUILL_EXTENSIONS_CONFIG_PATH="$REPO_ROOT/extensions_config.json"
fi

if [ ! -f "$QUILL_EXTENSIONS_CONFIG_PATH" ]; then
    if [ -f "$REPO_ROOT/extensions_config.json" ]; then
        cp "$REPO_ROOT/extensions_config.json" "$QUILL_EXTENSIONS_CONFIG_PATH"
        echo -e "${GREEN}✓ Seeded extensions_config.json → $QUILL_EXTENSIONS_CONFIG_PATH${NC}"
    else
        # Create a minimal empty config so the gateway doesn't fail on startup
        echo '{"mcpServers":{},"skills":{}}' > "$QUILL_EXTENSIONS_CONFIG_PATH"
        echo -e "${YELLOW}⚠ extensions_config.json not found, created empty config at $QUILL_EXTENSIONS_CONFIG_PATH${NC}"
    fi
else
    echo -e "${GREEN}✓ extensions_config.json: $QUILL_EXTENSIONS_CONFIG_PATH${NC}"
fi


# ── QUILL_INTERNAL_AUTH_TOKEN ────────────────────────────────────────────
# Shared by all Gateway workers so channel workers can call internal Gateway
# APIs even when the request is handled by a different Uvicorn worker.

_internal_auth_token_file="$QUILL_HOME/.internal-auth-token"
if  [ "$CMD" != "down" ] && [ -z "$QUILL_INTERNAL_AUTH_TOKEN" ]; then
    if [ -f "$_internal_auth_token_file" ]; then
        export QUILL_INTERNAL_AUTH_TOKEN
        QUILL_INTERNAL_AUTH_TOKEN="$(cat "$_internal_auth_token_file")"
        echo -e "${GREEN}✓ QUILL_INTERNAL_AUTH_TOKEN loaded from $_internal_auth_token_file${NC}"
    else
        export QUILL_INTERNAL_AUTH_TOKEN
        if command -v python3 > /dev/null 2>&1 && \
            QUILL_INTERNAL_AUTH_TOKEN="$(python3 -c 'import sys; sys.version_info >= (3, 6) or sys.exit(1); import secrets; print(secrets.token_urlsafe(32))' 2>/dev/null)"; then
            true
        elif command -v python > /dev/null 2>&1 && \
            QUILL_INTERNAL_AUTH_TOKEN="$(python -c 'import sys; sys.version_info >= (3, 6) or sys.exit(1); import secrets; print(secrets.token_urlsafe(32))' 2>/dev/null)"; then
            true
        elif command -v openssl > /dev/null 2>&1 && \
            QUILL_INTERNAL_AUTH_TOKEN="$(openssl rand -hex 32)"; then
            true
        else
            echo -e "${RED}✗ Cannot generate QUILL_INTERNAL_AUTH_TOKEN: python3, python, and openssl are all unavailable.${NC}" >&2
            echo -e "${RED}  Set QUILL_INTERNAL_AUTH_TOKEN manually before running make up.${NC}" >&2
            exit 1
        fi
        echo "$QUILL_INTERNAL_AUTH_TOKEN" > "$_internal_auth_token_file"
        chmod 600 "$_internal_auth_token_file"
        echo -e "${GREEN}✓ QUILL_INTERNAL_AUTH_TOKEN generated → $_internal_auth_token_file${NC}"
    fi
fi

# ── UV_EXTRAS auto-detection ─────────────────────────────────────────────────
# The production Dockerfile accepts UV_EXTRAS as a single build-arg token and
# adds the --extra prefix itself. Convert the detector's uv flag string
# ("--extra postgres --extra discord") to a comma-joined name token.

if [ "$CMD" != "down" ] && [ -z "$UV_EXTRAS" ]; then
    _detect_python=""
    for _python in python3 python; do
        if command -v "$_python" >/dev/null 2>&1 && \
            "$_python" -c 'import sys; sys.version_info >= (3, 6) or sys.exit(1)' >/dev/null 2>&1; then
            _detect_python="$_python"
            break
        fi
    done
fi

if [ "$CMD" != "down" ] && [ -z "$UV_EXTRAS" ] && [ -n "$_detect_python" ]; then
    _uv_extras_flags="$("$_detect_python" "$REPO_ROOT/scripts/detect_uv_extras.py" 2>/dev/null || true)"
    _uv_extras=""
    set -- $_uv_extras_flags
    while [ "$#" -gt 0 ]; do
        if [ "$1" = "--extra" ] && [ "$#" -gt 1 ]; then
            if [ -z "$_uv_extras" ]; then
                _uv_extras="$2"
            else
                _uv_extras="$_uv_extras,$2"
            fi
            shift 2
        else
            shift
        fi
    done
    if [ -n "$_uv_extras" ]; then
        export UV_EXTRAS="$_uv_extras"
        echo -e "${GREEN}✓ Auto-detected UV_EXTRAS=${UV_EXTRAS} from config.yaml${NC}"
    fi
fi

# ── detect_sandbox_mode ───────────────────────────────────────────────────────

detect_sandbox_mode() {
    local sandbox_use=""
    local provisioner_url=""

    [ -f "$QUILL_CONFIG_PATH" ] || { echo "local"; return; }

    sandbox_use=$(awk '
        /^[[:space:]]*sandbox:[[:space:]]*$/ { in_sandbox=1; next }
        in_sandbox && /^[^[:space:]#]/ { in_sandbox=0 }
        in_sandbox && /^[[:space:]]*use:[[:space:]]*/ {
            line=$0; sub(/^[[:space:]]*use:[[:space:]]*/, "", line); print line; exit
        }
    ' "$QUILL_CONFIG_PATH")

    provisioner_url=$(awk '
        /^[[:space:]]*sandbox:[[:space:]]*$/ { in_sandbox=1; next }
        in_sandbox && /^[^[:space:]#]/ { in_sandbox=0 }
        in_sandbox && /^[[:space:]]*provisioner_url:[[:space:]]*/ {
            line=$0; sub(/^[[:space:]]*provisioner_url:[[:space:]]*/, "", line); print line; exit
        }
    ' "$QUILL_CONFIG_PATH")

    if [[ "$sandbox_use" == *"quill.community.aio_sandbox:AioSandboxProvider"* ]]; then
        if [ -n "$provisioner_url" ]; then
            echo "provisioner"
        else
            echo "aio"
        fi
    else
        echo "local"
    fi
}

# ── down ──────────────────────────────────────────────────────────────────────

if [ "$CMD" = "down" ]; then
    # Set minimal env var defaults so docker compose can parse the file without
    # warning about unset variables that appear in volume specs.
    export QUILL_HOME="${QUILL_HOME:-$REPO_ROOT/backend/.scitops}"
    export QUILL_CONFIG_PATH="${QUILL_CONFIG_PATH:-$QUILL_HOME/config.yaml}"
    export QUILL_EXTENSIONS_CONFIG_PATH="${QUILL_EXTENSIONS_CONFIG_PATH:-$QUILL_HOME/extensions_config.json}"
    export QUILL_REPO_ROOT="${QUILL_REPO_ROOT:-$REPO_ROOT}"
    export QUILL_INTERNAL_AUTH_TOKEN="${QUILL_INTERNAL_AUTH_TOKEN:-placeholder}"
    "${COMPOSE_CMD[@]}" down
    exit 0
fi

# ── build ────────────────────────────────────────────────────────────────────
# Build produces mode-agnostic images. No --gateway or sandbox detection needed.

if [ "$CMD" = "build" ]; then
    echo "=========================================="
    echo "  Quill — Building Images"
    echo "=========================================="
    echo ""

    "${COMPOSE_CMD[@]}" build

    echo ""
    echo "=========================================="
    echo "  ✓ Images built successfully"
    echo "=========================================="
    echo ""
    echo "  Next: deploy.sh start"
    echo ""
    exit 0
fi

# ── Banner ────────────────────────────────────────────────────────────────────

echo "=========================================="
echo "  Quill Production Deployment"
echo "=========================================="
echo ""

# ── Detect runtime configuration ────────────────────────────────────────────
# Only needed for start / up — determines whether provisioner is launched.

sandbox_mode="$(detect_sandbox_mode)"
echo -e "${BLUE}Sandbox mode: $sandbox_mode${NC}"

echo -e "${BLUE}Runtime: Gateway embedded agent runtime${NC}"

services="frontend gateway nginx"

if [ "$sandbox_mode" = "provisioner" ]; then
    services="$services provisioner"
fi

# ── QUILL_DOCKER_SOCKET (aio / pure-DooD mode only) ──────────────────────
# Only aio mode (AioSandboxProvider without provisioner_url) needs the host
# Docker socket. It is mounted via the opt-in docker-compose.dood.yaml overlay,
# appended here, so the default (local) and provisioner modes never expose the
# host daemon. Mounting the socket = root-equivalent host control; see SECURITY.md.

if [ -z "$QUILL_DOCKER_SOCKET" ]; then
    export QUILL_DOCKER_SOCKET="/var/run/docker.sock"
fi

if [ "$sandbox_mode" = "aio" ]; then
    if [ ! -S "$QUILL_DOCKER_SOCKET" ]; then
        echo -e "${RED}⚠ Docker socket not found at $QUILL_DOCKER_SOCKET${NC}"
        echo "  AioSandboxProvider (DooD) will not work."
        exit 1
    fi
    echo -e "${GREEN}✓ Docker socket: $QUILL_DOCKER_SOCKET${NC}"
    echo -e "${YELLOW}  Mounting host Docker socket into gateway (DooD = host root-equivalent). See SECURITY.md.${NC}"
    COMPOSE_CMD+=(-f "$DOCKER_DIR/docker-compose.dood.yaml")
fi

echo ""

# ── Start / Up ───────────────────────────────────────────────────────────────

if [ "$CMD" = "start" ]; then
    echo "Starting containers (no rebuild)..."
    echo ""
    # shellcheck disable=SC2086
    "${COMPOSE_CMD[@]}" up -d --remove-orphans $services
else
    # Default: build + start
    echo "Building images and starting containers..."
    echo ""
    # shellcheck disable=SC2086
    "${COMPOSE_CMD[@]}" up --build -d --remove-orphans $services
fi

echo ""
echo "=========================================="
echo "  Quill is running!"
echo "=========================================="
echo ""
echo "  🌐 Application: http://localhost:${PORT:-2026}"
echo "  📡 API Gateway: http://localhost:${PORT:-2026}/api/*"
echo "  🤖 Runtime:     Gateway embedded"
echo "  API:            /api/langgraph/* → Gateway"
echo ""
echo "  Manage:"
echo "    make down        — stop and remove containers"
echo "    make docker-logs — view logs"
echo ""
