# Project: HERMES // OS (Personal Life Manager)

## Architecture

`HERMES // OS` is a personal production daily-driver **Second Brain & Life Operations** system organized as a polyglot Rust + TypeScript monorepo:

1. **Unified Multi-Crate Rust Backend (`backend/`)**:
   - **Cargo Workspace (Rust 2024 edition, `rustc 1.95.0`)**:
     - `backend/crates/domain`: Pure domain models, reconciled enums, `UUIDv7` IDs, `i64` integer cent money types, `rust_decimal::Decimal` quantities/rates, `serde` + `schemars` + `utoipa::ToSchema` OpenAPI 3.1 schemas, and typed `tokio::sync::broadcast` system events.
     - `backend/crates/life-ops`: SQLx (`PostgreSQL 16 + pgvector`) repositories and domain engines for Auth & `SHA-256` Personal Access Tokens (`plm_pat_...`), Scoped Mobile Delta Sync (`sync_change_log`, `/api/sync/push`, `/api/sync/pull`), Multi-Dashboard Room Monitor (`03`) & Custom Widgets (`builtin`, `[Approve]`-gated `command`, `http`, read-only `sql`, `hermes`), concurrent Tokio TCP/HTTP Server Health Prober, Todo List & Stopwatch/Pomodoro Focus Timer (`07`), Routine Planning & `data/second-brain/` Obsidian Markdown exporter (`08`), Yearly Goals OKR rollups & `90°` orthogonal blueprint router (`09`), Course Tracker with strictly read-only `youtube-lists`/`youtube-ai` SQLite/Markdown importer & `7d/30d/90d` Spaced Review engine (`10`), and Multi-Market `BRL`+`USD` Finance Operator & FIRE simulator (`11`).
     - `backend/crates/intelligence`: Nous Research `hermes gateway` client (`HERMES_GATEWAY_URL`, default `http://127.0.0.1:8642/v1` via `/v1/chat/completions`, `/v1/runs`, and `X-Hermes-Session-Key`) with deterministic degraded/mock fallback (`hermes_gateway: "offline_mock"`) when `:8642` is offline; native Rust `/mcp` server (`rmcp` Streamable HTTP) exposing all 7 Life Ops domains (`dashboards`, `todos`, `routines`, `goals`, `courses`, `finance`, `servers`) under a 3-tier write safety model (`READ`, `IMMEDIATE_UNDO`, `REQUIRE_APPROVAL`); `tokio-cron-scheduler` & event-driven Agent Studio Knight runner (`05`); Vault note inspector & `notify` watcher (`04`, `06`).
     - `backend/crates/server`: Axum HTTP binary serving `/api/*` REST + SSE (`/api/events/stream`, `/api/hermes/chat/stream`), `/mcp`, `/api/openapi.json`, and production static SPA hosting via `tower-http::services::ServeDir` over `apps/web/dist` with SPA `index.html` fallback for non-`/api`, non-`/mcp` deep links.
2. **Shared TypeScript Packages (`packages/`)**:
   - `packages/api-client`: Auto-generated OpenAPI 3.1 TypeScript SDK & TanStack Query v5 helpers derived from `utoipa`'s OpenAPI spec, shared verbatim by `apps/web` and `apps/mobile`.
   - `packages/ui`: Shared `REF-02` `0px` rectilinear Tactical FUI design system (`#08080B` carbon, `#F87C18` blaze orange, `#F6F6F4` stark white), `REF-10` 5-layer `<SystemApertureLogo />`, `REF-09` `<OrbitalBootScreen />`, `REF-08` `<GeodesicThinkingOrb />`, `REF-11`/`REF-12` HUD loaders & micro-icons, Canvas2D/SVG telemetry & finance charts (`REF-06`, `REF-07`), and the integer-scaled `image-rendering: pixelated` `PNG + JSON` sprite engine (`<CompanionStage />` Frieren `REF-14`/`REF-14b` + `REF-13` Isometric Knights).
3. **100% Client-Side Rendered Web SPA (`apps/web`)**:
   - Vite + React 19 + TypeScript `~5.8.3` + TanStack Router + TanStack Query v5 + Zustand + Tailwind CSS v4 producing pure client-rendered static assets (`apps/web/dist`, zero SSR runtime) implementing `/dashboard`, `/monitor` (`03`), `/hermes` (`04`), `/agents` (`05`), omnipresent `Cmd+J` Frieren (`06`), `/todos` (`07`), `/routines` (`08`), `/goals` (`09`), `/courses` (`10`), and `/finance` (`11`).
4. **Offline-First Capacitor Mobile Companion App (`apps/mobile`)**:
   - Capacitor (`@capacitor/core`, `@capacitor/cli`, Android primary / iOS-compatible) + Vite React CSR sharing `packages/ui` and `packages/api-client`, strictly scoped to `ROUTINES`, `TODOS`, `COMPANION`, and `UPLINK_CONFIG` (zero routes/views/imports for `03`, `04`, `05`, `09`, `10`, `11`). Uses local SQLite (`@capacitor-community/sqlite` + `sql.js`/IndexedDB Web/test adapter) with `UUIDv7` keys, `sync_outbox` + `sync_meta`, Primary/Fallback Server URL failover, encrypted Bearer PAT, range-triggered `/api/sync/push` & `/api/sync/pull?since=last_seq`, and Dual-Mode Frieren (online live SSE chat vs offline random pixel-art loops + random motivational phrases).
5. **Preserved Subsystems & Strict Privacy**:
   - Python `crawlers/` (`youtube-lists`, `youtube-ai`, `youtube-clean`), `scripts/`, and `sub-systems/` remain completely intact; `personal-system/` is completely deleted; `hermes/` Python stub remains absent; `data/` has **zero** tracked or staged files in Git (`git ls-files data/` is empty).

### Host Toolchain & Build Rules (Verified in Survey)
- **Rust**: `/usr/bin/rustc` & `/usr/bin/cargo` `1.95.0`. `cmake`, `clang`, and `sqlx-cli` are NOT installed on host (`gcc 15.2.0` + `pkg-config` + `openssl 3.6.5` + `sqlite3 3.53.4` ARE installed). Therefore:
  - Avoid crate features requiring `cmake` or `bindgen`/`aws-lc-rs` (use `rustls` with `ring` or `native-tls` with system OpenSSL; do NOT enable `rmcp` `auth-client-credentials-jwt`).
  - Use `sqlx::migrate!("../../migrations").run(&pool).await` + runtime `sqlx::query` / `sqlx::query_as` (`FromRow`), NOT compile-time `sqlx::query!` macros.
- **Node & pnpm**: `/usr/bin/node` `v24.21.0`. Always invoke **`corepack pnpm@10.34.7`** (and pin `"packageManager": "pnpm@10.34.7"` in root `package.json`; unpinned `pnpm@12` crashes Corepack `0.24.0`). Pin `typescript` to `~5.8.3`.
- **Containers**: Rootless `podman` `5.8.6` & `podman-compose` `5.8.6` (`docker.io/pgvector/pgvector:pg16` cached locally; `docker.io/library/redis:7-alpine`). Host `postgres` & `redis-server` binaries are absent—always run PostgreSQL 16 (`:5432`) and Redis 7 (`:6379`) via Podman.
- **Headless Browser**: `/usr/bin/google-chrome` (`157.0.8103.78`) verified with `executablePath: '/usr/bin/google-chrome'` and `args: ['--no-sandbox', '--disable-gpu']` for Playwright DOM/style & E2E suites.

---

## Code Layout & Exclusive Write Ownership

