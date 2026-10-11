# Infrastructure & Deployment

This directory contains container definitions, compose orchestrators, and deployment scripts for running the complete **Second Brain** platform.

---

## 📦 Services Overview

The unified compose stack runs 4 core services:
1. **`postgres`** (`pgvector/pgvector:pg16` on port `5432`): High-dimensional semantic embeddings and relational storage.
2. **`redis`** (`redis:7-alpine` on port `6379`): Fast task queue and crawler cache.
3. **`personal-backend`** (Golang on port `8080`): Time session tracking, task administration, and background server health prober.
4. **`personal-frontend`** (Next.js on port `3000`): Full interactive dashboard UI for administering time, tasks, and servers.

---

## 🚀 Running Everything with Podman

From the project root:
```bash
# Build and start all services in the background
podman-compose up -d

# Check running status
podman-compose ps

# View container logs
podman-compose logs -f

# Stop all services
podman-compose down
```

Or deploy directly from `infra-deploy/`:
```bash
cd infra-deploy
podman-compose up -d
```

---

## 🌐 Endpoints

- **Web Dashboard**: [http://localhost:3000](http://localhost:3000)
- **Golang API**: [http://localhost:8080](http://localhost:8080)
- **API Health Check**: [http://localhost:8080/api/health](http://localhost:8080/api/health)
- **PostgreSQL**: `localhost:5432`
- **Redis**: `localhost:6379`
