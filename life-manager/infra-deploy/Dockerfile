# syntax=docker/dockerfile:1

# =============================================================================
# Stage 1: Build 100% Client-Rendered Web SPA (apps/web/dist)
# =============================================================================
FROM docker.io/library/node:24-slim AS web-builder

ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

WORKDIR /app

COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/api-client/package.json ./packages/api-client/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/mobile/package.json ./apps/mobile/package.json

RUN corepack pnpm@10.34.7 install --frozen-lockfile

COPY packages/ ./packages/
COPY apps/web/ ./apps/web/

RUN corepack pnpm@10.34.7 --filter @hermes/web... build

# =============================================================================
# Stage 2: Build Multi-Crate Rust Backend (backend/crates/server)
# =============================================================================
FROM docker.io/library/rust:1.95-slim-bookworm AS rust-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    libsqlite3-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/ ./

RUN cargo build --release --bin server

# =============================================================================
# Stage 3: Minimal Unified Production Runtime (Axum + /mcp + Static Web SPA)
# =============================================================================
FROM docker.io/library/debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    libsqlite3-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=rust-builder /app/backend/target/release/server /app/server
COPY --from=web-builder /app/apps/web/dist /app/apps/web/dist

RUN mkdir -p /app/data/database /app/data/knowledge-data /app/data/second-brain

ENV PORT=8080 \
    RUST_LOG=info \
    STATIC_DIST_DIR=/app/apps/web/dist \
    YOUTUBE_LISTS_DB=/app/data/database/youtube-lists.sqlite \
    YOUTUBE_LISTS_NOTES_DIR=/app/data/knowledge-data/youtube \
    SECOND_BRAIN_DIR=/app/data/second-brain

EXPOSE 8080

# The health check lives in podman-compose.yml: podman builds OCI images, which have no HEALTHCHECK.

CMD ["/app/server"]