```text
personal-life-manager/
├── backend/                        # [Owner: M2] Cargo workspace (crates: domain, life-ops, intelligence, server) + migrations/
├── packages/
│   ├── api-client/                 # [Owner: M2] utoipa OpenAPI 3.1 generated TypeScript SDK & hooks
│   └── ui/                         # [Owner: M3] Shared REF-02 Tactical FUI components, charts, HUD loaders & PNG+JSON sprites
├── apps/
│   ├── web/                        # [Owner: M4] 100% CSR Vite + React 19 Web SPA -> builds apps/web/dist
│   └── mobile/                     # [Owner: M5] Capacitor + Vite React CSR offline-first mobile companion app
├── e2e/                            # [Owner: E2E Track] Standalone opaque-box E2E test runner & Tiers 1-4 test suites
├── crawlers/                       # [READ-ONLY — DO NOT MODIFY] youtube-lists, youtube-ai, youtube-clean
├── scripts/                        # [READ-ONLY — DO NOT MODIFY] download_brain.sh, sync_dropbox.sh, git-hooks/
├── sub-systems/                    # [READ-ONLY — DO NOT MODIFY] satisfatory-plan, auto-players
├── systems-requirements/           # [READ-ONLY — DO NOT MODIFY] Authoritative v1.0 specs & assets/REF-01..14b
├── data/                           # [GITIGNORED — ZERO TRACKED FILES] second-brain/, knowledge-data/, database/
├── infra-deploy/                   # [Owner: M1, refined in M6] Dockerfile, podman-compose.yml
├── podman-compose.yml              # [Owner: M1, refined in M6] Root unified multi-container stack
├── mise.toml                       # [Owner: M1] Rust + Node + pnpm tool config
├── package.json / pnpm-workspace.yaml / tsconfig.base.json # [Owner: M1]
└── AGENTS.md / CLAUDE.md / README.md / .gitignore / .env.example # [Owner: M1]
```

| Milestone / Track | Exclusive Write Paths | Canonical Verification Commands |
| :--- | :--- | :--- |
| **`M1`** | Root configs (`.gitignore`, `mise.toml`, `.env.example`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `podman-compose.yml`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `documentation/`), `infra-deploy/**`, deletion of `personal-system/**`, initial scaffold manifests in `backend/`, `packages/*`, `apps/*` | `git ls-files data/`, `git status --porcelain`, `podman-compose up -d postgres redis`, `cargo check --workspace`, `corepack pnpm@10.34.7 -r typecheck` |
| **`M2`** | `backend/**`, `packages/api-client/**` | `cd backend && cargo check --workspace && cargo test --workspace`, `corepack pnpm@10.34.7 --filter @hermes/api-client typecheck && corepack pnpm@10.34.7 --filter @hermes/api-client build` |
| **`M3`** | `packages/ui/**` | `corepack pnpm@10.34.7 --filter @hermes/ui typecheck && corepack pnpm@10.34.7 --filter @hermes/ui test && corepack pnpm@10.34.7 --filter @hermes/ui build` |
| **`M4`** | `apps/web/**` | `corepack pnpm@10.34.7 --filter @hermes/web typecheck && corepack pnpm@10.34.7 --filter @hermes/web test && corepack pnpm@10.34.7 --filter @hermes/web build` |
| **`M5`** | `apps/mobile/**` | `corepack pnpm@10.34.7 --filter @hermes/mobile typecheck && corepack pnpm@10.34.7 --filter @hermes/mobile test && corepack pnpm@10.34.7 --filter @hermes/mobile build` |
| **`E2E`** | `e2e/**` (isolated `e2e/pnpm-workspace.yaml`), `TEST_INFRA.md`, `TEST_READY.md` | `cd e2e && corepack pnpm@10.34.7 typecheck` + runner dry-check |
| **`M6`** | Full-repo integration fixes across `backend/`, `packages/`, `apps/`, `podman-compose.yml`, `infra-deploy/`, plus Tier-5 adversarial tests | Full `TEST_READY.md` runner + `cargo test --workspace` + `corepack pnpm@10.34.7 -r build` + `corepack pnpm@10.34.7 -r test` + `git ls-files data/` |
| **`M9`** | `apps/web/**`, `e2e/tests/tier1/area-c-finance.spec.ts`, `e2e/tests/tier1/area-b-web-shell-ai-surfaces.spec.ts` | `corepack pnpm@10.34.7 -r typecheck && corepack pnpm@10.34.7 -r test && corepack pnpm@10.34.7 -r build && node e2e/run-e2e.mjs --dry-check && node e2e/run-e2e.mjs --tier 1 --file area-c-finance.spec.ts && git ls-files data/` |

---

## Feature Inventory

