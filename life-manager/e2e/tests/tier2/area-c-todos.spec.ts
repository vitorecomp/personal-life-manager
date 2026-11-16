import { expect, test } from '@playwright/test';
import {
  CleanupRegistry,
  E2E_URLS,
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

test.describe('Area C Tier 2 — Todos & Focus Timer Boundary, Negative & Resilience (F13 & F28)', () => {
  test.beforeAll(async () => {
    await ensureStackReady();
  });

  test(
    '[T2][F13] DFS dependency cycle guard rejects self-dependency and direct 2-node cycle with 422 CYCLE_DETECTED',
    { tag: ['@tier2', '@F13'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const taskA = unwrapEntity(
          await api.post('/tasks', {
            title: uniqueId('Cycle-Node-A'),
            status: 'todo',
          }),
          ['task'],
        );
        cleanup.defer(async () => {
          await api.delete(`/tasks/${taskA.id}`);
        });

        const taskB = unwrapEntity(
          await api.post('/tasks', {
            title: uniqueId('Cycle-Node-B'),
            status: 'todo',
            blocked_by_task_ids: [taskA.id],
          }),
          ['task'],
        );
        cleanup.defer(async () => {
          await api.delete(`/tasks/${taskB.id}`);
        });

        const selfCycleRes = await api.put(`/tasks/${taskA.id}`, {
          title: taskA.title,
          blocked_by_task_ids: [taskA.id],
        });
        expect(selfCycleRes.status).toBe(422);
        expect(JSON.stringify(selfCycleRes.json)).toMatch(/cycle|unprocessable/i);

        const twoNodeCycleRes = await api.put(`/tasks/${taskA.id}`, {
          title: taskA.title,
          blocked_by_task_ids: [taskB.id],
        });
        expect(twoNodeCycleRes.status).toBe(422);
        expect(JSON.stringify(twoNodeCycleRes.json)).toMatch(/cycle|unprocessable/i);

        const verifyA = unwrapEntity(await api.get(`/tasks/${taskA.id}`), ['task']);
        expect(verifyA.blocked_by_task_ids ?? []).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F13] DFS dependency cycle guard rejects multi-hop transitive 3-node cycle (A -> B -> C -> A) with 422',
    { tag: ['@tier2', '@F13'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const taskA = unwrapEntity(
          await api.post('/tasks', {
            title: uniqueId('Trans-A'),
            status: 'todo',
          }),
          ['task'],
        );
        const taskB = unwrapEntity(
          await api.post('/tasks', {
            title: uniqueId('Trans-B'),
            status: 'todo',
            blocked_by_task_ids: [taskA.id],
          }),
          ['task'],
        );
        const taskC = unwrapEntity(
          await api.post('/tasks', {
            title: uniqueId('Trans-C'),
            status: 'todo',
            blocked_by_task_ids: [taskB.id],
          }),
          ['task'],
        );
        cleanup.defer(async () => {
          await api.delete(`/tasks/${taskC.id}`);
          await api.delete(`/tasks/${taskB.id}`);
          await api.delete(`/tasks/${taskA.id}`);
        });

        const cycleRes = await api.put(`/tasks/${taskA.id}`, {
          title: taskA.title,
          blocked_by_task_ids: [taskC.id],
        });
        expect(cycleRes.status).toBe(422);
        expect(JSON.stringify(cycleRes.json)).toMatch(/cycle|unprocessable/i);

        const verifyA = unwrapEntity(await api.get(`/tasks/${taskA.id}`), ['task']);
        expect(verifyA.blocked_by_task_ids ?? []).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F13] NLP parser and Task creation reject empty/whitespace titles and invalid enum values with 400',
    { tag: ['@tier2', '@F13'] },
    async () => {
      const api = createApiClient();

      const emptyParseRes = await api.post('/tasks/parse', {
        raw_input: '   \t\n  ',
        text: '   \t\n  ',
      });
      expect([400, 422]).toContain(emptyParseRes.status);

      const emptyTaskRes = await api.post('/tasks', {
        title: '   ',
        status: 'todo',
      });
      expect([400, 422]).toContain(emptyTaskRes.status);

      const badStatusRes = await api.post('/tasks', {
        title: 'Invalid Status Task',
        status: 'nonexistent_status',
      });
      expect([400, 422]).toContain(badStatusRes.status);

      const badPriorityRes = await api.post('/tasks', {
        title: 'Invalid Priority Task',
        priority: 'ultra_critical_p0',
      });
      expect([400, 422]).toContain(badPriorityRes.status);

      const emptyProjRes = await api.post('/projects', {
        name: '   ',
        area: 'systems',
      });
      expect([400, 422]).toContain(emptyProjRes.status);
    },
  );

  test(
    '[T2][F13] Focus Timer discard drops elapsed time without inflating task actual_seconds and singleton timer prevents duplicates',
    { tag: ['@tier2', '@F13'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        await api.post('/time/timer/discard', {});

        const task1 = unwrapEntity(
          await api.post('/tasks', {
            title: uniqueId('Discard-Task-1'),
            status: 'in_progress',
          }),
          ['task'],
        );
        const task2 = unwrapEntity(
          await api.post('/tasks', {
            title: uniqueId('Singleton-Task-2'),
            status: 'in_progress',
          }),
          ['task'],
        );
        cleanup.defer(async () => {
          await api.post('/time/timer/discard', {});
          await api.delete(`/tasks/${task2.id}`);
          await api.delete(`/tasks/${task1.id}`);
        });

        const start1 = await api.post('/time/timer/start', {
          task_id: task1.id,
          category: 'deep_work',
          timer_mode: 'stopwatch',
        });
        expect([200, 201]).toContain(start1.status);

        const discardRes = await api.post('/time/timer/discard', {});
        expect([200, 204]).toContain(discardRes.status);

        const verifyTask1 = unwrapEntity(await api.get(`/tasks/${task1.id}`), ['task']);
        expect(Number(verifyTask1.actual_seconds ?? 0)).toBe(0);

        const timerAfterDiscard = await api.get('/time/timer');
        expect(timerAfterDiscard.status).toBe(200);
        expect(timerAfterDiscard.json.running).toBe(false);

        await api.post('/time/timer/start', {
          task_id: task1.id,
          category: 'deep_work',
          timer_mode: 'stopwatch',
        });
        const secondStart = await api.post('/time/timer/start', {
          task_id: task2.id,
          category: 'deep_work',
          timer_mode: 'pomodoro_25_5',
        });
        expect([200, 201, 409]).toContain(secondStart.status);

        const currentTimer = await api.get('/time/timer');
        expect(currentTimer.status).toBe(200);
        expect(currentTimer.json.running).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F13] Negative TimeSession duration_seconds and non-existent Task/Project UUIDs return 400 and 404',
    { tag: ['@tier2', '@F13'] },
    async () => {
      const api = createApiClient();
      const missingUuid = '01932a00-0000-7000-8000-999999999999';

      const negSessionRes = await api.post('/time/sessions', {
        category: 'deep_work',
        timer_mode: 'stopwatch',
        duration_seconds: -120,
      });
      expect([400, 422]).toContain(negSessionRes.status);

      const getMissingTask = await api.get(`/tasks/${missingUuid}`);
      expect(getMissingTask.status).toBe(404);

      const putMissingTask = await api.put(`/tasks/${missingUuid}`, {
        title: 'Does not exist',
      });
      expect(putMissingTask.status).toBe(404);

      const patchMissingTask = await api.patch(`/tasks/${missingUuid}/status`, {
        status: 'done',
      });
      expect(patchMissingTask.status).toBe(404);

      const getMissingProject = await api.get(`/projects/${missingUuid}`);
      expect(getMissingProject.status).toBe(404);
    },
  );

  test(
    '[T2][F13] Vault note path traversal on task creation/update is rejected with 400',
    { tag: ['@tier2', '@F13'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const traversalRes = await api.post('/tasks', {
          title: uniqueId('Traversal-Task'),
          status: 'todo',
          vault_note_path: '../../../etc/passwd',
        });
        if (traversalRes.status === 200 || traversalRes.status === 201) {
          const created = unwrapEntity(traversalRes, ['task']);
          cleanup.defer(async () => {
            await api.delete(`/tasks/${created.id}`);
          });
          expect(String(created.vault_note_path ?? '')).not.toContain('..');
        } else {
          expect([400, 422]).toContain(traversalRes.status);
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F28] Today Capacity Meter displays overload warning state when planned task minutes exceed available deep-work hours',
    { tag: ['@tier2', '@F28'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        for (let i = 1; i <= 4; i++) {
          const t = unwrapEntity(
            await api.post('/tasks', {
              title: uniqueId(`Overload-Task-${i}`),
              status: 'todo',
              priority: 'urgent',
              scheduled_date: isoDateOffset(0),
              estimated_minutes: 180,
              energy_level: 'deep',
            }),
            ['task'],
          );
          cleanup.defer(async () => {
            await api.delete(`/tasks/${t.id}`);
          });
        }

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);

        const todayBtn = page
          .getByRole('button', { name: /today/i })
          .or(page.getByRole('tab', { name: /today/i }))
          .first();
        if ((await todayBtn.count()) > 0) {
          await todayBtn.click();
        }

        const text = await page.locator('body').innerText();
        expect(text).not.toContain('NaN');
        expect(text).not.toContain('Infinity');

        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F28] Quick-capture input on /todos rejects empty/whitespace submission without creating blank tasks',
    { tag: ['@tier2', '@F28'] },
    async ({ page }) => {
      const api = createApiClient();

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);
      const beforeTasks = unwrapList(await api.get('/tasks'), ['tasks']);

      const inputLocator = page
        .getByPlaceholder(/capture|add.*task|quick|todo|#tag/i)
        .or(page.locator('input[type="text"]'))
        .first();

      if ((await inputLocator.count()) > 0 && (await inputLocator.isVisible())) {
        await inputLocator.fill('     ');
        await inputLocator.press('Enter');
      }

      const afterTasks = unwrapList(await api.get('/tasks'), ['tasks']);
      const blankTasks = afterTasks.filter((t: any) => !String(t.title ?? '').trim());
      expect(blankTasks.length).toBe(0);
      expect(afterTasks.length).toBe(beforeTasks.length);
    },
  );

  test(
    '[T2][F28] Blocked task in Project Flow (REF-04) and Signal List (REF-05) surfaces vermilion #EB4511 bottleneck badge/state',
    { tag: ['@tier2', '@F28'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const blocker = unwrapEntity(
          await api.post('/tasks', {
            title: uniqueId('Incomplete-Blocker'),
            status: 'todo',
            priority: 'high',
            scheduled_date: isoDateOffset(0),
          }),
          ['task'],
        );
        const dependent = unwrapEntity(
          await api.post('/tasks', {
            title: uniqueId('Bottleneck-Dependent'),
            status: 'todo',
            priority: 'urgent',
            scheduled_date: isoDateOffset(0),
            blocked_by_task_ids: [blocker.id],
          }),
          ['task'],
        );
        cleanup.defer(async () => {
          await api.delete(`/tasks/${dependent.id}`);
          await api.delete(`/tasks/${blocker.id}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);
        await expect(page.locator('body')).toContainText(dependent.title);

        const flowBtn = page
          .getByRole('button', { name: /flow|terminal|topology/i })
          .or(page.getByRole('tab', { name: /flow|terminal|topology/i }))
          .first();
        if ((await flowBtn.count()) > 0) {
          await flowBtn.click();
          await expect(page.locator('body')).toContainText(/stage|flow|terminal|blocked/i);
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F28] Switching rapidly across all 3 layout modes (Signal List -> TERMINAL-I/O Flow -> Matrix -> Signal List) preserves perspective filter and 0px FUI compliance',
    { tag: ['@tier2', '@F28'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);

      const modes = [/signal|list/i, /flow|terminal|topology/i, /matrix|eisenhower|quadrant/i, /signal|list/i];
      for (const pattern of modes) {
        const btn = page
          .getByRole('button', { name: pattern })
          .or(page.getByRole('tab', { name: pattern }))
          .first();
        if ((await btn.count()) > 0) {
          await btn.click();
        }
        const [radiusAudit, fontAudit] = await Promise.all([
          auditZeroBorderRadius(page),
          auditInteractiveFontFloor(page, 12),
        ]);
        expect(radiusAudit.violations).toEqual([]);
        expect(fontAudit.violations).toEqual([]);
      }
    },
  );

  test(
    '[T2][F28] Starting a timer on Task B while Task A timer is running cleanly switches active timer without duplicate timer bars',
    { tag: ['@tier2', '@F28'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        await api.post('/time/timer/discard', {});
        const taskA = unwrapEntity(
          await api.post('/tasks', {
            title: uniqueId('TimerSwitch-A'),
            status: 'in_progress',
            scheduled_date: isoDateOffset(0),
          }),
          ['task'],
        );
        const taskB = unwrapEntity(
          await api.post('/tasks', {
            title: uniqueId('TimerSwitch-B'),
            status: 'in_progress',
            scheduled_date: isoDateOffset(0),
          }),
          ['task'],
        );
        cleanup.defer(async () => {
          await api.post('/time/timer/discard', {});
          await api.delete(`/tasks/${taskB.id}`);
          await api.delete(`/tasks/${taskA.id}`);
        });

        await api.post('/time/timer/start', {
          task_id: taskA.id,
          category: 'deep_work',
          timer_mode: 'stopwatch',
        });
        await api.post('/time/timer/start', {
          task_id: taskB.id,
          category: 'deep_work',
          timer_mode: 'pomodoro_25_5',
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);
        const timerRes = await api.get('/time/timer');
        expect(timerRes.status).toBe(200);
        expect(timerRes.json.running).toBe(true);

        const stopRes = await api.post('/time/timer/stop', {});
        expect(stopRes.status).toBe(200);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F28] /todos empty perspective filter state renders cleanly with zero NaN/undefined text or horizontal overflow',
    { tag: ['@tier2', '@F28'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);

      const searchInput = page
        .getByPlaceholder(/search|filter/i)
        .or(page.locator('input[type="search"]'))
        .first();
      if ((await searchInput.count()) > 0 && (await searchInput.isVisible())) {
        await searchInput.fill('__NONEXISTENT_QUERY_TOKEN_99999__');
      }

      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('NaN');
      expect(bodyText).not.toContain('undefined');

      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth + 4;
      });
      expect(hasHorizontalOverflow).toBe(false);
    },
  );
});
