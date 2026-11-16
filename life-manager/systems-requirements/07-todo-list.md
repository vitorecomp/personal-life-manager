# 07 — Todo List & Project Execution

> **Status**: Locked v1.0
> **Platforms**: Web SPA (Full GTD/CODE + `TERMINAL-I/O` Project Flow) | Companion App (**Core Offline-First** Inbox, Today List & Focus Timer)
> **Existing Repo Context**: Evolves `personal-system/backend/internal/models/task.go` & `time.go` (`Task`, `TimeSession`, `ActiveTimer`) into PostgreSQL with deep links to Goals, Courses, and Routines.

---

## 1. Purpose

The **Todo List** is the tactical execution layer of the Life Manager. It turns high-level **Yearly Goals (`09`)**, **Course lessons (`10`)**, and random daily obligations into prioritized, time-bounded next actions—tightly paired with a built-in **Focus Timer** so planned work directly translates into measured Deep Work telemetry.

---

## 2. Core Functional Requirements

### 2.1. Frictionless Capture & GTD Views
- [x] **Global Quick Capture (`Cmd+K` / `Q` shortcut & Mobile `+`)**: Natural-language inline parsing (e.g., `"Finish Raft lab #courses @deep_work !high tomorrow 90m"` -> extracts tags, priority, scheduled date, and estimate).
- [x] **Smart Perspectives**:
  - **Inbox**: Unprocessed captures awaiting triage (aligning with CODE *Capture -> Organize*).
  - **Today ("My Day")**: Committed tasks for today + overdue items + capacity meter (`Planned Minutes vs. Available Deep Work Hours`).
  - **Upcoming**: 7-day / calendar horizon view of scheduled and due tasks.
  - **Projects & Life Areas**: Grouped execution boards.
  - **Someday / Backlog**: Low-priority ideas kept out of daily noise.
- [x] **Layout Modes**: Toggle purely client-side between:
  - **Tactical Signal List (`REF-01` & `REF-05`)**: Notched strips with **left-gutter semicircular dependency arcs**, inline **micro-battery progress capsules**, `▷` instant Focus Timer triggers, and expandable **right-hand Bezier subtask trees** ([`assets/ref-05-components-dependency-tree.jpg`](./assets/ref-05-components-dependency-tree.jpg)).
  - **Project Flow Topology (`REF-04` — `TERMINAL - I/O`)**: Left **Radial Project Hub (`CENTRAL ATRIUM`)** wired via smooth Bezier S-curves into multi-stage columns (`STAGE // 01 BACKLOG` → `02 ACTIVE` → `03 REVIEW` → `04 DONE`), highlighting active critical-path tasks in **cyan (`#2CE5F2`)** and blocked bottlenecks in **vermilion (`#EB4511`)**, plus a bottom throughput dot-track ([`assets/ref-04-project-planning-terminal-io.jpg`](./assets/ref-04-project-planning-terminal-io.jpg)).
  - **Matrix (Urgent / Important)** tactical quadrant grid.

### 2.2. Rich Task Structure & Cross-Module Links
- [x] **Subtasks & Hierarchical Decomposition Trees (`REF-05`)**: Nested checklist items inside a task (`2/4`), viewable inline or expanded into a right-branching node tree.
- [x] **Strategic Traceability**: Optional foreign keys linking a task to:
  - A **Yearly Goal / Key Result (`09`)**
  - A **Course / Lesson (`10`)**
  - An **Obsidian Note (`data/second-brain/`)**
- [x] **Scheduled Date vs. Hard Due Date**: Distinguish *when you plan to work on it* (`scheduled_date`) from *the external deadline* (`due_date`).
- [x] **Effort & Energy Metadata**: `estimated_minutes` (`15m | 30m | 60m | 90m+`) and optional energy tag (`deep_focus | quick_win | low_energy`).
- [x] **Dependencies / Blocked-By (`REF-04` & `REF-05`)**: Mark Task B as blocked by Task A—rendered as semicircular left-gutter arcs in List view and S-curve wires in Project Flow view.

### 2.3. Integrated Focus Timer & Time Tracking
- [x] **One-Click Focus Start**: Play button on any task starts an `ActiveTimer` (Stopwatch or configurable Pomodoro `25/5`, `50/10`, `90/15`), visible in the persistent SPA top/bottom bar and synced to the Companion App.
- [x] **Estimated vs. Actual Rollup**: Automatically aggregates completed `TimeSession` durations onto each task (`Actual: 1h 45m / Est: 1h 30m`).

---

## 3. Core Data Entities (PostgreSQL)

- **`projects`**: `id`, `name`, `area` (`career | health | learning | finance | personal | systems`), `goal_id` (nullable), `status` (`active | paused | completed | archived`), `color`, `created_at`.
- **`tasks`**:
  - `id`, `title`, `description_md`
  - `status` (`inbox | backlog | todo | in_progress | review | done | canceled`)
  - `priority` (`low | medium | high | urgent`)
  - `project_id` (nullable), `goal_id` (nullable), `course_id` (nullable), `parent_task_id` (nullable), `blocked_by_task_ids` (`uuid[]`)
  - `scheduled_date` (date), `due_date` (timestamptz)
  - `estimated_minutes` (int), `actual_seconds` (bigint, denormalized/computed)
  - `energy_level` (`deep | shallow | quick`), `tags` (`text[]`), `recurrence_rule` (rrule string, nullable)
  - `completed_at`, `created_at`, `updated_at`.
- **`time_sessions`**: `id`, `task_id`, `course_id`, `category` (`deep_work | learning | maintenance | admin | health`), `started_at`, `ended_at`, `duration_seconds`, `notes`.

---

## 4. Boundary: Todo List vs. Routine Planning

- **Todo List (`07`)** tracks **discrete, completable deliverables and one-off/project actions** (even if recurring like *"Pay accountant quarterly"*).
- **Routine Planning (`08`)** tracks **habitual daily/weekly rituals and time-block templates** (e.g., *Morning Hydration + Mobility*, *2h Morning Deep Work Block*, *Sunday Weekly Review*).

---

## 5. Locked Decisions

- **Workflow Statuses**: 5 statuses (`inbox`, `backlog`, `todo`, `in_progress`, `review`, `done`).
- **Source of Truth**: 100% standalone in PostgreSQL (and synced to Mobile SQLite via `/api/sync/*`) for v1; external bridges (Taiga, GitHub, Calendar) can be invoked on demand via `hermes gateway` MCP skills later.
- **Focus Timer**: Supports **both** open-ended **Stopwatch** and countdown **Pomodoro** (`25/5`, `50/10`, `90/15`) intervals.
