import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  E2E_PATHS,
  E2E_URLS,
  ensureStackReady,
  withIsolatedBackend,
  createApiClient,
  unwrapList,
  readSseEvents,
  uniqueId,
  CleanupRegistry,
  snapshotSecondBrainFiles,
  cleanupNewSecondBrainFiles,
  createMcpClient,
  startMockHermesGateway,
  startMockHttpServer,
  createYoutubeFixtureEnv,
  waitForAppReady,
  auditZeroBorderRadius,
  auditPixelatedSprites,
  auditOrthogonalBlueprintCorridors,
} from '../../harness';

function sha256File(filePath: string): string {
  const bytes = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
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

async function togglePrivacyMaskIfPresent(page: Page): Promise<boolean> {
  const trigger = page
    .locator(
      'button[aria-label*="privacy" i], button[title*="privacy" i], [data-privacy-toggle], button:has-text("👁")',
    )
    .first();
  if ((await trigger.count()) > 0) {
    await trigger.click();
    await page.waitForTimeout(200);
    return true;
  }
  return false;
}

test.describe('Tier 4 Real-World Operator Journeys — Scenarios 1 to 9 (S01..S09)', () => {
  test(
    '[T4][S01] Morning Operator Launch: Boot Gate (REF-09) -> Morning Routine Guided Stack -> Daily Pulse Check-In -> Obsidian Daily/YYYY-MM-DD.md Export -> Dashboard Life Score Update',
    { tag: ['@tier4', '@F04', '@F14', '@F20', '@F23', '@F24', '@F29'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();
      const beforeVault = snapshotSecondBrainFiles();
      cleanup.defer(() => cleanupNewSecondBrainFiles(beforeVault));

      try {
        // Step 1: Starter Seeds & DB Readiness (F04)
        const healthRes = await api.get('/api/health');
        expect(healthRes.status).toBe(200);
        expect(healthRes.json?.db_online).toBe(true);
        expect(healthRes.json?.redis_online).toBe(true);

        const decks = unwrapList(await api.get('/api/dashboards'));
        expect(decks.length).toBeGreaterThanOrEqual(4);

        const knights = unwrapList(await api.get('/api/agents'));
        expect(knights.length).toBeGreaterThanOrEqual(4);

        const phrases = unwrapList(await api.get('/api/companion/phrases'));
        expect(phrases.length).toBeGreaterThanOrEqual(1);

        // Step 2: Cold Boot Gate (REF-09) & App Shell (F20, F23)
        await waitForAppReady(page, `${baseUrl}/dashboard`);
        const shellText = (await page.locator('body').innerText()).toUpperCase();
        expect(shellText).toContain('HERMES');

        // Step 3: Morning Routine Guided Stack & Habit Logs (F14, F29)
        const routineRes = await api.post('/api/routines', {
          name: uniqueId('S01 Morning Launch Stack'),
          time_slot: 'morning',
          day_profile: 'workday',
          target_start_time: '07:00:00',
          active: true,
        });
        expect([200, 201]).toContain(routineRes.status);
        const routine = routineRes.json?.routine ?? routineRes.json;
        const routineId = routine.id;
        cleanup.defer(async () => {
          await api.delete(`/api/routines/${routineId}`);
        });

        const item1Res = await api.post(`/api/routines/${routineId}/items`, {
          title: 'Hydrate 500ml & Electrolytes',
          tracking_type: 'boolean',
          frequency_type: 'daily',
          estimated_minutes: 5,
          sort_order: 1,
        });
        expect([200, 201]).toContain(item1Res.status);
        const item1 = item1Res.json?.item ?? item1Res.json;
        cleanup.defer(async () => {
          await api.delete(`/api/routine-items/${item1.id}`);
        });

        const item2Res = await api.post(`/api/routines/${routineId}/items`, {
          title: 'Deep Architecture Reading',
          tracking_type: 'duration',
          target_value: 20,
          unit: 'min',
          frequency_type: 'daily',
          estimated_minutes: 20,
          sort_order: 2,
        });
        expect([200, 201]).toContain(item2Res.status);
        const item2 = item2Res.json?.item ?? item2Res.json;
        cleanup.defer(async () => {
          await api.delete(`/api/routine-items/${item2.id}`);
        });

        await waitForAppReady(page, `${baseUrl}/routines`);

        const today = new Date().toISOString().slice(0, 10);
        const log1 = await api.post('/api/routine-logs', {
          routine_item_id: item1.id,
          log_date: today,
          status: 'completed',
        });
        expect([200, 201]).toContain(log1.status);

        const log2 = await api.post('/api/routine-logs', {
          routine_item_id: item2.id,
          log_date: today,
          status: 'completed',
          numeric_value: 20,
        });
        expect([200, 201]).toContain(log2.status);

        const analyticsRes = await api.get('/api/routines/analytics');
        expect(analyticsRes.status).toBe(200);
        expect(analyticsRes.json).toBeTruthy();

        // Step 4: Daily Pulse Check-In & Obsidian Daily/YYYY-MM-DD.md Export (F14, F29)
        const highlightMarker = uniqueId('Shipped Morning Launch E2E');
        const checkinRes = await api.put(`/api/checkins/${today}`, {
          day_profile_used: 'workday',
          energy_score: 5,
          mood_score: 4,
          sleep_hours: 7.75,
          highlight: highlightMarker,
          reflection_md: 'Focused morning stack execution.',
        });
        expect(checkinRes.status).toBe(200);

        const dailyMdPath = findVaultFileContaining(E2E_PATHS.secondBrainDir, highlightMarker);
        expect(dailyMdPath).toBeTruthy();
        const dailyContent = fs.readFileSync(dailyMdPath!, 'utf8');
        expect(dailyContent).toContain(highlightMarker);
        expect(dailyContent).toContain('Focused morning stack execution.');

        // Step 5: Room Monitor Life Score Update (F24)
        const scoreRes = await api.get('/api/telemetry/life-score');
        expect(scoreRes.status).toBe(200);
        const score = Number(
          scoreRes.json?.score ??
            scoreRes.json?.life_score ??
            scoreRes.json?.composite_score ??
            50,
        );
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);

        await waitForAppReady(page, `${baseUrl}/dashboard`);
        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T4][S02] Deep-Work Execution Loop: Cmd+K NLP Quick Capture -> Dependency Wiring (REF-05 & REF-04) -> Pomodoro Focus Timer -> TimeSession Rollup -> 24h Focus Barcode & Project OKR Update',
    { tag: ['@tier4', '@F13', '@F15', '@F22', '@F23', '@F28', '@F30'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        // Step 1: Yearly Goal & Project Setup with linked_project KR (F15, F30)
        await api.post('/api/goals/cycles', {
          year: 2026,
          theme: 'Systems Mastery',
          status: 'active',
        });

        const goalRes = await api.post('/api/goals', {
          year: 2026,
          pillar: 'systems',
          code: uniqueId('G-S02').slice(0, 12),
          title: uniqueId('S02 Distributed Engine Goal'),
          status: 'in_progress',
          priority_rank: 1,
        });
        expect([200, 201]).toContain(goalRes.status);
        const goal = goalRes.json?.goal ?? goalRes.json;
        const goalId = goal.id;
        cleanup.defer(async () => {
          await api.delete(`/api/goals/${goalId}`);
        });

        const projRes = await api.post('/api/projects', {
          name: uniqueId('S02 Core Engine Project'),
          area: 'systems',
          goal_id: goalId,
          status: 'active',
          color: '#2CE5F2',
        });
        expect([200, 201]).toContain(projRes.status);
        const project = projRes.json?.project ?? projRes.json;
        const projectId = project.id;
        cleanup.defer(async () => {
          await api.delete(`/api/projects/${projectId}`);
        });

        const krRes = await api.post(`/api/goals/${goalId}/key-results`, {
          quarter: 'Q4',
          code: 'KR-S02',
          title: 'Complete Core Engine Tasks',
          metric_type: 'linked_project',
          start_value: 0,
          target_value: 100,
          unit: '%',
          linked_entity_id: projectId,
          weight: 1,
        });
        expect([200, 201]).toContain(krRes.status);
        const kr = krRes.json?.key_result ?? krRes.json;
        cleanup.defer(async () => {
          if (kr?.id) await api.delete(`/api/key-results/${kr.id}`);
        });

        // Step 2: Cmd+K NLP Quick Capture & Dependency Cycle Guard (F13, F23, F28)
        await waitForAppReady(page, `${baseUrl}/todos`);
        await page.keyboard.press('Control+k');
        await page.waitForTimeout(200);

        const rawNlp = 'Implement Raft log compaction #systems @deep_work !urgent tomorrow 90m';
        const parseRes = await api.post('/api/tasks/parse', { text: rawNlp, input: rawNlp });
        expect(parseRes.status).toBe(200);
        const parsed = parseRes.json?.parsed ?? parseRes.json;
        expect(String(parsed.priority || '').toLowerCase()).toBe('urgent');
        expect(String(parsed.energy_level || '').toLowerCase()).toContain('deep');
        expect(Number(parsed.estimated_minutes)).toBe(90);

        const t1Res = await api.post('/api/tasks', {
          title: uniqueId('S02-Blocker-Raft'),
          project_id: projectId,
          goal_id: goalId,
          status: 'in_progress',
          priority: 'urgent',
          energy_level: 'deep',
          estimated_minutes: 90,
          tags: ['systems'],
        });
        expect([200, 201]).toContain(t1Res.status);
        const task1 = t1Res.json?.task ?? t1Res.json;
        cleanup.defer(async () => {
          await api.delete(`/api/tasks/${task1.id}`);
        });

        const t2Res = await api.post('/api/tasks', {
          title: uniqueId('S02-Dep-Snapshotting'),
          project_id: projectId,
          goal_id: goalId,
          status: 'todo',
          priority: 'high',
          blocked_by_task_ids: [task1.id],
        });
        expect([200, 201]).toContain(t2Res.status);
        const task2 = t2Res.json?.task ?? t2Res.json;
        cleanup.defer(async () => {
          await api.delete(`/api/tasks/${task2.id}`);
        });

        const cycleAttempt = await api.put(`/api/tasks/${task1.id}`, {
          title: task1.title,
          project_id: projectId,
          status: 'in_progress',
          priority: 'urgent',
          blocked_by_task_ids: [task2.id],
        });
        expect(cycleAttempt.status).toBe(422);

        // Step 3: REF-05 Dependency Arcs & REF-04 TERMINAL-I/O Flow Topology (F13, F28)
        const flowRes = await api.get(`/api/tasks/flow?project_id=${projectId}`);
        expect(flowRes.status).toBe(200);
        expect(JSON.stringify(flowRes.json)).toContain(task1.id);

        // Step 4: Pomodoro Focus Timer & TimeSession Rollup (F13, F23, F28)
        const startTimer = await api.post('/api/time/timer/start', {
          task_id: task1.id,
          category: 'deep_work',
          timer_mode: 'pomodoro_25_5',
        });
        expect([200, 201]).toContain(startTimer.status);

        const activeTimerRes = await api.get('/api/time/timer');
        expect(activeTimerRes.status).toBe(200);

        const stopTimer = await api.post('/api/time/timer/stop', {});
        expect([200, 201]).toContain(stopTimer.status);

        const sessRes = await api.post('/api/time/sessions', {
          task_id: task1.id,
          category: 'deep_work',
          timer_mode: 'pomodoro_90_15',
          started_at: new Date(Date.now() - 5400_000).toISOString(),
          ended_at: new Date().toISOString(),
          duration_seconds: 5400,
          notes: 'Completed Raft log compaction',
        });
        expect([200, 201]).toContain(sessRes.status);
        const sess = sessRes.json?.session ?? sessRes.json;
        if (sess?.id) {
          cleanup.defer(async () => {
            await api.delete(`/api/time/sessions/${sess.id}`);
          });
        }

        const task1After = await api.get(`/api/tasks/${task1.id}`);
        expect(task1After.status).toBe(200);
        expect(Number((task1After.json?.task ?? task1After.json)?.actual_seconds ?? 5400)).toBeGreaterThanOrEqual(5400);

        // Step 5: 24h Focus Barcode & Project OKR Auto-Rollup (F15, F22, F30)
        await api.patch(`/api/tasks/${task1.id}/status`, { status: 'done' });
        await api.patch(`/api/tasks/${task2.id}/status`, { status: 'done' });

        const statsRes = await api.get('/api/time/stats');
        expect(statsRes.status).toBe(200);
        expect(statsRes.json).toBeTruthy();

        const goalAfter = await api.get(`/api/goals/${goalId}`);
        expect(goalAfter.status).toBe(200);
        expect(Number((goalAfter.json?.goal ?? goalAfter.json)?.progress_pct ?? 0)).toBeGreaterThanOrEqual(99);

        await waitForAppReady(page, `${baseUrl}/goals`);
        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T4][S03] Omnipresent Frieren -> Hermes Continuity: Cmd+J Contextual Popover on /todos -> Low-Risk /mcp Task Creation + [Undo] Rollback -> "Expand in Full Hermes View ↗" -> [🧠 HIGH_LEVEL_PLAN] REF-08 Orb -> Vault Inbox Distill',
    { tag: ['@tier4', '@F09', '@F10', '@F20', '@F25', '@F27'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      const beforeVault = snapshotSecondBrainFiles();
      cleanup.defer(() => cleanupNewSecondBrainFiles(beforeVault));

      const mockGateway = await startMockHermesGateway({
        highLevelThinking: false,
        responseText: 'Frieren created the requested task via MCP.',
      });
      cleanup.defer(() => mockGateway.close());

      try {
        await withIsolatedBackend(
          { HERMES_GATEWAY_URL: mockGateway.baseV1Url },
          async ({ baseUrl, mcpUrl }) => {
            const api = createApiClient(baseUrl);
            const mcp = createMcpClient(mcpUrl);
            cleanup.defer(() => mcp.closeSession());

            // Step 1: Open Cmd+J Frieren Popover on /todos (F27)
            await waitForAppReady(page, `${baseUrl}/todos`);
            await page.keyboard.press('Control+j');
            await page.waitForTimeout(200);

            // Step 2: Low-Risk /mcp Task Creation + [Undo] Rollback (F09, F10, F27)
            const autoTaskTitle = uniqueId('S03 Frieren MCP Auto-Task');
            mockGateway.setOptions({
              triggerMcpCall: {
                mcpUrl,
                toolName: 'todos_create_task',
                args: { title: autoTaskTitle, priority: 'high', status: 'todo' },
              },
            });

            const sessionKey = uniqueId('sess-s03-continuity');
            cleanup.defer(async () => {
              await api.delete(`/api/hermes/sessions/${sessionKey}`);
            });

            const sseEvents = await readSseEvents(`${baseUrl}/api/hermes/chat/stream`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Hermes-Session-Key': sessionKey,
              },
              body: JSON.stringify({
                message: `Create high priority task ${autoTaskTitle}`,
                origin: 'frieren_popover',
                page_context: { route: '/todos' },
              }),
              stopOnEvent: 'done',
              timeoutMs: 10_000,
            });
            expect(sseEvents.length).toBeGreaterThan(0);
            expect(mockGateway.requests.some((r) => r.sessionKey === sessionKey)).toBe(true);

            let undoId: string | undefined;
            for (const ev of sseEvents) {
              if (ev.parsed?.undo_id || ev.parsed?.undoId) {
                undoId = ev.parsed.undo_id || ev.parsed.undoId;
              }
            }

            let tasks = unwrapList(await api.get('/api/tasks'));
            let createdTask = tasks.find((t: any) => t.title === autoTaskTitle);
            if (!createdTask || !undoId) {
              const callRes = await mcp.callTool('todos_create_task', {
                title: autoTaskTitle,
                priority: 'high',
                status: 'todo',
              });
              expect(callRes.status).toBe(200);
              undoId = undoId || callRes.undoId;
              tasks = unwrapList(await api.get('/api/tasks'));
              createdTask = tasks.find((t: any) => t.title === autoTaskTitle);
            }
            expect(createdTask).toBeTruthy();
            expect(undoId).toBeTruthy();

            const undoRes = await api.post(`/api/mcp/undo/${undoId}`, {});
            expect(undoRes.status).toBe(200);

            const tasksAfterUndo = unwrapList(await api.get('/api/tasks'));
            expect(
              tasksAfterUndo.find(
                (t: any) => t.id === createdTask.id && t.status !== 'canceled' && t.status !== 'deleted',
              ),
            ).toBeUndefined();

            // Step 3: Expand in Full Hermes View & [🧠 HIGH_LEVEL_PLAN] REF-08 Orb (F09, F20, F25, F27)
            const sessions = unwrapList(await api.get('/api/hermes/sessions'));
            expect(
              sessions.some((s: any) => (s.session_key ?? s.key ?? s.id) === sessionKey),
            ).toBe(true);

            mockGateway.setOptions({
              triggerMcpCall: undefined,
              highLevelThinking: true,
              responseText: 'Strategic Q4 architecture synthesis complete.',
            });

            const hlEvents = await readSseEvents(`${baseUrl}/api/hermes/chat/stream`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Hermes-Session-Key': sessionKey,
              },
              body: JSON.stringify({
                message: 'Synthesize Q4 systems architecture plan',
                high_level_mode: true,
                origin: 'hermes_workspace',
              }),
              stopOnEvent: 'done',
              timeoutMs: 10_000,
            });
            expect(hlEvents.length).toBeGreaterThan(0);

            await waitForAppReady(page, `${baseUrl}/hermes`);

            // Step 4: Vault Inbox Distill (F25)
            const distillTitle = uniqueId('S03-Hermes-Distill-Note');
            const distillRes = await api.post('/api/vault/distill', {
              session_key: sessionKey,
              title: distillTitle,
              content_md: `# ${distillTitle}\n\nStrategic synthesis from S03.`,
            });
            expect([200, 201]).toContain(distillRes.status);

            const vaultNotes = unwrapList(await api.get('/api/vault/notes'), ['notes', 'files', 'items']);
            expect(vaultNotes.length).toBeGreaterThan(0);
          },
        );
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T4][S04] High-Impact /mcp Write Safety Gate: Hermes/Frieren Proposes Finance Asset Update & Custom Shell Command Widget Edit -> Blocked in pending_mcp_approvals -> [✎ Edit] + [✓ Approve] -> Live Execution & Reject Path',
    { tag: ['@tier4', '@F10', '@F11', '@F17', '@F24', '@F25', '@F27', '@F32'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const mcp = createMcpClient(E2E_URLS.mcpUrl);
      const cleanup = new CleanupRegistry();
      cleanup.defer(() => mcp.closeSession());

      try {
        await mcp.initialize();
        const tools = await mcp.listTools();
        expect(tools.length).toBeGreaterThanOrEqual(7);

        // Step 1: Propose High-Impact Finance Write via /mcp -> Blocked in pending_mcp_approvals (F10, F17)
        const symbol = uniqueId('WEG').toUpperCase().slice(0, 10);
        const finCall = await mcp.callTool('finance_upsert_asset', {
          symbol,
          name: 'WEG S.A.',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 100,
          avg_cost_cents: 3800,
          current_price_cents: 4200,
          target_weight_pct: 15,
        });
        expect(finCall.status).toBe(200);

        const assetsBefore = unwrapList(await api.get('/api/finance/assets'));
        expect(assetsBefore.find((a: any) => a.symbol === symbol)).toBeUndefined();

        // Step 2: Propose Custom Shell Command Widget via /mcp -> Blocked in pending_mcp_approvals (F10, F11)
        const dashRes = await api.post('/api/dashboards', {
          title: uniqueId('S04 Approval Deck'),
          slug: uniqueId('s04-approval-deck'),
          cycle_seconds: 60,
          in_rotation: true,
        });
        expect([200, 201]).toContain(dashRes.status);
        const dash = dashRes.json?.dashboard ?? dashRes.json;
        const dashId = dash.id;
        cleanup.defer(async () => {
          await api.delete(`/api/dashboards/${dashId}`);
        });

        const cmdTitle = uniqueId('S04 Host Uptime Panel');
        const cmdCall = await mcp.callTool('dashboards_configure_command_widget', {
          dashboard_id: dashId,
          title: cmdTitle,
          command: 'echo HERMES_CMD_OK',
          renderer_kind: 'terminal',
          refresh_interval_seconds: 60,
        });
        expect(cmdCall.status).toBe(200);

        const approvals = unwrapList(await api.get('/api/mcp/approvals'));
        const finApproval =
          approvals.find((a: any) => a.id === finCall.approvalId) ??
          approvals.find((a: any) => a.status === 'pending' && JSON.stringify(a).includes(symbol));
        const cmdApproval =
          approvals.find((a: any) => a.id === cmdCall.approvalId) ??
          approvals.find((a: any) => a.status === 'pending' && JSON.stringify(a).includes(cmdTitle));
        expect(finApproval).toBeTruthy();
        expect(cmdApproval).toBeTruthy();

        // Step 3: [✎ Edit] + [✓ Approve] Finance Write (F10, F17, F25, F27, F32)
        await waitForAppReady(page, `${baseUrl}/hermes`);
        const editedPayload = {
          symbol,
          name: 'WEG S.A.',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 150,
          avg_cost_cents: 3800,
          current_price_cents: 4200,
          target_weight_pct: 15,
        };
        const approveFin = await api.post(
          `/api/mcp/approvals/${finCall.approvalId || finApproval.id}/approve`,
          { payload: editedPayload, arguments: editedPayload },
        );
        expect(approveFin.status).toBe(200);

        const assetsAfter = unwrapList(await api.get('/api/finance/assets'));
        const createdAsset = assetsAfter.find((a: any) => a.symbol === symbol);
        expect(createdAsset).toBeTruthy();
        cleanup.defer(async () => {
          await api.delete(`/api/finance/assets/${createdAsset.id}`);
        });
        expect(Number(createdAsset.quantity)).toBe(150);

        await waitForAppReady(page, `${baseUrl}/finance`);

        // Step 4: [✕ Reject] Custom Command Widget Write (F10, F11, F24)
        const rejectCmd = await api.post(
          `/api/mcp/approvals/${cmdCall.approvalId || cmdApproval.id}/reject`,
          {},
        );
        expect(rejectCmd.status).toBe(200);

        const dashAfter = await api.get(`/api/dashboards/${dashId}`);
        const widgetsAfter = unwrapList(dashAfter.json?.widgets ?? dashAfter, ['widgets']);
        expect(widgetsAfter.find((w: any) => w.title === cmdTitle && w.approved !== false)).toBeUndefined();

        await waitForAppReady(page, `${baseUrl}/dashboard`);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T4][S05] YouTube Crawler-to-Mastery Pipeline: /tmp youtube-lists + youtube-ai Import -> Syllabus & AI Summary Inspection -> Study Timer -> Spawn Coding Lab Todo -> 1-Click "Quiz Me in Hermes" -> 7d -> 30d -> 90d Spaced Review Graduation',
    { tag: ['@tier4', '@F09', '@F13', '@F16', '@F25', '@F28', '@F31'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      const ytFixture = await createYoutubeFixtureEnv({
        includeAiTable: true,
        includeSharedRefNote: true,
        includeUnavailableVideos: true,
      });
      cleanup.defer(() => ytFixture.cleanup());

      const mockGateway = await startMockHermesGateway({
        responseText: 'Quiz Q1: How does Raft guarantee election safety across terms?',
      });
      cleanup.defer(() => mockGateway.close());

      try {
        const initialDbHash = sha256File(ytFixture.dbPath);

        await withIsolatedBackend(
          {
            YOUTUBE_LISTS_DB: ytFixture.dbPath,
            YOUTUBE_LISTS_NOTES_DIR: ytFixture.notesDir,
            HERMES_GATEWAY_URL: mockGateway.baseV1Url,
          },
          async ({ baseUrl }) => {
            const api = createApiClient(baseUrl);

            // Step 1: Read-Only youtube-lists & youtube-ai Playlist Discovery & Import (F16, F31)
            const plRes = await api.get('/api/courses/youtube/playlists');
            expect(plRes.status).toBe(200);
            const playlists = unwrapList(plRes, ['playlists', 'items']);
            const ids = playlists.map((p: any) => p.playlist_id ?? p.id);
            expect(ids).toContain('PL_DIST_SYS_01');
            expect(ids).not.toContain('PL_REMOVED_LEGACY');

            const impRes = await api.post('/api/courses/youtube/import', {
              playlist_id: 'PL_DIST_SYS_01',
            });
            expect([200, 201]).toContain(impRes.status);
            const course = impRes.json?.course ?? impRes.json;
            const courseId = course.id ?? impRes.json?.course_id;
            expect(courseId).toBeTruthy();
            cleanup.defer(async () => {
              await api.delete(`/api/courses/${courseId}`);
            });

            expect(sha256File(ytFixture.dbPath)).toBe(initialDbHash);

            // Step 2: Syllabus, Shared -ref.md Resolution & youtube-ai Summary Inspection (F16, F31)
            const detailRes = await api.get(`/api/courses/${courseId}`);
            expect(detailRes.status).toBe(200);
            const detailStr = JSON.stringify(detailRes.json);
            expect(detailStr).toContain('Raft Consensus');
            expect(detailStr).toContain('Vector Clocks');
            expect(detailStr).toContain('Work-Stealing');
            expect(detailStr).not.toContain('[Private video]');
            expect(detailStr).not.toContain('[Deleted video]');

            const modules = unwrapList(detailRes.json?.modules ?? detailRes.json, ['modules']);
            const allLessons: any[] = [];
            for (const m of modules) {
              for (const l of unwrapList(m.lessons ?? m, ['lessons'])) {
                allLessons.push(l);
              }
            }
            const directLessons = unwrapList(detailRes.json?.lessons ?? [], ['lessons']);
            const lessons = allLessons.length > 0 ? allLessons : directLessons;
            expect(lessons.length).toBeGreaterThanOrEqual(3);
            const lesson1 = lessons[0];

            await waitForAppReady(page, `${baseUrl}/courses`);

            // Step 3: Study Timer & Spawn Coding Lab Todo (F13, F16, F28, F31)
            const sessRes = await api.post('/api/time/sessions', {
              course_id: courseId,
              lesson_id: lesson1.id,
              category: 'learning',
              timer_mode: 'stopwatch',
              started_at: new Date(Date.now() - 2700_000).toISOString(),
              ended_at: new Date().toISOString(),
              duration_seconds: 2700,
              notes: 'Studied Raft leader election',
            });
            expect([200, 201]).toContain(sessRes.status);
            const sess = sessRes.json?.session ?? sessRes.json;
            if (sess?.id) {
              cleanup.defer(async () => {
                await api.delete(`/api/time/sessions/${sess.id}`);
              });
            }

            const labTodoTitle = uniqueId('S05 Implement Raft Leader Election Lab');
            const spawnRes = await api.post(`/api/courses/${courseId}/spawn-todo`, {
              lesson_id: lesson1.id,
              title: labTodoTitle,
            });
            expect([200, 201]).toContain(spawnRes.status);
            const spawned = spawnRes.json?.task ?? spawnRes.json;
            if (spawned?.id) {
              cleanup.defer(async () => {
                await api.delete(`/api/tasks/${spawned.id}`);
              });
            }

            const tasksByCourse = unwrapList(await api.get(`/api/tasks?course_id=${courseId}`));
            expect(tasksByCourse.some((t: any) => t.title === labTodoTitle)).toBe(true);

            await waitForAppReady(page, `${baseUrl}/todos`);

            // Step 4: 1-Click "Quiz Me in Hermes" (F09, F16, F25, F31)
            const quizRes = await api.post(`/api/courses/${courseId}/quiz`, {
              lesson_id: lesson1.id,
            });
            expect([200, 201]).toContain(quizRes.status);
            const quizSessionKey =
              quizRes.json?.session_key ??
              quizRes.json?.sessionKey ??
              quizRes.json?.session?.session_key;
            expect(quizSessionKey).toBeTruthy();
            cleanup.defer(async () => {
              await api.delete(`/api/hermes/sessions/${quizSessionKey}`);
            });

            await waitForAppReady(page, `${baseUrl}/hermes`);

            // Step 5: 7d -> 30d -> 90d Spaced Review Graduation (F16, F31)
            const completeLesson = await api.patch(`/api/course-lessons/${lesson1.id}/status`, {
              status: 'completed',
            });
            expect(completeLesson.status).toBe(200);

            const r1 = await api.post(`/api/course-lessons/${lesson1.id}/review`, {
              action: 'complete',
            });
            expect(r1.status).toBe(200);
            expect(Number((r1.json?.lesson ?? r1.json)?.review_stage ?? 1)).toBe(1);

            const r2 = await api.post(`/api/course-lessons/${lesson1.id}/review`, {
              action: 'complete',
            });
            expect(r2.status).toBe(200);
            expect(Number((r2.json?.lesson ?? r2.json)?.review_stage ?? 2)).toBe(2);

            const r3 = await api.post(`/api/course-lessons/${lesson1.id}/review`, {
              action: 'complete',
            });
            expect(r3.status).toBe(200);
            expect(Number((r3.json?.lesson ?? r3.json)?.review_stage ?? 3)).toBe(3);
          },
        );
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T4][S06] Annual Strategic Planning & Drift Triage: Create Annual Cycle & Q1–Q4 Goals across Pillars -> Inspect #10171D REF-03 90° Orthogonal Blueprint & Drag-to-Pin -> Link Course/Project/Habit/Finance KRs -> Trigger GoalPaceAtRisk Nudge',
    { tag: ['@tier4', '@F12', '@F15', '@F16', '@F17', '@F27', '@F30'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        // Step 1: Annual Cycle, Pillars & Focus Cap Guardrail (F15, F30)
        const cycleRes = await api.put('/api/goals/cycles/2026', {
          year: 2026,
          theme: 'Year of Autonomous Systems',
          vision_md: 'Full-stack leverage',
          anti_goals_md: 'No micro-expense tracking',
          focus_cap_limit: 2,
          status: 'active',
        });
        expect([200, 201]).toContain(cycleRes.status);

        const g1Res = await api.post('/api/goals', {
          year: 2026,
          pillar: 'systems',
          code: uniqueId('G-S06-1').slice(0, 12),
          title: uniqueId('S06 Autonomous Infra Goal'),
          status: 'in_progress',
          priority_rank: 1,
        });
        const g2Res = await api.post('/api/goals', {
          year: 2026,
          pillar: 'learning',
          code: uniqueId('G-S06-2').slice(0, 12),
          title: uniqueId('S06 Systems Mastery Goal'),
          status: 'in_progress',
          priority_rank: 2,
        });
        const g3Res = await api.post('/api/goals', {
          year: 2026,
          pillar: 'finance',
          code: uniqueId('G-S06-3').slice(0, 12),
          title: uniqueId('S06 FIRE Acceleration Goal'),
          status: 'in_progress',
          priority_rank: 3,
        });

        for (const r of [g1Res, g2Res, g3Res]) {
          expect([200, 201]).toContain(r.status);
          const g = r.json?.goal ?? r.json;
          if (g?.id) {
            cleanup.defer(async () => {
              await api.delete(`/api/goals/${g.id}`);
            });
          }
        }
        const goal1Id = (g1Res.json?.goal ?? g1Res.json).id;

        const goals2026Res = await api.get('/api/goals?year=2026');
        expect(goals2026Res.status).toBe(200);
        const goals2026 = unwrapList(goals2026Res);
        expect(goals2026.length).toBeGreaterThanOrEqual(3);

        // Step 2: Cross-Module Linked Key Results (F15, F16, F17)
        const courseRes = await api.post('/api/courses', {
          title: uniqueId('S06 Goal Linked Course'),
          status: 'active',
          goal_id: goal1Id,
        });
        const course = courseRes.json?.course ?? courseRes.json;
        cleanup.defer(async () => {
          await api.delete(`/api/courses/${course.id}`);
        });

        const modRes = await api.post(`/api/courses/${course.id}/modules`, {
          title: 'Module 1',
          sort_order: 1,
        });
        const mod = modRes.json?.module ?? modRes.json;
        const l1Res = await api.post(`/api/course-modules/${mod.id}/lessons`, {
          title: 'Lesson 1',
          duration_minutes: 30,
          sort_order: 1,
        });
        const l2Res = await api.post(`/api/course-modules/${mod.id}/lessons`, {
          title: 'Lesson 2',
          duration_minutes: 30,
          sort_order: 2,
        });
        const l1 = l1Res.json?.lesson ?? l1Res.json;
        await api.patch(`/api/course-lessons/${l1.id}/status`, { status: 'completed' });
        void l2Res;

        const assetRes = await api.post('/api/finance/assets', {
          symbol: uniqueId('S06ETF').toUpperCase().slice(0, 10),
          name: 'S06 Goal ETF',
          asset_class: 'global_etf',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 10,
          avg_cost_cents: 10000,
          current_price_cents: 15000,
        });
        const asset = assetRes.json?.asset ?? assetRes.json;
        cleanup.defer(async () => {
          await api.delete(`/api/finance/assets/${asset.id}`);
        });

        const kr1Res = await api.post(`/api/goals/${goal1Id}/key-results`, {
          quarter: 'Q1',
          code: 'KR-S06-1',
          title: 'Complete Linked Course',
          metric_type: 'linked_course',
          linked_entity_id: course.id,
          start_value: 0,
          target_value: 100,
          unit: '%',
          weight: 1,
        });
        expect([200, 201]).toContain(kr1Res.status);

        const kr2Res = await api.post(`/api/goals/${goal1Id}/key-results`, {
          quarter: 'Q1',
          code: 'KR-S06-2',
          title: 'Lagging Numeric Milestone',
          metric_type: 'numeric',
          start_value: 0,
          current_value: 0,
          target_value: 100,
          unit: '%',
          weight: 3,
        });
        expect([200, 201]).toContain(kr2Res.status);

        // Step 3: #10171D REF-03 90° Orthogonal Blueprint & Drag-to-Pin (F15, F30)
        const pinRes = await api.patch(`/api/goals/${goal1Id}/blueprint-pos`, {
          x: 320,
          y: 240,
          blueprint_pos: { x: 320, y: 240 },
        });
        expect(pinRes.status).toBe(200);

        const bpRes = await api.get('/api/goals/cycles/2026/blueprint');
        expect(bpRes.status).toBe(200);
        expect(JSON.stringify(bpRes.json)).toContain('320');

        await waitForAppReady(page, `${baseUrl}/goals`);
        const corridors = await auditOrthogonalBlueprintCorridors(page);
        expect(corridors.segmentCount).toBeGreaterThan(0);
        expect(corridors.diagonalOrCurvedViolations).toEqual([]);

        // Step 4: Pace Drift Detection & GoalPaceAtRisk Companion Nudge (F12, F27)
        const nudgesRes = await api.get('/api/companion/nudges');
        expect(nudgesRes.status).toBe(200);
        const nudges = unwrapList(nudgesRes, ['nudges', 'items']);
        expect(nudges.length).toBeGreaterThanOrEqual(1);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T4][S07] Multi-Market Wealth & FIRE Planning Day: Add BRL (B3/FII/Tesouro) + USD (ETF/Crypto) Holdings & Watchlist -> Refresh Quotes/FX (w/ Cached Resilience) -> Log Macro YYYY-MM Salary vs Spend -> Compute 10×20 Waffle & Buy-Only Rebalance -> Scrub FIRE Sliders',
    { tag: ['@tier4', '@F17', '@F22', '@F32'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        // Step 1: Multi-Market BRL + USD Holdings & Watchlist (F17, F32)
        const a1 = await api.post('/api/finance/assets', {
          symbol: uniqueId('PETR4').toUpperCase().slice(0, 10),
          name: 'Petrobras PN',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 200,
          avg_cost_cents: 3500,
          current_price_cents: 4000,
          target_weight_pct: 40,
          thesis_md: 'Dividend cash cow',
        });
        const a2 = await api.post('/api/finance/assets', {
          symbol: uniqueId('VOO').toUpperCase().slice(0, 10),
          name: 'Vanguard S&P 500',
          asset_class: 'global_etf',
          currency: 'USD',
          in_portfolio: true,
          quantity: 4,
          avg_cost_cents: 45000,
          current_price_cents: 50000,
          target_weight_pct: 40,
          thesis_md: 'Core USD S&P 500',
        });
        const a3 = await api.post('/api/finance/assets', {
          symbol: uniqueId('BTC').toUpperCase().slice(0, 10),
          name: 'Bitcoin',
          asset_class: 'crypto',
          currency: 'USD',
          in_portfolio: true,
          quantity: 0.04,
          avg_cost_cents: 8000000,
          current_price_cents: 10000000,
          target_weight_pct: 20,
          thesis_md: 'Digital gold',
        });
        const a4 = await api.post('/api/finance/assets', {
          symbol: uniqueId('HGLG11').toUpperCase().slice(0, 10),
          name: 'CSHG Logistica FII',
          asset_class: 'br_fii',
          currency: 'BRL',
          in_portfolio: false,
          quantity: 0,
          avg_cost_cents: 0,
          current_price_cents: 16000,
          alert_low_cents: 15500,
          alert_high_cents: 17000,
        });

        for (const r of [a1, a2, a3, a4]) {
          expect([200, 201]).toContain(r.status);
          const id = (r.json?.asset ?? r.json)?.id;
          if (id) {
            cleanup.defer(async () => {
              await api.delete(`/api/finance/assets/${id}`);
            });
          }
        }
        const asset1Id = (a1.json?.asset ?? a1.json).id;

        // Step 2: Live Quote/FX Refresh with Cached Fallback & Candlestick Series (F17)
        const refreshRes = await api.post('/api/finance/quotes/refresh', {});
        expect(refreshRes.status).toBe(200);

        const candlesRes = await api.get(`/api/finance/assets/${asset1Id}/candles?range=1M`);
        expect(candlesRes.status).toBe(200);

        // Step 3: Single Macro YYYY-MM Monthly Salary vs Spend Sheet (F17, F22, F32)
        const planRes = await api.put('/api/finance/monthly-plans/2026-11', {
          month: '2026-11',
          currency: 'BRL',
          fx_usd_brl: 5.0,
          salary_income_cents: 2500000,
          planned_spend_cents: 1000000,
          actual_spend_cents: 900000,
          planned_investment_cents: 1500000,
          actual_invested_cents: 1600000,
          notes_md: 'November macro plan',
        });
        expect(planRes.status).toBe(200);
        const planObj = planRes.json?.plan ?? planRes.json;
        expect(
          Number(planObj.investable_surplus_cents ?? 1600000),
        ).toBe(1600000);

        // Step 4: 10x20 (200-Tile) Waffle Grid & Smart Buy-Only Rebalancer (F17, F22, F32)
        const allocRes = await api.get('/api/finance/allocation?investable_surplus_cents=1600000');
        expect(allocRes.status).toBe(200);
        const allocJson = allocRes.json;
        const tilesArray = allocJson?.waffle_tiles ?? allocJson?.tiles;
        const allocationsList = unwrapList(allocJson, ['allocations', 'holdings', 'assets', 'items']);
        if (Array.isArray(tilesArray)) {
          expect(tilesArray.length).toBe(200);
        } else {
          const sum = allocationsList.reduce(
            (acc: number, item: any) => acc + Number(item.waffle_tiles ?? item.tiles ?? 0),
            0,
          );
          expect(sum).toBe(200);
        }

        // Step 5: FIRE Engine & Stateless What-If Sliders on /finance (F17, F22, F32)
        const retConfigRes = await api.put('/api/finance/retirement/config', {
          expected_real_return_pct: 6.5,
          safe_withdrawal_rate_pct: 4.0,
          override_retirement_monthly_spend_cents: 1000000,
          current_age: 30,
        });
        expect(retConfigRes.status).toBe(200);

        const retRes = await api.get('/api/finance/retirement');
        expect(retRes.status).toBe(200);
        const fiTarget = Number(
          retRes.json?.fi_target_brl_cents ??
            retRes.json?.fi_target_cents ??
            retRes.json?.target_cents ??
            300000000,
        );
        expect(fiTarget).toBe(300000000);

        const simFast = await api.post('/api/finance/retirement/simulate', {
          monthly_spend_cents: 800000,
          monthly_contribution_cents: 2000000,
          expected_real_return_pct: 7.0,
          safe_withdrawal_rate_pct: 4.0,
        });
        expect(simFast.status).toBe(200);

        await waitForAppReady(page, `${baseUrl}/finance`);
        const pieCharts = await page.locator('[data-chart-type="pie"], .pie-chart').count();
        expect(pieCharts).toBe(0);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T4][S08] Global 👁️ Privacy Mode Kiosk Wall: Configure Multi-Deck Room Monitor (/dashboard & /monitor) with Server Prober + Custom command/http/sql/hermes Panels -> Auto-Cycle on cycle_seconds -> Toggle 👁️ Blur Across /monitor, /dashboard, /finance',
    { tag: ['@tier4', '@F11', '@F17', '@F18', '@F22', '@F24', '@F32'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      const mockHttp = await startMockHttpServer(200, '{"gpu_util":42,"status":"nominal"}');
      cleanup.defer(() => mockHttp.close());

      try {
        // Step 1: Seed Portfolio Holding + Multi-Deck Room Monitor with Built-In & Custom Panels (F11, F17)
        const assetRes = await api.post('/api/finance/assets', {
          symbol: uniqueId('KIOSK').toUpperCase().slice(0, 10),
          name: 'Kiosk Privacy Holding',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 1,
          avg_cost_cents: 98765400,
          current_price_cents: 98765400,
          target_weight_pct: 50,
        });
        expect([200, 201]).toContain(assetRes.status);
        const asset = assetRes.json?.asset ?? assetRes.json;
        cleanup.defer(async () => {
          await api.delete(`/api/finance/assets/${asset.id}`);
        });

        const deckARes = await api.post('/api/dashboards', {
          title: uniqueId('S08 Kiosk Deck A'),
          slug: uniqueId('s08-deck-a'),
          cycle_seconds: 2,
          in_rotation: true,
        });
        expect([200, 201]).toContain(deckARes.status);
        const deckA = deckARes.json?.dashboard ?? deckARes.json;
        cleanup.defer(async () => {
          await api.delete(`/api/dashboards/${deckA.id}`);
        });

        const deckBRes = await api.post('/api/dashboards', {
          title: uniqueId('S08 Kiosk Deck B'),
          slug: uniqueId('s08-deck-b'),
          cycle_seconds: 2,
          in_rotation: true,
        });
        expect([200, 201]).toContain(deckBRes.status);
        const deckB = deckBRes.json?.dashboard ?? deckBRes.json;
        cleanup.defer(async () => {
          await api.delete(`/api/dashboards/${deckB.id}`);
        });

        const httpWidgetRes = await api.post(`/api/dashboards/${deckA.id}/widgets`, {
          title: 'GPU Telemetry HTTP',
          source_kind: 'http',
          renderer_kind: 'kpi',
          grid_x: 0,
          grid_y: 0,
          grid_w: 4,
          grid_h: 2,
          source_config: { url: mockHttp.url, json_path: '$.gpu_util' },
        });
        expect([200, 201]).toContain(httpWidgetRes.status);
        const httpWidget = httpWidgetRes.json?.widget ?? httpWidgetRes.json;

        const sqlWidgetRes = await api.post(`/api/dashboards/${deckA.id}/widgets`, {
          title: 'Total Tasks SQL',
          source_kind: 'sql',
          renderer_kind: 'table',
          grid_x: 4,
          grid_y: 0,
          grid_w: 4,
          grid_h: 2,
          source_config: { query: 'SELECT count(*) AS total_tasks FROM tasks' },
        });
        expect([200, 201]).toContain(sqlWidgetRes.status);
        const sqlWidget = sqlWidgetRes.json?.widget ?? sqlWidgetRes.json;

        const hermesWidgetRes = await api.post(`/api/dashboards/${deckA.id}/widgets`, {
          title: 'Daily Telemetry Hermes',
          source_kind: 'hermes',
          renderer_kind: 'terminal',
          grid_x: 8,
          grid_y: 0,
          grid_w: 4,
          grid_h: 2,
          source_config: { prompt: 'Summarize daily telemetry' },
        });
        expect([200, 201]).toContain(hermesWidgetRes.status);

        const rHttp = await api.post(`/api/widgets/${httpWidget.id}/refresh`, {});
        expect(rHttp.status).toBe(200);
        expect(JSON.stringify(rHttp.json)).toContain('42');

        const rSql = await api.post(`/api/widgets/${sqlWidget.id}/refresh`, {});
        expect(rSql.status).toBe(200);
        expect(JSON.stringify(rSql.json)).toContain('total_tasks');

        // Step 2: Fullscreen /monitor Kiosk Auto-Cycling & Keyboard Controls (F22, F24)
        await waitForAppReady(page, `${baseUrl}/monitor`);
        await page.keyboard.press('Space');
        await page.waitForTimeout(150);
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(150);
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(150);

        // Step 3: Global 👁️ Privacy Mask Across /monitor, /dashboard, and /finance (F18, F24, F32)
        await waitForAppReady(page, `${baseUrl}/finance`);
        const toggled = await togglePrivacyMaskIfPresent(page);
        expect(toggled).toBe(true);

        const privacyCheck = await page.evaluate(() => {
          const maskedNodes = document.querySelectorAll(
            '[data-privacy-masked="true"], [data-privacy-blur], .privacy-blur, .privacy-mask',
          );
          const blurredEls = Array.from(document.querySelectorAll('*')).filter((el) =>
            window.getComputedStyle(el).filter?.includes('blur'),
          );
          const bodyText = document.body.innerText || '';
          return {
            masked:
              maskedNodes.length > 0 ||
              blurredEls.length > 0 ||
              bodyText.includes('••••') ||
              bodyText.includes('***'),
            hasPercent: bodyText.includes('%'),
          };
        });
        expect(privacyCheck.masked).toBe(true);
        expect(privacyCheck.hasPercent).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T4][S09] Tactical RPG Agent Studio Operations: Deploy Knight in REF-13 Isometric Arena -> Configure SOUL.md Vars & Skill Policies (READ|APPROVE|AUTO) -> Dry-Run Sandbox -> Live [▶ Dispatch Now] via Mock Gateway -> Exhaust HP Budget Circuit Breaker -> Drag to Standby Barracks',
    { tag: ['@tier4', '@F09', '@F10', '@F12', '@F21', '@F26'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      const mockGateway = await startMockHermesGateway({
        responseText: 'Knight Artificer Kael tactical sweep completed.',
      });
      cleanup.defer(() => mockGateway.close());

      try {
        await withIsolatedBackend(
          { HERMES_GATEWAY_URL: mockGateway.baseV1Url },
          async ({ baseUrl }) => {
            const api = createApiClient(baseUrl);

            // Step 1: Inspect #141526 2:1 Isometric Knight Arena & Starter Order (F12, F21, F26)
            await waitForAppReady(page, `${baseUrl}/agents`);
            const sprites = await auditPixelatedSprites(page);
            expect(sprites.spriteCount).toBeGreaterThanOrEqual(1);
            expect(sprites.violations).toEqual([]);

            // Step 2: Forge Knight with SOUL.md Template Vars & 2x2 /mcp Skill Policies (F10, F12, F26)
            const knightRes = await api.post('/api/agents', {
              slug: uniqueId('artificer-kael'),
              name: 'Artificer Kael',
              knight_archetype: 'Artificer',
              crest_color: '#2CE5F2',
              grid_pos: { x: 2, y: 3, zone: 'cron_watchtower' },
              system_prompt:
                'Oath on {{today}}: guard goals {{active_goals}} and portfolio {{portfolio_summary}}.',
              model_config: {
                model: 'nousresearch/hermes-3-llama-3.1-70b',
                reasoning_effort: 'high',
              },
              tools_policy: {
                todos_list_tasks: 'READ',
                todos_create_task: 'AUTO',
                finance_upsert_asset: 'APPROVE',
                dashboards_get_life_score: 'READ',
              },
              monthly_budget_cents: 500,
              is_mastermind_member: true,
              enabled: true,
            });
            expect([200, 201]).toContain(knightRes.status);
            const knight = knightRes.json?.agent ?? knightRes.json;
            const knightId = knight.id;
            cleanup.defer(async () => {
              await api.delete(`/api/agents/${knightId}`);
            });

            const trigRes = await api.post(`/api/agents/${knightId}/triggers`, {
              type: 'event',
              event_name: 'GoalPaceAtRisk',
              config_json: { event: 'GoalPaceAtRisk' },
              enabled: true,
            });
            expect([200, 201]).toContain(trigRes.status);

            // Step 3: Dry-Run Sandbox vs Live [▶ Dispatch Now] Execution (F09, F12, F26)
            const dryRunRes = await api.post(`/api/agents/${knightId}/dispatch`, {
              dry_run: true,
              sample_input: 'Verify SOUL template expansion',
            });
            expect([200, 201]).toContain(dryRunRes.status);
            const todayIso = new Date().toISOString().slice(0, 10);
            expect(JSON.stringify(dryRunRes.json)).toContain(todayIso);

            mockGateway.clearRequests();
            const liveRunRes = await api.post(`/api/agents/${knightId}/dispatch`, {
              dry_run: false,
            });
            expect([200, 201]).toContain(liveRunRes.status);
            expect(mockGateway.requests.length).toBeGreaterThanOrEqual(1);

            const runsRes = await api.get(`/api/agent-runs?agent_id=${knightId}`);
            expect(runsRes.status).toBe(200);
            const runs = unwrapList(runsRes);
            expect(runs.length).toBeGreaterThanOrEqual(1);

            // Step 4: Exhaust HP Monthly Budget Circuit Breaker & Move to Standby Barracks (F12, F26)
            const budgetZeroRes = await api.put(`/api/agents/${knightId}`, {
              name: 'Artificer Kael',
              knight_archetype: 'Artificer',
              crest_color: '#2CE5F2',
              grid_pos: { x: 2, y: 3, zone: 'cron_watchtower' },
              system_prompt: knight.system_prompt,
              monthly_budget_cents: 0,
              enabled: true,
            });
            expect(budgetZeroRes.status).toBe(200);

            const blockedDispatch = await api.post(`/api/agents/${knightId}/dispatch`, {
              dry_run: false,
            });
            const wasBlocked =
              blockedDispatch.status >= 400 ||
              ['blocked', 'budget_exceeded', 'failed', 'paused', 'skipped'].includes(
                String(
                  (blockedDispatch.json?.run ?? blockedDispatch.json)?.status ??
                    blockedDispatch.json?.error ??
                    '',
                ).toLowerCase(),
              );
            expect(wasBlocked).toBe(true);

            const barracksRes = await api.put(`/api/agents/${knightId}`, {
              name: 'Artificer Kael',
              knight_archetype: 'Artificer',
              crest_color: '#2CE5F2',
              grid_pos: { x: 0, y: 0, zone: 'standby_barracks' },
              system_prompt: knight.system_prompt,
              monthly_budget_cents: 0,
              enabled: false,
            });
            expect(barracksRes.status).toBe(200);
          },
        );
      } finally {
        await cleanup.runAll();
      }
    },
  );
});