Every feature discovered during Survey is assigned to a concrete Milestone below (0 unassigned features):

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F01 | Legacy `personal-system/` Removal & `hermes/` Absence | Delete all 49 tracked files in `personal-system/`; keep `hermes/README.md` & `hermes/main.py` absent; keep `crawlers/` (`youtube-lists`, `youtube-ai`, `youtube-clean`), `scripts/`, `sub-systems/` intact. | M1 | R1, `01` §1.1 |
| F02 | Gitignore Traps & `data/` Zero-Tracking Hygiene | Remove bare `server` rule from `.gitignore`, add `.agents/`, `target/`, `.pnpm-store/`, `apps/mobile/{android,ios}/`; untrack `data/*/.gitkeep` (`git rm --cached`) keeping directories on disk so `git ls-files data/` is empty. | M1 | R1, Survey 1 |
| F03 | Docs, `mise.toml`, `.env.example` & Unified Podman Stack | Update `AGENTS.md`, `CLAUDE.md`, `README.md`, `mise.toml`, `.env.example` (preserving crawler env vars), `podman-compose.yml`, and `infra-deploy/` (`pgvector:pg16`, `redis:7-alpine`, unified Rust+SPA image); start local `postgres` & `redis` containers and scaffold monorepo workspaces. | M1 | R1, `01` §2–§3 |
| F04 | Multi-Crate Rust Workspace & SQLx `pgvector` Migrations | Implement `backend/crates/{domain,life-ops,intelligence,server}` (`edition = "2024"`) and numbered SQLx migrations in `backend/migrations/` covering all tables (`01`–`11`) + starter seed data (4 decks, 4 Starter Knights, offline phrases, retirement config, operator user). | M2 | R2, `01` §2–§3 |
| F05 | Static SPA Serving & SPA Fallback Routing | Axum serves `STATIC_DIST_DIR` (`apps/web/dist`) via `ServeDir` with `ServeFile("apps/web/dist/index.html")` fallback for client routes (`/dashboard`, `/monitor`, `/hermes`, etc.) while returning JSON `404` on unknown `/api/*`. | M2 | R2, `01` §1.2 |
| F06 | `utoipa` OpenAPI 3.1 Schema & `packages/api-client` Codegen | Derive `utoipa` schemas/paths across `domain` & `server`, expose `/api/openapi.json`, generate typed TypeScript client & hooks in `packages/api-client`, and enforce schema parity in `cargo test`. | M2 | R2, `01` §1.4 |
| F07 | Operator Auth, `SHA-256` PATs (`plm_pat_...`) & Pairing QR | Implement `GET /api/health`, `GET /api/auth/verify`, `argon2id` login/session, revocable `SHA-256`-hashed PAT CRUD (`/api/auth/tokens`), and Desktop QR pairing payload (`/api/auth/pairing-qr`). | M2 | R2, R5, `01` §4, `02` §5 |
| F08 | Scoped `UUIDv7` Mobile Delta Sync Backend | Implement monotonic `sync_change_log` (`server_seq`), `POST /api/sync/push` (append-only set-union + `updated_at` LWW), and `GET /api/sync/pull?since=last_seq` strictly over the 8 mobile tables. | M2 | R2, R5, `01` §4, `02` §4 |
| F09 | `hermes gateway` SSE Bridge & Offline Mock Resilience | Bridge `/api/hermes/chat/stream` and Knight `/v1/runs` via `HERMES_GATEWAY_URL` (`http://127.0.0.1:8642/v1`) forwarding `X-Hermes-Session-Key`, with clean degraded/mock status & deterministic SSE fallback when `:8642` is offline. | M2 | R2, R4, `01` §1.3, `04` |
| F10 | Native Rust `/mcp` (`rmcp`) Server & 3-Tier Autonomy Gate | Mount `rmcp` Streamable HTTP service at `/mcp` exposing all 7 Life Ops domains (`dashboards`, `todos`, `routines`, `goals`, `courses`, `finance`, `servers`) with `READ`, `IMMEDIATE_UNDO` (`mcp_undo_actions`), and `REQUIRE_APPROVAL` (`pending_mcp_approvals` edit/approve/reject). | M2 | R2, R4, `01` §1.3, `04`, `06` |
| F11 | Backend Room Monitor, Custom Widgets & Tokio Server Prober | Implement Dashboards & Widgets CRUD/clone/reorder, Life Score `0–100` 5-pillar engine, custom `command` (`[Approve]`-gated + timeout), `http`, read-only `sql`, and `hermes` panel executors, concurrent Tokio TCP (`3s`)/HTTP (`4s`) Server Prober, and `/api/events/stream` SSE bus. | M2 | R2, R3, `03` |
| F12 | Backend Agent Studio Knights, Vault Inspector & Nudges | Implement `agents`, `agent_triggers`, `agent_runs` CRUD, `HP` (`monthly_budget_cents` circuit breaker) & `EP` token load math, *Standby Barracks* pause, `SOUL.md` template rendering, cron/event triggers (`YoutubeCrawlerSynced`, `PortfolioPriceAlert`, `GoalPaceAtRisk`), Dry-Run Sandbox, Vault preview/distill, and Frieren proactive nudges. | M2 | R2, R4, `04`, `05`, `06` |
| F13 | Backend Todos, NLP Parser, Dependency Graph & Focus Timer | Implement Projects & Tasks CRUD, deterministic NLP quick-capture parser (`#tag @energy !priority tomorrow 90m`), DFS cycle rejection on `blocked_by_task_ids`, `TERMINAL-I/O` flow topology endpoint, and Stopwatch/Pomodoro `ActiveTimer` + `TimeSession` rollups. | M2 | R2, R4, `07` |
| F14 | Backend Routines, Habit Streaks, Ideal Week & Vault Export | Implement Routines, Habit items, `routine_logs`, Day Profiles (`workday/weekend/travel/minimum_viable`), cadence-aware streaks & `8×12` / `365d` analytics, Ideal Week blocks, Daily Check-ins, Weekly Review summary, and atomic Markdown export to `data/second-brain/{Daily,Reviews}/`. | M2 | R2, R4, `08` |
| F15 | Backend Yearly Goals, Live OKR Rollups & `90°` Blueprint Router | Implement `yearly_cycles`, `goals` (with Focus Cap check), `goal_key_results` (`Q1–Q4`, `numeric`, `milestones`, `binary`, `linked_course/finance/habit/project`), pace drift (`on_track/at_risk/off_track`), check-ins, and `REF-03` collision-free `90°` orthogonal blueprint layout endpoint. | M2 | R2, R4, `09` |
| F16 | Backend Course Tracker, Read-Only Crawler Import & Spaced Review | Implement 2-level `courses`/`course_modules`/`course_lessons`, pasted outline parser, strictly read-only (`SQLITE_OPEN_READ_ONLY`) `youtube-lists`/`youtube-ai` importer (handling missing DB, `-ref.md`, optional `ai_note`), 1-click Hermes Quiz session creator, lab Todo spawner, and `7d/30d/90d` Spaced Review scheduler. | M2 | R2, R4, `10` |
| F17 | Backend Finance Operator, Quote/FX Cache, Waffle, Rebalancer & FIRE | Implement `BRL`+`USD` `portfolio_assets` (holdings + watchlist), live FX (`frankfurter.dev`/`bcb.gov.br`) & quote fetcher with deterministic cached fallback, `10×20` 200-tile Hare-Niemeyer waffle, buy-only rebalancing calculator, single macro `YYYY-MM` `monthly_investment_plans` (zero micro-expense ledger), `retirement_config`, and `rust_decimal` FIRE & What-If engine. | M2 | R2, R4, `11` |
| F18 | `REF-02` Tactical FUI Theme, `0px` Primitives & Privacy Mask (`packages/ui`) | Build CSS/Tailwind v4 tokens (`#08080B`, `#F87C18`, `#F6F6F4`, `45°` `/////` hatch, `>=12px` interactive mono floor, `border-radius: 0px`), stepped `1px`+`4px` `<FuiPanelHeader />` with `[+]` square badge & `3px` Frieren ledge, `REF-01` `<FuiFigureRow />`, `<FuiBatteryCapsule />`, and `<PrivacyMaskProvider />` (`👁️`). | M3 | R3, `12`, `REF-01`, `REF-02` |
| F19 | `REF-10` Mechanical 8-Blade Shutter Aperture Logo & HUD Glyph Atlas | Implement inline `<SystemApertureLogo />` with all 5 concentric SVG layers (gunmetal outer reticle, 24-fin turbine, 36-tooth `#F87C18` gear, `#F6F6F4` 8-blade rotating shutter, `#A8F040`/`#F59E0B` status iris) + reusable HUD ring glyphs. | M3 | R3, `12`, `REF-10` |
| F20 | `REF-09` Orbital Boot Astrolabe, `REF-08` Thinking Orb & `REF-11`/`12` Loaders | Implement `<OrbitalBootScreen />` (`[1 // DB_ONLINE]` -> `[2 // HERMES_GATEWAY]` -> `[3 // READY]`), Canvas2D/SVG `<GeodesicThinkingOrb />` (`#2CE5F2`, zero WebGL), `<ModularHudLoader />` (`REF-11`), and `<MicroAnimIcon />` (`REF-12` `TIME`, `WIFI`, `DOTS`, `ICONS`, `CIRCLE`). | M3 | R3, R4, `12`, `REF-08`..`12` |
| F21 | Pixel-Art `PNG + JSON` Sprite Engine (`REF-14` Frieren & `REF-13` Knights) | Generate crisp pixel-art `.png` sprite sheets + `.json` descriptors (`image-rendering: pixelated`, integer `2x/3x/4x` zoom) and React components for Frieren perched mini-sprite (7 loops), Frieren `REF-14`/`14b` 4-phase wind/blink/head-tilt portrait (`<CompanionStage />`), and 5 Isometric Knight archetypes. | M3 | R3, R4, R5, `12`, `REF-13`..`14b` |
| F22 | Shared Tactical Telemetry & Finance Visual Charts (`packages/ui`) | Build `0px` Canvas2D/SVG chart components: `LifeRadarReticle` (`REF-01`), `FocusBarcode24h` & `BinaryDotMatrix8x12` & `WaveformSparkline` & `ConstellationMesh` (`REF-06`), and `WaffleGrid10x20` & `HatchedDonutGauge` & `PairedHatchBarChart` & `CandlestickChart` (`REF-07`). | M3 | R3, R4, `03`, `11`, `REF-06`..`07` |
| F23 | Web SPA CSR App Shell, Boot Gate, Global Timer & Quick Capture | Build 100% CSR `apps/web` (`dist/` static bundle, zero SSR) with TanStack Router, `REF-09` boot sequence, `REF-10` header, persistent `ActiveTimer` bar, `Cmd+K` NLP capture modal, `👁️` privacy toggle, and PAT/QR Pairing settings modal. | M4 | R3, R4, `01`, `07` |
| F24 | Multi-Dashboard Room Monitor (`/dashboard` & `/monitor`) | Deliver Deck switcher/CRUD/clone, `12×8` Widget Grid Builder, `/monitor` fullscreen auto-cycling on `cycle_seconds` with `1px` `#F87C18` countdown hairline, `Space` pin/pause, `←`/`→` jump, `👁️` privacy blur, all 7 built-in Life Ops widgets (incl. TCP/HTTP Server Prober), and custom `command`, `http`, `sql`, `hermes` panels. | M4 | R3, `03`, `REF-06` |
| F25 | Hermes Chat Workspace (`/hermes`) & `REF-08` Thinking Orb | Deliver `REF-01` session rail (pin, archive, search, fork), unified `X-Hermes-Session-Key` history, `[🧠 HIGH_LEVEL_PLAN]` `REF-08` Thinking Orb activation, `@mentions` & `/` commands, streaming `<thinking>` + GFM + inline `[Undo]`/`[Approve]` MCP cards, and Right Drawer Vault Inspector + *"Distill to Vault Inbox"*. | M4 | R4, `04`, `REF-08` |
| F26 | Agent Studio Isometric Knight Arena (`/agents`) | Deliver `2:1` `#141526` isometric arena (`REF-13`) with 4 tile zones, drag-to-deploy, Turn-Order Timeline, Starter Knights with `HP`/`EP` bars, `2×2`+ `/mcp` Skill Slots (`READ\|APPROVE\|AUTO`), Knight Forge (`SOUL.md`, cron/event triggers), `[▶ Dispatch Now]` + Dry-Run Sandbox, and live SSE cast animations. | M4 | R4, `05`, `REF-13` |
| F27 | Omnipresent Web Frieren Mastermind Companion (`Cmd+J`) | Mount `<CompanionStage />` mini-sprite on `3px` `#F87C18` header ledges + `Cmd+J` `REF-14` waist-up chat popover across all Web routes with automatic page-context injection, shared `X-Hermes-Session-Key` (*"Expand in Full Hermes View ↗"*), proactive `!` nudges, and `[Undo]`/`[Approve]` write cards. | M4 | R4, `06`, `REF-14` |
| F28 | Web Todo List (`/todos`) — 3 Layouts, Dependencies & Timer | Deliver GTD Smart Perspectives (*Inbox*, *Today* w/ Capacity Meter, *Upcoming*, *Projects*, *Someday*), `REF-01`/`REF-05` Tactical Signal List (`180°` left dependency arcs + right Bezier subtask tree), `REF-04` `TERMINAL-I/O` Radial Hub + `STAGE // 01..04` Bezier S-curves, Eisenhower Matrix, and Stopwatch/Pomodoro controls. | M4 | R4, `07`, `REF-04`, `REF-05` |
| F29 | Web Routine Planning (`/routines`) — Day Profiles, Ideal Week & Review | Deliver Morning/Afternoon/Shutdown/Evening stacks, Guided Runner, `Workday/Weekend/Travel/MVD` switcher, streaks & 365d heatmap, `7×24` Ideal Week time-blocking, Daily Pulse check-in, and 4-step Weekly Review Wizard exporting Markdown to `data/second-brain/`. | M4 | R4, `08` |
| F30 | Web Yearly Goals (`/goals`) — `Q1–Q4` OKRs & `REF-03` Orthogonal Blueprint | Deliver Annual Cycles, Focus Cap banner, `Q1–Q4` OKRs (all 7 metric/link types), pace drift badges, check-ins, and interactive `#10171D` `REF-03` `90°` Orthogonal Blueprint Map (8-bit binary border, Title Block, `Q1–Q4` Matrix, Manhattan `──┬──┐` corridors, `#EB4511` beacons, drag-to-pin `blueprint_pos`). | M4 | R4, `09`, `REF-03` |
| F31 | Web Course Tracker (`/courses`) — Crawler Import, Quiz & Spaced Review | Deliver Course catalog w/ WIP guardrail, 2-level syllabus + outline paste, 1-click read-only `youtube-lists`/`youtube-ai` playlist import & sync, Study Timer + spawn lab Todo, 1-click **"Quiz Me in Hermes"**, and `7d / 30d / 90d` Spaced Review Prompts panel. | M4 | R4, `10` |
| F32 | Web Finance Operator (`/finance`) — `BRL`+`USD`, Waffle, Macro Spend & FIRE | Deliver multi-market `BRL`+`USD` holdings & watchlist, base currency toggle, quote/FX refresh w/ cached indicator, Candlestick chart, Markdown thesis notes, `10×20` Waffle Grid, Smart Buy-Only Rebalancer, single macro `YYYY-MM` Salary vs Planned/Actual Spend planner (`REF-07` paired hatched bars, no micro-ledger), and FIRE Simulator + What-If Sliders + `👁️` Privacy Mask. | M4 | R4, `11`, `REF-07` |
| F33 | Strictly Scoped Capacitor Mobile Shell (`apps/mobile`) | Configure Capacitor (`capacitor.config.ts`, Android primary / iOS-compatible) + Vite React CSR sharing `packages/ui` & `packages/api-client`, exposing ONLY `ROUTINES`, `TODOS`, `COMPANION` tabs + `UPLINK_CONFIG` and statically excluding all Web-only modules (`03`, `04`, `05`, `09`, `10`, `11`). | M5 | R5, `02` §1–§3 |
| F34 | Offline-First Mobile SQLite (`UUIDv7`) & `UPLINK_CONFIG` Failover | Implement 10-table local SQLite engine (`@capacitor-community/sqlite` + `sql.js` Web/test store) with `0ms` offline `UUIDv7` Todo/Routine/Timer/Checkin CRUD, Primary/Fallback Server URL failover, encrypted Bearer PAT storage, `[⚡ TEST UPLINK]` (`/api/auth/verify`), QR pairing, and range-triggered `/api/sync/push` + `/api/sync/pull?since=last_seq`. | M5 | R5, `02` §4–§6 |
| F35 | Dual-Mode Mobile Frieren Companion (Online SSE vs Offline Loops/Quotes) | Switch Mobile `COMPANION` tab automatically between live SSE chat (`X-Hermes-Session-Key`) + `/mcp` when server is `IN_RANGE` and 6 random pixel-art animations + non-repeating motivational phrases from local/synced `companion_offline_phrases` when `OFFLINE`. | M5 | R5, `02` §3, `06` §2 |
| F36 | Full-Stack Production Verification, 100% E2E Pass (Tiers 1–4) & Tier-5 Hardening | Build fresh `apps/web/dist` served by Axum & `podman-compose`, pass 100% of E2E Testing Track Tiers 1–4 (API, `/mcp`, Web SPA, Visual Rubric, Mobile Offline Sync, Repo/Privacy Hygiene), and complete Tier-5 White-Box Adversarial Coverage Hardening. | M6 | R1–R5, All Acceptance Criteria |
| F37 | Dashboard Edit Mode 2D Grid Card Space Control (`R1`) | Arrange dashboard cards on a `12×8` 2D CSS Grid (`gridTemplateColumns: repeat(12, minmax(0, 1fr))`, `gridAutoRows`) with interactive Edit Mode (`toggle-edit-mode-btn`), 12×8 cell blueprint overlay (`grid-cell-${col}-${row}`), per-card width (`w: 1..12`) & height (`h: 1..8`) span controls, preset span pills (`3×2`, `4×3`, `4×4`, `6×4`, `6×5`, `12×4`), and Android widget-style edge/corner pointer resize handles persisting `grid_rect: { x, y, w, h }`. | M7 | 2026-11-15 `ORIGINAL_REQUEST.md` §R1, `03` §2–§4 |
| F38 | Dashboard Edit Mode 2D Drag-and-Drop Layout Arrangement (`R2`) | Enable HTML5 + pointer drag-and-drop on widget cards (`draggable`, `drag-handle-${id}`) in Edit Mode to drop cards onto target `(col, row)` 2D grid cells (`grid-cell-${col}-${row}`) or swap/repack with target widget cards (`widget-card-${id}`), with live drop footprint preview and accessible directional nudge controls, persisting `grid_rect` & `sort_order`. | M7 | 2026-11-15 `ORIGINAL_REQUEST.md` §R2, `03` §3.3 |
| F39 | Dashboard Edit Mode Browsable Widget Gallery (`R3`) | Provide an integrated Widget Gallery (`widget-gallery`, opened via `open-widget-gallery-btn` and in Edit Mode) to browse, filter by category/search, select `W×H` spans, and 1-click add (`gallery-add-${key}`) or drag-and-drop all 11 built-in Life Ops widgets and 4 custom telemetry widget templates onto the 2D dashboard grid. | M7 | 2026-11-15 `ORIGINAL_REQUEST.md` §R3, `03` §3.1–§3.2 |
| F40 | Modal Widget Gallery for Adding New Cards (`R1` Follow-up) | Move `data-testid="widget-gallery"` out of the inline dashboard flow into a `0px` Tactical FUI modal dialog (`data-testid="widget-gallery-modal"` + `role="dialog"` `aria-modal="true"`, `close-widget-gallery-btn`, `Escape` & backdrop dismissal) triggered in Edit Mode via `open-widget-gallery-btn` / `banner-toggle-gallery-btn` without auto-opening on `toggle-edit-mode-btn` or `edit-deck-btn`. | M8 | 2026-11-15T21:34:26Z `ORIGINAL_REQUEST.md` §R1 |
| F41 | Removal of `dashboard-edit-grid-overlay` & Direct Editing on `room-monitor-grid` (`R2` Follow-up) | Remove the separate `<section data-testid="dashboard-edit-grid-overlay">` above the preview so all 2D grid space control (`w`/`h` spans, presets, pointer resize handles) and drag-and-drop (`grid-cell-${col}-${row}`, `grid-drop-preview`, coordinate drop, card swap) operate directly on `data-testid="room-monitor-grid"`. | M8 | 2026-11-15T21:34:26Z `ORIGINAL_REQUEST.md` §R2 |
| F42 | Non-Scrolling Compact Edit Mode Layout & Live Preview Rebuild (`R3`–`R4` Follow-up) | Eliminate vertical page scrolling (`scrollHeight <= clientHeight` across viewport/scroll containers) and scale/size everything smaller in Edit Mode (`repeat(8, minmax(0, 1fr))` grid rows, compact toolbar/banner/cards/charts, `overflow: hidden`) while keeping `border-radius: 0px`, `>= 12px` interactive font floor, and live preview containers (`:8880`, `:8881`) running with rebuilt `apps/web/dist`. | M8 | 2026-11-15T21:34:26Z `ORIGINAL_REQUEST.md` §R3–R4 |
| F43 | Finance Sidebar Navigation Sub-items ("Retirement" & "Stock Cycle") & Retirement Routing (`R1`) | Update `NAV_ITEMS` in `apps/web/src/components/shell/AppShell.tsx` to include sub-items for `"Retirement"` (`/finance/retirement`, `nav-link-finance-retirement`) and `"Stock Cycle"` (`/finance/stock-cycle`, `nav-link-finance-stock-cycle`) routed via `apps/web/src/router.tsx` (re-exported in `App.tsx`), keeping the existing Finance page (`apps/web/src/components/finance/FinanceView.tsx`, re-exported in `apps/web/src/pages/FinancePage.tsx`, and `financeModel.ts`) rendered under `"Retirement"` (`/finance` and `/finance/retirement`). | M9 | 2026-11-16T02:56:52Z `ORIGINAL_REQUEST.md` §R1 |
| F44 | Stock Cycle View with Left-Hand Stock Selector & Single/Combined Candlestick Graph (`R2`) | Create `apps/web/src/components/finance/StockCycleView.tsx` (and `apps/web/src/pages/StockCyclePage.tsx`) + pure candle synthesis/combination helpers in `apps/web/src/components/finance/financeModel.ts` (`DEFAULT_STOCK_CYCLE_ASSETS`, `resolveStockCycleAssets`, `synthesizeClientCandles`, `computeCombinedCandles` / `combineStockCandles`) rendering the user's stocks on the left (`stock-cycle-stock-list`) with single-stock selection and multi-stock / combination selection (`stock-cycle-combine-option`, per-stock checkboxes) driving `<CandlestickChart />`. | M9 | 2026-11-16T02:56:52Z `ORIGINAL_REQUEST.md` §R2 |
| F45 | In-Place Web Rebuild, Unit/E2E Verification & Live Preview Preservation (`R3`) | Add unit tests (`financeModel.test.ts`, `FinancePage.test.tsx`, `App.test.tsx`) and Tier 1 E2E coverage (`e2e/tests/tier1/area-c-finance.spec.ts`), pass all workspace typechecks, tests, and builds, and update `apps/web/dist` in-place while keeping `hermes_os_preview` (`:8880`) and `hermes_os_mobile_preview` (`:8881`) running untouched and `git ls-files data/` empty. | M9 | 2026-11-16T02:56:52Z `ORIGINAL_REQUEST.md` §R3 |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| **M1** | Repo Hygiene, Legacy Removal & Monorepo/Podman Foundation | Delete `personal-system/`, fix `.gitignore` (`server` trap, `.agents/`, `/data/`), untrack `data/*/.gitkeep` (`git ls-files data/` = empty), update `AGENTS.md`/`CLAUDE.md`/`README.md`/`mise.toml`/`.env.example`/`podman-compose.yml`/`infra-deploy/`, scaffold root `pnpm@10.34.7` + Cargo workspace skeletons, run `pnpm install`, and start `postgres` (`pgvector:pg16`) & `redis` (`redis:7-alpine`) containers. | none | DONE (`cb2dfb78-3e80-4913-a6de-49e1696f8a9f`, commits `82e013d`, `1aae384`, Gate `5/5` PASS) |
| **M2** | Multi-Crate Rust Backend, `/mcp`, `hermes gateway` & `packages/api-client` | Implement `backend/crates/{domain,life-ops,intelligence,server}`, all SQLx migrations & seeds, PAT auth, `/api/sync/*`, `hermes gateway` SSE bridge + offline mock mode, `rmcp` `/mcp` server across all 7 domains (`[Undo]`/`[Approve]`), all Life Ops engines (`03`–`11`), static SPA fallback, and `utoipa` -> `packages/api-client` SDK. | M1 | DONE (`a1d84fbd-3300-42be-8282-f7a21888b1c5`, `M2A`–`M2D` `4/4` sub-milestones `5/5` Gate PASS, commits `0241278`, `e86e948`, `84666a1`, `2271bd3`, `d0949de`, `647a63e`, `38/38` Rust tests, `5/5` Vitest tests, `128` OpenAPI paths) |
| **M3** | Shared Tactical FUI Design System & Pixel-Art Sprite Engine (`packages/ui`) | Implement `REF-02` `0px` tokens & primitives, `REF-10` 5-layer SVG Aperture Logo, `REF-09` Boot Astrolabe, `REF-08` Geodesic Thinking Orb, `REF-11`/`12` HUD loaders/badges, `REF-06`/`07` Canvas2D/SVG charts, and `PNG + JSON` pixelated sprite sheets/renderers for Frieren (`REF-14`/`14b`) & Isometric Knights (`REF-13`). | M1 | DONE (`71d0a5c3-8584-4108-9d15-e922ec421200`, commit `460a526`, Gate `5/5` PASS) |
| **M4** | 100% CSR React Web SPA (`apps/web`) — Modules `03` through `11` | Implement pure CSR Web SPA (`apps/web/dist`): Boot gate, omnipresent `Cmd+J` Frieren (`06`), `/dashboard` & `/monitor` Room Monitor (`03`), `/hermes` Chat (`04`), `/agents` Knight Arena (`05`), `/todos` (`07`), `/routines` (`08`), `/goals` `90°` Blueprint (`09`), `/courses` (`10`), and `/finance` (`11`). | M2, M3 | DONE (`M4A`–`M4D` `4/4` sub-milestones `5/5` Gate PASS; commits `10ae8b3`..`600fa1e`; `106/106` `@hermes/web` & `141/141` workspace Vitest tests) |
| **M5** | Offline-First Capacitor Mobile Companion App (`apps/mobile`) | Implement `apps/mobile` (`capacitor.config.ts` + Vite CSR) strictly scoped to `ROUTINES`, `TODOS`, `COMPANION`, and `UPLINK_CONFIG` (zero excluded routes), with 10-table SQLite + `UUIDv7` offline CRUD, Primary/Fallback URL + encrypted PAT, `/api/sync/push` & `/api/sync/pull`, and Dual-Mode Frieren. | M2, M3 | DONE (`dc2f0b55-288b-46f4-83bf-b4f7ae28e271`, commits `a30bdf9`, `01eecce`, `6784806`, `19/19` Vitest tests, Gate `5/5` PASS) |
| **M6** | Final Milestone: Phase 1 E2E Test Pass (Tiers 1–4) & Phase 2 Adversarial Hardening (Tier 5) | Poll/consume `TEST_READY.md`; pass 100% of Tier 1 -> Tier 2 -> Tier 3 -> Tier 4 E2E suites + unified Podman production build & privacy checks; execute Phase 2 Tier-5 Challenger -> Worker -> Reviewer (+ Auditor) white-box hardening loop until zero gaps remain. | M4, M5, E2E | DONE (Phase 1 `sub_orch_m6_phase1` `9716d7f2-9265-40ac-a29c-69d80050a9f3`, commit `815e4bdf`, Gate `5/5` PASS; Phase 2 `sub_orch_m6_phase2` `6df2228e-67c4-4565-ad4f-e20190107521`, commit `f15303bb`, Gate `5/5` PASS: `452/452` Live E2E PASS, `47/47` Cargo tests, `166/166` Vitest tests, `0` remaining white-box gaps across `36/36` backend & `34/34` frontend/mobile features) |
| **E2E** | Parallel E2E Testing Track (`e2e/`, `TEST_INFRA.md`, `TEST_READY.md`) | Requirement-driven opaque-box test infrastructure and 4-tier test suite (`>=5×N` Tier 1, `>=5×N` Tier 2, pairwise Tier 3, realistic Tier 4 workloads + programmatic `REF-01`–`REF-14` DOM/style rubric) in isolated `e2e/`; publishes `TEST_INFRA.md` and `TEST_READY.md`. | none | DONE (`afdb3a87-b7c2-4d63-966f-0bde235af9a7`, `7/7` sub-milestones `5/5` Gate PASS, `452` tests across `31` `.spec.ts` files, `TEST_READY.md` published) |
| **M7** | Dashboard Edit Process Redesign: 2D Grid Card Space Control (`R1`), Drag-and-Drop (`R2`) & Widget Gallery (`R3`) | Upgrade `apps/web/src/components/monitor/RoomMonitorView.tsx` and `WidgetRenderer.tsx` with interactive 12×8 2D grid editing, Android widget-style width/height span controls & resize handles (`F37`), HTML5/cell/card drag-and-drop (`F38`), and a 15-template Widget Gallery (`F39`), plus unit tests (`apps/web/src/App.test.tsx`) and E2E tests (`e2e/tests/tier1/area-a-room-monitor.spec.ts`, `area-b-web-shell-ai-surfaces.spec.ts`) while keeping preview containers (`:8880`, `:8881`) untouched and `data/` untracked (`R4`). | M2, M3, M4, E2E | DONE (`grid_worker_1` `46b971b3-c8ad-48e5-8c8d-da947b4be4e7`, Gate `5/5` PASS: `47/47` Cargo tests, `166/166` Vitest tests, `80/80` live Room Monitor & Web Shell E2E tests, `454` total E2E tests dry-checked, preview containers `:8880` & `:8881` untouched, `git ls-files data/` = `0`) |
| **M8** | Dashboard Edit Experience Update: Modal Widget Gallery (`R1`), Remove `dashboard-edit-grid-overlay` & Direct Grid Editing (`R2`), Non-Scrolling Smaller Edit Layout (`R3`) & Preview Rebuild (`R4`) | Move `widget-gallery` into a modal (`F40`), delete `dashboard-edit-grid-overlay` so drag-and-drop and 2D sizing happen directly on `room-monitor-grid` (`F41`), eliminate page scrolling (`scrollHeight <= clientHeight`) and make everything smaller/compact in edit mode (`F42`), update unit & Tier 1 E2E suites (`App.test.tsx`, `area-a-room-monitor.spec.ts`, `area-b-web-shell-ai-surfaces.spec.ts`), and rebuild `apps/web/dist` without stopping `hermes_os_preview` (`:8880`) or `hermes_os_mobile_preview` (`:8881`). | M7 | DONE (`edit_worker_1` `ec6d4876-5807-4125-9609-b3ea8415965a`, Gate `5/5` PASS: `166/166` Vitest tests, `41/41` live Room Monitor & Web Shell Tier 1 E2E tests, `454` total E2E tests dry-checked, `12/12` viewport×deck zero-scroll & card-shrinkage probes, `1500` fuzz iterations, preview containers `:8880` serving `assets/index-BdjUPahw.js` & `:8881` untouched, `git ls-files data/` = `0`) |
| **M9** | Finance Sub-Navigation ("Retirement" & "Stock Cycle") & Stock Cycle Candlestick Page (`R1`–`R3`) | Add "Retirement" and "Stock Cycle" sub-items under Finance in `AppShell.tsx` (`NAV_ITEMS`) and `router.tsx` (`F43`), keep existing Finance view (`FinanceView.tsx` / `FinancePage.tsx`) under "Retirement", create `StockCycleView.tsx` + `financeModel.ts` helpers with left-hand stock selector and single/combined `<CandlestickChart />` (`F44`), add unit & Tier 1 E2E tests, and rebuild `apps/web/dist` in-place while keeping live preview containers (`:8880`, `:8881`) untouched (`F45`). | M4, M8 | DONE (`worker_m9_1` `8e90057e-ad6b-4467-bf15-785073a86b60`, Gate `5/5` PASS: `171/171` Vitest tests, `26/26` Web Shell Tier 1 E2E, `13/13` Finance Tier 1 E2E, `12/12` Finance Tier 2 E2E, `455` total E2E dry-checked, `4,130+` math/fuzz/oracle trials, live `:8880` serving `assets/index-DmL_O5fR.js` & `:8881` untouched, `git ls-files data/` = `0`) |

