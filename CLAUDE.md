# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A detailed contributor guide lives in [AGENTS.md](AGENTS.md) (module responsibilities, code standards, crawler data contracts). This file summarizes what you need most often; AGENTS.md is authoritative for anything not covered here.

## What this repo is

A polyglot monorepo for a personal "Second Brain" platform. Two largely independent halves:

1. **Knowledge pipeline** (mostly scaffolding today): `crawlers/` (Python) will push normalized documents into Redis; `hermes/` (Python) will consume them, embed into PostgreSQL + pgvector, and expose semantic search. `hermes/main.py` is currently a CLI stub (`--status`, `--query`).
2. **Personal system** (fully implemented): `personal-system/backend` (Go 1.24, stdlib-only REST API on :8080) + `personal-system/frontend` (Next.js 16 / React 19 / Tailwind v4 dashboard on :3000) for tasks, time tracking, and server health monitoring.

Important architectural fact: the Go backend does **not** use Postgres or Redis — it persists everything to a single JSON file via `internal/storage/file_store.go` (path from the `DATA_FILE` env var, default `data/store.json`). Postgres/pgvector and Redis exist for the hermes/crawlers pipeline.

The stack is orchestrated by the root `podman-compose.yml` (postgres, redis, personal-backend, personal-frontend). `infra-deploy/` holds the infra-only compose definitions.

`data/` is gitignored local data with three folders: `second-brain/` (clone of the private Obsidian vault, synced via `./scripts/download_brain.sh`), `knowledge-data/` (crawler output) and `database/` (SQLite files). Never track or commit anything under it.

## Commands

### Full stack (repo root)
```bash
podman-compose up -d      # or: docker compose up -d
podman-compose logs -f personal-backend
podman-compose down
```

### Go backend (`personal-system/backend/`)
```bash
make run                  # go run ./cmd/server → http://localhost:8080
make build                # builds bin/server
make test                 # go test -v ./...
go test -v ./internal/services/ -run TestName   # single test
```

### Next.js frontend (`personal-system/frontend/`)
```bash
npm install
npm run dev               # Turbopack dev server → http://localhost:3000
npm run build             # production build (use as the verification check)
npm run lint              # eslint
```

### Hermes / vault sync (repo root)
```bash
python hermes/main.py --status
python hermes/main.py --query "..."
./scripts/download_brain.sh   # sync Obsidian vault into data/second-brain/ (needs OBSIDIAN_BRAIN_REPO_URL in .env)
```

Before finishing a change, run the relevant check: `make test` for backend, `npm run build` or `npm run lint` for frontend.

## Architecture notes

### Go backend (`personal-system/backend/`)
Layered stdlib-only design — request flow: `internal/handlers` (routes in `routes.go`, CORS/logging in `middleware.go`) → `internal/services` (business logic) → `internal/storage` (`Store` interface + `file_store.go`). `internal/models` holds pure domain types; `internal/config` reads env vars (`PORT`, `DATA_FILE`, `PROBE_INTERVAL_SECONDS`, `CORS_ORIGIN`).

- Routing uses Go 1.22+ method matching (`mux.HandleFunc("GET /api/tasks", ...)`). Don't introduce web frameworks.
- Server health probing runs background goroutines on an interval; use context timeouts for probes and `sync.RWMutex` around shared state.

### Next.js frontend (`personal-system/frontend/`)
- App Router pages under `src/app/` (`tasks/`, `time/`, `servers/`). All API access goes through `src/lib/api.ts`, which reads `NEXT_PUBLIC_API_URL` (default `http://localhost:8080`). Shared types live in `src/lib/types.ts` — keep them in sync with the Go models.
- This is Next.js 16: APIs and conventions may differ from your training data. Check `personal-system/frontend/AGENTS.md` and `node_modules/next/dist/docs/` before writing non-trivial Next.js code.
- Interactive components need `"use client"`. Follow the dark-theme Tailwind styling in `src/app/globals.css`.

### Monorepo boundaries
Modules communicate via REST or Redis queues — never by importing across module directories. Crawlers must emit the standard ingestion document schema defined in AGENTS.md §5.4.

## Conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- Secrets go in `.env` (gitignored); document new env vars in `.env.example`.
