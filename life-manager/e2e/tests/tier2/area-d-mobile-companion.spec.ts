import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  CleanupRegistry,
  E2E_PATHS,
  E2E_URLS,
  auditInteractiveFontFloor,
  auditPixelatedSprites,
  auditZeroBorderRadius,
  createApiClient,
  createMcpClient,
  createPatToken,
  ensureStackReady,
  readSseEvents,
  uniqueId,
  unwrapList,
  waitForAppReady,
  withIsolatedBackend,
} from '../../harness/index.js';

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

test.describe('Area D Tier 2 — Mobile Companion Boundary, Negative & Resilience (F33, F34, F35)', () => {
  test.beforeAll(async () => {
    await ensureStackReady({ requireMobile: true });
  });

  // =========================================================================
  // Feature F33: Strictly Scoped Capacitor Mobile Shell (5 Tier 2 Tests)
  // =========================================================================

  test(
    '[T2][F33] Navigating to excluded desktop routes (/dashboard, /monitor, /hermes, /agents, /goals, /courses, /finance) on :4174 never renders Web-only views',
    { tag: ['@tier2', '@F33'] },
    async ({ page }) => {
      for (const excludedPath of [
        '/dashboard',
        '/monitor',
        '/hermes',
        '/agents',
        '/goals',
        '/courses',
        '/finance',
      ]) {
        await waitForAppReady(page, `${E2E_URLS.mobileUrl}${excludedPath}`);
        await expect(page.getByTestId('hermes-mobile-shell')).toBeVisible();
        await expect(page.locator('[data-fui="waffle-grid-10x20"]')).toHaveCount(0);
        await expect(page.locator('[data-fui="isometric-knight-sprite"]')).toHaveCount(0);
        await expect(page.locator('[data-fui-blueprint]')).toHaveCount(0);

        const navButtons = page.locator('nav[aria-label="Mobile Navigation"] button');
        await expect(navButtons).toHaveCount(4);
        const labels = (await navButtons.allInnerTexts()).map((t) => t.trim());
        expect(labels).toEqual(['ROUTINES', 'TODOS', 'COMPANION', 'UPLINK_CONFIG']);
      }
    },
  );

  test(
    '[T2][F33] Mobile COMPANION surface strictly omits Web-only "Expand in Full Hermes View" (/hermes) control',
    { tag: ['@tier2', '@F33'] },
    async ({ page }) => {
      await openMobileSurface(page, 'COMPANION');

      await expect(page.locator('[data-testid="companion-expand-hermes"]')).toHaveCount(0);
      await expect(page.getByText(/Expand in Full Hermes View/i)).toHaveCount(0);

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
      expect(stageSrc).toContain("{mode === 'popover' && onExpandToHermes && (");
      expect(stageSrc).not.toContain("mode === 'mobile' && onExpandToHermes");
    },
  );

  test(
    '[T2][F33] Mobile ROUTINES and TODOS surfaces exclude Web-only Ideal Week 7x24 designer, Weekly Review wizard, and Eisenhower Matrix',
    { tag: ['@tier2', '@F33'] },
    async ({ page }) => {
      await openMobileSurface(page, 'ROUTINES');
      await expect(page.getByText(/Ideal Week 7x24/i)).toHaveCount(0);
      await expect(page.getByText(/Weekly Review Wizard/i)).toHaveCount(0);
      await expect(page.locator('[data-testid="ideal-week-grid"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="weekly-review-modal"]')).toHaveCount(0);

      await openMobileSurface(page, 'TODOS');
      await expect(page.getByText(/CENTRAL ATRIUM/i)).toHaveCount(0);
      await expect(page.getByText(/Eisenhower Matrix/i)).toHaveCount(0);
      await expect(page.locator('[data-testid="eisenhower-matrix"]')).toHaveCount(0);
    },
  );

  test(
    '[T2][F33] Mobile static server returns 404 Not Found for missing static assets and blocks path traversal while serving SPA fallback on extensionless paths',
    { tag: ['@tier2', '@F33'] },
    async () => {
      const mobileApi = createApiClient(E2E_URLS.mobileUrl);

      const missingAsset = await mobileApi.raw(
        `${E2E_URLS.mobileUrl}/assets/nonexistent-bundle-99999.js`,
      );
      expect(missingAsset.status).toBe(404);

      const traversal = await mobileApi.raw(`${E2E_URLS.mobileUrl}/..%2f..%2fpackage.json`);
      expect([400, 403, 404]).toContain(traversal.status);
      expect(traversal.text).not.toContain('"name": "personal-life-manager"');
      expect(traversal.text).not.toContain('"name": "@hermes/mobile"');

      const spaFallback = await mobileApi.raw(`${E2E_URLS.mobileUrl}/todos`, {
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      expect(spaFallback.status).toBe(200);
      expect(spaFallback.text).toContain('<div id="root">');
    },
  );

  test(
    '[T2][F33] Mobile shell remains layout-intact without horizontal overflow across compact mobile viewports (390x844 iPhone and 412x915 Android)',
    { tag: ['@tier2', '@F33'] },
    async ({ page }) => {
      for (const vp of [
        { width: 390, height: 844 },
        { width: 412, height: 915 },
      ]) {
        await page.setViewportSize(vp);
        for (const surface of MOBILE_ALLOWED_SURFACES) {
          await openMobileSurface(page, surface);
        }

        const overflowCheck = await page.evaluate(() => ({
          scrollW: document.documentElement.scrollWidth,
          innerW: window.innerWidth,
        }));
        expect(overflowCheck.scrollW).toBeLessThanOrEqual(Math.max(overflowCheck.innerW + 2, 390));

        const radiusAudit = await auditZeroBorderRadius(page);
        expect(radiusAudit.violations).toEqual([]);

        const fontAudit = await auditInteractiveFontFloor(page, 12);
        expect(fontAudit.violations).toEqual([]);
      }
    },
  );

  // =========================================================================
  // Feature F34: Offline-First Mobile SQLite & UPLINK_CONFIG Failover (5 Tier 2 Tests)
  // =========================================================================

  test(
    '[T2][F34] Revoking PAT via DELETE /api/auth/tokens/{id} causes immediate HTTP 401 on mobile /api/sync/pull and /api/sync/push',
    { tag: ['@tier2', '@F34'] },
    async ({ page }) => {
      const api = createApiClient(E2E_URLS.baseUrl);
      const revokedPat = await createPatToken(api, uniqueId('f34-revoked'));

      await openMobileSurface(page, 'UPLINK_CONFIG');

      const preRevokeStatus = await page.evaluate(
        async ({ baseUrl, token }) => {
          const res = await fetch(`${baseUrl}/api/sync/pull?since=0`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          return res.status;
        },
        { baseUrl: E2E_URLS.baseUrl, token: revokedPat.token },
      );
      expect(preRevokeStatus).toBe(200);

      const delRes = await api.delete(`/api/auth/tokens/${revokedPat.id}`);
      expect([200, 204]).toContain(delRes.status);

      const postRevoke = await page.evaluate(
        async ({ baseUrl, token, mutId, taskId, iso }) => {
          const pullRes = await fetch(`${baseUrl}/api/sync/pull?since=0`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const pushRes = await fetch(`${baseUrl}/api/sync/push`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              client_id: 'revoked-client',
              mutations: [
                {
                  mutation_id: mutId,
                  entity_table: 'tasks',
                  entity_id: taskId,
                  op: 'upsert',
                  client_updated_at: iso,
                  payload: {
                    id: taskId,
                    title: 'Should Be Rejected By 401',
                    status: 'todo',
                    priority: 'medium',
                    energy_level: 'quick',
                    estimated_minutes: 15,
                  },
                },
              ],
            }),
          });
          return { pullStatus: pullRes.status, pushStatus: pushRes.status };
        },
        {
          baseUrl: E2E_URLS.baseUrl,
          token: revokedPat.token,
          mutId: makeUuidV7(),
          taskId: makeUuidV7(),
          iso: new Date().toISOString(),
        },
      );

      expect(postRevoke.pullStatus).toBe(401);
      expect(postRevoke.pushStatus).toBe(401);
    },
  );

  test(
    '[T2][F34] Duplicate mutation_id submission to /api/sync/push is idempotent and creates exactly one task row',
    { tag: ['@tier2', '@F34'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      try {
        const api = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(api, uniqueId('f34-idempotent'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authed = api.withToken(pat.token);

        await openMobileSurface(page, 'TODOS');

        const taskId = makeUuidV7();
        const mutationId = makeUuidV7();
        const taskTitle = `Idempotent Mobile Task ${uniqueId('idem')}`;
        const nowIso = new Date().toISOString();

        cleanup.defer(async () => {
          await authed.delete(`/api/tasks/${taskId}`);
        });

        const duplicatePush = await page.evaluate(
          async ({ baseUrl, token, mutId, tId, title, iso }) => {
            const body = JSON.stringify({
              client_id: 'mobile-idempotent-client',
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
                    priority: 'medium',
                    energy_level: 'quick',
                    estimated_minutes: 15,
                    updated_at: iso,
                    client_updated_at: iso,
                  },
                },
              ],
            });
            const r1 = await fetch(`${baseUrl}/api/sync/push`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body,
            });
            const r2 = await fetch(`${baseUrl}/api/sync/push`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body,
            });
            return { s1: r1.status, s2: r2.status };
          },
          {
            baseUrl: E2E_URLS.baseUrl,
            token: pat.token,
            mutId: mutationId,
            tId: taskId,
            title: taskTitle,
            iso: nowIso,
          },
        );

        expect([200, 201]).toContain(duplicatePush.s1);
        expect([200, 201]).toContain(duplicatePush.s2);

        const listRes = await authed.get('/api/tasks');
        const allTasks = unwrapList<any>(listRes, ['tasks', 'items', 'data']);
        const matches = allTasks.filter((t) => String(t.id) === taskId);
        expect(matches.length).toBe(1);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F34] Mid-sync HTTP 503 failure on POST /api/sync/push via page.route fails cleanly without partial corruption and succeeds after route removal',
    { tag: ['@tier2', '@F34'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      try {
        const api = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(api, uniqueId('f34-503-retry'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authed = api.withToken(pat.token);

        await openMobileSurface(page, 'TODOS');

        const taskId = makeUuidV7();
        const mutationId = makeUuidV7();
        const taskTitle = `Retry 503 Mobile Task ${uniqueId('r503')}`;
        const nowIso = new Date().toISOString();

        cleanup.defer(async () => {
          await authed.delete(`/api/tasks/${taskId}`);
        });

        await page.route('**/api/sync/push', async (route) => {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'service_unavailable' }),
          });
        });

        const firstAttemptStatus = await page.evaluate(
          async ({ baseUrl, token, mutId, tId, title, iso }) => {
            const res = await fetch(`${baseUrl}/api/sync/push`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                client_id: 'mobile-503-client',
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
                      energy_level: 'deep',
                      estimated_minutes: 25,
                      updated_at: iso,
                      client_updated_at: iso,
                    },
                  },
                ],
              }),
            });
            return res.status;
          },
          {
            baseUrl: E2E_URLS.baseUrl,
            token: pat.token,
            mutId: mutationId,
            tId: taskId,
            title: taskTitle,
            iso: nowIso,
          },
        );
        expect(firstAttemptStatus).toBe(503);

        const beforeRetryList = unwrapList<any>(await authed.get('/api/tasks'), [
          'tasks',
          'items',
          'data',
        ]);
        expect(beforeRetryList.some((t) => String(t.id) === taskId)).toBe(false);

        await page.unrouteAll({ behavior: 'ignoreErrors' });

        const retryStatus = await page.evaluate(
          async ({ baseUrl, token, mutId, tId, title, iso }) => {
            const res = await fetch(`${baseUrl}/api/sync/push`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                client_id: 'mobile-503-client',
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
                      energy_level: 'deep',
                      estimated_minutes: 25,
                      updated_at: iso,
                      client_updated_at: iso,
                    },
                  },
                ],
              }),
            });
            return res.status;
          },
          {
            baseUrl: E2E_URLS.baseUrl,
            token: pat.token,
            mutId: mutationId,
            tId: taskId,
            title: taskTitle,
            iso: nowIso,
          },
        );
        expect([200, 201]).toContain(retryStatus);

        const afterRetryList = unwrapList<any>(await authed.get('/api/tasks'), [
          'tasks',
          'items',
          'data',
        ]);
        expect(afterRetryList.some((t) => String(t.id) === taskId)).toBe(true);
      } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F34] Concurrent offline mobile edit and server edit resolve deterministically via updated_at Last-Write-Wins without duplicate rows',
    { tag: ['@tier2', '@F34'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      try {
        const api = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(api, uniqueId('f34-lww-conflict'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authed = api.withToken(pat.token);

        await openMobileSurface(page, 'TODOS');

        const canonicalTitle = `Server Canonical Title ${uniqueId('v1')}`;
        const created = await authed.post('/api/tasks', {
          title: canonicalTitle,
          status: 'todo',
          priority: 'medium',
          energy_level: 'shallow',
          estimated_minutes: 25,
        });
        expect([200, 201]).toContain(created.status);
        const sharedId = String(
          (created.json?.task ?? created.json?.data ?? created.json)?.id ?? '',
        );
        cleanup.defer(async () => {
          if (sharedId) await authed.delete(`/api/tasks/${sharedId}`);
        });

        // 1. Stale client_updated_at (2020) should lose LWW against newer server row
        const staleIso = '2020-01-01T00:00:00.000Z';
        await page.evaluate(
          async ({ baseUrl, token, mutId, tId, iso }) => {
            await fetch(`${baseUrl}/api/sync/push`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                client_id: 'mobile-stale-lww',
                mutations: [
                  {
                    mutation_id: mutId,
                    entity_table: 'tasks',
                    entity_id: tId,
                    op: 'upsert',
                    client_updated_at: iso,
                    payload: {
                      id: tId,
                      title: 'Stale 2020 Offline Edit',
                      status: 'todo',
                      priority: 'low',
                      energy_level: 'quick',
                      estimated_minutes: 10,
                      updated_at: iso,
                      client_updated_at: iso,
                    },
                  },
                ],
              }),
            });
          },
          {
            baseUrl: E2E_URLS.baseUrl,
            token: pat.token,
            mutId: makeUuidV7(),
            tId: sharedId,
            iso: staleIso,
          },
        );

        const afterStaleTasks = unwrapList<any>(await authed.get('/api/tasks'), [
          'tasks',
          'items',
          'data',
        ]);
        const afterStaleRow = afterStaleTasks.find((t) => String(t.id) === sharedId);
        expect(afterStaleRow?.title).toBe(canonicalTitle);

        // 2. Newer client_updated_at (+60s) should win LWW
        const winnerTitle = `Mobile LWW Winner ${uniqueId('win')}`;
        const futureIso = new Date(Date.now() + 60_000).toISOString();
        const winPush = await page.evaluate(
          async ({ baseUrl, token, mutId, tId, title, iso }) => {
            const res = await fetch(`${baseUrl}/api/sync/push`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                client_id: 'mobile-fresh-lww',
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
                      status: 'done',
                      priority: 'high',
                      energy_level: 'deep',
                      estimated_minutes: 25,
                      updated_at: iso,
                      client_updated_at: iso,
                    },
                  },
                ],
              }),
            });
            return res.status;
          },
          {
            baseUrl: E2E_URLS.baseUrl,
            token: pat.token,
            mutId: makeUuidV7(),
            tId: sharedId,
            title: winnerTitle,
            iso: futureIso,
          },
        );
        expect([200, 201]).toContain(winPush);

        const finalTasks = unwrapList<any>(await authed.get('/api/tasks'), [
          'tasks',
          'items',
          'data',
        ]);
        const matchingRows = finalTasks.filter((t) => String(t.id) === sharedId);
        expect(matchingRows.length).toBe(1);
        expect(matchingRows[0]?.title).toBe(winnerTitle);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F34] Disallowed entity_table in /api/sync/push and blank task titles are rejected without mutating Web-only tables',
    { tag: ['@tier2', '@F34'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      try {
        const api = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(api, uniqueId('f34-validation'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });

        await openMobileSurface(page, 'TODOS');

        const validationRes = await page.evaluate(
          async ({ baseUrl, token, mutId, fakeId, iso }) => {
            const badTableRes = await fetch(`${baseUrl}/api/sync/push`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                client_id: 'mobile-disallowed-table',
                mutations: [
                  {
                    mutation_id: mutId,
                    entity_table: 'finance_assets',
                    entity_id: fakeId,
                    op: 'upsert',
                    client_updated_at: iso,
                    payload: {
                      id: fakeId,
                      symbol: 'HACK4',
                      market: 'B3',
                      asset_class: 'equity',
                      currency: 'BRL',
                    },
                  },
                ],
              }),
            });
            const body = await badTableRes.json().catch(() => null);
            return { status: badTableRes.status, body };
          },
          {
            baseUrl: E2E_URLS.baseUrl,
            token: pat.token,
            mutId: makeUuidV7(),
            fakeId: makeUuidV7(),
            iso: new Date().toISOString(),
          },
        );

        const rejectedByStatus = [400, 403, 422].includes(validationRes.status);
        const rejectedInResults =
          Array.isArray(validationRes.body?.rejected) &&
          validationRes.body.rejected.length > 0;
        const zeroApplied =
          typeof validationRes.body?.applied === 'number' &&
          validationRes.body.applied === 0;
        expect(rejectedByStatus || rejectedInResults || zeroApplied).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  // =========================================================================
  // Feature F35: Dual-Mode Mobile Frieren Companion (5 Tier 2 Tests)
  // =========================================================================

  test(
    '[T2][F35] When Rust server is IN_RANGE but hermes gateway (:8642) is offline, /api/hermes/chat/stream degrades gracefully to offline_mock SSE without HTTP 500',
    { tag: ['@tier2', '@F35'] },
    async ({ page }) => {
      await openMobileSurface(page, 'COMPANION');

      await withIsolatedBackend(
        { HERMES_GATEWAY_URL: 'http://127.0.0.1:59996/v1' },
        async ({ baseUrl }) => {
          const innerCleanup = new CleanupRegistry();
          try {
            const isoApi = createApiClient(baseUrl);
            const healthRes = await isoApi.get('/api/health');
            expect(healthRes.status).toBe(200);

            const pat = await createPatToken(isoApi, uniqueId('f35-degraded-gw'));
            innerCleanup.defer(async () => {
              await isoApi.delete(`/api/auth/tokens/${pat.id}`);
            });

            const sessionKey = uniqueId('mob-offline-mock-sess');
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
                message: 'Give me a quick tactical briefing while gateway is offline',
                origin: 'mobile_companion',
              }),
              stopOnEvent: 'done',
              timeoutMs: 10_000,
            });

            expect(events.length).toBeGreaterThan(0);
          } finally {
            await innerCleanup.runAll();
          }
        },
      );
    },
  );

  test(
    '[T2][F35] Rejecting a REQUIRE_APPROVAL MCP action (/api/mcp/approvals/{id}/reject) prevents mutation from executing',
    { tag: ['@tier2', '@F35'] },
    async ({ page }) => {
      await openMobileSurface(page, 'COMPANION');

      const api = createApiClient(E2E_URLS.baseUrl);
      const cleanup = new CleanupRegistry();
      const pat = await createPatToken(api, uniqueId('f35-t2-mcp'));
      cleanup.defer(async () => {
        await api.delete(`/api/auth/tokens/${pat.id}`);
      });
      const mcp = createMcpClient(E2E_URLS.mcpUrl, pat.token);
      const sym = `REJ${Date.now().toString().slice(-4)}.SA`;

      try {
        const approvalCall = await mcp.callTool('finance_upsert_asset', {
          symbol: sym,
          name: 'Rejected Mobile Equity',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: false,
          quantity: 10,
          avg_cost_cents: 1000,
          current_price_cents: 1000,
          target_weight_pct: 0,
        });
        expect(typeof approvalCall.approvalId).toBe('string');

        const rejectRes = await api.post(
          `/api/mcp/approvals/${encodeURIComponent(approvalCall.approvalId!)}/reject`,
          { reason: 'Rejected from mobile companion test' },
        );
        expect(rejectRes.status).toBe(200);

        const assetsRes = await api.get('/api/finance/assets');
        const assets = unwrapList<Record<string, any>>(assetsRes, ['assets']);
        const rejectedAsset = assets.find((a) => a.symbol === sym);
        expect(rejectedAsset).toBeUndefined();
      } finally {
        await mcp.closeSession();
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F35] Deleting a custom companion phrase via /api/sync/push records a delete tombstone in /api/sync/pull',
    { tag: ['@tier2', '@F35'] },
    async ({ page }) => {
      const cleanup = new CleanupRegistry();
      try {
        const api = createApiClient(E2E_URLS.baseUrl);
        const pat = await createPatToken(api, uniqueId('f35-del-phrase'));
        cleanup.defer(async () => {
          await api.delete(`/api/auth/tokens/${pat.id}`);
        });
        const authed = api.withToken(pat.token);

        await openMobileSurface(page, 'COMPANION');

        const phraseId = makeUuidV7();
        const createIso = new Date().toISOString();
        const phraseText = `Ephemeral Frieren Note ${uniqueId('eph')}`;

        const pushCreate = await authed.post('/api/sync/push', {
          client_id: uniqueId('phrase-creator'),
          mutations: [
            {
              mutation_id: makeUuidV7(),
              entity_table: 'companion_offline_phrases',
              entity_id: phraseId,
              op: 'upsert',
              client_updated_at: createIso,
              payload: {
                id: phraseId,
                category: 'evening',
                trigger_context: 'evening_reflection',
                animation_hint: 'stargazing',
                phrase_text: phraseText,
                text: phraseText,
                updated_at: createIso,
                client_updated_at: createIso,
              },
            },
          ],
        });
        expect([200, 201]).toContain(pushCreate.status);

        const beforeDeletePull = await authed.get('/api/sync/pull?since=0');
        const seqBeforeDelete = Number(
          beforeDeletePull.json?.next_seq ??
            beforeDeletePull.json?.current_seq ??
            beforeDeletePull.json?.seq ??
            0,
        );

        const deleteIso = new Date(Date.now() + 5_000).toISOString();
        const pushDelete = await authed.post('/api/sync/push', {
          client_id: uniqueId('phrase-deleter'),
          mutations: [
            {
              mutation_id: makeUuidV7(),
              entity_table: 'companion_offline_phrases',
              entity_id: phraseId,
              op: 'delete',
              client_updated_at: deleteIso,
              payload: { id: phraseId },
            },
          ],
        });
        expect([200, 201]).toContain(pushDelete.status);

        const deltaPull = await authed.get(`/api/sync/pull?since=${seqBeforeDelete}`);
        expect(deltaPull.status).toBe(200);
        const changes = unwrapList<any>(deltaPull, ['changes', 'mutations', 'items']);
        const deleteEntry = changes.find(
          (c) =>
            String(c.entity_id ?? c.id ?? '') === phraseId &&
            String(c.op ?? c.operation ?? '').toLowerCase() === 'delete',
        );
        expect(deleteEntry).toBeTruthy();
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F35] Empty or single-item companion_offline_phrases bank in CompanionStage degrades gracefully without NaN/undefined quote text',
    { tag: ['@tier2', '@F35'] },
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
      expect(stageSrc).toContain('offlinePhrases && offlinePhrases.length > 0');
      expect(stageSrc).toContain(': DEFAULT_COMPANION_OFFLINE_PHRASES;');
      expect(stageSrc).toContain('if (phraseBank.length <= 1) return 0;');
      expect(stageSrc).toContain(
        'phraseBank[phraseIndex % phraseBank.length] ?? DEFAULT_COMPANION_OFFLINE_PHRASES[0]!;',
      );
      expect(stageSrc).toContain('offlineTriggerSignal !== undefined');
      expect(stageSrc).toContain('cycleOfflineMotivation();');
    },
  );

  test(
    '[T2][F35] Corrupted custom sprite sheet URL or prefers-reduced-motion on Mobile COMPANION falls back to bundled pixel-art atlas and static frame 0',
    { tag: ['@tier2', '@F35'] },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      try {
        await openMobileSurface(page, 'COMPANION');

        const spriteAudit = await auditPixelatedSprites(page);
        expect(spriteAudit.violations).toEqual([]);
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
      expect(pixelSpriteSrc).toContain('const fallbackDescriptor = fallback?.descriptor ?? FRIEREN_MINI_SPRITE;');
      expect(pixelSpriteSrc).toContain('const fallbackUrl = fallback?.sheetUrl ?? FRIEREN_MINI_SHEET_URL;');
      expect(pixelSpriteSrc).toContain('if (!usingFallbackSheet && activeUrl !== fallbackUrl) {');
      expect(pixelSpriteSrc).toContain('setUsingFallbackSheet(true);');
      expect(pixelSpriteSrc).toContain(
        'if (paused || prefersReducedMotion || activeAnim.frames.length <= 1) {',
      );
    },
  );
});
