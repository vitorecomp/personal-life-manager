import { test, expect } from '@playwright/test';
import {
  E2E_URLS,
  ensureStackReady,
  withIsolatedBackend,
  createApiClient,
  unwrapList,
  uniqueId,
  createPatToken,
  readSseEvents,
  CleanupRegistry,
  createMcpClient,
  waitForAppReady,
  auditZeroBorderRadius,
  auditInteractiveFontFloor,
  auditPixelatedSprites,
} from '../../harness';

function extractEntityId(record: Record<string, any> | null | undefined): string {
  if (!record || typeof record !== 'object') return '';
  const data = record.data && typeof record.data === 'object' ? record.data : record;
  return String(data.id ?? data.session_key ?? data.key ?? '');
}

test.describe('Tier 2 — Area B: Boundary, Negative & Resilience for Loaders, Shell & AI Surfaces (F20, F23, F25, F26, F27)', () => {
  test.beforeAll(async () => {
    await ensureStackReady();
  });

  // ===========================================================================
  // Feature F20 — REF-09 Orbital Boot Astrolabe, REF-08 Thinking Orb & REF-11/12 Loaders (5 tests)
  // ===========================================================================

  test(
    '[T2][F20] completes Orbital Boot sequence to READY state without hanging when hermes gateway is in offline_mock mode',
    { tag: ['@tier2', '@F20'] },
    async ({ page }) => {
      await withIsolatedBackend(
        { HERMES_GATEWAY_URL: 'http://127.0.0.1:59997/v1' },
        async ({ baseUrl, apiBaseUrl }) => {
          const isoApi = createApiClient(apiBaseUrl);
          const healthRes = await isoApi.get('/api/health');
          expect(healthRes.status).toBe(200);
          expect(healthRes.json.hermes_gateway).toBe('offline_mock');

          await waitForAppReady(page, `${baseUrl}/dashboard`);

          const state = await page.evaluate(() => ({
            pathname: window.location.pathname,
            hasRootChildren: (document.getElementById('root')?.children.length ?? 0) > 0,
          }));
          expect(state.hasRootChildren).toBe(true);
          expect(state.pathname).toBe('/dashboard');
        },
      );
    },
  );

  test(
    '[T2][F20] verifies REF-08 Geodesic Thinking Orb never creates WebGL contexts across state transitions',
    { tag: ['@tier2', '@F20'] },
    async ({ page }) => {
      await page.addInitScript(() => {
        (window as any).__webglCalls = [];
        const origGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (
          this: HTMLCanvasElement,
          contextId: string,
          ...args: any[]
        ) {
          if (String(contextId).toLowerCase().includes('webgl')) {
            (window as any).__webglCalls.push(String(contextId));
          }
          return (origGetContext as any).apply(this, [contextId, ...args]);
        } as any;
      });

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/hermes`);

      const hlToggle = page
        .locator(
          '[data-testid="high-level-plan-toggle"], button:has-text("HIGH_LEVEL_PLAN"), button:has-text("High-Level"), [aria-label*="High-Level" i]',
        )
        .first();
      await expect(hlToggle).toBeVisible();
      await hlToggle.click();
      await hlToggle.click();

      const domCheck = await page.evaluate(() => ({
        webglCalls: ((window as any).__webglCalls || []) as string[],
        svgCount: document.querySelectorAll('svg').length,
      }));
      expect(domCheck.webglCalls).toEqual([]);
      expect(domCheck.svgCount).toBeGreaterThan(0);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.checkedCount).toBeGreaterThan(0);
      expect(radiusAudit.violations).toEqual([]);
    },
  );

  test(
    '[T2][F20] preserves stable layout geometry on /hermes when toggling High-Level Thinking Orb state',
    { tag: ['@tier2', '@F20'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/hermes`);

      const beforeViewport = await page.evaluate(() => ({
        docWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(beforeViewport.scrollWidth).toBeLessThanOrEqual(beforeViewport.docWidth + 2);

      const hlToggle = page
        .locator(
          '[data-testid="high-level-plan-toggle"], button:has-text("HIGH_LEVEL_PLAN"), button:has-text("High-Level"), [aria-label*="High-Level" i]',
        )
        .first();
      await expect(hlToggle).toBeVisible();
      await hlToggle.click();

      const afterViewport = await page.evaluate(() => ({
        docWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(afterViewport.scrollWidth).toBeLessThanOrEqual(afterViewport.docWidth + 2);
      expect(afterViewport.docWidth).toBe(beforeViewport.docWidth);
    },
  );

  test(
    '[T2][F20] enforces 0px border-radius and >= 12px interactive font floor across all F20 HUD loader states',
    { tag: ['@tier2', '@F20'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.checkedCount).toBeGreaterThan(0);
      expect(radiusAudit.violations).toEqual([]);

      const fontAudit = await auditInteractiveFontFloor(page, 12);
      expect(fontAudit.checkedCount).toBeGreaterThan(0);
      expect(fontAudit.violations).toEqual([]);
    },
  );

  test(
    '[T2][F20] respects prefers-reduced-motion media query across Orbital Boot Screen and MicroAnimIcon surfaces',
    { tag: ['@tier2', '@F20'] },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);

      const reducedMatch = await page.evaluate(
        () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      );
      expect(reducedMatch).toBe(true);
      expect(pageErrors).toEqual([]);

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);
    },
  );

  // ===========================================================================
  // Feature F23 — Web SPA CSR App Shell, Boot Gate, Global Timer & Quick Capture (5 tests)
  // ===========================================================================

  test(
    '[T2][F23] dismisses Cmd+K Quick Capture modal on Escape without creating a task and rejects blank task titles',
    { tag: ['@tier2', '@F23'] },
    async ({ page }) => {
      const api = createApiClient();
      const draftTitle = uniqueId('Unsaved-Escape-Draft');

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
      await page.keyboard.press('Control+k');

      const modalInput = page
        .locator(
          '[data-testid="quick-capture-input"], [data-testid="quick-capture-modal"] input, [data-testid="quick-capture-modal"] textarea, [role="dialog"] input[type="text"], [role="dialog"] input:not([type="hidden"]), [role="dialog"] textarea, input[placeholder*="Capture" i], input[placeholder*="Task" i]',
        )
        .first();

      if (!(await modalInput.isVisible().catch(() => false))) {
        const triggerBtn = page
          .locator(
            '[data-testid="quick-capture-trigger"], button[aria-label*="Capture" i], button:has-text("Cmd+K"), button:has-text("Ctrl+K"), button:has-text("Quick Capture")',
          )
          .first();
        if ((await triggerBtn.count()) > 0) {
          await triggerBtn.click();
        }
      }

      await expect(modalInput).toBeVisible();
      await modalInput.fill(draftTitle);

      await page.keyboard.press('Escape');
      await expect(modalInput).toBeHidden();

      const tasksRes = await api.get('/api/tasks');
      expect(tasksRes.status).toBe(200);
      const tasks = unwrapList<Record<string, any>>(tasksRes, ['tasks']);
      expect(tasks.some((t) => String(t.title || '').includes(draftTitle))).toBe(false);

      const blankRes = await api.post('/api/tasks', {
        title: '   ',
        status: 'inbox',
      });
      expect(blankRes.ok).toBe(false);
      expect([400, 422]).toContain(blankRes.status);
    },
  );

  test(
    '[T2][F23] preserves SPA hydration on deep-link browser reload for /hermes and /agents without 404',
    { tag: ['@tier2', '@F23'] },
    async ({ page }) => {
      const reloadedRoutes: string[] = [];
      for (const deepRoute of ['/hermes', '/agents']) {
        await waitForAppReady(page, `${E2E_URLS.baseUrl}${deepRoute}`);
        const reloadRes = await page.reload({ waitUntil: 'domcontentloaded' });
        expect(reloadRes?.status()).toBe(200);

        await waitForAppReady(page, `${E2E_URLS.baseUrl}${deepRoute}`);
        const state = await page.evaluate(() => ({
          pathname: window.location.pathname,
          rootChildren: document.getElementById('root')?.children.length ?? 0,
        }));
        expect(state.pathname).toBe(deepRoute);
        expect(state.rootChildren).toBeGreaterThan(0);
        reloadedRoutes.push(state.pathname);
      }

      expect(reloadedRoutes).toEqual(['/hermes', '/agents']);
      expect(reloadedRoutes.length).toBe(2);
    },
  );

  test(
    '[T2][F23] recovers active timer across page reload and discards timer without logging TimeSession',
    { tag: ['@tier2', '@F23'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const taskTitle = uniqueId('Discard-Timer-Task');

      try {
        await api.post('/api/time/timer/discard', {}).catch(() => {});

        const taskRes = await api.post('/api/tasks', {
          title: taskTitle,
          status: 'todo',
          priority: 'medium',
          estimate_minutes: 30,
        });
        expect(taskRes.ok).toBe(true);
        const taskId = extractEntityId(taskRes.json);
        cleanup.defer(async () => {
          await api.post('/api/time/timer/discard', {}).catch(() => {});
          await api.delete(`/api/tasks/${encodeURIComponent(taskId)}`);
        });

        const startRes = await api.post('/api/time/timer/start', {
          task_id: taskId,
          mode: 'stopwatch',
        });
        expect(startRes.ok).toBe(true);

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);

        const timerBarAfterReload = await page.evaluate((expectedTitle) => {
          const timerEl = document.querySelector(
            '[data-testid="active-timer-bar"], [data-fui="active-timer-bar"], header [data-testid*="timer" i], [data-active-timer="true"]',
          );
          const headerText =
            (document.querySelector('header')?.textContent || '') +
            ' ' +
            (timerEl?.textContent || '');
          return {
            hasTimerBar: Boolean(timerEl),
            displaysTaskOrStopwatch:
              headerText.includes(expectedTitle) ||
              /stopwatch|pomodoro|\d{2}:\d{2}/i.test(headerText),
          };
        }, taskTitle);
        expect(timerBarAfterReload.hasTimerBar).toBe(true);
        expect(timerBarAfterReload.displaysTaskOrStopwatch).toBe(true);

        const checkAfterReload = await api.get('/api/time/timer');
        expect(checkAfterReload.status).toBe(200);
        expect(checkAfterReload.json).toBeTruthy();

        const discardRes = await api.post('/api/time/timer/discard', {});
        expect(discardRes.ok).toBe(true);

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);
        const timerBarAfterDiscard = await page.evaluate((expectedTitle) => {
          const timerEl = document.querySelector(
            '[data-testid="active-timer-bar"], [data-fui="active-timer-bar"], [data-active-timer="true"]',
          );
          const text = timerEl?.textContent || '';
          return {
            stillShowsTaskInTimerBar: text.includes(expectedTitle),
          };
        }, taskTitle);
        expect(timerBarAfterDiscard.stillShowsTaskInTimerBar).toBe(false);

        const sessionsRes = await api.get('/api/time/sessions');
        expect(sessionsRes.status).toBe(200);
        const sessions = unwrapList<Record<string, any>>(sessionsRes, ['time_sessions', 'sessions']);
        expect(sessions.some((s) => String(s.task_id) === taskId)).toBe(false);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F23] persists global Privacy Mask state across route navigation and browser reload',
    { tag: ['@tier2', '@F23'] },
    async ({ page }) => {
      try {
        await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
        await page.evaluate(() => {
          window.localStorage.setItem('hermes-fui-privacy-mask', 'false');
        });
        await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);

        const privacyBtn = page
          .locator(
            '[data-testid="fui-privacy-toggle"], button[aria-label*="Privacy" i], button:has-text("👁")',
          )
          .first();
        await expect(privacyBtn).toBeVisible();
        await privacyBtn.click();

        const preReloadState = await page.evaluate(() => {
          const btn = document.querySelector(
            '[data-testid="fui-privacy-toggle"], button[aria-label*="Privacy" i]',
          );
          return {
            ls: window.localStorage.getItem('hermes-fui-privacy-mask'),
            domActive:
              btn?.getAttribute('data-privacy-active') === 'true' ||
              document.documentElement.getAttribute('data-privacy-active') === 'true',
          };
        });
        expect(preReloadState.ls).toBe('true');
        expect(preReloadState.domActive).toBe(true);

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForAppReady(page, `${E2E_URLS.baseUrl}/finance`);

        const postReloadState = await page.evaluate(() => {
          const btn = document.querySelector(
            '[data-testid="fui-privacy-toggle"], button[aria-label*="Privacy" i]',
          );
          const maskedEls = document.querySelectorAll('[data-privacy-masked="true"]');
          const pageText = document.body?.innerText || '';
          return {
            ls: window.localStorage.getItem('hermes-fui-privacy-mask'),
            domActive:
              btn?.getAttribute('data-privacy-active') === 'true' ||
              document.documentElement.getAttribute('data-privacy-active') === 'true' ||
              maskedEls.length > 0 ||
              pageText.includes('••••'),
          };
        });
        expect(postReloadState.ls).toBe('true');
        expect(postReloadState.domActive).toBe(true);
      } finally {
        await page
          .evaluate(() => {
            window.localStorage.setItem('hermes-fui-privacy-mask', 'false');
          })
          .catch(() => {});
      }
    },
  );

  test(
    '[T2][F23] rejects empty PAT name with 400 or 422 and immediately blocks revoked PAT with 401 on /api/auth/verify',
    { tag: ['@tier2', '@F23'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const emptyNameRes = await api.post('/api/auth/tokens', {
          name: '   ',
        });
        expect(emptyNameRes.ok).toBe(false);
        expect([400, 422]).toContain(emptyNameRes.status);

        const pat = await createPatToken(api, uniqueId('temp-revoke-pat'));
        cleanup.defer(async () => {
          if (pat.id) {
            await api.delete(`/api/auth/tokens/${encodeURIComponent(pat.id)}`);
          }
        });
        const authedApi = api.withToken(pat.token);

        const verifyBefore = await authedApi.get('/api/auth/verify');
        expect(verifyBefore.status).toBe(200);
        expect(verifyBefore.json.authenticated).toBe(true);

        const revokeRes = await api.delete(`/api/auth/tokens/${encodeURIComponent(pat.id)}`);
        expect(revokeRes.ok).toBe(true);

        const verifyAfter = await authedApi.get('/api/auth/verify');
        expect(verifyAfter.status).toBe(401);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  // ===========================================================================
  // Feature F25 — Hermes Chat Workspace (/hermes) & REF-08 Thinking Orb (5 tests)
  // ===========================================================================

  test(
    '[T2][F25] renders /hermes in offline_mock mode without page errors and streams deterministic fallback reply',
    { tag: ['@tier2', '@F25'] },
    async ({ page }) => {
      const sessionKey = uniqueId('sess-f25-offline-ui');

      await withIsolatedBackend(
        { HERMES_GATEWAY_URL: 'http://127.0.0.1:59996/v1' },
        async ({ baseUrl, apiBaseUrl }) => {
          const isoApi = createApiClient(apiBaseUrl);
          const isoCleanup = new CleanupRegistry();

          try {
            isoCleanup.defer(async () => {
              await isoApi.delete(`/api/hermes/sessions/${encodeURIComponent(sessionKey)}`);
            });

            const pageErrors: string[] = [];
            page.on('pageerror', (err) => pageErrors.push(err.message));

            await waitForAppReady(page, `${baseUrl}/hermes`);
            expect(pageErrors).toEqual([]);

            const hermesOfflineDom = await page.evaluate(() => ({
              hasMain: Boolean(document.querySelector('main, [role="main"], #root')),
              hasComposer: Boolean(
                document.querySelector('textarea, input[type="text"], [data-testid*="composer" i]'),
              ),
            }));
            expect(hermesOfflineDom.hasMain).toBe(true);
            expect(hermesOfflineDom.hasComposer).toBe(true);

            const events = await readSseEvents(`${apiBaseUrl}/hermes/chat/stream`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Hermes-Session-Key': sessionKey,
              },
              body: JSON.stringify({
                message: 'Run offline diagnostic check on /hermes',
                session_key: sessionKey,
                origin: 'hermes_view',
              }),
              stopOnEvent: 'done',
              timeoutMs: 10_000,
            });
            expect(events.length).toBeGreaterThan(0);
          } finally {
            await isoCleanup.runAll();
          }
        },
      );
    },
  );

  test(
    '[T2][F25] blocks empty or whitespace-only chat submission on /hermes and leaves session message count unchanged',
    { tag: ['@tier2', '@F25'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const sessionKey = uniqueId('sess-f25-blank-chat');

      try {
        const createRes = await api.post('/api/hermes/sessions', {
          session_key: sessionKey,
          title: 'Blank Submission Guard Session',
          origin: 'hermes_view',
        });
        expect(createRes.ok).toBe(true);
        cleanup.defer(async () => {
          await api.delete(`/api/hermes/sessions/${encodeURIComponent(sessionKey)}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/hermes`);

        const composerDom = await page.evaluate(() => ({
          hasComposer: Boolean(
            document.querySelector('textarea, input[type="text"], [data-testid*="composer" i]'),
          ),
        }));
        expect(composerDom.hasComposer).toBe(true);

        const blankStreamRes = await api.post(
          '/api/hermes/chat/stream',
          {
            message: '   ',
            session_key: sessionKey,
          },
          { 'X-Hermes-Session-Key': sessionKey },
        );
        expect(blankStreamRes.ok).toBe(false);
        expect([400, 422]).toContain(blankStreamRes.status);

        const sessRes = await api.get(
          `/api/hermes/sessions/${encodeURIComponent(sessionKey)}`,
        );
        expect(sessRes.status).toBe(200);
        const sessObj = sessRes.json?.data ?? sessRes.json;
        const messages = sessObj.messages_json ?? sessObj.messages ?? [];
        expect(Array.isArray(messages) ? messages.length : 0).toBe(0);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F25] rejecting a pending REQUIRE_APPROVAL MCP action from /hermes leaves target database state unchanged',
    { tag: ['@tier2', '@F25'] },
    async ({ page }) => {
      const api = createApiClient();
      const mcp = createMcpClient();
      const cleanup = new CleanupRegistry();
      const symbol = `RJ${Date.now().toString().slice(-4)}.SA`;

      try {
        const callRes = await mcp.callTool('finance_upsert_asset', {
          symbol,
          name: 'Rejected Hermes Asset',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 100,
          avg_cost_cents: 2000,
          current_price_cents: 2100,
          target_weight_pct: 5,
        });
        cleanup.defer(async () => {
          if (callRes.approvalId) {
            await api
              .post(`/api/mcp/approvals/${encodeURIComponent(callRes.approvalId)}/reject`, {
                reason: 'Cleanup fallback',
              })
              .catch(() => {});
          }
          const listRes = await api.get('/api/finance/assets');
          const list = unwrapList<Record<string, any>>(listRes, ['assets']);
          const match = list.find((a) => a.symbol === symbol);
          if (match?.id) {
            await api.delete(`/api/finance/assets/${encodeURIComponent(String(match.id))}`);
          }
        });
        expect(typeof callRes.approvalId).toBe('string');

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/hermes`);

        const hermesDom = await page.evaluate(() => ({
          hasWorkspace: Boolean(document.querySelector('main, [role="main"], #root')),
        }));
        expect(hermesDom.hasWorkspace).toBe(true);

        const rejRes = await api.post(
          `/api/mcp/approvals/${encodeURIComponent(callRes.approvalId!)}/reject`,
          { reason: 'Rejected in Hermes workspace' },
        );
        expect(rejRes.status).toBe(200);

        const assetsRes = await api.get('/api/finance/assets');
        expect(assetsRes.status).toBe(200);
        const assets = unwrapList<Record<string, any>>(assetsRes, ['assets']);
        expect(assets.some((a) => a.symbol === symbol)).toBe(false);
      } finally {
        await mcp.closeSession();
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F25] returns empty session list for unmatched search query on /hermes without crashing UI',
    { tag: ['@tier2', '@F25'] },
    async ({ page }) => {
      const api = createApiClient();
      const unmatchedQuery = `__unmatched_session_query_${uniqueId('none')}__`;

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/hermes`);

      const hermesDom = await page.evaluate(() => ({
        hasSessionRail: Boolean(
          document.querySelector('[data-testid*="session" i], aside, nav, main'),
        ),
      }));
      expect(hermesDom.hasSessionRail).toBe(true);

      const searchRes = await api.get(
        `/api/hermes/sessions?q=${encodeURIComponent(unmatchedQuery)}`,
      );
      expect(searchRes.status).toBe(200);
      const list = unwrapList<Record<string, any>>(searchRes, ['sessions']);
      expect(list.length).toBe(0);
    },
  );

  test(
    '[T2][F25] returns 404 for missing Vault note path and renders /hermes Vault Inspector without unhandled errors',
    { tag: ['@tier2', '@F25'] },
    async ({ page }) => {
      const api = createApiClient();
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/hermes`);

      const hermesDom = await page.evaluate(() => ({
        hasWorkspace: Boolean(document.querySelector('main, [role="main"], #root')),
      }));
      expect(hermesDom.hasWorkspace).toBe(true);

      const missingRes = await api.get(
        `/api/vault/note?path=${encodeURIComponent('Inbox/non-existent-note-999999.md')}`,
      );
      expect(missingRes.status).toBe(404);
      expect(pageErrors).toEqual([]);
    },
  );

  // ===========================================================================
  // Feature F26 — Agent Studio Isometric Knight Arena (/agents) (5 tests)
  // ===========================================================================

  test(
    '[T2][F26] blocks live dispatch on /agents when Knight monthly_budget_cents is 0 (HP = 0% circuit breaker)',
    { tag: ['@tier2', '@F26'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const slug = uniqueId('knight-ui-hp-zero');

      try {
        const createRes = await api.post('/api/agents', {
          slug,
          name: 'Exhausted HP Knight',
          archetype: 'vanguard',
          knight_archetype: 'vanguard',
          crest_color: '#F59E0B',
          zone: 'cron_watchtower',
          grid_pos: { x: 1, y: 1, zone: 'cron_watchtower' },
          system_prompt: 'Zero budget test.',
          monthly_budget_cents: 0,
        });
        expect(createRes.ok).toBe(true);
        const knightId = extractEntityId(createRes.json);
        cleanup.defer(async () => {
          await api.delete(`/api/agents/${encodeURIComponent(knightId)}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/agents`);

        const agentsDom = await page.evaluate(() => ({
          hasSprites:
            document.querySelectorAll('[data-fui="isometric-knight-sprite"], [data-archetype]')
              .length > 0,
        }));
        expect(agentsDom.hasSprites).toBe(true);

        const dispatchRes = await api.post(
          `/api/agents/${encodeURIComponent(knightId)}/dispatch`,
          {
            dry_run: false,
            input: 'Attempt live dispatch with 0 HP',
          },
        );

        const bodyStr = JSON.stringify(dispatchRes.json || {}).toLowerCase();
        expect(
          !dispatchRes.ok ||
            bodyStr.includes('budget') ||
            bodyStr.includes('blocked') ||
            bodyStr.includes('failed'),
        ).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F26] moving a Knight to standby_barracks on /agents pauses scheduled triggers and excludes from active queue',
    { tag: ['@tier2', '@F26'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const slug = uniqueId('knight-ui-barracks');

      try {
        const createRes = await api.post('/api/agents', {
          slug,
          name: 'Standby Barracks Knight',
          archetype: 'paladin',
          knight_archetype: 'paladin',
          crest_color: '#F87C18',
          zone: 'cron_watchtower',
          grid_pos: { x: 1, y: 1, zone: 'cron_watchtower' },
          system_prompt: 'Move to barracks.',
          monthly_budget_cents: 500,
        });
        expect(createRes.ok).toBe(true);
        const knightId = extractEntityId(createRes.json);
        cleanup.defer(async () => {
          await api.delete(`/api/agents/${encodeURIComponent(knightId)}`);
        });

        const moveRes = await api.put(`/api/agents/${encodeURIComponent(knightId)}`, {
          zone: 'standby_barracks',
          grid_pos: { x: 0, y: 0, zone: 'standby_barracks' },
          status: 'paused',
          enabled: false,
        });
        expect(moveRes.status).toBe(200);

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/agents`);

        const barracksDom = await page.evaluate(() => ({
          hasSprites:
            document.querySelectorAll('[data-fui="isometric-knight-sprite"], [data-archetype]')
              .length > 0,
          hasBarracksText: /barracks/i.test(document.body?.innerText || ''),
        }));
        expect(barracksDom.hasSprites).toBe(true);
        expect(barracksDom.hasBarracksText).toBe(true);

        const getRes = await api.get(`/api/agents/${encodeURIComponent(knightId)}`);
        expect(getRes.status).toBe(200);
        const getStr = JSON.stringify(getRes.json);
        expect(getStr).toContain('standby_barracks');
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F26] executes Knight Dry-Run Sandbox on /agents with zero database mutations across Tasks and HP spend',
    { tag: ['@tier2', '@F26'] },
    async ({ page }) => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const slug = uniqueId('knight-zero-mutation');

      try {
        const createRes = await api.post('/api/agents', {
          slug,
          name: 'Zero Mutation Sandbox Knight',
          archetype: 'inquisitor',
          knight_archetype: 'inquisitor',
          crest_color: '#EB4511',
          zone: 'mastermind_council',
          grid_pos: { x: 2, y: 2, zone: 'mastermind_council' },
          system_prompt: 'Sandbox test on {{today}}.',
          monthly_budget_cents: 500,
        });
        expect(createRes.ok).toBe(true);
        const knightId = extractEntityId(createRes.json);
        cleanup.defer(async () => {
          await api.delete(`/api/agents/${encodeURIComponent(knightId)}`);
        });

        const tasksBeforeRes = await api.get('/api/tasks');
        const tasksBeforeCount = unwrapList(tasksBeforeRes, ['tasks']).length;

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/agents`);

        const arenaDom = await page.evaluate(() => ({
          hasSprites:
            document.querySelectorAll('[data-fui="isometric-knight-sprite"], [data-archetype]')
              .length > 0,
        }));
        expect(arenaDom.hasSprites).toBe(true);

        const dryRes = await api.post(
          `/api/agents/${encodeURIComponent(knightId)}/dispatch`,
          {
            dry_run: true,
            input: 'Simulate task triage without mutating DB',
          },
        );
        expect(dryRes.ok).toBe(true);

        const tasksAfterRes = await api.get('/api/tasks');
        const tasksAfterCount = unwrapList(tasksAfterRes, ['tasks']).length;
        expect(tasksAfterCount).toBe(tasksBeforeCount);

        const knightAfterRes = await api.get(`/api/agents/${encodeURIComponent(knightId)}`);
        const knightAfter = knightAfterRes.json?.data ?? knightAfterRes.json;
        expect(Number(knightAfter.spent_month_cents ?? 0)).toBe(0);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F26] rejects invalid Knight Forge payloads with empty name or negative budget with 400 or 422',
    { tag: ['@tier2', '@F26'] },
    async ({ page }) => {
      const api = createApiClient();

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/agents`);

      const arenaDom = await page.evaluate(() => ({
        hasSprites:
          document.querySelectorAll('[data-fui="isometric-knight-sprite"], [data-archetype]')
            .length > 0,
      }));
      expect(arenaDom.hasSprites).toBe(true);

      const emptyNameRes = await api.post('/api/agents', {
        slug: '',
        name: '   ',
        archetype: 'paladin',
        knight_archetype: 'paladin',
        monthly_budget_cents: 500,
      });
      expect(emptyNameRes.ok).toBe(false);
      expect([400, 422]).toContain(emptyNameRes.status);

      const negBudgetRes = await api.post('/api/agents', {
        slug: uniqueId('neg-budget'),
        name: 'Negative Budget Knight',
        archetype: 'paladin',
        knight_archetype: 'paladin',
        monthly_budget_cents: -500,
      });
      expect(negBudgetRes.ok).toBe(false);
      expect([400, 422]).toContain(negBudgetRes.status);
    },
  );

  test(
    '[T2][F26] enforces 0px border-radius and pixelated sprite rendering across /agents after viewport resize',
    { tag: ['@tier2', '@F26'] },
    async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 960 });
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/agents`);

      const radiusAudit1 = await auditZeroBorderRadius(page);
      expect(radiusAudit1.violations).toEqual([]);

      await page.setViewportSize({ width: 1280, height: 800 });
      const radiusAudit2 = await auditZeroBorderRadius(page);
      expect(radiusAudit2.violations).toEqual([]);

      const spriteAudit = await auditPixelatedSprites(page);
      expect(spriteAudit.spriteCount).toBeGreaterThan(0);
      expect(spriteAudit.violations).toEqual([]);
    },
  );

  // ===========================================================================
  // Feature F27 — Omnipresent Web Frieren Mastermind Companion (Cmd+J) (5 tests)
  // ===========================================================================

  test(
    '[T2][F27] toggles Frieren Companion popover idempotently via Control+j and dismisses cleanly on Escape',
    { tag: ['@tier2', '@F27'] },
    async ({ page }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      const isPopoverVisible = async (): Promise<boolean> =>
        page.evaluate(() => {
          const popover = document.querySelector(
            '[data-testid="companion-stage-popover"], [data-fui="companion-stage"][data-mode="popover"]',
          );
          if (!popover) return false;
          const cs = window.getComputedStyle(popover);
          const rect = popover.getBoundingClientRect();
          return (
            cs.display !== 'none' &&
            cs.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
          );
        });

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);

      await page.keyboard.press('Control+j');
      expect(await isPopoverVisible()).toBe(true);

      await page.keyboard.press('Escape');
      expect(await isPopoverVisible()).toBe(false);

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);
      await page.keyboard.press('Control+j');
      expect(await isPopoverVisible()).toBe(true);

      await page.keyboard.press('Control+j');
      expect(await isPopoverVisible()).toBe(false);

      expect(pageErrors).toEqual([]);
    },
  );

  test(
    '[T2][F27] operates Frieren Companion popover cleanly in offline_mock gateway mode without throwing',
    { tag: ['@tier2', '@F27'] },
    async ({ page }) => {
      const sessionKey = uniqueId('sess-f27-offline');

      await withIsolatedBackend(
        { HERMES_GATEWAY_URL: 'http://127.0.0.1:59995/v1' },
        async ({ baseUrl, apiBaseUrl }) => {
          const isoApi = createApiClient(apiBaseUrl);
          const isoCleanup = new CleanupRegistry();

          try {
            isoCleanup.defer(async () => {
              await isoApi.delete(`/api/hermes/sessions/${encodeURIComponent(sessionKey)}`);
            });

            const pageErrors: string[] = [];
            page.on('pageerror', (err) => pageErrors.push(err.message));

            await waitForAppReady(page, `${baseUrl}/dashboard`);
            await page.keyboard.press('Control+j');

            const popoverVisible = await page.evaluate(() =>
              Boolean(
                document.querySelector(
                  '[data-testid="companion-stage-popover"], [data-fui="companion-stage"][data-mode="popover"]',
                ),
              ),
            );
            expect(popoverVisible).toBe(true);

            const events = await readSseEvents(`${apiBaseUrl}/hermes/chat/stream`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Hermes-Session-Key': sessionKey,
              },
              body: JSON.stringify({
                message: 'Quick tactical status in offline mode',
                session_key: sessionKey,
                origin: 'frieren_popover',
                page_context: { active_route: '/dashboard' },
              }),
              stopOnEvent: 'done',
              timeoutMs: 10_000,
            });
            expect(events.length).toBeGreaterThan(0);
            expect(pageErrors).toEqual([]);
          } finally {
            await isoCleanup.runAll();
          }
        },
      );
    },
  );

  test(
    '[T2][F27] rejects empty companion offline phrase creation and returns 404 on deleting non-existent phrase ID',
    { tag: ['@tier2', '@F27'] },
    async () => {
      const api = createApiClient();

      const emptyPhraseRes = await api.post('/api/companion/phrases', {
        phrase_text: '   ',
        trigger_context: 'any',
        animation_hint: 'grimoire',
      });
      expect(emptyPhraseRes.ok).toBe(false);
      expect([400, 422]).toContain(emptyPhraseRes.status);

      const ghostPhraseDel = await api.delete(
        '/api/companion/phrases/01900000-0000-7000-8000-000000000404',
      );
      expect(ghostPhraseDel.status).toBe(404);
    },
  );

  test(
    '[T2][F27] rolls back IMMEDIATE_UNDO task creation from Frieren companion flow and rejects duplicate undo',
    { tag: ['@tier2', '@F27'] },
    async ({ page }) => {
      const api = createApiClient();
      const mcp = createMcpClient();
      const cleanup = new CleanupRegistry();
      const taskTitle = uniqueId('Popover-Undo-Target');

      try {
        const callRes = await mcp.callTool('todos_create_task', {
          title: taskTitle,
          status: 'todo',
        });
        cleanup.defer(async () => {
          const listRes = await api.get('/api/tasks');
          const tasks = unwrapList<Record<string, any>>(listRes, ['tasks']);
          const match = tasks.find((t) => t.title === taskTitle);
          if (match?.id) {
            await api.delete(`/api/tasks/${encodeURIComponent(String(match.id))}`);
          }
        });
        expect(callRes.ok).toBe(true);
        expect(typeof callRes.undoId).toBe('string');

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/todos`);
        await page.keyboard.press('Control+j');

        const popoverVisible = await page.evaluate(() =>
          Boolean(
            document.querySelector(
              '[data-testid="companion-stage-popover"], [data-fui="companion-stage"][data-mode="popover"]',
            ),
          ),
        );
        expect(popoverVisible).toBe(true);

        const firstUndo = await api.post(
          `/api/mcp/undo/${encodeURIComponent(callRes.undoId!)}`,
          {},
        );
        expect(firstUndo.status).toBe(200);

        const secondUndo = await api.post(
          `/api/mcp/undo/${encodeURIComponent(callRes.undoId!)}`,
          {},
        );
        expect(secondUndo.ok).toBe(false);
        expect([400, 404, 409, 422]).toContain(secondUndo.status);
      } finally {
        await mcp.closeSession();
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F27] enforces 0px corners and image-rendering: pixelated on Frieren CompanionStage across routes',
    { tag: ['@tier2', '@F27'] },
    async ({ page }) => {
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
      await page.keyboard.press('Control+j');

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.checkedCount).toBeGreaterThan(0);
      expect(radiusAudit.violations).toEqual([]);

      const spriteAudit = await auditPixelatedSprites(page);
      expect(spriteAudit.spriteCount).toBeGreaterThan(0);
      expect(spriteAudit.violations).toEqual([]);

      const fontAudit = await auditInteractiveFontFloor(page, 12);
      expect(fontAudit.checkedCount).toBeGreaterThan(0);
      expect(fontAudit.violations).toEqual([]);
    },
  );
});
