# 06 — AI Mastermind Companion (Frieren Pixel-Art System Chat & Co-Pilot)

> **Status**: Locked v1.0
> **Platforms**:
> - **Web SPA**: Omnipresent Pixel-Art Sprite + Main System Chat across all screens (`<CompanionStage />`)
> - **Companion App (`02`)**: **Live AI Chat** when in server range; **Random Pixel Animations + Local Motivational Phrase Bank** when offline
> **AI Engine**: Routed via **`hermes gateway` (`:8642/v1`)** with shared **`X-Hermes-Session-Key`** history and Rust **`/mcp`** Life Ops tools
> **Visual References**: [`REF-14`](./assets/ref-14b-companion-keyframes-strip.jpg) (Wind/Blink Portrait), [`REF-01`](./assets/ref-01-dimensional-triad-grid.jpg) & [`REF-02`](./assets/ref-02-protocol-diagnosis-fui.jpg) (FUI Ledges & Speech Frame)

---

## 1. Locked Identity & Role

Your **AI Mastermind Companion** is an **animated pixel-art elf Arch-Mage inspired by Frieren**, inhabiting the `REF-02` Tactical FUI command deck like a modern, intelligent **Clippy**:
1. **Main Chat Interface to Handle the System**: Click her or press `Cmd+J` on any screen to issue natural-language commands across Dashboards, Todos, Routines, Yearly Goals, Courses, Portfolio/FI, and Agent Knights.
2. **Proactive Strategic Mastermind**: Watches cross-module signals (e.g., *0h logged on an active Course in 14d*, *Portfolio asset drifted >5% from target weight*, *Goal KR behind quarterly pace*) and surfaces non-intrusive pixel scroll nudges (`!`) + leads Weekly/Quarterly Council Reviews alongside your Agent Knights (`05`).

---

## 2. Locked UX, Animation & Safety Rules

- [x] **Dual-Scale Pixel Art (`PNG + JSON` Hot-Swappable Sprite Pipeline)**:
  1. **Perched Screen-Space Mini-Sprite**: Walks, sits, reads grimoires, casts spells, and naps along `REF-02`'s `3px` orange horizontal panel ledges across every screen (and on your Room Monitor `/monitor`!), rendered with strict integer `image-rendering: pixelated`.
  2. **Waist-Up Atmospheric Portrait (`REF-14`)**: Inside the `Cmd+J` chat popover and Companion App tab, plays a serene `8–12 fps` loop with half-lidded downward deadpan gaze, slow natural blink + head tilt, wind-swaying silver twin-tails/*ahoge*, and drifting `+` mana glints.
- [x] **Automatic Page Context Injection**: Automatically attaches `active_route`, `active_dashboard_id`, or `selected_entity_id` to every `hermes gateway` request.
- [x] **Unified Session History (`04`)**: Every Companion chat uses a real `X-Hermes-Session-Key` visible in the **Hermes (`04`)** sidebar with a 1-click *"Expand in Full Hermes View ↗"* button.
- [x] **Tiered `/mcp` Write Autonomy**:
  - **Immediate + `[Undo]` Toast**: Low-risk reversible actions (*create/complete todo*, *log routine check-in*, *start/stop focus timer*, *switch Room Monitor deck*).
  - **`[✓ Approve]` Confirmation Card**: High-impact actions (*monthly investment/portfolio edits*, *deleting goals/courses/tasks*, *modifying custom shell command widgets*).
- [x] **Offline Mobile Behavior (`02`)**: When out of range of the Rust server on mobile, she cycles through random pixel animations (*reading grimoire*, *stargazing*, *blue-flower folk spell*, *tea*, *Mimic chest gag*) and speaks random deadpan motivational lines from `companion_offline_phrases` when tapped or when Todos/Routines are checked off.