### M4 Sub-Milestones (supervised directly by the Project Orchestrator from Generation 4/5)

Decomposition and web interface contracts: `.agents/teamwork/sub_orch_m4_gen2/SCOPE.md` (read-only; its status column is stale — this table is the living record). Strictly sequential inside `apps/web/**`.

| # | Features | Sub-Orchestrator | Dependencies | Status |
|---|----------|------------------|--------------|--------|
| **M4A** | `F23`, `F24`, `F27` | `m4_sub_orch_a_gen2` (`e141a38f-f9de-434d-873c-658ca397f653`) | M2, M3 | DONE (commits `10ae8b3`, `a2cdc3d`, `ff97f17`, Gate `5/5` PASS) |
| **M4B** | `F25`, `F26` | `m4_sub_orch_b_gen3` (`ee12ec86-715e-40e4-bda2-efd10f6fc21b`) | M4A | DONE (commits `e178254`, `232b7e7`, `779db8f`, `55/55` `@hermes/web` & `94/94` workspace Vitest tests, Gate `5/5` PASS) |
| **M4C** | `F28`, `F29` | `m4_sub_orch_c` (`e4eea930-3f86-43f0-ab1e-c4a09c4df0cd`) | M4B | DONE (commits `24778a9`, `ef57492`, `a785870`, `78/78` `@hermes/web` & `113/113` workspace Vitest tests, `48/48` live Tier 1+2 E2E PASS, Gate `5/5` PASS) |
| **M4D** | `F30`, `F31`, `F32` + full `apps/web/dist` verification | `m4_sub_orch_d` (`66b5a5b9-08e7-4a9f-a63b-2153ba6797bb`) | M4C | DONE (commits `953e8d0`, `600fa1e`, `106/106` `@hermes/web` & `141/141` workspace Vitest tests, `100%` of `apps/web/**` E2E UI/DOM/FUI assertions PASS, Gate `5/5` PASS) |

