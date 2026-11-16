# E2E Test Suite Ready

> **✅ E2E HARNESS SAFETY (`E2E-S`, commit `027fcc6`) — SAFE BY DEFAULT & SCOPED LIVE RUNS:**
> - **Safe Defaults (`R1`–`R4`, `R6`–`R8`)**: Every live and static mode (`node e2e/run-e2e.mjs`, `--tier N`, or direct `npx playwright test` with `e2e/playwright.config.ts`) automatically allocates a per-run temporary fixture root under `os.tmpdir()` (`E2E_RUN_FIXTURE_ROOT` = `<os.tmpdir()>/hermes-e2e-run-<pid>-<rand>`) with `${E2E_RUN_FIXTURE_ROOT}/vault` (`E2E_SECOND_BRAIN_DIR`), `${E2E_RUN_FIXTURE_ROOT}/youtube-lists.sqlite` (`E2E_YOUTUBE_LISTS_DB`), and `${E2E_RUN_FIXTURE_ROOT}/yt-notes` (`E2E_YOUTUBE_LISTS_NOTES_DIR`), ignoring plain caller `SECOND_BRAIN_DIR`/`YOUTUBE_LISTS_*` env vars that point into `<repo>/data/` or outside `os.tmpdir()`. `assertSafeE2eDataPath()` (`R2`) hard-blocks any path resolving inside `<repo>/data/` (including symlinks, dangling symlinks, and relative segments); `ensureStackReady()` (`R3`) refuses to reuse any unverified listener on `:8080` (`E2E_ALLOW_EXTERNAL_SERVER=false` by default); `cleanupNewSecondBrainFiles()` (`R4`) is confined to the harness-owned temp vault marker `.hermes-e2e-vault-root`; and all `51` files in `e2e/` (`31` spec files, `452` tests) are tracked in git (`R6`).
> - **Scoped & Feature-Tagged Live Runs (`R5`)**: Scoped/filtered invocations run only the matched subset and fail fast (exit `1`) on unknown flags, `0` matches, or `--expect-count` mismatch (see `TEST_INFRA.md § Test Architecture` for the full environment variable table):
>   - Feature-tagged live subset within a tier: `node e2e/run-e2e.mjs --tier 1 --feature F25,F26` / `node e2e/run-e2e.mjs --tier 2 --feature F25,F26`
>   - File-scoped + feature-tagged live subset: `node e2e/run-e2e.mjs --tier 1 --scope area-b-web-shell-ai-surfaces --feature F25,F26`
>   - Test-ID live subset: `node e2e/run-e2e.mjs --tier 3 --test-id T3-10,T3-14`
>   - Pre-flight list with count assertion: `node e2e/run-e2e.mjs --list --feature F25,F26 --expect-count 33`
>   - Inspect resolved safe temp paths without running tests: `node e2e/run-e2e.mjs --print-env`

## Test Runner
- Command: `node e2e/run-e2e.mjs` (or `corepack pnpm@10.34.7 --dir e2e test:e2e`)
- Per-Tier Commands:
  - Tier 1 (Feature Coverage): `node e2e/run-e2e.mjs --tier 1`
  - Tier 2 (Boundary & Corner Cases): `node e2e/run-e2e.mjs --tier 2`
  - Tier 3 (Cross-Feature Combinations): `node e2e/run-e2e.mjs --tier 3`
  - Tier 4 (Real-World Application Scenarios): `node e2e/run-e2e.mjs --tier 4`
- Scoped & Feature-Tagged Live-Run Commands (`R5`):
  - Feature-Tagged Subset (by `@F01`–`@F36`): `node e2e/run-e2e.mjs --tier 1 --feature F25,F26` (or `node e2e/run-e2e.mjs --feature F25,F26` across all tiers)
  - File-Scoped Subset (`--scope` / `--file`): `node e2e/run-e2e.mjs --tier 1 --scope area-b-web-shell-ai-surfaces --feature F25,F26`
  - Test-ID Subset (`--test-id` for `Fxx`, `T3-xx`, `Sxx`): `node e2e/run-e2e.mjs --tier 3 --test-id T3-10,T3-14`
  - Regex Filter & Count Guard (`--grep`, `--expect-count`): `node e2e/run-e2e.mjs --list --feature F25,F26 --expect-count 33`
- Print Resolved Safe Harness Environment (no tests run): `node e2e/run-e2e.mjs --print-env`
- Static Typecheck, AST Zero-Skip & Tag Coverage Audit: `node e2e/run-e2e.mjs --dry-check`
- Runner & Safety Guard Self-Test (`R1`–`R5` + Headless Chrome): `node e2e/run-e2e.mjs --self-test`
- Discovery Listing: `node e2e/run-e2e.mjs --list`
- Expected: all tests pass with exit code 0

