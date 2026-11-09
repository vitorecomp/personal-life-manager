# Second Brain Documentation

Welcome to the central documentation hub for the **Personal Life Manager** Second Brain.

---

## 📚 Table of Contents

- [System Architecture](file:///home/vitor/workspace/personal/personal-life-manager/documentation/architecture.md) - High-level system design, data flows, and component interaction.
- [Second Brain Methodology](file:///home/vitor/workspace/personal/personal-life-manager/documentation/methodology.md) - Operating principles: Capture, Organize, Distill, Express (CODE) and Personal Life Integration.

---

## 🧭 Repository Map

| Directory | Role | Description |
| :--- | :--- | :--- |
| [`crawlers/`](file:///home/vitor/workspace/personal/personal-life-manager/crawlers) | **Capture** | Web scrapers, RSS ingestion, bookmark sync, and external data feeds. |
| `hermes` service ([`podman-compose.yml`](file:///home/vitor/workspace/personal/personal-life-manager/podman-compose.yml)) | **Process & Synthesize** | Hermes Agent (Nous Research): AI agent over the Obsidian vault in `data/second-brain/`. |
| [`personal-system/`](file:///home/vitor/workspace/personal/personal-life-manager/personal-system) | **Organize & Act** | Daily routines, habit tracking, life metrics, goals, and personal knowledge logs. |
| [`schedulers/`](file:///home/vitor/workspace/personal/personal-life-manager/schedulers) | **Automate** | Scheduled background jobs, cron tasks, automated routines, and game/life automation. |
| [`infra-deploy/`](file:///home/vitor/workspace/personal/personal-life-manager/infra-deploy) | **Deploy & Run** | Docker compose, environment variables, local databases, and deployments. |
| [`documentation/`](file:///home/vitor/workspace/personal/personal-life-manager/documentation) | **Reference** | Conceptual guides, architecture specifications, and design decisions. |