### Work Item E2E-S — E2E Harness Safety (added by the Project Orchestrator, Generation 4, 2026-11-15T00:02Z)

Found during M4B discovery: with its default environment the E2E harness points the test server at the real `data/` paths and its cleanup helper deletes under that root (details and evidence: `.agents/teamwork/m4b_explorer_5/handoff.md`, `.agents/teamwork/vault_exposure_explorer_2/handoff.md`). Until this work item is gated, no live E2E mode may be run without explicit throw-away overrides (see the notice at the top of `TEST_READY.md`).

| # | Scope | Sub-Orchestrator | Dependencies | Status |
|---|-------|------------------|--------------|--------|
| **E2E-S** | `e2e/**` only: harness safe by default (temporary second-brain / YouTube fixtures, hard guard against `<repo>/data/`, no blind reuse of a server on `:8080`, cleanup confined to a harness-owned root, no silent full run when a scope is given, feature-scoped live run), run-time bait so `e2e/tests/tier2/area-d-sync-and-prod.spec.ts` passes the secret-guard hook and gets committed; no test weakened | `sub_orch_e2e_safety_gen2` (`d887512f-ef7c-41cb-8cd6-9c4ebdec5e14`) | E2E (baseline commit `0450aa0`) | DONE (`027fcc6fc717a328825d6011249d9c258d262c34`, Gate `5/5` PASS; all 51 files in `e2e/` tracked, hook exit 0) |

