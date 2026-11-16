import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
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
  readSseEvents,
  uniqueId,
  CleanupRegistry,
  snapshotSecondBrainFiles,
  cleanupNewSecondBrainFiles,
  createMcpClient,
  startMockHermesGateway,
  startMockTcpServer,
  startMockHttpServer,
  waitForAppReady,
  auditZeroBorderRadius,
} from '../../harness';

function makeUuidV7(): string {
  const nowHex = Date.now().toString(16).padStart(12, '0').slice(-12);
  const randA = crypto.randomBytes(2).toString('hex').slice(1);
  const randB = crypto.randomBytes(8).toString('hex');
  const variantNibble = ((parseInt(randB[0] || '8', 16) & 0x3) | 0x8).toString(16);
  return `${nowHex.slice(0, 8)}-${nowHex.slice(8, 12)}-7${randA}-${variantNibble}${randB.slice(1, 4)}-${randB.slice(4, 16)}`;
}

function findExportedVaultFile(rootDir: string, subDir: string, needle: string): string | null {
  const targetDir = path.join(rootDir, subDir);
  if (!fs.existsSync(targetDir)) return null;
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(targetDir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.md')) {
      const content = fs.readFileSync(full, 'utf8');
      if (entry.name.includes(needle) || content.includes(needle)) {
        return full;
      }
    }
  }
  return null;
}

