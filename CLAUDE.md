# CLAUDE.md

This file provides concise operational guidance when working in this repository. [AGENTS.md](./AGENTS.md) is the authoritative contributor guide, and [systems-requirements/README.md](./systems-requirements/README.md) holds the v1.0 specifications and visual reference atlas (`REF-01`–`REF-14`).

## What this repo is

**`HERMES // OS`** is a personal daily-driver **Second Brain & Life Operations** monorepo comprising:

1. **`backend/` (Rust 2024 Cargo Workspace)**: 4 crates (`hermes-domain`, `hermes-life-ops`, `hermes-intelligence`, `hermes-server`) powered by Axum, Tokio, SQLx (`PostgreSQL 16 + pgvector`), and `Redis 7`. Exposes `/api/*` REST + SSE, `/api/openapi.json` (`utoipa`), a native Rust `/mcp` server (`rmcp`) across 7 Life Ops domains (`dashboards`, `todos`, `routines`, `goals`, `courses`, `finance`, `servers`), a streaming bridge to Nous Research's `hermes gateway` (`HERMES_GATEWAY_URL`, default `http://127.0.0.1:8642/v1`, with deterministic `offline_mock` fallback), and production static SPA hosting over `apps/web/dist` on `:8080`.
2. **`packages/ui` & `packages/api-client`**: Shared `REF-02` `0px` rectilinear Tactical FUI design system (`#08080B` / `#F87C18` / `#F6F6F4`), pixelated `PNG + JSON` sprite renderers (`Frieren` & `Isometric Knights`), and OpenAPI 3.1 TypeScript SDK.
3. **`apps/web`**: 100% client-rendered Vite + React 19 Web SPA (`apps/web/dist`) implementing Room Monitor (`/dashboard`, `/monitor`), Hermes Chat (`/hermes`), Agent Studio Knights (`/agents`), omnipresent `Cmd+J` Frieren, Todos (`/todos`), Routines (`/routines`), Yearly Goals (`/goals`), Courses (`/courses`), and Finance Operator (`/finance`).
4. **`apps/mobile`**: Offline-first Capacitor + Vite React CSR mobile companion app strictly scoped to `ROUTINES`, `TODOS`, `COMPANION`, and `UPLINK_CONFIG` using local SQLite + `UUIDv7` `/api/sync/*` delta sync.
5. **Preserved Subsystems & Local Data**: Python `crawlers/` (`youtube-lists`, `youtube-ai`, `youtube-clean`), `scripts/`, and `sub-systems/` remain intact. `data/` (`second-brain/`, `knowledge-data/`, `database/`) is strictly gitignored (`git ls-files data/` must always be empty).

## Commands

### Container infrastructure (repo root)
```bash
podman-compose up -d postgres redis   # start PostgreSQL 16 (pgvector) + Redis 7 for local dev
podman-compose up -d                  # full unified stack (postgres, redis, hermes-server on :8080)
podman-compose logs -f hermes-server
podman-compose down
```

### Rust backend (`backend/`)
```bash
cd backend
cargo check --workspace
cargo test --workspace
cargo run --bin server                # http://127.0.0.1:8080
```

### TypeScript workspace (repo root — always invoke `corepack pnpm@10.34.7`)
```bash
corepack pnpm@10.34.7 install
corepack pnpm@10.34.7 -r typecheck
corepack pnpm@10.34.7 -r test
corepack pnpm@10.34.7 -r build
corepack pnpm@10.34.7 --filter @hermes/web dev      # http://127.0.0.1:5173
corepack pnpm@10.34.7 --filter @hermes/mobile dev   # http://127.0.0.1:5174
```

### Vault & Dropbox sync (repo root)
```bash
./scripts/download_brain.sh
./scripts/sync_dropbox.sh status
```

## Critical Rules & Conventions

- **Toolchain invariants**: Always use `corepack pnpm@10.34.7` (`typescript: "~5.8.3"`). Avoid Rust crate features requiring `cmake` or `clang`/`aws-lc-sys`; use runtime `sqlx::query` / `sqlx::query_as` + `sqlx::migrate!`.
- **Read-only crawler boundary**: Open `data/database/youtube-lists.sqlite` strictly with `SQLITE_OPEN_READ_ONLY`—never mutate crawler SQLite files.
- **Tactical FUI & Mobile scope**: Enforce `border-radius: 0px` everywhere and `>= 12px` interactive font sizes; keep `apps/mobile` strictly limited to `ROUTINES`, `TODOS`, `COMPANION`, and `UPLINK_CONFIG`.
- **Privacy & Git**: Never track or stage anything under `data/` (`git ls-files data/` must be empty). Secrets belong in `.env` (no inline `#` comments on active `KEY=value` lines); follow Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
