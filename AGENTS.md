# 🤖 AGENTS.md — Agent & Contributor Guide (`HERMES // OS`)

Welcome to the **`HERMES // OS` — Personal Life Manager (Second Brain)** repository. This document establishes technical context, architectural standards, development workflows, and operational rules for AI agents and human contributors working within this codebase.

---

## 📌 1. Project Overview & Philosophy

**`HERMES // OS`** is a daily-driver **Second Brain & Life Operations** system engineered to:
1. **Capture** external knowledge, playlists, notes, and quick-capture action items (`crawlers/`, Web `Cmd+K`, and Mobile Companion).
2. **Organize** structured life operations across todos, routines, OKR goals, courses, multi-market finance, and server infrastructure (`backend/crates/life-ops`, `apps/web`, `apps/mobile`, `data/second-brain/`).
3. **Distill** intelligence through Nous Research's `hermes gateway` (`http://127.0.0.1:8642/v1`), semantic `pgvector` retrieval, YouTube AI note distillation (`crawlers/youtube-ai`), and the native Rust `/mcp` tool server (`backend/crates/intelligence`).
4. **Express** actionable execution via the Multi-Dashboard Room Monitor (`/dashboard`, `/monitor`), Pomodoro/Stopwatch Focus Timer, `Q1–Q4` Yearly Blueprint, and Weekly Markdown Vault Reviews.

---

## 🏗️ 2. Repository Architecture & Layout

This repository is organized as a polyglot Rust + TypeScript + Python monorepo with strict module boundaries:

```text
personal-life-manager/
├── backend/                     # Unified multi-crate Rust 2024 Cargo workspace
│   ├── crates/
│   │   ├── domain/              # Pure models, UUIDv7 IDs, i64 cents, Decimal, utoipa OpenAPI schemas
│   │   ├── life-ops/            # SQLx (PostgreSQL 16 + pgvector) repos & Life Ops engines (03, 07-11, Auth, Sync)
│   │   ├── intelligence/        # hermes gateway SSE/runs client, rmcp /mcp server, Knights runner, Vault watcher
│   │   └── server/              # Axum HTTP/SSE binary (:8080), /api/*, /mcp, and ServeDir over apps/web/dist
│   └── migrations/              # SQLx PostgreSQL 16 + pgvector schema & seed migrations
├── packages/
│   ├── api-client/              # @hermes/api-client — OpenAPI 3.1 generated TypeScript SDK & TanStack Query hooks
│   └── ui/                      # @hermes/ui — REF-02 0px Tactical FUI design system, charts, HUD loaders & sprites
├── apps/
│   ├── web/                     # @hermes/web — 100% client-rendered Vite + React 19 Web SPA (-> apps/web/dist)
│   └── mobile/                  # @hermes/mobile — Capacitor + Vite React CSR offline-first SQLite companion app
├── crawlers/                    # Python data collectors (youtube-lists, youtube-ai, youtube-clean)
├── infra-deploy/                # Multi-stage Dockerfile, Compose files, and initdb/01-pgvector.sql
├── scripts/                     # Vault & Dropbox sync scripts (download_brain.sh, sync_dropbox.sh, git-hooks/)
├── sub-systems/                 # Standalone bots and calculation tools (auto-players, satisfatory-plan)
├── systems-requirements/        # Authoritative v1.0 specifications (01-12) and visual reference atlas (REF-01..14)
├── documentation/               # High-level architecture and CODE methodology guides
├── data/                        # [GITIGNORED — ZERO TRACKED FILES] Local private data
│   ├── second-brain/            # Clone of the Obsidian Second Brain Markdown vault
│   ├── knowledge-data/          # Crawler Markdown notes (e.g. lists/youtube/)
│   └── database/                # Crawler SQLite databases (e.g. youtube-lists.sqlite)
├── mise.toml                    # Toolchain manager config (Rust, Node 24, pnpm 10.34.7)
├── package.json                 # Root pnpm@10.34.7 workspace manifest
├── pnpm-workspace.yaml          # Workspace globs (apps/*, packages/*)
└── podman-compose.yml           # Root orchestrator (postgres, redis, hermes-server)
```

### Module Responsibilities & Tech Stacks

