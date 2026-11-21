# Second Brain Methodology (`HERMES // OS`)

The Second Brain in **`HERMES // OS`** is structured around the **CODE** framework (**Capture, Organize, Distill, Express**) adapted for automated workflows, Tactical FUI telemetry, and tiered AI autonomy.

---

## 💡 The CODE Framework

### 1. Capture (`crawlers/`, `Cmd+K` Quick Capture & Mobile Offline Inbox)
- **Automated Ingestion**: `crawlers/youtube-lists` and `crawlers/youtube-clean` capture playlists and transcripts into local SQLite and Markdown files under gitignored `data/`.
- **Zero-Friction Action Capture**: Desktop `Cmd+K` NLP parsing (`#tag @energy !priority tomorrow 90m`) and `0ms` offline SQLite capture on `apps/mobile` record tasks, check-ins, and study notes without breaking flow.

### 2. Organize (`backend/crates/life-ops`, `apps/web`, `apps/mobile` & `data/second-brain/`)
- **Structured Life Domains**: Projects, Todos (`07`), Day-Profile Routines (`08`), `Q1–Q4` OKR Yearly Goals (`09`), 2-level Course Syllabi (`10`), and Multi-Market `BRL`+`USD` Portfolios (`11`) live in PostgreSQL 16 (`pgvector`) with bidirectional Markdown Vault exports in `data/second-brain/`.
- **Actionability First**: Tasks link directly to courses, key results, focus timer sessions, and dependency graphs.

### 3. Distill (`hermes gateway`, `backend/crates/intelligence` & `crawlers/youtube-ai`)
- **Progressive AI Synthesis**:
  - Level 1: Clean transcript and syllabus extraction (`youtube-lists` & outline parser).
  - Level 2: Structured AI study notes (`youtube-ai`) and `7d / 30d / 90d` Spaced Review prompts.
  - Level 3: Interactive synthesis, quizzes, Vault distillation, and autonomous Isometric Knights via Nous Research's `hermes gateway` (`:8642/v1`) and the 3-tier `/mcp` tool bridge (`READ`, `IMMEDIATE_UNDO`, `REQUIRE_APPROVAL`).

### 4. Express (Execution, Telemetry & Reviews)
- **Tactical Execution**: Fullscreen Multi-Dashboard Room Monitor (`/dashboard`, `/monitor`), Stopwatch/Pomodoro Focus Timer, `90°` Orthogonal Goal Blueprints, FIRE retirement simulations, and automated Daily/Weekly Obsidian Markdown reviews (`data/second-brain/{Daily,Reviews}/`).
