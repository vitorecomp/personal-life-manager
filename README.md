# 🧠 Personal Life Manager (Second Brain)

A modular, automated **Second Brain** platform designed to capture external knowledge, synthesize insights using AI, track personal goals and routines, and automate background tasks.

---

## 🏗️ Architecture Overview

```mermaid
flowchart TD
    subgraph Capture["1. Capture & Automation"]
        CR["crawlers/\nWeb, RSS, Bookmarks"]
        SCH["schedulers/\nCron jobs, Bot automation"]
    end

    subgraph Infrastructure["2. Infrastructure (infra-deploy/)"]
        PG[("PostgreSQL + pgvector")]
        RD[("Redis Queue")]
    end

    subgraph Brain["3. Intelligence Core (hermes/)"]
        HERMES["Hermes Engine\n(Embedding, LLM Synthesis, Search API)"]
    end

    subgraph LifeOps["4. Personal Execution"]
        PS["personal-system/\nGoals, Routines, Daily Logs"]
    end

    CR --> RD
    SCH --> RD
    RD --> HERMES
    HERMES <--> PG
    PS <--> HERMES
```

---

## 📂 Repository Structure

| Module | Description | Quick Link |
| :--- | :--- | :--- |
| **`crawlers/`** | Web scrapers, RSS ingestion, bookmark synchronizers, and content fetchers. | [Explore Crawlers](file:///home/vitor/workspace/personal/personal-life-manager/crawlers/README.md) |
| **`documentation/`** | System architecture, data flow diagrams, and Second Brain methodology. | [View Docs](file:///home/vitor/workspace/personal/personal-life-manager/documentation/README.md) |
| **`hermes/`** | Core engine: LLM orchestration, semantic search, vector indexing, and assistant API. | [Explore Hermes](file:///home/vitor/workspace/personal/personal-life-manager/hermes/README.md) |
| **`infra-deploy/`** | Docker Compose configurations (Postgres/pgvector, Redis), environment templates, and deployment scripts. | [View Deploy Specs](file:///home/vitor/workspace/personal/personal-life-manager/infra-deploy/README.md) |
| **`personal-system/`** | Personal goal tracking, routine checklists, daily logs, and reflection journals. | [View Personal System](file:///home/vitor/workspace/personal/personal-life-manager/personal-system/README.md) |
| **`schedulers/`** | Scheduled automations, background jobs, legacy bots (`auto-players`, `satisfatory-plan`). | [Explore Schedulers](file:///home/vitor/workspace/personal/personal-life-manager/schedulers/README.md) |
| **`scripts/`** | Helper scripts (e.g. syncing Obsidian Second Brain GitHub repository). | [Explore Scripts](file:///home/vitor/workspace/personal/personal-life-manager/scripts/README.md) |
| **`database/`** *(gitignored)* | Local clone of your Obsidian Second Brain markdown vault. | Synced via `./scripts/download_brain.sh` |

---

## ⚡ Quickstart

### 1. Prerequisites
- Docker & Docker Compose
- Python 3.10+
- Git

### 2. Configure Environment & Sync Obsidian Database
```bash
# Copy and configure environment variables
cp .env.example .env
# Set OBSIDIAN_BRAIN_REPO_URL in .env

# Clone or pull your Obsidian Second Brain into database/
./scripts/download_brain.sh
```

### 3. Launch Local Infrastructure
```bash
cp infra-deploy/.env.example infra-deploy/.env
cd infra-deploy
docker compose up -d
```

### 3. Verify Hermes Core
```bash
python hermes/main.py --status
```

---

## 📖 Key Documentation
- [System Architecture](file:///home/vitor/workspace/personal/personal-life-manager/documentation/architecture.md)
- [Second Brain Methodology](file:///home/vitor/workspace/personal/personal-life-manager/documentation/methodology.md)