## Coverage Summary
| Tier | Count | Description |
|------|------:|-------------|
| 1. Feature Coverage | 197 | >= 5 isolated happy-path E2E tests per feature across all 36 features (`F01`–`F36`) |
| 2. Boundary & Corner | 197 | >= 5 boundary, negative, and resilience E2E tests per feature across all 36 features (`F01`–`F36`) |
| 3. Cross-Feature | 40 | Pairwise cross-feature integration tests covering every feature (`F01`–`F36`) in >= 2 pairs |
| 4. Real-World Application | 18 | End-to-end daily-driver operator workflows (`S01`–`S18`) + full `REF-01`–`REF-14b` Tactical FUI visual rubric |
| **Total** | **452** | **31 Playwright `.spec.ts` files (`0` skipped/fixme/only tests)** |

## Feature Checklist
| Feature | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---------|:------:|:------:|:------:|:------:|
| F01 — Legacy `personal-system/` Removal & `hermes/` Absence (`crawlers/` intact) | 5 | 5 | ✓ (3: `T3-01, T3-20, T3-40`) | ✓ (1: `S16`) |
| F02 — Gitignore Traps & `data/` Zero-Tracking Hygiene | 5 | 5 | ✓ (4: `T3-01, T3-08, T3-20, T3-40`) | ✓ (1: `S16`) |
| F03 — Docs (`AGENTS.md`/`CLAUDE.md`/`README.md`), `mise.toml`, `.env.example` & Unified Podman Stack | 5 | 5 | ✓ (2: `T3-02, T3-40`) | ✓ (1: `S16`) |
| F04 — Multi-Crate Rust Workspace & SQLx `pgvector` Migrations + Starter Seeds | 5 | 5 | ✓ (2: `T3-02, T3-13`) | ✓ (1: `S01`) |
| F05 — Static SPA Serving (`apps/web/dist`) & SPA `index.html` Fallback Routing | 5 | 5 | ✓ (3: `T3-03, T3-35, T3-40`) | ✓ (1: `S16`) |
| F06 — `utoipa` OpenAPI 3.1 Schema (`/api/openapi.json`) & `packages/api-client` Parity | 5 | 5 | ✓ (2: `T3-03, T3-04`) | ✓ (1: `S16`) |
| F07 — Operator Auth, `SHA-256` PATs (`plm_pat_...`) & Pairing QR (`/api/health`, `/api/auth/verify`) | 5 | 5 | ✓ (4: `T3-04, T3-05, T3-06, T3-36`) | ✓ (3: `S10, S14, S15`) |
| F08 — Scoped `UUIDv7` Mobile Delta Sync Backend (`/api/sync/push`, `/api/sync/pull`) | 5 | 5 | ✓ (5: `T3-05, T3-07, T3-08, T3-37, T3-38`) | ✓ (3: `S10, S11, S15`) |
| F09 — `hermes gateway` SSE Bridge (`X-Hermes-Session-Key`) & Offline Mock Resilience | 6 | 6 | ✓ (4: `T3-09, T3-10, T3-14, T3-21`) | ✓ (4: `S03, S05, S09, S14`) |
| F10 — Native Rust `/mcp` (`rmcp`) Server Across All 7 Domains & 3-Tier Write Autonomy | 6 | 6 | ✓ (4: `T3-06, T3-09, T3-11, T3-12`) | ✓ (5: `S03, S04, S09, S13, S15`) |
| F11 — Backend Room Monitor, Life Score `0–100`, Custom Widgets (`command`/`http`/`sql`/`hermes`) & Server Prober | 7 | 7 | ✓ (5: `T3-11, T3-13, T3-22, T3-23, T3-33`) | ✓ (4: `S04, S08, S13, S15`) |
| F12 — Backend Agent Studio Knights (`HP`/`EP`, Barracks, `SOUL.md`, Triggers, Dry-Run), Vault Inspector & Nudges | 6 | 6 | ✓ (4: `T3-10, T3-19, T3-24, T3-31`) | ✓ (5: `S06, S09, S12, S14, S15`) |
| F13 — Backend Todos, Deterministic NLP Parser, Dependency Cycle Guard & Focus Timer (`TimeSession`) | 6 | 6 | ✓ (5: `T3-07, T3-15, T3-21, T3-23, T3-25`) | ✓ (4: `S02, S05, S11, S12`) |
| F14 — Backend Routines, Day Profiles, Habit Streaks, Ideal Week, Check-Ins & `data/second-brain/` Export | 6 | 6 | ✓ (6: `T3-08, T3-16, T3-22, T3-23, T3-24, T3-26`) | ✓ (3: `S01, S11, S12`) |
| F15 — Backend Yearly Goals, Focus Cap, `Q1–Q4` Live OKR Rollups, Pace Drift & `90°` Blueprint Router | 6 | 6 | ✓ (7: `T3-15, T3-16, T3-17, T3-18, T3-19, T3-23, T3-34`) | ✓ (2: `S02, S06`) |
| F16 — Backend Course Tracker, Outline Parser, Read-Only `youtube-lists`/`youtube-ai` Import, Quiz & Spaced Review | 6 | 6 | ✓ (5: `T3-17, T3-19, T3-20, T3-21, T3-22`) | ✓ (3: `S05, S06, S14`) |
| F17 — Backend Finance Operator, `BRL`+`USD` Quote/FX Cache, `10×20` Waffle, Rebalancer, Macro Plan & FIRE Engine | 6 | 6 | ✓ (5: `T3-12, T3-18, T3-19, T3-23, T3-27`) | ✓ (5: `S04, S06, S07, S08, S15`) |
| F18 — `REF-02` Tactical FUI Theme (`0px` Radius, `#08080B`/`#F87C18`/`#F6F6F4`, `>=12px` Font Floor) & `👁️` Privacy Mask | 5 | 5 | ✓ (5: `T3-28, T3-29, T3-32, T3-34, T3-35`) | ✓ (2: `S08, S17`) |
| F19 — `REF-10` Mechanical 8-Blade Shutter Aperture Logo (5 SVG Layers + Status Iris) & HUD Glyphs | 5 | 5 | ✓ (2: `T3-29, T3-39`) | ✓ (1: `S18`) |
| F20 — `REF-09` Orbital Boot Astrolabe, `REF-08` Geodesic Thinking Orb & `REF-11`/`REF-12` HUD Loaders/Micro-Icons | 5 | 5 | ✓ (2: `T3-30, T3-39`) | ✓ (5: `S01, S03, S14, S17, S18`) |
| F21 — Pixel-Art `PNG + JSON` Sprite Engine (`image-rendering: pixelated`, Frieren `REF-14`/`14b` & `REF-13` Knights) | 5 | 5 | ✓ (3: `T3-31, T3-32, T3-38`) | ✓ (2: `S09, S18`) |
| F22 — Shared Tactical Telemetry & Finance Visual Charts (`REF-01`, `REF-06`, `REF-07`, Zero Pie Charts) | 5 | 5 | ✓ (2: `T3-27, T3-33`) | ✓ (5: `S02, S07, S08, S13, S17`) |
| F23 — Web SPA 100% CSR App Shell (`apps/web/dist`), Boot Gate, Persistent ActiveTimer & `Cmd+K` Quick Capture | 5 | 5 | ✓ (4: `T3-14, T3-25, T3-29, T3-30`) | ✓ (4: `S01, S02, S14, S18`) |
| F24 — Multi-Dashboard Room Monitor UI (`/dashboard` & `/monitor`, `cycle_seconds`, Pin/Pause, `👁️`, Custom Panels) | 7 | 7 | ✓ (2: `T3-28, T3-33`) | ✓ (5: `S01, S04, S08, S13, S17`) |
| F25 — Hermes Chat Workspace (`/hermes`, Session Rail, `@mentions`/`/`, `REF-08` Orb, `[Undo]`/`[Approve]`, Vault Distill) | 5 | 5 | ✓ (3: `T3-14, T3-24, T3-30`) | ✓ (6: `S03, S04, S05, S12, S14, S17`) |
| F26 — Agent Studio Isometric Knight Arena (`/agents`, `REF-13`, 4 Zones, `HP`/`EP`, Skill Slots, Knight Forge) | 5 | 5 | ✓ (2: `T3-10, T3-31`) | ✓ (3: `S09, S14, S18`) |
| F27 — Omnipresent Web Frieren Companion (`Cmd+J`, `3px` `#F87C18` Ledge, Page Context, Shared Session, Nudges) | 5 | 5 | ✓ (2: `T3-14, T3-32`) | ✓ (4: `S03, S04, S06, S18`) |
| F28 — Web Todo List (`/todos` — Perspectives, Capacity Meter, `REF-05` Arcs/Tree, `REF-04` `TERMINAL-I/O` Flow, Timer) | 6 | 6 | ✓ (2: `T3-25, T3-37`) | ✓ (5: `S02, S05, S11, S12, S17`) |
| F29 — Web Routine Planning (`/routines` — Stacks, Guided Runner, Day Profiles, Streaks, Ideal Week, Weekly Review) | 6 | 6 | ✓ (2: `T3-26, T3-37`) | ✓ (3: `S01, S11, S12`) |
| F30 — Web Yearly Goals (`/goals` — `Q1–Q4` OKRs, Pace Badges & `#10171D` `REF-03` `90°` Orthogonal Blueprint Map) | 6 | 6 | ✓ (2: `T3-15, T3-34`) | ✓ (3: `S02, S06, S17`) |
| F31 — Web Course Tracker (`/courses` — Catalog, Outline Paste, YouTube Import, Study Timer, Quiz & `7d/30d/90d` Review) | 6 | 6 | ✓ (2: `T3-21, T3-26`) | ✓ (2: `S05, S14`) |
| F32 — Web Finance Operator (`/finance` — `BRL`+`USD`, Waffle, Rebalancer, Macro Monthly Spend Bars, FIRE & `👁️` Blur) | 6 | 6 | ✓ (2: `T3-27, T3-28`) | ✓ (4: `S04, S07, S08, S17`) |
| F33 — Strictly Scoped Capacitor Mobile Shell (`apps/mobile` — ONLY `ROUTINES`, `TODOS`, `COMPANION`, `UPLINK_CONFIG`) | 5 | 5 | ✓ (2: `T3-35, T3-36`) | ✓ (2: `S10, S18`) |
| F34 — Offline-First Mobile SQLite (`UUIDv7`) & `UPLINK_CONFIG` Primary/Fallback Failover + Encrypted PAT + Sync | 5 | 5 | ✓ (3: `T3-36, T3-37, T3-39`) | ✓ (2: `S10, S11`) |
| F35 — Dual-Mode Mobile Frieren Companion (Online Live SSE Chat vs Offline Pixel Loops + Motivational Quotes) | 5 | 5 | ✓ (2: `T3-38, T3-39`) | ✓ (2: `S10, S18`) |
| F36 — Full-Stack Production Verification, Unified Bundle/Stack Readiness & Repository Privacy Invariants | 5 | 5 | ✓ (2: `T3-03, T3-40`) | ✓ (1: `S16`) |
| **Total (`36` Features `F01`–`F36`)** | **197** | **197** | **40 (`T3-01`..`T3-40`)** | **18 (`S01`..`S18`)** |