---

## Interface Contracts

### 1. Environment Variables & Runtime Ports
- **Rust Backend (`server`)**: Default listen `0.0.0.0:8080` (`PORT=8080`).
  - `DATABASE_URL=postgres://hermes:hermes@127.0.0.1:5432/hermes_os` (PostgreSQL 16 + `pgvector`)
  - `REDIS_URL=redis://127.0.0.1:6379`
  - `HERMES_GATEWAY_URL=http://127.0.0.1:8642/v1` (with `HERMES_API_KEY` optional)
  - `STATIC_DIST_DIR=../apps/web/dist` (or `/app/apps/web/dist` in container; resolved gracefully relative to workspace/cwd)
  - `YOUTUBE_LISTS_DB=../data/database/youtube-lists.sqlite` (or repo-root-resolved `data/database/youtube-lists.sqlite`, opened **strictly read-only** `SQLITE_OPEN_READ_ONLY`—never created if missing!)
  - `YOUTUBE_LISTS_NOTES_DIR=data/knowledge-data/youtube`
  - `SECOND_BRAIN_DIR=data/second-brain`
  - `HERMES_ADMIN_USER=operator`, `HERMES_ADMIN_PASSWORD=hermes-os-local`, `HERMES_BOOTSTRAP_PAT` (optional bootstrap `plm_pat_...` whose `SHA-256` is registered on startup), `REQUIRE_WEB_LOGIN=false` (single-owner local daily-driver default).
