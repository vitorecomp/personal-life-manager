import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
  uniqueId,
  CleanupRegistry,
} from '../../harness/index.js';

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

test.describe('Area D Tier 2 — F08 Scoped Mobile Delta Sync & F36 Production Readiness Boundary/Negative/Resilience', () => {
  test.beforeAll(async () => {
    await ensureStackReady({ requireMobile: true });
  });

  // =========================================================================
  // Feature F08: Scoped UUIDv7 Mobile Delta Sync Backend (5 Tier 2 Tests)
  // =========================================================================

  test(
    '[T2][F08] unauthenticated, malformed, or revoked Bearer PAT requests to /api/sync/push and /api/sync/pull return 401 Unauthorized',
    { tag: ['@tier2', '@F08'] },
    async () => {
      const anonApi = createApiClient(E2E_URLS.baseUrl);

      const unauthPull = await anonApi.get('/api/sync/pull?since=0');
      expect(unauthPull.status).toBe(401);

      const unauthPush = await anonApi.post('/api/sync/push', {
        client_id: 'anon-client',
        mutations: [],
      });
      expect(unauthPush.status).toBe(401);

      const malformedApi = anonApi.withToken('plm_pat_invalid_forged_token_0000000000');
      const malformedPull = await malformedApi.get('/api/sync/pull?since=0');
      expect(malformedPull.status).toBe(401);

      const pat = await createPatToken(anonApi, uniqueId('f08-t2-revoke'));
      const validPatApi = anonApi.withToken(pat.token);
      const okBeforeRevoke = await validPatApi.get('/api/sync/pull?since=0');
      expect(okBeforeRevoke.status).toBe(200);

      const revokeRes = await anonApi.delete(`/api/auth/tokens/${pat.id}`);
      expect([200, 204]).toContain(revokeRes.status);

      const pullAfterRevoke = await validPatApi.get('/api/sync/pull?since=0');
      expect(pullAfterRevoke.status).toBe(401);

      const pushAfterRevoke = await validPatApi.post('/api/sync/push', {
        client_id: 'revoked-client',
        mutations: [],
      });
      expect(pushAfterRevoke.status).toBe(401);
    },
  );

  test(
    '[T2][F08] push rejects excluded Web-only entity_table names (portfolio_assets, goals, courses, agents, dashboards) with 400 Bad Request',
    { tag: ['@tier2', '@F08'] },
    async () => {
      const cleanup = new CleanupRegistry();
      try {
        const rootApi = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(rootApi, uniqueId('f08-t2-forbidden-tables'));
        cleanup.defer(async () => {
          await rootApi.delete(`/api/auth/tokens/${pat.id}`);
        });

        const authed = rootApi.withToken(pat.token);
        const nowIso = new Date().toISOString();

        for (const forbiddenTable of [
          'portfolio_assets',
          'goals',
          'courses',
          'agents',
          'dashboards',
        ]) {
          const entityId = makeUuidV7();
          const res = await authed.post('/api/sync/push', {
            client_id: uniqueId('mob-forbidden'),
            mutations: [
              {
                mutation_id: makeUuidV7(),
                entity_table: forbiddenTable,
                entity_id: entityId,
                op: 'upsert',
                client_updated_at: nowIso,
                payload: {
                  id: entityId,
                  name: `Forbidden ${forbiddenTable}`,
                  title: `Forbidden ${forbiddenTable}`,
                  updated_at: nowIso,
                },
              },
            ],
          });

          expect([400, 422]).toContain(res.status);
          expect(res.ok).toBe(false);
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F08] stale client_updated_at mutation loses Last-Write-Wins conflict against newer server state without overwriting newer fields',
    { tag: ['@tier2', '@F08'] },
    async () => {
      const cleanup = new CleanupRegistry();
      try {
        const rootApi = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(rootApi, uniqueId('f08-t2-lww-stale'));
        cleanup.defer(async () => {
          await rootApi.delete(`/api/auth/tokens/${pat.id}`);
        });

        const authed = rootApi.withToken(pat.token);
        const taskId = makeUuidV7();
        const newerTitle = `Newer Server Title ${uniqueId('newer')}`;
        const staleTitle = `Stale Offline Edit ${uniqueId('stale')}`;
        const newerIso = '2026-11-14T18:00:00.000Z';
        const staleIso = '2020-01-01T00:00:00.000Z';

        const firstPush = await authed.post('/api/sync/push', {
          client_id: uniqueId('mob-newer'),
          mutations: [
            {
              mutation_id: makeUuidV7(),
              entity_table: 'tasks',
              entity_id: taskId,
              op: 'upsert',
              client_updated_at: newerIso,
              payload: {
                id: taskId,
                title: newerTitle,
                status: 'in_progress',
                priority: 'high',
                energy_level: 'deep',
                estimated_minutes: 45,
                updated_at: newerIso,
                client_updated_at: newerIso,
              },
            },
          ],
        });
        expect(firstPush.status).toBe(200);

        cleanup.defer(async () => {
          await authed.delete(`/api/tasks/${taskId}`);
        });

        const stalePush = await authed.post('/api/sync/push', {
          client_id: uniqueId('mob-stale'),
          mutations: [
            {
              mutation_id: makeUuidV7(),
              entity_table: 'tasks',
              entity_id: taskId,
              op: 'upsert',
              client_updated_at: staleIso,
              payload: {
                id: taskId,
                title: staleTitle,
                status: 'todo',
                priority: 'low',
                energy_level: 'shallow',
                estimated_minutes: 15,
                updated_at: staleIso,
                client_updated_at: staleIso,
              },
            },
          ],
        });
        expect(stalePush.status).toBe(200);

        const conflictsResolved = Number(
          stalePush.json?.conflicts_resolved ?? stalePush.json?.conflicts ?? 0,
        );
        const appliedCount = Number(stalePush.json?.applied_count ?? 0);
        expect(conflictsResolved >= 1 || appliedCount === 0).toBe(true);

        const tasksRes = await authed.get('/api/tasks');
        expect(tasksRes.status).toBe(200);
        const tasks = unwrapList<any>(tasksRes, ['tasks', 'items', 'data']);
        const persisted = tasks.find((t) => String(t.id) === taskId);
        expect(persisted).toBeTruthy();
        expect(String(persisted.title)).toBe(newerTitle);
        expect(String(persisted.title)).not.toBe(staleTitle);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F08] concurrent UUIDv7 creations from two offline clients merge via append-only set-union and idempotent mutation_id replay',
    { tag: ['@tier2', '@F08'] },
    async () => {
      const cleanup = new CleanupRegistry();
      try {
        const rootApi = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(rootApi, uniqueId('f08-t2-set-union'));
        cleanup.defer(async () => {
          await rootApi.delete(`/api/auth/tokens/${pat.id}`);
        });

        const authed = rootApi.withToken(pat.token);
        const initialPull = await authed.get('/api/sync/pull?since=0');
        expect(initialPull.status).toBe(200);
        const baseSeq = extractServerSeq(initialPull);

        const baseMs = Date.now();
        const taskA = makeUuidV7(baseMs);
        const sessA = makeUuidV7(baseMs + 1);
        const mutTaskA = makeUuidV7(baseMs + 2);
        const mutSessA = makeUuidV7(baseMs + 3);

        const taskB = makeUuidV7(baseMs + 4);
        const sessB = makeUuidV7(baseMs + 5);
        const mutTaskB = makeUuidV7(baseMs + 6);
        const mutSessB = makeUuidV7(baseMs + 7);
        const nowIso = new Date(baseMs).toISOString();

        const batchA = {
          client_id: 'offline-device-alpha',
          mutations: [
            {
              mutation_id: mutTaskA,
              entity_table: 'tasks',
              entity_id: taskA,
              op: 'upsert',
              client_updated_at: nowIso,
              payload: {
                id: taskA,
                title: `Device Alpha Task ${uniqueId('alpha')}`,
                status: 'todo',
                priority: 'medium',
                energy_level: 'deep',
                estimated_minutes: 25,
                updated_at: nowIso,
                client_updated_at: nowIso,
              },
            },
            {
              mutation_id: mutSessA,
              entity_table: 'time_sessions',
              entity_id: sessA,
              op: 'upsert',
              client_updated_at: nowIso,
              payload: {
                id: sessA,
                task_id: taskA,
                category: 'deep_work',
                timer_mode: 'stopwatch',
                duration_seconds: 900,
                started_at: nowIso,
                ended_at: nowIso,
                updated_at: nowIso,
                client_updated_at: nowIso,
              },
            },
          ],
        };

        const batchB = {
          client_id: 'offline-device-beta',
          mutations: [
            {
              mutation_id: mutTaskB,
              entity_table: 'tasks',
              entity_id: taskB,
              op: 'upsert',
              client_updated_at: nowIso,
              payload: {
                id: taskB,
                title: `Device Beta Task ${uniqueId('beta')}`,
                status: 'todo',
                priority: 'high',
                energy_level: 'shallow',
                estimated_minutes: 30,
                updated_at: nowIso,
                client_updated_at: nowIso,
              },
            },
            {
              mutation_id: mutSessB,
              entity_table: 'time_sessions',
              entity_id: sessB,
              op: 'upsert',
              client_updated_at: nowIso,
              payload: {
                id: sessB,
                task_id: taskB,
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
        };

        cleanup.defer(async () => {
          await authed.delete(`/api/tasks/${taskA}`);
          await authed.delete(`/api/tasks/${taskB}`);
        });

        const resA = await authed.post('/api/sync/push', batchA);
        expect(resA.status).toBe(200);

        const resB = await authed.post('/api/sync/push', batchB);
        expect(resB.status).toBe(200);

        const replayA = await authed.post('/api/sync/push', batchA);
        expect(replayA.status).toBe(200);

        const pullMerged = await authed.get(`/api/sync/pull?since=${baseSeq}`);
        expect(pullMerged.status).toBe(200);
        const changes = unwrapList<any>(pullMerged, ['changes', 'mutations', 'items']);
        const syncedIds = new Set(changes.map((c) => String(c.entity_id ?? c.id ?? '')));

        expect(syncedIds.has(taskA)).toBe(true);
        expect(syncedIds.has(taskB)).toBe(true);
        expect(syncedIds.has(sessA)).toBe(true);
        expect(syncedIds.has(sessB)).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F08] delete operation emits tombstone in delta pull and invalid op or malformed payload returns 400/422',
    { tag: ['@tier2', '@F08'] },
    async () => {
      const cleanup = new CleanupRegistry();
      try {
        const rootApi = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(rootApi, uniqueId('f08-t2-tombstone'));
        cleanup.defer(async () => {
          await rootApi.delete(`/api/auth/tokens/${pat.id}`);
        });

        const authed = rootApi.withToken(pat.token);
        const nowMs = Date.now();
        const taskToDelete = makeUuidV7(nowMs);
        const createIso = new Date(nowMs).toISOString();

        const createPush = await authed.post('/api/sync/push', {
          client_id: uniqueId('mob-del'),
          mutations: [
            {
              mutation_id: makeUuidV7(nowMs + 1),
              entity_table: 'tasks',
              entity_id: taskToDelete,
              op: 'upsert',
              client_updated_at: createIso,
              payload: {
                id: taskToDelete,
                title: `Task To Tombstone ${uniqueId('del')}`,
                status: 'todo',
                priority: 'medium',
                energy_level: 'quick',
                estimated_minutes: 15,
                updated_at: createIso,
                client_updated_at: createIso,
              },
            },
          ],
        });
        expect(createPush.status).toBe(200);
        const cursorAfterCreate = extractServerSeq(createPush);

        const deleteIso = new Date(nowMs + 5_000).toISOString();
        const deletePush = await authed.post('/api/sync/push', {
          client_id: uniqueId('mob-del'),
          mutations: [
            {
              mutation_id: makeUuidV7(nowMs + 2),
              entity_table: 'tasks',
              entity_id: taskToDelete,
              op: 'delete',
              client_updated_at: deleteIso,
              payload: {
                id: taskToDelete,
                deleted_at: deleteIso,
                updated_at: deleteIso,
              },
            },
          ],
        });
        expect(deletePush.status).toBe(200);

        const pullDelta = await authed.get(`/api/sync/pull?since=${cursorAfterCreate}`);
        expect(pullDelta.status).toBe(200);
        const changes = unwrapList<any>(pullDelta, ['changes', 'mutations', 'items']);
        const tombstone = changes.find(
          (c) =>
            String(c.entity_id ?? c.id) === taskToDelete &&
            String(c.op ?? c.operation).toLowerCase() === 'delete',
        );
        expect(tombstone).toBeTruthy();

        const invalidOpRes = await authed.post('/api/sync/push', {
          client_id: uniqueId('mob-bad-op'),
          mutations: [
            {
              mutation_id: makeUuidV7(),
              entity_table: 'tasks',
              entity_id: makeUuidV7(),
              op: 'drop_table',
              client_updated_at: deleteIso,
              payload: {},
            },
          ],
        });
        expect([400, 422]).toContain(invalidOpRes.status);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  // =========================================================================
  // Feature F36: Full-Stack Production Verification & Readiness (5 Tier 2 Tests)
  // =========================================================================

  test(
    '[T2][F36] SPA deep-link fallback serves 200 HTML for all Web routes while unknown /api/* routes return 404 without HTML leakage',
    { tag: ['@tier2', '@F36'] },
    async () => {
      const api = createApiClient(E2E_URLS.baseUrl);
      const webRoutes = [
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

      for (const routePath of webRoutes) {
        const res = await api.raw(`${E2E_URLS.baseUrl}${routePath}`, {
          headers: { Accept: 'text/html,application/xhtml+xml' },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type') || '').toContain('text/html');
        expect(res.text).toContain('<div id="root">');
      }

      const unknownApiRes = await api.get('/api/non-existent-endpoint-f36-boundary');
      expect(unknownApiRes.status).toBe(404);
      expect(unknownApiRes.text).not.toMatch(/<!DOCTYPE\s+html/i);
    },
  );

  test(
    '[T2][F36] isolated backend with unreachable hermes gateway port starts cleanly in offline_mock mode with zero 500 errors',
    { tag: ['@tier2', '@F36'] },
    async () => {
      await withIsolatedBackend(
        { HERMES_GATEWAY_URL: 'http://127.0.0.1:59999/v1' },
        async ({ baseUrl }) => {
          const isolatedApi = createApiClient(baseUrl);
          const healthRes = await isolatedApi.get('/api/health');
          expect(healthRes.status).toBe(200);
          expect(healthRes.json?.status).toBe('ok');
          expect(healthRes.json?.db_online).toBe(true);
          expect(healthRes.json?.hermes_gateway).toBe('offline_mock');
        },
      );
    },
  );

  test(
    '[T2][F36] scripts/git-hooks/pre-commit blocks staged .sqlite/.env files and leaked credentials in an isolated temp git repo',
    { tag: ['@tier2', '@F36'] },
    async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-f36-precommit-'));
      try {
        execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'pipe' });
        execFileSync('git', ['config', 'user.email', 'test@hermes.local'], {
          cwd: tmpDir,
          stdio: 'pipe',
        });
        execFileSync('git', ['config', 'user.name', 'Hermes Test'], {
          cwd: tmpDir,
          stdio: 'pipe',
        });

        const srcHook = path.join(E2E_PATHS.repoRoot, 'scripts', 'git-hooks', 'pre-commit');
        const dstHook = path.join(tmpDir, 'pre-commit');
        fs.copyFileSync(srcHook, dstHook);

        const sqlitePath = path.join(tmpDir, 'leak.sqlite');
        fs.writeFileSync(sqlitePath, 'SQLite format 3', 'utf8');
        execFileSync('git', ['add', '-f', 'leak.sqlite'], { cwd: tmpDir, stdio: 'pipe' });

        const sqliteRun = spawnSync('python3', [dstHook], {
          cwd: tmpDir,
          encoding: 'utf8',
        });
        expect(sqliteRun.status).not.toBe(0);
        expect(`${sqliteRun.stdout}\n${sqliteRun.stderr}`).toContain(
          'refusing to commit possible credentials',
        );

        execFileSync('git', ['rm', '--cached', '-f', 'leak.sqlite'], {
          cwd: tmpDir,
          stdio: 'pipe',
        });
        fs.unlinkSync(sqlitePath);

        const secretFile = path.join(tmpDir, 'config.py');
        const syntheticApiKey = ['sk', 'proj', '1234567890abcdef1234567890abcdef'].join('-');
        fs.writeFileSync(
          secretFile,
          `api_key = "${syntheticApiKey}"\n`,
          'utf8',
        );
        execFileSync('git', ['add', '-f', 'config.py'], { cwd: tmpDir, stdio: 'pipe' });

        const secretRun = spawnSync('python3', [dstHook], {
          cwd: tmpDir,
          encoding: 'utf8',
        });
        expect(secretRun.status).not.toBe(0);
        expect(`${secretRun.stdout}\n${secretRun.stderr}`).toContain(
          'refusing to commit possible credentials',
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );

  test(
    '[T2][F36] .gitignore blocks private data/, .env, and *.sqlite files while never ignoring backend/crates/server or .npmrc',
    { tag: ['@tier2', '@F36'] },
    async () => {
      for (const ignoredCandidate of [
        'data/second-brain/secret-note.md',
        '.env',
        'test-leak.sqlite',
      ]) {
        const res = spawnSync('git', ['check-ignore', '-q', ignoredCandidate], {
          cwd: E2E_PATHS.repoRoot,
        });
        expect(res.status).toBe(0);
      }

      for (const trackedCandidate of ['backend/crates/server/Cargo.toml', '.npmrc']) {
        const res = spawnSync('git', ['check-ignore', '-q', trackedCandidate], {
          cwd: E2E_PATHS.repoRoot,
        });
        expect(res.status).toBe(1);
      }
    },
  );

  test(
    '[T2][F36] mobile static bundle server rejects path traversal and mobile bundle excludes desktop-only module routes',
    { tag: ['@tier2', '@F36'] },
    async () => {
      const mobileApi = createApiClient(E2E_URLS.mobileUrl);
      for (const probePath of [
        '/..%2f..%2fpackage.json',
        '/..%2F..%2Fpackage.json',
        '/../package.json',
      ]) {
        const res = await mobileApi.raw(`${E2E_URLS.baseUrl}${probePath}`);
        expect([400, 403, 404]).toContain(res.status);
        expect(res.text).not.toContain('"name": "personal-life-manager"');
      }

      const assetsDir = path.join(E2E_PATHS.mobileDistDir, 'assets');
      expect(fs.existsSync(assetsDir)).toBe(true);
      const jsFiles = fs
        .readdirSync(assetsDir)
        .filter((f) => f.endsWith('.js'))
        .map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8'))
        .join('\n');

      expect(jsFiles.length).toBeGreaterThan(100);
      expect(jsFiles).toMatch(/ROUTINES/i);
      expect(jsFiles).toMatch(/TODOS/i);
      expect(jsFiles).toMatch(/COMPANION/i);
      expect(jsFiles).toMatch(/UPLINK/i);
      expect(jsFiles).not.toMatch(
        /RoomMonitor|FinanceOperator|IdealWeek|BlueprintCanvas|WaffleGrid10x20/,
      );
      expect(jsFiles).not.toMatch(
        /waffle-grid-10x20|candlestick-chart|paired-hatch-bar-chart|geodesic-thinking-orb|constellation-mesh/,
      );
      expect(jsFiles).not.toMatch(
        /Expand in Full Hermes View|Weekly Review Wizard|Eisenhower Matrix/,
      );
    },
  );
});
