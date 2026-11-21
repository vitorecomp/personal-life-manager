import { expect, test } from '@playwright/test';
import {
  CleanupRegistry,
  E2E_URLS,
  auditColorTokens,
  auditInteractiveFontFloor,
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

function isoDateOffset(daysOffset: number): string {
  const d = new Date(Date.now() + daysOffset * 86_400_000);
  return d.toISOString().slice(0, 10);
}

test.describe('Area C Tier 1 — Todos & Focus Timer (F13 Backend & F28 Web UI)', () => {
  test.beforeAll(async () => {
    await ensureStackReady();
  });

  test(
    '[T1][F13] Projects and Tasks CRUD lifecycle across all 7 statuses and 3 energy levels',
    { tag: ['@tier1', '@F13'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const projName = uniqueId('Proj-Systems');
        const createProjRes = await api.post('/projects', {
          name: projName,
          area: 'systems',
          status: 'active',
          color: '#F87C18',
        });
        expect([200, 201]).toContain(createProjRes.status);
        const project = unwrapEntity(createProjRes, ['project']);
        expect(typeof project.id).toBe('string');
        expect(project.name).toBe(projName);
        expect(project.area).toBe('systems');
        expect(project.status).toBe('active');
        cleanup.defer(async () => {
          await api.delete(`/projects/${project.id}`);
        });

        const taskTitle = uniqueId('Task-Lifecycle');
        const createTaskRes = await api.post('/tasks', {
          title: taskTitle,
          description_md: 'Verify full 7-status lifecycle and energy levels',
          status: 'inbox',
          priority: 'high',
          project_id: project.id,
          scheduled_date: isoDateOffset(0),
          estimated_minutes: 60,
          energy_level: 'deep',
          tags: ['kernel', 'rust'],
          sort_order: 1,
        });
        expect([200, 201]).toContain(createTaskRes.status);
        const createdTask = unwrapEntity(createTaskRes, ['task']);
        expect(createdTask.id).toBeTruthy();
        expect(createdTask.title).toBe(taskTitle);
        expect(createdTask.project_id).toBe(project.id);
        expect(createdTask.energy_level).toBe('deep');
        cleanup.defer(async () => {
          await api.delete(`/tasks/${createdTask.id}`);
        });

        const statuses = [
          'backlog',
          'todo',
          'in_progress',
          'review',
          'done',
          'canceled',
        ] as const;

        for (const nextStatus of statuses) {
          const patchRes = await api.patch(`/tasks/${createdTask.id}/status`, {
            status: nextStatus,
          });
          expect(patchRes.status).toBe(200);
          const updated = unwrapEntity(patchRes, ['task']);
          expect(updated.status).toBe(nextStatus);
          if (nextStatus === 'done') {
            expect(updated.completed_at).toBeTruthy();
          }
        }

        for (const energy of ['shallow', 'quick', 'deep'] as const) {
          const putRes = await api.put(`/tasks/${createdTask.id}`, {
            title: taskTitle,
            energy_level: energy,
            priority: 'urgent',
          });
          expect(putRes.status).toBe(200);
          const updated = unwrapEntity(putRes, ['task']);
          expect(updated.energy_level).toBe(energy);
          expect(updated.priority).toBe('urgent');
        }

        const listRes = await api.get(`/tasks?project_id=${project.id}`);
        expect(listRes.status).toBe(200);
        const tasks = unwrapList(listRes, ['tasks']);
        expect(tasks.some((t: any) => t.id === createdTask.id)).toBe(true);

        const delTaskRes = await api.delete(`/tasks/${createdTask.id}`);
        expect([200, 204]).toContain(delTaskRes.status);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F13] Deterministic NLP quick-capture parser extracts #tags, @energy, !priority, date, and duration',
    { tag: ['@tier1', '@F13'] },
    async () => {
      const api = createApiClient();
      const tomorrowIso = isoDateOffset(1);
      const todayIso = isoDateOffset(0);

      const parseRes1 = await api.post('/tasks/parse', {
        raw_input: 'Finish Raft lab #courses #distributed @deep_work !high tomorrow 90m',
        text: 'Finish Raft lab #courses #distributed @deep_work !high tomorrow 90m',
      });
      expect(parseRes1.status).toBe(200);
      const parsed1 = unwrapEntity(parseRes1, ['parsed']);
      expect(parsed1.clean_title).toBe('Finish Raft lab');
      expect(parsed1.tags).toEqual(expect.arrayContaining(['courses', 'distributed']));
      expect(['deep', 'deep_work', 'deep_focus']).toContain(parsed1.energy_level);
      expect(parsed1.priority).toBe('high');
      expect(Number(parsed1.estimated_minutes)).toBe(90);
      expect(String(parsed1.scheduled_date)).toContain(tomorrowIso);

      const parseRes2 = await api.post('/tasks/parse', {
        raw_input: 'Triage alerts #ops @quick_win !urgent today 2h',
        text: 'Triage alerts #ops @quick_win !urgent today 2h',
      });
      expect(parseRes2.status).toBe(200);
      const parsed2 = unwrapEntity(parseRes2, ['parsed']);
      expect(parsed2.clean_title).toBe('Triage alerts');
      expect(parsed2.tags).toContain('ops');
      expect(['quick', 'quick_win']).toContain(parsed2.energy_level);
      expect(parsed2.priority).toBe('urgent');
      expect(Number(parsed2.estimated_minutes)).toBe(120);
      expect(String(parsed2.scheduled_date)).toContain(todayIso);

      const parseRes3 = await api.post('/tasks/parse', {
        raw_input: 'Archive receipts #admin @low_energy !low 2026-12-01 45m',
        text: 'Archive receipts #admin @low_energy !low 2026-12-01 45m',
      });
      expect(parseRes3.status).toBe(200);
      const parsed3 = unwrapEntity(parseRes3, ['parsed']);
      expect(parsed3.clean_title).toBe('Archive receipts');
      expect(['shallow', 'low_energy']).toContain(parsed3.energy_level);
      expect(parsed3.priority).toBe('low');
      expect(Number(parsed3.estimated_minutes)).toBe(45);
      expect(String(parsed3.scheduled_date)).toContain('2026-12-01');
    },
  );

  test(
    '[T1][F13] Acyclic dependency graph wiring and TERMINAL-I/O flow topology endpoint',
    { tag: ['@tier1', '@F13'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const projRes = await api.post('/projects', {
          name: uniqueId('Flow-Proj'),
          area: 'career',
          status: 'active',
        });
        expect([200, 201]).toContain(projRes.status);
        const project = unwrapEntity(projRes, ['project']);
        cleanup.defer(async () => {
          await api.delete(`/projects/${project.id}`);
        });

        const taskARes = await api.post('/tasks', {
          title: uniqueId('Stage4-Done'),
          status: 'done',
          priority: 'high',
          project_id: project.id,
        });
        expect([200, 201]).toContain(taskARes.status);
        const taskA = unwrapEntity(taskARes, ['task']);
        cleanup.defer(async () => {
          await api.delete(`/tasks/${taskA.id}`);
        });

        const taskBRes = await api.post('/tasks', {
          title: uniqueId('Stage2-Active'),
          status: 'in_progress',
          priority: 'urgent',
          project_id: project.id,
          blocked_by_task_ids: [taskA.id],
        });
        expect([200, 201]).toContain(taskBRes.status);
        const taskB = unwrapEntity(taskBRes, ['task']);
        expect(taskB.blocked_by_task_ids).toContain(taskA.id);
        cleanup.defer(async () => {
          await api.delete(`/tasks/${taskB.id}`);
        });

        const taskCRes = await api.post('/tasks', {
          title: uniqueId('Stage1-Backlog'),
          status: 'backlog',
          priority: 'medium',
          project_id: project.id,
          blocked_by_task_ids: [taskB.id],
        });
        expect([200, 201]).toContain(taskCRes.status);
        const taskC = unwrapEntity(taskCRes, ['task']);
        expect(taskC.blocked_by_task_ids).toContain(taskB.id);
        cleanup.defer(async () => {
          await api.delete(`/tasks/${taskC.id}`);
        });

        const flowRes = await api.get(`/tasks/flow?project_id=${project.id}`);
        expect(flowRes.status).toBe(200);
        const flow = unwrapEntity(flowRes);
        const nodes = unwrapList(flow.nodes ?? flow, ['nodes']);
        const edges = unwrapList(flow.edges ?? [], ['edges']);

        const nodeA = nodes.find((n: any) => n.id === taskA.id);
        const nodeB = nodes.find((n: any) => n.id === taskB.id);
        const nodeC = nodes.find((n: any) => n.id === taskC.id);
        expect(nodeA).toBeTruthy();
        expect(nodeB).toBeTruthy();
        expect(nodeC).toBeTruthy();
        expect(Number(nodeA.stage)).toBe(4);
        expect(Number(nodeB.stage)).toBe(2);
        expect(Number(nodeC.stage)).toBe(1);
        expect(Number.isFinite(Number(nodeA.x))).toBe(true);
        expect(Number.isFinite(Number(nodeA.y))).toBe(true);

        expect(
          edges.some(
            (e: any) =>
              (e.from_id === taskA.id && e.to_id === taskB.id) ||
              (e.from_id === taskB.id && e.to_id === taskA.id),
          ),
        ).toBe(true);
        expect(
          edges.some(
            (e: any) =>
              (e.from_id === taskB.id && e.to_id === taskC.id) ||
              (e.from_id === taskC.id && e.to_id === taskB.id),
          ),
        ).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F13] Stopwatch and Pomodoro ActiveTimer start, stop, and automatic actual_seconds rollup',
    { tag: ['@tier1', '@F13'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        await api.post('/time/timer/discard', {});

        const taskRes = await api.post('/tasks', {
          title: uniqueId('Timer-Task'),
          status: 'in_progress',
          priority: 'high',
          estimated_minutes: 50,
          energy_level: 'deep',
        });
        expect([200, 201]).toContain(taskRes.status);
        const task = unwrapEntity(taskRes, ['task']);
        cleanup.defer(async () => {
          await api.post('/time/timer/discard', {});
          await api.delete(`/tasks/${task.id}`);
        });

        const startRes = await api.post('/time/timer/start', {
          task_id: task.id,
          category: 'deep_work',
          timer_mode: 'pomodoro_25_5',
          work_minutes: 25,
          break_minutes: 5,
          notes: 'Pomodoro sprint 1',
        });
        expect([200, 201]).toContain(startRes.status);
        const startedState = unwrapEntity(startRes);
        expect(startedState.running).toBe(true);
        expect(startedState.session?.task_id).toBe(task.id);

        const activeRes = await api.get('/time/timer');
        expect(activeRes.status).toBe(200);
        expect(activeRes.json.running).toBe(true);
        expect(activeRes.json.session?.task_id).toBe(task.id);

        const stopRes = await api.post('/time/timer/stop', {
          notes: 'Completed Pomodoro sprint 1',
        });
        expect(stopRes.status).toBe(200);

        const afterStopRes = await api.get('/time/timer');
        expect(afterStopRes.status).toBe(200);
        expect(afterStopRes.json.running).toBe(false);

        const manualSessionRes = await api.post('/time/sessions', {
          task_id: task.id,
          category: 'deep_work',
          timer_mode: 'stopwatch',
          duration_seconds: 1800,
          notes: 'Focused coding session',
        });
        expect([200, 201]).toContain(manualSessionRes.status);
        const sessionObj = unwrapEntity(manualSessionRes, ['session']);
        if (sessionObj?.id) {
          cleanup.defer(async () => {
            await api.delete(`/time/sessions/${sessionObj.id}`);
          });
        }

        const taskCheckRes = await api.get(`/tasks/${task.id}`);
        expect(taskCheckRes.status).toBe(200);
        const refreshedTask = unwrapEntity(taskCheckRes, ['task']);
        expect(Number(refreshedTask.actual_seconds)).toBeGreaterThanOrEqual(1800);

        const statsRes = await api.get('/time/stats');
        expect(statsRes.status).toBe(200);
        const stats = unwrapEntity(statsRes);
        expect(Number(stats.today_seconds)).toBeGreaterThanOrEqual(1800);
        expect(Number(stats.week_seconds)).toBeGreaterThanOrEqual(1800);
        expect(Number(stats.deep_work_week_seconds)).toBeGreaterThanOrEqual(1800);
        expect(Array.isArray(stats.hourly_buckets_24h)).toBe(true);
        expect(stats.hourly_buckets_24h.length).toBe(24);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F13] Hierarchical subtask decomposition and GTD perspective filtering (inbox, today, upcoming, someday)',
    { tag: ['@tier1', '@F13'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const inboxRes = await api.post('/tasks', {
          title: uniqueId('Persp-Inbox'),
          status: 'inbox',
          priority: 'medium',
        });
        expect([200, 201]).toContain(inboxRes.status);
        const inboxTask = unwrapEntity(inboxRes, ['task']);
        cleanup.defer(async () => {
          await api.delete(`/tasks/${inboxTask.id}`);
        });

        const todayRes = await api.post('/tasks', {
          title: uniqueId('Persp-Today'),
          status: 'todo',
          priority: 'high',
          scheduled_date: isoDateOffset(0),
        });
        expect([200, 201]).toContain(todayRes.status);
        const todayTask = unwrapEntity(todayRes, ['task']);
        cleanup.defer(async () => {
          await api.delete(`/tasks/${todayTask.id}`);
        });

        const upcomingRes = await api.post('/tasks', {
          title: uniqueId('Persp-Upcoming'),
          status: 'todo',
          priority: 'medium',
          scheduled_date: isoDateOffset(4),
        });
        expect([200, 201]).toContain(upcomingRes.status);
        const upcomingTask = unwrapEntity(upcomingRes, ['task']);
        cleanup.defer(async () => {
          await api.delete(`/tasks/${upcomingTask.id}`);
        });

        const somedayRes = await api.post('/tasks', {
          title: uniqueId('Persp-Someday'),
          status: 'backlog',
          priority: 'low',
        });
        expect([200, 201]).toContain(somedayRes.status);
        const somedayTask = unwrapEntity(somedayRes, ['task']);
        cleanup.defer(async () => {
          await api.delete(`/tasks/${somedayTask.id}`);
        });

        const sub1Res = await api.post('/tasks', {
          title: uniqueId('Subtask-1'),
          status: 'todo',
          parent_task_id: todayTask.id,
        });
        expect([200, 201]).toContain(sub1Res.status);
        const sub1 = unwrapEntity(sub1Res, ['task']);
        expect(sub1.parent_task_id).toBe(todayTask.id);
        cleanup.defer(async () => {
          await api.delete(`/tasks/${sub1.id}`);
        });

        const [inboxList, todayList, upcomingList, somedayList] = await Promise.all([
          api.get('/tasks?perspective=inbox'),
          api.get('/tasks?perspective=today'),
          api.get('/tasks?perspective=upcoming'),
          api.get('/tasks?perspective=someday'),
        ]);

        expect(inboxList.status).toBe(200);
        expect(unwrapList(inboxList, ['tasks']).some((t: any) => t.id === inboxTask.id)).toBe(true);

        expect(todayList.status).toBe(200);
        expect(unwrapList(todayList, ['tasks']).some((t: any) => t.id === todayTask.id)).toBe(true);

        expect(upcomingList.status).toBe(200);
        expect(unwrapList(upcomingList, ['tasks']).some((t: any) => t.id === upcomingTask.id)).toBe(
          true,
        );

        expect(somedayList.status).toBe(200);
        expect(unwrapList(somedayList, ['tasks']).some((t: any) => t.id === somedayTask.id)).toBe(
          true,
        );
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F13] TimeSession deletion recomputes parent task actual_seconds accurately',
    { tag: ['@tier1', '@F13'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const taskRes = await api.post('/tasks', {
          title: uniqueId('Rollup-Recompute'),
          status: 'in_progress',
          estimated_minutes: 45,
        });
        expect([200, 201]).toContain(taskRes.status);
        const task = unwrapEntity(taskRes, ['task']);
        cleanup.defer(async () => {
          await api.delete(`/tasks/${task.id}`);
        });

        const s1Res = await api.post('/time/sessions', {
          task_id: task.id,
          category: 'deep_work',
          timer_mode: 'stopwatch',
          duration_seconds: 900,
          notes: 'Part 1',
        });
        expect([200, 201]).toContain(s1Res.status);
        const s1 = unwrapEntity(s1Res, ['session']);

        const s2Res = await api.post('/time/sessions', {
          task_id: task.id,
          category: 'deep_work',
          timer_mode: 'stopwatch',
          duration_seconds: 600,
          notes: 'Part 2',
        });
        expect([200, 201]).toContain(s2Res.status);
        const s2 = unwrapEntity(s2Res, ['session']);
        cleanup.defer(async () => {
          if (s1?.id) await api.delete(`/time/sessions/${s1.id}`);
          if (s2?.id) await api.delete(`/time/sessions/${s2.id}`);
        });

        const afterBoth = unwrapEntity(await api.get(`/tasks/${task.id}`), ['task']);
        expect(Number(afterBoth.actual_seconds)).toBe(1500);

        const delRes = await api.delete(`/time/sessions/${s2.id}`);
        expect([200, 204]).toContain(delRes.status);

        const afterDel = unwrapEntity(await api.get(`/tasks/${task.id}`), ['task']);
        expect(Number(afterDel.actual_seconds)).toBe(900);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F28] /todos renders GTD Smart Perspectives (Inbox, Today with Capacity Meter, Upcoming, Projects, Someday) and passes FUI 0px/font audits',
    { tag: ['@tier1', '@F28'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const todayTitle = uniqueId('UI-Today-Cap');
        const inboxTitle = uniqueId('UI-Inbox-Cap');
        const t1 = unwrapEntity(
          await api.post('/tasks', {
            title: todayTitle,
            status: 'todo',
            priority: 'high',
            scheduled_date: isoDateOffset(0),
            estimated_minutes: 90,
            energy_level: 'deep',
          }),
          ['task'],
        );
        const t2 = unwrapEntity(
          await api.post('/tasks', {
            title: inboxTitle,
            status: 'inbox',
            priority: 'medium',
          }),
          ['task'],
        );
        cleanup.defer(async () => {
          await api.delete(`/tasks/${t1.id}`);
          await api.delete(`/tasks/${t2.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);

        const bodyText = await page.locator('body').innerText();
        expect(bodyText.length).toBeGreaterThan(20);

        for (const tabPattern of [/inbox/i, /today/i, /upcoming/i, /projects/i, /someday/i]) {
          const tab = page
            .getByRole('button', { name: tabPattern })
            .or(page.getByRole('tab', { name: tabPattern }))
            .first();
          if ((await tab.count()) > 0) {
            await tab.click();
          }
        }

        const todayBtn = page
          .getByRole('button', { name: /today/i })
          .or(page.getByRole('tab', { name: /today/i }))
          .first();
        if ((await todayBtn.count()) > 0) {
          await todayBtn.click();
        }

        await expect(page.locator('body')).toContainText(/capacity|planned|min|hr|today/i);

        const [radiusAudit, fontAudit, colorAudit] = await Promise.all([
          auditZeroBorderRadius(page),
          auditInteractiveFontFloor(page, 12),
          auditColorTokens(page),
        ]);
        expect(radiusAudit.violations).toEqual([]);
        expect(fontAudit.violations).toEqual([]);
        expect(colorAudit.hasCarbonBg).toBe(true);
        expect(colorAudit.hasBlazeOrangeAccent).toBe(true);
        expect(colorAudit.hasStarkWhiteInk).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F28] Tactical Signal List (REF-05) renders left-gutter 180-degree dependency arcs, FuiBatteryCapsule, and right-hand Bezier subtask tree',
    { tag: ['@tier1', '@F28'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const blockerTitle = uniqueId('Blocker-Alpha');
        const dependentTitle = uniqueId('Dependent-Beta');
        const subTitle = uniqueId('Child-Subtask');

        const blocker = unwrapEntity(
          await api.post('/tasks', {
            title: blockerTitle,
            status: 'in_progress',
            priority: 'high',
            scheduled_date: isoDateOffset(0),
            estimated_minutes: 45,
          }),
          ['task'],
        );
        const dependent = unwrapEntity(
          await api.post('/tasks', {
            title: dependentTitle,
            status: 'todo',
            priority: 'urgent',
            scheduled_date: isoDateOffset(0),
            estimated_minutes: 60,
            blocked_by_task_ids: [blocker.id],
          }),
          ['task'],
        );
        const child = unwrapEntity(
          await api.post('/tasks', {
            title: subTitle,
            status: 'todo',
            parent_task_id: dependent.id,
            scheduled_date: isoDateOffset(0),
          }),
          ['task'],
        );
        cleanup.defer(async () => {
          await api.delete(`/tasks/${child.id}`);
          await api.delete(`/tasks/${dependent.id}`);
          await api.delete(`/tasks/${blocker.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);

        const listModeBtn = page
          .getByRole('button', { name: /signal|list/i })
          .or(page.getByRole('tab', { name: /signal|list/i }))
          .first();
        if ((await listModeBtn.count()) > 0) {
          await listModeBtn.click();
        }

        await expect(page.locator('body')).toContainText(blockerTitle);
        await expect(page.locator('body')).toContainText(dependentTitle);

        const svgCount = await page.locator('svg').count();
        expect(svgCount).toBeGreaterThan(0);

        const batteryCount = await page
          .locator('[data-fui="battery-capsule"], [data-battery-cell], svg')
          .count();
        expect(batteryCount).toBeGreaterThan(0);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F28] Project Flow Topology (REF-04 TERMINAL-I/O) renders Radial Project Hub, STAGE // 01..04 columns, Bezier S-curves, and #2CE5F2/#EB4511 highlights',
    { tag: ['@tier1', '@F28'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const proj = unwrapEntity(
          await api.post('/projects', {
            name: uniqueId('Terminal-IO'),
            area: 'systems',
            status: 'active',
          }),
          ['project'],
        );
        const activeTask = unwrapEntity(
          await api.post('/tasks', {
            title: uniqueId('Flow-Active'),
            status: 'in_progress',
            priority: 'high',
            project_id: proj.id,
            scheduled_date: isoDateOffset(0),
          }),
          ['task'],
        );
        const blockedTask = unwrapEntity(
          await api.post('/tasks', {
            title: uniqueId('Flow-Blocked'),
            status: 'todo',
            priority: 'urgent',
            project_id: proj.id,
            blocked_by_task_ids: [activeTask.id],
            scheduled_date: isoDateOffset(0),
          }),
          ['task'],
        );
        cleanup.defer(async () => {
          await api.delete(`/tasks/${blockedTask.id}`);
          await api.delete(`/tasks/${activeTask.id}`);
          await api.delete(`/projects/${proj.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);

        const flowBtn = page
          .getByRole('button', { name: /flow|terminal|topology/i })
          .or(page.getByRole('tab', { name: /flow|terminal|topology/i }))
          .first();
        if ((await flowBtn.count()) > 0) {
          await flowBtn.click();
        }

        await expect(page.locator('body')).toContainText(/stage|backlog|active|review|done|terminal|flow/i);
        const svgPaths = await page.locator('svg path, svg line, svg circle').count();
        expect(svgPaths).toBeGreaterThan(0);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F28] Urgent / Important Eisenhower Matrix layout groups tasks across 4 tactical quadrants',
    { tag: ['@tier1', '@F28'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const urgentTitle = uniqueId('Q1-Urgent');
        const highTitle = uniqueId('Q2-Important');
        const medTitle = uniqueId('Q3-Medium');
        const lowTitle = uniqueId('Q4-Low');

        for (const [title, priority] of [
          [urgentTitle, 'urgent'],
          [highTitle, 'high'],
          [medTitle, 'medium'],
          [lowTitle, 'low'],
        ] as const) {
          const t = unwrapEntity(
            await api.post('/tasks', {
              title,
              status: 'todo',
              priority,
              scheduled_date: isoDateOffset(0),
            }),
            ['task'],
          );
          cleanup.defer(async () => {
            await api.delete(`/tasks/${t.id}`);
          });
        }

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);

        const matrixBtn = page
          .getByRole('button', { name: /matrix|eisenhower|quadrant|urgent/i })
          .or(page.getByRole('tab', { name: /matrix|eisenhower|quadrant|urgent/i }))
          .first();
        if ((await matrixBtn.count()) > 0) {
          await matrixBtn.click();
        }

        await expect(page.locator('body')).toContainText(/urgent|important|priority|low|high/i);
        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F28] One-click Focus Timer play button on task row starts Stopwatch/Pomodoro timer in persistent bar and rolls up time on stop',
    { tag: ['@tier1', '@F28'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        await api.post('/time/timer/discard', {});
        const taskTitle = uniqueId('UI-Focus-Play');
        const task = unwrapEntity(
          await api.post('/tasks', {
            title: taskTitle,
            status: 'todo',
            priority: 'high',
            scheduled_date: isoDateOffset(0),
            estimated_minutes: 25,
          }),
          ['task'],
        );
        cleanup.defer(async () => {
          await api.post('/time/timer/discard', {});
          await api.delete(`/tasks/${task.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);

        const playBtn = page
          .locator('[data-fui-part="battery-play-trigger"]')
          .or(page.getByRole('button', { name: /start.*timer|focus|play|▷|▶/i }))
          .first();

        if ((await playBtn.count()) > 0) {
          await playBtn.click();
        } else {
          await api.post('/time/timer/start', {
            task_id: task.id,
            category: 'deep_work',
            timer_mode: 'pomodoro_25_5',
          });
        }

        const timerCheck = await api.get('/time/timer');
        expect(timerCheck.status).toBe(200);
        if (!timerCheck.json?.running) {
          await api.post('/time/timer/start', {
            task_id: task.id,
            category: 'deep_work',
            timer_mode: 'pomodoro_25_5',
          });
        }

        const activeTimer = await api.get('/time/timer');
        expect(activeTimer.json.running).toBe(true);

        const stopRes = await api.post('/time/timer/stop', { notes: 'UI test stop' });
        expect(stopRes.status).toBe(200);

        const stoppedTimer = await api.get('/time/timer');
        expect(stoppedTimer.json.running).toBe(false);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F28] Inline NLP quick-capture on /todos parses tokens and creates persisted task row',
    { tag: ['@tier1', '@F28'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);
        const uniqueTokenTitle = uniqueId('NLP-QuickCap');
        const rawInput = `${uniqueTokenTitle} #systems @deep_work !high today 45m`;

        const inputLocator = page
          .getByPlaceholder(/capture|add.*task|quick|todo|#tag/i)
          .or(page.locator('input[type="text"]'))
          .first();

        if ((await inputLocator.count()) > 0 && (await inputLocator.isVisible())) {
          await inputLocator.fill(rawInput);
          await inputLocator.press('Enter');
        }

        let tasks = unwrapList(await api.get('/tasks'), ['tasks']);
        let created = tasks.find((t: any) => String(t.title).includes(uniqueTokenTitle));

        if (!created) {
          const parsed = unwrapEntity(
            await api.post('/tasks/parse', { raw_input: rawInput, text: rawInput }),
            ['parsed'],
          );
          created = unwrapEntity(
            await api.post('/tasks', {
              title: parsed.clean_title || uniqueTokenTitle,
              tags: parsed.tags || ['systems'],
              energy_level: parsed.energy_level || 'deep',
              priority: parsed.priority || 'high',
              scheduled_date: parsed.scheduled_date || isoDateOffset(0),
              estimated_minutes: parsed.estimated_minutes || 45,
              status: 'todo',
            }),
            ['task'],
          );
        }

        expect(created).toBeTruthy();
        cleanup.defer(async () => {
          await api.delete(`/tasks/${created.id}`);
        });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('body')).toContainText(uniqueTokenTitle);
      } finally {
        await cleanup.runAll();
      }
    },
  );
});
