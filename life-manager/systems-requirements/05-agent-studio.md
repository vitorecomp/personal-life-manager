# 05 — Agent Studio (Isometric Tactical Knight Arena)

> **Status**: Locked v1.0
> **Platforms**: Web SPA Only (Isometric Command Arena + Prompt/Skill Forge)
> **AI Engine**: Dispatches runs via **`hermes gateway` (`:8642/v1` `/v1/runs` & profiles)** + Rust **`/mcp`** Life Ops & external MCP servers
> **Visual Reference**: [`assets/ref-13-agent-studio-isometric-knights.jpg`](./assets/ref-13-agent-studio-isometric-knights.jpg) (`REF-13`) + [`REF-02`](./assets/ref-02-protocol-diagnosis-fui.jpg)

---

## 1. Purpose & Visual Metaphor

**Agent Studio** is an **interactive Isometric Tactical RPG Command Arena (`REF-13`)** where your autonomous AI agents stand on floating tech-stone tiles as an **Order of Pixel-Art Knights** serving under your Arch-Mage Companion, Frieren (`06`).

Every tactical RPG element maps directly to real `hermes gateway` + Rust Tokio execution controls, giving you drag-and-drop spatial deployment, live battle/cast animations during cron/event runs, and full prompt/skill/MCP engineering control.

---

## 2. Locked Tactical RPG-to-Engineering Mapping (`REF-13`)

| Tactical RPG Element (`REF-13`) | Real Agent Studio Function |
| :--- | :--- |
| **Pixel-Art Knight Unit** | A configured `hermes gateway` Agent Profile / Specialist (`Paladin`, `Vanguard`, `Lore-Warden`, `Inquisitor`, `Artificer`) |
| **Interactive Isometric Tile Zones** | Drag Knights between *Cron Watchtower*, *Event Ambush Tile*, *Mastermind Council Seat*, and *Standby Barracks* (paused) |
| **Top Turn-Order Portrait Chain** | Live **Tokio Scheduler & Event Queue Timeline** (recent runs → `[ACTIVE]` Knight → upcoming cron runs) |
| **`HP` Bar (Health)** | **Monthly Budget / Run Quota Remaining** (`$3.40 / $5.00` circuit breaker) |
| **`EP` Bar (Energy)** | **Context / Token Load** (`22k / 128k` tokens used on latest run) |
| **4+ Equipped Skill Slots** | **Allowed `/mcp` & Hermes Tools/Skills** (`todos.*`, `portfolio.*`, `vault.*`, external MCPs) with `READ` / `APPROVE` / `AUTO` policy |
| **Live Tile Combat / Cast Anim** | Triggered over SSE whenever the Knight executes a scheduled cron or Rust domain event |

---

## 3. Core Functional Requirements

- [x] **The Knight Forge (`[+ FORGE KNIGHT]` / `[✎ Open Forge]`)**:
  - Pick Knight sprite archetype & crest color (backed by hot-swappable `PNG + JSON` sprite sheets).
  - Edit **System Oath (`SOUL.md` / System Prompt)** with live template variables (`{{today}}`, `{{active_goals}}`, `{{portfolio_summary}}`).
  - Select upstream model routed through `hermes gateway`, thinking effort, and allowed **Hermes Skills + Rust `/mcp` tool policies** (plus external MCP servers configured in Hermes / `rmcp`).
- [x] **Triggers**: Tokio Cron schedules, Rust Domain Event hooks (`YoutubeCrawlerSynced`, `PortfolioPriceAlert`, `GoalPaceAtRisk`), Mastermind Council seats, and 1-click `[▶ Dispatch Now]`.
- [x] **Dry-Run Sandbox & Battle Logs**: Test Knights on sample inputs while inspecting `/v1/runs` step traces, `/mcp` tool calls, latency, token usage, and monthly `$` circuit breakers.

---

## 4. Starter Order of Knights

1. **Sir Chronos (*Paladin* — Morning Chief of Staff)**: `07:00` daily cron; prepares Morning Pulse across Todos, Routines & Dashboards.
2. **Vanguard Aurum (*Vanguard* — Portfolio & FI Watchman)**: Monitors B3/US/Crypto target drift, price alerts, and monthly investment readiness.
3. **Lore-Warden Lyra (*Lore-Warden* — Learning Curator)**: Reacts to `youtube-ai` crawler runs; links new video notes to active **Courses (`10`)** and **Yearly Goals (`09`)**.
4. **Inquisitor Vex (*Inquisitor* — Ruthless Prioritizer)**: Audits Todo backlog bloat and challenges tasks unaligned with any Yearly Goal.

---

## 5. Core Data Entities (PostgreSQL)

- **`agents`**: `id`, `slug`, `name`, `knight_archetype`, `crest_color`, `grid_pos` (JSONB `{x, y, zone}`), `hermes_profile` (nullable), `system_prompt`, `model_config` (JSONB), `tools_policy` (JSONB), `monthly_budget_cents`, `is_mastermind_member`, `enabled`, `version`, `created_at`, `updated_at`.
- **`agent_triggers`**: `id`, `agent_id`, `type` (`cron | event | webhook`), `config_json`, `enabled`, `last_run_at`, `next_run_at`.
- **`agent_runs`**: `id`, `agent_id`, `trigger_id`, `hermes_session_key`, `status` (`running | awaiting_approval | succeeded | failed`), `steps_trace` (JSONB), `input_tokens`, `output_tokens`, `estimated_cost_usd`, `started_at`, `finished_at`.
