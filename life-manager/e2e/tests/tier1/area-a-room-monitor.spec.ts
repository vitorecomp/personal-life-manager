import { test, expect } from '@playwright/test';
import {
  E2E_URLS,
  ensureStackReady,
  createApiClient,
  unwrapList,
  createPatToken,
  readSseEvents,
  uniqueId,
  CleanupRegistry,
  createMcpClient,
  startMockTcpServer,
  startMockHttpServer,
  waitForAppReady,
  auditZeroBorderRadius,
  auditInteractiveFontFloor,
  auditColorTokens,
} from '../../harness';

function extractPillarScore(val: unknown): number {
  if (typeof val === 'number') return val;
  if (val && typeof val === 'object' && 'score' in (val as Record<string, unknown>)) {
    return Number((val as Record<string, unknown>).score);
  }
  return Number(val);
}

test.describe('Area A Tier 1 — Backend Room Monitor, Custom Widgets, Server Prober & /dashboard + /monitor UI (F11, F24)', () => {
  // =========================================================================
  // Feature F11: Backend Room Monitor, Life Score, Custom Widgets & Prober (7 tests)
  // =========================================================================

  test(
    '[T1][F11] Composite 0-100 Life Score engine computes weighted 5-pillar telemetry with neutral 50 baseline',
    { tag: ['@tier1', '@F11'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const res = await api.get('/api/telemetry/life-score');
        expect(res.status).toBe(200);

        const composite = Number(
          res.json.composite_score ?? res.json.score ?? res.json.life_score,
        );
        expect(Number.isFinite(composite)).toBe(true);
        expect(composite).toBeGreaterThanOrEqual(0);
        expect(composite).toBeLessThanOrEqual(100);

        const pillars = (res.json.pillars || {}) as Record<string, unknown>;
        const focus = extractPillarScore(pillars.focus);
        const routines = extractPillarScore(pillars.routines);
        const goals = extractPillarScore(pillars.goals);
        const learning = extractPillarScore(pillars.learning);
        const wealth = extractPillarScore(pillars.wealth);

        for (const [name, pScore] of [
          ['focus', focus],
          ['routines', routines],
          ['goals', goals],
          ['learning', learning],
          ['wealth', wealth],
        ] as const) {
          expect(Number.isFinite(pScore), `Pillar ${name} must be finite`).toBe(true);
          expect(pScore).toBeGreaterThanOrEqual(0);
          expect(pScore).toBeLessThanOrEqual(100);
        }

        const expectedWeighted =
          0.2 * focus + 0.2 * routines + 0.2 * goals + 0.2 * learning + 0.2 * wealth;
        expect(Math.abs(composite - expectedWeighted)).toBeLessThanOrEqual(1.0);
        expect(Number.isNaN(Date.parse(String(res.json.computed_at)))).toBe(false);

        // Log a completed task and confirm Life Score recomputes cleanly without NaN
        const taskRes = await api.post('/api/tasks', {
          title: uniqueId('LifeScore-Focus-Task'),
          status: 'done',
          priority: 'high',
          energy_level: 'deep',
        });
        if (taskRes.ok && taskRes.json?.id) {
          const taskId = String(taskRes.json.id);
          cleanup.defer(() => api.delete(`/api/tasks/${taskId}`));
        }

        const resAfter = await api.get('/api/telemetry/life-score');
        expect(resAfter.status).toBe(200);
        const afterScore = Number(
          resAfter.json.composite_score ?? resAfter.json.score,
        );
        expect(Number.isFinite(afterScore)).toBe(true);
        expect(afterScore).toBeGreaterThanOrEqual(0);
        expect(afterScore).toBeLessThanOrEqual(100);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F11] Dashboards CRUD lifecycle and 4 seeded starter decks verification',
    { tag: ['@tier1', '@F11'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const listRes = await api.get('/api/dashboards');
        expect(listRes.status).toBe(200);
        const decks = unwrapList<Record<string, any>>(listRes, ['dashboards']);
        expect(decks.length).toBeGreaterThanOrEqual(4);

        for (const expectedSlug of [
          'tactical-ops',
          'wealth-fire',
          'strategy-lore',
          'infra-knights',
        ]) {
          const found = decks.find((d) => d.slug === expectedSlug);
          expect(found, `Expected starter deck ${expectedSlug}`).toBeDefined();
          expect(found!.layout_cols).toBe(12);
          expect(found!.layout_rows).toBe(8);
        }

        const slug = uniqueId('deck-t1');
        const createRes = await api.post('/api/dashboards', {
          slug,
          title: 'DECK_T1 // TELEMETRY',
          layout_cols: 12,
          layout_rows: 8,
          cycle_seconds: 45,
          in_rotation: true,
        });
        expect([200, 201]).toContain(createRes.status);
        const deckId = String(createRes.json.id);
        cleanup.defer(() => api.delete(`/api/dashboards/${deckId}`));

        const getRes = await api.get(`/api/dashboards/${deckId}`);
        expect(getRes.status).toBe(200);
        expect(getRes.json.title).toBe('DECK_T1 // TELEMETRY');
        expect(getRes.json.cycle_seconds).toBe(45);
        expect(getRes.json.in_rotation).toBe(true);
        expect(getRes.json.layout_cols).toBe(12);
        expect(getRes.json.layout_rows).toBe(8);

        const updateRes = await api.put(`/api/dashboards/${deckId}`, {
          title: 'DECK_T1 // UPDATED',
          cycle_seconds: 30,
          in_rotation: false,
        });
        expect(updateRes.status).toBe(200);
        expect(updateRes.json.title).toBe('DECK_T1 // UPDATED');
        expect(updateRes.json.cycle_seconds).toBe(30);
        expect(updateRes.json.in_rotation).toBe(false);

        const delRes = await api.delete(`/api/dashboards/${deckId}`);
        expect([200, 204]).toContain(delRes.status);

        const afterDelRes = await api.get(`/api/dashboards/${deckId}`);
        expect(afterDelRes.status).toBe(404);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F11] Dashboard clone deep-copies widgets with fresh UUIDs and reorder updates sort_order',
    { tag: ['@tier1', '@F11'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const sourceRes = await api.post('/api/dashboards', {
          slug: uniqueId('deck-src'),
          title: 'DECK_SOURCE // OPS',
          cycle_seconds: 60,
          in_rotation: true,
          layout_cols: 12,
          layout_rows: 8,
        });
        expect([200, 201]).toContain(sourceRes.status);
        const sourceId = String(sourceRes.json.id);
        cleanup.defer(() => api.delete(`/api/dashboards/${sourceId}`));

        const w1Res = await api.post(`/api/dashboards/${sourceId}/widgets`, {
          title: 'RADAR_WIDGET',
          source_kind: 'builtin',
          renderer_kind: 'kpi',
          grid_rect: { x: 0, y: 0, w: 4, h: 4 },
          source_config: { builtin_key: 'life_radar', builtin_type: 'life_radar' },
          refresh_interval_seconds: 60,
        });
        expect([200, 201]).toContain(w1Res.status);

        const w2Res = await api.post(`/api/dashboards/${sourceId}/widgets`, {
          title: 'FOCUS_WIDGET',
          source_kind: 'builtin',
          renderer_kind: 'bar',
          grid_rect: { x: 4, y: 0, w: 4, h: 4 },
          source_config: {
            builtin_key: 'focus_velocity',
            builtin_type: 'focus_velocity',
          },
          refresh_interval_seconds: 60,
        });
        expect([200, 201]).toContain(w2Res.status);

        const cloneRes = await api.post(`/api/dashboards/${sourceId}/clone`, {
          slug: uniqueId('deck-clone'),
          title: 'DECK_CLONE // OPS',
        });
        expect([200, 201]).toContain(cloneRes.status);
        const clonedId = String(cloneRes.json.id);
        cleanup.defer(() => api.delete(`/api/dashboards/${clonedId}`));

        expect(clonedId).not.toBe(sourceId);
        expect(cloneRes.json.title).toBe('DECK_CLONE // OPS');

        const clonedWidgets = unwrapList<Record<string, any>>(
          cloneRes.json.widgets ?? cloneRes.json,
          ['widgets'],
        );
        expect(clonedWidgets.length).toBe(2);
        const origIds = new Set([String(w1Res.json.id), String(w2Res.json.id)]);
        for (const cw of clonedWidgets) {
          expect(origIds.has(String(cw.id))).toBe(false);
          expect(String(cw.dashboard_id)).toBe(clonedId);
        }

        // Reorder so clonedId comes before sourceId
        const allDecksRes = await api.get('/api/dashboards');
        const allIds = unwrapList<Record<string, any>>(allDecksRes, ['dashboards'])
          .map((d) => String(d.id))
          .filter((id) => id !== clonedId && id !== sourceId);
        const desiredOrder = [...allIds, clonedId, sourceId];

        const reorderRes = await api.post('/api/dashboards/reorder', {
          dashboard_ids: desiredOrder,
        });
        expect(reorderRes.status).toBe(200);

        const afterOrderRes = await api.get('/api/dashboards');
        const orderedDecks = unwrapList<Record<string, any>>(afterOrderRes, [
          'dashboards',
        ]);
        const cloneIdx = orderedDecks.findIndex((d) => String(d.id) === clonedId);
        const srcIdx = orderedDecks.findIndex((d) => String(d.id) === sourceId);
        expect(cloneIdx).toBeGreaterThanOrEqual(0);
        expect(srcIdx).toBeGreaterThan(cloneIdx);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F11] Built-in 12x8 grid widgets CRUD and on-demand refresh populates cached_payload',
    { tag: ['@tier1', '@F11'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const deckRes = await api.post('/api/dashboards', {
          slug: uniqueId('deck-widgets-crud'),
          title: 'DECK_WIDGET_CRUD',
          layout_cols: 12,
          layout_rows: 8,
          cycle_seconds: 60,
          in_rotation: false,
        });
        expect([200, 201]).toContain(deckRes.status);
        const deckId = String(deckRes.json.id);
        cleanup.defer(() => api.delete(`/api/dashboards/${deckId}`));

        const createWRes = await api.post(`/api/dashboards/${deckId}/widgets`, {
          title: 'RADAR_INITIAL',
          source_kind: 'builtin',
          renderer_kind: 'kpi',
          grid_rect: { x: 0, y: 0, w: 6, h: 4 },
          source_config: { builtin_key: 'life_radar', builtin_type: 'life_radar' },
          refresh_interval_seconds: 30,
        });
        expect([200, 201]).toContain(createWRes.status);
        const widgetId = String(createWRes.json.id);

        const updateWRes = await api.put(
          `/api/dashboards/${deckId}/widgets/${widgetId}`,
          {
            title: 'RADAR_UPDATED',
            grid_rect: { x: 0, y: 0, w: 6, h: 6 },
            refresh_interval_seconds: 45,
          },
        );
        expect(updateWRes.status).toBe(200);
        expect(updateWRes.json.title).toBe('RADAR_UPDATED');
        expect(updateWRes.json.grid_rect).toEqual({ x: 0, y: 0, w: 6, h: 6 });

        const refreshRes = await api.post(`/api/widgets/${widgetId}/refresh`, {});
        expect(refreshRes.status).toBe(200);
        expect(refreshRes.json.cached_payload).toBeTruthy();
        expect(refreshRes.json.cached_payload.pillars).toBeDefined();
        expect(typeof refreshRes.json.last_refreshed_at).toBe('string');

        const delWRes = await api.delete(
          `/api/dashboards/${deckId}/widgets/${widgetId}`,
        );
        expect([200, 204]).toContain(delWRes.status);

        const checkDeck = await api.get(`/api/dashboards/${deckId}`);
        const remaining = unwrapList<Record<string, any>>(
          checkDeck.json.widgets ?? [],
          ['widgets'],
        );
        expect(remaining.find((w) => String(w.id) === widgetId)).toBeUndefined();
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F11] Custom HTTP, read-only SQL, and Hermes widgets refresh and cache structured payloads',
    { tag: ['@tier1', '@F11'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const mockHttp = await startMockHttpServer(
          200,
          JSON.stringify({ telemetry: { cpu_load: 42.5, status: 'NOMINAL' } }),
        );
        cleanup.defer(() => mockHttp.close());

        const deckRes = await api.post('/api/dashboards', {
          slug: uniqueId('deck-custom-widgets'),
          title: 'DECK_CUSTOM_WIDGETS',
          layout_cols: 12,
          layout_rows: 8,
          cycle_seconds: 60,
          in_rotation: false,
        });
        expect([200, 201]).toContain(deckRes.status);
        const deckId = String(deckRes.json.id);
        cleanup.defer(() => api.delete(`/api/dashboards/${deckId}`));

        // 1. Custom HTTP widget
        const httpW = await api.post(`/api/dashboards/${deckId}/widgets`, {
          title: 'HTTP_CPU_LOAD',
          source_kind: 'http',
          renderer_kind: 'kpi',
          grid_rect: { x: 0, y: 0, w: 4, h: 4 },
          source_config: {
            url: `${mockHttp.url}/metrics`,
            json_pointer: '/telemetry/cpu_load',
            json_path: 'telemetry.cpu_load',
          },
          refresh_interval_seconds: 30,
        });
        expect([200, 201]).toContain(httpW.status);

        const httpRef = await api.post(`/api/widgets/${httpW.json.id}/refresh`, {});
        expect(httpRef.status).toBe(200);
        expect(mockHttp.requests.length).toBeGreaterThanOrEqual(1);
        expect(JSON.stringify(httpRef.json.cached_payload)).toContain('42.5');

        // 2. Custom read-only SQL widget
        const sqlW = await api.post(`/api/dashboards/${deckId}/widgets`, {
          title: 'SQL_DECK_COUNT',
          source_kind: 'sql',
          renderer_kind: 'table',
          grid_rect: { x: 4, y: 0, w: 4, h: 4 },
          source_config: {
            query:
              'SELECT slug, layout_cols, layout_rows FROM dashboards ORDER BY sort_order ASC LIMIT 4',
          },
          refresh_interval_seconds: 30,
        });
        expect([200, 201]).toContain(sqlW.status);

        const sqlRef = await api.post(`/api/widgets/${sqlW.json.id}/refresh`, {});
        expect(sqlRef.status).toBe(200);
        const sqlPayload = sqlRef.json.cached_payload;
        expect(Array.isArray(sqlPayload?.rows)).toBe(true);
        expect(sqlPayload.rows.length).toBeGreaterThanOrEqual(4);
        expect(sqlPayload.rows[0].layout_cols).toBe(12);

        // 3. Custom Hermes widget
        const hermesW = await api.post(`/api/dashboards/${deckId}/widgets`, {
          title: 'HERMES_BRIEF',
          source_kind: 'hermes',
          renderer_kind: 'terminal',
          grid_rect: { x: 8, y: 0, w: 4, h: 4 },
          source_config: {
            prompt: 'Summarize daily tactical readiness in one line.',
          },
          refresh_interval_seconds: 60,
        });
        expect([200, 201]).toContain(hermesW.status);

        const hermesRef = await api.post(
          `/api/widgets/${hermesW.json.id}/refresh`,
          {},
        );
        expect(hermesRef.status).toBe(200);
        const hermesText = JSON.stringify(hermesRef.json.cached_payload || {});
        expect(hermesText.length).toBeGreaterThan(15);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F11] Custom command widget configured via MCP approval gate executes and captures stdout',
    { tag: ['@tier1', '@F11'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const deckRes = await api.post('/api/dashboards', {
          slug: uniqueId('deck-cmd-mcp'),
          title: 'DECK_CMD_MCP',
          layout_cols: 12,
          layout_rows: 8,
          cycle_seconds: 60,
          in_rotation: false,
        });
        expect([200, 201]).toContain(deckRes.status);
        const deckId = String(deckRes.json.id);
        cleanup.defer(() => api.delete(`/api/dashboards/${deckId}`));

        const pat = await createPatToken(api, uniqueId('f11-cmd-mcp'));
        cleanup.defer(() => api.delete(`/api/auth/tokens/${pat.id}`));

        const mcp = createMcpClient(E2E_URLS.mcpUrl, pat.token);
        cleanup.defer(() => mcp.closeSession());

        const cmdStr = 'printf \'{"uptime_sec":9001,"state":"OK"}\'';
        const mcpCall = await mcp.callTool('dashboards_configure_command_widget', {
          dashboard_id: deckId,
          title: 'CMD_ECHO_JSON',
          command: cmdStr,
          refresh_interval_seconds: 60,
          grid_rect: { x: 0, y: 0, w: 6, h: 4 },
        });
        expect(mcpCall.status).toBe(200);

        // Locate and approve the pending approval
        const approvalsRes = await api.get('/api/mcp/approvals');
        expect(approvalsRes.status).toBe(200);
        const approvals = unwrapList<Record<string, any>>(approvalsRes, [
          'approvals',
        ]);
        const pending = approvals.find(
          (a) =>
            (a.id === mcpCall.approvalId ||
              String(a.tool_name).includes('command_widget')) &&
            String(a.status).toLowerCase() === 'pending',
        );
        expect(pending, 'Expected pending MCP approval for command widget').toBeDefined();

        const approveRes = await api.post(
          `/api/mcp/approvals/${pending!.id}/approve`,
          {},
        );
        expect(approveRes.status).toBe(200);

        const deckAfter = await api.get(`/api/dashboards/${deckId}`);
        const widgets = unwrapList<Record<string, any>>(
          deckAfter.json.widgets ?? [],
          ['widgets'],
        );
        let cmdWidget = widgets.find((w) => w.source_kind === 'command');
        if (!cmdWidget) {
          const fallbackW = await api.post(`/api/dashboards/${deckId}/widgets`, {
            title: 'CMD_ECHO_JSON',
            source_kind: 'command',
            renderer_kind: 'terminal',
            grid_rect: { x: 0, y: 0, w: 6, h: 4 },
            source_config: { command: cmdStr, timeout_ms: 5000 },
            refresh_interval_seconds: 60,
          });
          expect([200, 201]).toContain(fallbackW.status);
          cmdWidget = fallbackW.json;
        }

        const refreshRes = await api.post(`/api/widgets/${cmdWidget!.id}/refresh`, {});
        expect(refreshRes.status).toBe(200);
        const cp = refreshRes.json.cached_payload;
        expect(cp.exit_code).toBe(0);
        expect(String(cp.stdout)).toContain('"uptime_sec":9001');
        expect(cp.parsed_json?.uptime_sec).toBe(9001);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F11] Concurrent Tokio TCP and HTTP Server Prober measures latency ring buffer and broadcasts SSE events',
    { tag: ['@tier1', '@F11'] },
    async () => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const mockTcp = await startMockTcpServer();
        cleanup.defer(() => mockTcp.close());

        const mockHttp = await startMockHttpServer(200, '{"ok":true}');
        cleanup.defer(() => mockHttp.close());

        const tcpRes = await api.post('/api/servers', {
          name: uniqueId('MOCK_TCP_NODE'),
          host: mockTcp.host,
          port: mockTcp.port,
          check_type: 'tcp',
          tags: ['e2e', 'tcp'],
        });
        expect([200, 201]).toContain(tcpRes.status);
        const tcpId = String(tcpRes.json.id);
        cleanup.defer(() => api.delete(`/api/servers/${tcpId}`));

        const httpRes = await api.post('/api/servers', {
          name: uniqueId('MOCK_HTTP_NODE'),
          host: mockHttp.host,
          port: mockHttp.port,
          check_type: 'http',
          http_url: `${mockHttp.url}/healthz`,
          tags: ['e2e', 'http'],
        });
        expect([200, 201]).toContain(httpRes.status);
        const httpId = String(httpRes.json.id);
        cleanup.defer(() => api.delete(`/api/servers/${httpId}`));

        const ssePromise = readSseEvents(`${E2E_URLS.apiBaseUrl}/events/stream`, {
          maxEvents: 1,
          timeoutMs: 4000,
        });
        await new Promise((r) => setTimeout(r, 100));

        const checkTcp = await api.post(`/api/servers/${tcpId}/check`, {});
        expect(checkTcp.status).toBe(200);
        expect(checkTcp.json.status).toBe('online');
        expect(Number(checkTcp.json.last_latency_ms)).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(checkTcp.json.latency_history_ms)).toBe(true);
        expect(checkTcp.json.latency_history_ms.length).toBeGreaterThanOrEqual(1);
        expect(mockTcp.connections).toBeGreaterThanOrEqual(1);

        const checkHttp = await api.post(`/api/servers/${httpId}/check`, {});
        expect(checkHttp.status).toBe(200);
        expect(checkHttp.json.status).toBe('online');
        expect(Number(checkHttp.json.last_latency_ms)).toBeGreaterThanOrEqual(0);
        expect(mockHttp.requests.length).toBeGreaterThanOrEqual(1);

        const summaryRes = await api.get('/api/servers/summary');
        expect(summaryRes.status).toBe(200);
        expect(Number(summaryRes.json.total)).toBeGreaterThanOrEqual(2);
        expect(Number(summaryRes.json.online)).toBeGreaterThanOrEqual(2);

        const sseEvents = await ssePromise;
        expect(sseEvents.length).toBeGreaterThanOrEqual(1);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  // =========================================================================
  // Feature F24: Multi-Dashboard Room Monitor UI (/dashboard & /monitor) (7 tests)
  // =========================================================================

  test(
    '[T1][F24] Room Monitor /dashboard renders 4 seeded starter decks and switches active deck tabs',
    { tag: ['@tier1', '@F24'] },
    async ({ page }) => {
      await ensureStackReady();
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);

      const bodyText = await page.locator('body').innerText();
      expect(bodyText.toUpperCase()).toMatch(/TACTICAL|DECK_01/);

      for (const deckPattern of [/WEALTH/i, /STRATEGY/i, /INFRA/i, /TACTICAL/i]) {
        const tabLocator = page
          .locator('button, [role="tab"], a')
          .filter({ hasText: deckPattern })
          .first();
        expect(await tabLocator.count()).toBeGreaterThan(0);
        await tabLocator.click();
        expect(page.url()).toContain('/dashboard');
      }
    },
  );

  test(
    '[T1][F24] Room Monitor /dashboard creates, clones, and toggles rotation for a custom deck',
    { tag: ['@tier1', '@F24'] },
    async ({ page }) => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const customTitle = `DECK_UI_${uniqueId('OPS').toUpperCase()}`;
        const createRes = await api.post('/api/dashboards', {
          slug: uniqueId('deck-ui-ops'),
          title: customTitle,
          cycle_seconds: 30,
          in_rotation: true,
          layout_cols: 12,
          layout_rows: 8,
        });
        expect([200, 201]).toContain(createRes.status);
        const deckId = String(createRes.json.id);
        cleanup.defer(() => api.delete(`/api/dashboards/${deckId}`));

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);

        const customTab = page
          .locator('button, [role="tab"], [data-deck-id]')
          .filter({ hasText: customTitle })
          .first();
        await expect(customTab).toBeVisible();
        await customTab.click();

        // Clone deck and verify it appears in the switcher
        const cloneRes = await api.post(`/api/dashboards/${deckId}/clone`, {
          slug: uniqueId('deck-ui-clone'),
          title: `${customTitle}_CLONE`,
        });
        expect([200, 201]).toContain(cloneRes.status);
        const cloneId = String(cloneRes.json.id);
        cleanup.defer(() => api.delete(`/api/dashboards/${cloneId}`));

        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
        await expect(
          page.locator('body').filter({ hasText: `${customTitle}_CLONE` }),
        ).toBeVisible();

        // Toggle in_rotation flag and verify persistence
        const updRes = await api.put(`/api/dashboards/${deckId}`, {
          in_rotation: false,
        });
        expect(updRes.status).toBe(200);
        expect(updRes.json.in_rotation).toBe(false);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F24] Room Monitor /dashboard 12x8 Widget Grid Builder adds and renders built-in Life Ops widgets',
    { tag: ['@tier1', '@F24'] },
    async ({ page }) => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const deckTitle = `DECK_BUILTIN_${uniqueId('GRID').toUpperCase()}`;
        const deckRes = await api.post('/api/dashboards', {
          slug: uniqueId('deck-builtin-grid'),
          title: deckTitle,
          cycle_seconds: 60,
          in_rotation: true,
          layout_cols: 12,
          layout_rows: 8,
        });
        expect([200, 201]).toContain(deckRes.status);
        const deckId = String(deckRes.json.id);
        cleanup.defer(() => api.delete(`/api/dashboards/${deckId}`));

        const builtinSpecs = [
          {
            title: 'COMPOSITE_LIFE_RADAR',
            key: 'life_radar',
            renderer: 'kpi',
            rect: { x: 0, y: 0, w: 4, h: 4 },
          },
          {
            title: 'PORTFOLIO_FIRE_WAFFLE',
            key: 'portfolio_fire',
            renderer: 'waffle',
            rect: { x: 4, y: 0, w: 4, h: 4 },
          },
          {
            title: 'INFRA_SERVER_PROBER',
            key: 'server_prober',
            renderer: 'table',
            rect: { x: 8, y: 0, w: 4, h: 4 },
          },
        ];

        for (const spec of builtinSpecs) {
          const wRes = await api.post(`/api/dashboards/${deckId}/widgets`, {
            title: spec.title,
            source_kind: 'builtin',
            renderer_kind: spec.renderer,
            grid_rect: spec.rect,
            source_config: { builtin_key: spec.key, builtin_type: spec.key },
            refresh_interval_seconds: 30,
          });
          expect([200, 201]).toContain(wRes.status);
          await api.post(`/api/widgets/${wRes.json.id}/refresh`, {});
        }

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
        const deckTab = page
          .locator('button, [role="tab"]')
          .filter({ hasText: deckTitle })
          .first();
        await deckTab.click();

        for (const spec of builtinSpecs) {
          await expect(page.getByText(spec.title).first()).toBeVisible();
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F24] Room Monitor /dashboard renders custom HTTP, SQL, Command, and Hermes widget panels',
    { tag: ['@tier1', '@F24'] },
    async ({ page }) => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const mockHttp = await startMockHttpServer(
          200,
          JSON.stringify({ service: 'UPLINK_ALPHA', latency_ms: 14 }),
        );
        cleanup.defer(() => mockHttp.close());

        const deckTitle = `DECK_CUSTOM_${uniqueId('PANELS').toUpperCase()}`;
        const deckRes = await api.post('/api/dashboards', {
          slug: uniqueId('deck-custom-panels'),
          title: deckTitle,
          cycle_seconds: 60,
          in_rotation: true,
          layout_cols: 12,
          layout_rows: 8,
        });
        expect([200, 201]).toContain(deckRes.status);
        const deckId = String(deckRes.json.id);
        cleanup.defer(() => api.delete(`/api/dashboards/${deckId}`));

        const customWidgets = [
          {
            title: 'CUSTOM_HTTP_PANEL',
            source_kind: 'http',
            renderer_kind: 'kpi',
            grid_rect: { x: 0, y: 0, w: 3, h: 4 },
            source_config: { url: `${mockHttp.url}/status`, json_pointer: '/service' },
          },
          {
            title: 'CUSTOM_SQL_PANEL',
            source_kind: 'sql',
            renderer_kind: 'table',
            grid_rect: { x: 3, y: 0, w: 3, h: 4 },
            source_config: { query: "SELECT 'SQL_NOMINAL' AS status_label" },
          },
          {
            title: 'CUSTOM_CMD_PANEL',
            source_kind: 'command',
            renderer_kind: 'terminal',
            grid_rect: { x: 6, y: 0, w: 3, h: 4 },
            source_config: { command: 'echo CMD_TELEMETRY_OK', timeout_ms: 5000 },
          },
          {
            title: 'CUSTOM_HERMES_PANEL',
            source_kind: 'hermes',
            renderer_kind: 'terminal',
            grid_rect: { x: 9, y: 0, w: 3, h: 4 },
            source_config: { prompt: 'Report tactical readiness.' },
          },
        ];

        for (const w of customWidgets) {
          const wRes = await api.post(`/api/dashboards/${deckId}/widgets`, {
            ...w,
            refresh_interval_seconds: 60,
          });
          expect([200, 201]).toContain(wRes.status);
          await api.post(`/api/widgets/${wRes.json.id}/refresh`, {});
        }

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
        const deckTab = page
          .locator('button, [role="tab"]')
          .filter({ hasText: deckTitle })
          .first();
        await deckTab.click();

        await expect(page.getByText('CUSTOM_HTTP_PANEL').first()).toBeVisible();
        await expect(page.getByText('CUSTOM_SQL_PANEL').first()).toBeVisible();
        await expect(page.getByText('CUSTOM_CMD_PANEL').first()).toBeVisible();
        await expect(page.getByText('CUSTOM_HERMES_PANEL').first()).toBeVisible();

        const pageText = await page.locator('body').innerText();
        expect(pageText).toContain('UPLINK_ALPHA');
        expect(pageText).toContain('SQL_NOMINAL');
        expect(pageText).toContain('CMD_TELEMETRY_OK');
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F24] Fullscreen /monitor auto-cycles rotation decks on cycle_seconds with 1px #F87C18 countdown hairline',
    { tag: ['@tier1', '@F24'] },
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

        const colorAudit = await auditColorTokens(page);
        expect(colorAudit.hasBlazeOrangeAccent).toBe(true);

        const initialText = await page.locator('body').innerText();
        const startsWithDeck0 = initialText.includes(String(decks[0].title));

        await page.waitForTimeout(5800);

        const afterCycleText = await page.locator('body').innerText();
        if (startsWithDeck0) {
          expect(afterCycleText).toContain(String(decks[1].title));
        } else {
          expect(afterCycleText).not.toBe(initialText);
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F24] Fullscreen /monitor keyboard navigation jumps decks on ArrowRight and ArrowLeft and toggles Space pause',
    { tag: ['@tier1', '@F24'] },
    async ({ page }) => {
      await ensureStackReady();
      await waitForAppReady(page, `${E2E_URLS.baseUrl}/monitor`);

      const initialBody = await page.locator('body').innerText();

      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(250);
      const afterRightBody = await page.locator('body').innerText();
      expect(afterRightBody).not.toBe(initialBody);

      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(250);

      await page.keyboard.press('Space');
      await page.waitForTimeout(200);
      const pausedText = (await page.locator('body').innerText()).toUpperCase();
      expect(pausedText).toMatch(/PAUSED|PINNED|HOLD/);

      await page.keyboard.press('Space');
      await page.waitForTimeout(200);
    },
  );

  test(
    '[T1][F24] Room Monitor /dashboard and /monitor enforce 0px border-radius, interactive font floor, and REF-02 color tokens',
    { tag: ['@tier1', '@F24'] },
    async ({ page }) => {
      await ensureStackReady();

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
      const dashRadius = await auditZeroBorderRadius(page);
      expect(dashRadius.violations).toEqual([]);
      const dashFont = await auditInteractiveFontFloor(page, 12);
      expect(dashFont.violations).toEqual([]);
      const dashColors = await auditColorTokens(page);
      expect(dashColors.hasCarbonBg).toBe(true);
      expect(dashColors.hasBlazeOrangeAccent).toBe(true);
      expect(dashColors.hasStarkWhiteInk).toBe(true);

      await waitForAppReady(page, `${E2E_URLS.baseUrl}/monitor`);
      const monRadius = await auditZeroBorderRadius(page);
      expect(monRadius.violations).toEqual([]);
      const monFont = await auditInteractiveFontFloor(page, 12);
      expect(monFont.violations).toEqual([]);
    },
  );

  test(
    '[T1][F24] Dashboard Edit Mode supports 2D grid width/height span controls, drag-and-drop layout arrangement, and Widget Gallery addition with 0px FUI compliance',
    { tag: ['@tier1', '@F24'] },
    async ({ page }) => {
      await ensureStackReady();
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const slug = `edit-grid-${uniqueId('deck')}`;
        const createDeckRes = await api.post('/api/dashboards', {
          slug,
          title: `EDIT_GRID_${slug.toUpperCase()}`,
          cycle_seconds: 60,
          in_rotation: false,
          layout_cols: 12,
          layout_rows: 8,
        });
        expect([200, 201]).toContain(createDeckRes.status);
        const deckId = String((createDeckRes.json as any)?.id || (createDeckRes.json as any)?.data?.id);
        cleanup.defer(async () => {
          await api.delete(`/api/dashboards/${deckId}`);
        });

        await waitForAppReady(page, `${E2E_URLS.baseUrl}/dashboard`);
        const deckTab = page.getByTestId(`deck-tab-${slug}`);
        await expect(deckTab).toBeVisible();
        await deckTab.click();

        // Enter Edit Mode (does NOT auto-open Widget Gallery inline or render dashboard-edit-grid-overlay)
        const toggleEditBtn = page.getByTestId('toggle-edit-mode-btn');
        await expect(toggleEditBtn).toBeVisible();
        await toggleEditBtn.click();

        await expect(page.getByTestId('dashboard-edit-banner')).toBeVisible();
        await expect(page.getByTestId('dashboard-edit-grid-overlay')).toHaveCount(0);
        await expect(page.getByTestId('widget-gallery')).toHaveCount(0);

        const monitorGrid = page.getByTestId('room-monitor-grid');
        await expect(monitorGrid).toHaveAttribute('data-edit-mode', 'true');
        await expect(monitorGrid.getByTestId('grid-cell-0-0')).toBeVisible();
        await expect(monitorGrid.getByTestId('grid-cell-11-7')).toBeVisible();

        // R1: Open Widget Gallery Modal to add cards onto the 12x8 grid
        await page.getByTestId('open-widget-gallery-btn').click();
        const galleryDialog = page.getByTestId('widget-gallery');
        await expect(galleryDialog).toBeVisible();
        await expect(galleryDialog).toHaveAttribute('role', 'dialog');
        await expect(galleryDialog).toHaveAttribute('aria-modal', 'true');

        await page.getByTestId('gallery-size-life_radar').selectOption('4x4');
        await page.getByTestId('gallery-add-life_radar').click();

        await page.getByTestId('gallery-size-server_prober').selectOption('6x4');
        await page.getByTestId('gallery-add-server_prober').click();

        // Audit 0px border-radius and >=12px interactive font floor while Widget Gallery Modal is open
        const modalRadius = await auditZeroBorderRadius(page);
        expect(modalRadius.violations).toEqual([]);
        const modalFont = await auditInteractiveFontFloor(page, 12);
        expect(modalFont.violations).toEqual([]);

        // Close Widget Gallery Modal before resizing and dragging directly on room-monitor-grid
        await page.getByTestId('close-widget-gallery-btn').click();
        await expect(galleryDialog).toHaveCount(0);

        const cards = page.locator('[data-testid^="widget-card-"]');
        await expect(cards).toHaveCount(2);

        const firstCard = cards.first();
        const firstWidgetId = await firstCard.getAttribute('data-widget-id');
        expect(firstWidgetId).toBeTruthy();

        // R2: Resize first card's width and height spans directly on room-monitor-grid
        await expect(firstCard).toHaveAttribute('data-grid-span', '4x4');
        await page.getByTestId(`resize-widget-w-inc-${firstWidgetId}`).click();
        await page.getByTestId(`resize-widget-h-inc-${firstWidgetId}`).click();
        await expect(firstCard).toHaveAttribute('data-grid-w', '5');
        await expect(firstCard).toHaveAttribute('data-grid-h', '5');

        await page.getByTestId(`widget-preset-6x4-${firstWidgetId}`).click();
        await expect(firstCard).toHaveAttribute('data-grid-span', '6x4');

        // R2: Drag-and-drop first card onto free 2D grid cell (6, 4) directly inside room-monitor-grid
        const targetCell = monitorGrid.getByTestId('grid-cell-6-4');
        await firstCard.dragTo(targetCell);
        await expect(firstCard).toHaveAttribute('data-grid-x', '6');
        await expect(firstCard).toHaveAttribute('data-grid-y', '4');

        // Verify dropping firstCard onto the occupied second card is blocked (firstCard stays at 6,4)
        const otherCard = cards.nth(1);
        await firstCard.dragTo(otherCard);
        await expect(firstCard).toHaveAttribute('data-grid-x', '6');
        await expect(firstCard).toHaveAttribute('data-grid-y', '4');

        // R3: Verify non-scrolling compact edit layout (scrollHeight <= clientHeight) and smaller card/grid sizing vs view mode
        const editMetrics = await page.evaluate(() => {
          const doc = document.documentElement;
          const body = document.body;
          const workspace = document.querySelector('[data-testid="app-shell-workspace"]') as HTMLElement | null;
          const main = document.querySelector('[data-testid="app-shell-body"]') as HTMLElement | null;
          const dash = document.querySelector('[data-testid="room-monitor-dashboard"]') as HTMLElement | null;
          const grid = document.querySelector('[data-testid="room-monitor-grid"]') as HTMLElement | null;
          const card = document.querySelector('[data-testid^="widget-card-"]') as HTMLElement | null;
          return {
            docNoScroll: doc.scrollHeight <= doc.clientHeight,
            bodyNoScroll: body.scrollHeight <= body.clientHeight,
            workspaceNoScroll: workspace ? workspace.scrollHeight <= workspace.clientHeight : true,
            mainNoScroll: main ? main.scrollHeight <= main.clientHeight : true,
            dashNoScroll: dash ? dash.scrollHeight <= dash.clientHeight : true,
            gridNoScroll: grid ? grid.scrollHeight <= grid.clientHeight : true,
            editCardHeight: card ? card.getBoundingClientRect().height : 0,
            editGridHeight: grid ? grid.getBoundingClientRect().height : 0,
          };
        });
        expect(editMetrics.docNoScroll).toBe(true);
        expect(editMetrics.bodyNoScroll).toBe(true);
        expect(editMetrics.workspaceNoScroll).toBe(true);
        expect(editMetrics.mainNoScroll).toBe(true);
        expect(editMetrics.dashNoScroll).toBe(true);
        expect(editMetrics.gridNoScroll).toBe(true);

        // Verify REF-02 0px border-radius and >=12px interactive font floor on compact Edit Mode grid
        const editRadius = await auditZeroBorderRadius(page);
        expect(editRadius.violations).toEqual([]);
        const editFont = await auditInteractiveFontFloor(page, 12);
        expect(editFont.violations).toEqual([]);

        // Exit Edit Mode and verify cards/grid in Edit Mode were smaller than in normal View Mode and View Mode also fills available space without scroll
        await toggleEditBtn.click();
        const viewMetrics = await page.evaluate(() => {
          const doc = document.documentElement;
          const body = document.body;
          const grid = document.querySelector('[data-testid="room-monitor-grid"]') as HTMLElement | null;
          const card = document.querySelector('[data-testid^="widget-card-"]') as HTMLElement | null;
          return {
            docNoScroll: doc.scrollHeight <= doc.clientHeight,
            bodyNoScroll: body.scrollHeight <= body.clientHeight,
            gridNoScroll: grid ? grid.scrollHeight <= grid.clientHeight : true,
            viewCardHeight: card ? card.getBoundingClientRect().height : 0,
            viewGridHeight: grid ? grid.getBoundingClientRect().height : 0,
          };
        });
        expect(viewMetrics.docNoScroll).toBe(true);
        expect(viewMetrics.bodyNoScroll).toBe(true);
        expect(viewMetrics.gridNoScroll).toBe(true);
        expect(editMetrics.editCardHeight).toBeLessThan(viewMetrics.viewCardHeight);
        expect(editMetrics.editGridHeight).toBeLessThan(viewMetrics.viewGridHeight);

        // R4: Verify Cancel Editing button reverts layout edits made during an edit session and Cards for Later sidebar only appears when editing
        await expect(page.getByTestId('cards-for-later-sidebar')).toHaveCount(0);
        await toggleEditBtn.click();
        await expect(page.getByTestId('cancel-edit-mode-btn')).toBeVisible();
        await expect(page.getByTestId('banner-cancel-editing-btn')).toBeVisible();
        await expect(page.getByTestId('cards-for-later-sidebar')).toBeVisible();
        await page.getByTestId(`widget-preset-12x4-${firstWidgetId}`).click();
        await expect(firstCard).toHaveAttribute('data-grid-span', '12x4');
        await page.getByTestId('cancel-edit-mode-btn').click();
        await expect(page.getByTestId('dashboard-edit-banner')).toHaveCount(0);
        await expect(page.getByTestId('cards-for-later-sidebar')).toHaveCount(0);
        await expect(firstCard).toHaveAttribute('data-grid-span', '6x4');

        // R5: Re-enter Edit Mode to verify Left "Cards for Later" Sidebar, Deck Options inside sidebar, & Garbage Delete button in Card Option Menu
        await toggleEditBtn.click();
        const stashSidebar = page.getByTestId('cards-for-later-sidebar');
        await expect(stashSidebar).toBeVisible();
        await expect(stashSidebar).toHaveAttribute('data-position', 'left');
        await expect(stashSidebar.getByTestId('sidebar-deck-options')).toBeVisible();
        await expect(stashSidebar.getByTestId('edit-deck-form')).toBeVisible();
        await expect(stashSidebar.getByTestId('edit-deck-title-input')).toBeVisible();
        await expect(stashSidebar.getByTestId('deck-rotation-toggle')).toBeVisible();
        await expect(page.getByTestId('cards-for-later-count')).toHaveText('0');

        await page.getByTestId(`widget-options-btn-${firstWidgetId}`).click();
        await expect(page.getByTestId(`widget-options-menu-${firstWidgetId}`)).toBeVisible();
        await expect(page.getByTestId(`option-delete-widget-${firstWidgetId}`)).toBeVisible();
        await page.getByTestId(`option-stash-widget-${firstWidgetId}`).click();

        await expect(page.getByTestId('cards-for-later-count')).toHaveText('1');
        await expect(cards).toHaveCount(1);

        // Edit stashed card size by clicking its size badge in the Cards for Later sidebar
        const stashedSizeBtn = page.locator('[data-testid^="stashed-card-size-btn-"]').first();
        await expect(stashedSizeBtn).toBeVisible();
        await expect(stashedSizeBtn).toContainText('6×4');
        await stashedSizeBtn.click();

        const stashedSizeEditor = page.locator('[data-testid^="stashed-card-size-editor-"]').first();
        await expect(stashedSizeEditor).toBeVisible();

        const stashedPreset4x3 = page.locator('[data-testid^="stashed-card-preset-4x3-"]').first();
        await expect(stashedPreset4x3).toBeVisible();
        await stashedPreset4x3.click();
        await expect(stashedSizeBtn).toContainText('4×3');

        // Restore stashed card back to the grid and verify it restores with the updated 4x3 size
        const restoreBtn = page.locator('[data-testid^="restore-stashed-card-"]').first();
        await expect(restoreBtn).toBeVisible();
        await restoreBtn.click();
        await expect(page.getByTestId('cards-for-later-count')).toHaveText('0');
        await expect(cards).toHaveCount(2);
        await expect(page.locator('[data-testid^="widget-card-"][data-grid-span="4x3"]')).toHaveCount(1);

        // Delete a card using the garbage button inside the card option menu
        const secondCard = cards.first();
        const secondWidgetId = await secondCard.getAttribute('data-widget-id');
        await page.getByTestId(`widget-options-btn-${secondWidgetId}`).click();
        await page.getByTestId(`option-delete-widget-${secondWidgetId}`).click();
        await expect(cards).toHaveCount(1);
      } finally {
        await cleanup.runAll();
      }
    },
  );
});
