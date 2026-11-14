# 10 — Course & Learning Tracker

> **Status**: Locked v1.0
> **Platforms**: Web SPA Only (Excluded from Companion App)
> **Existing Repo Context**: Connects directly with `crawlers/youtube-lists` (`data/database/youtube-lists.sqlite`) & `crawlers/youtube-ai` (`data/knowledge-data/lists/youtube/`) plus Obsidian notes in `data/second-brain/`.

---

## 1. Purpose

Buying courses and saving YouTube playlists is easy; **finishing them and retaining the knowledge** is hard. The **Course Tracker** turns passive content queues into structured learning roadmaps—tracking syllabus completion, study hours, practical capstone deliverables, and linking every lesson directly to your **Second Brain notes** and **Yearly Goals (`09`)**.

---

## 2. Core Functional Requirements

### 2.1. Learning Catalog & Pipeline
- [x] **Multi-Format Learning Sources**:
  - **Online Courses** (Coursera, Udemy, Frontend Masters, university lectures, internal trainings)
  - **YouTube Playlists** *(1-click import from existing `crawlers/youtube-lists` SQLite DB!)*
  - **Technical Books / Textbooks** (chapters as modules)
  - **Certifications** (with exam target date & practice score tracking)
- [x] **WIP Limit & Status Pipeline**:
  - Statuses: `Wishlist / Queue` -> `Active (In Progress)` -> `Practicing / Capstone` -> `Completed` -> `Paused / Dropped`.
  - Soft **Active Course WIP Warning** (e.g., warn when > 2–3 courses are `Active` simultaneously to prevent "course collector syndrome").

### 2.2. Curriculum Tree & Progress Tracking
- [x] **Two-Level Syllabus (`Modules/Sections` -> `Lessons/Chapters/Videos`)**:
  - Manual quick-paste syllabus importer (paste raw text outline -> AI/parser splits into Modules & Lessons with durations!).
  - Automatic sync for linked **YouTube Playlists**: lessons map 1:1 to playlist videos, pulling duration and `youtube-ai` generated Markdown summaries automatically.
- [x] **Granular Lesson States**: `Not Started` | `Watching / Reading` | `Notes Distilled` | `Practice Done`.
- [x] **Pace & Completion Forecast**: Calculates remaining curriculum duration vs. weekly study hours to show an **Estimated Completion Date** (*"At 3h/week, you will finish by Dec 18"*).

### 2.3. Study Execution & Second Brain Retention
- [x] **Study Focus Session**: Start the global **Focus Timer (`07`)** directly on a Course/Lesson (`category = learning`), automatically logging `TimeSession` study hours against both the Course and any linked **Yearly Goal**.
- [x] **Second Brain Note Linking (CODE *Distill & Express*)**:
  - Attach or generate an Obsidian Markdown note path per Course and per Lesson, viewable inline or opened in **Hermes (`04`)** for Q&A / quizzing (*"Hermes, quiz me on Module 3 of this course using my notes"*).
- [x] **Actionable Deliverable / Lab Tasks**: Spawn practical coding labs or exercises directly into the **Todo List (`07`)** linked to `course_id`.
- [ ] **Spaced Review Prompts**: Resurface completed lesson takeaways at `7d / 30d / 90d` intervals on the Dashboard or Routine check-in.

---

## 3. Core Data Entities

- **`courses`**:
  - `id`, `title`, `provider` (`udemy | coursera | youtube | book | university | custom`), `instructor`, `source_url`
  - `status` (`wishlist | active | capstone | completed | paused | dropped`), `priority`
  - `goal_id` (nullable -> links to Yearly Goal), `youtube_playlist_id` (nullable -> links to `youtube-lists` crawler)
  - `vault_folder_path` (nullable), `certificate_url` (nullable)
  - `total_items`, `completed_items`, `progress_pct`, `estimated_total_minutes`, `logged_study_seconds`
  - `target_completion_date`, `started_at`, `completed_at`, `rating` (1–5), `takeaways_md`.
- **`course_modules`**: `id`, `course_id`, `title`, `sort_order`.
- **`course_lessons`**: `id`, `course_id`, `module_id`, `title`, `duration_minutes`, `status` (`todo | in_progress | distilled | completed`), `external_url`, `youtube_video_id` (nullable), `vault_note_path` (nullable), `key_summary_md`, `completed_at`, `sort_order`.

---

## 4. Locked Decisions

- **Unified Learning Scope**: Tracks **Online Courses + YouTube Playlists + Technical Books + Certifications** in one unified pipeline.
- **Direct YouTube Crawler Integration**: Connects read-only to `data/database/youtube-lists.sqlite` & `data/knowledge-data/lists/youtube/` so crawled playlists can be promoted into tracked Courses with lessons and `youtube-ai` summaries pre-attached.
- **Active Recall via Hermes**: Includes a 1-click **"Quiz Me in Hermes"** button per module/course in v1 (opening a `hermes gateway` quiz session scoped to that course's notes).