| Module | Primary Language / Stack | Role & Purpose | Key Entrypoints / Specs |
| :--- | :--- | :--- | :--- |
| **`backend/`** | Rust `1.95` (`2024` edition), Axum, Tokio, SQLx, `rmcp`, `utoipa` | Unified REST + SSE API, `/mcp` Streamable HTTP server (7 Life Ops domains), `hermes gateway` bridge, and static SPA server. | `backend/Cargo.toml`, `backend/crates/server/src/main.rs` |
| **`packages/ui`** | TypeScript `~5.8.3`, React 19, Tailwind CSS v4 | Shared `REF-02` `0px` rectilinear Tactical FUI tokens, HUD loaders (`REF-08`–`12`), charts (`REF-06`–`07`), and pixelated `PNG + JSON` sprite renderers (`REF-13`, `REF-14`). | `packages/ui/src/index.ts`, `packages/ui/src/styles.css` |
| **`packages/api-client`** | TypeScript `~5.8.3`, `@hey-api/openapi-ts`, TanStack Query v5 | Shared OpenAPI 3.1 client SDK and query helpers consumed by both `apps/web` and `apps/mobile`. | `packages/api-client/src/index.ts` |
| **`apps/web`** | Vite 7, React 19, TanStack Router, TanStack Query v5, Zustand | 100% client-rendered Web SPA covering Room Monitor (`03`), Hermes (`04`), Knights (`05`), Frieren (`06`), Todos (`07`), Routines (`08`), Goals (`09`), Courses (`10`), and Finance (`11`). | `apps/web/src/main.tsx`, `apps/web/vite.config.ts` |
| **`apps/mobile`** | Capacitor 8, Vite 7, React 19, `@capacitor-community/sqlite`, `sql.js` | Offline-first companion app strictly scoped to `ROUTINES`, `TODOS`, `COMPANION`, and `UPLINK_CONFIG` with `UUIDv7` delta sync (`/api/sync/*`). | `apps/mobile/capacitor.config.ts`, `apps/mobile/src/App.tsx` |
| **`crawlers/`** | Python 3 | YouTube playlist/transcript collectors (`youtube-lists`, `youtube-ai`, `youtube-clean`) and standardized content crawlers. | `crawlers/README.md`, `crawlers/template_crawler.py` |
| **`infra-deploy/`** | Podman / Docker Compose | PostgreSQL 16 (`pgvector/pgvector:pg16`), Redis 7 (`redis:7-alpine`), and multi-stage `hermes-server` image. | `infra-deploy/Dockerfile`, `podman-compose.yml` |
| **`scripts/`** | Bash / Python | Obsidian vault sync (`./scripts/download_brain.sh`), Dropbox sync (`./scripts/sync_dropbox.sh`), and secret-guard git hooks. | `scripts/README.md`, `scripts/git-hooks/pre-commit` |

---

## ⚙️ 3. Development Environment & Host Rules

- **Rust**: `rustc` / `cargo` `1.95+` (`edition = "2024"`, `resolver = "3"`).
  - Avoid crate features requiring `cmake` or `clang`/`bindgen`/`aws-lc-sys` (use `rustls` with `ring` or system OpenSSL; never enable `rmcp` `auth-client-credentials-jwt`).
  - Use `sqlx::migrate!("../../migrations")` + runtime `sqlx::query` / `sqlx::query_as` (`FromRow`) rather than compile-time `sqlx::query!` macros.
- **Node.js & pnpm**: Node.js `24` LTS + **`corepack pnpm@10.34.7`** (`"packageManager": "pnpm@10.34.7"`, `typescript: "~5.8.3"`). Always invoke `corepack pnpm@10.34.7` rather than unpinned `pnpm`.
- **Containers**: Rootless `podman` & `podman-compose` (or Docker Compose) running PostgreSQL 16 (`:5432`) and Redis 7 (`:6379`).
- **Python**: Python `3.10+` for `crawlers/` and `scripts/git-hooks/pre-commit`.

---

## 🚀 4. Common Commands & Workflows

### 4.1. Infrastructure & Container Stack (Podman / Docker)

From the repository root:
```bash
# Start PostgreSQL 16 (pgvector) and Redis 7 for local development
podman-compose up -d postgres redis

# Build and start full unified stack (postgres, redis, hermes-server on :8080)
podman-compose up -d

# Check container health and status
podman-compose ps

# Tail unified server logs
podman-compose logs -f hermes-server

# Stop stack
podman-compose down
```

### 4.2. Rust Backend (`backend/`)

Working directory: `backend`
```bash
# Typecheck all 4 workspace crates (domain, life-ops, intelligence, server)
cargo check --workspace

# Run unit and integration tests across workspace
cargo test --workspace

# Run unified server locally (http://127.0.0.1:8080)
cargo run --bin server
```

### 4.3. TypeScript Monorepo (`packages/*` & `apps/*`)

From the repository root:
```bash
# Install workspace dependencies with locked pnpm version
corepack pnpm@10.34.7 install

# Typecheck, test, and build all workspace packages/apps
corepack pnpm@10.34.7 -r typecheck
corepack pnpm@10.34.7 -r test
corepack pnpm@10.34.7 -r build

# Start Web SPA Vite HMR dev server (http://127.0.0.1:5173, proxies /api & /mcp -> :8080)
corepack pnpm@10.34.7 --filter @hermes/web dev

# Start Mobile Companion Vite dev server (http://127.0.0.1:5174)
corepack pnpm@10.34.7 --filter @hermes/mobile dev
```

### 4.4. Obsidian Vault & Dropbox Sync

From the repository root:
```bash
# Synchronize private Obsidian vault into gitignored data/second-brain/
./scripts/download_brain.sh

# Push/pull local data/ with Dropbox via rclone
./scripts/sync_dropbox.sh check
```

---