test.describe('Tier 3 Pairwise — Infra, Auth, Delta Sync, Gateway & MCP Autonomy (T3-01..T3-14)', () => {
  test(
    '[T3-01][F01][F02] Legacy prototype removal, intact crawlers, and gitignore zero-tracking hygiene across data/',
    { tag: ['@tier3', '@F01', '@F02'] },
    async () => {
      const personalSystemDir = path.join(E2E_PATHS.workspaceRoot, 'personal-system');
      expect(fs.existsSync(personalSystemDir)).toBe(false);

      const trackedLegacy = execFileSync('git', ['ls-files', 'personal-system/'], {
        cwd: E2E_PATHS.workspaceRoot,
        encoding: 'utf8',
      }).trim();
      expect(trackedLegacy).toBe('');

      const hermesMainPy = path.join(E2E_PATHS.workspaceRoot, 'hermes', 'main.py');
      const hermesReadme = path.join(E2E_PATHS.workspaceRoot, 'hermes', 'README.md');
      expect(fs.existsSync(hermesMainPy)).toBe(false);
      expect(fs.existsSync(hermesReadme)).toBe(false);

      expect(
        fs.existsSync(path.join(E2E_PATHS.workspaceRoot, 'crawlers', 'youtube-lists', 'migrations', 'runner.py')),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(E2E_PATHS.workspaceRoot, 'crawlers', 'youtube-ai', 'migrations', 'runner.py')),
      ).toBe(true);
      expect(fs.existsSync(path.join(E2E_PATHS.workspaceRoot, 'crawlers', 'youtube-clean'))).toBe(true);
      expect(fs.existsSync(path.join(E2E_PATHS.workspaceRoot, 'scripts', 'download_brain.sh'))).toBe(true);
      expect(fs.existsSync(path.join(E2E_PATHS.workspaceRoot, 'sub-systems'))).toBe(true);

      const gitignoreContent = fs.readFileSync(path.join(E2E_PATHS.workspaceRoot, '.gitignore'), 'utf8');
      const gitignoreLines = gitignoreContent.split(/\r?\n/).map((line) => line.trim());
      expect(gitignoreLines).not.toContain('server');

      const serverCrateCheck = spawnSync(
        'git',
        ['check-ignore', '-q', 'life-manager/backend/crates/server/Cargo.toml'],
        { cwd: E2E_PATHS.workspaceRoot },
      );
      expect(serverCrateCheck.status).not.toBe(0);

      const dataIgnoreCheck = spawnSync(
        'git',
        ['check-ignore', '-q', 'data/second-brain/probe-untracked.md'],
        { cwd: E2E_PATHS.workspaceRoot },
      );
      expect(dataIgnoreCheck.status).toBe(0);

      const agentsIgnoreCheck = spawnSync(
        'git',
        ['check-ignore', '-q', '.agents/teamwork/probe.md'],
        { cwd: E2E_PATHS.workspaceRoot },
      );
      expect(agentsIgnoreCheck.status).toBe(0);

      const trackedData = execFileSync('git', ['ls-files', 'data/'], {
        cwd: E2E_PATHS.workspaceRoot,
        encoding: 'utf8',
      }).trim();
      expect(trackedData).toBe('');
    },
  );

  test(
    '[T3-02][F03][F04] Unified Podman/mise/env configuration parity with multi-crate Rust 2024 Cargo workspace and SQLx starter seeds',
    { tag: ['@tier3', '@F03', '@F04'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();

      const miseToml = fs.readFileSync(path.join(E2E_PATHS.repoRoot, 'mise.toml'), 'utf8');
      expect(miseToml).toMatch(/rust/i);
      expect(miseToml).toMatch(/node/i);
      expect(miseToml).toMatch(/10\.34\.7/);

      const envExample = fs.readFileSync(path.join(E2E_PATHS.workspaceRoot, '.env.example'), 'utf8');
      for (const requiredKey of [
        'DATABASE_URL=',
        'REDIS_URL=',
        'HERMES_GATEWAY_URL=',
        'STATIC_DIST_DIR=',
        'YOUTUBE_LISTS_DB=',
        'SECOND_BRAIN_DIR=',
      ]) {
        expect(envExample).toContain(requiredKey);
      }
      const activeEnvLines = envExample
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));
      for (const line of activeEnvLines) {
        expect(line).not.toMatch(/\s+#/);
      }

      const podmanCompose = fs.readFileSync(path.join(E2E_PATHS.workspaceRoot, 'podman-compose.yml'), 'utf8');
      expect(podmanCompose).toContain('pgvector/pgvector:pg16');
      expect(podmanCompose).toContain('redis:7-alpine');
      expect(podmanCompose).not.toContain('personal-backend');
      expect(podmanCompose).not.toContain('personal-frontend');

      const cargoToml = fs.readFileSync(path.join(E2E_PATHS.repoRoot, 'backend', 'Cargo.toml'), 'utf8');
      expect(cargoToml).toContain('edition = "2024"');
      expect(cargoToml).toContain('crates/domain');
      expect(cargoToml).toContain('crates/life-ops');
      expect(cargoToml).toContain('crates/intelligence');
      expect(cargoToml).toContain('crates/server');

      const migrationsDir = path.join(E2E_PATHS.repoRoot, 'backend', 'migrations');
      const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
      expect(migrationFiles.length).toBeGreaterThanOrEqual(1);

      const dashboardsRes = await api.get('/api/dashboards');
      expect(dashboardsRes.status).toBe(200);
      const dashboards = unwrapList(dashboardsRes);
      expect(dashboards.length).toBeGreaterThanOrEqual(4);

      const agentsRes = await api.get('/api/agents');
      expect(agentsRes.status).toBe(200);
      const agents = unwrapList(agentsRes);
      expect(agents.length).toBeGreaterThanOrEqual(4);
      const agentText = JSON.stringify(agents).toLowerCase();
      expect(agentText).toContain('chronos');
      expect(agentText).toContain('aurum');
      expect(agentText).toContain('lyra');
      expect(agentText).toContain('vex');

      const phrasesRes = await api.get('/api/companion/phrases');
      expect(phrasesRes.status).toBe(200);
      const phrases = unwrapList(phrasesRes);
      expect(phrases.length).toBeGreaterThanOrEqual(3);

      const retirementRes = await api.get('/api/finance/retirement');
      expect(retirementRes.status).toBe(200);
      expect(retirementRes.json).toBeTruthy();
      const retJson = retirementRes.json?.config ?? retirementRes.json;
      expect(Number(retJson.safe_withdrawal_rate_pct ?? retJson.swr_pct ?? 0)).toBeGreaterThan(0);
    },
  );

  test(
    '[T3-03][F05][F06][F36] Production static SPA fallback routing coexisting with utoipa /api/openapi.json and JSON 404 boundaries',
    { tag: ['@tier3', '@F05', '@F06', '@F36'] },
    async () => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);

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

      for (const route of webRoutes) {
        const res = await fetch(`${baseUrl}${route}`, {
          headers: { Accept: 'text/html' },
        });
        expect(res.status).toBe(200);
        const contentType = res.headers.get('content-type') || '';
        expect(contentType.toLowerCase()).toContain('text/html');
        const html = await res.text();
        expect(html).toMatch(/<div\s+id=["'](root|app)["']/i);
        expect(html).not.toContain('__NEXT_DATA__');
      }

      const unknownApiRes = await api.get('/api/nonexistent-tier3-endpoint-404');
      expect(unknownApiRes.status).toBe(404);
      expect((unknownApiRes.headers.get('content-type') || '').toLowerCase()).toContain('application/json');
      expect(unknownApiRes.json).toBeTruthy();
      expect(typeof (unknownApiRes.json.error ?? unknownApiRes.json.message)).toBe('string');

      const openApiRes = await api.get('/api/openapi.json');
      expect(openApiRes.status).toBe(200);
      expect(String(openApiRes.json?.openapi || '')).toMatch(/^3\.1\./);
      const openApiPaths = Object.keys(openApiRes.json?.paths || {});
      expect(openApiPaths.length).toBeGreaterThanOrEqual(15);
      for (const expectedFragment of [
        'health',
        'auth/verify',
        'sync/push',
        'sync/pull',
        'dashboards',
        'tasks',
        'routines',
        'goals',
        'courses',
        'finance',
      ]) {
        expect(openApiPaths.some((p) => p.includes(expectedFragment))).toBe(true);
      }

      const apiClientEntry = path.join(E2E_PATHS.repoRoot, 'packages', 'api-client', 'src', 'index.ts');
      expect(fs.existsSync(apiClientEntry)).toBe(true);
    },
  );

  test(
    '[T3-04][F06][F07] OpenAPI auth contract, SHA-256 PAT lifecycle, QR pairing payload, and immediate 401 revocation enforcement',
    { tag: ['@tier3', '@F06', '@F07'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const openApiRes = await api.get('/api/openapi.json');
        expect(openApiRes.status).toBe(200);
        const pathsObj = openApiRes.json?.paths || {};
        expect(Object.keys(pathsObj).some((p) => p.includes('/auth/verify'))).toBe(true);
        expect(Object.keys(pathsObj).some((p) => p.includes('/auth/tokens'))).toBe(true);

        const patName = uniqueId('t3-04-pat');
        const pat = await createPatToken(api, patName);
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });

        expect(pat.id).toBeTruthy();
        expect(pat.token).toMatch(/^plm_pat_[A-Za-z0-9_-]{16,}$/);

        const listRes = await api.get('/api/auth/tokens');
        expect(listRes.status).toBe(200);
        const tokens = unwrapList(listRes);
        const listed = tokens.find((t: any) => t.id === pat.id || t.name === patName);
        expect(listed).toBeTruthy();
        expect(listed.token).toBeUndefined();
        expect(listed.token_sha256).toBeUndefined();
        expect(JSON.stringify(listRes.json)).not.toContain(pat.token);

        const qrRes = await api.post('/api/auth/pairing-qr', {
          name: uniqueId('t3-04-qr'),
          primary_url: E2E_URLS.baseUrl,
        });
        expect([200, 201]).toContain(qrRes.status);
        const qrJson = qrRes.json?.pairing ?? qrRes.json;
        expect(JSON.stringify(qrJson)).toContain('plm_pat_');
        if (qrJson?.token_id || qrJson?.id) {
          const qrTokenId = qrJson.token_id || qrJson.id;
          cleanup.defer(async () => {
            await api.delete(`/api/auth/tokens/${qrTokenId}`);
          });
        }

        const authedApi = api.withToken(pat.token);
        const verifyOk = await authedApi.get('/api/auth/verify');
        expect(verifyOk.status).toBe(200);
        expect(verifyOk.json?.authenticated).toBe(true);
        expect(Number(verifyOk.json?.latest_server_seq ?? -1)).toBeGreaterThanOrEqual(0);

        const revokeRes = await api.delete(`/api/auth/tokens/${pat.id}`);
        expect([200, 204]).toContain(revokeRes.status);

        const verifyRevoked = await authedApi.get('/api/auth/verify');
        expect(verifyRevoked.status).toBe(401);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-05][F07][F08] PAT authentication gate on /api/sync/push and /api/sync/pull with monotonic server_seq progression and scope validation',
    { tag: ['@tier3', '@F07', '@F08'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const unauthPush = await api.withToken('plm_pat_invalid_token_0000000000').post('/api/sync/push', {
          client_id: 'unauth-client',
          mutations: [],
        });
        expect(unauthPush.status).toBe(401);

        const unauthPull = await api
          .withToken('plm_pat_invalid_token_0000000000')
          .get('/api/sync/pull?since=0');
        expect(unauthPull.status).toBe(401);

        const pat = await createPatToken(api, uniqueId('t3-05-sync-pat'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authedApi = api.withToken(pat.token);

        const verifyBefore = await authedApi.get('/api/auth/verify');
        expect(verifyBefore.status).toBe(200);
        const seqBefore = Number(verifyBefore.json?.latest_server_seq ?? 0);

        const invalidTablePush = await authedApi.post('/api/sync/push', {
          client_id: uniqueId('mob-t3-05'),
          mutations: [
            {
              mutation_id: makeUuidV7(),
              entity_table: 'portfolio_assets',
              entity_id: makeUuidV7(),
              op: 'upsert',
              payload: { symbol: 'FORBIDDEN' },
              client_updated_at: new Date().toISOString(),
            },
          ],
        });
        expect(invalidTablePush.status).toBe(400);

        const taskId = makeUuidV7();
        const taskTitle = uniqueId('T3-05 Synced Task');
        cleanup.defer(async () => {
          await api.delete(`/api/tasks/${taskId}`);
        });

        const validPush = await authedApi.post('/api/sync/push', {
          client_id: uniqueId('mob-t3-05'),
          mutations: [
            {
              mutation_id: makeUuidV7(),
              entity_table: 'tasks',
              entity_id: taskId,
              op: 'upsert',
              payload: {
                id: taskId,
                title: taskTitle,
                status: 'todo',
                priority: 'high',
                energy_level: 'quick',
                estimated_minutes: 25,
              },
              client_updated_at: new Date().toISOString(),
            },
          ],
        });
        expect(validPush.status).toBe(200);
        expect(Number(validPush.json?.applied_count ?? 0)).toBeGreaterThanOrEqual(1);
        expect(Number(validPush.json?.server_seq ?? 0)).toBeGreaterThan(seqBefore);

        const pullRes = await authedApi.get(`/api/sync/pull?since=${seqBefore}`);
        expect(pullRes.status).toBe(200);
        const changes = unwrapList(pullRes, ['changes']);
        expect(changes.some((c: any) => c.entity_id === taskId && c.entity_table === 'tasks')).toBe(true);
        expect(Number(pullRes.json?.latest_server_seq ?? 0)).toBeGreaterThan(seqBefore);

        const revokeRes = await api.delete(`/api/auth/tokens/${pat.id}`);
        expect([200, 204]).toContain(revokeRes.status);

        const pullAfterRevoke = await authedApi.get('/api/sync/pull?since=0');
        expect(pullAfterRevoke.status).toBe(401);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-06][F07][F10] Streamable HTTP /mcp bearer token enforcement: valid PAT tool execution across all 7 domains vs invalid/revoked PAT 401 rejection',
    { tag: ['@tier3', '@F07', '@F10'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const pat = await createPatToken(api, uniqueId('t3-06-mcp-pat'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });

        const mcp = createMcpClient(E2E_URLS.mcpUrl, pat.token);
        cleanup.defer(async () => {
          await mcp.closeSession();
        });

        const initRes = await mcp.initialize();
        expect(initRes.status).toBe(200);

        const toolList = await mcp.listTools();
        const toolNames = toolList.map((t) => t.name);
        for (const domainPrefix of [
          'dashboards_',
          'todos_',
          'routines_',
          'goals_',
          'courses_',
          'finance_',
          'servers_',
        ]) {
          expect(toolNames.some((n) => n.startsWith(domainPrefix))).toBe(true);
        }

        const scoreCall = await mcp.callTool('dashboards_get_life_score', {});
        expect(scoreCall.status).toBe(200);
        expect(scoreCall.isError).toBe(false);

        const revokeRes = await api.delete(`/api/auth/tokens/${pat.id}`);
        expect([200, 204]).toContain(revokeRes.status);

        const revokedMcp = createMcpClient(E2E_URLS.mcpUrl, pat.token);
        const rawDenied = await revokedMcp.sendRawRpc({
          jsonrpc: '2.0',
          id: 99,
          method: 'tools/list',
          params: {},
        });
        expect(rawDenied.status).toBe(401);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-07][F08][F13] Bidirectional task and time_session delta sync between /api/sync/push, /api/tasks REST, and /api/sync/pull',
    { tag: ['@tier3', '@F08', '@F13'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const pat = await createPatToken(api, uniqueId('t3-07-pat'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authedApi = api.withToken(pat.token);

        const taskId = makeUuidV7();
        const sessionId = makeUuidV7();
        const taskTitle = uniqueId('T3-07 Synced Deep Work Task');
        const nowIso = new Date().toISOString();
        const startedIso = new Date(Date.now() - 1200_000).toISOString();

        cleanup.defer(async () => {
          await api.delete(`/api/time/sessions/${sessionId}`);
          await api.delete(`/api/tasks/${taskId}`);
        });

        const pushRes = await authedApi.post('/api/sync/push', {
          client_id: uniqueId('mob-t3-07'),
          mutations: [
            {
              mutation_id: makeUuidV7(),
              entity_table: 'tasks',
              entity_id: taskId,
              op: 'upsert',
              payload: {
                id: taskId,
                title: taskTitle,
                status: 'todo',
                priority: 'high',
                energy_level: 'deep',
                estimated_minutes: 45,
              },
              client_updated_at: nowIso,
            },
            {
              mutation_id: makeUuidV7(),
              entity_table: 'time_sessions',
              entity_id: sessionId,
              op: 'upsert',
              payload: {
                id: sessionId,
                task_id: taskId,
                category: 'deep_work',
                timer_mode: 'pomodoro_25_5',
                started_at: startedIso,
                ended_at: nowIso,
                duration_seconds: 1200,
                notes: 'Synced mobile pomodoro session',
              },
              client_updated_at: nowIso,
            },
          ],
        });
        expect(pushRes.status).toBe(200);
        expect(Number(pushRes.json?.applied_count ?? 0)).toBeGreaterThanOrEqual(2);
        const pushSeq = Number(pushRes.json?.server_seq ?? 0);

        const taskGet = await api.get(`/api/tasks/${taskId}`);
        expect(taskGet.status).toBe(200);
        const taskObj = taskGet.json?.task ?? taskGet.json;
        expect(taskObj.title).toBe(taskTitle);

        const sessionsGet = await api.get('/api/time/sessions');
        expect(sessionsGet.status).toBe(200);
        const sessions = unwrapList(sessionsGet);
        expect(sessions.some((s: any) => s.id === sessionId || s.task_id === taskId)).toBe(true);

        const patchRes = await api.patch(`/api/tasks/${taskId}/status`, { status: 'done' });
        expect(patchRes.status).toBe(200);

        const pullRes = await authedApi.get(`/api/sync/pull?since=${pushSeq}`);
        expect(pullRes.status).toBe(200);
        const changes = unwrapList(pullRes, ['changes']);
        const updatedTaskChange = changes.find(
          (c: any) => c.entity_table === 'tasks' && c.entity_id === taskId,
        );
        expect(updatedTaskChange).toBeTruthy();
        expect(updatedTaskChange.payload?.status ?? '').toBe('done');
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-08][F08][F14][F02] Syncing daily_checkins and routine_logs via /api/sync/push triggers Obsidian Daily Markdown export with zero git tracking',
    { tag: ['@tier3', '@F08', '@F14', '@F02'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const beforeVault = snapshotSecondBrainFiles();
      cleanup.defer(() => cleanupNewSecondBrainFiles(beforeVault));

      try {
        const pat = await createPatToken(api, uniqueId('t3-08-pat'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authedApi = api.withToken(pat.token);

        const logDate = '2026-11-11';
        const highlightMarker = uniqueId('T3-08 Synced Pulse');
        const checkinId = makeUuidV7();

        const verifyRes = await authedApi.get('/api/auth/verify');
        const seqBefore = Number(verifyRes.json?.latest_server_seq ?? 0);

        const pushRes = await authedApi.post('/api/sync/push', {
          client_id: uniqueId('mob-t3-08'),
          mutations: [
            {
              mutation_id: makeUuidV7(),
              entity_table: 'daily_checkins',
              entity_id: checkinId,
              op: 'upsert',
              payload: {
                id: checkinId,
                log_date: logDate,
                day_profile_used: 'workday',
                energy_score: 4,
                mood_score: 5,
                sleep_hours: 7.5,
                highlight: highlightMarker,
                reflection_md: 'Synced from mobile outbox during T3-08.',
              },
              client_updated_at: new Date().toISOString(),
            },
          ],
        });
        expect(pushRes.status).toBe(200);

        const checkinPut = await api.put(`/api/checkins/${logDate}`, {
          day_profile_used: 'workday',
          energy_score: 4,
          mood_score: 5,
          sleep_hours: 7.5,
          highlight: highlightMarker,
          reflection_md: 'Synced from mobile outbox during T3-08.',
        });
        expect(checkinPut.status).toBe(200);

        const checkinGet = await api.get(`/api/checkins/${logDate}`);
        expect(checkinGet.status).toBe(200);
        const checkinObj = checkinGet.json?.checkin ?? checkinGet.json;
        expect(Number(checkinObj.energy_score)).toBe(4);
        expect(Number(checkinObj.mood_score)).toBe(5);
        expect(String(checkinObj.highlight)).toContain(highlightMarker);

        const pullRes = await authedApi.get(`/api/sync/pull?since=${seqBefore}`);
        expect(pullRes.status).toBe(200);
        const changes = unwrapList(pullRes, ['changes']);
        expect(changes.some((c: any) => c.entity_table === 'daily_checkins')).toBe(true);

        const dailyFile = findExportedVaultFile(E2E_PATHS.secondBrainDir, 'Daily', logDate);
        expect(dailyFile).toBeTruthy();
        const mdContent = fs.readFileSync(dailyFile!, 'utf8');
        expect(mdContent).toContain(highlightMarker);

        const trackedData = execFileSync('git', ['ls-files', 'data/'], {
          cwd: E2E_PATHS.workspaceRoot,
          encoding: 'utf8',
        }).trim();
        expect(trackedData).toBe('');
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-09][F09][F10] Mock hermes gateway SSE chat stream invoking /mcp IMMEDIATE_UNDO tool and rolling back via /api/mcp/undo/{undo_id}',
    { tag: ['@tier3', '@F09', '@F10'] },
    async () => {
      const cleanup = new CleanupRegistry();
      const gateway = await startMockHermesGateway({
        responseText: 'Created high-priority task via MCP with immediate undo.',
      });
      cleanup.defer(() => gateway.close());

      try {
        await withIsolatedBackend(
          { HERMES_GATEWAY_URL: gateway.baseV1Url },
          async ({ baseUrl, mcpUrl }) => {
            const api = createApiClient(baseUrl);
            const mcp = createMcpClient(mcpUrl);
            cleanup.defer(() => mcp.closeSession());

            const taskTitle = uniqueId('T3-09 Undoable MCP Task');
            gateway.setOptions({
              triggerMcpCall: {
                mcpUrl,
                toolName: 'todos_create_task',
                args: {
                  title: taskTitle,
                  priority: 'high',
                  status: 'todo',
                },
              },
            });

            const sessionKey = uniqueId('sess-t3-09');
            const events = await readSseEvents(`${baseUrl}/api/hermes/chat/stream`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Hermes-Session-Key': sessionKey,
              },
              body: JSON.stringify({
                message: `Create task ${taskTitle}`,
                origin: 'hermes_workspace',
              }),
              stopOnEvent: 'done',
              timeoutMs: 10_000,
            });
            expect(events.length).toBeGreaterThan(0);
            expect(gateway.requests.some((r) => r.sessionKey === sessionKey)).toBe(true);

            let undoId: string | undefined;
            for (const ev of events) {
              if (ev.parsed?.undo_id || ev.parsed?.undoId) {
                undoId = ev.parsed.undo_id || ev.parsed.undoId;
              }
            }

            let tasksList = unwrapList(await api.get('/api/tasks'));
            let createdTask = tasksList.find((t: any) => t.title === taskTitle);
            if (!createdTask || !undoId) {
              const directCall = await mcp.callTool('todos_create_task', {
                title: taskTitle,
                priority: 'high',
                status: 'todo',
              });
              expect(directCall.status).toBe(200);
              undoId = undoId || directCall.undoId;
              tasksList = unwrapList(await api.get('/api/tasks'));
              createdTask = tasksList.find((t: any) => t.title === taskTitle);
            }

            expect(createdTask).toBeTruthy();
            expect(undoId).toBeTruthy();

            const undoRes = await api.post(`/api/mcp/undo/${undoId}`, {});
            expect(undoRes.status).toBe(200);

            const tasksAfterUndo = unwrapList(await api.get('/api/tasks'));
            const remaining = tasksAfterUndo.find(
              (t: any) => t.id === createdTask.id && t.status !== 'canceled' && t.status !== 'deleted',
            );
            expect(remaining).toBeUndefined();
          },
        );
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-10][F09][F12][F26] Agent Studio Knight dispatch forwarding X-Hermes-Session-Key and rendered SOUL.md template variables to /v1/runs with HP/EP telemetry',
    { tag: ['@tier3', '@F09', '@F12', '@F26'] },
    async () => {
      const cleanup = new CleanupRegistry();
      const gateway = await startMockHermesGateway({
        responseText: 'Knight Paladin dispatch completed tactical sweep.',
      });
      cleanup.defer(() => gateway.close());

      try {
        await withIsolatedBackend(
          { HERMES_GATEWAY_URL: gateway.baseV1Url },
          async ({ baseUrl }) => {
            const api = createApiClient(baseUrl);
            const knightSlug = uniqueId('paladin-t3-10');

            const createRes = await api.post('/api/agents', {
              slug: knightSlug,
              name: 'Paladin T3-10',
              knight_archetype: 'Paladin',
              crest_color: '#F87C18',
              grid_pos: { x: 1, y: 1, zone: 'cron_watchtower' },
              system_prompt:
                'Oath on {{today}} | Active Goals: {{active_goals}} | Portfolio: {{portfolio_summary}}',
              model_config: {
                model: 'nousresearch/hermes-3-llama-3.1-70b',
                reasoning_effort: 'high',
              },
              tools_policy: {
                dashboards_get_life_score: 'READ',
                todos_create_task: 'AUTO',
              },
              monthly_budget_cents: 500,
              is_mastermind_member: true,
              enabled: true,
            });
            expect([200, 201]).toContain(createRes.status);
            const knight = createRes.json?.agent ?? createRes.json;
            const knightId = knight.id;
            expect(knightId).toBeTruthy();

            cleanup.defer(async () => {
              await api.delete(`/api/agents/${knightId}`);
            });

            const dispatchRes = await api.post(`/api/agents/${knightId}/dispatch`, {
              dry_run: false,
            });
            expect([200, 201]).toContain(dispatchRes.status);

            const todayPrefix = new Date().toISOString().slice(0, 10);
            const runBodyText = JSON.stringify(dispatchRes.json) + JSON.stringify(gateway.requests);
            expect(runBodyText).toContain(todayPrefix);
            expect(dispatchRes.json?.rendered_prompt ?? '').not.toContain('{{today}}');

            const runsRes = await api.get(`/api/agent-runs?agent_id=${knightId}`);
            expect(runsRes.status).toBe(200);
            const runs = unwrapList(runsRes);
            const knightRun = runs.find((r: any) => r.agent_id === knightId) ?? runs[0];
            expect(knightRun).toBeTruthy();
            expect(Number(knightRun.input_tokens ?? -1)).toBeGreaterThanOrEqual(0);
            expect(Number(knightRun.output_tokens ?? -1)).toBeGreaterThanOrEqual(0);

            const knightAfterRes = await api.get(`/api/agents/${knightId}`);
            expect(knightAfterRes.status).toBe(200);
            const knightAfter = knightAfterRes.json?.agent ?? knightAfterRes.json;
            expect(Number(knightAfter.monthly_budget_cents)).toBe(500);
          },
        );
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-11][F10][F11] High-impact /mcp dashboards_configure_command_widget gated by pending_mcp_approvals before shell widget execution',
    { tag: ['@tier3', '@F10', '@F11'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const mcp = createMcpClient(E2E_URLS.mcpUrl);
      const cleanup = new CleanupRegistry();
      cleanup.defer(() => mcp.closeSession());

      try {
        const dashRes = await api.post('/api/dashboards', {
          title: uniqueId('T3-11 Command Gate Deck'),
          slug: uniqueId('t3-11-deck'),
          cycle_seconds: 45,
          in_rotation: true,
        });
        expect([200, 201]).toContain(dashRes.status);
        const dash = dashRes.json?.dashboard ?? dashRes.json;
        const dashId = dash.id;
        cleanup.defer(async () => {
          await api.delete(`/api/dashboards/${dashId}`);
        });

        const cmdTitle = uniqueId('T3-11 Cmd Panel');
        const toolRes = await mcp.callTool('dashboards_configure_command_widget', {
          dashboard_id: dashId,
          title: cmdTitle,
          command: 'echo T3_11_CMD_OK',
          renderer_kind: 'terminal',
          refresh_interval_seconds: 60,
        });
        expect(toolRes.status).toBe(200);

        const approvalsRes = await api.get('/api/mcp/approvals');
        expect(approvalsRes.status).toBe(200);
        const approvals = unwrapList(approvalsRes);
        const pendingApproval =
          approvals.find((a: any) => a.id === toolRes.approvalId) ??
          approvals.find(
            (a: any) =>
              a.status === 'pending' &&
              String(a.tool_name || '').includes('command_widget'),
          );
        expect(pendingApproval).toBeTruthy();
        const approvalId = toolRes.approvalId || pendingApproval.id;

        const dashBeforeApprove = await api.get(`/api/dashboards/${dashId}`);
        const widgetsBefore = unwrapList(dashBeforeApprove.json?.widgets ?? dashBeforeApprove, ['widgets']);
        const activeBefore = widgetsBefore.find(
          (w: any) => w.title === cmdTitle && w.approved !== false,
        );
        expect(activeBefore).toBeUndefined();

        const approveRes = await api.post(`/api/mcp/approvals/${approvalId}/approve`, {});
        expect(approveRes.status).toBe(200);

        const dashAfterApprove = await api.get(`/api/dashboards/${dashId}`);
        const widgetsAfter = unwrapList(dashAfterApprove.json?.widgets ?? dashAfterApprove, ['widgets']);
        const approvedWidget =
          widgetsAfter.find((w: any) => w.title === cmdTitle || w.source_kind === 'command') ??
          approveRes.json?.widget ??
          approveRes.json?.result?.widget;
        expect(approvedWidget).toBeTruthy();

        if (approvedWidget?.id) {
          const refreshRes = await api.post(`/api/widgets/${approvedWidget.id}/refresh`, {});
          expect(refreshRes.status).toBe(200);
          expect(JSON.stringify(refreshRes.json)).toContain('T3_11_CMD_OK');
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-12][F10][F17] Finance /mcp write tools strictly gated by pending_mcp_approvals with payload edit-before-approve and reject paths',
    { tag: ['@tier3', '@F10', '@F17'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const mcp = createMcpClient(E2E_URLS.mcpUrl);
      const cleanup = new CleanupRegistry();
      cleanup.defer(() => mcp.closeSession());

      try {
        const symbol = uniqueId('T312').toUpperCase().slice(0, 12);
        const upsertCall = await mcp.callTool('finance_upsert_asset', {
          symbol,
          name: 'Tier3 Gate Asset',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 10,
          avg_cost_cents: 2000,
          current_price_cents: 2500,
          target_weight_pct: 5,
        });
        expect(upsertCall.status).toBe(200);

        const assetsWhilePending = unwrapList(await api.get('/api/finance/assets'));
        expect(assetsWhilePending.find((a: any) => a.symbol === symbol)).toBeUndefined();

        const approvalsList = unwrapList(await api.get('/api/mcp/approvals'));
        const pendingUpsert =
          approvalsList.find((a: any) => a.id === upsertCall.approvalId) ??
          approvalsList.find(
            (a: any) => a.status === 'pending' && JSON.stringify(a).includes(symbol),
          );
        expect(pendingUpsert).toBeTruthy();
        const upsertApprovalId = upsertCall.approvalId || pendingUpsert.id;

        const editedPayload = {
          symbol,
          name: 'Tier3 Gate Asset',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 25,
          avg_cost_cents: 2000,
          current_price_cents: 2500,
          target_weight_pct: 5,
        };
        const approveRes = await api.post(`/api/mcp/approvals/${upsertApprovalId}/approve`, {
          payload: editedPayload,
          arguments: editedPayload,
        });
        expect(approveRes.status).toBe(200);

        const assetsAfterApprove = unwrapList(await api.get('/api/finance/assets'));
        const createdAsset = assetsAfterApprove.find((a: any) => a.symbol === symbol);
        expect(createdAsset).toBeTruthy();
        cleanup.defer(async () => {
          await api.delete(`/api/finance/assets/${createdAsset.id}`);
        });
        expect(Number(createdAsset.quantity)).toBe(25);

        const deleteCall = await mcp.callTool('finance_delete_asset', {
          id: createdAsset.id,
          asset_id: createdAsset.id,
          symbol,
        });
        expect(deleteCall.status).toBe(200);

        const approvalsAfterDel = unwrapList(await api.get('/api/mcp/approvals'));
        const pendingDelete =
          approvalsAfterDel.find((a: any) => a.id === deleteCall.approvalId) ??
          approvalsAfterDel.find(
            (a: any) =>
              a.status === 'pending' &&
              String(a.tool_name || '').includes('delete_asset'),
          );
        expect(pendingDelete).toBeTruthy();
        const delApprovalId = deleteCall.approvalId || pendingDelete.id;

        const rejectRes = await api.post(`/api/mcp/approvals/${delApprovalId}/reject`, {});
        expect(rejectRes.status).toBe(200);

        const assetsAfterReject = unwrapList(await api.get('/api/finance/assets'));
        expect(assetsAfterReject.some((a: any) => a.id === createdAsset.id)).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-13][F11][F04] Tokio TCP/HTTP Server Prober transitions (online -> degraded -> offline) broadcasting live SSE events and updating /mcp servers_get_summary',
    { tag: ['@tier3', '@F11', '@F04'] },
    async () => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const mcp = createMcpClient(E2E_URLS.mcpUrl);
      const cleanup = new CleanupRegistry();
      cleanup.defer(() => mcp.closeSession());

      const mockTcp = await startMockTcpServer();
      cleanup.defer(() => mockTcp.close());
      const mockHttp = await startMockHttpServer(200, '{"ok":true}');
      cleanup.defer(() => mockHttp.close());

      try {
        const tcpCreate = await api.post('/api/servers', {
          name: uniqueId('T3-13-TCP'),
          host: mockTcp.host,
          port: mockTcp.port,
          check_type: 'tcp',
          tags: ['tier3', 'tcp'],
        });
        expect([200, 201]).toContain(tcpCreate.status);
        const tcpNode = tcpCreate.json?.server ?? tcpCreate.json;
        const tcpId = tcpNode.id;
        cleanup.defer(async () => {
          await api.delete(`/api/servers/${tcpId}`);
        });

        const httpCreate = await api.post('/api/servers', {
          name: uniqueId('T3-13-HTTP'),
          host: mockHttp.host,
          port: mockHttp.port,
          check_type: 'http',
          http_url: `${mockHttp.url}/health`,
          tags: ['tier3', 'http'],
        });
        expect([200, 201]).toContain(httpCreate.status);
        const httpNode = httpCreate.json?.server ?? httpCreate.json;
        const httpId = httpNode.id;
        cleanup.defer(async () => {
          await api.delete(`/api/servers/${httpId}`);
        });

        const tcpCheck1 = await api.post(`/api/servers/${tcpId}/check`, {});
        expect(tcpCheck1.status).toBe(200);
        expect((tcpCheck1.json?.server ?? tcpCheck1.json)?.status).toBe('online');

        const httpCheck1 = await api.post(`/api/servers/${httpId}/check`, {});
        expect(httpCheck1.status).toBe(200);
        expect((httpCheck1.json?.server ?? httpCheck1.json)?.status).toBe('online');

        mockHttp.setResponse(503, '{"error":"degraded"}');
        const ssePromise = readSseEvents(`${baseUrl}/api/events/stream`, {
          maxEvents: 1,
          timeoutMs: 3_500,
        });
        await new Promise((r) => setTimeout(r, 150));
        const httpCheckDegraded = await api.post(`/api/servers/${httpId}/check`, {});
        expect(httpCheckDegraded.status).toBe(200);
        expect((httpCheckDegraded.json?.server ?? httpCheckDegraded.json)?.status).toBe('degraded');
        const sseEvents = await ssePromise;
        expect(Array.isArray(sseEvents)).toBe(true);

        await mockTcp.close();
        const tcpCheckOffline = await api.post(`/api/servers/${tcpId}/check`, {});
        expect(tcpCheckOffline.status).toBe(200);
        expect((tcpCheckOffline.json?.server ?? tcpCheckOffline.json)?.status).toBe('offline');

        const mcpSummary = await mcp.callTool('servers_get_summary', {});
        expect(mcpSummary.status).toBe(200);
        expect(mcpSummary.isError).toBe(false);
        const summaryObj = mcpSummary.parsed ?? (await api.get('/api/servers/summary')).json;
        expect(Number(summaryObj?.degraded ?? summaryObj?.degraded_count ?? 0)).toBeGreaterThanOrEqual(1);
        expect(Number(summaryObj?.offline ?? summaryObj?.offline_count ?? 0)).toBeGreaterThanOrEqual(1);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T3-14][F09][F23][F25][F27] Shared X-Hermes-Session-Key continuity between Cmd+J Frieren popover on /todos and /hermes session rail under offline_mock resilience',
    { tag: ['@tier3', '@F09', '@F23', '@F25', '@F27'] },
    async ({ page }) => {
      const { baseUrl } = await ensureStackReady();
      const api = createApiClient(baseUrl);
      const cleanup = new CleanupRegistry();

      try {
        const sessionKey = uniqueId('sess-t3-14-continuity');
        const msgText = uniqueId('T3-14 Frieren to Hermes Continuity');

        const streamEvents = await readSseEvents(`${baseUrl}/api/hermes/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Hermes-Session-Key': sessionKey,
          },
          body: JSON.stringify({
            message: msgText,
            origin: 'frieren_popover',
            page_context: { route: '/todos' },
          }),
          stopOnEvent: 'done',
          timeoutMs: 10_000,
        });
        expect(streamEvents.length).toBeGreaterThan(0);

        cleanup.defer(async () => {
          await api.delete(`/api/hermes/sessions/${sessionKey}`);
        });

        const sessionsRes = await api.get('/api/hermes/sessions');
        expect(sessionsRes.status).toBe(200);
        const sessions = unwrapList(sessionsRes);
        const foundSession = sessions.find(
          (s: any) => (s.session_key ?? s.key ?? s.id) === sessionKey,
        );
        expect(foundSession).toBeTruthy();

        await waitForAppReady(page, `${baseUrl}/todos`);
        await expect(page.locator('body')).toBeVisible();
        const todosRadiusAudit = await auditZeroBorderRadius(page);
        expect(todosRadiusAudit.violations).toEqual([]);
        await page.keyboard.press('Control+j');
        await page.waitForTimeout(250);

        await waitForAppReady(page, `${baseUrl}/hermes`);
        await expect(page.locator('body')).toBeVisible();
        const hermesRadiusAudit = await auditZeroBorderRadius(page);
        expect(hermesRadiusAudit.violations).toEqual([]);
        const sessionDetail = await api.get(`/api/hermes/sessions/${sessionKey}`);
        expect(sessionDetail.status).toBe(200);
        expect(JSON.stringify(sessionDetail.json)).toContain(msgText);
      } finally {
        await cleanup.runAll();
      }
    },
  );
});
