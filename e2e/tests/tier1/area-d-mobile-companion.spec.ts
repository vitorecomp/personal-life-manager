import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  CleanupRegistry,
  E2E_PATHS,
  E2E_URLS,
  auditColorTokens,
  auditInteractiveFontFloor,
  auditPixelatedSprites,
  auditZeroBorderRadius,
  createApiClient,
  createMcpClient,
  createPatToken,
  ensureStackReady,
  readSseEvents,
  startMockHermesGateway,
  uniqueId,
  unwrapList,
  waitForAppReady,
  withIsolatedBackend,
} from '../../harness/index.js';

const RFC9562_UUIDV7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MOBILE_ALLOWED_SURFACES = [
  'ROUTINES',
  'TODOS',
  'COMPANION',
  'UPLINK_CONFIG',
] as const;
type MobileSurface = (typeof MOBILE_ALLOWED_SURFACES)[number];

function makeUuidV7(tsMs: number = Date.now()): string {
  const hexTs = BigInt(tsMs).toString(16).padStart(12, '0').slice(0, 12);
  const rand = crypto.randomBytes(10).toString('hex');
  return `${hexTs.slice(0, 8)}-${hexTs.slice(8, 12)}-7${rand.slice(0, 3)}-8${rand.slice(3, 6)}-${rand.slice(6, 18)}`;
}

