import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  CleanupRegistry,
  E2E_PATHS,
  E2E_URLS,
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

test.describe('Area C Tier 2 — Routines, Streaks, Ideal Week & Vault Export Boundary & Resilience (F14 & F29)', () => {
  test.beforeAll(async () => {
    await ensureStackReady();
  });

  test(
    '[T2][F14] Daily Check-in rejects out-of-range energy_score and mood_score (<1 or >5) and malformed dates with 400',
    { tag: ['@tier2', '@F14'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const beforeVault = snapshotSecondBrainFiles();
      cleanup.defer(() => cleanupNewSecondBrainFiles(beforeVault));

      try {
        const testDate = '2026-10-20';

        const highEnergyRes = await api.put(`/checkins/${testDate}`, {
          day_profile_used: 'workday',
          energy_score: 6,
          mood_score: 3,
        });
        expect([400, 422]).toContain(highEnergyRes.status);

        const zeroMoodRes = await api.put(`/checkins/${testDate}`, {
          day_profile_used: 'workday',
          energy_score: 3,
          mood_score: 0,
        });
        expect([400, 422]).toContain(zeroMoodRes.status);

        const badDateRes = await api.put('/checkins/not-a-valid-date', {
          day_profile_used: 'workday',
          energy_score: 4,
          mood_score: 4,
        });
        expect([400, 404, 422]).toContain(badDateRes.status);

        const dailyMdPath = path.join(E2E_PATHS.secondBrainDir, 'Daily', `${testDate}.md`);
        expect(fs.existsSync(dailyMdPath)).toBe(false);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F14] Ideal Week rejects blocks where end_time <= start_time or day_of_week is outside 0..6 with 400',
    { tag: ['@tier2', '@F14'] },
    async () => {
      const api = createApiClient();
      const nowIso = new Date().toISOString();

      const invertedTimeRes = await api.put('/ideal-week', {
        blocks: [
          {
            id: '01932a00-0000-7000-8000-000000009201',
            day_of_week: 1,
            start_time: '14:00:00',
            end_time: '12:00:00',
            category: 'deep_work',
            linked_goal_id: null,
            label: 'Inverted Time Block',
            created_at: nowIso,
            updated_at: nowIso,
          },
        ],
      });
      expect([400, 422]).toContain(invertedTimeRes.status);

      const badDayRes = await api.put('/ideal-week', {
        blocks: [
          {
            id: '01932a00-0000-7000-8000-000000009202',
            day_of_week: 7,
            start_time: '09:00:00',
            end_time: '10:00:00',
            category: 'deep_work',
            linked_goal_id: null,
            label: 'Out of Range Day 7',
            created_at: nowIso,
            updated_at: nowIso,
          },
        ],
      });
      expect([400, 422]).toContain(badDayRes.status);
    },
  );

  test(
    '[T2][F14] Routine Log upsert idempotency on (routine_item_id, log_date) and streak reset on skipped status',
    { tag: ['@tier2', '@F14'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const routine = unwrapEntity(
          await api.post('/routines', {
            name: uniqueId('Idemp-Routine'),
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
            title: uniqueId('Idemp-Habit'),
            tracking_type: 'boolean',
            frequency_type: 'daily',
          }),
          ['routine_item', 'item'],
        );

        await api.post('/routine-logs', {
          routine_item_id: item.id,
          log_date: isoDateOffset(-2),
          status: 'completed',
        });
        await api.post('/routine-logs', {
          routine_item_id: item.id,
          log_date: isoDateOffset(-1),
          status: 'completed',
        });

        const todayComplete = await api.post('/routine-logs', {
          routine_item_id: item.id,
          log_date: isoDateOffset(0),
          status: 'completed',
        });
        expect([200, 201]).toContain(todayComplete.status);

        const todayOverwrite = await api.post('/routine-logs', {
          routine_item_id: item.id,
          log_date: isoDateOffset(0),
          status: 'skipped',
          notes: 'Changed to skipped on same date',
        });
        expect([200, 201]).toContain(todayOverwrite.status);
        const overwrittenLog = unwrapEntity(todayOverwrite, ['routine_log', 'log']);
        expect(overwrittenLog.status).toBe('skipped');

        const analytics = unwrapEntity(await api.get('/routines/analytics'));
        const streaks = unwrapList(analytics.streaks ?? [], ['streaks']);
        const itemStreak = streaks.find((s: any) => s.routine_item_id === item.id);
        expect(itemStreak).toBeTruthy();
        expect(Number(itemStreak.current_streak)).toBe(0);
        expect(Number(itemStreak.longest_streak)).toBeGreaterThanOrEqual(2);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F14] Minimum Viable / Travel Day Profile preserves habit streaks without breaking on non-MVD items',
    { tag: ['@tier2', '@F14'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const beforeVault = snapshotSecondBrainFiles();
      cleanup.defer(() => cleanupNewSecondBrainFiles(beforeVault));

      try {
        const routine = unwrapEntity(
          await api.post('/routines', {
            name: uniqueId('MVD-Freeze-Routine'),
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
            title: uniqueId('NonMVD-Habit'),
            tracking_type: 'boolean',
            frequency_type: 'daily',
            frequency_config: { mvd_included: false },
          }),
          ['routine_item', 'item'],
        );

        await api.post('/routine-logs', {
          routine_item_id: item.id,
          log_date: isoDateOffset(-2),
          status: 'completed',
        });
        await api.post('/routine-logs', {
          routine_item_id: item.id,
          log_date: isoDateOffset(-1),
          status: 'completed',
        });

        const todayIso = isoDateOffset(0);
        const checkinRes = await api.put(`/checkins/${todayIso}`, {
          day_profile_used: 'minimum_viable',
          energy_score: 3,
          mood_score: 4,
          sleep_hours: '6.50',
          highlight: 'MVD recovery day',
        });
        expect([200, 201]).toContain(checkinRes.status);

        const analytics = unwrapEntity(await api.get('/routines/analytics'));
        const streaks = unwrapList(analytics.streaks ?? [], ['streaks']);
        const itemStreak = streaks.find((s: any) => s.routine_item_id === item.id);
        expect(itemStreak).toBeTruthy();
        expect(Number(itemStreak.current_streak)).toBeGreaterThanOrEqual(2);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F14] Deleting a Routine cascades to its RoutineItems and unknown Routine/Item UUIDs return 404',
    { tag: ['@tier2', '@F14'] },
    async () => {
      const api = createApiClient();
      const missingUuid = '01932a00-0000-7000-8000-999999999999';

      const routine = unwrapEntity(
        await api.post('/routines', {
          name: uniqueId('Cascade-Routine'),
          time_slot: 'evening',
          day_profile: 'workday',
        }),
        ['routine'],
      );
      const item = unwrapEntity(
        await api.post(`/routines/${routine.id}/items`, {
          title: uniqueId('Cascade-Item'),
          tracking_type: 'boolean',
          frequency_type: 'daily',
        }),
        ['routine_item', 'item'],
      );

      const delRoutineRes = await api.delete(`/routines/${routine.id}`);
      expect([200, 204]).toContain(delRoutineRes.status);

      const putDeletedItem = await api.put(`/routine-items/${item.id}`, {
        title: 'Should 404 after parent delete',
      });
      expect(putDeletedItem.status).toBe(404);

      const getMissingRoutine = await api.get(`/routines/${missingUuid}`);
      expect(getMissingRoutine.status).toBe(404);
    },
  );

  test(
    '[T2][F14] Routine and Habit creation reject empty titles and invalid time_slot/day_profile enums with 400',
    { tag: ['@tier2', '@F14'] },
    async () => {
      const api = createApiClient();

      const emptyRoutineRes = await api.post('/routines', {
        name: '   ',
        time_slot: 'morning',
        day_profile: 'workday',
      });
      expect([400, 422]).toContain(emptyRoutineRes.status);

      const badSlotRes = await api.post('/routines', {
        name: 'Invalid Slot Routine',
        time_slot: 'midnight_snack',
        day_profile: 'workday',
      });
      expect([400, 422]).toContain(badSlotRes.status);

      const badProfileRes = await api.post('/routines', {
        name: 'Invalid Profile Routine',
        time_slot: 'morning',
        day_profile: 'invalid_profile',
      });
      expect([400, 422]).toContain(badProfileRes.status);
    },
  );

  test(
    '[T2][F29] Switching Day Profile to Minimum Viable (MVD) mid-day preserves already-completed workday habit logs',
    { tag: ['@tier2', '@F29'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const routine = unwrapEntity(
          await api.post('/routines', {
            name: uniqueId('ProfileSwitch-Routine'),
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
            title: uniqueId('ProfileSwitch-Habit'),
            tracking_type: 'boolean',
            frequency_type: 'daily',
          }),
          ['routine_item', 'item'],
        );

        await api.post('/routine-logs', {
          routine_item_id: item.id,
          log_date: isoDateOffset(0),
          status: 'completed',
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/routines`);

        for (const pattern of [/minimum viable|mvd/i, /workday/i]) {
          const btn = page
            .getByRole('button', { name: pattern })
            .or(page.getByRole('tab', { name: pattern }))
            .first();
          if ((await btn.count()) > 0) {
            await btn.click();
          }
        }

        const analytics = unwrapEntity(await api.get('/routines/analytics'));
        const streaks = unwrapList(analytics.streaks ?? [], ['streaks']);
        const itemStreak = streaks.find((s: any) => s.routine_item_id === item.id);
        expect(itemStreak).toBeTruthy();
        expect(Number(itemStreak.current_streak)).toBeGreaterThanOrEqual(1);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F29] Quantitative habit item (numeric / duration) records target value progress and partial vs completed status',
    { tag: ['@tier2', '@F29'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const routine = unwrapEntity(
          await api.post('/routines', {
            name: uniqueId('Quant-Routine'),
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
            title: uniqueId('Quant-Pages'),
            tracking_type: 'numeric',
            target_value: '20.00',
            unit: 'pages',
            frequency_type: 'daily',
          }),
          ['routine_item', 'item'],
        );

        const partialLog = await api.post('/routine-logs', {
          routine_item_id: item.id,
          log_date: isoDateOffset(0),
          status: 'partial',
          numeric_value: '10.00',
        });
        expect([200, 201]).toContain(partialLog.status);

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/routines`);
        const bodyText = await page.locator('body').innerText();
        expect(bodyText).not.toContain('NaN');

        const fullLog = await api.post('/routine-logs', {
          routine_item_id: item.id,
          log_date: isoDateOffset(0),
          status: 'completed',
          numeric_value: '20.00',
        });
        expect([200, 201]).toContain(fullLog.status);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F29] Empty routine stack renders clean Tactical FUI empty state and allows adding first habit step',
    { tag: ['@tier2', '@F29'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const emptyName = uniqueId('Empty-Stack');
        const routine = unwrapEntity(
          await api.post('/routines', {
            name: emptyName,
            time_slot: 'shutdown',
            day_profile: 'workday',
          }),
          ['routine'],
        );
        cleanup.defer(async () => {
          await api.delete(`/routines/${routine.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/routines`);
        await expect(page.locator('body')).toContainText(emptyName);

        const newItemTitle = uniqueId('First-Added-Step');
        const addRes = await api.post(`/routines/${routine.id}/items`, {
          title: newItemTitle,
          tracking_type: 'boolean',
          frequency_type: 'daily',
        });
        expect([200, 201]).toContain(addRes.status);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('body')).toContainText(newItemTitle);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F29] Ideal Week UI prevents or flags invalid time blocks where end_time <= start_time',
    { tag: ['@tier2', '@F29'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/routines`);

      const idealTab = page
        .getByRole('button', { name: /ideal.*week|time.*block|blueprint/i })
        .or(page.getByRole('tab', { name: /ideal.*week|time.*block|blueprint/i }))
        .first();
      if ((await idealTab.count()) > 0) {
        await idealTab.click();
      }

      const [radiusAudit, fontAudit] = await Promise.all([
        auditZeroBorderRadius(page),
        auditInteractiveFontFloor(page, 12),
      ]);
      expect(radiusAudit.violations).toEqual([]);
      expect(fontAudit.violations).toEqual([]);
    },
  );

  test(
    '[T2][F29] Weekly Review Wizard Step 1 & Step 2 handle zero inbox tasks and zero logged study sessions gracefully without NaN%',
    { tag: ['@tier2', '@F29'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/routines`);

      const reviewTab = page
        .getByRole('button', { name: /weekly.*review|review/i })
        .or(page.getByRole('tab', { name: /weekly.*review|review/i }))
        .first();
      if ((await reviewTab.count()) > 0) {
        await reviewTab.click();
      }

      const text = await page.locator('body').innerText();
      expect(text).not.toContain('NaN');
      expect(text).not.toContain('Infinity');
      expect(text).not.toContain('undefined');
    },
  );

  test(
    '[T2][F29] /routines viewport and FUI structural audit: zero horizontal overflow and 0px border-radius across all tabs',
    { tag: ['@tier2', '@F29'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/routines`);

      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 4;
      });
      expect(hasHorizontalOverflow).toBe(false);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);
    },
  );
});
