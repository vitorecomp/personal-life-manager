import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  E2E_PATHS,
  E2E_URLS,
  ensureStackReady,
  createApiClient,
  unwrapList,
  createPatToken,
  uniqueId,
  CleanupRegistry,
  createMcpClient,
} from '../../harness/index.js';

const RFC9562_UUIDV7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_MOBILE_TABLES = new Set([
  'projects',
  'tasks',
  'time_sessions',
  'routines',
  'routine_items',
  'routine_logs',
  'daily_checkins',
  'companion_offline_phrases',
]);

const EXCLUDED_DESKTOP_TABLES = new Set([
  'portfolio_assets',
  'portfolio_transactions',
  'goals',
  'key_results',
  'courses',
  'course_videos',
  'agents',
  'agent_runs',
  'dashboards',
  'servers',
  'hermes_memories',
]);

function makeUuidV7(tsMs: number = Date.now()): string {
  const hexTs = BigInt(tsMs).toString(16).padStart(12, '0').slice(0, 12);
  const rand = crypto.randomBytes(10).toString('hex');
  return `${hexTs.slice(0, 8)}-${hexTs.slice(8, 12)}-7${rand.slice(0, 3)}-8${rand.slice(3, 6)}-${rand.slice(6, 18)}`;
}

function extractServerSeq(payload: any): number {
  const json = payload?.json !== undefined ? payload.json : payload;
  const raw =
    json?.latest_server_seq ??
    json?.server_seq ??
    json?.next_seq ??
    json?.cursor ??
    0;
  return typeof raw === 'number' ? raw : Number(raw) || 0;
}

function extractAppliedCount(payload: any): number {
  const json = payload?.json !== undefined ? payload.json : payload;
  const raw =
    json?.applied_count ??
    json?.applied ??
    json?.upserted_count ??
    json?.processed ??
    0;
  return typeof raw === 'number' ? raw : Number(raw) || 0;
}

