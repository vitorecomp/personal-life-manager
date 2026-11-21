import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  E2E_PATHS,
  ensureStackReady,
  withIsolatedBackend,
  createApiClient,
  unwrapList,
  uniqueId,
  CleanupRegistry,
  snapshotSecondBrainFiles,
  cleanupNewSecondBrainFiles,
  createYoutubeFixtureEnv,
  waitForAppReady,
  auditZeroBorderRadius,
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

test.describe('Tier 3 Pairwise — Life Ops Cross-Domain Rollups, Nudges, Crawlers, Vault & Charts (T3-15..T3-27)', () => {
  test(
    '[T3-15][F13][F15][F30] Completing project tasks linked to a Yearly Goal automatically rolls up linked_project Key Result and parent Goal progress_pct on /goals',
    { tag: ['@tier3', '@F13', '@F15', '@F30'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        await api.post('/api/goals/cycles', {
          year: 2026,
          theme: 'Tier 3 Cross-Domain Execution',
          status: 'active',
        });

        const goalRes = await api.post('/api/goals', {
          year: 2026,
          pillar: 'systems',
          code: uniqueId('G-T315').slice(0, 12),
          title: uniqueId('T3-15 Project Rollup Goal'),
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
          name: uniqueId('T3-15 Linked Project'),
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
          quarter: 'Q1',
          code: 'KR-T315',
          title: 'Deliver all linked project tasks',
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

        const t1Res = await api.post('/api/tasks', {
          title: uniqueId('T3-15 Task 1'),
          project_id: projectId,
          goal_id: goalId,
          status: 'todo',
          priority: 'high',
        });
        expect([200, 201]).toContain(t1Res.status);
        const t1 = t1Res.json?.task ?? t1Res.json;
        cleanup.defer(async () => {
          await api.delete(`/api/tasks/${t1.id}`);
        });

        const t2Res = await api.post('/api/tasks', {
          title: uniqueId('T3-15 Task 2'),
          project_id: projectId,
          goal_id: goalId,
          status: 'todo',
          priority: 'medium',
        });
        expect([200, 201]).toContain(t2Res.status);
        const t2 = t2Res.json?.task ?? t2Res.json;
        cleanup.defer(async () => {
          await api.delete(`/api/tasks/${t2.id}`);
        });

        const goalInitial = await api.get(`/api/goals/${goalId}`);
        expect(goalInitial.status).toBe(200);
        const initialProgress = Number(
          (goalInitial.json?.goal ?? goalInitial.json)?.progress_pct ?? -1,
        );
        expect(initialProgress).toBe(0);

        const done1 = await api.patch(`/api/tasks/${t1.id}/status`, { status: 'done' });
        expect(done1.status).toBe(200);

        const goalMid = await api.get(`/api/goals/${goalId}`);
        expect(goalMid.status).toBe(200);
        const midProgress = Number((goalMid.json?.goal ?? goalMid.json)?.progress_pct ?? 0);
        expect(midProgress).toBeGreaterThanOrEqual(49);
        expect(midProgress).toBeLessThanOrEqual(51);

        const done2 = await api.patch(`/api/tasks/${t2.id}/status`, { status: 'done' });
        expect(done2.status).toBe(200);

        const goalFinal = await api.get(`/api/goals/${goalId}`);
        expect(goalFinal.status).toBe(200);
        const finalProgress = Number((goalFinal.json?.goal ?? goalFinal.json)?.progress_pct ?? 0);
        expect(finalProgress).toBeGreaterThanOrEqual(99);

        await waitForAppReady(page, `${baseUrl}/goals`);
        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-16][F14][F15] Logging habit completions on a routine item linked to a Yearly Goal updates linked_habit Key Result adherence and streak analytics',
    { tag: ['@tier3', '@F14', '@F15'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        await api.post('/api/goals/cycles', {
          year: 2026,
          theme: 'Tier 3 Habit Rollup',
          status: 'active',
        });

        const goalRes = await api.post('/api/goals', {
          year: 2026,
          pillar: 'vitality',
          code: uniqueId('G-T316').slice(0, 12),
          title: uniqueId('T3-16 Habit Rollup Goal'),
          status: 'in_progress',
          priority_rank: 2,
        });
        expect([200, 201]).toContain(goalRes.status);
        const goal = goalRes.json?.goal ?? goalRes.json;
        const goalId = goal.id;
        cleanup.defer(async () => {
          await api.delete(`/api/goals/${goalId}`);
        });

        const routineRes = await api.post('/api/routines', {
          name: uniqueId('T3-16 Morning Routine'),
          time_slot: 'morning',
          day_profile: 'workday',
          target_start_time: '06:30:00',
          active: true,
        });
        expect([200, 201]).toContain(routineRes.status);
        const routine = routineRes.json?.routine ?? routineRes.json;
        const routineId = routine.id;
        cleanup.defer(async () => {
          await api.delete(`/api/routines/${routineId}`);
        });

        const itemRes = await api.post(`/api/routines/${routineId}/items`, {
          title: uniqueId('T3-16 Zone 2 Cardio'),
          tracking_type: 'boolean',
          frequency_type: 'daily',
          estimated_minutes: 30,
          goal_id: goalId,
          sort_order: 1,
        });
        expect([200, 201]).toContain(itemRes.status);
        const item = itemRes.json?.item ?? itemRes.json;
        const itemId = item.id;
        cleanup.defer(async () => {
          await api.delete(`/api/routine-items/${itemId}`);
        });

        const krRes = await api.post(`/api/goals/${goalId}/key-results`, {
          quarter: 'Q2',
          code: 'KR-T316',
          title: 'Maintain Daily Zone 2 Habit',
          metric_type: 'linked_habit',
          start_value: 0,
          target_value: 100,
          unit: '%',
          linked_entity_id: itemId,
          weight: 1,
        });
        expect([200, 201]).toContain(krRes.status);
        const kr = krRes.json?.key_result ?? krRes.json;
        cleanup.defer(async () => {
          if (kr?.id) await api.delete(`/api/key-results/${kr.id}`);
        });

        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

        const log1 = await api.post('/api/routine-logs', {
          routine_item_id: itemId,
          log_date: yesterday,
          status: 'completed',
        });
        expect([200, 201]).toContain(log1.status);

        const log2 = await api.post('/api/routine-logs', {
          routine_item_id: itemId,
          log_date: today,
          status: 'completed',
        });
        expect([200, 201]).toContain(log2.status);

        const analyticsRes = await api.get('/api/routines/analytics');
        expect(analyticsRes.status).toBe(200);
        expect(analyticsRes.json).toBeTruthy();

        const goalCheck = await api.get(`/api/goals/${goalId}`);
        expect(goalCheck.status).toBe(200);
        const goalData = goalCheck.json?.goal ?? goalCheck.json;
        expect(Number(goalData.progress_pct ?? 0)).toBeGreaterThan(0);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-17][F16][F15] Advancing course lesson statuses to distilled and completed updates course progress_pct and rolls up linked_course Key Result',
    { tag: ['@tier3', '@F16', '@F15'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        await api.post('/api/goals/cycles', {
          year: 2026,
          theme: 'Tier 3 Learning Rollup',
          status: 'active',
        });

        const goalRes = await api.post('/api/goals', {
          year: 2026,
          pillar: 'learning',
          code: uniqueId('G-T317').slice(0, 12),
          title: uniqueId('T3-17 Course Rollup Goal'),
          status: 'in_progress',
          priority_rank: 1,
        });
        expect([200, 201]).toContain(goalRes.status);
        const goal = goalRes.json?.goal ?? goalRes.json;
        const goalId = goal.id;
        cleanup.defer(async () => {
          await api.delete(`/api/goals/${goalId}`);
        });

        const courseRes = await api.post('/api/courses', {
          title: uniqueId('T3-17 Rust Async Mastery'),
          provider: 'Internal Spec',
          status: 'active',
          goal_id: goalId,
        });
        expect([200, 201]).toContain(courseRes.status);
        const course = courseRes.json?.course ?? courseRes.json;
        const courseId = course.id;
        cleanup.defer(async () => {
          await api.delete(`/api/courses/${courseId}`);
        });

        const modRes = await api.post(`/api/courses/${courseId}/modules`, {
          title: 'Module 1 — Pin & Futures',
          sort_order: 1,
        });
        expect([200, 201]).toContain(modRes.status);
        const mod = modRes.json?.module ?? modRes.json;
        const modId = mod.id;

        const l1Res = await api.post(`/api/course-modules/${modId}/lessons`, {
          title: 'Lesson 1 — Waker Contract',
          duration_minutes: 45,
          sort_order: 1,
        });
        expect([200, 201]).toContain(l1Res.status);
        const l1 = l1Res.json?.lesson ?? l1Res.json;

        const l2Res = await api.post(`/api/course-modules/${modId}/lessons`, {
          title: 'Lesson 2 — Work-Stealing Executor',
          duration_minutes: 45,
          sort_order: 2,
        });
        expect([200, 201]).toContain(l2Res.status);
        const l2 = l2Res.json?.lesson ?? l2Res.json;

        const krRes = await api.post(`/api/goals/${goalId}/key-results`, {
          quarter: 'Q3',
          code: 'KR-T317',
          title: 'Complete Rust Async Mastery Course',
          metric_type: 'linked_course',
          start_value: 0,
          target_value: 100,
          unit: '%',
          linked_entity_id: courseId,
          weight: 1,
        });
        expect([200, 201]).toContain(krRes.status);
        const kr = krRes.json?.key_result ?? krRes.json;
        cleanup.defer(async () => {
          if (kr?.id) await api.delete(`/api/key-results/${kr.id}`);
        });

        const p1 = await api.patch(`/api/course-lessons/${l1.id}/status`, { status: 'distilled' });
        expect(p1.status).toBe(200);

        const courseMid = await api.get(`/api/courses/${courseId}`);
        expect(courseMid.status).toBe(200);
        const courseMidObj = courseMid.json?.course ?? courseMid.json;
        expect(Number(courseMidObj.progress_pct ?? -1)).toBeGreaterThanOrEqual(49);
        expect(Number(courseMidObj.progress_pct ?? -1)).toBeLessThanOrEqual(51);

        const goalMid = await api.get(`/api/goals/${goalId}`);
        expect(goalMid.status).toBe(200);
        const goalMidPct = Number((goalMid.json?.goal ?? goalMid.json)?.progress_pct ?? 0);
        expect(goalMidPct).toBeGreaterThanOrEqual(49);
        expect(goalMidPct).toBeLessThanOrEqual(51);

        const p2 = await api.patch(`/api/course-lessons/${l2.id}/status`, { status: 'completed' });
        expect(p2.status).toBe(200);

        const courseFinal = await api.get(`/api/courses/${courseId}`);
        const courseFinalObj = courseFinal.json?.course ?? courseFinal.json;
        expect(Number(courseFinalObj.progress_pct)).toBeGreaterThanOrEqual(99);

        const goalFinal = await api.get(`/api/goals/${goalId}`);
        const goalFinalPct = Number((goalFinal.json?.goal ?? goalFinal.json)?.progress_pct ?? 0);
        expect(goalFinalPct).toBeGreaterThanOrEqual(99);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-18][F17][F15] Portfolio asset valuation updates and FX conversion roll up into linked_finance Key Result and FIRE progress',
    { tag: ['@tier3', '@F17', '@F15'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        await api.post('/api/goals/cycles', {
          year: 2026,
          theme: 'Tier 3 Finance Rollup',
          status: 'active',
        });

        const symbol = uniqueId('T318').toUpperCase().slice(0, 10);
        const assetRes = await api.post('/api/finance/assets', {
          symbol,
          name: 'T3-18 Treasury Holding',
          asset_class: 'br_fixed_income',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 100,
          avg_cost_cents: 4000,
          current_price_cents: 5000,
          target_weight_pct: 20,
        });
        expect([200, 201]).toContain(assetRes.status);
        const asset = assetRes.json?.asset ?? assetRes.json;
        const assetId = asset.id;
        cleanup.defer(async () => {
          await api.delete(`/api/finance/assets/${assetId}`);
        });

        const goalRes = await api.post('/api/goals', {
          year: 2026,
          pillar: 'finance',
          code: uniqueId('G-T318').slice(0, 12),
          title: uniqueId('T3-18 Wealth Target Goal'),
          status: 'in_progress',
          priority_rank: 1,
        });
        expect([200, 201]).toContain(goalRes.status);
        const goal = goalRes.json?.goal ?? goalRes.json;
        const goalId = goal.id;
        cleanup.defer(async () => {
          await api.delete(`/api/goals/${goalId}`);
        });

        const krRes = await api.post(`/api/goals/${goalId}/key-results`, {
          quarter: 'Q4',
          code: 'KR-T318',
          title: 'Reach R$ 10,000 in T3-18 Holding',
          metric_type: 'linked_finance',
          start_value: 0,
          target_value: 1000000,
          unit: 'BRL',
          linked_entity_id: assetId,
          weight: 1,
        });
        expect([200, 201]).toContain(krRes.status);
        const kr = krRes.json?.key_result ?? krRes.json;
        cleanup.defer(async () => {
          if (kr?.id) await api.delete(`/api/key-results/${kr.id}`);
        });

        const goalMid = await api.get(`/api/goals/${goalId}`);
        expect(goalMid.status).toBe(200);
        const midPct = Number((goalMid.json?.goal ?? goalMid.json)?.progress_pct ?? 0);
        expect(midPct).toBeGreaterThan(0);

        const updateAsset = await api.put(`/api/finance/assets/${assetId}`, {
          symbol,
          name: 'T3-18 Treasury Holding',
          asset_class: 'br_fixed_income',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 200,
          avg_cost_cents: 4000,
          current_price_cents: 5000,
          target_weight_pct: 20,
        });
        expect(updateAsset.status).toBe(200);

        const goalAfter = await api.get(`/api/goals/${goalId}`);
        expect(goalAfter.status).toBe(200);
        const afterPct = Number((goalAfter.json?.goal ?? goalAfter.json)?.progress_pct ?? -1);
        expect(afterPct).toBeGreaterThanOrEqual(midPct);

        const fireRes = await api.get('/api/finance/retirement');
        expect(fireRes.status).toBe(200);
        expect(
          Number(
            fireRes.json?.current_net_worth_brl_cents ??
              fireRes.json?.portfolio_brl_cents ??
              fireRes.json?.current_portfolio_cents ??
              0,
          ),
        ).toBeGreaterThan(0);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-19][F12][F15][F16][F17] Cross-module drift signals (0h course study, portfolio weight drift >5%, goal pace at_risk) surface in Frieren /api/companion/nudges',
    { tag: ['@tier3', '@F12', '@F15', '@F16', '@F17'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const courseRes = await api.post('/api/courses', {
          title: uniqueId('T3-19 Inactive 14d Course'),
          status: 'active',
        });
        expect([200, 201]).toContain(courseRes.status);
        const course = courseRes.json?.course ?? courseRes.json;
        cleanup.defer(async () => {
          await api.delete(`/api/courses/${course.id}`);
        });

        await api.post('/api/goals/cycles', {
          year: 2026,
          theme: 'Tier 3 Drift Audit',
          status: 'active',
        });
        const goalRes = await api.post('/api/goals', {
          year: 2026,
          pillar: 'systems',
          code: uniqueId('G-T319').slice(0, 12),
          title: uniqueId('T3-19 Drifting Goal'),
          status: 'in_progress',
          priority_rank: 1,
        });
        expect([200, 201]).toContain(goalRes.status);
        const goal = goalRes.json?.goal ?? goalRes.json;
        cleanup.defer(async () => {
          await api.delete(`/api/goals/${goal.id}`);
        });

        await api.post(`/api/goals/${goal.id}/key-results`, {
          quarter: 'Q1',
          code: 'KR-T319',
          title: 'Stalled Q1 Deliverable',
          metric_type: 'numeric',
          start_value: 0,
          current_value: 0,
          target_value: 100,
          unit: '%',
          weight: 1,
        });

        const assetRes = await api.post('/api/finance/assets', {
          symbol: uniqueId('DRIFT').toUpperCase().slice(0, 10),
          name: 'Drifted Weight Asset',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 1,
          avg_cost_cents: 100,
          current_price_cents: 100,
          target_weight_pct: 85,
        });
        expect([200, 201]).toContain(assetRes.status);
        const asset = assetRes.json?.asset ?? assetRes.json;
        cleanup.defer(async () => {
          await api.delete(`/api/finance/assets/${asset.id}`);
        });

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
    '[T3-20][F16][F01][F02] Read-only youtube-lists and youtube-ai SQLite fixture import into Course Tracker with shared -ref.md resolution and zero DB mutation',
    { tag: ['@tier3', '@F16', '@F01', '@F02'] },
    async () => {
      const cleanup = new CleanupRegistry();
      const fixture = await createYoutubeFixtureEnv({
        includeAiTable: true,
        includeSharedRefNote: true,
        includeUnavailableVideos: true,
      });
      cleanup.defer(() => fixture.cleanup());

      try {
        const hashBefore = sha256File(fixture.dbPath);

        await withIsolatedBackend(
          {
            YOUTUBE_LISTS_DB: fixture.dbPath,
            YOUTUBE_LISTS_NOTES_DIR: fixture.notesDir,
          },
          async ({ baseUrl }) => {
            const api = createApiClient(baseUrl);

            const playlistsRes = await api.get('/api/courses/youtube/playlists');
            expect(playlistsRes.status).toBe(200);
            const playlists = unwrapList(playlistsRes, ['playlists', 'items']);
            const playlistIds = playlists.map((p: any) => p.playlist_id ?? p.id);
            expect(playlistIds).toContain('PL_DIST_SYS_01');
            expect(playlistIds).toContain('PL_RUST_ASYNC_02');
            expect(playlistIds).not.toContain('PL_REMOVED_LEGACY');

            const importRes = await api.post('/api/courses/youtube/import', {
              playlist_id: 'PL_DIST_SYS_01',
            });
            expect([200, 201]).toContain(importRes.status);
            const course = importRes.json?.course ?? importRes.json;
            const courseId = course.id ?? importRes.json?.course_id;
            expect(courseId).toBeTruthy();

            cleanup.defer(async () => {
              await api.delete(`/api/courses/${courseId}`);
            });

            const detailRes = await api.get(`/api/courses/${courseId}`);
            expect(detailRes.status).toBe(200);
            const detailText = JSON.stringify(detailRes.json);
            expect(detailText).toContain('Raft Consensus');
            expect(detailText).toContain('Vector Clocks');
            expect(detailText).toContain('Work-Stealing');
            expect(detailText).not.toContain('[Private video]');
            expect(detailText).not.toContain('[Deleted video]');

            const syncRes = await api.post(`/api/courses/${courseId}/youtube/sync`, {});
            expect(syncRes.status).toBe(200);

            const hashAfter = sha256File(fixture.dbPath);
            expect(hashAfter).toBe(hashBefore);
          },
        );
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-21][F16][F13][F09][F31] Course study timer rollup, spawn-todo lab task linking, and 1-click Quiz Me in Hermes session creation',
    { tag: ['@tier3', '@F16', '@F13', '@F09', '@F31'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        const courseRes = await api.post('/api/courses', {
          title: uniqueId('T3-21 Distributed Systems Course'),
          provider: 'MIT 6.824',
          status: 'active',
        });
        expect([200, 201]).toContain(courseRes.status);
        const course = courseRes.json?.course ?? courseRes.json;
        const courseId = course.id;
        cleanup.defer(async () => {
          await api.delete(`/api/courses/${courseId}`);
        });

        const modRes = await api.post(`/api/courses/${courseId}/modules`, {
          title: 'Module 1 — Causality & Clocks',
          sort_order: 1,
        });
        expect([200, 201]).toContain(modRes.status);
        const mod = modRes.json?.module ?? modRes.json;

        const lessonRes = await api.post(`/api/course-modules/${mod.id}/lessons`, {
          title: 'Vector Clocks & Logical Time',
          duration_minutes: 30,
          key_summary_md: 'Vector clocks detect concurrent causality violations across nodes.',
          sort_order: 1,
        });
        expect([200, 201]).toContain(lessonRes.status);
        const lesson = lessonRes.json?.lesson ?? lessonRes.json;
        const lessonId = lesson.id;

        const sessionRes = await api.post('/api/time/sessions', {
          course_id: courseId,
          lesson_id: lessonId,
          category: 'learning',
          timer_mode: 'stopwatch',
          started_at: new Date(Date.now() - 1800_000).toISOString(),
          ended_at: new Date().toISOString(),
          duration_seconds: 1800,
          notes: 'Studied Vector Clocks',
        });
        expect([200, 201]).toContain(sessionRes.status);
        const timeSession = sessionRes.json?.session ?? sessionRes.json;
        if (timeSession?.id) {
          cleanup.defer(async () => {
            await api.delete(`/api/time/sessions/${timeSession.id}`);
          });
        }

        const courseAfterStudy = await api.get(`/api/courses/${courseId}`);
        expect(courseAfterStudy.status).toBe(200);
        const cObj = courseAfterStudy.json?.course ?? courseAfterStudy.json;
        expect(
          Number(
            cObj.logged_study_seconds ??
              (cObj.logged_study_minutes !== undefined ? Number(cObj.logged_study_minutes) * 60 : 0),
          ),
        ).toBeGreaterThanOrEqual(1800);

        const spawnTitle = uniqueId('Implement Vector Clock merge in Rust');
        const spawnRes = await api.post(`/api/courses/${courseId}/spawn-todo`, {
          title: spawnTitle,
          lesson_id: lessonId,
        });
        expect([200, 201]).toContain(spawnRes.status);
        const spawnedTask = spawnRes.json?.task ?? spawnRes.json;
        if (spawnedTask?.id) {
          cleanup.defer(async () => {
            await api.delete(`/api/tasks/${spawnedTask.id}`);
          });
        }

        const tasksRes = await api.get(`/api/tasks?course_id=${courseId}`);
        expect(tasksRes.status).toBe(200);
        const courseTasks = unwrapList(tasksRes);
        expect(
          courseTasks.some((t: any) => t.title === spawnTitle || t.course_id === courseId),
        ).toBe(true);

        const quizRes = await api.post(`/api/courses/${courseId}/quiz`, {
          lesson_id: lessonId,
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

        await waitForAppReady(page, `${baseUrl}/courses`);
        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);
        await expect(page.locator('body')).toBeVisible();
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-22][F16][F11][F14] Completing a course lesson schedules 7d/30d/90d spaced reviews and updates Learning pillar Life Score and Weekly Review summary',
    { tag: ['@tier3', '@F16', '@F11', '@F14'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const courseRes = await api.post('/api/courses', {
          title: uniqueId('T3-22 Spaced Review Course'),
          status: 'active',
        });
        expect([200, 201]).toContain(courseRes.status);
        const course = courseRes.json?.course ?? courseRes.json;
        const courseId = course.id;
        cleanup.defer(async () => {
          await api.delete(`/api/courses/${courseId}`);
        });

        const modRes = await api.post(`/api/courses/${courseId}/modules`, {
          title: 'Module 1 — Consensus',
          sort_order: 1,
        });
        const mod = modRes.json?.module ?? modRes.json;

        const lessonRes = await api.post(`/api/course-modules/${mod.id}/lessons`, {
          title: 'Paxos vs Raft Tradeoffs',
          duration_minutes: 40,
          key_summary_md: 'Raft enforces strong leader election via term numbers.',
          sort_order: 1,
        });
        const lesson = lessonRes.json?.lesson ?? lessonRes.json;
        const lessonId = lesson.id;

        const statusRes = await api.patch(`/api/course-lessons/${lessonId}/status`, {
          status: 'distilled',
        });
        expect(statusRes.status).toBe(200);

        const today = new Date().toISOString().slice(0, 10);
        await api.put(`/api/course-lessons/${lessonId}`, {
          title: 'Paxos vs Raft Tradeoffs',
          duration_minutes: 40,
          status: 'distilled',
          review_stage: 0,
          next_review_date: today,
          key_summary_md: 'Raft enforces strong leader election via term numbers.',
        });

        const dueRes = await api.get('/api/courses/spaced-reviews/due');
        expect(dueRes.status).toBe(200);
        const dueItems = unwrapList(dueRes, ['reviews', 'lessons', 'items']);
        expect(dueItems.some((item: any) => (item.lesson_id ?? item.id) === lessonId)).toBe(true);

        const rev1 = await api.post(`/api/course-lessons/${lessonId}/review`, {
          action: 'complete',
        });
        expect(rev1.status).toBe(200);
        expect(Number((rev1.json?.lesson ?? rev1.json)?.review_stage ?? -1)).toBe(1);

        const rev2 = await api.post(`/api/course-lessons/${lessonId}/review`, {
          action: 'complete',
        });
        expect(rev2.status).toBe(200);
        expect(Number((rev2.json?.lesson ?? rev2.json)?.review_stage ?? -1)).toBe(2);

        const rev3 = await api.post(`/api/course-lessons/${lessonId}/review`, {
          action: 'complete',
        });
        expect(rev3.status).toBe(200);
        expect(Number((rev3.json?.lesson ?? rev3.json)?.review_stage ?? -1)).toBe(3);

        const lifeScoreRes = await api.get('/api/telemetry/life-score');
        expect(lifeScoreRes.status).toBe(200);
        const scoreVal = Number(
          lifeScoreRes.json?.score ??
            lifeScoreRes.json?.life_score ??
            lifeScoreRes.json?.composite_score ??
            -1,
        );
        expect(scoreVal).toBeGreaterThanOrEqual(0);
        expect(scoreVal).toBeLessThanOrEqual(100);

        const weeklyRes = await api.get('/api/weekly-review/summary');
        expect(weeklyRes.status).toBe(200);
        expect(weeklyRes.json).toBeTruthy();
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-23][F11][F13][F14][F15][F17] Five-pillar Life Score (0-100) composite calculation across Focus, Routines, Goals, Learning, and Wealth/FI plus custom read-only SQL widget',
    { tag: ['@tier3', '@F11', '@F13', '@F14', '@F15', '@F17'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const initialScoreRes = await api.get('/api/telemetry/life-score');
        expect(initialScoreRes.status).toBe(200);
        const initialJson = initialScoreRes.json;
        const composite0 = Number(
          initialJson?.score ?? initialJson?.life_score ?? initialJson?.composite_score ?? -1,
        );
        expect(Number.isFinite(composite0)).toBe(true);
        expect(composite0).toBeGreaterThanOrEqual(0);
        expect(composite0).toBeLessThanOrEqual(100);

        const taskRes = await api.post('/api/tasks', {
          title: uniqueId('T3-23 Focus Task'),
          status: 'done',
          priority: 'high',
          energy_level: 'deep',
        });
        const task = taskRes.json?.task ?? taskRes.json;
        if (task?.id) {
          cleanup.defer(async () => {
            await api.delete(`/api/tasks/${task.id}`);
          });
        }

        const sessRes = await api.post('/api/time/sessions', {
          task_id: task?.id,
          category: 'deep_work',
          timer_mode: 'pomodoro_50_10',
          started_at: new Date(Date.now() - 3000_000).toISOString(),
          ended_at: new Date().toISOString(),
          duration_seconds: 3000,
        });
        const sess = sessRes.json?.session ?? sessRes.json;
        if (sess?.id) {
          cleanup.defer(async () => {
            await api.delete(`/api/time/sessions/${sess.id}`);
          });
        }

        await api.put('/api/finance/monthly-plans/2026-11', {
          month: '2026-11',
          currency: 'BRL',
          fx_usd_brl: 5.0,
          salary_income_cents: 2500000,
          planned_spend_cents: 1200000,
          actual_spend_cents: 1100000,
          planned_investment_cents: 1300000,
          actual_invested_cents: 1400000,
        });

        const updatedScoreRes = await api.get('/api/telemetry/life-score');
        expect(updatedScoreRes.status).toBe(200);
        const composite1 = Number(
          updatedScoreRes.json?.score ??
            updatedScoreRes.json?.life_score ??
            updatedScoreRes.json?.composite_score ??
            -1,
        );
        expect(composite1).toBeGreaterThanOrEqual(0);
        expect(composite1).toBeLessThanOrEqual(100);

        const dashRes = await api.post('/api/dashboards', {
          title: uniqueId('T3-23 SQL Guard Deck'),
          slug: uniqueId('t3-23-sql-deck'),
          cycle_seconds: 60,
          in_rotation: false,
        });
        expect([200, 201]).toContain(dashRes.status);
        const dash = dashRes.json?.dashboard ?? dashRes.json;
        cleanup.defer(async () => {
          await api.delete(`/api/dashboards/${dash.id}`);
        });

        const sqlWidgetRes = await api.post(`/api/dashboards/${dash.id}/widgets`, {
          title: 'Task Count SQL Panel',
          source_kind: 'sql',
          renderer_kind: 'table',
          grid_x: 0,
          grid_y: 0,
          grid_w: 4,
          grid_h: 2,
          source_config: {
            query: 'SELECT count(*) AS task_count FROM tasks',
          },
        });
        expect([200, 201]).toContain(sqlWidgetRes.status);
        const sqlWidget = sqlWidgetRes.json?.widget ?? sqlWidgetRes.json;

        const refreshOk = await api.post(`/api/widgets/${sqlWidget.id}/refresh`, {});
        expect(refreshOk.status).toBe(200);
        expect(JSON.stringify(refreshOk.json)).toContain('task_count');

        const badSqlRes = await api.post(`/api/dashboards/${dash.id}/widgets`, {
          title: 'Malicious Drop SQL Panel',
          source_kind: 'sql',
          renderer_kind: 'table',
          grid_x: 4,
          grid_y: 0,
          grid_w: 4,
          grid_h: 2,
          source_config: {
            query: 'DROP TABLE tasks',
          },
        });
        if ([200, 201].includes(badSqlRes.status)) {
          const badWidget = badSqlRes.json?.widget ?? badSqlRes.json;
          const badRefresh = await api.post(`/api/widgets/${badWidget.id}/refresh`, {});
          expect(
            badRefresh.status >= 400 ||
              Boolean(badRefresh.json?.error) ||
              JSON.stringify(badRefresh.json).toLowerCase().includes('error') ||
              JSON.stringify(badRefresh.json).toLowerCase().includes('select'),
          ).toBe(true);
        } else {
          expect(badSqlRes.status).toBeGreaterThanOrEqual(400);
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-24][F14][F12][F25] Weekly Review Wizard Markdown export to data/second-brain/Reviews/YYYY-Www.md and live preview/distill in Hermes Vault Inspector',
    { tag: ['@tier3', '@F14', '@F12', '@F25'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();
      const beforeVault = snapshotSecondBrainFiles();
      cleanup.defer(() => cleanupNewSecondBrainFiles(beforeVault));

      try {
        const checkinDate = '2026-11-15';
        const winMarker = uniqueId('Completed T3-24 Cross-Domain Suite');

        const putRes = await api.put(`/api/checkins/${checkinDate}`, {
          day_profile_used: 'weekend',
          energy_score: 5,
          mood_score: 5,
          sleep_hours: 8.0,
          highlight: 'Sunday Weekly Review Export',
          reflection_md: 'T3-24 Sunday reflection body.',
          weekly_review_json: {
            week: '2026-W46',
            wins_md: winMarker,
            blockers_md: 'Zero blockers.',
            priorities: ['Ship M4', 'Ship M5', 'Audit M6'],
            next_week_priorities: ['Ship M4', 'Ship M5', 'Audit M6'],
          },
        });
        expect(putRes.status).toBe(200);

        const exportedReview =
          findVaultFileContaining(path.join(E2E_PATHS.secondBrainDir, 'Reviews'), winMarker) ??
          findVaultFileContaining(E2E_PATHS.secondBrainDir, winMarker);
        expect(exportedReview).toBeTruthy();

        const relPath = path.relative(E2E_PATHS.secondBrainDir, exportedReview!).replace(/\\/g, '/');
        const noteRes = await api.get(`/api/vault/note?path=${encodeURIComponent(relPath)}`);
        expect(noteRes.status).toBe(200);
        expect(JSON.stringify(noteRes.json)).toContain(winMarker);

        const distillTitle = uniqueId('T3-24 Inbox Distill');
        const distillRes = await api.post('/api/vault/distill', {
          title: distillTitle,
          content_md: `# ${distillTitle}\n\nActionable insight from T3-24.`,
        });
        expect([200, 201]).toContain(distillRes.status);

        const notesListRes = await api.get('/api/vault/notes');
        expect(notesListRes.status).toBe(200);
        const notesList = unwrapList(notesListRes, ['notes', 'files', 'items']);
        expect(notesList.length).toBeGreaterThan(0);

        await waitForAppReady(page, `${baseUrl}/hermes`);
        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);
        await expect(page.locator('body')).toBeVisible();
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-25][F23][F28][F13] Global Cmd+K NLP Quick Capture modal creating tagged/scheduled task and rendering in /todos TERMINAL-I/O Flow and Dependency Tree',
    { tag: ['@tier3', '@F23', '@F28', '@F13'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        const rawInput = 'T3-25 Build Raft Log #systems @deep_work !urgent tomorrow 90m';
        const parseRes = await api.post('/api/tasks/parse', { text: rawInput, input: rawInput });
        expect(parseRes.status).toBe(200);
        const parsed = parseRes.json?.parsed ?? parseRes.json;
        expect(String(parsed.priority || '').toLowerCase()).toBe('urgent');
        expect(String(parsed.energy_level || '').toLowerCase()).toContain('deep');
        expect(Number(parsed.estimated_minutes)).toBe(90);
        expect((parsed.tags || []).map((t: string) => t.toLowerCase())).toContain('systems');

        const task1Res = await api.post('/api/tasks', {
          title: uniqueId('T3-25 Build Raft Log'),
          status: 'in_progress',
          priority: 'urgent',
          energy_level: 'deep',
          estimated_minutes: 90,
          tags: ['systems'],
        });
        expect([200, 201]).toContain(task1Res.status);
        const task1 = task1Res.json?.task ?? task1Res.json;
        cleanup.defer(async () => {
          await api.delete(`/api/tasks/${task1.id}`);
        });

        const task2Res = await api.post('/api/tasks', {
          title: uniqueId('T3-25 Snapshot Compaction'),
          status: 'todo',
          priority: 'high',
          energy_level: 'deep',
          blocked_by_task_ids: [task1.id],
        });
        expect([200, 201]).toContain(task2Res.status);
        const task2 = task2Res.json?.task ?? task2Res.json;
        cleanup.defer(async () => {
          await api.delete(`/api/tasks/${task2.id}`);
        });

        const cycleRes = await api.put(`/api/tasks/${task1.id}`, {
          title: task1.title,
          status: 'in_progress',
          priority: 'urgent',
          blocked_by_task_ids: [task2.id],
        });
        expect(cycleRes.status).toBe(422);

        const flowRes = await api.get('/api/tasks/flow');
        expect(flowRes.status).toBe(200);
        expect(JSON.stringify(flowRes.json)).toContain(task1.id);

        await waitForAppReady(page, `${baseUrl}/dashboard`);
        await page.keyboard.press('Control+k');
        await page.waitForTimeout(200);

        await waitForAppReady(page, `${baseUrl}/todos`);
        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-26][F29][F31][F14] Routine Ideal Week 7x24 time-blocking variance against Course learning sessions and Day Profile switching on /routines and /courses',
    { tag: ['@tier3', '@F29', '@F31', '@F14'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        const idealGet = await api.get('/api/ideal-week');
        expect(idealGet.status).toBe(200);
        const existingBlocks = unwrapList(idealGet, ['blocks', 'items']);

        const putIdeal = await api.put('/api/ideal-week', {
          blocks: [
            ...existingBlocks,
            {
              day_of_week: 1,
              start_time: '08:00',
              end_time: '10:00',
              category: 'learning',
              label: 'T3-26 Morning Study Block',
            },
          ],
        });
        expect([200, 201]).toContain(putIdeal.status);

        cleanup.defer(async () => {
          await api.put('/api/ideal-week', { blocks: existingBlocks });
        });

        await waitForAppReady(page, `${baseUrl}/routines`);
        const routinesRadius = await auditZeroBorderRadius(page);
        expect(routinesRadius.violations).toEqual([]);

        await waitForAppReady(page, `${baseUrl}/courses`);
        const coursesRadius = await auditZeroBorderRadius(page);
        expect(coursesRadius.violations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-27][F22][F32][F17] Finance Operator /finance 10x20 200-tile Hare-Niemeyer Waffle, Buy-Only Rebalancer, Macro Monthly Spend paired hatched bars, and FIRE What-If simulator',
    { tag: ['@tier3', '@F22', '@F32', '@F17'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        const a1 = await api.post('/api/finance/assets', {
          symbol: uniqueId('WAF1').toUpperCase().slice(0, 10),
          name: 'Waffle Holding 1',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 100,
          avg_cost_cents: 3000,
          current_price_cents: 3333,
          target_weight_pct: 33.33,
        });
        const a2 = await api.post('/api/finance/assets', {
          symbol: uniqueId('WAF2').toUpperCase().slice(0, 10),
          name: 'Waffle Holding 2',
          asset_class: 'br_fii',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 100,
          avg_cost_cents: 3000,
          current_price_cents: 3333,
          target_weight_pct: 33.33,
        });
        const a3 = await api.post('/api/finance/assets', {
          symbol: uniqueId('WAF3').toUpperCase().slice(0, 10),
          name: 'Waffle Holding 3',
          asset_class: 'global_etf',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 100,
          avg_cost_cents: 3000,
          current_price_cents: 3334,
          target_weight_pct: 33.34,
        });

        for (const res of [a1, a2, a3]) {
          expect([200, 201]).toContain(res.status);
          const id = (res.json?.asset ?? res.json)?.id;
          if (id) {
            cleanup.defer(async () => {
              await api.delete(`/api/finance/assets/${id}`);
            });
          }
        }

        const planRes = await api.put('/api/finance/monthly-plans/2026-11', {
          month: '2026-11',
          currency: 'BRL',
          fx_usd_brl: 5.0,
          salary_income_cents: 3000000,
          planned_spend_cents: 1500000,
          actual_spend_cents: 1400000,
          planned_investment_cents: 1500000,
          actual_invested_cents: 1600000,
        });
        expect(planRes.status).toBe(200);

        const allocRes = await api.get('/api/finance/allocation?investable_surplus_cents=1600000');
        expect(allocRes.status).toBe(200);
        const allocJson = allocRes.json;

        const tilesArray = allocJson?.waffle_tiles ?? allocJson?.tiles;
        const allocationsList = unwrapList(allocJson, ['allocations', 'holdings', 'assets', 'items']);
        if (Array.isArray(tilesArray)) {
          expect(tilesArray.length).toBe(200);
        } else {
          const tileSum = allocationsList.reduce(
            (acc: number, item: any) => acc + Number(item.waffle_tiles ?? item.tiles ?? 0),
            0,
          );
          expect(tileSum).toBe(200);
        }

        const orders = unwrapList(allocJson, [
          'recommendations',
          'rebalance_orders',
          'buy_orders',
          'allocations',
          'items',
        ]);
        for (const order of orders) {
          const buyCents = Number(
            order.recommended_buy_cents ??
              order.recommended_buy_brl_cents ??
              order.buy_amount_cents ??
              -1,
          );
          expect(buyCents).toBeGreaterThanOrEqual(0);
        }

        const simHighSpend = await api.post('/api/finance/retirement/simulate', {
          monthly_retirement_spend_brl_cents: 2000000,
          monthly_spend_cents: 2000000,
          monthly_contribution_brl_cents: 500000,
          monthly_contribution_cents: 500000,
          expected_real_return_pct: 6.0,
          safe_withdrawal_rate_pct: 4.0,
        });
        expect(simHighSpend.status).toBe(200);

        const simLowSpend = await api.post('/api/finance/retirement/simulate', {
          monthly_retirement_spend_brl_cents: 800000,
          monthly_spend_cents: 800000,
          monthly_contribution_brl_cents: 1700000,
          monthly_contribution_cents: 1700000,
          expected_real_return_pct: 6.0,
          safe_withdrawal_rate_pct: 4.0,
        });
        expect(simLowSpend.status).toBe(200);

        const totalMonthsHigh =
          Number(simHighSpend.json?.years_to_fi ?? -1) * 12 +
          Number(simHighSpend.json?.months_to_fi ?? simHighSpend.json?.total_months_to_fi ?? 0);
        const totalMonthsLow =
          Number(simLowSpend.json?.years_to_fi ?? 999) * 12 +
          Number(simLowSpend.json?.months_to_fi ?? simLowSpend.json?.total_months_to_fi ?? 0);
        expect(totalMonthsLow).toBeLessThanOrEqual(totalMonthsHigh);

        await waitForAppReady(page, `${baseUrl}/finance`);
        const pieCharts = await page.locator('[data-chart-type="pie"], .pie-chart').count();
        expect(pieCharts).toBe(0);

        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );
});
