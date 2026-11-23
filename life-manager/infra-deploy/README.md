# Infrastructure & Deployment (`HERMES // OS`)

This directory contains multi-stage container definitions, compose orchestrators, and database initialization scripts for running the unified **`HERMES // OS`** Second Brain & Life Operations platform.

---

## 📦 Services Overview

The unified compose stack (`name: hermes-os`) runs 3 core services:
1. **`postgres`** (`docker.io/pgvector/pgvector:pg16` on port `5432`): Primary PostgreSQL 16 relational store with `pgvector` automatically enabled on first boot via `initdb/01-pgvector.sql` (`user: hermes`, `db: hermes_os`).
2. **`redis`** (`docker.io/library/redis:7-alpine` on port `6379`): In-memory cache, quote/FX buffer, and background event coordination.
3. **`hermes-server`** (multi-stage Rust `1.95` + Vite React CSR build on port `8080`): Unified Axum HTTP/SSE server hosting `/api/*`, `/mcp` (`rmcp` Streamable HTTP), `/api/openapi.json`, and the compiled 100% client-rendered Web SPA (`apps/web/dist`), mounting `./data:/app/data` for read-only crawler SQLite/Markdown imports and Obsidian Second Brain vault exports.

---

## 🚀 Running with Podman

### Local Development (Database & Cache Only)
From the repository root:
```bash
# Start PostgreSQL 16 (pgvector) and Redis 7 in the background
podman-compose up -d postgres redis

# Check container health
podman-compose ps
```

### Full Production Stack
From the repository root:
```bash
# Build and start postgres, redis, and unified hermes-server
podman-compose up -d

# Tail unified server logs
podman-compose logs -f hermes-server

# Stop stack
podman-compose down
```

Or deploy directly from `infra-deploy/` (explicitly pass `-f` so a single compose file is loaded):
```bash
cd infra-deploy
podman-compose -f podman-compose.yml up -d
```

---

## 🌐 Endpoints

- **Web SPA & Unified Server**: `http://localhost:8080`
- **API Health Check**: `http://localhost:8080/api/health`
- **OpenAPI 3.1 Spec**: `http://localhost:8080/api/openapi.json`
- **MCP Server (`rmcp`)**: `http://localhost:8080/mcp`
- **PostgreSQL 16 (`pgvector`)**: `127.0.0.1:5432` (`hermes_os`)
- **Redis 7**: `127.0.0.1:6379`
