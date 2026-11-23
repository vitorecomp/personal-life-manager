# `HERMES // OS` — Second Brain Documentation

Welcome to the documentation hub for **`HERMES // OS` (Personal Life Manager)**.

---

## 📚 Table of Contents

- [System Architecture](./architecture.md) — High-level component topology, data flows, and runtime boundaries.
- [Second Brain Methodology](./methodology.md) — Operating principles: Capture, Organize, Distill, Express (CODE) across `HERMES // OS`.
- [Authoritative v1.0 Specifications & Reference Atlas](../life-manager/systems-requirements/README.md) — Complete functional, API, database, and `REF-01`–`REF-14` Tactical FUI specifications.

---

## 🧭 Repository Map

| Directory | Role | Description |
| :--- | :--- | :--- |
| [`life-manager/backend/`](../AGENTS.md) | **Core Engine & API** | Multi-crate Rust 2024 workspace (`domain`, `life-ops`, `intelligence`, `server`) serving REST, SSE, `/mcp`, and static SPA assets. |
| [`life-manager/packages/`](../AGENTS.md) | **Shared UI & SDK** | `@hermes/ui` (`REF-02` `0px` Tactical FUI design system & pixel-art sprites) and `@hermes/api-client` (OpenAPI 3.1 SDK). |
| [`life-manager/apps/web/`](../life-manager/systems-requirements/README.md) | **Command Deck SPA** | 100% client-rendered Vite + React 19 Web SPA for Modules `03`–`11`. |
| [`life-manager/apps/mobile/`](../life-manager/systems-requirements/02-companion-app.md) | **Mobile Companion** | Offline-first Capacitor + SQLite mobile app scoped strictly to `ROUTINES`, `TODOS`, `COMPANION`, and `UPLINK_CONFIG`. |
| [`crawlers/`](../crawlers/README.md) | **Capture** | Python YouTube playlist/AI note collectors (`youtube-lists`, `youtube-ai`, `youtube-clean`) and web/RSS crawler templates. |
| [`scripts/`](../scripts/README.md) | **Sync & Hygiene** | Obsidian Second Brain vault clone/pull (`download_brain.sh`), Dropbox rclone sync (`sync_dropbox.sh`), and git hooks. |
| [`sub-systems/`](../sub-systems/README.md) | **Standalone Tools** | Independent automation sub-systems and calculators (`auto-players`, `satisfatory-plan`). |
| [`life-manager/infra-deploy/`](../life-manager/infra-deploy/README.md) | **Deploy & Run** | Unified multi-stage `Dockerfile` (built by podman), Podman Compose stacks, and `pgvector` initialization scripts. |
| [`life-manager/systems-requirements/`](../life-manager/systems-requirements/README.md) | **Specifications** | Locked v1.0 specifications (`01`–`12`) and visual reference assets (`REF-01`–`REF-14`). |
| `data/` *(gitignored)* | **Private Vault** | Zero-tracked local directory holding `second-brain/`, `knowledge-data/`, and `database/`. |
| `hermes` / `silverbullet` services ([`podman-compose.yml`](../podman-compose.yml)) | **Agent & Vault Editor** | Hermes Agent container (the `hermes gateway` on `:8642`) over the vault in `data/second-brain/`, and the SilverBullet web editor over the same vault. |
