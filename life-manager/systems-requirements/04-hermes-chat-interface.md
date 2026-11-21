# 04 — Hermes Chat Interface (Sessions Sidebar & High-Level Thinking Orb)

> **Status**: Locked v1.0
> **Platforms**: Web SPA Only (Excluded from Companion App — mobile uses Frieren Companion `06`)
> **AI Engine**: Powered natively by **`hermes gateway` (`http://127.0.0.1:8642/v1`)** + Rust Life Ops **`/mcp`** server
> **Visual References**: [`REF-08`](./assets/ref-08-hermes-high-level-thinking-orb.jpg) (Thinking Orb), [`REF-01`](./assets/ref-01-dimensional-triad-grid.jpg) (Sessions Sidebar), [`REF-07`](./assets/ref-07-dashboard-finance-waffle-ai.jpg) (Chat Cards)

---

## 1. Purpose

**Hermes** is your full-screen, deep-research and strategic-planning workspace wired directly to **Nous Research's `hermes gateway`** (with full access to its persistent memory, `SKILL.md` skills, Obsidian Vault, and our Rust Life Ops `/mcp` server).

---

## 2. Locked Functional Requirements

### 2.1. Unified Sessions Sidebar (`X-Hermes-Session-Key`)
- [x] **Persistent Session Rail (`REF-01` Notched Strips)**: Styled with left-edge vertical amber active tabs, grouped into *Pinned*, *Today*, *Previous 7 Days*, and *Archived/Folders*.
- [x] **Shared History with Frieren (`06`)**: Quick chats started with the omnipresent pixel-art Frieren Companion share the same `X-Hermes-Session-Key` store—appearing here automatically so any quick conversation can expand into full-screen research in 1 click.
- [x] **Session Controls**: New session (`Cmd+Shift+O`), smart auto-titling, rename, pin, branch/fork from any turn, full-text search, and profile/Knight selector.

### 2.2. Streaming Conversation & `/mcp` Action Cards
- [x] **Real-Time SSE Streaming**: Streams reasoning (`<thinking>`), tool/MCP calls, and GFM Markdown (tables, code blocks, Mermaid diagrams, KaTeX).
- [x] **Domain `@mentions` & `/` Commands**: Scope context via `@vault`, `@youtube`, `@goals`, `@todos`, `@routines`, `@courses`, `@portfolio`, or trigger `/deep-plan`, `/weekly-review`, `/quiz-me`.
- [x] **Tiered `/mcp` Write Autonomy**:
  - Low-risk reversible Life Ops writes (*create todo*, *check routine*, *start timer*) execute immediately with an inline **`[Undo]`** badge.
  - High-impact writes (*portfolio/monthly plan edits*, *deletions*, *bulk updates*) render a **`[✓ Approve]` `[✎ Edit]` `[✕ Cancel]`** confirmation card.

### 2.3. High-Level Thinking / Deep Planning Visualizer (`REF-08`)
- [x] **Geodesic Wireframe Sphere & Counter-Rotating Orbital Rings**:
  - Rendered in lightweight **Canvas2D / SVG + CSS 3D** when `[🧠 HIGH_LEVEL_PLAN]` is toggled for strategic planning, architecture synthesis, or Yearly Goal decomposition.
  - Vertices illuminate as `hermes gateway` queries Vault notes and `/mcp` Life Ops modules; orbital tick rings lock as reasoning steps complete, collapsing into an inspectable plan breakdown header.

### 2.4. Source & Tool Inspector (Collapsible Right Drawer)
- [x] **Citations & `/mcp` Trace**: Preview cited Obsidian Markdown notes, `youtube-ai` notes, and `/mcp` tool payloads side-by-side; 1-click *"Distill to Vault Inbox"*.

---

## 3. Data & Gateway Synchronization

- **`hermes_sessions_index`** (PostgreSQL mirror/index synced with `hermes gateway`): `session_key` (PK), `title`, `origin` (`hermes_view | frieren_popover | knight_run`), `profile_slug`, `pinned`, `archived`, `high_level_mode` (bool), `last_route_context`, `created_at`, `updated_at`.
- **`pending_mcp_approvals`**: `id`, `session_key`, `tool_name`, `payload_json`, `status` (`pending | approved | rejected`), `created_at`.