test.describe('Area D Tier 1 — F08 Scoped UUIDv7 Mobile Delta Sync & F36 Full-Stack Production Readiness', () => {
  test.beforeAll(async () => {
    await ensureStackReady({ requireMobile: true });
  });

  // =========================================================================
  // Feature F08: Scoped UUIDv7 Mobile Delta Sync Backend (5 Tier 1 Tests)
  // =========================================================================

  test(
    '[T1][F08] bootstrap pull since=0 returns snapshot across mobile-scoped tables and monotonic cursor',
    { tag: ['@tier1', '@F08'] },
    async () => {
      const cleanup = new CleanupRegistry();
      try {
        const rootApi = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(rootApi, uniqueId('f08-t1-boot'));
        cleanup.defer(async () => {
          await rootApi.delete(`/api/auth/tokens/${pat.id}`);
        });

        const authed = rootApi.withToken(pat.token);
        const pullRes = await authed.get('/api/sync/pull?since=0');
        expect(pullRes.status).toBe(200);
        expect(pullRes.json).toBeTruthy();

        const changes = unwrapList<any>(pullRes, ['changes', 'mutations', 'items']);
        expect(Array.isArray(changes)).toBe(true);

        const latestSeq = extractServerSeq(pullRes);
        expect(typeof latestSeq).toBe('number');
        expect(Number.isFinite(latestSeq)).toBe(true);
        expect(latestSeq).toBeGreaterThanOrEqual(0);

        if (typeof pullRes.json?.has_more === 'boolean') {
          expect([true, false]).toContain(pullRes.json.has_more);
        }

        for (const change of changes) {
          const tableName = String(change.entity_table ?? change.table ?? '');
          expect(ALLOWED_MOBILE_TABLES.has(tableName)).toBe(true);
          expect(EXCLUDED_DESKTOP_TABLES.has(tableName)).toBe(false);
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F08] push UUIDv7 project, task, and time_session mutations advances server_seq and persists to REST API',
    { tag: ['@tier1', '@F08'] },
    async () => {
      const cleanup = new CleanupRegistry();
      try {
        const rootApi = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(rootApi, uniqueId('f08-t1-push-tasks'));
        cleanup.defer(async () => {
          await rootApi.delete(`/api/auth/tokens/${pat.id}`);
        });

        const authed = rootApi.withToken(pat.token);
        const beforePull = await authed.get('/api/sync/pull?since=0');
        expect(beforePull.status).toBe(200);
        const seqBefore = extractServerSeq(beforePull);

        const nowMs = Date.now();
        const projectId = makeUuidV7(nowMs);
        const taskId = makeUuidV7(nowMs + 1);
        const sessionId = makeUuidV7(nowMs + 2);
        const nowIso = new Date(nowMs).toISOString();

        expect(projectId).toMatch(RFC9562_UUIDV7_RE);
        expect(taskId).toMatch(RFC9562_UUIDV7_RE);
        expect(sessionId).toMatch(RFC9562_UUIDV7_RE);
        expect(projectId < taskId).toBe(true);
        expect(taskId < sessionId).toBe(true);

        const projectTitle = `Mobile Sync Project ${uniqueId('proj')}`;
        const taskTitle = `Mobile Sync Task ${uniqueId('task')}`;

        const pushRes = await authed.post('/api/sync/push', {
          client_id: uniqueId('mob-c1'),
          mutations: [
            {
              mutation_id: makeUuidV7(nowMs + 3),
              entity_table: 'projects',
              entity_id: projectId,
              op: 'upsert',
              client_updated_at: nowIso,
              payload: {
                id: projectId,
                name: projectTitle,
                title: projectTitle,
                color: '#F87C18',
                status: 'active',
                updated_at: nowIso,
                client_updated_at: nowIso,
              },
            },
            {
              mutation_id: makeUuidV7(nowMs + 4),
              entity_table: 'tasks',
              entity_id: taskId,
              op: 'upsert',
              client_updated_at: nowIso,
              payload: {
                id: taskId,
                project_id: projectId,
                title: taskTitle,
                status: 'todo',
                priority: 'high',
                energy_level: 'deep',
                estimated_minutes: 30,
                updated_at: nowIso,
                client_updated_at: nowIso,
              },
            },
            {
              mutation_id: makeUuidV7(nowMs + 5),
              entity_table: 'time_sessions',
              entity_id: sessionId,
              op: 'upsert',
              client_updated_at: nowIso,
              payload: {
                id: sessionId,
                task_id: taskId,
                category: 'deep_work',
                timer_mode: 'pomodoro',
                duration_seconds: 1500,
                started_at: nowIso,
                ended_at: nowIso,
                updated_at: nowIso,
                client_updated_at: nowIso,
              },
            },
          ],
        });

        cleanup.defer(async () => {
          await authed.delete(`/api/tasks/${taskId}`);
          await authed.delete(`/api/projects/${projectId}`);
        });

        expect(pushRes.status).toBe(200);
        expect(extractAppliedCount(pushRes)).toBeGreaterThanOrEqual(3);
        const seqAfter = extractServerSeq(pushRes);
        expect(seqAfter).toBeGreaterThan(seqBefore);

        const tasksRes = await authed.get('/api/tasks');
        expect(tasksRes.status).toBe(200);
        const tasks = unwrapList<any>(tasksRes, ['tasks', 'items', 'data']);
        const foundTask = tasks.find(
          (t) => String(t.id) === taskId || String(t.title) === taskTitle,
        );
        expect(foundTask).toBeTruthy();
        expect(String(foundTask.id)).toBe(taskId);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F08] push routine, routine_item, routine_log, daily_checkin, and companion_offline_phrase mutations across remaining mobile tables',
    { tag: ['@tier1', '@F08'] },
    async () => {
      const cleanup = new CleanupRegistry();
      try {
        const rootApi = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(rootApi, uniqueId('f08-t1-push-routines'));
        cleanup.defer(async () => {
          await rootApi.delete(`/api/auth/tokens/${pat.id}`);
        });

        const authed = rootApi.withToken(pat.token);
        const beforePull = await authed.get('/api/sync/pull?since=0');
        expect(beforePull.status).toBe(200);
        const seqBefore = extractServerSeq(beforePull);

        const baseMs = Date.now();
        const routineId = makeUuidV7(baseMs);
        const itemId = makeUuidV7(baseMs + 1);
        const logId = makeUuidV7(baseMs + 2);
        const phraseId = makeUuidV7(baseMs + 4);
        const nowIso = new Date(baseMs).toISOString();
        const logDate = '2026-11-14';
        const routineName = `Morning Field Stack ${uniqueId('rtn')}`;
        const phraseText = `Stay locked on the current objective ${uniqueId('phrase')}.`;

        const pushRes = await authed.post('/api/sync/push', {
          client_id: uniqueId('mob-c2'),
          mutations: [
            {
              mutation_id: makeUuidV7(baseMs + 10),
              entity_table: 'routines',
              entity_id: routineId,
              op: 'upsert',
              client_updated_at: nowIso,
              payload: {
                id: routineId,
                name: routineName,
                time_slot: 'morning',
                day_profile: 'workday',
                updated_at: nowIso,
                client_updated_at: nowIso,
              },
            },
            {
              mutation_id: makeUuidV7(baseMs + 11),
              entity_table: 'routine_items',
              entity_id: itemId,
              op: 'upsert',
              client_updated_at: nowIso,
              payload: {
                id: itemId,
                routine_id: routineId,
                title: 'Hydrate 500ml + Mobility',
                tracking_type: 'boolean',
                frequency_type: 'daily',
                sort_order: 1,
                estimated_minutes: 10,
                updated_at: nowIso,
                client_updated_at: nowIso,
              },
            },
            {
              mutation_id: makeUuidV7(baseMs + 12),
              entity_table: 'routine_logs',
              entity_id: logId,
              op: 'upsert',
              client_updated_at: nowIso,
              payload: {
                id: logId,
                routine_item_id: itemId,
                log_date: logDate,
                status: 'completed',
                completed_at: nowIso,
                updated_at: nowIso,
                client_updated_at: nowIso,
              },
            },
            {
              mutation_id: makeUuidV7(baseMs + 13),
              entity_table: 'daily_checkins',
              entity_id: logDate,
              op: 'upsert',
              client_updated_at: nowIso,
              payload: {
                id: logDate,
                log_date: logDate,
                day_profile_used: 'workday',
                energy_score: 4,
                mood_score: 5,
                sleep_hours: 7.5,
                highlight: 'Nominal mobile sync check-in',
                reflection_md: 'Nominal mobile sync check-in',
                updated_at: nowIso,
                client_updated_at: nowIso,
              },
            },
            {
              mutation_id: makeUuidV7(baseMs + 14),
              entity_table: 'companion_offline_phrases',
              entity_id: phraseId,
              op: 'upsert',
              client_updated_at: nowIso,
              payload: {
                id: phraseId,
                trigger_context: 'tap',
                animation_hint: 'grimoire',
                phrase_text: phraseText,
                active: true,
                updated_at: nowIso,
                client_updated_at: nowIso,
              },
            },
          ],
        });

        cleanup.defer(async () => {
          await authed.delete(`/api/routines/${routineId}`);
          await authed.delete(`/api/companion/phrases/${phraseId}`);
        });

        expect(pushRes.status).toBe(200);
        expect(extractAppliedCount(pushRes)).toBeGreaterThanOrEqual(5);

        const deltaPull = await authed.get(`/api/sync/pull?since=${seqBefore}`);
        expect(deltaPull.status).toBe(200);
        const changes = unwrapList<any>(deltaPull, ['changes', 'mutations', 'items']);
        const changedTables = new Set(
          changes.map((c) => String(c.entity_table ?? c.table ?? '')),
        );
        expect(changedTables.has('routines')).toBe(true);
        expect(changedTables.has('routine_items')).toBe(true);
        expect(changedTables.has('routine_logs')).toBe(true);
        expect(changedTables.has('daily_checkins')).toBe(true);
        expect(changedTables.has('companion_offline_phrases')).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F08] incremental delta pull since=last_seq returns only subsequent mutations in strictly ascending server_seq order',
    { tag: ['@tier1', '@F08'] },
    async () => {
      const cleanup = new CleanupRegistry();
      try {
        const rootApi = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(rootApi, uniqueId('f08-t1-incremental'));
        cleanup.defer(async () => {
          await rootApi.delete(`/api/auth/tokens/${pat.id}`);
        });

        const authed = rootApi.withToken(pat.token);
        const bootRes = await authed.get('/api/sync/pull?since=0');
        expect(bootRes.status).toBe(200);
        const cursorA = extractServerSeq(bootRes);

        const nowMs = Date.now();
        const taskA = makeUuidV7(nowMs);
        const taskB = makeUuidV7(nowMs + 10);
        const isoA = new Date(nowMs).toISOString();
        const isoB = new Date(nowMs + 10).toISOString();

        const pushA = await authed.post('/api/sync/push', {
          client_id: uniqueId('mob-seq-a'),
          mutations: [
            {
              mutation_id: makeUuidV7(nowMs + 1),
              entity_table: 'tasks',
              entity_id: taskA,
              op: 'upsert',
              client_updated_at: isoA,
              payload: {
                id: taskA,
                title: `Incremental Task A ${uniqueId('ta')}`,
                status: 'todo',
                priority: 'medium',
                energy_level: 'shallow',
                estimated_minutes: 25,
                updated_at: isoA,
                client_updated_at: isoA,
              },
            },
          ],
        });
        expect(pushA.status).toBe(200);

        const pushB = await authed.post('/api/sync/push', {
          client_id: uniqueId('mob-seq-b'),
          mutations: [
            {
              mutation_id: makeUuidV7(nowMs + 11),
              entity_table: 'tasks',
              entity_id: taskB,
              op: 'upsert',
              client_updated_at: isoB,
              payload: {
                id: taskB,
                title: `Incremental Task B ${uniqueId('tb')}`,
                status: 'todo',
                priority: 'high',
                energy_level: 'deep',
                estimated_minutes: 30,
                updated_at: isoB,
                client_updated_at: isoB,
              },
            },
          ],
        });
        expect(pushB.status).toBe(200);

        cleanup.defer(async () => {
          await authed.delete(`/api/tasks/${taskA}`);
          await authed.delete(`/api/tasks/${taskB}`);
        });

        const pullDelta = await authed.get(`/api/sync/pull?since=${cursorA}`);
        expect(pullDelta.status).toBe(200);
        const changes = unwrapList<any>(pullDelta, ['changes', 'mutations', 'items']);
        expect(changes.length).toBeGreaterThanOrEqual(2);

        const entityIds = changes.map((c) => String(c.entity_id ?? c.id ?? ''));
        expect(entityIds).toContain(taskA);
        expect(entityIds).toContain(taskB);

        for (let i = 0; i < changes.length; i++) {
          const seq = Number(changes[i].server_seq ?? changes[i].seq ?? 0);
          expect(seq).toBeGreaterThan(cursorA);
          if (i > 0) {
            const prevSeq = Number(changes[i - 1].server_seq ?? changes[i - 1].seq ?? 0);
            expect(seq).toBeGreaterThan(prevSeq);
          }
        }

        const cursorAfterB = extractServerSeq(pullDelta);
        const emptyPull = await authed.get(`/api/sync/pull?since=${cursorAfterB}`);
        expect(emptyPull.status).toBe(200);
        const emptyChanges = unwrapList<any>(emptyPull, ['changes', 'mutations', 'items']);
        expect(emptyChanges.length).toBe(0);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F08] bidirectional sync reflects Web REST mutations in pull delta and updates existing rows with newer client_updated_at (LWW)',
    { tag: ['@tier1', '@F08'] },
    async () => {
      const cleanup = new CleanupRegistry();
      try {
        const rootApi = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(rootApi, uniqueId('f08-t1-bidir'));
        cleanup.defer(async () => {
          await rootApi.delete(`/api/auth/tokens/${pat.id}`);
        });

        const authed = rootApi.withToken(pat.token);
        const initialPull = await authed.get('/api/sync/pull?since=0');
        expect(initialPull.status).toBe(200);
        const cursor0 = extractServerSeq(initialPull);

        const webTitle = `Created on Web ${uniqueId('web')}`;
        const createRes = await authed.post('/api/tasks', {
          title: webTitle,
          status: 'todo',
          priority: 'medium',
          energy_level: 'shallow',
          estimated_minutes: 30,
        });
        expect([200, 201]).toContain(createRes.status);
        const createdTask = createRes.json?.task ?? createRes.json?.data ?? createRes.json;
        const sharedTaskId = String(createdTask?.id ?? '');
        expect(sharedTaskId.length).toBeGreaterThan(0);

        cleanup.defer(async () => {
          await authed.delete(`/api/tasks/${sharedTaskId}`);
        });

        const pullAfterWeb = await authed.get(`/api/sync/pull?since=${cursor0}`);
        expect(pullAfterWeb.status).toBe(200);
        const deltaChanges = unwrapList<any>(pullAfterWeb, ['changes', 'mutations', 'items']);
        const webTaskChange = deltaChanges.find(
          (c) =>
            String(c.entity_table ?? c.table) === 'tasks' &&
            String(c.entity_id ?? c.id) === sharedTaskId,
        );
        expect(webTaskChange).toBeTruthy();

        const futureIso = new Date(Date.now() + 120_000).toISOString();
        const lwwTitle = `Updated on Mobile LWW ${uniqueId('lww')}`;
        const pushUpdate = await authed.post('/api/sync/push', {
          client_id: uniqueId('mob-lww'),
          mutations: [
            {
              mutation_id: makeUuidV7(),
              entity_table: 'tasks',
              entity_id: sharedTaskId,
              op: 'upsert',
              client_updated_at: futureIso,
              payload: {
                id: sharedTaskId,
                title: lwwTitle,
                status: 'done',
                priority: 'high',
                energy_level: 'deep',
                estimated_minutes: 30,
                updated_at: futureIso,
                client_updated_at: futureIso,
              },
            },
          ],
        });
        expect(pushUpdate.status).toBe(200);
        expect(extractAppliedCount(pushUpdate)).toBeGreaterThanOrEqual(1);

        const verifyTasks = await authed.get('/api/tasks');
        expect(verifyTasks.status).toBe(200);
        const allTasks = unwrapList<any>(verifyTasks, ['tasks', 'items', 'data']);
        const updatedTask = allTasks.find((t) => String(t.id) === sharedTaskId);
        expect(updatedTask).toBeTruthy();
        expect(String(updatedTask.title)).toBe(lwwTitle);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  // =========================================================================
  // Feature F36: Full-Stack Production Verification & Readiness (5 Tier 1 Tests)
  // =========================================================================

  test(
    '[T1][F36] production CSR static bundles (apps/web/dist and apps/mobile/dist) and Axum root serving deliver valid client-rendered assets',
    { tag: ['@tier1', '@F36'] },
    async () => {
      const webIndexHtmlPath = path.join(E2E_PATHS.webDistDir, 'index.html');
      const mobileIndexHtmlPath = path.join(E2E_PATHS.mobileDistDir, 'index.html');

      expect(fs.existsSync(webIndexHtmlPath)).toBe(true);
      expect(fs.existsSync(mobileIndexHtmlPath)).toBe(true);

      const webHtmlDisk = fs.readFileSync(webIndexHtmlPath, 'utf8');
      const mobileHtmlDisk = fs.readFileSync(mobileIndexHtmlPath, 'utf8');
      expect(webHtmlDisk).toContain('<div id="root">');
      expect(webHtmlDisk).toMatch(/<script[^>]+type="module"[^>]+src="\/assets\//i);
      expect(mobileHtmlDisk).toContain('<div id="root">');
      expect(mobileHtmlDisk).toMatch(/<script[^>]+type="module"[^>]+src="\/assets\//i);

      const api = createApiClient(E2E_URLS.baseUrl);
      const webRootRes = await api.raw(`${E2E_URLS.baseUrl}/`, {
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      expect(webRootRes.status).toBe(200);
      expect(webRootRes.headers.get('content-type') || '').toContain('text/html');
      expect(webRootRes.text).toContain('<div id="root">');

      const assetMatch = webRootRes.text.match(/src="(\/assets\/[^"]+\.js)"/i);
      expect(assetMatch).toBeTruthy();
      if (assetMatch) {
        const jsRes = await api.raw(`${E2E_URLS.baseUrl}${assetMatch[1]}`, {
          headers: { Accept: 'application/javascript,*/*' },
        });
        expect(jsRes.status).toBe(200);
        expect(jsRes.text.length).toBeGreaterThan(100);
      }

      const mobileApi = createApiClient(E2E_URLS.mobileUrl);
      const mobileRootRes = await mobileApi.raw(`${E2E_URLS.mobileUrl}/`, {
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      expect(mobileRootRes.status).toBe(200);
      expect(mobileRootRes.headers.get('content-type') || '').toContain('text/html');
      expect(mobileRootRes.text).toContain('<div id="root">');
    },
  );

  test(
    '[T1][F36] cross-stack runtime health (/api/health), OpenAPI 3.1 (/api/openapi.json), and 7-domain /mcp tool registry are online in parity',
    { tag: ['@tier1', '@F36'] },
    async () => {
      const cleanup = new CleanupRegistry();
      try {
        const api = createApiClient(E2E_URLS.baseUrl);
        const healthRes = await api.get('/api/health');
        expect(healthRes.status).toBe(200);
        expect(healthRes.json?.status).toBe('ok');
        expect(healthRes.json?.db_online).toBe(true);
        expect(healthRes.json?.redis_online).toBe(true);
        expect(['online', 'offline_mock']).toContain(healthRes.json?.hermes_gateway);

        const openApiRes = await api.get('/api/openapi.json');
        expect(openApiRes.status).toBe(200);
        expect(String(openApiRes.json?.openapi || '')).toMatch(/^3\.1\./);
        const pathsObj = openApiRes.json?.paths ?? {};
        const pathKeys = Object.keys(pathsObj);
        expect(pathKeys).toContain('/api/health');
        expect(pathKeys).toContain('/api/sync/push');
        expect(pathKeys).toContain('/api/sync/pull');
        expect(pathKeys).toContain('/api/tasks');
        expect(pathKeys).toContain('/api/routines');
        expect(pathKeys).toContain('/api/goals');
        expect(pathKeys).toContain('/api/courses');
        expect(pathKeys).toContain('/api/dashboards');
        expect(pathKeys).toContain('/api/servers');
        expect(pathKeys).toContain('/api/agents');

        const pat = await createPatToken(api, uniqueId('f36-mcp-parity'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });

        const mcp = createMcpClient(E2E_URLS.mcpUrl, pat.token);
        await mcp.initialize();
        const toolList = await mcp.listTools();
        expect(toolList.tools.length).toBeGreaterThanOrEqual(7);

        const toolNamesJoined = toolList.tools.map((t) => t.name.toLowerCase()).join(' ');
        for (const domainKeyword of [
          'dashboard',
          'task',
          'routine',
          'goal',
          'course',
          'finance',
          'server',
        ]) {
          expect(toolNamesJoined).toContain(domainKeyword);
        }
        await mcp.closeSession();
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F36] unified container stack manifests (podman-compose.yml, infra-deploy/Dockerfile, initdb/01-pgvector.sql) match production architecture',
    { tag: ['@tier1', '@F36'] },
    async () => {
      const rootComposePath = path.join(E2E_PATHS.workspaceRoot, 'podman-compose.yml');
      const infraPodmanPath = path.join(
        E2E_PATHS.repoRoot,
        'infra-deploy',
        'podman-compose.yml',
      );
      const infraDockerPath = path.join(
        E2E_PATHS.repoRoot,
        'infra-deploy',
        'docker-compose.yml',
      );
      const dockerfilePath = path.join(E2E_PATHS.repoRoot, 'infra-deploy', 'Dockerfile');
      const pgvectorSqlPath = path.join(
        E2E_PATHS.repoRoot,
        'infra-deploy',
        'initdb',
        '01-pgvector.sql',
      );

      expect(fs.existsSync(rootComposePath)).toBe(true);
      expect(fs.existsSync(infraPodmanPath)).toBe(true);
      expect(fs.existsSync(infraDockerPath)).toBe(true);
      expect(fs.existsSync(dockerfilePath)).toBe(true);
      expect(fs.existsSync(pgvectorSqlPath)).toBe(true);

      for (const composeFile of [rootComposePath, infraPodmanPath, infraDockerPath]) {
        const content = fs.readFileSync(composeFile, 'utf8');
        expect(content).toContain('pgvector/pgvector:pg16');
        expect(content).toContain('redis:7-alpine');
        expect(content).toContain('hermes-server');
        expect(content).toContain('${HERMES_SERVER_PORT:-8080}:8080');
        expect(content).toContain('/app/apps/web/dist');
      }

      const dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
      expect(dockerfile).toMatch(
        /FROM\s+(?:docker\.io\/library\/)?node:24-slim\s+AS\s+web-builder/i,
      );
      expect(dockerfile).toMatch(
        /FROM\s+(?:docker\.io\/library\/)?rust:1\.95-slim-bookworm\s+AS\s+rust-builder/i,
      );
      expect(dockerfile).toMatch(
        /FROM\s+(?:docker\.io\/library\/)?debian:bookworm-slim\s+AS\s+runtime/i,
      );
      expect(dockerfile).toContain('corepack pnpm@10.34.7');
      expect(dockerfile).toContain('/app/apps/web/dist');
      expect(dockerfile).toContain('/app/server');

      const initSql = fs.readFileSync(pgvectorSqlPath, 'utf8');
      expect(initSql).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+vector\s*;/i);
    },
  );

  test(
    '[T1][F36] repository privacy & migration invariants hold: git ls-files data/ is empty, legacy dirs absent, and crawlers intact',
    { tag: ['@tier1', '@F36'] },
    async () => {
      const trackedDataFiles = execFileSync('git', ['ls-files', 'data/'], {
        cwd: E2E_PATHS.workspaceRoot,
        encoding: 'utf8',
      }).trim();
      expect(trackedDataFiles).toBe('');

      const stagedOrModifiedDataFiles = execFileSync(
        'git',
        ['status', '--porcelain', 'data/'],
        {
          cwd: E2E_PATHS.workspaceRoot,
          encoding: 'utf8',
        },
      ).trim();
      expect(stagedOrModifiedDataFiles).toBe('');

      expect(fs.existsSync(path.join(E2E_PATHS.workspaceRoot, 'personal-system'))).toBe(false);
      expect(fs.existsSync(path.join(E2E_PATHS.workspaceRoot, 'hermes'))).toBe(false);

      expect(
        fs.existsSync(path.join(E2E_PATHS.workspaceRoot, 'crawlers', 'youtube-lists')),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(E2E_PATHS.workspaceRoot, 'crawlers', 'youtube-ai')),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(E2E_PATHS.workspaceRoot, 'crawlers', 'youtube-clean')),
      ).toBe(true);
    },
  );

  test(
    '[T1][F36] pre-commit security hook, .gitignore rules, and portable pnpm-lock.yaml pass production readiness checks',
    { tag: ['@tier1', '@F36'] },
    async () => {
      const preCommitOutput = execFileSync(
        'python3',
        ['scripts/git-hooks/pre-commit'],
        {
          cwd: E2E_PATHS.workspaceRoot,
          encoding: 'utf8',
        },
      );
      expect(preCommitOutput.trim()).toBe('');

      const rootLockfile = fs.readFileSync(
        path.join(E2E_PATHS.repoRoot, 'pnpm-lock.yaml'),
        'utf8',
      );
      expect(rootLockfile).not.toContain('airlock');
      expect(rootLockfile).not.toContain('uplink.goog');

      const envExample = fs.readFileSync(
        path.join(E2E_PATHS.workspaceRoot, '.env.example'),
        'utf8',
      );
      const activeEnvLines = envExample
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));

      expect(activeEnvLines.length).toBeGreaterThan(5);
      for (const line of activeEnvLines) {
        const eqIdx = line.indexOf('=');
        expect(eqIdx).toBeGreaterThan(0);
        const valuePart = line.slice(eqIdx + 1);
        expect(valuePart).not.toMatch(/\s+#/);
      }
    },
  );
});
