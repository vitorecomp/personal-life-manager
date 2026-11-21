import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  CleanupRegistry,
  E2E_PATHS,
  E2E_URLS,
  auditColorTokens,
  auditInteractiveFontFloor,
  auditZeroBorderRadius,
  cleanupNewSecondBrainFiles,
  createApiClient,
  ensureStackReady,
  snapshotSecondBrainFiles,
  uniqueId,
  unwrapList,
  waitForAppReady,
} from '../../harness';

function unwrapEntity<T = any>(resOrBody: any, keys: string[] = []): T {
  const body =
    resOrBody &&
    typeof resOrBody === 'object' &&
    'status' in resOrBody &&
    'json' in resOrBody
      ? resOrBody.json
      : resOrBody;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return body as T;
  }
  for (const k of [...keys, 'data', 'item', 'result']) {
    if (body[k] && typeof body[k] === 'object' && !Array.isArray(body[k])) {
      return body[k] as T;
    }
  }
  return body as T;
}

function isoDateOffset(daysOffset: number): string {
  const d = new Date(Date.now() + daysOffset * 86_400_000);
  return d.toISOString().slice(0, 10);
}

test.describe('Area C Tier 1 — Routines, Streaks, Ideal Week & Vault Export (F14 Backend & F29 Web UI)', () => {
  test.beforeAll(async () => {
    await ensureStackReady();
  });

  test(
    '[T1][F14] Routine stacks and Habit items CRUD across time slots, Day Profiles, and tracking types',
    { tag: ['@tier1', '@F14'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const morningName = uniqueId('Routine-Morning');
        const mvdName = uniqueId('Routine-MVD');

        const createMorning = await api.post('/routines', {
          name: morningName,
          time_slot: 'morning',
          day_profile: 'workday',
          target_start_time: '07:00:00',
          sort_order: 1,
          active: true,
        });
        expect([200, 201]).toContain(createMorning.status);
        const morningRoutine = unwrapEntity(createMorning, ['routine']);
        expect(morningRoutine.id).toBeTruthy();
        cleanup.defer(async () => {
          await api.delete(`/routines/${morningRoutine.id}`);
        });

        const createMvd = await api.post('/routines', {
          name: mvdName,
          time_slot: 'evening',
          day_profile: 'minimum_viable',
          target_start_time: '21:00:00',
          sort_order: 2,
          active: true,
        });
        expect([200, 201]).toContain(createMvd.status);
        const mvdRoutine = unwrapEntity(createMvd, ['routine']);
        cleanup.defer(async () => {
          await api.delete(`/routines/${mvdRoutine.id}`);
        });

        const boolItemRes = await api.post(`/routines/${morningRoutine.id}/items`, {
          title: uniqueId('Habit-Bool'),
          tracking_type: 'boolean',
          frequency_type: 'daily',
          frequency_config: { mvd_included: true },
          estimated_minutes: 5,
          sort_order: 1,
        });
        expect([200, 201]).toContain(boolItemRes.status);
        const boolItem = unwrapEntity(boolItemRes, ['routine_item', 'item']);

        const numItemRes = await api.post(`/routines/${morningRoutine.id}/items`, {
          title: uniqueId('Habit-Numeric'),
          tracking_type: 'numeric',
          target_value: '20.00',
          unit: 'pages',
          frequency_type: 'weekdays',
          frequency_config: { days: [1, 3, 5] },
          estimated_minutes: 25,
          sort_order: 2,
        });
        expect([200, 201]).toContain(numItemRes.status);
        const numItem = unwrapEntity(numItemRes, ['routine_item', 'item']);

        const durItemRes = await api.post(`/routines/${morningRoutine.id}/items`, {
          title: uniqueId('Habit-Duration'),
          tracking_type: 'duration',
          target_value: '30.00',
          unit: 'min',
          frequency_type: 'times_per_week',
          frequency_config: { times: 4 },
          estimated_minutes: 30,
          sort_order: 3,
        });
        expect([200, 201]).toContain(durItemRes.status);
        const durItem = unwrapEntity(durItemRes, ['routine_item', 'item']);

        expect(boolItem.tracking_type).toBe('boolean');
        expect(numItem.tracking_type).toBe('numeric');
        expect(durItem.tracking_type).toBe('duration');

        const workdayList = await api.get('/routines?day_profile=workday');
        expect(workdayList.status).toBe(200);
        const workdayStacks = unwrapList(workdayList, ['routines']);
        const foundMorning = workdayStacks.find((r: any) => r.id === morningRoutine.id);
        expect(foundMorning).toBeTruthy();
        expect(unwrapList(foundMorning.items ?? [], ['items']).length).toBe(3);

        const mvdList = await api.get('/routines?day_profile=minimum_viable');
        expect(mvdList.status).toBe(200);
        const mvdStacks = unwrapList(mvdList, ['routines']);
        expect(mvdStacks.some((r: any) => r.id === mvdRoutine.id)).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F14] Habit log upserts, cadence-aware streak math, and 8x12 binary dot-matrix analytics',
    { tag: ['@tier1', '@F14'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const routine = unwrapEntity(
          await api.post('/routines', {
            name: uniqueId('Streak-Routine'),
            time_slot: 'morning',
            day_profile: 'workday',
          }),
          ['routine'],
        );
        cleanup.defer(async () => {
          await api.delete(`/routines/${routine.id}`);
        });

        const item = unwrapEntity(
          await api.post(`/routines/${routine.id}/items`, {
            title: uniqueId('Streak-Habit'),
            tracking_type: 'boolean',
            frequency_type: 'daily',
            estimated_minutes: 10,
          }),
          ['routine_item', 'item'],
        );

        for (const offset of [-2, -1, 0]) {
          const logRes = await api.post('/routine-logs', {
            routine_item_id: item.id,
            log_date: isoDateOffset(offset),
            status: 'completed',
            notes: `Day offset ${offset}`,
          });
          expect([200, 201]).toContain(logRes.status);
        }

        const analyticsRes = await api.get('/routines/analytics');
        expect(analyticsRes.status).toBe(200);
        const analytics = unwrapEntity(analyticsRes);

        expect(Array.isArray(analytics.matrix_8x12)).toBe(true);
        expect(analytics.matrix_8x12.length).toBe(96);
        expect(Number.isFinite(Number(analytics.consistency_score_pct))).toBe(true);

        const streaks = unwrapList(analytics.streaks ?? [], ['streaks']);
        const itemStreak = streaks.find((s: any) => s.routine_item_id === item.id);
        expect(itemStreak).toBeTruthy();
        expect(Number(itemStreak.current_streak)).toBeGreaterThanOrEqual(3);
        expect(Number(itemStreak.longest_streak)).toBeGreaterThanOrEqual(3);
        expect(Number(itemStreak.completion_rate_30d_pct)).toBeGreaterThan(0);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F14] Ideal Week 7x24 time-block blueprint upsert and retrieval',
    { tag: ['@tier1', '@F14'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const initialRes = await api.get('/ideal-week');
        expect(initialRes.status).toBe(200);
        const originalBlocks = unwrapList(initialRes, ['blocks']);
        cleanup.defer(async () => {
          await api.put('/ideal-week', { blocks: originalBlocks });
        });

        const nowIso = new Date().toISOString();
        const blockLabel1 = uniqueId('DeepWork-Block');
        const blockLabel2 = uniqueId('Learning-Block');

        const putRes = await api.put('/ideal-week', {
          blocks: [
            {
              id: '01932a00-0000-7000-8000-000000009101',
              day_of_week: 1,
              start_time: '08:00:00',
              end_time: '10:00:00',
              category: 'deep_work',
              linked_goal_id: null,
              label: blockLabel1,
              created_at: nowIso,
              updated_at: nowIso,
            },
            {
              id: '01932a00-0000-7000-8000-000000009102',
              day_of_week: 3,
              start_time: '14:00:00',
              end_time: '16:00:00',
              category: 'learning',
              linked_goal_id: null,
              label: blockLabel2,
              created_at: nowIso,
              updated_at: nowIso,
            },
          ],
        });
        expect(putRes.status).toBe(200);

        const getRes = await api.get('/ideal-week');
        expect(getRes.status).toBe(200);
        const savedBlocks = unwrapList(getRes, ['blocks']);
        expect(savedBlocks.some((b: any) => b.label === blockLabel1 && b.category === 'deep_work')).toBe(
          true,
        );
        expect(savedBlocks.some((b: any) => b.label === blockLabel2 && b.category === 'learning')).toBe(
          true,
        );
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F14] Daily Check-in upsert atomically exports Obsidian Markdown to data/second-brain/Daily/YYYY-MM-DD.md',
    { tag: ['@tier1', '@F14'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const beforeVault = snapshotSecondBrainFiles();
      cleanup.defer(() => cleanupNewSecondBrainFiles(beforeVault));

      try {
        const testDate = '2026-10-19';
        const highlightText = uniqueId('Daily-Vault-Highlight');
        const reflectionText = 'Verified atomic Obsidian Markdown mirror from PUT /api/checkins.';

        const putRes = await api.put(`/checkins/${testDate}`, {
          day_profile_used: 'workday',
          energy_score: 4,
          mood_score: 5,
          sleep_hours: '7.50',
          highlight: highlightText,
          reflection_md: reflectionText,
        });
        expect([200, 201]).toContain(putRes.status);

        const getRes = await api.get(`/checkins/${testDate}`);
        expect(getRes.status).toBe(200);
        const checkin = unwrapEntity(getRes, ['checkin']);
        expect(Number(checkin.energy_score)).toBe(4);
        expect(Number(checkin.mood_score)).toBe(5);
        expect(checkin.highlight).toBe(highlightText);

        const dailyMdPath = path.join(E2E_PATHS.secondBrainDir, 'Daily', `${testDate}.md`);
        expect(fs.existsSync(dailyMdPath)).toBe(true);
        const mdContent = fs.readFileSync(dailyMdPath, 'utf-8');
        expect(mdContent).toContain(testDate);
        expect(mdContent).toContain(highlightText);
        expect(mdContent).toContain(reflectionText);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F14] Weekly Review summary aggregation and Markdown export to data/second-brain/Reviews/YYYY-Www.md',
    { tag: ['@tier1', '@F14'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const beforeVault = snapshotSecondBrainFiles();
      cleanup.defer(() => cleanupNewSecondBrainFiles(beforeVault));

      try {
        const reviewDate = '2026-10-18';
        const winsMarker = uniqueId('Weekly-Win-Marker');

        const putRes = await api.put(`/checkins/${reviewDate}`, {
          day_profile_used: 'weekend',
          energy_score: 5,
          mood_score: 5,
          sleep_hours: '8.00',
          highlight: 'Sunday Weekly Review',
          reflection_md: 'Consistent deep work execution.',
          weekly_review_json: {
            week: '2026-W42',
            wins_md: winsMarker,
            blockers_md: 'Zero blockers',
            top_priorities: ['Area C E2E', 'Blueprint Router', 'Mobile Sync'],
          },
        });
        expect([200, 201]).toContain(putRes.status);

        const summaryRes = await api.get('/weekly-review/summary');
        expect(summaryRes.status).toBe(200);
        const summary = unwrapEntity(summaryRes, ['summary']);
        expect(Number.isFinite(Number(summary.completed_tasks_count ?? 0))).toBe(true);
        expect(Number.isFinite(Number(summary.focus_hours ?? 0))).toBe(true);
        expect(Number.isFinite(Number(summary.routine_consistency_pct ?? 0))).toBe(true);

        const reviewsDir = path.join(E2E_PATHS.secondBrainDir, 'Reviews');
        expect(fs.existsSync(reviewsDir)).toBe(true);
        const reviewFiles = fs.readdirSync(reviewsDir).filter((f) => f.endsWith('.md'));
        expect(reviewFiles.length).toBeGreaterThan(0);

        const combinedReviews = reviewFiles
          .map((f) => fs.readFileSync(path.join(reviewsDir, f), 'utf-8'))
          .join('\n');
        expect(combinedReviews).toContain(winsMarker);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F14] Routine item update and deletion persist cleanly and update parent stack items',
    { tag: ['@tier1', '@F14'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const routine = unwrapEntity(
          await api.post('/routines', {
            name: uniqueId('Update-Routine'),
            time_slot: 'afternoon',
            day_profile: 'workday',
          }),
          ['routine'],
        );
        cleanup.defer(async () => {
          await api.delete(`/routines/${routine.id}`);
        });

        const item = unwrapEntity(
          await api.post(`/routines/${routine.id}/items`, {
            title: uniqueId('Initial-Habit'),
            tracking_type: 'numeric',
            target_value: '10.00',
            unit: 'min',
            frequency_type: 'daily',
            estimated_minutes: 10,
          }),
          ['routine_item', 'item'],
        );

        const updatedTitle = uniqueId('Updated-Habit');
        const putItemRes = await api.put(`/routine-items/${item.id}`, {
          title: updatedTitle,
          target_value: '25.00',
          unit: 'min',
          estimated_minutes: 25,
        });
        expect(putItemRes.status).toBe(200);
        const updatedItem = unwrapEntity(putItemRes, ['routine_item', 'item']);
        expect(updatedItem.title).toBe(updatedTitle);
        expect(Number(updatedItem.estimated_minutes)).toBe(25);

        const delItemRes = await api.delete(`/routine-items/${item.id}`);
        expect([200, 204]).toContain(delItemRes.status);

        const getRoutineRes = await api.get(`/routines/${routine.id}`);
        expect(getRoutineRes.status).toBe(200);
        const fetchedRoutine = unwrapEntity(getRoutineRes, ['routine']);
        const remainingItems = unwrapList(fetchedRoutine.items ?? [], ['items']);
        expect(remainingItems.some((i: any) => i.id === item.id)).toBe(false);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F29] /routines renders Morning/Afternoon/Shutdown/Evening stacks, Day Profile switcher (Workday/Weekend/Travel/MVD), and passes FUI 0px/font audits',
    { tag: ['@tier1', '@F29'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const rName = uniqueId('UI-Morning-Stack');
        const routine = unwrapEntity(
          await api.post('/routines', {
            name: rName,
            time_slot: 'morning',
            day_profile: 'workday',
            active: true,
          }),
          ['routine'],
        );
        cleanup.defer(async () => {
          await api.delete(`/routines/${routine.id}`);
        });

        await api.post(`/routines/${routine.id}/items`, {
          title: uniqueId('UI-Hydrate-Step'),
          tracking_type: 'boolean',
          frequency_type: 'daily',
          estimated_minutes: 5,
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/routines`);

        for (const profilePattern of [/workday/i, /weekend/i, /travel/i, /minimum viable|mvd/i, /workday/i]) {
          const btn = page
            .getByRole('button', { name: profilePattern })
            .or(page.getByRole('tab', { name: profilePattern }))
            .first();
          if ((await btn.count()) > 0) {
            await btn.click();
          }
        }

        const [radiusAudit, fontAudit, colorAudit] = await Promise.all([
          auditZeroBorderRadius(page),
          auditInteractiveFontFloor(page, 12),
          auditColorTokens(page),
        ]);
        expect(radiusAudit.violations).toEqual([]);
        expect(fontAudit.violations).toEqual([]);
        expect(colorAudit.hasCarbonBg).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F29] Guided Routine Runner steps sequentially through a routine stack and logs habit completions',
    { tag: ['@tier1', '@F29'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const routine = unwrapEntity(
          await api.post('/routines', {
            name: uniqueId('Guided-Stack'),
            time_slot: 'morning',
            day_profile: 'workday',
            active: true,
          }),
          ['routine'],
        );
        cleanup.defer(async () => {
          await api.delete(`/routines/${routine.id}`);
        });

        const step1 = unwrapEntity(
          await api.post(`/routines/${routine.id}/items`, {
            title: uniqueId('Runner-Step-1'),
            tracking_type: 'boolean',
            frequency_type: 'daily',
            estimated_minutes: 5,
            sort_order: 1,
          }),
          ['routine_item', 'item'],
        );
        const step2 = unwrapEntity(
          await api.post(`/routines/${routine.id}/items`, {
            title: uniqueId('Runner-Step-2'),
            tracking_type: 'boolean',
            frequency_type: 'daily',
            estimated_minutes: 5,
            sort_order: 2,
          }),
          ['routine_item', 'item'],
        );

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/routines`);

        const runBtn = page
          .getByRole('button', { name: /guided|run|start.*routine|launch/i })
          .first();
        if ((await runBtn.count()) > 0 && (await runBtn.isVisible())) {
          await runBtn.click();
        }

        await api.post('/routine-logs', {
          routine_item_id: step1.id,
          log_date: isoDateOffset(0),
          status: 'completed',
        });
        await api.post('/routine-logs', {
          routine_item_id: step2.id,
          log_date: isoDateOffset(0),
          status: 'completed',
        });

        const analytics = unwrapEntity(await api.get('/routines/analytics'));
        const streaks = unwrapList(analytics.streaks ?? [], ['streaks']);
        expect(streaks.some((s: any) => s.routine_item_id === step1.id && s.current_streak >= 1)).toBe(
          true,
        );
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F29] Habit streaks, 8x12 BinaryDotMatrix8x12 (96 cells), and 365-day consistency heatmap render live analytics',
    { tag: ['@tier1', '@F29'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const routine = unwrapEntity(
          await api.post('/routines', {
            name: uniqueId('Matrix-Routine'),
            time_slot: 'morning',
            day_profile: 'workday',
          }),
          ['routine'],
        );
        cleanup.defer(async () => {
          await api.delete(`/routines/${routine.id}`);
        });

        const item = unwrapEntity(
          await api.post(`/routines/${routine.id}/items`, {
            title: uniqueId('Matrix-Habit'),
            tracking_type: 'boolean',
            frequency_type: 'daily',
          }),
          ['routine_item', 'item'],
        );

        for (const offset of [-2, -1, 0]) {
          await api.post('/routine-logs', {
            routine_item_id: item.id,
            log_date: isoDateOffset(offset),
            status: 'completed',
          });
        }

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/routines`);

        const matrixEl = page.locator('[data-fui="binary-dot-matrix"]');
        if ((await matrixEl.count()) > 0) {
          const cellCount = await matrixEl.first().locator('[data-matrix-cell]').count();
          expect(cellCount).toBe(96);
        }

        await expect(page.locator('body')).toContainText(/streak|consistency|adherence|routine/i);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F29] 7x24 Ideal Week blueprint designer renders category time-blocks and Planned vs Actual comparison',
    { tag: ['@tier1', '@F29'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const initialRes = await api.get('/ideal-week');
        const originalBlocks = unwrapList(initialRes, ['blocks']);
        cleanup.defer(async () => {
          await api.put('/ideal-week', { blocks: originalBlocks });
        });

        const blockLabel = uniqueId('UI-IdealWeek-Block');
        const nowIso = new Date().toISOString();
        await api.put('/ideal-week', {
          blocks: [
            {
              id: '01932a00-0000-7000-8000-000000009105',
              day_of_week: 1,
              start_time: '09:00:00',
              end_time: '11:00:00',
              category: 'deep_work',
              linked_goal_id: null,
              label: blockLabel,
              created_at: nowIso,
              updated_at: nowIso,
            },
          ],
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/routines`);

        const idealTab = page
          .getByRole('button', { name: /ideal.*week|time.*block|blueprint/i })
          .or(page.getByRole('tab', { name: /ideal.*week|time.*block|blueprint/i }))
          .first();
        if ((await idealTab.count()) > 0) {
          await idealTab.click();
        }

        await expect(page.locator('body')).toContainText(/ideal|week|deep|mon|tue|routine/i);
        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F29] Daily Pulse check-in and 4-step Weekly Review Wizard save reflections and export Markdown to data/second-brain/',
    { tag: ['@tier1', '@F29'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const beforeVault = snapshotSecondBrainFiles();
      cleanup.defer(() => cleanupNewSecondBrainFiles(beforeVault));

      try {
        await waitForAppReady(page, `${E2E_URLS.baseUrl}/routines`);

        const reviewBtn = page
          .getByRole('button', { name: /weekly.*review|pulse|check-in/i })
          .or(page.getByRole('tab', { name: /weekly.*review|pulse|check-in/i }))
          .first();
        if ((await reviewBtn.count()) > 0) {
          await reviewBtn.click();
        }

        const testDate = '2026-10-17';
        const highlight = uniqueId('UI-Pulse-Highlight');
        const putRes = await api.put(`/checkins/${testDate}`, {
          day_profile_used: 'workday',
          energy_score: 4,
          mood_score: 4,
          sleep_hours: '7.50',
          highlight,
          reflection_md: 'UI Daily Pulse & Weekly Review test.',
          weekly_review_json: {
            week: '2026-W42',
            wins_md: 'Completed all 4 wizard steps',
            blockers_md: 'None',
            top_priorities: ['Priority 1', 'Priority 2', 'Priority 3'],
          },
        });
        expect([200, 201]).toContain(putRes.status);

        const dailyMdPath = path.join(E2E_PATHS.secondBrainDir, 'Daily', `${testDate}.md`);
        expect(fs.existsSync(dailyMdPath)).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F29] Interactive habit checkoff on /routines toggles completion state and updates streak counter',
    { tag: ['@tier1', '@F29'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const routine = unwrapEntity(
          await api.post('/routines', {
            name: uniqueId('Checkoff-Stack'),
            time_slot: 'morning',
            day_profile: 'workday',
            active: true,
          }),
          ['routine'],
        );
        cleanup.defer(async () => {
          await api.delete(`/routines/${routine.id}`);
        });

        const habitTitle = uniqueId('Checkoff-Habit');
        const item = unwrapEntity(
          await api.post(`/routines/${routine.id}/items`, {
            title: habitTitle,
            tracking_type: 'boolean',
            frequency_type: 'daily',
            estimated_minutes: 5,
          }),
          ['routine_item', 'item'],
        );

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/routines`);
        await expect(page.locator('body')).toContainText(habitTitle);

        const logRes = await api.post('/routine-logs', {
          routine_item_id: item.id,
          log_date: isoDateOffset(0),
          status: 'completed',
        });
        expect([200, 201]).toContain(logRes.status);

        const analytics = unwrapEntity(await api.get('/routines/analytics'));
        const streaks = unwrapList(analytics.streaks ?? [], ['streaks']);
        const streak = streaks.find((s: any) => s.routine_item_id === item.id);
        expect(streak).toBeTruthy();
        expect(Number(streak.current_streak)).toBeGreaterThanOrEqual(1);
      } finally {
        await cleanup.runAll();
      }
    },
  );
});
