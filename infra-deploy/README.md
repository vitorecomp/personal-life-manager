# Infrastructure & Deployment

This directory contains infrastructure as code, container definitions, and deployment scripts for running the **Second Brain** platform.

---

## 📦 Services Overview

The base local infrastructure consists of:
- **PostgreSQL (`pgvector`)**: Stores relational entities, crawled documents, personal systems, and high-dimensional semantic embeddings.
- **Redis**: Fast message queue and cache for crawler jobs and Hermes task dispatching.

---

## 🚀 Local Development Setup

1. **Configure Environment**:
   ```bash
   cp infra-deploy/.env.example infra-deploy/.env
   # Edit .env with your secrets and preferences
   ```

2. **Start Infrastructure**:
   ```bash
   cd infra-deploy
   docker compose up -d
   ```

3. **Verify Health**:
   ```bash
   docker compose ps
   ```