- **Web SPA (`apps/web`)**: Vite dev port `5173` proxying `/api` & `/mcp` to `http://127.0.0.1:8080`; production static `apps/web/dist` served directly by Axum on `:8080`. Workspace package name: `@hermes/web`.
- **Shared Packages**: `@hermes/ui` (`packages/ui`) and `@hermes/api-client` (`packages/api-client`).
- **Mobile Companion (`apps/mobile`)**: Workspace package name: `@hermes/mobile`; Vite dev/preview port `5174`/`4174`; `capacitor.config.ts` (`appId: "dev.vitorx86.hermes.companion"`, `appName: "HERMES Companion"`, `webDir: "dist"`).

### 2. Authentication, PATs & Session Rules (`server` ↔ `apps/web`, `apps/mobile`, `e2e`)
- `GET /api/health` (Public `200 OK`):
  ```json
  { "status": "ok", "db_online": true, "redis_online": true, "hermes_gateway": "offline_mock", "version": "1.0.0" }
  ```
  (`hermes_gateway` is `"online"` when `HERMES_GATEWAY_URL` responds, else `"offline_mock"`.)
- `GET /api/auth/verify`:
  - Requires an explicit valid `Authorization: Bearer plm_pat_<secret>` header (matched via `SHA-256` hex against `api_tokens.token_sha256 WHERE revoked_at IS NULL`) OR an explicit authenticated `hermes_session` cookie/JWT.
  - Missing, malformed, unknown, or revoked credentials MUST return `401 Unauthorized` JSON `{ "error": "unauthorized" }`.
  - Valid credentials return `200 OK`:
    ```json
    { "authenticated": true, "auth_type": "pat", "token_name": "Android Companion", "scopes": ["*"], "server_time": "2026-11-14T07:30:00Z", "latest_server_seq": 42 }
    ```
- On ALL `/api/*` and `/mcp` routes: if an `Authorization: Bearer ...` header is present and invalid/revoked, ALWAYS reject with `401 Unauthorized`. When no `Authorization` header is sent on non-`/api/auth/verify`, non-`/api/sync/*` browser routes and `REQUIRE_WEB_LOGIN=false`, local operator requests are permitted; `/api/sync/push` and `/api/sync/pull` ALWAYS require valid Bearer PAT (or authenticated session cookie).
- `POST /api/auth/tokens` (`{ "name": "Mobile" }`) -> creates `plm_pat_<32_hex_chars>`, stores ONLY `SHA-256` hex in `api_tokens`, returns `{ "id", "name", "token", "token_prefix", "scopes", "created_at" }`.

### 3. Scoped Mobile Delta Sync Contract (`backend` ↔ `apps/mobile`)
- **8 Synced Entity Tables (`entity_table`)**:
  `projects`, `tasks`, `time_sessions`, `routines`, `routine_items`, `routine_logs`, `daily_checkins`, `companion_offline_phrases`.
- **`POST /api/sync/push`**:
  - Request: `{ "client_id": "mobile-uuid", "mutations": [{ "mutation_id": "uuidv7", "entity_table": "tasks", "entity_id": "uuidv7", "op": "upsert" | "delete", "payload": { ... }, "client_updated_at": "ISO-8601" }] }`
  - Rejects any `entity_table` outside the 8 allowed tables with `400 Bad Request`.
  - Applies `UUIDv7` set-union for new `tasks`/`time_sessions` and `updated_at` Last-Write-Wins for updates/checkins/logs; appends every accepted change to `sync_change_log` (`server_seq BIGSERIAL`).
  - Response: `{ "applied_count": 2, "conflicts_resolved": 0, "server_seq": 15 }`.
- **`GET /api/sync/pull?since={last_seq}`**:
  - When `since=0`, returns full snapshot of existing rows across the 8 synced tables plus any tombstones; when `since > 0`, returns ordered `sync_change_log` entries with `server_seq > since`.
  - Response: `{ "changes": [{ "server_seq": 16, "entity_table": "tasks", "entity_id": "...", "op": "upsert" | "delete", "payload": { ... }, "changed_at": "ISO-8601" }], "latest_server_seq": 16, "has_more": false }`.

