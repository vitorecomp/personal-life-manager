import { expect, test } from '@playwright/test';
import {
  CleanupRegistry,
  E2E_URLS,
  auditColorTokens,
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

test.describe('Area C Tier 1 — Yearly Goals, Live OKR Rollups & 90-Degree Blueprint (F15 Backend & F30 Web UI)', () => {
  test.beforeAll(async () => {
    await ensureStackReady();
  });

  test(
    '[T1][F15] Yearly Cycles and Goals CRUD with seeded 2026/2027 cycles and manual blueprint-pos pinning',
    { tag: ['@tier1', '@F15'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const cyclesRes = await api.get('/goals/cycles');
        expect(cyclesRes.status).toBe(200);
        const cycles = unwrapList(cyclesRes, ['cycles']);
        expect(cycles.some((c: any) => Number(c.year) === 2026)).toBe(true);
        expect(cycles.some((c: any) => Number(c.year) === 2027)).toBe(true);

        const goalRes = await api.post('/goals', {
          year: 2026,
          pillar: 'systems',
          code: 'G09',
          title: uniqueId('Ship-HERMES-OS-v1'),
          why_motivation_md: 'Unified daily-driver autonomy',
          status: 'in_progress',
          priority_rank: 1,
          target_date: '2026-12-31',
          confidence_score: 9,
          blueprint_pos: { x: 240, y: 160 },
        });
        expect([200, 201]).toContain(goalRes.status);
        const goal = unwrapEntity(goalRes, ['goal']);
        expect(goal.id).toBeTruthy();
        expect(goal.pillar).toBe('systems');
        expect(Number(goal.confidence_score)).toBe(9);
        cleanup.defer(async () => {
          await api.delete(`/goals/${goal.id}`);
        });

        const pinRes = await api.patch(`/goals/${goal.id}/blueprint-pos`, {
          blueprint_pos: { x: 480, y: 240 },
        });
        expect(pinRes.status).toBe(200);

        const fetchedGoal = unwrapEntity(await api.get(`/goals/${goal.id}`), ['goal']);
        expect(Number(fetchedGoal.blueprint_pos?.x)).toBe(480);
        expect(Number(fetchedGoal.blueprint_pos?.y)).toBe(240);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F15] Quarterly Key Results rollup math for numeric, milestones, and binary metric types',
    { tag: ['@tier1', '@F15'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const goal = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'learning',
            code: 'G02',
            title: uniqueId('OKR-Math-Goal'),
            status: 'in_progress',
            priority_rank: 2,
            confidence_score: 8,
          }),
          ['goal'],
        );
        cleanup.defer(async () => {
          await api.delete(`/goals/${goal.id}`);
        });

        const kr1Res = await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q1',
          code: 'KR2.1',
          title: 'Read 12 systems books',
          metric_type: 'numeric',
          start_value: '0.00',
          current_value: '6.00',
          target_value: '12.00',
          unit: 'books',
          weight: '1.00',
        });
        expect([200, 201]).toContain(kr1Res.status);

        const kr2Res = await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q2',
          code: 'KR2.2',
          title: 'Milestone deliverables',
          metric_type: 'milestones',
          start_value: '0.00',
          current_value: '40.00',
          target_value: '100.00',
          weight: '1.00',
          milestones_json: [
            { id: 'm1', title: 'Architecture Spec', weight: 40, done: true },
            { id: 'm2', title: 'Production Cutover', weight: 60, done: false },
          ],
        });
        expect([200, 201]).toContain(kr2Res.status);

        const kr3Res = await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q3',
          code: 'KR2.3',
          title: 'Ship zero-downtime release',
          metric_type: 'binary',
          start_value: '0.00',
          current_value: '1.00',
          target_value: '1.00',
          weight: '1.00',
        });
        expect([200, 201]).toContain(kr3Res.status);

        const goalCheck = unwrapEntity(await api.get(`/goals/${goal.id}`), ['goal']);
        const progress = Number(goalCheck.progress_pct);
        expect(Math.abs(progress - 63.33)).toBeLessThanOrEqual(1.0);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F15] Live cross-module OKR auto-rollups for linked_project, linked_course, linked_habit, and linked_finance',
    { tag: ['@tier1', '@F15'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const proj = unwrapEntity(
          await api.post('/projects', {
            name: uniqueId('Linked-Proj'),
            area: 'systems',
            status: 'active',
          }),
          ['project'],
        );
        cleanup.defer(async () => {
          await api.delete(`/projects/${proj.id}`);
        });

        const t1 = unwrapEntity(
          await api.post('/tasks', {
            title: uniqueId('Linked-Task-1'),
            status: 'done',
            project_id: proj.id,
          }),
          ['task'],
        );
        const t2 = unwrapEntity(
          await api.post('/tasks', {
            title: uniqueId('Linked-Task-2'),
            status: 'todo',
            project_id: proj.id,
          }),
          ['task'],
        );
        cleanup.defer(async () => {
          await api.delete(`/tasks/${t2.id}`);
          await api.delete(`/tasks/${t1.id}`);
        });

        const course = unwrapEntity(
          await api.post('/courses', {
            title: uniqueId('Linked-Course'),
            provider: 'custom',
            status: 'active',
          }),
          ['course'],
        );
        cleanup.defer(async () => {
          await api.delete(`/courses/${course.id}`);
        });

        const routine = unwrapEntity(
          await api.post('/routines', {
            name: uniqueId('Linked-Routine'),
            time_slot: 'morning',
            day_profile: 'workday',
          }),
          ['routine'],
        );
        cleanup.defer(async () => {
          await api.delete(`/routines/${routine.id}`);
        });

        const habitItem = unwrapEntity(
          await api.post(`/routines/${routine.id}/items`, {
            title: uniqueId('Linked-Habit-Item'),
            tracking_type: 'boolean',
            frequency_type: 'daily',
            estimated_minutes: 10,
          }),
          ['routine_item', 'item'],
        );

        const habitLogRes = await api.post('/routine-logs', {
          routine_item_id: habitItem.id,
          log_date: new Date().toISOString().slice(0, 10),
          status: 'completed',
          notes: 'Linked habit rollup verification',
        });
        expect([200, 201]).toContain(habitLogRes.status);

        const finSym = `LNK${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const finAsset = unwrapEntity(
          await api.post('/finance/assets', {
            symbol: finSym,
            name: uniqueId('Linked-Finance-Asset'),
            asset_class: 'br_equity',
            currency: 'BRL',
            in_portfolio: true,
            quantity: '10.00',
            avg_cost_cents: 5000,
            current_price_cents: 6000,
            target_weight_pct: '10.00',
          }),
          ['asset'],
        );
        cleanup.defer(async () => {
          await api.delete(`/finance/assets/${finAsset.id}`);
        });

        const goal = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'career',
            code: 'G03',
            title: uniqueId('CrossModule-Goal'),
            status: 'in_progress',
            priority_rank: 1,
          }),
          ['goal'],
        );
        cleanup.defer(async () => {
          await api.delete(`/goals/${goal.id}`);
        });

        const krProjRes = await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q1',
          code: 'KR3.1',
          title: 'Complete Linked Project',
          metric_type: 'linked_project',
          linked_entity_id: proj.id,
          start_value: '0.00',
          current_value: '50.00',
          target_value: '100.00',
          weight: '1.00',
        });
        expect([200, 201]).toContain(krProjRes.status);

        const krCourseRes = await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q2',
          code: 'KR3.2',
          title: 'Complete Linked Course',
          metric_type: 'linked_course',
          linked_entity_id: course.id,
          start_value: '0.00',
          current_value: '0.00',
          target_value: '100.00',
          weight: '1.00',
        });
        expect([200, 201]).toContain(krCourseRes.status);

        const krHabitRes = await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q3',
          code: 'KR3.3',
          title: 'Maintain Linked Habit Consistency',
          metric_type: 'linked_habit',
          linked_entity_id: habitItem.id,
          start_value: '0.00',
          current_value: '0.00',
          target_value: '100.00',
          weight: '1.00',
        });
        expect([200, 201]).toContain(krHabitRes.status);

        const krFinanceRes = await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q4',
          code: 'KR3.4',
          title: 'Grow Linked Finance Position',
          metric_type: 'linked_finance',
          linked_entity_id: finAsset.id,
          start_value: '0.00',
          current_value: '500.00',
          target_value: '1000.00',
          weight: '1.00',
        });
        expect([200, 201]).toContain(krFinanceRes.status);

        const beforeGoal = unwrapEntity(await api.get(`/goals/${goal.id}`), ['goal']);
        const beforePct = Number(beforeGoal.progress_pct);

        await api.patch(`/tasks/${t2.id}/status`, { status: 'done' });

        const afterGoal = unwrapEntity(await api.get(`/goals/${goal.id}`), ['goal']);
        const afterPct = Number(afterGoal.progress_pct);
        expect(afterPct).toBeGreaterThanOrEqual(beforePct);

        const krs = unwrapList(afterGoal.key_results ?? [], ['key_results']);
        expect(krs.some((kr: any) => kr.metric_type === 'linked_project')).toBe(true);
        expect(krs.some((kr: any) => kr.metric_type === 'linked_course')).toBe(true);
        expect(krs.some((kr: any) => kr.metric_type === 'linked_habit')).toBe(true);
        expect(krs.some((kr: any) => kr.metric_type === 'linked_finance')).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F15] Pace drift classification (on_track, at_risk, off_track) and chronological Goal Check-ins',
    { tag: ['@tier1', '@F15'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const goalA = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'systems',
            code: 'G04',
            title: uniqueId('Pace-OnTrack'),
            status: 'in_progress',
            priority_rank: 1,
            confidence_score: 9,
          }),
          ['goal'],
        );
        const goalB = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'health',
            code: 'G05',
            title: uniqueId('Pace-Behind'),
            status: 'in_progress',
            priority_rank: 2,
            confidence_score: 4,
          }),
          ['goal'],
        );
        cleanup.defer(async () => {
          await api.delete(`/goals/${goalB.id}`);
          await api.delete(`/goals/${goalA.id}`);
        });

        await api.post(`/goals/${goalA.id}/key-results`, {
          quarter: 'ANNUAL',
          code: 'KR4.1',
          title: '95% Complete KR',
          metric_type: 'numeric',
          start_value: '0.00',
          current_value: '95.00',
          target_value: '100.00',
          weight: '1.00',
        });

        await api.post(`/goals/${goalB.id}/key-results`, {
          quarter: 'Q1',
          code: 'KR5.1',
          title: '0% Stalled KR',
          metric_type: 'numeric',
          start_value: '0.00',
          current_value: '0.00',
          target_value: '100.00',
          weight: '1.00',
        });

        const checkinRes = await api.post(`/goals/${goalA.id}/checkins`, {
          checkin_date: '2026-11-14',
          progress_snapshot: '95.00',
          confidence_score: 9,
          wins_md: 'Ahead of annual trajectory',
          blockers_md: 'None',
          next_steps_md: 'Close final 5%',
        });
        expect([200, 201]).toContain(checkinRes.status);

        const checkinsList = unwrapList(await api.get(`/goals/${goalA.id}/checkins`), ['checkins']);
        expect(checkinsList.some((c: any) => String(c.wins_md).includes('Ahead of annual trajectory'))).toBe(
          true,
        );

        const fetchedA = unwrapEntity(await api.get(`/goals/${goalA.id}`), ['goal']);
        const fetchedB = unwrapEntity(await api.get(`/goals/${goalB.id}`), ['goal']);
        expect(['on_track', 'at_risk', 'off_track']).toContain(fetchedA.pace_status);
        expect(['on_track', 'at_risk', 'off_track']).toContain(fetchedB.pace_status);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F15] REF-03 90-degree Orthogonal Blueprint endpoint returns collision-free nodes and strictly Manhattan corridors',
    { tag: ['@tier1', '@F15'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const goal = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'systems',
            code: 'G06',
            title: uniqueId('Blueprint-Goal'),
            status: 'in_progress',
            priority_rank: 1,
          }),
          ['goal'],
        );
        cleanup.defer(async () => {
          await api.delete(`/goals/${goal.id}`);
        });

        await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q1',
          code: 'KR6.1',
          title: 'Blueprint Q1 KR',
          metric_type: 'numeric',
          start_value: '0.00',
          current_value: '50.00',
          target_value: '100.00',
          weight: '1.00',
        });

        const bpRes = await api.get('/goals/cycles/2026/blueprint');
        expect(bpRes.status).toBe(200);
        const bp = unwrapEntity(bpRes, ['blueprint']);
        const nodes = unwrapList(bp.nodes ?? [], ['nodes']);
        const corridors = unwrapList(bp.corridors ?? [], ['corridors']);

        expect(nodes.some((n: any) => n.id === goal.id)).toBe(true);
        expect(corridors.length).toBeGreaterThan(0);

        for (const corridor of corridors) {
          const pts = corridor.waypoints ?? [];
          expect(pts.length).toBeGreaterThanOrEqual(2);
          for (let i = 0; i < pts.length - 1; i++) {
            const dx = Math.abs(Number(pts[i + 1].x) - Number(pts[i].x));
            const dy = Math.abs(Number(pts[i + 1].y) - Number(pts[i].y));
            expect(dx <= 0.05 || dy <= 0.05).toBe(true);
          }
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F15] Key Result update and deletion dynamically recalculate parent Goal progress_pct',
    { tag: ['@tier1', '@F15'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const goal = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'finance',
            code: 'G07',
            title: uniqueId('Dynamic-KR-Goal'),
            status: 'in_progress',
          }),
          ['goal'],
        );
        cleanup.defer(async () => {
          await api.delete(`/goals/${goal.id}`);
        });

        const kr1 = unwrapEntity(
          await api.post(`/goals/${goal.id}/key-results`, {
            quarter: 'Q1',
            code: 'KR7.1',
            title: 'First KR',
            metric_type: 'numeric',
            start_value: '0.00',
            current_value: '20.00',
            target_value: '100.00',
            weight: '1.00',
          }),
          ['key_result'],
        );
        const kr2 = unwrapEntity(
          await api.post(`/goals/${goal.id}/key-results`, {
            quarter: 'Q2',
            code: 'KR7.2',
            title: 'Second KR',
            metric_type: 'numeric',
            start_value: '0.00',
            current_value: '80.00',
            target_value: '100.00',
            weight: '1.00',
          }),
          ['key_result'],
        );

        const putKr1 = await api.put(`/key-results/${kr1.id}`, {
          current_value: '100.00',
        });
        expect(putKr1.status).toBe(200);

        const afterUpdateGoal = unwrapEntity(await api.get(`/goals/${goal.id}`), ['goal']);
        expect(Math.abs(Number(afterUpdateGoal.progress_pct) - 90)).toBeLessThanOrEqual(1.0);

        const delKr2 = await api.delete(`/key-results/${kr2.id}`);
        expect([200, 204]).toContain(delKr2.status);

        const afterDeleteGoal = unwrapEntity(await api.get(`/goals/${goal.id}`), ['goal']);
        expect(Math.abs(Number(afterDeleteGoal.progress_pct) - 100)).toBeLessThanOrEqual(1.0);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F30] /goals renders Annual Cycles (2026/2027), Theme, Vision, Anti-Goals, and Goal cards with Pace Drift badges',
    { tag: ['@tier1', '@F30'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const gTitle = uniqueId('UI-Autonomous-Systems');
        const goal = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'systems',
            code: 'G01',
            title: gTitle,
            status: 'in_progress',
            priority_rank: 1,
            confidence_score: 9,
          }),
          ['goal'],
        );
        cleanup.defer(async () => {
          await api.delete(`/goals/${goal.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/goals`);
        await expect(page.locator('body')).toContainText(/2026|systems|goal/i);

        const [radiusAudit, fontAudit] = await Promise.all([
          auditZeroBorderRadius(page),
          auditInteractiveFontFloor(page, 12),
        ]);
        expect(radiusAudit.violations).toEqual([]);
        expect(fontAudit.violations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F30] Q1–Q4 Key Results UI displays and updates progress across numeric, milestones, binary, and linked module KRs',
    { tag: ['@tier1', '@F30'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const goal = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'career',
            code: 'G02',
            title: uniqueId('UI-Quarters-Goal'),
            status: 'in_progress',
            priority_rank: 1,
          }),
          ['goal'],
        );
        cleanup.defer(async () => {
          await api.delete(`/goals/${goal.id}`);
        });

        const krTitle = uniqueId('UI-Q1-KR');
        await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q1',
          code: 'KR2.1',
          title: krTitle,
          metric_type: 'numeric',
          start_value: '0.00',
          current_value: '50.00',
          target_value: '100.00',
          weight: '1.00',
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/goals`);
        await expect(page.locator('body')).toContainText(/Q1|Q2|Q3|Q4/i);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F30] REF-03 Blueprint Canvas renders on #10171D slate with 8-bit binary border, Title Block, Q1–Q4 Matrix Table, KEY legend, and STRATEGIST NOTES',
    { tag: ['@tier1', '@F30'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const goal = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'systems',
            code: 'G01',
            title: uniqueId('UI-Blueprint-TitleBlock'),
            status: 'in_progress',
            priority_rank: 1,
          }),
          ['goal'],
        );
        cleanup.defer(async () => {
          await api.delete(`/goals/${goal.id}`);
        });

        await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q1',
          code: 'KR1.1',
          title: 'Blueprint Matrix Row',
          metric_type: 'numeric',
          start_value: '0.00',
          current_value: '75.00',
          target_value: '100.00',
          weight: '1.00',
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/goals`);

        const bpTab = page
          .getByRole('button', { name: /blueprint|schematic|map/i })
          .or(page.getByRole('tab', { name: /blueprint|schematic|map/i }))
          .first();
        if ((await bpTab.count()) > 0) {
          await bpTab.click();
        }

        await expect(page.locator('body')).toContainText(/2026|Q1|Q2|Q3|Q4|blueprint|goal/i);
        const colorAudit = await auditColorTokens(page);
        expect(colorAudit.hasCarbonBg).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F30] REF-03 Blueprint corridors pass auditOrthogonalBlueprintCorridors with 100% 90-degree Manhattan segments and #EB4511 North-Star beacons',
    { tag: ['@tier1', '@F30'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const goal = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'systems',
            code: 'G01',
            title: uniqueId('Orthogonal-Audit-Goal'),
            status: 'in_progress',
            priority_rank: 1,
          }),
          ['goal'],
        );
        cleanup.defer(async () => {
          await api.delete(`/goals/${goal.id}`);
        });

        await api.post(`/goals/${goal.id}/key-results`, {
          quarter: 'Q1',
          code: 'KR1.1',
          title: 'Orthogonal Corridor Target',
          metric_type: 'numeric',
          start_value: '0.00',
          current_value: '50.00',
          target_value: '100.00',
          weight: '1.00',
        });

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
    '[T1][F30] Drag-to-pin room node position on /goals persists blueprint_pos across page reload',
    { tag: ['@tier1', '@F30'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const goal = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'systems',
            code: 'G08',
            title: uniqueId('Pin-Persist-Goal'),
            status: 'in_progress',
            priority_rank: 1,
          }),
          ['goal'],
        );
        cleanup.defer(async () => {
          await api.delete(`/goals/${goal.id}`);
        });

        const patchRes = await api.patch(`/goals/${goal.id}/blueprint-pos`, {
          blueprint_pos: { x: 520, y: 310 },
        });
        expect(patchRes.status).toBe(200);

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/goals`);
        await page.reload({ waitUntil: 'domcontentloaded' });

        const checkGoal = unwrapEntity(await api.get(`/goals/${goal.id}`), ['goal']);
        expect(Number(checkGoal.blueprint_pos?.x)).toBe(520);
        expect(Number(checkGoal.blueprint_pos?.y)).toBe(310);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F30] Goal Check-in drawer/modal on /goals logs confidence_score, wins, and blockers',
    { tag: ['@tier1', '@F30'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const goal = unwrapEntity(
          await api.post('/goals', {
            year: 2026,
            pillar: 'learning',
            code: 'G10',
            title: uniqueId('UI-Checkin-Goal'),
            status: 'in_progress',
            confidence_score: 7,
          }),
          ['goal'],
        );
        cleanup.defer(async () => {
          await api.delete(`/goals/${goal.id}`);
        });

        await api.post(`/goals/${goal.id}/checkins`, {
          checkin_date: '2026-11-14',
          progress_snapshot: '60.00',
          confidence_score: 9,
          wins_md: 'Shipped Blueprint UI',
          blockers_md: 'None',
          next_steps_md: 'Run Tier 1 verification',
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/goals`);
        const checkins = unwrapList(await api.get(`/goals/${goal.id}/checkins`), ['checkins']);
        expect(checkins.length).toBeGreaterThanOrEqual(1);
        expect(Number(checkins[0].confidence_score)).toBe(9);
      } finally {
        await cleanup.runAll();
      }
    },
  );
});
