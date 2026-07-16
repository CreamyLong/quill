# Backend Dockerfile — multi-stage build (TypeScript runtime)
# Stage 1 (builder): compiles TypeScript → dist/
# Stage 2 (dev):     retains toolchain for dev containers (npm ci at startup)
# Stage 3 (runtime): clean image without build tools for production

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:22-slim AS builder

ARG APT_MIRROR

# Optionally override apt mirror for restricted networks
RUN if [ -n "${APT_MIRROR}" ]; then \
      sed -i "s|deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
      sed -i "s|deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list 2>/dev/null || true; \
    fi

# Install build tools (some native Node modules may need compilation)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy backend source
COPY backend/package.json backend/package-lock.json* ./backend/

# Install dependencies
RUN cd backend && npm ci

# Copy the rest of the backend source
COPY backend ./backend

# Compile TypeScript
RUN cd backend && npm run build

# ── Stage 2: Dev ──────────────────────────────────────────────────────────────
# Retains full toolchain for dev containers.
FROM builder AS dev

# Install Docker CLI (for DooD: allows starting sandbox containers via host Docker socket)
COPY --from=docker:cli /usr/local/bin/docker /usr/local/bin/docker

EXPOSE 8001

CMD ["sh", "-c", "cd backend && npm run gateway:dev"]

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
# Clean image without build tools — reduces size and attack surface.
FROM node:22-slim

# Install Docker CLI (for DooD: allows starting sandbox containers via host Docker socket)
COPY --from=docker:cli /usr/local/bin/docker /usr/local/bin/docker

# Set working directory
WORKDIR /app

# Copy backend with pre-built dist/ from builder
COPY --from=builder /app/backend ./backend

# Remove node_modules (reproduction install with only production deps)
RUN cd backend && npm ci --omit=dev

# Expose Gateway API port.
EXPOSE 8001

# Default command (can be overridden in docker-compose)
CMD ["sh", "-c", "cd backend && SCITOPS_PORT=8001 node --experimental-vm-modules scripts/gateway_server.mjs"]
