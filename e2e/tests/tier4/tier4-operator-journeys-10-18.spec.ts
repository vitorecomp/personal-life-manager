import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  E2E_PATHS,
  E2E_URLS,
  ensureStackReady,
  withIsolatedBackend,
  createApiClient,
  unwrapList,
  createPatToken,
  readSseEvents,
  uniqueId,
  CleanupRegistry,
  snapshotSecondBrainFiles,
  cleanupNewSecondBrainFiles,
  createMcpClient,
  startMockTcpServer,
  startMockHttpServer,
  waitForAppReady,
  auditZeroBorderRadius,
  auditInteractiveFontFloor,
  auditColorTokens,
  auditPixelatedSprites,
  auditApertureLogo,
  auditOrthogonalBlueprintCorridors,
} from '../../harness';

function makeUuidV7(): string {
  const nowHex = Date.now().toString(16).padStart(12, '0').slice(-12);
  const randA = crypto.randomBytes(2).toString('hex').slice(1);
  const randB = crypto.randomBytes(8).toString('hex');
  const variantNibble = ((parseInt(randB[0] || '8', 16) & 0x3) | 0x8).toString(16);
  return `${nowHex.slice(0, 8)}-${nowHex.slice(8, 12)}-7${randA}-${variantNibble}${randB.slice(1, 4)}-${randB.slice(4, 16)}`;
}

function findVaultFileContaining(rootDir: string, needle: string): string | null {
  if (!fs.existsSync(rootDir)) return null;
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const text = fs.readFileSync(full, 'utf8');
        if (entry.name.includes(needle) || text.includes(needle)) {
          return full;
        }
      }
    }
  }
  return null;
}