### 4. REST & SSE Endpoints (`backend/crates/server` ↔ `@hermes/api-client`)
All JSON error responses follow `{ "error": "code", "message": "human readable" }`.
- **Auth**: `GET /api/health`, `GET /api/auth/verify`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/auth/tokens`, `POST /api/auth/tokens`, `DELETE /api/auth/tokens/{id}`, `POST /api/auth/pairing-qr`.
- **Sync**: `POST /api/sync/push`, `GET /api/sync/pull`.
- **Dashboards & Server Prober (`03`)**:
  - `GET /api/dashboards`, `POST /api/dashboards`, `GET /api/dashboards/{id}`, `PUT /api/dashboards/{id}`, `DELETE /api/dashboards/{id}`, `POST /api/dashboards/{id}/clone`, `POST /api/dashboards/reorder`
  - `POST /api/dashboards/{id}/widgets`, `PUT /api/dashboards/{id}/widgets/{widget_id}`, `DELETE /api/dashboards/{id}/widgets/{widget_id}`, `POST /api/widgets/{widget_id}/refresh`
  - `GET /api/telemetry/life-score` (5-pillar equal default weights `0.20 × 5`, graceful `50` neutral pillar baseline when empty, clamped `0..100`)
  - `GET /api/servers`, `POST /api/servers`, `GET /api/servers/{id}`, `PUT /api/servers/{id}`, `DELETE /api/servers/{id}`, `POST /api/servers/{id}/check`, `GET /api/servers/summary`
  - `GET /api/events/stream` (SSE `event: system_event`, JSON payload)
- **Hermes Chat, Companion & Autonomy (`04`, `06`)**:
  - `GET /api/hermes/sessions`, `POST /api/hermes/sessions`, `GET /api/hermes/sessions/{key}`, `PATCH /api/hermes/sessions/{key}`, `DELETE /api/hermes/sessions/{key}`, `POST /api/hermes/sessions/{key}/fork`
  - `POST /api/hermes/chat/stream` (SSE; reads `X-Hermes-Session-Key` header + `{ message, high_level_mode?, page_context?, mentions?, slash_command?, origin? }`; emits `thinking`, `tool_call`, `undo_available`, `approval_required`, `token`, `done` SSE events; cleanly falls back to deterministic offline mock stream with `"gateway_mode": "offline_mock"` when `:8642` is unreachable)
  - `GET /api/companion/nudges`, `GET /api/companion/phrases`, `POST /api/companion/phrases`, `DELETE /api/companion/phrases/{id}`
  - `GET /api/mcp/approvals`, `POST /api/mcp/approvals/{id}/approve`, `POST /api/mcp/approvals/{id}/reject`, `POST /api/mcp/undo/{undo_id}`
  - `GET /api/vault/notes`, `GET /api/vault/note`, `POST /api/vault/distill`
- **Agent Studio Knights (`05`)**:
  - `GET /api/agents`, `POST /api/agents`, `GET /api/agents/{id}`, `PUT /api/agents/{id}`, `DELETE /api/agents/{id}`
  - `GET /api/agents/{id}/triggers`, `POST /api/agents/{id}/triggers`, `PUT /api/agents/{id}/triggers/{tid}`, `DELETE /api/agents/{id}/triggers/{tid}`
  - `POST /api/agents/{id}/dispatch`, `GET /api/agent-runs`, `GET /api/agent-runs/{run_id}`, `GET /api/agents/queue`
- **Todos & Focus Timer (`07`)**:
  - `GET /api/projects`, `POST /api/projects`, `GET /api/projects/{id}`, `PUT /api/projects/{id}`, `DELETE /api/projects/{id}`
  - `GET /api/tasks`, `POST /api/tasks`, `POST /api/tasks/parse`, `GET /api/tasks/{id}`, `PUT /api/tasks/{id}`, `PATCH /api/tasks/{id}/status`, `DELETE /api/tasks/{id}`, `GET /api/tasks/flow`
  - Reconciled `tasks.status`: `'inbox' | 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'canceled'`; `tasks.energy_level`: `'deep' | 'shallow' | 'quick'`. Circular `blocked_by_task_ids` returns `422 Unprocessable Entity`.
  - `GET /api/time/timer`, `POST /api/time/timer/start`, `POST /api/time/timer/stop`, `POST /api/time/timer/discard`, `GET /api/time/sessions`, `POST /api/time/sessions`, `DELETE /api/time/sessions/{id}`, `GET /api/time/stats`
- **Routines, Habits & Vault Export (`08`)**:
  - `GET /api/routines`, `POST /api/routines`, `GET /api/routines/{id}`, `PUT /api/routines/{id}`, `DELETE /api/routines/{id}`
  - `POST /api/routines/{id}/items`, `PUT /api/routine-items/{id}`, `DELETE /api/routine-items/{id}`
  - `POST /api/routine-logs`, `GET /api/routines/analytics`
  - `GET /api/checkins/{date}`, `PUT /api/checkins/{date}` (writes `data/second-brain/Daily/YYYY-MM-DD.md` and, when `weekly_review_json` is supplied, `data/second-brain/Reviews/YYYY-Www.md`)
  - `GET /api/weekly-review/summary`, `GET /api/ideal-week`, `PUT /api/ideal-week`
- **Yearly Goals & Blueprint (`09`)**:
  - `GET /api/goals/cycles`, `POST /api/goals/cycles`, `GET /api/goals/cycles/{year}`, `PUT /api/goals/cycles/{year}`
  - `GET /api/goals`, `POST /api/goals`, `GET /api/goals/{id}`, `PUT /api/goals/{id}`, `PATCH /api/goals/{id}/blueprint-pos`, `DELETE /api/goals/{id}`
  - `POST /api/goals/{id}/key-results`, `PUT /api/key-results/{kr_id}`, `DELETE /api/key-results/{kr_id}`
  - `GET /api/goals/{id}/checkins`, `POST /api/goals/{id}/checkins`, `GET /api/goals/cycles/{year}/blueprint`
- **Courses, Crawler Import & Spaced Review (`10`)**:
  - `GET /api/courses`, `POST /api/courses`, `GET /api/courses/{id}`, `PUT /api/courses/{id}`, `DELETE /api/courses/{id}`
  - `POST /api/courses/{id}/import-outline`, `POST /api/courses/{id}/modules`, `PUT /api/course-modules/{mod_id}`, `DELETE /api/course-modules/{mod_id}`
  - `POST /api/course-modules/{mod_id}/lessons`, `PUT /api/course-lessons/{lesson_id}`, `PATCH /api/course-lessons/{lesson_id}/status`, `DELETE /api/course-lessons/{lesson_id}`
  - `GET /api/courses/youtube/playlists`, `POST /api/courses/youtube/import`, `POST /api/courses/{id}/youtube/sync`
  - `POST /api/courses/{id}/quiz`, `POST /api/courses/{id}/spawn-todo`, `GET /api/courses/spaced-reviews/due`, `POST /api/course-lessons/{lesson_id}/review`
- **Finance Operator (`11`)**:
  - `GET /api/finance/assets`, `POST /api/finance/assets`, `GET /api/finance/assets/{id}`, `PUT /api/finance/assets/{id}`, `DELETE /api/finance/assets/{id}`
  - `GET /api/finance/assets/{id}/candles`, `POST /api/finance/quotes/refresh`, `GET /api/finance/allocation`
  - `GET /api/finance/monthly-plans`, `GET /api/finance/monthly-plans/{month}`, `PUT /api/finance/monthly-plans/{month}`
  - `GET /api/finance/retirement`, `PUT /api/finance/retirement/config`, `POST /api/finance/retirement/simulate`
  - `GET /api/finance/snapshots`, `POST /api/finance/snapshots`

### 5. Rust `/mcp` (`rmcp`) Tool Naming & Write Autonomy Contract
Mounted at `/mcp` (`rmcp` Streamable HTTP). Tool names use OpenAI-safe `<domain>_<action>` identifiers across all **7 domains**:
1. **`dashboards`**: `dashboards_list`, `dashboards_get`, `dashboards_get_life_score` (`READ`); `dashboards_create`, `dashboards_switch_deck`, `dashboards_add_widget`, `dashboards_update_layout` (`IMMEDIATE_UNDO`); `dashboards_delete`, `dashboards_configure_command_widget`, `dashboards_configure_sql_widget` (`REQUIRE_APPROVAL`).
2. **`todos`**: `todos_list_tasks`, `todos_get_task`, `todos_list_projects`, `todos_get_active_timer` (`READ`); `todos_create_task`, `todos_complete_task`, `todos_update_task`, `todos_start_timer`, `todos_stop_timer` (`IMMEDIATE_UNDO`); `todos_delete_task`, `todos_bulk_update_tasks`, `todos_delete_project` (`REQUIRE_APPROVAL`).
3. **`routines`**: `routines_list`, `routines_get_today`, `routines_get_streaks`, `routines_get_checkin` (`READ`); `routines_log_item`, `routines_upsert_checkin`, `routines_set_day_profile` (`IMMEDIATE_UNDO`); `routines_save_template`, `routines_delete` (`REQUIRE_APPROVAL`).
4. **`goals`**: `goals_list`, `goals_get_blueprint`, `goals_get_pace_drift` (`READ`); `goals_log_checkin`, `goals_update_kr_progress` (`IMMEDIATE_UNDO`); `goals_create_or_update`, `goals_delete` (`REQUIRE_APPROVAL`).
5. **`courses`**: `courses_list`, `courses_get_syllabus`, `courses_list_youtube_playlists`, `courses_get_due_reviews` (`READ`); `courses_update_lesson_status`, `courses_complete_review`, `courses_spawn_lab_todo` (`IMMEDIATE_UNDO`); `courses_import_youtube_playlist`, `courses_delete` (`REQUIRE_APPROVAL`).
6. **`finance`**: `finance_get_portfolio`, `finance_get_watchlist`, `finance_get_rebalance_plan`, `finance_get_fire_projection`, `finance_get_monthly_plan` (`READ`); `finance_upsert_asset`, `finance_delete_asset`, `finance_upsert_monthly_plan`, `finance_update_retirement_config` (`REQUIRE_APPROVAL` — ALL finance writes require approval).
7. **`servers`**: `servers_list`, `servers_get_summary`, `servers_probe_now` (`READ`); `servers_create_or_update` (`IMMEDIATE_UNDO`); `servers_delete` (`REQUIRE_APPROVAL`).

### 6. Tactical FUI & Sprite Contract (`@hermes/ui` ↔ `apps/web`, `apps/mobile`)
- **Zero-Radius Law**: `border-radius: 0px` on all cards, buttons, inputs, modals, badges, chat bubbles, progress bars, and chart tiles.
- **Core Hex Tokens**: `--fui-bg-carbon: #08080B`, `--fui-bg-plum: #0D0716`, `--fui-bg-blueprint: #10171D`, `--fui-bg-panel: #13151A`, `--fui-bg-arena: #141526`, `--fui-accent-orange: #F87C18`, `--fui-accent-vermilion: #EB4511`, `--fui-accent-amber: #F59E0B`, `--fui-accent-cyan: #2CE5F2`, `--fui-accent-phosphor: #A8F040`, `--fui-ink-stark: #F6F6F4`.
- **Interactive Typography Floor**: Computed `font-size >= 12px` on all interactive buttons, tabs, nav items, and inputs.
- **Pixel-Art Sprite Contract**: `<CompanionStage />` and `<IsometricKnightSprite />` load `PNG + JSON` descriptors (`meta.frameSize`, `meta.scale` integer `2|3|4`, `animations`) rendered with `image-rendering: pixelated` (`ctx.imageSmoothingEnabled = false`).
