# 03 — Multi-Dashboard & Room Monitor Telemetry Engine

> **Status**: Locked v1.0 (Core Priority Surface)
> **Platforms**: Web SPA Only — Desktop Command View (`/dashboard`) + **Dedicated Fullscreen Room Monitor Mode (`/monitor`)**
> **Visual References**: [`REF-02`](./assets/ref-02-protocol-diagnosis-fui.jpg), [`REF-06`](./assets/ref-06-dashboard-telemetry-triptych.jpg), [`REF-07`](./assets/ref-07-dashboard-finance-waffle-ai.jpg), [`REF-01`](./assets/ref-01-dimensional-triad-grid.jpg)

---

## 1. Purpose & Room-Monitor Mandate

Because this surface stays **permanently open on a dedicated monitor in your room**, it is engineered as a **zero-scroll, live-reactive Mission Control Wall** rather than a single static web page.

You can build **multiple specialized Dashboards ("Decks")**, populate each one with **built-in Life Manager widgets AND custom CLI/HTTP/SQL/Hermes command panels**, set a **per-dashboard cycle duration**, and let the Room Monitor smoothly cycle across your entire life, infrastructure, and portfolio telemetry 24/7.

---

## 2. Multi-Dashboard Cycling & Room Monitor Mode (`/monitor`)

- [x] **Unlimited Named Dashboards ("Decks")**:
  - Create, clone, reorder, or toggle `in_rotation` on any number of dashboards—for example:
    1. **`DECK_01 // TACTICAL_OPS`**: Composite Life Score (`0–100`), Active Focus Timer & 24h Focus Barcode (`REF-06`), Today Todos, Routine Streaks & Dot-Matrix.
    2. **`DECK_02 // WEALTH_&_FIRE`**: Live B3/US/Crypto Watchlist, `10×20` Portfolio Waffle Grid (`REF-07`), Monthly Investable Surplus, and Projected Retirement Countdown.
    3. **`DECK_03 // STRATEGY_&_LORE`**: Yearly Goal Blueprint Mini-Map (`REF-03`), Quarterly OKR Pace, Active Courses, and Second Brain Constellation Mesh (`REF-06`).
    4. **`DECK_04 // INFRA_&_KNIGHTS`**: TCP/HTTP Server Health Prober, Custom Host/GPU/Disk Command Panels, Crawler Ingestion Feed, and Isometric Knight Queue (`REF-13`).
- [x] **Configurable Cycle Playlist & Controls**:
  - **Per-Dashboard `cycle_seconds`** (e.g. `30s`, `60s`, `120s`, `300s`).
  - Crisp `1px` Blaze-Orange (`#F87C18`) countdown hairline across the top frame edge showing time until next transition.
  - Keyboard & HUD controls: `Space` to **Pin / Pause** rotation on the current deck, `←` / `→` or `[01][02][03][04]` FUI tabs to jump immediately, `F` for borderless Fullscreen Kiosk (`/monitor`), and `👁️` Privacy Mask toggle (blurs currency amounts while keeping `%` and FI years visible).
- [x] **Zero-Scroll Viewport Fit & Live Push**:
  - Uses a 12-column × 8-row responsive CSS Grid scaled cleanly to `100vw × 100vh` in `/monitor` mode, pushed live via Rust SSE (`tokio::sync::broadcast`) with Frieren perched along the top panel ledges.

---

## 3. Dual Widget Engine: Built-In Modules + Custom Command Panels

### 3.1. Built-In Life Ops & Telemetry Widgets
- **Life Telemetry Index (`0–100`) & Pillar Radar (`REF-01`)**: Weighted composite score + dotted concentric reticle across *Focus*, *Routines*, *Goals*, *Learning*, and *Wealth/FI*.
- **Focus & Todo Velocity**: Active Stopwatch/Pomodoro bar, 24h focus barcode strip (`REF-06`), Today completion ratio.
- **Routines & Bio Consistency**: Active Day Profile (`Workday / Weekend / MVD`), streak counter, `8×12` binary dot-matrix (`REF-06`), sleep/energy `WAVEFORM_DATA` sparkline.
- **Portfolio, Stock Ticker & Retirement Gauge (`REF-07`)**: Live portfolio total (`BRL` / `USD`), `10×20` allocation waffle grid, diagonal-hatched FI target ring (`% to Retirement`), and Years-to-Retirement readout.
- **Yearly Blueprint & Course Momentum**: Compact `REF-03` goal status matrix + weekly study hours bar.
- **Server Infrastructure Prober**: Live `online / degraded / offline` TCP & HTTP node matrix + latency sparklines (ported from Go prototype into Tokio).
- **Knight Order & Hermes Pulse**: Recent Agent Knight runs, pending approvals, and Frieren's daily brief banner.

### 3.2. Custom Command, HTTP, SQL & Hermes Widgets
Configure custom telemetry panels that execute safely on the Rust backend on a configurable `refresh_interval_seconds` and render into `REF-02` FUI visualizations:
- **`command` Widget**: Runs a configured shell/CLI command on the server (e.g., `df -h`, `nvidia-smi --query-gpu=...`, `podman ps --format json`, custom scripts) and parses stdout/JSON.
- **`http` Widget**: Polls an internal/external JSON endpoint with custom headers and JSONPath mapping.
- **`sql` Widget**: Executes a read-only PostgreSQL telemetry query against your Life Manager DB.
- **`hermes` Widget**: Displays the cached output of a scheduled `hermes gateway` prompt.
- **Display Renderers**: Choose `Big Condensed KPI`, `Waveform / Sparkline`, `Segmented Bar`, `FUI Key-Value Table`, or `Monospace Terminal Tail`.

### 3.3. Visual + Conversational Configuration
- Edit layouts via the **Drag-and-Resize FUI Grid Editor**, **OR** ask Frieren directly in chat (*"Create a 45-second Infra + Portfolio dashboard with `podman ps` and my B3 stocks"* -> calls `/mcp` `dashboards.*` tools!).

---

## 4. Core Data Entities (PostgreSQL)

- **`dashboards`**: `id`, `slug`, `title`, `cycle_seconds` (int, default `60`), `in_rotation` (bool), `sort_order` (int), `layout_cols` (default `12`), `layout_rows` (default `8`), `created_at`, `updated_at`.
- **`dashboard_widgets`**: `id`, `dashboard_id`, `title`, `source_kind` (`builtin | command | http | sql | hermes`), `renderer_kind` (`kpi | sparkline | waffle | bar | table | terminal | custom_module`), `grid_rect` (JSONB `{x, y, w, h}`), `source_config` (JSONB), `refresh_interval_seconds`, `cached_payload` (JSONB), `last_refreshed_at`.
- **`server_nodes`**: `id`, `name`, `host`, `port`, `check_type` (`tcp | http`), `http_url`, `status`, `last_latency_ms`, `last_checked_at`, `tags`.