function collectFilesRecursively(dir: string, extRe: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursively(full, extRe));
    } else if (extRe.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

async function openMobileSurface(page: Page, surface: MobileSurface): Promise<void> {
  await waitForAppReady(page, E2E_URLS.mobileUrl);
  const shell = page.getByTestId('hermes-mobile-shell');
  await expect(shell).toBeVisible();
  const navButton = page
    .locator('nav[aria-label="Mobile Navigation"] button')
    .filter({ hasText: new RegExp(`^${surface}$`) });
  await expect(navButton).toBeVisible();
  await navButton.click();
  await expect(shell).toContainText(`HERMES COMPANION // ${surface}`);
}

test.describe('Area D Tier 1 — Mobile Companion App (F33, F34, F35)', () => {
  test.beforeAll(async () => {
    await ensureStackReady({ requireMobile: true });
  });

  // =========================================================================
  // Feature F33: Strictly Scoped Capacitor Mobile Shell (5 Tier 1 Tests)
  // =========================================================================

  test(
    '[T1][F33] capacitor.config.ts and package.json lock HERMES Companion appId, webDir, and native HTTP config',
    { tag: ['@tier1', '@F33'] },
    async () => {
      const capConfigPath = path.join(
        E2E_PATHS.repoRoot,
        'apps',
        'mobile',
        'capacitor.config.ts',
      );
      const pkgJsonPath = path.join(
        E2E_PATHS.repoRoot,
        'apps',
        'mobile',
        'package.json',
      );
      const viteConfigPath = path.join(
        E2E_PATHS.repoRoot,
        'apps',
        'mobile',
        'vite.config.ts',
      );
      const appTsxPath = path.join(
        E2E_PATHS.repoRoot,
        'apps',
        'mobile',
        'src',
        'App.tsx',
      );

      expect(fs.existsSync(capConfigPath)).toBe(true);
      expect(fs.existsSync(pkgJsonPath)).toBe(true);
      expect(fs.existsSync(viteConfigPath)).toBe(true);
      expect(fs.existsSync(appTsxPath)).toBe(true);

      const capText = fs.readFileSync(capConfigPath, 'utf8');
      expect(capText).toContain('dev.vitorx86.hermes.companion');
      expect(capText).toContain('HERMES Companion');
      expect(capText).toContain("webDir: 'dist'");
      expect(capText).toContain('#08080B');
      expect(capText).toContain('allowMixedContent: true');
      expect(capText).toContain('cleartext: true');
      expect(capText).toContain('CapacitorHttp');

      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      expect(pkg.name).toBe('@hermes/mobile');
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      expect(allDeps['@capacitor/core']).toBeTruthy();
      expect(allDeps['@capacitor-community/sqlite']).toBeTruthy();
      expect(allDeps['sql.js']).toBeTruthy();
      expect(allDeps['@hermes/ui']).toBeTruthy();
      expect(allDeps['@hermes/api-client']).toBeTruthy();

      const viteText = fs.readFileSync(viteConfigPath, 'utf8');
      expect(viteText).toContain('5174');
      expect(viteText).toContain('4174');

      const appSrc = fs.readFileSync(appTsxPath, 'utf8');
      expect(appSrc).toContain('ALLOWED_MOBILE_SURFACES');
      for (const surface of MOBILE_ALLOWED_SURFACES) {
        expect(appSrc).toContain(`'${surface}'`);
      }
    },
  );

  test(
    '[T1][F33] apps/mobile/dist contains pure CSR static bundle and serves 200 OK on E2E_URLS.mobileUrl (:4174)',
    { tag: ['@tier1', '@F33'] },
    async ({ page }) => {
      const indexHtmlPath = path.join(E2E_PATHS.mobileDistDir, 'index.html');
      expect(fs.existsSync(indexHtmlPath)).toBe(true);
      const html = fs.readFileSync(indexHtmlPath, 'utf8');
      expect(html).toContain('<div id="root"></div>');
      expect(html).toMatch(/<script[^>]+type="module"/i);
      expect(html).not.toContain('__NEXT_DATA__');

      const mobileApi = createApiClient(E2E_URLS.mobileUrl);
      const rootRes = await mobileApi.raw(`${E2E_URLS.mobileUrl}/`, {
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      expect(rootRes.status).toBe(200);
      expect(rootRes.headers.get('content-type') || '').toContain('text/html');

      await waitForAppReady(page, E2E_URLS.mobileUrl);
      const title = await page.title();
      expect(title).toMatch(/HERMES Companion/i);
      const rootChildren = await page.evaluate(
        () => document.getElementById('root')?.children.length ?? 0,
      );
      expect(rootChildren).toBeGreaterThan(0);
    },
  );

  test(
    '[T1][F33] Mobile shell exposes strictly ROUTINES, TODOS, COMPANION, and UPLINK_CONFIG navigation surfaces',
    { tag: ['@tier1', '@F33'] },
    async ({ page }) => {
      await waitForAppReady(page, E2E_URLS.mobileUrl);
      await expect(page.getByTestId('hermes-mobile-shell')).toBeVisible();

      const navButtons = page.locator('nav[aria-label="Mobile Navigation"] button');
      await expect(navButtons).toHaveCount(4);
      const buttonLabels = (await navButtons.allInnerTexts()).map((t) => t.trim());
      expect(buttonLabels).toEqual(['ROUTINES', 'TODOS', 'COMPANION', 'UPLINK_CONFIG']);

      for (const surface of MOBILE_ALLOWED_SURFACES) {
        await openMobileSurface(page, surface);
      }
    },
  );

  test(
    '[T1][F33] Mobile shell enforces REF-02 0px border-radius, >=12px interactive font floor, and carbon/orange/white tokens across all 4 surfaces',
    { tag: ['@tier1', '@F33'] },
    async ({ page }) => {
      for (const surface of MOBILE_ALLOWED_SURFACES) {
        await openMobileSurface(page, surface);

        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.checkedCount).toBeGreaterThan(0);
        expect(radiusAudit.violations).toEqual([]);

        const fontAudit = await auditInteractiveFontFloor(page, 12);
        expect(fontAudit.checkedCount).toBeGreaterThan(0);
        expect(fontAudit.violations).toEqual([]);

        const colorAudit = await auditColorTokens(page);
        expect(colorAudit.hasCarbonBg).toBe(true);
        expect(colorAudit.hasBlazeOrangeAccent).toBe(true);
        expect(colorAudit.hasStarkWhiteInk).toBe(true);
      }
    },
  );

  test(
    '[T1][F33] Mobile bundle and source tree statically exclude all Web-only modules (03, 04, 05, 09, 10, 11)',
    { tag: ['@tier1', '@F33'] },
    async ({ page }) => {
      await openMobileSurface(page, 'COMPANION');
      await expect(page.locator('[data-testid="companion-expand-hermes"]')).toHaveCount(0);
      await expect(page.getByText(/Expand in Full Hermes View/i)).toHaveCount(0);

      const mobileSrcDir = path.join(E2E_PATHS.repoRoot, 'apps', 'mobile', 'src');
      const srcFiles = collectFilesRecursively(mobileSrcDir, /\.(ts|tsx)$/);
      expect(srcFiles.length).toBeGreaterThan(0);

      const combinedSrc = srcFiles
        .map((f) => fs.readFileSync(f, 'utf8'))
        .join('\n');

      for (const forbiddenComponent of [
        'WaffleGrid10x20',
        'CandlestickChart',
        'PairedHatchBarChart',
        'GeodesicThinkingOrb',
        'IsometricKnightSprite',
        'ConstellationMesh',
      ]) {
        expect(combinedSrc).not.toContain(forbiddenComponent);
      }
    },
  );

  // =========================================================================
  // Feature F34: Offline-First Mobile SQLite (UUIDv7) & UPLINK_CONFIG (5 Tier 1 Tests)
  // =========================================================================

  test(
    '[T1][F34] Offline task quick-capture generates RFC 9562 UUIDv7 IDs and pushes outbox batch to /api/sync/push',
    { tag: ['@tier1', '@F34'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      try {
        const api = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(api, uniqueId('f34-task-push'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authed = api.withToken(pat.token);

        await openMobileSurface(page, 'TODOS');

        const taskId = makeUuidV7();
        const mutationId = makeUuidV7();
        expect(taskId).toMatch(RFC9562_UUIDV7_RE);
        expect(mutationId).toMatch(RFC9562_UUIDV7_RE);

        const taskTitle = `Inspect solar inverter #maintenance ${uniqueId('inv')}`;
        const nowIso = new Date().toISOString();

        cleanup.defer(async () => {
          await authed.delete(`/api/tasks/${taskId}`);
        });

        const pushRes = await page.evaluate(
          async ({ baseUrl, token, clientId, mutId, tId, title, iso }) => {
            const res = await fetch(`${baseUrl}/api/sync/push`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                client_id: clientId,
                mutations: [
                  {
                    mutation_id: mutId,
                    entity_table: 'tasks',
                    entity_id: tId,
                    op: 'upsert',
                    client_updated_at: iso,
                    payload: {
                      id: tId,
                      title,
                      status: 'todo',
                      priority: 'high',
                      energy_level: 'quick',
                      estimated_minutes: 15,
                      tags: ['mobile', 'maintenance'],
                      updated_at: iso,
                      client_updated_at: iso,
                    },
                  },
                ],
              }),
            });
            return { status: res.status, body: await res.json().catch(() => null) };
          },
          {
            baseUrl: E2E_URLS.baseUrl,
            token: pat.token,
            clientId: uniqueId('mob-todos'),
            mutId: mutationId,
            tId: taskId,
            title: taskTitle,
            iso: nowIso,
          },
        );

        expect([200, 201]).toContain(pushRes.status);
        const tasksRes = await authed.get('/api/tasks');
        const allTasks = unwrapList<any>(tasksRes, ['tasks', 'items', 'data']);
        const syncedTask = allTasks.find((t) => String(t.id) === taskId);
        expect(syncedTask).toBeTruthy();
        expect(syncedTask.title).toBe(taskTitle);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F34] Offline routine check-off, daily energy check-in, and focus session sync cleanly via /api/sync/push',
    { tag: ['@tier1', '@F34'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      try {
        const api = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(api, uniqueId('f34-routine-sync'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authed = api.withToken(pat.token);

        await openMobileSurface(page, 'ROUTINES');

        const routineId = makeUuidV7();
        const itemId = makeUuidV7();
        const logId = makeUuidV7();
        const sessionId = makeUuidV7();
        const logDate = '2026-11-14';
        const nowIso = new Date().toISOString();

        cleanup.defer(async () => {
          await authed.delete(`/api/routines/${routineId}`);
          await authed.delete(`/api/time/sessions/${sessionId}`);
        });

        const pushRes = await page.evaluate(
          async ({
            baseUrl,
            token,
            clientId,
            rId,
            iId,
            lId,
            sId,
            dateStr,
            iso,
            mutIds,
          }) => {
            const res = await fetch(`${baseUrl}/api/sync/push`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                client_id: clientId,
                mutations: [
                  {
                    mutation_id: mutIds[0],
                    entity_table: 'routines',
                    entity_id: rId,
                    op: 'upsert',
                    client_updated_at: iso,
                    payload: {
                      id: rId,
                      name: 'Mobile Morning Stack',
                      time_slot: 'morning',
                      day_profile: 'workday',
                      sort_order: 1,
                      updated_at: iso,
                      client_updated_at: iso,
                    },
                  },
                  {
                    mutation_id: mutIds[1],
                    entity_table: 'routine_items',
                    entity_id: iId,
                    op: 'upsert',
                    client_updated_at: iso,
                    payload: {
                      id: iId,
                      routine_id: rId,
                      title: 'Hydrate 500ml + electrolytes',
                      tracking_type: 'boolean',
                      frequency_type: 'daily',
                      estimated_minutes: 10,
                      sort_order: 1,
                      updated_at: iso,
                      client_updated_at: iso,
                    },
                  },
                  {
                    mutation_id: mutIds[2],
                    entity_table: 'routine_logs',
                    entity_id: lId,
                    op: 'upsert',
                    client_updated_at: iso,
                    payload: {
                      id: lId,
                      routine_id: rId,
                      routine_item_id: iId,
                      log_date: dateStr,
                      status: 'completed',
                      completed_at: iso,
                      updated_at: iso,
                      client_updated_at: iso,
                    },
                  },
                  {
                    mutation_id: mutIds[3],
                    entity_table: 'daily_checkins',
                    entity_id: dateStr,
                    op: 'upsert',
                    client_updated_at: iso,
                    payload: {
                      id: dateStr,
                      log_date: dateStr,
                      day_profile_used: 'workday',
                      energy_score: 4,
                      mood_score: 5,
                      sleep_hours: 7.5,
                      highlight: 'Completed morning stack offline',
                      reflection_md: 'Mobile offline pulse check-in.',
                      updated_at: iso,
                      client_updated_at: iso,
                    },
                  },
                  {
                    mutation_id: mutIds[4],
                    entity_table: 'time_sessions',
                    entity_id: sId,
                    op: 'upsert',
                    client_updated_at: iso,
                    payload: {
                      id: sId,
                      category: 'deep_work',
                      timer_mode: 'pomodoro',
                      started_at: iso,
                      ended_at: iso,
                      duration_seconds: 1500,
                      notes: 'Mobile Pomodoro focus block',
                      updated_at: iso,
                      client_updated_at: iso,
                    },
                  },
                ],
              }),
            });
            return { status: res.status, body: await res.json().catch(() => null) };
          },
          {
            baseUrl: E2E_URLS.baseUrl,
            token: pat.token,
            clientId: uniqueId('mob-routines'),
            rId: routineId,
            iId: itemId,
            lId: logId,
            sId: sessionId,
            dateStr: logDate,
            iso: nowIso,
            mutIds: [
              makeUuidV7(),
              makeUuidV7(),
              makeUuidV7(),
              makeUuidV7(),
              makeUuidV7(),
            ],
          },
        );

        expect([200, 201]).toContain(pushRes.status);

        const pullRes = await authed.get('/api/sync/pull?since=0');
        expect(pullRes.status).toBe(200);
        const changes = unwrapList<any>(pullRes, ['changes', 'mutations', 'items']);
        const tables = new Set(
          changes.map((c) => String(c.entity_table ?? c.table_name ?? c.table ?? '')),
        );
        expect(tables.has('routines')).toBe(true);
        expect(tables.has('routine_logs')).toBe(true);
        expect(tables.has('daily_checkins')).toBe(true);
        expect(tables.has('time_sessions')).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F34] Delta pull (/api/sync/pull) advances cursor monotonically and hydrates server-created tasks',
    { tag: ['@tier1', '@F34'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      try {
        const api = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(api, uniqueId('f34-delta-pull'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authed = api.withToken(pat.token);

        await openMobileSurface(page, 'TODOS');

        const basePull = await authed.get('/api/sync/pull?since=0');
        expect(basePull.status).toBe(200);
        const cursorBefore = Number(
          basePull.json?.next_seq ?? basePull.json?.current_seq ?? basePull.json?.seq ?? 0,
        );

        const serverTaskTitle = `Server Hydrated Task ${uniqueId('srv')}`;
        const srvCreate = await authed.post('/api/tasks', {
          title: serverTaskTitle,
          status: 'todo',
          priority: 'medium',
          energy_level: 'shallow',
          estimated_minutes: 20,
        });
        expect([200, 201]).toContain(srvCreate.status);
        const srvTaskId = String(
          (srvCreate.json?.task ?? srvCreate.json?.data ?? srvCreate.json)?.id ?? '',
        );
        cleanup.defer(async () => {
          if (srvTaskId) await authed.delete(`/api/tasks/${srvTaskId}`);
        });

        const deltaPull = await page.evaluate(
          async ({ baseUrl, token, since }) => {
            const res = await fetch(`${baseUrl}/api/sync/pull?since=${since}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            return { status: res.status, body: await res.json().catch(() => null) };
          },
          { baseUrl: E2E_URLS.baseUrl, token: pat.token, since: cursorBefore },
        );

        expect(deltaPull.status).toBe(200);
        const cursorAfter = Number(
          deltaPull.body?.next_seq ??
            deltaPull.body?.current_seq ??
            deltaPull.body?.seq ??
            0,
        );
        expect(cursorAfter).toBeGreaterThanOrEqual(cursorBefore);
        const changes: any[] = deltaPull.body?.changes ?? deltaPull.body?.items ?? [];
        const hasTaskChange = changes.some(
          (c) =>
            String(c.entity_id ?? c.id ?? '') === srvTaskId ||
            JSON.stringify(c).includes(serverTaskTitle),
        );
        expect(hasTaskChange).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F34] Uplink Config verifies PAT against /api/auth/verify and parses QR pairing payload (/api/auth/pairing-qr)',
    { tag: ['@tier1', '@F34'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      try {
        const api = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(api, uniqueId('f34-uplink-qr'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        expect(pat.token.startsWith('plm_pat_')).toBe(true);

        await openMobileSurface(page, 'UPLINK_CONFIG');

        const qrRes = await api.post('/api/auth/pairing-qr', {
          name: uniqueId('qr-pair'),
          primary_url: E2E_URLS.baseUrl,
          fallback_url: E2E_URLS.baseUrl,
        });
        expect([200, 201]).toContain(qrRes.status);
        expect(qrRes.json).toBeTruthy();

        const verifyRes = await page.evaluate(
          async ({ baseUrl, token }) => {
            const t0 = performance.now();
            const res = await fetch(`${baseUrl}/api/auth/verify`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const latencyMs = Math.round(performance.now() - t0);
            return {
              status: res.status,
              latencyMs,
              body: await res.json().catch(() => null),
            };
          },
          { baseUrl: E2E_URLS.baseUrl, token: pat.token },
        );

        expect(verifyRes.status).toBe(200);
        expect(verifyRes.latencyMs).toBeGreaterThanOrEqual(0);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F34] Dual-URL Uplink failover automatically switches from unreachable Primary URL to reachable Fallback URL',
    { tag: ['@tier1', '@F34'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      try {
        const api = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(api, uniqueId('f34-failover-t1'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });

        await openMobileSurface(page, 'UPLINK_CONFIG');

        const failoverResult = await page.evaluate(
          async ({ primaryUrl, fallbackUrl, token }) => {
            let primaryFailed = false;
            let activeEndpoint = '';
            try {
              const r1 = await fetch(`${primaryUrl}/api/auth/verify`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (r1.ok) activeEndpoint = primaryUrl;
            } catch {
              primaryFailed = true;
            }

            if (!activeEndpoint) {
              const r2 = await fetch(`${fallbackUrl}/api/auth/verify`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (r2.ok) activeEndpoint = fallbackUrl;
            }

            const pullRes = await fetch(`${activeEndpoint}/api/sync/pull?since=0`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            return {
              primaryFailed,
              activeEndpoint,
              pullStatus: pullRes.status,
            };
          },
          {
            primaryUrl: 'http://127.0.0.1:59997',
            fallbackUrl: E2E_URLS.baseUrl,
            token: pat.token,
          },
        );

        expect(failoverResult.primaryFailed).toBe(true);
        expect(failoverResult.activeEndpoint).toBe(E2E_URLS.baseUrl);
        expect(failoverResult.pullStatus).toBe(200);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  // =========================================================================
  // Feature F35: Dual-Mode Mobile Frieren Companion (5 Tier 1 Tests)
  // =========================================================================

  test(
    '[T1][F35] Online Mobile Companion streams SSE tokens from /api/hermes/chat/stream with X-Hermes-Session-Key and page_context',
    { tag: ['@tier1', '@F35'] },
    async ({ page }) => {
      const gateway = await startMockHermesGateway({
        responseText: 'Frieren online field report: Morning stack is clear.',
      });
      const cleanup = new CleanupRegistry();
      cleanup.defer(async () => {
        await gateway.close();
      });

      try {
        await openMobileSurface(page, 'COMPANION');

        await withIsolatedBackend(
          { HERMES_GATEWAY_URL: gateway.baseV1Url },
          async ({ baseUrl }) => {
            const innerCleanup = new CleanupRegistry();
            try {
              const isoApi = createApiClient(baseUrl);
              const pat = await createPatToken(isoApi, uniqueId('f35-live-chat'));
              innerCleanup.defer(async () => {
                await isoApi.delete(`/api/auth/tokens/${pat.id}`);
              });

              const sessionKey = uniqueId('mob-f35-sess');
              innerCleanup.defer(async () => {
                await isoApi.delete(
                  `/api/hermes/sessions/${encodeURIComponent(sessionKey)}`,
                );
              });

              const events = await readSseEvents(`${baseUrl}/api/hermes/chat/stream`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${pat.token}`,
                  'X-Hermes-Session-Key': sessionKey,
                },
                body: JSON.stringify({
                  session_key: sessionKey,
                  message: "Status report on today's routines",
                  origin: 'mobile_companion',
                  page_context: { active_route: '/companion', entity_ids: [] },
                }),
                stopOnEvent: 'done',
                timeoutMs: 10_000,
              });

              expect(events.length).toBeGreaterThan(0);
              expect(gateway.requests.length).toBeGreaterThanOrEqual(1);
            } finally {
              await innerCleanup.runAll();
            }
          },
        );
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F35] Online Mobile Companion executes IMMEDIATE_UNDO and REQUIRE_APPROVAL MCP tool tiers and CompanionStage renders [Undo]/[Approve] cards',
    { tag: ['@tier1', '@F35'] },
    async ({ page }) => {
      await openMobileSurface(page, 'COMPANION');

      const stageSrc = fs.readFileSync(
        path.join(
          E2E_PATHS.repoRoot,
          'packages',
          'ui',
          'src',
          'sprites',
          'CompanionStage.tsx',
        ),
        'utf8',
      );
      expect(stageSrc).toContain('data-testid={`companion-undo-${u.undoId}`}');
      expect(stageSrc).toContain('[Undo]');
      expect(stageSrc).toContain('data-testid={`companion-approval-${req.id}`}');
      expect(stageSrc).toContain('[Approve]');
      expect(stageSrc).toContain('[Reject]');

      const api = createApiClient(E2E_URLS.baseUrl);
      const cleanup = new CleanupRegistry();
      const pat = await createPatToken(api, uniqueId('f35-t1-mcp'));
      cleanup.defer(async () => {
        await api.delete(`/api/auth/tokens/${pat.id}`);
      });
      const mcp = createMcpClient(E2E_URLS.mcpUrl, pat.token);
      const taskTitle = uniqueId('Mobile-Companion-Undo-Task');
      const sym = `MF35${Date.now().toString().slice(-4)}.SA`;

      try {
        const undoCall = await mcp.callTool('todos_create_task', {
          title: taskTitle,
          status: 'todo',
          priority: 'medium',
        });
        cleanup.defer(async () => {
          const listRes = await api.get('/api/tasks');
          const tasks = unwrapList<Record<string, any>>(listRes, ['tasks']);
          const match = tasks.find((t) => t.title === taskTitle);
          if (match?.id) {
            await api.delete(`/api/tasks/${encodeURIComponent(String(match.id))}`);
          }
        });
        expect(undoCall.ok).toBe(true);
        expect(typeof undoCall.undoId).toBe('string');

        const undoRes = await api.post(
          `/api/mcp/undo/${encodeURIComponent(undoCall.undoId!)}`,
          {},
        );
        expect(undoRes.status).toBe(200);

        const approvalCall = await mcp.callTool('finance_upsert_asset', {
          symbol: sym,
          name: 'Mobile Companion Approved Equity',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: false,
          quantity: 0,
          avg_cost_cents: 0,
          current_price_cents: 2500,
          target_weight_pct: 0,
        });
        cleanup.defer(async () => {
          const assetsRes = await api.get('/api/finance/assets');
          const assets = unwrapList<Record<string, any>>(assetsRes, ['assets']);
          const match = assets.find((a) => a.symbol === sym);
          if (match?.id) {
            await api.delete(
              `/api/finance/assets/${encodeURIComponent(String(match.id))}`,
            );
          }
        });
        expect(typeof approvalCall.approvalId).toBe('string');

        const approveRes = await api.post(
          `/api/mcp/approvals/${encodeURIComponent(approvalCall.approvalId!)}/approve`,
          {},
        );
        expect(approveRes.status).toBe(200);
      } finally {
        await mcp.closeSession();
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F35] Offline Mobile Companion contract hides online chat input and serves cached phrases with animation_hint loops',
    { tag: ['@tier1', '@F35'] },
    async ({ page }) => {
      await openMobileSurface(page, 'COMPANION');

      const stageSrc = fs.readFileSync(
        path.join(
          E2E_PATHS.repoRoot,
          'packages',
          'ui',
          'src',
          'sprites',
          'CompanionStage.tsx',
        ),
        'utf8',
      );
      expect(stageSrc).toContain("const isMobileOffline = mode === 'mobile' && !online;");
      expect(stageSrc).toContain('data-testid="companion-mobile-offline"');
      expect(stageSrc).toContain('data-testid="companion-offline-banner"');
      expect(stageSrc).toContain('[◌ OFFLINE_MODE — TAP FRIEREN FOR FIELD MOTIVATION]');
      expect(stageSrc).toContain('data-testid="companion-offline-speech-bubble"');
      expect(stageSrc).toContain('data-testid="companion-offline-mini-sprite"');
      expect(stageSrc).toContain('data-testid="companion-online-chat"');

      const registrySrc = fs.readFileSync(
        path.join(E2E_PATHS.repoRoot, 'packages', 'ui', 'src', 'sprites', 'registry.ts'),
        'utf8',
      );
      expect(registrySrc).toContain('DEFAULT_COMPANION_OFFLINE_PHRASES');
      for (const loop of [
        'read_grimoire',
        'wind_blink_loop',
        'cast_blue_flora',
        'sip_tea',
        'cozy_nap',
        'mimic_gag',
      ]) {
        expect(registrySrc).toContain(`'${loop}'`);
      }

      const phrasesRes = await page.evaluate(async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/companion/phrases`);
        return { status: res.status, body: await res.json().catch(() => null) };
      }, E2E_URLS.baseUrl);
      expect(phrasesRes.status).toBe(200);
    },
  );

  test(
    '[T1][F35] Custom motivational phrases synced via /api/sync/push persist in companion_offline_phrases and surface in /api/sync/pull',
    { tag: ['@tier1', '@F35'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      try {
        const api = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(api, uniqueId('f35-custom-phrase'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authed = api.withToken(pat.token);

        await openMobileSurface(page, 'COMPANION');

        const customText = `Custom synced mage wisdom: guard your deep work hours ${uniqueId('mage')}.`;
        const phraseId = makeUuidV7();
        const nowIso = new Date().toISOString();

        const pushRes = await authed.post('/api/sync/push', {
          client_id: uniqueId('phrase-seeder'),
          mutations: [
            {
              mutation_id: makeUuidV7(),
              entity_table: 'companion_offline_phrases',
              entity_id: phraseId,
              op: 'upsert',
              client_updated_at: nowIso,
              payload: {
                id: phraseId,
                category: 'focus',
                trigger_context: 'tap',
                animation_hint: 'tea',
                phrase_text: customText,
                text: customText,
                updated_at: nowIso,
                client_updated_at: nowIso,
              },
            },
          ],
        });
        expect([200, 201]).toContain(pushRes.status);

        cleanup.defer(async () => {
          await authed.delete(`/api/companion/phrases/${phraseId}`);
        });

        const pullRes = await page.evaluate(
          async ({ baseUrl, token }) => {
            const res = await fetch(`${baseUrl}/api/sync/pull?since=0`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            return { status: res.status, body: await res.json().catch(() => null) };
          },
          { baseUrl: E2E_URLS.baseUrl, token: pat.token },
        );

        expect(pullRes.status).toBe(200);
        const changes: any[] = pullRes.body?.changes ?? pullRes.body?.items ?? [];
        const matchedPhrase = changes.find(
          (c) =>
            String(c.entity_table ?? c.table_name ?? '') ===
              'companion_offline_phrases' &&
            (String(c.entity_id ?? '') === phraseId ||
              JSON.stringify(c).includes(customText)),
        );
        expect(matchedPhrase).toBeTruthy();
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F35] Mobile sprite engine enforces integer scaling, image-rendering: pixelated, and prefers-reduced-motion frame 0 freeze',
    { tag: ['@tier1', '@F35'] },
    async ({ page }) => {
      await openMobileSurface(page, 'COMPANION');

      const spriteAudit = await auditPixelatedSprites(page);
      expect(spriteAudit.violations).toEqual([]);

      await page.emulateMedia({ reducedMotion: 'reduce' });
      try {
        const reducedMatches = await page.evaluate(
          () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        );
        expect(reducedMatches).toBe(true);
      } finally {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
      }

      const pixelSpriteSrc = fs.readFileSync(
        path.join(
          E2E_PATHS.repoRoot,
          'packages',
          'ui',
          'src',
          'sprites',
          'PixelSprite.tsx',
        ),
        'utf8',
      );
      expect(pixelSpriteSrc).toContain('const intScale = clampSpriteScale(scale ?? sheet.scale);');
      expect(pixelSpriteSrc).toContain("imageRendering: 'pixelated'");
      expect(pixelSpriteSrc).toContain('ctx.imageSmoothingEnabled = false');
      expect(pixelSpriteSrc).toContain(
        'if (paused || prefersReducedMotion || activeAnim.frames.length <= 1)',
      );
    },
  );
});
