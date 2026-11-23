# 01 — Architecture & Tech Stack (`HERMES // OS`)

> **Status**: Locked v1.0
> **Core Mandate**: **Rust** Multi-Crate Backend (`Axum` + `SQLx` + `/mcp`) + **`hermes gateway`** AI Engine + **100% Client-Rendered React SPA** + **Capacitor Offline-First Mobile App**

---

## 1. Locked Architectural Decisions

1. **Clean Replacement of Legacy Prototypes**:
   - **Replaces** `personal-system/` (Go + Next.js 16) and the `hermes/` 31-line Python stub completely.
   - **Preserves** the working Python `crawlers/` (`youtube-lists`, `youtube-ai`, `youtube-clean`), reading their SQLite (`data/database/youtube-lists.sqlite`) and Markdown (`data/knowledge-data/`) outputs directly from Rust.
2. **100% Client-Side Rendered (CSR) Web SPA Served by Axum in Prod**:
   - `apps/web` compiles via Vite to pure static HTML/JS/CSS (`dist/`)—zero SSR, zero Next.js server components.
   - In development, Vite runs with instant HMR; in production (`podman-compose.yml`), **Axum serves `apps/web/dist` directly** (`tower-http::services::ServeDir` with SPA `index.html` fallback), yielding a single unified app container alongside PostgreSQL 16 (`pgvector`) and Redis 7.
3. **`hermes gateway` + Rust `/mcp` Bridge (Unified AI Engine)**:
   - Instead of reinventing LLM provider loops from scratch, all AI surfaces—**Hermes Chat (`04`)**, **Agent Studio Knights (`05`)**, and **Frieren Companion (`06`)**—route through **Nous Research's `hermes gateway`** (`HERMES_GATEWAY_URL`, default `http://127.0.0.1:8642/v1`, using `/v1/chat/completions`, `/v1/runs`, and `X-Hermes-Session-Key`).
   - Our Rust backend exposes a native **MCP server endpoint (`/mcp` via `rmcp`)** exposing structured tools across Life Ops (`todos`, `routines`, `goals`, `courses`, `finance`, `dashboards`, `servers`) so `hermes gateway` reads and controls the entire system natively alongside its own `SOUL.md` personas, `SKILL.md` skills, and Obsidian Vault tools.
4. **Shared TypeScript & FUI Component Workspace**:
   - `utoipa` generates an OpenAPI 3.1 spec from Rust handlers/structs -> `@hey-api/openapi-ts` generates typed clients & TanStack Query hooks in `packages/api-client`.
   - `packages/ui` houses the `REF-02` Tactical FUI CSS/Tailwind primitives, SVG HUD loaders (`REF-09`..`REF-12`), and `<CompanionStage />` pixel-art Frieren engine—shared 100% verbatim across `apps/web` and `apps/mobile` (Capacitor).

---

## 2. Locked Tech Stack

### 2.1. Rust Backend (`backend/` — Multi-Crate Cargo Workspace)
- **Toolchain & Runtime**: **Rust Stable (2024 edition)** (`mise.toml`) + **Tokio** async runtime.
- **Web, SSE/WS & Static Hosting**: **Axum** + `tower` + `tower-http` (`CorsLayer`, `TraceLayer`, `CompressionLayer`, `ServeDir`).
- **Database**: **PostgreSQL 16 + `pgvector`** via **`sqlx`** (compile-time verified SQL + `sqlx migrate`), plus read-only `sqlx`/`rusqlite` pool for `data/database/youtube-lists.sqlite`.
- **MCP & AI Gateway Bridge**: **`rmcp`** (Rust Model Context Protocol server at `/mcp`) + typed async `reqwest` + `eventsource-stream` client bridging SSE streams and `X-Hermes-Session-Key` state to **`hermes gateway` (`:8642/v1`)**.
- **Scheduling, Events & Watchers**:
  - `tokio::sync::broadcast` typed domain event bus (drives live Room Monitor Dashboard SSE updates & Knight triggers).
  - `tokio-cron-scheduler` + Redis 7 for scheduled Knight runs, custom dashboard command polling, market quote refreshes, and TCP/HTTP server health probing.
  - `notify` crate watching `data/second-brain/` & `data/knowledge-data/`.
- **Precision & Schemas**: `i64` minor units (cents) + `rust_decimal` for portfolio/FI math; `utoipa` + `serde` + `schemars`.

### 2.2. Frontend & Mobile Workspace (`pnpm` Workspaces)
- **`apps/web`**: **Vite** + **React 19** + **TypeScript 5** + **TanStack Router** + **TanStack Query v5** + **Zustand** + **Tailwind CSS v4** (`0px` FUI tokens).
- **`apps/mobile`**: **Capacitor** (Android primary, iOS-compatible) wrapping a focused Vite React CSR bundle + `@capacitor-community/sqlite` + SecureStorage + NetInfo.
- **`packages/ui`**: Shared `REF-02` FUI components, SVG HUD rings, Canvas2D telemetry charts, and `<CompanionStage />` sprite renderer.
- **`packages/api-client`**: Auto-generated OpenAPI TypeScript SDK.

---

## 3. Repository Layout

```text
personal-life-manager/
├── backend/                    # Multi-crate Rust Cargo workspace
│   ├── Cargo.toml
│   ├── migrations/             # SQLx PostgreSQL + pgvector migrations
│   └── crates/
│       ├── server/             # Axum binary, REST, SSE, /mcp endpoint, SPA ServeDir
│       ├── domain/             # Shared structs, enums, utoipa OpenAPI schemas
│       ├── life-ops/           # Dashboards, Todos, Routines, Goals, Courses, Finance, Sync, Prober
│       └── intelligence/       # hermes-gateway client, /mcp tool registry, Vault sync, Knight runner
├── apps/
│   ├── web/                    # 100% CSR React SPA (Desktop Command Deck + /monitor Kiosk)
│   └── mobile/                 # Capacitor Offline-First Companion App (Todos, Routines, Frieren)
├── packages/
│   ├── ui/                     # Shared REF-02 Tactical FUI & Pixel-Art Sprite components
│   └── api-client/             # Auto-generated OpenAPI TypeScript types & query hooks
├── crawlers/                   # [KEEP] Working Python crawlers (youtube-lists, youtube-ai, etc.)
├── infra-deploy/               # Podman Compose (Postgres+pgvector, Redis, Rust+SPA)
├── scripts/                    # Vault & Dropbox sync scripts
├── sub-systems/                # Standalone bots & tools
├── systems-requirements/       # Locked v1.0 Markdown specifications & visual atlas
└── data/                       # [GITIGNORED] second-brain/, knowledge-data/, database/
```

---

## 4. Auth, Offline Sync & Boot Screen

- **Auth & PATs**: Web session auth (`argon2` + cookie/JWT) + revocable `SHA-256`-hashed **Personal Access Tokens (`plm_pat_...`)** in `api_tokens` for the Companion App (`GET /api/health`, `GET /api/auth/verify`).
- **Scoped Delta Sync (`/api/sync/push` & `/api/sync/pull`)**: Syncs **only** Todo (`07`) & Routine (`08`) tables + `companion_offline_phrases` using client `UUIDv7` IDs and monotonic `server_seq` cursors.
- **Boot Astrolabe (`REF-09`)**: Renders the 3D-tilted blaze-orange orbital dial on SPA/Mobile cold boot with live readiness tags (`[1 // DB_ONLINE]` → `[2 // HERMES_GATEWAY]` → `[3 // READY]`).