## 📐 5. Code Standards & Architecture Guidelines

### 5.1. Rust Backend Guidelines (`backend/`)
- **Crate Boundaries**:
  - `hermes-domain`: Pure domain structs/enums, `UUIDv7` identifiers, `i64` integer cent money values, `rust_decimal::Decimal` quantities/rates, `utoipa::ToSchema` types, and broadcast event payloads.
  - `hermes-life-ops`: PostgreSQL + `pgvector` repositories, `SHA-256` PAT auth (`plm_pat_...`), 8-table mobile delta sync (`sync_change_log`), concurrent Tokio TCP (`3s`)/HTTP (`4s`) Server Prober, Obsidian Markdown export, and **strictly read-only** (`SQLITE_OPEN_READ_ONLY`) `youtube-lists.sqlite` imports.
  - `hermes-intelligence`: `hermes gateway` (`HERMES_GATEWAY_URL`, `X-Hermes-Session-Key`) streaming client with deterministic `offline_mock` fallback when `:8642` is offline, native Rust `/mcp` server (`rmcp`) exposing all 7 Life Ops domains under 3-tier write autonomy (`READ`, `IMMEDIATE_UNDO`, `REQUIRE_APPROVAL`), and Knight scheduler.
  - `hermes-server`: Axum router (`/api/*`, `/mcp`, `/api/openapi.json`) and `tower-http::services::ServeDir` static hosting over `STATIC_DIST_DIR` (`apps/web/dist`) with SPA `index.html` fallback.

### 5.2. Web SPA & Mobile Companion Guidelines (`packages/*`, `apps/*`)
- **100% Client-Side Rendering (CSR)**: Both `apps/web` and `apps/mobile` compile via Vite into pure client-rendered static bundles (`dist/index.html` + hashed assets) with zero SSR runtime.
- **Tactical FUI Design Language (`REF-02`)**:
  - Enforce `border-radius: 0px` across all panels, buttons, inputs, modals, badges, and charts.
  - Core palette: `#08080B` (carbon ground), `#F87C18` (blaze orange accent), `#F6F6F4` (stark white ink), `#2CE5F2` (cyan telemetry), `#A8F040` (phosphor nominal).
  - Interactive controls maintain a `>= 12px` computed font-size floor; pixel-art sprites (`<CompanionStage />` Frieren & Isometric Knights) render from `PNG + JSON` descriptors with integer zoom and `image-rendering: pixelated`.
- **Strict Mobile Scope (`02-companion-app.md`)**: `apps/mobile` exposes **only** `ROUTINES`, `TODOS`, `COMPANION`, and `UPLINK_CONFIG`—never include routes or views for Web-only modules (`03`, `04`, `05`, `09`, `10`, `11`).

### 5.3. Crawlers & Document Contracts (`crawlers/`)
- Preserve existing `crawlers/youtube-lists`, `crawlers/youtube-ai`, and `crawlers/youtube-clean` workflows untouched. Backend Course Tracker reads `data/database/youtube-lists.sqlite` strictly via `SQLITE_OPEN_READ_ONLY` (never creating or mutating crawler SQLite files) alongside Markdown notes in `data/knowledge-data/lists/youtube/`.
- Generic web/RSS crawlers normalize captured documents into the standard ingestion schema:
```json
{
  "id": "urn:source:unique-id",
  "source": "hackernews | rss | pocket | custom",
  "url": "https://example.com/article",
  "title": "Article Title",
  "author": "Author Name",
  "published_at": "ISO-8601 Timestamp",
  "fetched_at": "ISO-8601 Timestamp",
  "raw_content": "<p>Original HTML or text...</p>",
  "clean_content": "Extracted readable Markdown text...",
  "metadata": {
    "tags": ["productivity", "architecture"],
    "language": "en"
  }
}
```

---

## 🔒 6. Privacy, Security & Git Conventions

1. **Strict `data/` Zero-Tracking Privacy**:
   - `data/` (`second-brain/`, `knowledge-data/`, `database/`) holds private Obsidian notes, crawler outputs, and SQLite databases and is ignored via `/data/` in `.gitignore` (`.agents/` is also gitignored).
   - **Never** add, stage, or commit any file inside `data/` (`git ls-files data/` must always output zero lines).
2. **Environment & Secrets**:
   - Secrets belong only in `.env` (gitignored). Never place inline `#` comments on active `KEY=value` lines in `.env` or `.env.example` (bash crawler/sync parsers read everything after `=`).
   - Run `python3 scripts/git-hooks/pre-commit` (or configure `git config core.hooksPath scripts/git-hooks`) to block accidental secret or `.sqlite`/`.db` commits.
3. **Commit Messages**:
   - Follow **Conventional Commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
4. **Verification Before Completion**:
   - Before concluding changes, verify `cd backend && cargo check --workspace && cargo test --workspace`, `corepack pnpm@10.34.7 -r typecheck && corepack pnpm@10.34.7 -r test && corepack pnpm@10.34.7 -r build`, and empty `git ls-files data/`.
