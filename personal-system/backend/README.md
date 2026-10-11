# Personal System - Golang Backend

A high-performance, lightweight Go backend service that powers the Personal System dashboard: managing **Time**, **Tasks**, and **Server Infrastructure**.

---

## ⚡ Features

1. **Task Administration**:
   - Status workflows: `backlog`, `todo`, `in_progress`, `review`, `done`.
   - Priority levels: `low`, `medium`, `high`, `urgent`.
   - Project grouping, tags, due dates, and search.

2. **Time Administration**:
   - Active stopwatch timer (start, stop, pause, discard).
   - Historical time session logging with durations, projects, and categories.
   - Time-blocking schedule endpoints.
   - Real-time time metrics and analytics (today, this week, by project/category).

3. **Server Administration & Probing**:
   - Server inventory (host, port, check type, tags).
   - Concurrent background health prober (TCP / HTTP) with latency tracking.
   - On-demand server probing (`POST /api/servers/{id}/check`).
   - Server status summary (online, degraded, offline).

---

## 🚀 Running Locally

### Prerequisites
- Go 1.22+ (Managed automatically via `mise` or system Go)

### Start the Service
```bash
# Using Makefile
make run

# Or directly with Go
go run ./cmd/server
```

The server starts on port `8080` by default: `http://localhost:8080`.

---

## 📡 REST API Reference

### Health
- `GET /api/health` - Health check status.

### Tasks
- `GET /api/tasks` - List tasks (supports query params: `?status=`, `?priority=`, `?project=`, `?search=`).
- `POST /api/tasks` - Create a new task.
- `GET /api/tasks/{id}` - Retrieve task details.
- `PUT /api/tasks/{id}` - Update task status, priority, or content.
- `DELETE /api/tasks/{id}` - Remove a task.

### Time & Timers
- `GET /api/time/timer` - Get currently active running timer.
- `POST /api/time/timer/start` - Start active timer session.
- `POST /api/time/timer/stop` - Stop active timer and record session duration.
- `POST /api/time/timer/discard` - Discard currently running timer.
- `GET /api/time/sessions` - List recent time sessions (`?limit=50`).
- `GET /api/time/blocks` - List scheduled time blocks.
- `POST /api/time/blocks` - Create a scheduled time block.
- `DELETE /api/time/blocks/{id}` - Delete a time block.
- `GET /api/time/stats` - Productivity aggregate metrics (today, this week).

### Servers & Health
- `GET /api/servers` - List all registered servers with current status & latency.
- `POST /api/servers` - Register a new server node.
- `GET /api/servers/{id}` - Get server details.
- `PUT /api/servers/{id}` - Update server configuration.
- `DELETE /api/servers/{id}` - Remove server from monitoring.
- `POST /api/servers/{id}/check` - Trigger an immediate health probe.
- `GET /api/servers/summary` - Aggregate counts of online, degraded, and offline servers.
