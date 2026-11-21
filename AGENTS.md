# 🤖 AGENTS.md — Agent & Contributor Guide

Welcome to the **Personal Life Manager (Second Brain)** repository. This document establishes technical context, architectural standards, development workflows, and operational rules for AI agents and human contributors working within this codebase.

---

## 📌 1. Project Overview & Philosophy

The **Personal Life Manager** is a modular, automated **Second Brain** platform engineered to:
1. **Capture** external knowledge, bookmarks, RSS feeds, and personal notes.
2. **Synthesize** intelligence using vector search, embeddings, and LLM reasoning.
3. **Administer** life operations: time tracking, task workflows, goal tracking, and server infrastructure health.
4. **Automate** background tasks, game simulations, and routine maintenance.

The architecture is guided by the **CODE** methodology (**Capture, Organize, Distill, Express**) adapted for automated systems and AI agents:
- **Capture**: Automated ingestion workers (`crawlers/`) and manual inputs.
- **Organize**: Structured life operations (`personal-system/`) and markdown taxonomy.
- **Distill**: the Hermes Agent (Nous Research) container working over the Obsidian vault.
- **Express**: Actionable task execution, time blocks, and routine reviews.

---

## 🏗️ 2. Repository Architecture & Layout

This repository is organized as a polyglot monorepo with distinct module boundaries:

```
personal-life-manager/
├── crawlers/              # Web scrapers, RSS ingestion, and content fetchers (Python)
├── documentation/         # System architecture, data flow, and methodology docs
├── infra-deploy/          # Compose definitions (PostgreSQL + pgvector, Redis) & deploy scripts
├── personal-system/       # Life operations full-stack application & markdown trackers
│   ├── backend/           # Lightweight Golang REST API (Tasks, Time, Server health)
│   ├── frontend/          # Next.js 16 + React 19 + Tailwind CSS dashboard UI
│   ├── goals/             # Goal templates and trackers
│   ├── routines/          # Weekly/daily routine checklists
│   └── logs/              # Historical daily logs
├── scripts/               # Automation scripts (e.g. syncing Obsidian markdown vault)
├── sub-systems/           # Standalone bots and game automations (auto-players, satisfatory-plan)
├── data/                  # [GITIGNORED] Local data
│   ├── second-brain/      # Clone of the Obsidian Second Brain markdown vault
│   ├── knowledge-data/    # Crawler output (Markdown notes), backed up to Dropbox only
│   └── database/          # SQLite files used by the crawlers, hermes-mds/ (Hermes Agent state)
├── mise.toml              # Tool version manager configuration (Go)
├── podman-compose.yml     # Root orchestrator for multi-container stack
└── README.md              # Project overview and quickstart
```

### Module Responsibilities & Tech Stacks

| Module | Primary Language / Stack | Role & Purpose | Key Entrypoints / Specs |
| :--- | :--- | :--- | :--- |
| **`personal-system/backend`** | Go 1.24 (`net/http`) | High-performance REST API for task workflows, timer/time sessions, and concurrent TCP/HTTP server health probing. | `cmd/server/main.go`, `Makefile` |
| **`personal-system/frontend`** | Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS v4 | Interactive administrative UI dashboard for tasks, stopwatch/time blocking, and server monitoring. | `src/app/page.tsx`, `src/lib/api.ts` |
| **`hermes`** (service) | Hermes Agent, official image | AI agent (Gemini) over the vault in `data/second-brain/`; state in `data/database/hermes-mds/`. Not code in this repo. | `podman-compose.yml` (`hermes` service) |
| **`crawlers`** | Python 3 | Background data collectors for RSS, web bookmarks, and articles emitting standardized JSON schemas. | `crawlers/template_crawler.py` |
| **`infra-deploy`** | Compose / Podman / Docker | PostgreSQL 16 (`pgvector/pgvector:pg16`), Redis 7 (`redis:7-alpine`), and container configs. | `infra-deploy/docker-compose.yml` |
| **`sub-systems`** | Node.js / Python / Shell | Standalone automation sub-systems (e.g., game bots, calculation tools). | `sub-systems/satisfatory-plan/` |
| **`scripts`** | Bash / Shell | Utility scripts such as `./scripts/download_brain.sh` to synchronize the personal Obsidian vault. | `scripts/download_brain.sh` |

---

## ⚙️ 3. Development Environment & Tooling

- **Version Manager**: `mise` manages tool runtimes (`mise.toml`). System Go / Node / Python runtimes can also be used directly.
- **Container Engine**: Podman & Podman Compose (or Docker & Docker Compose).
- **Go**: Version 1.22+ (configured for Go 1.24).
- **Node.js**: Version 20+ (with npm).
- **Python**: Version 3.10+.

---

## 🚀 4. Common Commands & Workflows

### 4.1. Infrastructure & Full-Stack Orchestration (Podman / Docker)