## Per-File Spec Inventory (31 Files, 452 Tests)
| # | Spec File (`e2e/tests/...`) | Tier | Area / Milestone | Tests | Feature Breakdown / Test IDs | Lines | `expect()` Calls |
|---|-----------------------------|:----:|------------------|:-----:|------------------------------|:-----:|:----------------:|
| 1 | `tier1/area-a-repo-infra.spec.ts` | 1 | Area A (`E2E-M2`) | `20` | `F01: 5, F02: 5, F03: 5, F04: 5` | `670` | `118` |
| 2 | `tier1/area-a-spa-openapi-auth.spec.ts` | 1 | Area A (`E2E-M2`) | `15` | `F05: 5, F06: 5, F07: 5` | `515` | `87` |
| 3 | `tier1/area-a-room-monitor.spec.ts` | 1 | Area A (`E2E-M2`) | `14` | `F11: 7, F24: 7` | `931` | `127` |
| 4 | `tier1/area-b-ai-gateway-mcp-knights.spec.ts` | 1 | Area B (`E2E-M3`) | `18` | `F09: 6, F10: 6, F12: 6` | `1,141` | `174` |
| 5 | `tier1/area-b-web-shell-ai-surfaces.spec.ts` | 1 | Area B (`E2E-M3`) | `25` | `F20: 5, F23: 5, F25: 5, F26: 5, F27: 5` | `1,498` | `148` |
| 6 | `tier1/area-c-todos.spec.ts` | 1 | Area C (`E2E-M4`) | `12` | `F13: 6, F28: 6` | `905` | `116` |
| 7 | `tier1/area-c-routines.spec.ts` | 1 | Area C (`E2E-M4`) | `12` | `F14: 6, F29: 6` | `751` | `65` |
| 8 | `tier1/area-c-goals.spec.ts` | 1 | Area C (`E2E-M4`) | `12` | `F15: 6, F30: 6` | `833` | `50` |
| 9 | `tier1/area-c-courses.spec.ts` | 1 | Area C (`E2E-M4`) | `12` | `F16: 6, F31: 6` | `794` | `92` |
| 10 | `tier1/area-c-finance.spec.ts` | 1 | Area C (`E2E-M4`) | `12` | `F17: 6, F32: 6` | `656` | `65` |
| 11 | `tier1/area-d-fui-design-system.spec.ts` | 1 | Area D (`E2E-M5`) | `20` | `F18: 5, F19: 5, F21: 5, F22: 5` | `808` | `250` |
| 12 | `tier1/area-d-mobile-companion.spec.ts` | 1 | Area D (`E2E-M5`) | `15` | `F33: 5, F34: 5, F35: 5` | `1,001` | `101` |
| 13 | `tier1/area-d-sync-and-prod.spec.ts` | 1 | Area D (`E2E-M5`) | `10` | `F08: 5, F36: 5` | `807` | `115` |
| 14 | `tier2/area-a-repo-infra.spec.ts` | 2 | Area A (`E2E-M2`) | `20` | `F01: 5, F02: 5, F03: 5, F04: 5` | `628` | `63` |
| 15 | `tier2/area-a-spa-openapi-auth.spec.ts` | 2 | Area A (`E2E-M2`) | `15` | `F05: 5, F06: 5, F07: 5` | `483` | `75` |
| 16 | `tier2/area-a-room-monitor.spec.ts` | 2 | Area A (`E2E-M2`) | `14` | `F11: 7, F24: 7` | `876` | `75` |
| 17 | `tier2/area-b-ai-gateway-mcp-knights.spec.ts` | 2 | Area B (`E2E-M3`) | `18` | `F09: 6, F10: 6, F12: 6` | `883` | `82` |
| 18 | `tier2/area-b-web-shell-ai-surfaces.spec.ts` | 2 | Area B (`E2E-M3`) | `25` | `F20: 5, F23: 5, F25: 5, F26: 5, F27: 5` | `1,080` | `119` |
| 19 | `tier2/area-c-todos.spec.ts` | 2 | Area C (`E2E-M4`) | `12` | `F13: 6, F28: 6` | `541` | `43` |
| 20 | `tier2/area-c-routines.spec.ts` | 2 | Area C (`E2E-M4`) | `12` | `F14: 6, F29: 6` | `545` | `36` |
| 21 | `tier2/area-c-goals.spec.ts` | 2 | Area C (`E2E-M4`) | `12` | `F15: 6, F30: 6` | `594` | `39` |
| 22 | `tier2/area-c-courses.spec.ts` | 2 | Area C (`E2E-M4`) | `12` | `F16: 6, F31: 6` | `490` | `48` |
| 23 | `tier2/area-c-finance.spec.ts` | 2 | Area C (`E2E-M4`) | `12` | `F17: 6, F32: 6` | `497` | `46` |
| 24 | `tier2/area-d-fui-design-system.spec.ts` | 2 | Area D (`E2E-M5`) | `20` | `F18: 5, F19: 5, F21: 5, F22: 5` | `592` | `142` |
| 25 | `tier2/area-d-mobile-companion.spec.ts` | 2 | Area D (`E2E-M5`) | `15` | `F33: 5, F34: 5, F35: 5` | `943` | `67` |
| 26 | `tier2/area-d-sync-and-prod.spec.ts` | 2 | Area D (`E2E-M5`) | `10` | `F08: 5, F36: 5` | `635` | `56` |
| 27 | `tier3/tier3-infra-auth-sync-mcp.spec.ts` | 3 | Pairwise (`E2E-M6`) | `14` | `T3-01`..`T3-14` (`20` features) | `1,117` | `172` |
| 28 | `tier3/tier3-life-ops-cross-domain.spec.ts` | 3 | Pairwise (`E2E-M6`) | `13` | `T3-15`..`T3-27` (`18` features) | `1,284` | `146` |
| 29 | `tier3/tier3-fui-sprites-ui-mobile.spec.ts` | 3 | Pairwise (`E2E-M6`) | `13` | `T3-28`..`T3-40` (`27` features) | `628` | `91` |
| 30 | `tier4/tier4-operator-journeys-01-09.spec.ts` | 4 | Journeys (`E2E-M6`) | `9` | `S01`..`S09` (`24` features) | `1,362` | `145` |
| 31 | `tier4/tier4-operator-journeys-10-18.spec.ts` | 4 | Journeys (`E2E-M6`) | `9` | `S10`..`S18` (`34` features, incl. `REF-01`–`REF-14b` Rubric) | `1,058` | `127` |
| **Total** | **`31` `.spec.ts` files** | **1–4** | **`E2E-M2`..`E2E-M6`** | **`452`** | **`197` T1 + `197` T2 + `40` T3 + `18` T4 (`36/36` `F01`–`F36`)** | **`25,546`** | **`3,080`** |
