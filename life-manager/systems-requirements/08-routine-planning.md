# 08 — Routine Planning & Habit Architecture

> **Status**: Locked v1.0
> **Platforms**: Web SPA (Blueprint Designer, Ideal Week, Analytics & Weekly Review) | Companion App (**Core Offline-First** Daily Check-In Checklist)
> **Existing Repo Context**: Evolves `personal-system/routines/weekly_review.md` and `TimeBlock` (`time.go`) into an interactive routine, habit, and cadence engine.

---

## 1. Purpose

Goals set direction, but **routines determine daily reality**. The **Routine Planning** module lets you design repeatable daily rituals, map out an **Ideal Week** time-block blueprint, track keystone habits without friction, and execute structured **Daily Shutdown / Weekly Review** ceremonies.

---

## 2. Core Functional Requirements

### 2.1. Routine Stacks (Sequential Rituals)
- [x] **Time-of-Day Routine Groups**: Group atomic habits/steps into ordered stacks:
  - 🌅 **Morning Launch** (e.g., Hydrate, Workout/Mobility, Review Today's Top 3, 90m Deep Work)
  - ☀️ **Workday / Afternoon Reset**
  - 🌇 **Workday Shutdown Ritual** (Clear inbox, stop timers, pick tomorrow's Top 3)
  - 🌙 **Evening Wind-Down** (No screens, reading, sleep prep)
- [x] **Day-Profile Variants ("Modes")**: Switch or auto-apply templates based on day type:
  - *Standard Workday*, *Weekend*, *Travel / Minimum Viable Day (MVD)* (so streaks survive low-energy or travel days via a defined minimum baseline!).
- [x] **Guided Routine Runner (Optional)**: Step-by-step timer/checklist flow for executing a routine stack without distraction.

### 2.2. Ideal Week & Daily Time-Blocking
- [x] **Ideal Week Blueprint**: Visual 7-day 24-hour grid defining where hours *should* go by category (*Deep Work*, *Course/Study*, *Exercise*, *Admin*, *Rest*)—used by **AI Mastermind (`06`)** to compare planned allocation vs. actual logged `TimeSession` hours.
- [x] **Daily Time-Block Planner**: Drag tasks (`07`) or courses (`10`) into today's routine blocks.

### 2.3. Habit Tracking, Streaks & Bio/Mood Check-Ins
- [x] **Flexible Habit Cadences**: Daily, specific weekdays (`Mon/Wed/Fri`), or target `X times per week` (e.g., *Gym 4x/week* — doesn't break streak on rest days!).
- [x] **Quantitative & Boolean Habits**: Simple checkmarks (`Done / Skipped`) *and* numeric targets (e.g., `Pages read: 20`, `Water: 3L`, `Sleep: 7.5h`).
- [x] **Daily Pulse Check-In**: 5-second slider for **Energy (1–5)**, **Mood (1–5)**, and **1-line Daily Highlight/Reflection** (replaces scattered `personal-system/logs/` manual files or auto-exports to Markdown).
- [x] **Consistency Analytics**: Current streak, best streak, 365-day heatmap, and completion % by routine stack.

### 2.4. Weekly & Monthly Review Wizard
- [x] **Interactive Weekly Review Flow** (evolving `personal-system/routines/weekly_review.md`):
  1. **Clear Inboxes**: Triage Todo Inbox, Crawler captures, and uncategorized Finance transactions.
  2. **Inspect Telemetry**: Auto-populated summary of Deep Work hours, habit adherence, Course progress, and Budget burn.
  3. **Reflect**: *What went well? What were the blockers?* (with optional AI Mastermind critique).
  4. **Plan Next Week**: Confirm Yearly Goal alignment and lock in Top 3 weekly priorities.

---

## 3. Core Data Entities

- **`routines`**: `id`, `name`, `time_slot` (`morning | afternoon | shutdown | evening | custom`), `day_profile` (`workday | weekend | travel | minimum_viable`), `target_start_time`, `sort_order`, `active`.
- **`routine_items` (Habits)**: `id`, `routine_id`, `goal_id` (nullable), `title`, `tracking_type` (`boolean | numeric | duration`), `target_value`, `unit`, `frequency_type` (`daily | weekdays | times_per_week`), `frequency_config` (JSONB), `estimated_minutes`.
- **`routine_logs`**: `id`, `routine_item_id`, `log_date` (date), `status` (`completed | partial | skipped`), `numeric_value`, `completed_at`, `notes`.
- **`daily_checkins`**: `log_date` (PK), `day_profile_used`, `energy_score` (1–5), `mood_score` (1–5), `sleep_hours`, `highlight`, `reflection_md`, `weekly_review_json` (nullable).
- **`ideal_week_blocks`**: `id`, `day_of_week` (0–6), `start_time`, `end_time`, `category`, `linked_goal_id`, `label`.

---

## 4. Companion App Scope

On the mobile **Companion App (`02`)**, Routine Planning renders strictly as:
1. Today's collapsible **Morning / Daytime / Evening** swipe-or-tap checklist.
2. Quick **Energy / Mood / Sleep** tap bar.
*(Designing the Ideal Week and running the full Weekly Review stay on the Web SPA.)*

---

## 5. Locked Decisions

- **Day Profiles Enabled**: Full support for `Workday`, `Weekend`, and `Minimum Viable / Travel` modes so streaks stay honest and resilient on low-energy or travel days.
- **Obsidian Vault Markdown Mirroring**: Daily Reflections (`daily_checkins`) and Sunday Weekly Reviews automatically export clean Markdown files into `data/second-brain/Daily/` and `data/second-brain/Reviews/` so your Second Brain stays portable and searchable by `hermes gateway`.
- **Standalone Time-Blocks in v1**: Routine Time-Blocks operate standalone in v1 without hard coupling to external Calendar APIs.