From the repository root:
```bash
# Start all services (Postgres + pgvector, Redis, Backend, Frontend)
podman-compose up -d

# Check container health and status
podman-compose ps

# View unified logs
podman-compose logs -f

# View logs for a specific service
podman-compose logs -f personal-backend
podman-compose logs -f personal-frontend

# Teardown the stack
podman-compose down
```

*Note: Replace `podman-compose` with `docker compose` if running Docker.*

### 4.2. Personal System - Backend (Go)

Working directory: `personal-system/backend`
```bash
# Run server locally (starts at http://localhost:8080)
make run
# or: go run ./cmd/server

# Build production binary to bin/server
make build

# Run unit and integration tests
make test
# or: go test -v ./...

# Clean build artifacts
make clean
```

### 4.3. Personal System - Frontend (Next.js)

Working directory: `personal-system/frontend`
```bash
# Install dependencies
npm install

# Start development server with Turbopack (http://localhost:3000)
npm run dev

# Run production build
npm run build

# Run linter
npm run lint
```

### 4.4. Intelligence Core (Hermes Agent)

From the repository root:
```bash
# Start the agent (official nousresearch/hermes-agent image)
podman-compose up -d hermes

# Chat with it in the terminal
podman exec -it hermes hermes

# Stop it before ./scripts/sync_dropbox.sh (its SQLite stores are open while it runs)
podman-compose stop hermes
```

### 4.5. Obsidian Knowledge Vault Sync

From the repository root:
```bash
# Synchronize Obsidian vault into gitignored data/second-brain/ directory
./scripts/download_brain.sh
```

---

## 📐 5. Code Standards & Architecture Guidelines

### 5.1. General Monorepo Boundaries
- **Keep modules decoupled**: Sub-systems and crawlers should interact with the Personal System via well-defined REST endpoints or message queues (Redis), not by tightly coupling internal directory paths.
- **No monolithic cross-imports**: Backend Go code should remain completely independent of frontend Node packages.

### 5.2. Golang Backend Guidelines (`personal-system/backend`)
- **Package Architecture**:
  - `cmd/server/`: Main application entry point and signal lifecycle.
  - `internal/config/`: Environment variable and configuration loading.
  - `internal/models/`: Pure domain types and JSON serialization schemas.
  - `internal/storage/`: Data persistence interfaces and implementations (e.g. `file_store.go`).
  - `internal/services/`: Core business logic (tasks, time tracking, server probing).
  - `internal/handlers/`: HTTP handlers, middlewares, and route registrations.
- **Routing**: Use Go 1.22+ standard library HTTP routing (`http.NewServeMux()` with HTTP method matching: `mux.HandleFunc("GET /api/tasks", ...)`). Avoid introducing heavy external web frameworks unless strictly requested.
- **Concurrency & Resilience**: Server health probing uses goroutines and context timeouts. Ensure all background operations use appropriate cancellation contexts and mutexes (`sync.RWMutex`) to prevent race conditions.
- **Testing**: Write unit tests for services and store implementations using standard `testing` package.

### 5.3. Next.js Frontend Guidelines (`personal-system/frontend`)
- **App Router & React 19**: This project uses Next.js 16 with the App Router and React 19. Be aware of Next.js 16 breaking changes and API conventions (see `personal-system/frontend/AGENTS.md` and `node_modules/next/dist/docs/`).
- **Client vs. Server Components**: Mark interactive components and pages containing React hooks (`useState`, `useEffect`, event listeners) with `"use client"` at the top.
- **Clean Effects**: Avoid synchronous `setState` calls directly within `useEffect` bodies that trigger cascading renders. Encapsulate data fetching cleanly or use async handlers.
- **TypeScript**: Ensure strict typing. Avoid `any` types; define and export shared models in `src/lib/types.ts`.
- **Styling**: Use Tailwind CSS utility classes adhering to the dark-theme design language established in `src/app/globals.css`.

### 5.4. Crawlers & Document Contracts (`crawlers/`)
- All crawler implementations must normalize captured data into the standard ingestion document schema before queueing:
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

1. **Obsidian Vault Privacy**:
   - The `data/` directory holds private Obsidian notes, crawler output and SQLite files. It is strictly listed in `.gitignore`.
   - **Never** add, track, or commit files from `data/` to Git.
2. **Environment & Secrets**:
   - Environment secrets belong in `.env`.
   - `.env` and `.env.*` are ignored by Git. Only commit `.env.example`.
   - When introducing new environment variables, document them in `.env.example`.
3. **Commit Messages**:
   - Follow the **Conventional Commits** specification:
     - `feat: <description>` for new capabilities.
     - `fix: <description>` for bug fixes.
     - `docs: <description>` for documentation updates.
     - `refactor: <description>` for restructuring code without behavioral change.
     - `test: <description>` for adding or updating tests.
     - `chore: <description>` for maintenance or dependency updates.
4. **Verification Before Completion**:
   - Before concluding any modification task, execute the relevant tests and checks (e.g., `make test` for backend, `npm run build` or `npm run lint` for frontend) to verify nothing is broken.
