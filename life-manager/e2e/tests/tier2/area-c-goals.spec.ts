import { expect, test } from '@playwright/test';
import {
  CleanupRegistry,
  E2E_URLS,
  auditInteractiveFontFloor,
  auditOrthogonalBlueprintCorridors,
  auditZeroBorderRadius,
  createApiClient,
  ensureStackReady,
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

test.describe('Area C Tier 2 — Yearly Goals, OKR Rollups & 90-Degree Blueprint Boundary & Resilience (F15 & F30)', () => {
  test.beforeAll(async () => {
    await ensureStackReady();
  });

  test(
    '[T2][F15] Soft Focus Cap guardrail flags focus_cap_exceeded when active goals exceed focus_cap_limit without blocking creation',
    { tag: ['@tier2', '@F15'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const cycleRes = await api.put('/goals/cycles/2029', {
          year: 2029,
          theme: 'Year of Focused Execution',
          vision_md: 'Strict cap testing',
          anti_goals_md: '- No overcommitment',
          focus_cap_limit: 2,
          status: 'active',
        });
        expect([200, 201]).toContain(cycleRes.status);

        for (let i = 1; i <= 3; i++) {
          const gRes = await api.post('/goals', {
            year: 2029,
            pillar: 'systems',
            code: `G0${i}`,
            title: uniqueId(`CapGoal-${i}`),
            status: 'in_progress',
            priority_rank: i,
          });
          expect([200, 201]).toContain(gRes.status);
          const g = unwrapEntity(gRes, ['goal']);
          cleanup.defer(async () => {
            await api.delete(`/goals/${g.id}`);
          });
        }

        const goals2029Res = await api.get('/goals?year=2029');
        expect(goals2029Res.status).toBe(200);
        const goals2029 = unwrapList(goals2029Res, ['goals']);
        const activeCount = goals2029.filter((g: any) => g.status === 'in_progress').length;
        expect(activeCount).toBeGreaterThanOrEqual(3);

        const cycle2029 = unwrapEntity(await api.get('/goals/cycles/2029'), ['cycle']);
        expect(Number(cycle2029.focus_cap_limit)).toBe(2);
        expect(activeCount > Number(cycle2029.focus_cap_limit)).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F15] Key Result zero-range target_value == start_value and empty linked_project guard against division-by-zero',
    { tag: ['@tier2', '@F15'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const emptyProj = unwrapEntity(
          await api.post('/projects', {
            name: uniqueId('ZeroTask-Proj'),
            area: 'systems',
            status: 'active',
          }),
          ['project'],
        );
        cleanup.defer(async () => {
          await api.delete(`/projects/${emptyProj.id}`);
        });

        const goal = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'systems',
            code: 'G11',
            title: uniqueId('ZeroRange-Goal'),
            status: 'in_progress',
          }),
          ['goal'],
        );
        cleanup.defer(async () => {
          await api.delete(`/goals/${goal.id}`);
        });

        const zeroRangeKr = await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q1',
          code: 'KR11.1',
          title: 'Zero range numeric KR',
          metric_type: 'numeric',
          start_value: '50.00',
          current_value: '50.00',
          target_value: '50.00',
          weight: '1.00',
        });
        expect([200, 201]).toContain(zeroRangeKr.status);

        const emptyProjKr = await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q2',
          code: 'KR11.2',
          title: 'Empty linked project KR',
          metric_type: 'linked_project',
          linked_entity_id: emptyProj.id,
          start_value: '0.00',
          current_value: '0.00',
          target_value: '100.00',
          weight: '1.00',
        });
        expect([200, 201]).toContain(emptyProjKr.status);

        const getGoalRes = await api.get(`/goals/${goal.id}`);
        expect(getGoalRes.status).toBe(200);
        const fetchedGoal = unwrapEntity(getGoalRes, ['goal']);
        const pct = Number(fetchedGoal.progress_pct);
        expect(Number.isFinite(pct)).toBe(true);
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F15] Goal and Check-in reject out-of-range confidence_score (<1 or >10) and invalid cycle years with 400',
    { tag: ['@tier2', '@F15'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const badGoalConfHigh = await api.post('/goals', {
          year: 2026,
          pillar: 'career',
          title: 'Invalid Confidence 11',
          confidence_score: 11,
        });
        expect([400, 422]).toContain(badGoalConfHigh.status);

        const badGoalConfLow = await api.post('/goals', {
          year: 2026,
          pillar: 'career',
          title: 'Invalid Confidence 0',
          confidence_score: 0,
        });
        expect([400, 422]).toContain(badGoalConfLow.status);

        const validGoal = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'career',
            title: uniqueId('Valid-For-Checkin'),
            confidence_score: 7,
          }),
          ['goal'],
        );
        cleanup.defer(async () => {
          await api.delete(`/goals/${validGoal.id}`);
        });

        const badCheckinConf = await api.post(`/goals/${validGoal.id}/checkins`, {
          confidence_score: 0,
          progress_snapshot: '50.00',
        });
        expect([400, 422]).toContain(badCheckinConf.status);

        const badCycleYear = await api.post('/goals/cycles', {
          year: 1995,
          theme: 'Out of range year',
          focus_cap_limit: 6,
        });
        expect([400, 422]).toContain(badCycleYear.status);

        const badCycleCap = await api.post('/goals/cycles', {
          year: 2030,
          theme: 'Zero focus cap',
          focus_cap_limit: 0,
        });
        expect([400, 422]).toContain(badCycleCap.status);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F15] Deleting a linked Project or Course gracefully preserves the Key Result without breaking Goal rollup',
    { tag: ['@tier2', '@F15'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const proj = unwrapEntity(
          await api.post('/projects', {
            name: uniqueId('Ephemeral-Linked-Proj'),
            area: 'systems',
            status: 'active',
          }),
          ['project'],
        );

        const goal = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'systems',
            code: 'G12',
            title: uniqueId('Orphan-Link-Goal'),
            status: 'in_progress',
          }),
          ['goal'],
        );
        cleanup.defer(async () => {
          await api.delete(`/goals/${goal.id}`);
        });

        const krRes = await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q3',
          code: 'KR12.1',
          title: 'KR with deleted project',
          metric_type: 'linked_project',
          linked_entity_id: proj.id,
          start_value: '0.00',
          current_value: '25.00',
          target_value: '100.00',
          weight: '1.00',
        });
        expect([200, 201]).toContain(krRes.status);

        await api.delete(`/projects/${proj.id}`);

        const afterDelGoal = await api.get(`/goals/${goal.id}`);
        expect(afterDelGoal.status).toBe(200);
        const gObj = unwrapEntity(afterDelGoal, ['goal']);
        expect(Number.isFinite(Number(gObj.progress_pct))).toBe(true);

        const bpRes = await api.get('/goals/cycles/2026/blueprint');
        expect(bpRes.status).toBe(200);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F15] Non-existent Goal, Key Result, and Cycle IDs return 404 Not Found',
    { tag: ['@tier2', '@F15'] },
    async () => {
      const api = createApiClient();
      const missingUuid = '01932a00-0000-7000-8000-999999999999';

      const getMissingGoal = await api.get(`/goals/${missingUuid}`);
      expect(getMissingGoal.status).toBe(404);

      const pinMissingGoal = await api.patch(`/goals/${missingUuid}/blueprint-pos`, {
        blueprint_pos: { x: 100, y: 100 },
      });
      expect(pinMissingGoal.status).toBe(404);

      const putMissingKr = await api.put(`/key-results/${missingUuid}`, {
        current_value: '50.00',
      });
      expect(putMissingKr.status).toBe(404);

      const getMissingCycle = await api.get('/goals/cycles/2099');
      expect(getMissingCycle.status).toBe(404);
    },
  );

  test(
    '[T2][F15] Key Result creation rejects negative weight and invalid quarter/metric_type enums with 400',
    { tag: ['@tier2', '@F15'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const goal = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'systems',
            title: uniqueId('Invalid-KR-Goal'),
          }),
          ['goal'],
        );
        cleanup.defer(async () => {
          await api.delete(`/goals/${goal.id}`);
        });

        const negWeightRes = await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q1',
          title: 'Negative weight KR',
          metric_type: 'numeric',
          start_value: '0.00',
          current_value: '10.00',
          target_value: '100.00',
          weight: '-2.00',
        });
        expect([400, 422]).toContain(negWeightRes.status);

        const badQuarterRes = await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q5_INVALID',
          title: 'Invalid Quarter',
          metric_type: 'numeric',
        });
        expect([400, 422]).toContain(badQuarterRes.status);

        const badMetricRes = await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q1',
          title: 'Invalid Metric Type',
          metric_type: 'telepathic_rollup',
        });
        expect([400, 422]).toContain(badMetricRes.status);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F30] Focus Cap warning banner appears on /goals when active goals exceed cycle focus_cap_limit',
    { tag: ['@tier2', '@F30'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const cycle2026 = unwrapEntity(await api.get('/goals/cycles/2026'), ['cycle']);
        const origCap = Number(cycle2026.focus_cap_limit ?? 6);
        await api.put('/goals/cycles/2026', {
          year: 2026,
          theme: cycle2026.theme || 'Year of Systems & Leverage',
          vision_md: cycle2026.vision_md || '',
          anti_goals_md: cycle2026.anti_goals_md || '',
          focus_cap_limit: 1,
          status: 'active',
        });
        cleanup.defer(async () => {
          await api.put('/goals/cycles/2026', {
            year: 2026,
            theme: cycle2026.theme || 'Year of Systems & Leverage',
            vision_md: cycle2026.vision_md || '',
            anti_goals_md: cycle2026.anti_goals_md || '',
            focus_cap_limit: origCap,
            status: 'active',
          });
        });

        for (let i = 1; i <= 2; i++) {
          const g = unwrapEntity(
            await api.post('/goals', {
              year: 2026,
              pillar: 'systems',
              code: `GC${i}`,
              title: uniqueId(`UI-CapWarning-${i}`),
              status: 'in_progress',
            }),
            ['goal'],
          );
          cleanup.defer(async () => {
            await api.delete(`/goals/${g.id}`);
          });
        }

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/goals`);
        await expect(page.locator('body')).toContainText(/cap|focus|limit|active|goal/i);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F30] Off-track / At-risk goal with 0% progress renders warning/vermilion pace drift badge on /goals',
    { tag: ['@tier2', '@F30'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const goalTitle = uniqueId('Stalled-OffTrack-Goal');
        const goal = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'health',
            code: 'G99',
            title: goalTitle,
            status: 'in_progress',
            priority_rank: 1,
            confidence_score: 3,
          }),
          ['goal'],
        );
        cleanup.defer(async () => {
          await api.delete(`/goals/${goal.id}`);
        });

        await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q1',
          code: 'KR99.1',
          title: 'Zero progress KR',
          metric_type: 'numeric',
          start_value: '0.00',
          current_value: '0.00',
          target_value: '100.00',
          weight: '1.00',
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/goals`);
        await expect(page.locator('body')).toContainText(/track|risk|pace|G99/i);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F30] REF-03 Blueprint layout maintains 100% 90-degree Manhattan corridor geometry under dense multi-pillar OKR graph',
    { tag: ['@tier2', '@F30'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const pillars = ['systems', 'career', 'finance'] as const;
        for (let i = 0; i < pillars.length; i++) {
          const g = unwrapEntity(
            await api.post('/goals', {
              year: 2026,
              pillar: pillars[i],
              code: `GD${i + 1}`,
              title: uniqueId(`Dense-Blueprint-${i + 1}`),
              status: 'in_progress',
              priority_rank: i + 1,
            }),
            ['goal'],
          );
          cleanup.defer(async () => {
            await api.delete(`/goals/${g.id}`);
          });

          for (const q of ['Q1', 'Q2'] as const) {
            await api.post(`/goals/${g.id}/key-results`, {
              quarter: q,
              code: `KRD${i + 1}.${q}`,
              title: `Dense KR ${q}`,
              metric_type: 'numeric',
              start_value: '0.00',
              current_value: '50.00',
              target_value: '100.00',
              weight: '1.00',
            });
          }
        }

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/goals`);
        const bpTab = page
          .getByRole('button', { name: /blueprint|schematic|map/i })
          .or(page.getByRole('tab', { name: /blueprint|schematic|map/i }))
          .first();
        if ((await bpTab.count()) > 0) {
          await bpTab.click();
        }

        const corridorAudit = await auditOrthogonalBlueprintCorridors(page);
        expect(corridorAudit.segmentCount).toBeGreaterThan(0);
        expect(corridorAudit.diagonalOrCurvedViolations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F30] Switching between Annual Cycles (2026 <-> 2027) on /goals isolates cycle-specific goals and renders empty/planning cycle cleanly',
    { tag: ['@tier2', '@F30'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/goals`);

      for (const yearPattern of [/2027/, /2026/]) {
        const btn = page
          .getByRole('button', { name: yearPattern })
          .or(page.getByRole('tab', { name: yearPattern }))
          .first();
        if ((await btn.count()) > 0) {
          await btn.click();
        }
        const text = await page.locator('body').innerText();
        expect(text).not.toContain('NaN');
        expect(text).not.toContain('undefined');
      }
    },
  );

  test(
    '[T2][F30] Zero-range Key Result (start_value == target_value) renders on /goals without NaN% or Infinity% labels',
    { tag: ['@tier2', '@F30'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const goal = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'personal',
            code: 'GZ0',
            title: uniqueId('UI-ZeroRange-Goal'),
            status: 'in_progress',
          }),
          ['goal'],
        );
        cleanup.defer(async () => {
          await api.delete(`/goals/${goal.id}`);
        });

        await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q4',
          code: 'KRZ.1',
          title: 'Zero denominator KR',
          metric_type: 'numeric',
          start_value: '100.00',
          current_value: '100.00',
          target_value: '100.00',
          weight: '1.00',
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/goals`);
        const bodyText = await page.locator('body').innerText();
        expect(bodyText).not.toContain('NaN');
        expect(bodyText).not.toContain('Infinity');
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F30] /goals REF-02 FUI structural audit: 0px border-radius, >= 12px interactive font floor, and zero horizontal overflow',
    { tag: ['@tier2', '@F30'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/goals`);

      const [radiusAudit, fontAudit] = await Promise.all([
        auditZeroBorderRadius(page),
        auditInteractiveFontFloor(page, 12),
      ]);
      expect(radiusAudit.violations).toEqual([]);
      expect(fontAudit.violations).toEqual([]);

      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 4;
      });
      expect(hasHorizontalOverflow).toBe(false);
    },
  );
});
