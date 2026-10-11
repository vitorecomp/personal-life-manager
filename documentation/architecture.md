# System Architecture

## 1. High-Level Diagram

```mermaid
flowchart TD
    subgraph DataCollection["Data Collection & Automation"]
        C["crawlers/\n(Web, RSS, Notes)"]
        S["schedulers/\n(Automation & Cron Jobs)"]
    end

    subgraph InfraLayer["Infrastructure & Storage (infra-deploy/)"]
        DB[("PostgreSQL / pgvector")]
        Redis[("Redis Queue")]
    end

    subgraph CoreEngine["Core Processing (hermes/)"]
        Ingest["Ingestion Worker"]
        Index["Embeddings & Indexer"]
        LLM["LLM Synthesis & Agent"]
        API["Search & Assistant API"]
    end

    subgraph UserInterface["User & Life Operations"]
        PS["personal-system/\n(Routines, Goals, Logs)"]
        Client["CLI / Web / Chat Client"]
    end

    C --> Redis
    S --> Redis
    Redis --> Ingest
    Ingest --> DB
    Ingest --> Index
    Index --> DB

    Client <--> API
    API <--> LLM
    LLM <--> DB
    PS -. integrates with .-> API
```

---

## 2. Component Interactions

1. **Ingestion Flow**:
   - `crawlers/` gather external content and push normalized documents into Redis or direct Hermes endpoints.
   - `schedulers/` run periodic routines, auto-player bots, and trigger crawler syncs.

2. **Processing & Indexing**:
   - `hermes/` receives raw documents, generates vector embeddings, extracts tags/summaries, and indexes them in PostgreSQL / pgvector.

3. **Querying & Retrieval**:
   - The user asks questions or looks up memories through Hermes.
   - Hermes retrieves relevant context via hybrid search (semantic + keyword) and synthesizes answers using LLMs.

4. **Personal Life Integration**:
   - `personal-system/` holds personal schemas (goals, habits, routines, journals) that Hermes can reference to assist with daily planning and habit tracking.