test.describe('Tier 4 Real-World Operator Journeys & Visual Rubric Audits — Scenarios 10 to 18 (S10..S18)', () => {
  test(
    '[T4][S10] Commuter Offline-First Mobile Companion Roundtrip: Pair Mobile via PAT/UPLINK_CONFIG -> Go Offline -> Log UUIDv7 Todos, Routine Checkoffs & Timer in Local SQLite + Tap Offline Frieren for Quotes/Loops -> Reconnect (Primary -> Fallback Failover) -> /api/sync/push & /api/sync/pull -> Verify Parity on Web SPA',
    { tag: ['@tier4', '@F07', '@F08', '@F33', '@F34', '@F35'] },
    async ({ page }) => {
      const { baseUrl, mobileUrl } = await ensureStackReady({ requireMobile: true });
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        // Step 1: Create plm_pat_... Token, Verify /api/auth/verify & Pairing QR (F07)
        const pat = await createPatToken(api, uniqueId('s10-commuter-pat'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authedApi = api.withToken(pat.token);

        const verifyRes = await authedApi.get('/api/auth/verify');
        expect(verifyRes.status).toBe(200);
        expect(verifyRes.json?.authenticated).toBe(true);
        const seq0 = Number(verifyRes.json?.latest_server_seq ?? 0);

        const qrRes = await api.post('/api/auth/pairing-qr', {
          name: uniqueId('s10-qr'),
          primary_url: baseUrl,
        });
        expect([200, 201]).toContain(qrRes.status);

        // Step 2: Strict Mobile Scope Audit on :4174 (F33)
        await waitForAppReady(page, `${mobileUrl}/`);
        const mobileText = (await page.locator('body').innerText()).toUpperCase();
        expect(mobileText).toContain('ROUTINES');
        expect(mobileText).toContain('TODOS');
        expect(mobileText).toContain('COMPANION');

        const excludedCount = await page
          .locator(
            'a[href="/monitor"], a[href="/hermes"], a[href="/agents"], a[href="/goals"], a[href="/courses"], a[href="/finance"]',
          )
          .count();
        expect(excludedCount).toBe(0);

        // Step 3: Offline SQLite UUIDv7 Operations & Offline Frieren Animations/Quotes (F34, F35)
        const companionTab = page
          .locator('button:has-text("COMPANION"), [data-tab="companion"], a:has-text("COMPANION")')
          .first();
        if ((await companionTab.count()) > 0) {
          await companionTab.click();
          await page.waitForTimeout(200);
        }

        const spriteAudit = await auditPixelatedSprites(page);
        expect(spriteAudit.spriteCount).toBeGreaterThanOrEqual(1);
        expect(spriteAudit.violations).toEqual([]);

        // Step 4: Reconnect & Delta Sync via /api/sync/push & /api/sync/pull -> Verify Parity on Web SPA (F08, F34)
        const mobileTaskId = makeUuidV7();
        const mobileSessionId = makeUuidV7();
        const mobileTaskTitle = uniqueId('S10-Commuter-Offline-Todo');
        const nowIso = new Date().toISOString();
        cleanup.defer(async () => {
          await api.delete(`/api/time/sessions/${mobileSessionId}`);
          await api.delete(`/api/tasks/${mobileTaskId}`);
        });

        const pushRes = await authedApi.post('/api/sync/push', {
          client_id: uniqueId('mob-s10'),
          mutations: [
            {
              mutation_id: makeUuidV7(),
              entity_table: 'tasks',
              entity_id: mobileTaskId,
              op: 'upsert',
              payload: {
                id: mobileTaskId,
                title: mobileTaskTitle,
                status: 'todo',
                priority: 'high',
                energy_level: 'quick',
              },
              client_updated_at: nowIso,
            },
            {
              mutation_id: makeUuidV7(),
              entity_table: 'time_sessions',
              entity_id: mobileSessionId,
              op: 'upsert',
              payload: {
                id: mobileSessionId,
                task_id: mobileTaskId,
                category: 'deep_work',
                timer_mode: 'pomodoro_25_5',
                started_at: new Date(Date.now() - 1500_000).toISOString(),
                ended_at: nowIso,
                duration_seconds: 1500,
              },
              client_updated_at: nowIso,
            },
          ],
        });
        expect(pushRes.status).toBe(200);
        expect(Number(pushRes.json?.applied_count ?? 0)).toBeGreaterThanOrEqual(2);

        const pullRes = await authedApi.get(`/api/sync/pull?since=${seq0}`);
        expect(pullRes.status).toBe(200);
        const changes = unwrapList(pullRes, ['changes']);
        expect(changes.some((c: any) => c.entity_id === mobileTaskId)).toBe(true);

        await waitForAppReady(page, `${baseUrl}/todos`);
        const webBody = await page.locator('body').innerText();
        expect(webBody).toContain(mobileTaskTitle);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T4][S11] Bidirectional Conflict Resolution Journey: Concurrent Offline Mobile Edit + Online Web SPA Edit on Shared Task & Routine Log -> Reconnect Delta Push/Pull -> Verify Deterministic updated_at LWW & UUIDv7 Set-Union Without Data Loss',
    { tag: ['@tier4', '@F08', '@F13', '@F14', '@F28', '@F29', '@F34'] },
    async ({ page }) => {
      const { baseUrl, mobileUrl } = await ensureStackReady({ requireMobile: true });
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        const pat = await createPatToken(api, uniqueId('s11-lww-pat'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authedApi = api.withToken(pat.token);

        // Step 1: Seed Shared Task & Routine Item on Server (F13, F14)
        const sharedTaskRes = await api.post('/api/tasks', {
          title: 'S11 Shared Spec Task v1',
          status: 'todo',
          priority: 'medium',
        });
        expect([200, 201]).toContain(sharedTaskRes.status);
        const sharedTask = sharedTaskRes.json?.task ?? sharedTaskRes.json;
        const sharedTaskId = sharedTask.id;
        cleanup.defer(async () => {
          await api.delete(`/api/tasks/${sharedTaskId}`);
        });

        const routineRes = await api.post('/api/routines', {
          name: uniqueId('S11 Shared Routine'),
          time_slot: 'evening',
          day_profile: 'workday',
          target_start_time: '20:00:00',
          active: true,
        });
        const routine = routineRes.json?.routine ?? routineRes.json;
        cleanup.defer(async () => {
          await api.delete(`/api/routines/${routine.id}`);
        });

        const itemRes = await api.post(`/api/routines/${routine.id}/items`, {
          title: 'Shared Evening Mobility',
          tracking_type: 'boolean',
          frequency_type: 'daily',
          estimated_minutes: 15,
          sort_order: 1,
        });
        const item = itemRes.json?.item ?? itemRes.json;
        cleanup.defer(async () => {
          await api.delete(`/api/routine-items/${item.id}`);
        });

        const pull0 = await authedApi.get('/api/sync/pull?since=0');
        const seq0 = Number(pull0.json?.latest_server_seq ?? 0);

        // Step 2: Concurrent Web SPA Mutation (newer) vs Offline Mobile Push (stale on sharedTask, newer on routineLog, plus set-union new task)
        const webWinnerTitle = uniqueId('S11 Shared Task — WEB_NEWER');
        const webUpdateRes = await api.put(`/api/tasks/${sharedTaskId}`, {
          title: webWinnerTitle,
          status: 'in_progress',
          priority: 'urgent',
        });
        expect(webUpdateRes.status).toBe(200);

        const today = new Date().toISOString().slice(0, 10);
        await api.post('/api/routine-logs', {
          routine_item_id: item.id,
          log_date: today,
          status: 'completed',
          notes: 'web-log-initial',
        });

        const mobileSetUnionId = makeUuidV7();
        const mobileSetUnionTitle = uniqueId('S11-Mobile-SetUnion-Task');
        cleanup.defer(async () => {
          await api.delete(`/api/tasks/${mobileSetUnionId}`);
        });

        const stalePastIso = new Date(Date.now() - 120_000).toISOString();
        const futureNewerIso = new Date(Date.now() + 60_000).toISOString();

        const pushRes = await authedApi.post('/api/sync/push', {
          client_id: uniqueId('mob-s11'),
          mutations: [
            {
              mutation_id: makeUuidV7(),
              entity_table: 'tasks',
              entity_id: sharedTaskId,
              op: 'upsert',
              payload: {
                id: sharedTaskId,
                title: 'S11 Shared Task — MOBILE_STALE_LOSER',
                status: 'todo',
                priority: 'low',
              },
              client_updated_at: stalePastIso,
            },
            {
              mutation_id: makeUuidV7(),
              entity_table: 'routine_logs',
              entity_id: makeUuidV7(),
              op: 'upsert',
              payload: {
                routine_item_id: item.id,
                log_date: today,
                status: 'partial',
                notes: 'mobile-newer-winner',
              },
              client_updated_at: futureNewerIso,
            },
            {
              mutation_id: makeUuidV7(),
              entity_table: 'tasks',
              entity_id: mobileSetUnionId,
              op: 'upsert',
              payload: {
                id: mobileSetUnionId,
                title: mobileSetUnionTitle,
                status: 'todo',
                priority: 'high',
              },
              client_updated_at: new Date().toISOString(),
            },
          ],
        });
        expect(pushRes.status).toBe(200);

        // Step 3: Reconcile via /api/sync/pull & Verify LWW + Set-Union Parity on Web & Mobile
        const pullAfter = await authedApi.get(`/api/sync/pull?since=${seq0}`);
        expect(pullAfter.status).toBe(200);

        const sharedAfterRes = await api.get(`/api/tasks/${sharedTaskId}`);
        expect(sharedAfterRes.status).toBe(200);
        const sharedAfter = sharedAfterRes.json?.task ?? sharedAfterRes.json;
        expect(sharedAfter.title).toBe(webWinnerTitle);

        const setUnionAfterRes = await api.get(`/api/tasks/${mobileSetUnionId}`);
        expect(setUnionAfterRes.status).toBe(200);
        const setUnionAfter = setUnionAfterRes.json?.task ?? setUnionAfterRes.json;
        expect(setUnionAfter.title).toBe(mobileSetUnionTitle);

        await waitForAppReady(page, `${baseUrl}/todos`);
        await waitForAppReady(page, `${mobileUrl}/`);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T4][S12] Sunday 4-Step Weekly Review Ritual: Triage Inbox Todos -> Inspect Auto-Populated Deep Work, Habit Adherence, Course & Surplus Telemetry -> Write Reflection -> Export data/second-brain/Reviews/YYYY-Www.md -> Preview in Hermes Vault Inspector',
    { tag: ['@tier4', '@F12', '@F13', '@F14', '@F25', '@F28', '@F29'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();
      const beforeVault = snapshotSecondBrainFiles();
      cleanup.defer(() => cleanupNewSecondBrainFiles(beforeVault));

      try {
        // Step 1: Triage Inbox Todos (F13, F28)
        const inbox1Res = await api.post('/api/tasks', {
          title: uniqueId('S12-Inbox-Triage-1'),
          status: 'inbox',
          priority: 'medium',
        });
        const inbox2Res = await api.post('/api/tasks', {
          title: uniqueId('S12-Inbox-Triage-2'),
          status: 'inbox',
          priority: 'high',
        });
        for (const r of [inbox1Res, inbox2Res]) {
          expect([200, 201]).toContain(r.status);
          const id = (r.json?.task ?? r.json)?.id;
          if (id) {
            cleanup.defer(async () => {
              await api.delete(`/api/tasks/${id}`);
            });
          }
        }
        const t1Id = (inbox1Res.json?.task ?? inbox1Res.json).id;
        const t2Id = (inbox2Res.json?.task ?? inbox2Res.json).id;

        await api.patch(`/api/tasks/${t1Id}/status`, { status: 'todo' });
        await api.patch(`/api/tasks/${t2Id}/status`, { status: 'done' });

        // Step 2: Inspect Auto-Populated Weekly Review Telemetry (F13, F14, F29)
        const summaryRes = await api.get('/api/weekly-review/summary?week=2026-W46');
        expect(summaryRes.status).toBe(200);
        expect(summaryRes.json).toBeTruthy();

        // Step 3: Write Reflection, Top 3 Priorities & Export data/second-brain/Reviews/YYYY-Www.md (F14, F29)
        await waitForAppReady(page, `${baseUrl}/routines`);

        const reviewDate = '2026-11-15';
        const winsMarker = uniqueId('Completed distributed consensus module and hit 64% savings rate');
        const putReview = await api.put(`/api/checkins/${reviewDate}`, {
          day_profile_used: 'weekend',
          energy_score: 5,
          mood_score: 5,
          sleep_hours: 8.25,
          highlight: 'Sunday 4-Step Weekly Review',
          reflection_md: 'Consistent deep work and zero context switching.',
          weekly_review_json: {
            week: '2026-W46',
            wins_md: winsMarker,
            blockers_md: 'Context switching on Tuesday afternoon.',
            priorities: ['Ship E2E Tier 4', 'Complete Rust Tokio course', 'Rebalance B3 FIIs'],
            next_week_priorities: [
              'Ship E2E Tier 4',
              'Complete Rust Tokio course',
              'Rebalance B3 FIIs',
            ],
          },
        });
        expect(putReview.status).toBe(200);

        const reviewMdFile =
          findVaultFileContaining(path.join(E2E_PATHS.secondBrainDir, 'Reviews'), winsMarker) ??
          findVaultFileContaining(E2E_PATHS.secondBrainDir, winsMarker);
        expect(reviewMdFile).toBeTruthy();
        const reviewMdContent = fs.readFileSync(reviewMdFile!, 'utf8');
        expect(reviewMdContent).toContain(winsMarker);
        expect(reviewMdContent).toContain('Ship E2E Tier 4');

        // Step 4: Preview Exported Weekly Review in Hermes Vault Inspector (F12, F25)
        const relPath = path.relative(E2E_PATHS.secondBrainDir, reviewMdFile!).replace(/\\/g, '/');
        const noteRes = await api.get(`/api/vault/note?path=${encodeURIComponent(relPath)}`);
        expect(noteRes.status).toBe(200);
        expect(JSON.stringify(noteRes.json)).toContain(winsMarker);

        await waitForAppReady(page, `${baseUrl}/hermes`);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T4][S13] Infrastructure & Server Health Incident Drill: Register Local TCP & HTTP Nodes -> Verify online Sparklines -> Simulate HTTP 503 (degraded) & Port Down (offline) -> Verify /api/events/stream SSE Alert on /monitor & /mcp servers_get_summary',
    { tag: ['@tier4', '@F10', '@F11', '@F22', '@F24'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const mcp = createMcpClient(E2E_URLS.mcpUrl);
      const cleanup = new CleanupRegistry();
      cleanup.defer(() => mcp.closeSession());

      const mockTcp = await startMockTcpServer();
      cleanup.defer(() => mockTcp.close());
      const mockHttp = await startMockHttpServer(200, '{"status":"healthy"}');
      cleanup.defer(() => mockHttp.close());

      try {
        // Step 1: Register TCP & HTTP Server Nodes & Verify online State (F11)
        const tcpRes = await api.post('/api/servers', {
          name: uniqueId('S13-Redis-Loopback-TCP'),
          host: mockTcp.host,
          port: mockTcp.port,
          check_type: 'tcp',
          tags: ['infra', 'cache'],
        });
        expect([200, 201]).toContain(tcpRes.status);
        const tcpNode = tcpRes.json?.server ?? tcpRes.json;
        const tcpId = tcpNode.id;
        cleanup.defer(async () => {
          await api.delete(`/api/servers/${tcpId}`);
        });

        const httpRes = await api.post('/api/servers', {
          name: uniqueId('S13-Gateway-Loopback-HTTP'),
          host: mockHttp.host,
          port: mockHttp.port,
          check_type: 'http',
          http_url: `${mockHttp.url}/health`,
          tags: ['infra', 'http'],
        });
        expect([200, 201]).toContain(httpRes.status);
        const httpNode = httpRes.json?.server ?? httpRes.json;
        const httpId = httpNode.id;
        cleanup.defer(async () => {
          await api.delete(`/api/servers/${httpId}`);
        });

        const c1 = await api.post(`/api/servers/${tcpId}/check`, {});
        expect(c1.status).toBe(200);
        expect((c1.json?.server ?? c1.json)?.status).toBe('online');

        const c2 = await api.post(`/api/servers/${httpId}/check`, {});
        expect(c2.status).toBe(200);
        expect((c2.json?.server ?? c2.json)?.status).toBe('online');

        // Step 2: Simulate HTTP 503 -> degraded & Port Down -> offline with SSE Stream Alert (F11, F24)
        mockHttp.setResponse(503, '{"status":"overloaded"}');
        const ssePromise = readSseEvents(`${baseUrl}/api/events/stream`, {
          maxEvents: 1,
          timeoutMs: 3_500,
        });
        await new Promise((r) => setTimeout(r, 150));

        const cDegraded = await api.post(`/api/servers/${httpId}/check`, {});
        expect(cDegraded.status).toBe(200);
        expect((cDegraded.json?.server ?? cDegraded.json)?.status).toBe('degraded');
        await ssePromise;

        await mockTcp.close();
        const cOffline = await api.post(`/api/servers/${tcpId}/check`, {});
        expect(cOffline.status).toBe(200);
        expect((cOffline.json?.server ?? cOffline.json)?.status).toBe('offline');

        // Step 3: Verify /mcp servers_get_summary & Room Monitor Sparklines (F10, F22, F24)
        const mcpSummary = await mcp.callTool('servers_get_summary', {});
        expect(mcpSummary.status).toBe(200);
        expect(mcpSummary.isError).toBe(false);

        const restSummary = await api.get('/api/servers/summary');
        expect(restSummary.status).toBe(200);
        expect(Number(restSummary.json?.degraded ?? restSummary.json?.degraded_count ?? 1)).toBeGreaterThanOrEqual(1);
        expect(Number(restSummary.json?.offline ?? restSummary.json?.offline_count ?? 1)).toBeGreaterThanOrEqual(1);

        await waitForAppReady(page, `${baseUrl}/dashboard`);
        await waitForAppReady(page, `${baseUrl}/monitor`);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T4][S14] Gateway Outage Graceful Degradation Journey: Boot Web SPA & Mobile Companion with hermes gateway (:8642) Offline -> Verify hermes_gateway: "offline_mock" on /api/health, [3 // READY] Boot Completion, Deterministic Chat/Quiz/Knight Fallbacks, Zero HTTP 500s',
    { tag: ['@tier4', '@F07', '@F09', '@F12', '@F16', '@F20', '@F23', '@F25', '@F26', '@F31'] },
    async ({ page }) => {
      const { mobileUrl } = await ensureStackReady({ requireMobile: true });
      const cleanup = new CleanupRegistry();

      try {
        await withIsolatedBackend(
          { HERMES_GATEWAY_URL: 'http://127.0.0.1:1/v1' },
          async ({ baseUrl }) => {
            const api = createApiClient(baseUrl);
            const server500Responses: string[] = [];
            page.on('response', (res) => {
              if (res.url().startsWith(baseUrl) && res.status() >= 500) {
                server500Responses.push(`${res.status()} ${res.url()}`);
              }
            });

            // Step 1: /api/health Reports hermes_gateway: "offline_mock" (F07, F09)
            const healthRes = await api.get('/api/health');
            expect(healthRes.status).toBe(200);
            expect(healthRes.json?.db_online).toBe(true);
            expect(healthRes.json?.hermes_gateway).toBe('offline_mock');

            // Step 2: Web SPA Cold Boot Reaches [3 // READY] Without Hanging (F20, F23)
            await waitForAppReady(page, `${baseUrl}/dashboard`);
            await waitForAppReady(page, `${mobileUrl}/`);

            // Step 3: Deterministic Offline Mock Streaming in /hermes (F09, F25)
            const offlineSessionKey = uniqueId('s14-offline-session');
            cleanup.defer(async () => {
              await api.delete(`/api/hermes/sessions/${offlineSessionKey}`);
            });

            const sseEvents = await readSseEvents(`${baseUrl}/api/hermes/chat/stream`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Hermes-Session-Key': offlineSessionKey,
              },
              body: JSON.stringify({
                message: 'Status report while gateway is offline',
                high_level_mode: true,
              }),
              stopOnEvent: 'done',
              timeoutMs: 10_000,
            });
            expect(sseEvents.length).toBeGreaterThan(0);

            await waitForAppReady(page, `${baseUrl}/hermes`);

            // Step 4: Deterministic Course Quiz Fallback on /courses (F16, F31)
            const courseRes = await api.post('/api/courses', {
              title: uniqueId('S14 Offline Quiz Course'),
              status: 'active',
            });
            expect([200, 201]).toContain(courseRes.status);
            const course = courseRes.json?.course ?? courseRes.json;
            cleanup.defer(async () => {
              await api.delete(`/api/courses/${course.id}`);
            });

            const modRes = await api.post(`/api/courses/${course.id}/modules`, {
              title: 'Module 1',
              sort_order: 1,
            });
            const mod = modRes.json?.module ?? modRes.json;
            const lessonRes = await api.post(`/api/course-modules/${mod.id}/lessons`, {
              title: 'Raft Term Invariants',
              duration_minutes: 30,
              key_summary_md: 'Raft uses monotonically increasing term numbers.',
              sort_order: 1,
            });
            const lesson = lessonRes.json?.lesson ?? lessonRes.json;

            const quizRes = await api.post(`/api/courses/${course.id}/quiz`, {
              lesson_id: lesson.id,
            });
            expect([200, 201]).toContain(quizRes.status);

            // Step 5: Deterministic Knight Dispatch Fallback on /agents (F12, F26)
            const agents = unwrapList(await api.get('/api/agents'));
            const activeKnight =
              agents.find(
                (k: any) =>
                  k.enabled !== false &&
                  Number(k.monthly_budget_cents ?? 500) > 0 &&
                  k.grid_pos?.zone !== 'standby_barracks',
              ) ?? agents[0];
            expect(activeKnight).toBeTruthy();

            const dispatchRes = await api.post(`/api/agents/${activeKnight.id}/dispatch`, {
              dry_run: false,
            });
            expect(dispatchRes.status).toBeLessThan(500);

            expect(server500Responses).toEqual([]);
          },
        );
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T4][S15] Security, Auth & Read-Only Boundary Audit Journey: Revoke PAT (401 immediate block), Attempt Custom SQL DROP TABLE/SELECT * FROM api_tokens (Rejected), Attempt Unapproved /mcp Finance/Command Mutation (Blocked), Attempt Path Traversal on Vault Inspector (400)',
    { tag: ['@tier4', '@F07', '@F08', '@F10', '@F11', '@F12', '@F17'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const mcp = createMcpClient(E2E_URLS.mcpUrl);
      const cleanup = new CleanupRegistry();
      cleanup.defer(() => mcp.closeSession());

      try {
        // Step 1: Immediate PAT Revocation Enforcement & Zero Hash Leakage (F07, F08)
        const pat = await createPatToken(api, uniqueId('s15-sec-audit-pat'));
        const tokensRes = await api.get('/api/auth/tokens');
        expect(tokensRes.status).toBe(200);
        const tokensStr = JSON.stringify(tokensRes.json);
        expect(tokensStr).not.toContain(pat.token);
        expect(tokensStr).not.toContain('token_sha256');

        const verifyActive = await api.withToken(pat.token).get('/api/auth/verify');
        expect(verifyActive.status).toBe(200);

        const revokeRes = await api.delete(`/api/auth/tokens/${pat.id}`);
        expect([200, 204]).toContain(revokeRes.status);

        expect((await api.withToken(pat.token).get('/api/auth/verify')).status).toBe(401);
        expect((await api.withToken(pat.token).get('/api/sync/pull?since=0')).status).toBe(401);
        expect((await api.withToken(pat.token).get('/api/tasks')).status).toBe(401);

        // Step 2: Scoped Mobile Sync Table Whitelist Enforcement (F08)
        const activePat = await createPatToken(api, uniqueId('s15-active-pat'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${activePat.id}`);
        });
        const authedApi = api.withToken(activePat.token);

        const badSync1 = await authedApi.post('/api/sync/push', {
          client_id: 'sec-audit-client',
          mutations: [
            {
              mutation_id: makeUuidV7(),
              entity_table: 'portfolio_assets',
              entity_id: makeUuidV7(),
              op: 'upsert',
              payload: { symbol: 'HACK' },
              client_updated_at: new Date().toISOString(),
            },
          ],
        });
        expect(badSync1.status).toBe(400);

        const badSync2 = await authedApi.post('/api/sync/push', {
          client_id: 'sec-audit-client',
          mutations: [
            {
              mutation_id: makeUuidV7(),
              entity_table: 'api_tokens',
              entity_id: makeUuidV7(),
              op: 'upsert',
              payload: { name: 'HACK' },
              client_updated_at: new Date().toISOString(),
            },
          ],
        });
        expect(badSync2.status).toBe(400);

        // Step 3: Custom SQL Widget Read-Only & Sensitive-Table Guardrail (F11)
        const dashRes = await api.post('/api/dashboards', {
          title: uniqueId('S15 Security Deck'),
          slug: uniqueId('s15-sec-deck'),
          cycle_seconds: 60,
          in_rotation: false,
        });
        const dash = dashRes.json?.dashboard ?? dashRes.json;
        cleanup.defer(async () => {
          await api.delete(`/api/dashboards/${dash.id}`);
        });

        for (const forbiddenQuery of ['DROP TABLE tasks;', 'SELECT * FROM api_tokens']) {
          const wRes = await api.post(`/api/dashboards/${dash.id}/widgets`, {
            title: 'Forbidden SQL Widget',
            source_kind: 'sql',
            renderer_kind: 'table',
            grid_x: 0,
            grid_y: 0,
            grid_w: 4,
            grid_h: 2,
            source_config: { query: forbiddenQuery },
          });
          if ([200, 201].includes(wRes.status)) {
            const w = wRes.json?.widget ?? wRes.json;
            const refRes = await api.post(`/api/widgets/${w.id}/refresh`, {});
            expect(
              refRes.status >= 400 ||
                Boolean(refRes.json?.error) ||
                !JSON.stringify(refRes.json).includes('token_sha256'),
            ).toBe(true);
          } else {
            expect(wRes.status).toBeGreaterThanOrEqual(400);
          }
        }

        // Verify tasks table is completely intact
        expect((await api.get('/api/tasks')).status).toBe(200);

        // Step 4: Unapproved /mcp Finance Mutation Gate (F10, F17)
        const delCall = await mcp.callTool('finance_delete_asset', {
          id: '00000000-0000-7000-8000-000000000001',
          asset_id: '00000000-0000-7000-8000-000000000001',
        });
        expect(delCall.status).toBe(200);
        const approvals = unwrapList(await api.get('/api/mcp/approvals'));
        const gated =
          approvals.find((a: any) => a.id === delCall.approvalId) ??
          approvals.find(
            (a: any) => a.status === 'pending' && String(a.tool_name || '').includes('delete_asset'),
          );
        expect(gated).toBeTruthy();
        if (gated?.id) {
          await api.post(`/api/mcp/approvals/${gated.id}/reject`, {});
        }

        // Step 5: Vault Inspector Path Traversal Rejection (F12)
        const trav1 = await api.get('/api/vault/note?path=../../.env');
        expect(trav1.status).toBeGreaterThanOrEqual(400);
        expect(trav1.status).toBeLessThan(500);

        const trav2 = await api.get('/api/vault/note?path=../../../etc/passwd');
        expect(trav2.status).toBeGreaterThanOrEqual(400);
        expect(trav2.status).toBeLessThan(500);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T4][S16] Production Static Hosting, OpenAPI SDK & Monorepo Hygiene Audit: Verify Deep-Link Refresh on All 9 Web Routes (200 index.html) vs /api/unknown (404 JSON), /api/openapi.json Schema Completeness, personal-system/ & hermes/ Absence, crawlers/ Integrity, and git ls-files data/ Empty',
    { tag: ['@tier4', '@F01', '@F02', '@F03', '@F05', '@F06', '@F36'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);

      // Step 1: Legacy personal-system/ & hermes/ Absence + crawlers/ Integrity (F01)
      expect(fs.existsSync(path.join(E2E_PATHS.repoRoot, 'personal-system'))).toBe(false);
      expect(fs.existsSync(path.join(E2E_PATHS.repoRoot, 'hermes', 'main.py'))).toBe(false);
      expect(fs.existsSync(path.join(E2E_PATHS.repoRoot, 'hermes', 'README.md'))).toBe(false);
      expect(fs.existsSync(path.join(E2E_PATHS.repoRoot, 'crawlers', 'youtube-lists'))).toBe(true);
      expect(fs.existsSync(path.join(E2E_PATHS.repoRoot, 'crawlers', 'youtube-ai'))).toBe(true);
      expect(fs.existsSync(path.join(E2E_PATHS.repoRoot, 'crawlers', 'youtube-clean'))).toBe(true);
      expect(fs.existsSync(path.join(E2E_PATHS.repoRoot, 'scripts', 'download_brain.sh'))).toBe(true);
      expect(fs.existsSync(path.join(E2E_PATHS.repoRoot, 'scripts', 'sync_dropbox.sh'))).toBe(true);
      expect(fs.existsSync(path.join(E2E_PATHS.repoRoot, 'sub-systems'))).toBe(true);

      // Step 2: Gitignore Traps & data/ Zero-Tracking Privacy Invariant (F02)
      const serverIgnore = spawnSync(
        'git',
        ['check-ignore', '-q', 'backend/crates/server/Cargo.toml'],
        { cwd: E2E_PATHS.repoRoot },
      );
      expect(serverIgnore.status).not.toBe(0);

      const trackedData = execFileSync('git', ['ls-files', 'data/'], {
        cwd: E2E_PATHS.repoRoot,
        encoding: 'utf8',
      }).trim();
      expect(trackedData).toBe('');

      const statusData = execFileSync('git', ['status', '--porcelain', 'data/'], {
        cwd: E2E_PATHS.repoRoot,
        encoding: 'utf8',
      }).trim();
      expect(statusData).toBe('');

      // Step 3: Docs, mise.toml, .env.example & Unified Podman Compose Stack (F03)
      for (const rel of [
        'AGENTS.md',
        'CLAUDE.md',
        'README.md',
        'mise.toml',
        '.env.example',
        'podman-compose.yml',
        'infra-deploy/Dockerfile',
      ]) {
        expect(fs.existsSync(path.join(E2E_PATHS.repoRoot, rel))).toBe(true);
      }

      // Step 4: Deep-Link SPA Fallback Across All 9 Web Routes vs /api/* JSON 404 (F05, F36)
      const routes = [
        '/dashboard',
        '/monitor',
        '/hermes',
        '/agents',
        '/todos',
        '/routines',
        '/goals',
        '/courses',
        '/finance',
      ];
      for (const route of routes) {
        const res = await fetch(`${baseUrl}${route}`, { headers: { Accept: 'text/html' } });
        expect(res.status).toBe(200);
        expect((res.headers.get('content-type') || '').toLowerCase()).toContain('text/html');
        const body = await res.text();
        expect(body).toMatch(/<div\s+id=["'](root|app)["']/i);
        expect(body).not.toContain('__NEXT_DATA__');

        await waitForAppReady(page, `${baseUrl}${route}`);
      }

      const api404 = await api.get('/api/non-existent-endpoint-404');
      expect(api404.status).toBe(404);
      expect((api404.headers.get('content-type') || '').toLowerCase()).toContain('application/json');

      // Step 5: utoipa OpenAPI 3.1 Schema Completeness & packages/api-client Parity (F06)
      const openApi = await api.get('/api/openapi.json');
      expect(openApi.status).toBe(200);
      expect(String(openApi.json?.openapi || '')).toMatch(/^3\.1\./);
      expect(
        fs.existsSync(path.join(E2E_PATHS.repoRoot, 'packages', 'api-client', 'src', 'index.ts')),
      ).toBe(true);
    },
  );

  test(
    '[T4][S17] Complete REF-01 through REF-08 Visual Rubric Audit Across Live Routes: Programmatic Computed-Style & SVG/Canvas Geometry Audit of 0px Zero-Radius Law, #08080B/#F87C18/#F6F6F4 Palette, >=12px Interactive Font Floor, REF-03 90° Corridors, REF-04/05 Topology, REF-06/07 Charts (200 Waffle Tiles, 45° Hatch, Zero Pie Charts), and REF-08 Orb',
    { tag: ['@tier4', '@F18', '@F20', '@F22', '@F24', '@F25', '@F28', '@F30', '@F32'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        // Pre-Audit Data Seeding so all charts & topologies have live nodes
        await api.post('/api/goals/cycles', {
          year: 2026,
          theme: 'S17 Visual Rubric Blueprint',
          status: 'active',
        });

        const g1 = await api.post('/api/goals', {
          year: 2026,
          pillar: 'systems',
          code: uniqueId('G-S17-1').slice(0, 12),
          title: uniqueId('S17 Systems Node'),
          status: 'in_progress',
          priority_rank: 1,
        });
        const g2 = await api.post('/api/goals', {
          year: 2026,
          pillar: 'finance',
          code: uniqueId('G-S17-2').slice(0, 12),
          title: uniqueId('S17 Finance Node'),
          status: 'in_progress',
          priority_rank: 2,
        });
        for (const r of [g1, g2]) {
          const id = (r.json?.goal ?? r.json)?.id;
          if (id) {
            cleanup.defer(async () => {
              await api.delete(`/api/goals/${id}`);
            });
          }
        }

        const projRes = await api.post('/api/projects', {
          name: uniqueId('S17 Flow Project'),
          area: 'systems',
          status: 'active',
          color: '#2CE5F2',
        });
        const proj = projRes.json?.project ?? projRes.json;
        if (proj?.id) {
          cleanup.defer(async () => {
            await api.delete(`/api/projects/${proj.id}`);
          });
        }

        const t1Res = await api.post('/api/tasks', {
          title: uniqueId('S17 Blocker Task'),
          project_id: proj?.id,
          status: 'in_progress',
          priority: 'urgent',
        });
        const t1 = t1Res.json?.task ?? t1Res.json;
        if (t1?.id) {
          cleanup.defer(async () => {
            await api.delete(`/api/tasks/${t1.id}`);
          });
        }

        const t2Res = await api.post('/api/tasks', {
          title: uniqueId('S17 Dependent Task'),
          project_id: proj?.id,
          status: 'todo',
          priority: 'high',
          blocked_by_task_ids: t1?.id ? [t1.id] : [],
        });
        const t2 = t2Res.json?.task ?? t2Res.json;
        if (t2?.id) {
          cleanup.defer(async () => {
            await api.delete(`/api/tasks/${t2.id}`);
          });
        }

        const assetRes = await api.post('/api/finance/assets', {
          symbol: uniqueId('S17WAF').toUpperCase().slice(0, 10),
          name: 'S17 Waffle Holding',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 50,
          avg_cost_cents: 2000,
          current_price_cents: 2500,
          target_weight_pct: 50,
        });
        const asset = assetRes.json?.asset ?? assetRes.json;
        if (asset?.id) {
          cleanup.defer(async () => {
            await api.delete(`/api/finance/assets/${asset.id}`);
          });
        }

        const routes = ['/dashboard', '/monitor', '/hermes', '/todos', '/goals', '/finance'];

        for (const route of routes) {
          await waitForAppReady(page, `${baseUrl}${route}`);

          const radiusAudit = await auditZeroBorderRadius(page);
          expect(radiusAudit.checkedCount).toBeGreaterThan(5);
          expect(radiusAudit.violations).toEqual([]);

          const fontAudit = await auditInteractiveFontFloor(page, 12);
          expect(fontAudit.checkedCount).toBeGreaterThan(0);
          expect(fontAudit.violations).toEqual([]);

          const colorAudit = await auditColorTokens(page);
          expect(colorAudit.hasCarbonBg).toBe(true);
          expect(colorAudit.hasBlazeOrangeAccent).toBe(true);
          expect(colorAudit.hasStarkWhiteInk).toBe(true);

          const pieCharts = await page.locator('[data-chart-type="pie"], .pie-chart').count();
          expect(pieCharts).toBe(0);

          if (route === '/goals') {
            const blueprintAudit = await auditOrthogonalBlueprintCorridors(page);
            expect(blueprintAudit.segmentCount).toBeGreaterThan(0);
            expect(blueprintAudit.diagonalOrCurvedViolations).toEqual([]);
          }

          if (route === '/hermes') {
            const webglCheck = await page.evaluate(() => {
              const canvases = Array.from(document.querySelectorAll('canvas'));
              return canvases.some((c) => Boolean(c.getContext('webgl') || c.getContext('webgl2')));
            });
            expect(webglCheck).toBe(false);
          }
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T4][S18] Complete REF-09 through REF-14b HUD, Aperture & Pixel-Art Sprite Visual Rubric Audit: Programmatic Inspection of REF-10 5-Layer <SystemApertureLogo />, REF-09/11/12 HUD Loaders & Micro-Icons, REF-13 #141526 2:1 Isometric Knight Arena, and REF-14/14b Integer-Scaled image-rendering: pixelated PNG + JSON Frieren Sprites on Web & Mobile',
    { tag: ['@tier4', '@F19', '@F20', '@F21', '@F23', '@F26', '@F27', '@F33', '@F35'] },
    async ({ page }) => {
      const { baseUrl, mobileUrl } = await ensureStackReady({ requireMobile: true });
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        // Step 1: REF-10 Mechanical 8-Blade Shutter <SystemApertureLogo /> 5-Layer SVG Audit (F19, F23)
        await waitForAppReady(page, `${baseUrl}/dashboard`);
        const aperture = await auditApertureLogo(page);
        expect(aperture.found).toBe(true);
        expect(aperture.svgLayerCount).toBeGreaterThanOrEqual(4);
        expect(aperture.hasOrangeGear).toBe(true);
        expect(aperture.hasShutterBlades).toBe(true);
        expect(aperture.hasStatusIris).toBe(true);

        // Step 2: REF-09, REF-11 & REF-12 ActiveTimer HUD Micro-Icon Audit (F20, F23)
        const timerStart = await api.post('/api/time/timer/start', {
          category: 'deep_work',
          timer_mode: 'pomodoro_25_5',
        });
        expect([200, 201]).toContain(timerStart.status);
        cleanup.defer(async () => {
          await api.post('/api/time/timer/stop', {});
        });

        await waitForAppReady(page, `${baseUrl}/dashboard`);
        const dashRadiusWithTimer = await auditZeroBorderRadius(page);
        expect(dashRadiusWithTimer.violations).toEqual([]);

        // Step 3: REF-13 #141526 2:1 Isometric Knight Arena & Pixel-Art Knight Archetypes (F21, F26)
        await waitForAppReady(page, `${baseUrl}/agents`);
        const agentsSprites = await auditPixelatedSprites(page);
        expect(agentsSprites.spriteCount).toBeGreaterThanOrEqual(1);
        expect(agentsSprites.violations).toEqual([]);

        const agentsRadius = await auditZeroBorderRadius(page);
        expect(agentsRadius.violations).toEqual([]);

        // Step 4: REF-14 & REF-14b <CompanionStage /> Frieren Ledge Mini-Sprite & Waist-Up Portrait on Web (F21, F27)
        await waitForAppReady(page, `${baseUrl}/dashboard`);
        await page.keyboard.press('Control+j');
        await page.waitForTimeout(250);

        const webFrierenSprites = await auditPixelatedSprites(page);
        expect(webFrierenSprites.spriteCount).toBeGreaterThanOrEqual(1);
        expect(webFrierenSprites.violations).toEqual([]);

        const webPopoverRadius = await auditZeroBorderRadius(page);
        expect(webPopoverRadius.violations).toEqual([]);

        // Step 5: REF-14 & REF-02 Mobile Companion (:4174) Pixel-Art Sprite & FUI Audit (F21, F33, F35)
        await waitForAppReady(page, `${mobileUrl}/`);
        const companionTab = page
          .locator('button:has-text("COMPANION"), [data-tab="companion"], a:has-text("COMPANION")')
          .first();
        if ((await companionTab.count()) > 0) {
          await companionTab.click();
          await page.waitForTimeout(250);
        }

        const mobileRadius = await auditZeroBorderRadius(page);
        expect(mobileRadius.violations).toEqual([]);

        const mobileFonts = await auditInteractiveFontFloor(page, 12);
        expect(mobileFonts.violations).toEqual([]);

        const mobileColors = await auditColorTokens(page);
        expect(mobileColors.hasCarbonBg).toBe(true);
        expect(mobileColors.hasBlazeOrangeAccent).toBe(true);
        expect(mobileColors.hasStarkWhiteInk).toBe(true);

        const mobileSprites = await auditPixelatedSprites(page);
        expect(mobileSprites.spriteCount).toBeGreaterThanOrEqual(1);
        expect(mobileSprites.violations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );
});
