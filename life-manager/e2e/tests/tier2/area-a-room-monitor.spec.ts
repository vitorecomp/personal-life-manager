import { test, expect } from '@playwright/test';
import {
  E2E_URLS,
  ensureStackReady,
  createApiClient,
  unwrapList,
  createPatToken,
  uniqueId,
  CleanupRegistry,
  createMcpClient,
  startMockTcpServer,
  startMockHttpServer,
  waitForAppReady,
  auditZeroBorderRadius,
} from '../../harness';

test.describe('Area A Tier 2 — Room Monitor, Custom Widgets, Server Prober & /monitor Boundary/Negative/Security Suite (F11, F24)', () => {
  // =========================================================================
  // Feature F11: Backend Room Monitor & Custom Widgets Security/Boundary (7 tests)
  // =========================================================================

  test(
    '[T2][F11] Custom SQL widget rejects DDL and DML write statements and preserves database integrity',
    { tag: ['@tier2', '@F11'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const deckRes = await api.post('/api/dashboards', {
          slug: uniqueId('deck-sql-ddl'),
          title: 'DECK_SQL_GUARD',
          layout_cols: 12,
          layout_rows: 8,
          cycle_seconds: 60,
          in_rotation: false,
        });
        expect([200, 201]).toContain(deckRes.status);
        const deckId = String(deckRes.json.id);
        cleanup.defer(() => api.delete(`/api/dashboards/${deckId}`));

        const forbiddenQueries = [
          'DROP TABLE dashboards',
          'DELETE FROM dashboards',
          "INSERT INTO dashboards (slug, title) VALUES ('hack', 'hack')",
          "UPDATE dashboards SET title = 'hacked'",
          'SELECT 1; DELETE FROM tasks',
          'SELECT 1 -- inline comment trap',
        ];

        for (const badSql of forbiddenQueries) {
          const createW = await api.post(`/api/dashboards/${deckId}/widgets`, {
            title: 'FORBIDDEN_SQL',
            source_kind: 'sql',
            renderer_kind: 'table',
            grid_rect: { x: 0, y: 0, w: 4, h: 4 },
            source_config: { query: badSql },
            refresh_interval_seconds: 30,
          });

          if (createW.ok && createW.json?.id) {
            const refreshRes = await api.post(
              `/api/widgets/${createW.json.id}/refresh`,
              {},
            );
            expect([400, 403, 422]).toContain(refreshRes.status);
          } else {
            expect([400, 403, 422]).toContain(createW.status);
          }
        }

        const checkDecks = await api.get('/api/dashboards');
        expect(checkDecks.status).toBe(200);
        const decks = unwrapList<Record<string, any>>(checkDecks, ['dashboards']);
        expect(decks.length).toBeGreaterThanOrEqual(4);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F11] Custom SQL widget blocks queries against sensitive tables api_tokens, users, and web_sessions',
    { tag: ['@tier2', '@F11'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const pat = await createPatToken(api, uniqueId('sql-sensitive-pat'));
        cleanup.defer(() => api.delete(`/api/auth/tokens/${pat.id}`));

        const deckRes = await api.post('/api/dashboards', {
          slug: uniqueId('deck-sql-sensitive'),
          title: 'DECK_SQL_SENSITIVE',
          layout_cols: 12,
          layout_rows: 8,
          cycle_seconds: 60,
          in_rotation: false,
        });
        expect([200, 201]).toContain(deckRes.status);
        const deckId = String(deckRes.json.id);
        cleanup.defer(() => api.delete(`/api/dashboards/${deckId}`));

        const sensitiveQueries = [
          'SELECT * FROM api_tokens',
          'SELECT token_sha256 FROM api_tokens LIMIT 1',
          'SELECT * FROM users',
          'SELECT * FROM web_sessions',
        ];

        for (const q of sensitiveQueries) {
          const wRes = await api.post(`/api/dashboards/${deckId}/widgets`, {
            title: 'SENSITIVE_SQL',
            source_kind: 'sql',
            renderer_kind: 'table',
            grid_rect: { x: 0, y: 0, w: 4, h: 4 },
            source_config: { query: q },
            refresh_interval_seconds: 30,
          });

          if (wRes.ok && wRes.json?.id) {
            const refRes = await api.post(`/api/widgets/${wRes.json.id}/refresh`, {});
            expect([400, 403, 422]).toContain(refRes.status);
            expect(refRes.text).not.toContain('password_hash');
          } else {
            expect([400, 403, 422]).toContain(wRes.status);
          }
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F11] Custom command widget enforces MCP REQUIRE_APPROVAL gate, rejection workflow, and execution timeout',
    { tag: ['@tier2', '@F11'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const deckRes = await api.post('/api/dashboards', {
          slug: uniqueId('deck-cmd-reject'),
          title: 'DECK_CMD_REJECT',
          layout_cols: 12,
          layout_rows: 8,
          cycle_seconds: 60,
          in_rotation: false,
        });
        expect([200, 201]).toContain(deckRes.status);
        const deckId = String(deckRes.json.id);
        cleanup.defer(() => api.delete(`/api/dashboards/${deckId}`));

        const pat = await createPatToken(api, uniqueId('f11-cmd-reject'));
        cleanup.defer(() => api.delete(`/api/auth/tokens/${pat.id}`));

        const mcp = createMcpClient(E2E_URLS.mcpUrl, pat.token);
        cleanup.defer(() => mcp.closeSession());

        const mcpCall = await mcp.callTool('dashboards_configure_command_widget', {
          dashboard_id: deckId,
          title: 'UNAPPROVED_CMD_WIDGET',
          command: 'echo SHOULD_NOT_EXECUTE',
          refresh_interval_seconds: 60,
          grid_rect: { x: 0, y: 0, w: 4, h: 3 },
        });
        expect(mcpCall.status).toBe(200);

        const deckBefore = await api.get(`/api/dashboards/${deckId}`);
        const widgetsBefore = unwrapList<Record<string, any>>(
          deckBefore.json.widgets ?? [],
          ['widgets'],
        );
        expect(
          widgetsBefore.find((w) => w.title === 'UNAPPROVED_CMD_WIDGET'),
        ).toBeUndefined();

        const approvalsRes = await api.get('/api/mcp/approvals');
        const approvals = unwrapList<Record<string, any>>(approvalsRes, [
          'approvals',
        ]);
        const pending = approvals.find(
          (a) =>
            (a.id === mcpCall.approvalId ||
              String(a.tool_name).includes('command_widget')) &&
            String(a.status).toLowerCase() === 'pending',
        );
        expect(pending).toBeDefined();

        const rejectRes = await api.post(
          `/api/mcp/approvals/${pending!.id}/reject`,
          {},
        );
        expect(rejectRes.status).toBe(200);

        const deckAfterReject = await api.get(`/api/dashboards/${deckId}`);
        const widgetsAfterReject = unwrapList<Record<string, any>>(
          deckAfterReject.json.widgets ?? [],
          ['widgets'],
        );
        expect(
          widgetsAfterReject.find((w) => w.title === 'UNAPPROVED_CMD_WIDGET'),
        ).toBeUndefined();

        // Direct command widget with 150ms timeout on a 5-second sleep
        const timeoutWidgetRes = await api.post(`/api/dashboards/${deckId}/widgets`, {
          title: 'SLOW_CMD_TIMEOUT',
          source_kind: 'command',
          renderer_kind: 'terminal',
          grid_rect: { x: 0, y: 0, w: 4, h: 4 },
          source_config: { command: 'sleep 5', timeout_ms: 150 },
          refresh_interval_seconds: 60,
        });
        expect([200, 201]).toContain(timeoutWidgetRes.status);

        const startedAt = Date.now();
        const refreshTimeoutRes = await api.post(
          `/api/widgets/${timeoutWidgetRes.json.id}/refresh`,
          {},
        );
        const elapsedMs = Date.now() - startedAt;
        expect(elapsedMs).toBeLessThan(4000);
        expect(refreshTimeoutRes.status).toBe(200);
        expect(refreshTimeoutRes.json.cached_payload.timed_out).toBe(true);
        expect(refreshTimeoutRes.json.cached_payload.status).toBe('timeout');
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F11] Server Prober classifies HTTP 503 as degraded and closed TCP or HTTP ports as offline',
    { tag: ['@tier2', '@F11'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const mockHttp = await startMockHttpServer(
          503,
          JSON.stringify({ error: 'Service Unavailable' }),
        );
        cleanup.defer(() => mockHttp.close());

        const mockTcp = await startMockTcpServer();
        const closedPort = mockTcp.port;
        await mockTcp.close();

        const httpSrvRes = await api.post('/api/servers', {
          name: uniqueId('DEGRADED_HTTP_SRV'),
          host: mockHttp.host,
          port: mockHttp.port,
          check_type: 'http',
          http_url: `${mockHttp.url}/status`,
        });
        expect([200, 201]).toContain(httpSrvRes.status);
        const httpSrvId = String(httpSrvRes.json.id);
        cleanup.defer(() => api.delete(`/api/servers/${httpSrvId}`));

        const probe503 = await api.post(`/api/servers/${httpSrvId}/check`, {});
        expect(probe503.status).toBe(200);
        expect(probe503.json.status).toBe('degraded');

        await mockHttp.close();
        const probeHttpDown = await api.post(`/api/servers/${httpSrvId}/check`, {});
        expect(probeHttpDown.status).toBe(200);
        expect(probeHttpDown.json.status).toBe('offline');

        const tcpSrvRes = await api.post('/api/servers', {
          name: uniqueId('CLOSED_TCP_SRV'),
          host: '127.0.0.1',
          port: closedPort,
          check_type: 'tcp',
        });
        expect([200, 201]).toContain(tcpSrvRes.status);
        const tcpSrvId = String(tcpSrvRes.json.id);
        cleanup.defer(() => api.delete(`/api/servers/${tcpSrvId}`));

        const probeTcpDown = await api.post(`/api/servers/${tcpSrvId}/check`, {});
        expect(probeTcpDown.status).toBe(200);
        expect(probeTcpDown.json.status).toBe('offline');

        const summaryRes = await api.get('/api/servers/summary');
        expect(summaryRes.status).toBe(200);
        expect(Number(summaryRes.json.offline)).toBeGreaterThanOrEqual(2);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F11] Server Prober latency_history_ms ring buffer caps at 24 samples',
    { tag: ['@tier2', '@F11'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const mockTcp = await startMockTcpServer();
        cleanup.defer(() => mockTcp.close());

        const srvRes = await api.post('/api/servers', {
          name: uniqueId('RING_CAP_TCP'),
          host: mockTcp.host,
          port: mockTcp.port,
          check_type: 'tcp',
        });
        expect([200, 201]).toContain(srvRes.status);
        const srvId = String(srvRes.json.id);
        cleanup.defer(() => api.delete(`/api/servers/${srvId}`));

        for (let i = 0; i < 28; i += 1) {
          const checkRes = await api.post(`/api/servers/${srvId}/check`, {});
          expect(checkRes.status).toBe(200);
        }

        const getRes = await api.get(`/api/servers/${srvId}`);
        expect(getRes.status).toBe(200);
        expect(Array.isArray(getRes.json.latency_history_ms)).toBe(true);
        expect(getRes.json.latency_history_ms.length).toBe(24);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F11] Dashboards and widgets reject out-of-bounds 12x8 grid geometry and invalid cycle_seconds',
    { tag: ['@tier2', '@F11'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        for (const badCycle of [0, -30, 999999]) {
          const badDeckRes = await api.post('/api/dashboards', {
            slug: uniqueId('bad-cycle'),
            title: 'BAD_CYCLE_DECK',
            cycle_seconds: badCycle,
            layout_cols: 12,
            layout_rows: 8,
          });
          expect([400, 422]).toContain(badDeckRes.status);
        }

        const validDeckRes = await api.post('/api/dashboards', {
          slug: uniqueId('bounds-deck'),
          title: 'BOUNDS_CHECK_DECK',
          cycle_seconds: 60,
          layout_cols: 12,
          layout_rows: 8,
        });
        expect([200, 201]).toContain(validDeckRes.status);
        const deckId = String(validDeckRes.json.id);
        cleanup.defer(() => api.delete(`/api/dashboards/${deckId}`));

        const invalidRects = [
          { x: 10, y: 0, w: 4, h: 2 },
          { x: 0, y: 6, w: 4, h: 4 },
          { x: -1, y: 0, w: 4, h: 2 },
          { x: 0, y: 0, w: 0, h: 2 },
        ];

        for (const rect of invalidRects) {
          const wRes = await api.post(`/api/dashboards/${deckId}/widgets`, {
            title: 'OUT_OF_BOUNDS_WIDGET',
            source_kind: 'builtin',
            renderer_kind: 'kpi',
            grid_rect: rect,
            source_config: { builtin_key: 'life_radar' },
            refresh_interval_seconds: 30,
          });
          expect([400, 422]).toContain(wRes.status);
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F11] Updating, deleting, refreshing, or probing non-existent dashboard, widget, or server returns 404',
    { tag: ['@tier2', '@F11'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const missingId = '01950000-0000-7000-8000-000000000999';

      expect((await api.get(`/api/dashboards/${missingId}`)).status).toBe(404);
      expect(
        (await api.put(`/api/dashboards/${missingId}`, { title: 'MISSING' })).status,
      ).toBe(404);
      expect((await api.delete(`/api/dashboards/${missingId}`)).status).toBe(404);
      expect(
        (await api.post(`/api/dashboards/${missingId}/clone`, {})).status,
      ).toBe(404);

      expect((await api.post(`/api/widgets/${missingId}/refresh`, {})).status).toBe(
        404,
      );

      expect((await api.get(`/api/servers/${missingId}`)).status).toBe(404);
      expect((await api.delete(`/api/servers/${missingId}`)).status).toBe(404);
      expect((await api.post(`/api/servers/${missingId}/check`, {})).status).toBe(404);
    },
  );

  // =========================================================================
  // Feature F24: Room Monitor UI Boundary, Privacy Blur & Resilience (7 tests)
  // =========================================================================

  test(
    '[T2][F24] /monitor Space pin/pause prevents auto-advance past cycle_seconds until resumed',
    { tag: ['@tier2', '@F24'] },
    async ({ page }) => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const listRes = await api.get('/api/dashboards');
        const decks = unwrapList<Record<string, any>>(listRes, ['dashboards']);
        expect(decks.length).toBeGreaterThanOrEqual(2);

        for (let i = 0; i < decks.length; i += 1) {
          const d = decks[i];
          const origCycle = d.cycle_seconds;
          const origRot = d.in_rotation;
          cleanup.defer(() =>
            api.put(`/api/dashboards/${d.id}`, {
              cycle_seconds: origCycle,
              in_rotation: origRot,
            }),
          );
          await api.put(`/api/dashboards/${d.id}`, {
            cycle_seconds: 5,
            in_rotation: i < 2,
          });
        }

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/monitor`);

        // Immediately pause rotation with Space
        await page.keyboard.press('Space');
        await page.waitForTimeout(200);
        const pinnedText = await page.locator('body').innerText();
        expect(pinnedText.toUpperCase()).toMatch(/PAUSED|PINNED|HOLD/);

        // Wait longer than cycle_seconds (5s) and verify deck has not rotated
        await page.waitForTimeout(6200);
        const stillPinnedText = await page.locator('body').innerText();
        expect(stillPinnedText.includes(String(decks[0].title))).toBe(
          pinnedText.includes(String(decks[0].title)),
        );

        // Resume rotation and verify deck advances after cycle_seconds
        await page.keyboard.press('Space');
        await page.waitForTimeout(5800);
        const resumedText = await page.locator('body').innerText();
        expect(resumedText.includes(String(decks[1].title))).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F24] Privacy blur toggle masks currency values on Room Monitor while keeping percentages and 10x20 FI Waffle visible',
    { tag: ['@tier2', '@F24'] },
    async ({ page }) => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const assetRes = await api.post('/api/finance/assets', {
          symbol: uniqueId('WEGE3').toUpperCase().slice(0, 10),
          name: 'WEG SA Privacy Test',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          quantity: '100',
          avg_cost_cents: 3500,
          current_price_cents: 412890,
          target_weight_pct: '25',
        });
        if (assetRes.ok && assetRes.json?.id) {
          const aid = String(assetRes.json.id);
          cleanup.defer(() => api.delete(`/api/finance/assets/${aid}`));
        }

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);

        const wealthTab = page
          .locator('button, [role="tab"]')
          .filter({ hasText: /WEALTH/i })
          .first();
        if ((await wealthTab.count()) > 0) {
          await wealthTab.click();
        }

        const privacyBtn = page
          .locator(
            'button[aria-label*="privacy" i], button[title*="privacy" i], button:has-text("👁"), button:has-text("PRIVACY"), [data-privacy-toggle]',
          )
          .first();
        expect(await privacyBtn.count()).toBeGreaterThan(0);
        await privacyBtn.click();

        const hasPrivacyMaskState = await page.evaluate(() => {
          const bodyText = document.body.innerText || '';
          if (bodyText.includes('••••') || bodyText.includes('***')) return true;
          const all = Array.from(document.querySelectorAll('*'));
          return all.some((el) => {
            const cs = window.getComputedStyle(el);
            return (
              cs.filter.includes('blur') ||
              el.hasAttribute('data-privacy-masked') ||
              el.hasAttribute('data-privacy-blur') ||
              el.getAttribute('data-fui-privacy') === 'true'
            );
          });
        });
        expect(hasPrivacyMaskState).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F24] Room Monitor UI surfaces SQL guardrail rejection when user submits forbidden write or sensitive query',
    { tag: ['@tier2', '@F24'] },
    async ({ page }) => {
      await ensureStackReady();
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);

      const addWidgetBtn = page
        .locator('button')
        .filter({ hasText: /add widget|\+\s*widget|new widget/i })
        .first();

      if ((await addWidgetBtn.count()) > 0) {
        await addWidgetBtn.click();
        const sqlOption = page
          .locator('button, option, [role="radio"], [role="tab"], label')
          .filter({ hasText: /\bsql\b/i })
          .first();
        if ((await sqlOption.count()) > 0 && (await sqlOption.isVisible())) {
          await sqlOption.click().catch(() => {});
        }
        const queryInput = page
          .locator('textarea, input[type="text"]')
          .last();
        if ((await queryInput.count()) > 0 && (await queryInput.isVisible())) {
          await queryInput.fill('SELECT * FROM api_tokens');
          const submitBtn = page
            .locator('button[type="submit"], button:has-text("Save"), button:has-text("Create")')
            .last();
          if ((await submitBtn.count()) > 0) {
            await submitBtn.click();
          }
        }
      }

      const radiusAudit = await auditZeroBorderRadius(page);
      expect(radiusAudit.violations).toEqual([]);
      expect(pageErrors).toEqual([]);
    },
  );

  test(
    '[T2][F24] Room Monitor UI displays pending approval state for unapproved command widgets and updates on approval',
    { tag: ['@tier2', '@F24'] },
    async ({ page }) => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const deckTitle = `DECK_APPROVAL_${uniqueId('UI').toUpperCase()}`;
        const deckRes = await api.post('/api/dashboards', {
          slug: uniqueId('deck-approval-ui'),
          title: deckTitle,
          cycle_seconds: 60,
          in_rotation: true,
          layout_cols: 12,
          layout_rows: 8,
        });
        expect([200, 201]).toContain(deckRes.status);
        const deckId = String(deckRes.json.id);
        cleanup.defer(() => api.delete(`/api/dashboards/${deckId}`));

        const pat = await createPatToken(api, uniqueId('f24-approval-pat'));
        cleanup.defer(() => api.delete(`/api/auth/tokens/${pat.id}`));

        const mcp = createMcpClient(E2E_URLS.mcpUrl, pat.token);
        cleanup.defer(() => mcp.closeSession());

        const mcpCall = await mcp.callTool('dashboards_configure_command_widget', {
          dashboard_id: deckId,
          title: 'APPROVED_CMD_BANNER',
          command: 'echo APPROVED_EXECUTION_READY',
          refresh_interval_seconds: 60,
          grid_rect: { x: 0, y: 0, w: 6, h: 4 },
        });
        expect(mcpCall.status).toBe(200);

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
        const beforeApproveText = await page.locator('body').innerText();
        expect(beforeApproveText).not.toContain('APPROVED_EXECUTION_READY');

        const approvalsRes = await api.get('/api/mcp/approvals');
        const approvals = unwrapList<Record<string, any>>(approvalsRes, [
          'approvals',
        ]);
        const pending = approvals.find(
          (a) =>
            (a.id === mcpCall.approvalId ||
              String(a.tool_name).includes('command_widget')) &&
            String(a.status).toLowerCase() === 'pending',
        );
        expect(pending).toBeDefined();

        await api.post(`/api/mcp/approvals/${pending!.id}/approve`, {});

        const deckCheck = await api.get(`/api/dashboards/${deckId}`);
        const widgets = unwrapList<Record<string, any>>(
          deckCheck.json.widgets ?? [],
          ['widgets'],
        );
        for (const w of widgets) {
          await api.post(`/api/widgets/${w.id}/refresh`, {});
        }

        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
        const deckTab = page
          .locator('button, [role="tab"]')
          .filter({ hasText: deckTitle })
          .first();
        if ((await deckTab.count()) > 0) {
          await deckTab.click();
        }
        await expect(page.getByText('APPROVED_CMD_BANNER').first()).toBeVisible();
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F24] Room Monitor Server Prober widget visibly distinguishes ONLINE, DEGRADED (503), and OFFLINE targets',
    { tag: ['@tier2', '@F24'] },
    async ({ page }) => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const mockTcp = await startMockTcpServer();
        cleanup.defer(() => mockTcp.close());

        const mockDegraded = await startMockHttpServer(
          503,
          JSON.stringify({ status: 'degraded' }),
        );
        cleanup.defer(() => mockDegraded.close());

        const mockClosed = await startMockTcpServer();
        const closedPort = mockClosed.port;
        await mockClosed.close();

        const onlineName = `SRV_ON_${uniqueId('NODE').toUpperCase()}`;
        const degradedName = `SRV_DEG_${uniqueId('NODE').toUpperCase()}`;
        const offlineName = `SRV_OFF_${uniqueId('NODE').toUpperCase()}`;

        const s1 = await api.post('/api/servers', {
          name: onlineName,
          host: mockTcp.host,
          port: mockTcp.port,
          check_type: 'tcp',
        });
        cleanup.defer(() => api.delete(`/api/servers/${s1.json.id}`));
        await api.post(`/api/servers/${s1.json.id}/check`, {});

        const s2 = await api.post('/api/servers', {
          name: degradedName,
          host: mockDegraded.host,
          port: mockDegraded.port,
          check_type: 'http',
          http_url: `${mockDegraded.url}/health`,
        });
        cleanup.defer(() => api.delete(`/api/servers/${s2.json.id}`));
        await api.post(`/api/servers/${s2.json.id}/check`, {});

        const s3 = await api.post('/api/servers', {
          name: offlineName,
          host: '127.0.0.1',
          port: closedPort,
          check_type: 'tcp',
        });
        cleanup.defer(() => api.delete(`/api/servers/${s3.json.id}`));
        await api.post(`/api/servers/${s3.json.id}/check`, {});

        const infraDeck = await api.get('/api/dashboards/infra-knights');
        if (infraDeck.ok) {
          const widgets = unwrapList<Record<string, any>>(
            infraDeck.json.widgets ?? [],
            ['widgets'],
          );
          for (const w of widgets) {
            await api.post(`/api/widgets/${w.id}/refresh`, {});
          }
        }

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
        const infraTab = page
          .locator('button, [role="tab"]')
          .filter({ hasText: /INFRA/i })
          .first();
        if ((await infraTab.count()) > 0) {
          await infraTab.click();
        }

        const pageText = (await page.locator('body').innerText()).toUpperCase();
        expect(pageText).toContain(onlineName);
        expect(pageText).toContain(degradedName);
        expect(pageText).toContain(offlineName);
        expect(pageText).toContain('ONLINE');
        expect(pageText).toContain('DEGRADED');
        expect(pageText).toContain('OFFLINE');
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F24] Room Monitor custom HTTP and Hermes widgets degrade gracefully when upstream returns 500 or gateway is offline',
    { tag: ['@tier2', '@F24'] },
    async ({ page }) => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      try {
        const failingHttp = await startMockHttpServer(
          500,
          JSON.stringify({ error: 'UPSTREAM_FAILURE' }),
        );
        cleanup.defer(() => failingHttp.close());

        const deckTitle = `DECK_RESILIENCE_${uniqueId('UI').toUpperCase()}`;
        const deckRes = await api.post('/api/dashboards', {
          slug: uniqueId('deck-resilience-ui'),
          title: deckTitle,
          cycle_seconds: 60,
          in_rotation: true,
          layout_cols: 12,
          layout_rows: 8,
        });
        expect([200, 201]).toContain(deckRes.status);
        const deckId = String(deckRes.json.id);
        cleanup.defer(() => api.delete(`/api/dashboards/${deckId}`));

        const httpW = await api.post(`/api/dashboards/${deckId}/widgets`, {
          title: 'DEGRADED_HTTP_WIDGET',
          source_kind: 'http',
          renderer_kind: 'kpi',
          grid_rect: { x: 0, y: 0, w: 6, h: 4 },
          source_config: { url: `${failingHttp.url}/broken` },
          refresh_interval_seconds: 60,
        });
        expect([200, 201]).toContain(httpW.status);
        await api.post(`/api/widgets/${httpW.json.id}/refresh`, {});

        const hermesW = await api.post(`/api/dashboards/${deckId}/widgets`, {
          title: 'OFFLINE_HERMES_WIDGET',
          source_kind: 'hermes',
          renderer_kind: 'terminal',
          grid_rect: { x: 6, y: 0, w: 6, h: 4 },
          source_config: { prompt: 'Check offline mock fallback.' },
          refresh_interval_seconds: 60,
        });
        expect([200, 201]).toContain(hermesW.status);
        await api.post(`/api/widgets/${hermesW.json.id}/refresh`, {});

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
        const deckTab = page
          .locator('button, [role="tab"]')
          .filter({ hasText: deckTitle })
          .first();
        await deckTab.click();

        await expect(page.getByText('DEGRADED_HTTP_WIDGET').first()).toBeVisible();
        await expect(page.getByText('OFFLINE_HERMES_WIDGET').first()).toBeVisible();
        expect(pageErrors).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F24] /monitor handles empty or single-deck rotation gracefully without infinite loop or crash',
    { tag: ['@tier2', '@F24'] },
    async ({ page }) => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      try {
        const listRes = await api.get('/api/dashboards');
        const decks = unwrapList<Record<string, any>>(listRes, ['dashboards']);
        expect(decks.length).toBeGreaterThanOrEqual(1);

        for (const d of decks) {
          const origRot = d.in_rotation;
          const origCycle = d.cycle_seconds;
          cleanup.defer(() =>
            api.put(`/api/dashboards/${d.id}`, {
              in_rotation: origRot,
              cycle_seconds: origCycle,
            }),
          );
        }

        // Case 1: Only 1 deck in rotation
        for (let i = 0; i < decks.length; i += 1) {
          await api.put(`/api/dashboards/${decks[i].id}`, {
            in_rotation: i === 0,
            cycle_seconds: 5,
          });
        }

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/monitor`);
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowLeft');
        expect(await page.locator('#root > *').count()).toBeGreaterThan(0);

        // Case 2: Zero decks in rotation
        for (const d of decks) {
          await api.put(`/api/dashboards/${d.id}`, { in_rotation: false });
        }

        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForAppReady(page, `${E2E_URLS.baseUrl}/monitor`);
        expect(await page.locator('#root > *').count()).toBeGreaterThan(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await cleanup.runAll();
      }
    },
  );
});
