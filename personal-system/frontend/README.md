# Personal System - Next.js Frontend

A modern Next.js dashboard (App Router, Tailwind CSS, Lucide Icons) for managing **Time**, **Tasks**, and **Server Infrastructure** connected to the Golang backend.

---

## ⚡ Features

- **Executive Dashboard (`/`)**: High-level status overview, active timer card, pending tasks preview, and server fleet health badges.
- **Time Tracker (`/time`)**: Live interactive stopwatch, category allocations (Deep Work, Maintenance, Learning), session notes, and analytics.
- **Task Management (`/tasks`)**: Kanban board across 5 stages (`backlog`, `todo`, `in_progress`, `review`, `done`), priority tags, and task creation modal.
- **Server Administration (`/servers`)**: Live status monitoring (online / degraded / offline), TCP/HTTP latency indicators, instant on-demand probes, and node registration.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ (Node 26+ installed)
- Running [Golang Backend](file:///home/vitor/workspace/personal/personal-life-manager/personal-system/backend) on `http://localhost:8080`

### Run Development Server
```bash
# Install dependencies (if not already done)
npm install

# Start the dev server
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) in your browser.

---

## ⚙️ Configuration

Copy `.env.local.example` to `.env.local` to override the backend API endpoint if running on a custom host or port:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8080
```
