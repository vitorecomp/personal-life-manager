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
  snapshotSecondBrainFiles,
  cleanupNewSecondBrainFiles,
  createMcpClient,
  startMockHermesGateway,
} from '../../harness';

function extractSessionKey(record: Record<string, any> | null | undefined): string {
  if (!record || typeof record !== 'object') return '';
  const data = record.data && typeof record.data === 'object' ? record.data : record;
  return String(data.session_key ?? data.key ?? data.id ?? '');
}

function extractEntityId(record: Record<string, any> | null | undefined): string {
  if (!record || typeof record !== 'object') return '';
  const data = record.data && typeof record.data === 'object' ? record.data : record;
  return String(data.id ?? data.agent_id ?? data.run_id ?? '');
}

test.describe('Tier 1 — Area B: AI Gateway, /mcp Autonomy & Agent Studio Knights (F09, F10, F12)', () => {
  test.beforeAll(async () => {
    await ensureStackReady();
  });

  // ===========================================================================
  // Feature F09 — hermes gateway SSE Bridge (X-Hermes-Session-Key) & Offline Mock Resilience (6 tests)
  // ===========================================================================

  test(
    '[T1][F09] creates, lists, and fetches a Hermes session by X-Hermes-Session-Key',
    { tag: ['@tier1', '@F09'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const sessionKey = uniqueId('sess-f09-crud');

      try {
        const createRes = await api.post(
          '/api/hermes/sessions',
          {
            session_key: sessionKey,
            title: 'T1 F09 Strategic Session',
            origin: 'hermes_view',
            profile_slug: 'sir-chronos',
            high_level_mode: false,
            last_route_context: {
              active_route: '/hermes',
              active_dashboard_id: null,
              selected_entity_id: null,
            },
          },
          { 'X-Hermes-Session-Key': sessionKey },
        );

        expect(createRes.ok).toBe(true);
        expect(createRes.status).toBeGreaterThanOrEqual(200);
        expect(createRes.status).toBeLessThan(300);

        const createdKey = extractSessionKey(createRes.json) || sessionKey;
        cleanup.defer(async () => {
          await api.delete(`/api/hermes/sessions/${encodeURIComponent(createdKey)}`);
        });

        expect(createdKey).toBe(sessionKey);
        const createdObj = createRes.json?.data ?? createRes.json;
        expect(createdObj.title).toBe('T1 F09 Strategic Session');

        const listRes = await api.get('/api/hermes/sessions');
        expect(listRes.status).toBe(200);
        const sessions = unwrapList<Record<string, any>>(listRes, ['sessions']);
        const matched = sessions.find((s) => extractSessionKey(s) === createdKey);
        expect(matched).toBeDefined();
        expect(matched?.title).toBe('T1 F09 Strategic Session');

        const getRes = await api.get(`/api/hermes/sessions/${encodeURIComponent(createdKey)}`);
        expect(getRes.status).toBe(200);
        const fetchedObj = getRes.json?.data ?? getRes.json;
        expect(extractSessionKey(fetchedObj)).toBe(createdKey);
        expect(fetchedObj.title).toBe('T1 F09 Strategic Session');
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F09] updates session metadata via PATCH for pin, archive, title, high_level_mode, and folder',
    { tag: ['@tier1', '@F09'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const sessionKey = uniqueId('sess-f09-patch');

      try {
        const createRes = await api.post('/api/hermes/sessions', {
          session_key: sessionKey,
          title: 'Initial Unpinned Session',
          origin: 'hermes_view',
          pinned: false,
          archived: false,
          high_level_mode: false,
        });
        expect(createRes.ok).toBe(true);
        const createdKey = extractSessionKey(createRes.json) || sessionKey;
        cleanup.defer(async () => {
          await api.delete(`/api/hermes/sessions/${encodeURIComponent(createdKey)}`);
        });

        const patchRes = await api.patch(`/api/hermes/sessions/${encodeURIComponent(createdKey)}`, {
          title: 'Pinned OKR Synthesis',
          pinned: true,
          high_level_mode: true,
          folder_name: 'Q1-Planning',
          profile_slug: 'lore-warden-lyra',
        });
        expect(patchRes.status).toBe(200);
        const patched = patchRes.json?.data ?? patchRes.json;
        expect(patched.title).toBe('Pinned OKR Synthesis');
        expect(patched.pinned).toBe(true);
        expect(patched.high_level_mode).toBe(true);

        const pinnedListRes = await api.get('/api/hermes/sessions?pinned=true');
        expect(pinnedListRes.status).toBe(200);
        const pinnedSessions = unwrapList<Record<string, any>>(pinnedListRes, ['sessions']);
        expect(pinnedSessions.some((s) => extractSessionKey(s) === createdKey)).toBe(true);

        const archiveRes = await api.patch(`/api/hermes/sessions/${encodeURIComponent(createdKey)}`, {
          archived: true,
          pinned: false,
        });
        expect(archiveRes.status).toBe(200);
        const archived = archiveRes.json?.data ?? archiveRes.json;
        expect(archived.archived).toBe(true);
        expect(archived.pinned).toBe(false);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F09] forks an existing Hermes session into an independent child session preserving lineage',
    { tag: ['@tier1', '@F09'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const parentKey = uniqueId('sess-f09-parent');

      try {
        const createRes = await api.post('/api/hermes/sessions', {
          session_key: parentKey,
          title: 'Parent Research Thread',
          origin: 'hermes_view',
        });
        expect(createRes.ok).toBe(true);
        cleanup.defer(async () => {
          await api.delete(`/api/hermes/sessions/${encodeURIComponent(parentKey)}`);
        });

        const streamUrl = api.resolveUrl('/api/hermes/chat/stream');
        const events = await readSseEvents(streamUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Hermes-Session-Key': parentKey,
          },
          body: JSON.stringify({
            message: 'Establish baseline context before branching.',
            session_key: parentKey,
            high_level_mode: false,
            origin: 'hermes_view',
          }),
          stopOnEvent: 'done',
          timeoutMs: 10_000,
        });
        expect(events.length).toBeGreaterThan(0);

        const forkRes = await api.post(
          `/api/hermes/sessions/${encodeURIComponent(parentKey)}/fork`,
          {
            title: 'Forked Branch Thread',
            turn_index: 0,
          },
        );
        expect(forkRes.ok).toBe(true);
        const forkedObj = forkRes.json?.data ?? forkRes.json;
        const forkedKey = extractSessionKey(forkedObj);
        expect(forkedKey.length).toBeGreaterThan(0);
        expect(forkedKey).not.toBe(parentKey);

        cleanup.defer(async () => {
          await api.delete(`/api/hermes/sessions/${encodeURIComponent(forkedKey)}`);
        });

        expect(forkedObj.title).toBe('Forked Branch Thread');
        if ('parent_session_key' in forkedObj && forkedObj.parent_session_key !== null) {
          expect(forkedObj.parent_session_key).toBe(parentKey);
        }

        const getForked = await api.get(`/api/hermes/sessions/${encodeURIComponent(forkedKey)}`);
        expect(getForked.status).toBe(200);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F09] bridges POST /api/hermes/chat/stream to live startMockHermesGateway forwarding X-Hermes-Session-Key',
    { tag: ['@tier1', '@F09'] },
    async () => {
      const mockGw = await startMockHermesGateway({
        responseText: 'Live gateway tactical synthesis complete.',
      });
      const sessionKey = uniqueId('sess-f09-live-gw');

      try {
        await withIsolatedBackend(
          { HERMES_GATEWAY_URL: mockGw.baseV1Url },
          async ({ apiBaseUrl }) => {
            const isoApi = createApiClient(apiBaseUrl);
            const isoCleanup = new CleanupRegistry();

            try {
              isoCleanup.defer(async () => {
                await isoApi.delete(`/api/hermes/sessions/${encodeURIComponent(sessionKey)}`);
              });

              const healthRes = await isoApi.get('/api/health');
              expect(healthRes.status).toBe(200);
              expect(healthRes.json.status).toBe('ok');
              expect(healthRes.json.hermes_gateway).toBe('online');

              const events = await readSseEvents(`${apiBaseUrl}/hermes/chat/stream`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Hermes-Session-Key': sessionKey,
                },
                body: JSON.stringify({
                  message: 'Summarize @goals for Q1',
                  session_key: sessionKey,
                  high_level_mode: false,
                  origin: 'hermes_view',
                  mentions: ['@goals'],
                }),
                stopOnEvent: 'done',
                timeoutMs: 10_000,
              });

              expect(events.length).toBeGreaterThan(0);
              const combinedStreamText = events.map((e) => e.data).join('\n');
              expect(combinedStreamText).toContain('Live gateway tactical synthesis complete.');

              const chatReqs = mockGw.requests.filter((r) =>
                r.path.includes('/chat/completions'),
              );
              expect(chatReqs.length).toBeGreaterThanOrEqual(1);
              expect(chatReqs[0].sessionKey).toBe(sessionKey);

              const sessionRes = await isoApi.get(
                `/api/hermes/sessions/${encodeURIComponent(sessionKey)}`,
              );
              expect(sessionRes.status).toBe(200);
              const sessionText = JSON.stringify(sessionRes.json);
              expect(sessionText).toContain('Summarize @goals for Q1');
            } finally {
              await isoCleanup.runAll();
            }
          },
        );
      } finally {
        await mockGw.close();
      }
    },
  );

  test(
    '[T1][F09] activates high-level thinking SSE events when high_level_mode or /deep-plan is requested',
    { tag: ['@tier1', '@F09'] },
    async () => {
      const mockGw = await startMockHermesGateway({
        highLevelThinking: true,
        responseText: 'High-level geodesic plan finalized.',
      });
      const hlSessionKey = uniqueId('sess-f09-hl-orb');

      try {
        await withIsolatedBackend(
          { HERMES_GATEWAY_URL: mockGw.baseV1Url },
          async ({ apiBaseUrl }) => {
            const isoApi = createApiClient(apiBaseUrl);
            const isoCleanup = new CleanupRegistry();

            try {
              isoCleanup.defer(async () => {
                await isoApi.delete(`/api/hermes/sessions/${encodeURIComponent(hlSessionKey)}`);
              });

              const events = await readSseEvents(`${apiBaseUrl}/hermes/chat/stream`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Hermes-Session-Key': hlSessionKey,
                },
                body: JSON.stringify({
                  message: '/deep-plan Decompose annual architecture OKRs',
                  session_key: hlSessionKey,
                  high_level_mode: true,
                  slash_command: '/deep-plan',
                  mentions: ['@goals', '@vault'],
                }),
                stopOnEvent: 'done',
                timeoutMs: 10_000,
              });

              expect(events.length).toBeGreaterThan(0);
              const serializedEvents = JSON.stringify(events);
              expect(
                events.some((e) => e.event === 'thinking') ||
                  serializedEvents.includes('thinking') ||
                  serializedEvents.includes('Analyzing multi-horizon constraints'),
              ).toBe(true);

              const sessionRes = await isoApi.get(
                `/api/hermes/sessions/${encodeURIComponent(hlSessionKey)}`,
              );
              expect(sessionRes.status).toBe(200);
              const sessionData = sessionRes.json?.data ?? sessionRes.json;
              expect(sessionData.high_level_mode).toBe(true);
            } finally {
              await isoCleanup.runAll();
            }
          },
        );
      } finally {
        await mockGw.close();
      }
    },
  );

  test(
    '[T1][F09] shares unified X-Hermes-Session-Key history between Frieren popover origin and Hermes session list',
    { tag: ['@tier1', '@F09'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const sharedFrierenKey = uniqueId('sess-f09-frieren-shared');

      try {
        cleanup.defer(async () => {
          await api.delete(`/api/hermes/sessions/${encodeURIComponent(sharedFrierenKey)}`);
        });

        const streamUrl = api.resolveUrl('/api/hermes/chat/stream');
        const events = await readSseEvents(streamUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Hermes-Session-Key': sharedFrierenKey,
          },
          body: JSON.stringify({
            message: 'Quick status check from todos screen',
            session_key: sharedFrierenKey,
            origin: 'frieren_popover',
            page_context: {
              active_route: '/todos',
              active_dashboard_id: null,
              selected_entity_id: 'todo-ctx-123',
            },
          }),
          stopOnEvent: 'done',
          timeoutMs: 10_000,
        });
        expect(events.length).toBeGreaterThan(0);

        const getRes = await api.get(
          `/api/hermes/sessions/${encodeURIComponent(sharedFrierenKey)}`,
        );
        expect(getRes.status).toBe(200);
        const sessionObj = getRes.json?.data ?? getRes.json;
        expect(extractSessionKey(sessionObj)).toBe(sharedFrierenKey);
        expect(sessionObj.origin).toBe('frieren_popover');

        const routeCtx = sessionObj.last_route_context;
        if (typeof routeCtx === 'string') {
          expect(routeCtx).toContain('/todos');
        } else if (routeCtx && typeof routeCtx === 'object') {
          expect(routeCtx.active_route).toBe('/todos');
        }

        const searchRes = await api.get('/api/hermes/sessions?origin=frieren_popover');
        expect(searchRes.status).toBe(200);
        const list = unwrapList<Record<string, any>>(searchRes, ['sessions']);
        expect(list.some((s) => extractSessionKey(s) === sharedFrierenKey)).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  // ===========================================================================
  // Feature F10 — Native Rust /mcp (rmcp) Server & 3-Tier Write Autonomy Gate (6 tests)
  // ===========================================================================

  test(
    '[T1][F10] completes /mcp JSON-RPC initialize handshake and lists tools across all 7 Life Ops domains',
    { tag: ['@tier1', '@F10'] },
    async () => {
      const mcp = createMcpClient();
      try {
        const initRes = await mcp.initialize();
        expect(initRes.status).toBe(200);
        expect(typeof initRes.protocolVersion).toBe('string');
        expect(initRes.protocolVersion.length).toBeGreaterThan(0);

        const tools = await mcp.listTools();
        expect(tools.status).toBe(200);
        expect(tools.length).toBeGreaterThanOrEqual(25);

        for (const tool of tools) {
          expect(typeof tool.name).toBe('string');
          expect(tool.name.length).toBeGreaterThan(0);
          expect(tool.inputSchema).toBeDefined();
          expect(tool.inputSchema.type).toBe('object');
        }

        const toolNames = tools.map((t) => t.name);
        const requiredDomainPrefixes = [
          'dashboards_',
          'todos_',
          'routines_',
          'goals_',
          'courses_',
          'finance_',
          'servers_',
        ];
        for (const prefix of requiredDomainPrefixes) {
          expect(
            toolNames.some((name) => name.startsWith(prefix)),
            `Expected /mcp tools/list to expose domain prefix "${prefix}"`,
          ).toBe(true);
        }
      } finally {
        await mcp.closeSession();
      }
    },
  );

  test(
    '[T1][F10] executes READ tier /mcp tools across Life Ops domains with zero side effects or approval gates',
    { tag: ['@tier1', '@F10'] },
    async () => {
      const mcp = createMcpClient();
      try {
        const lifeScoreRes = await mcp.callTool('dashboards_get_life_score', {});
        expect(lifeScoreRes.status).toBe(200);
        expect(lifeScoreRes.ok).toBe(true);
        expect(lifeScoreRes.isError).toBe(false);
        expect(lifeScoreRes.undoId).toBeUndefined();
        expect(lifeScoreRes.approvalId).toBeUndefined();
        expect(lifeScoreRes.parsed).toBeTruthy();

        const scoreVal = Number(
          lifeScoreRes.parsed?.life_score ??
            lifeScoreRes.parsed?.score ??
            lifeScoreRes.parsed?.total_score ??
            50,
        );
        expect(Number.isFinite(scoreVal)).toBe(true);
        expect(scoreVal).toBeGreaterThan(-1);
        expect(scoreVal).toBeLessThanOrEqual(100);

        const todosRes = await mcp.callTool('todos_list_tasks', {});
        expect(todosRes.ok).toBe(true);
        expect(todosRes.isError).toBe(false);
        expect(todosRes.undoId).toBeUndefined();
        expect(todosRes.approvalId).toBeUndefined();

        const financeRes = await mcp.callTool('finance_get_portfolio', {});
        expect(financeRes.ok).toBe(true);
        expect(financeRes.isError).toBe(false);

        const serversRes = await mcp.callTool('servers_get_summary', {});
        expect(serversRes.ok).toBe(true);
        expect(serversRes.isError).toBe(false);
      } finally {
        await mcp.closeSession();
      }
    },
  );

  test(
    '[T1][F10] executes IMMEDIATE_UNDO tool todos_create_task immediately and rolls back via POST /api/mcp/undo/{undo_id}',
    { tag: ['@tier1', '@F10'] },
    async () => {
      const api = createApiClient();
      const mcp = createMcpClient();
      const cleanup = new CleanupRegistry();
      const taskTitle = uniqueId('MCP-Immediate-Undo-Task');

      try {
        const callRes = await mcp.callTool('todos_create_task', {
          title: taskTitle,
          priority: 'high',
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

        expect(callRes.status).toBe(200);
        expect(callRes.ok).toBe(true);
        expect(callRes.isError).toBe(false);
        expect(typeof callRes.undoId).toBe('string');
        expect(callRes.undoId!.length).toBeGreaterThan(0);

        const beforeTasksRes = await api.get('/api/tasks');
        expect(beforeTasksRes.status).toBe(200);
        const beforeTasks = unwrapList<Record<string, any>>(beforeTasksRes, ['tasks']);
        const createdTask = beforeTasks.find((t) => t.title === taskTitle);
        expect(createdTask).toBeDefined();

        const undoRes = await api.post(
          `/api/mcp/undo/${encodeURIComponent(callRes.undoId!)}`,
          {},
        );
        expect(undoRes.status).toBe(200);

        const afterTasksRes = await api.get('/api/tasks');
        expect(afterTasksRes.status).toBe(200);
        const afterTasks = unwrapList<Record<string, any>>(afterTasksRes, ['tasks']);
        const remainingTask = afterTasks.find(
          (t) => t.title === taskTitle && t.status !== 'canceled' && t.status !== 'deleted',
        );
        expect(remainingTask).toBeUndefined();
      } finally {
        await mcp.closeSession();
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F10] queues REQUIRE_APPROVAL tool finance_upsert_asset in GET /api/mcp/approvals and executes only on approve',
    { tag: ['@tier1', '@F10'] },
    async () => {
      const api = createApiClient();
      const mcp = createMcpClient();
      const cleanup = new CleanupRegistry();
      const symbol = `T1F10${Date.now().toString().slice(-4)}.SA`;

      try {
        const callRes = await mcp.callTool('finance_upsert_asset', {
          symbol,
          name: 'E2E Tactical Equity',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 50,
          avg_cost_cents: 2500,
          current_price_cents: 2800,
          target_weight_pct: 10,
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
          const assets = unwrapList<Record<string, any>>(listRes, ['assets']);
          const match = assets.find((a) => a.symbol === symbol);
          if (match?.id) {
            await api.delete(`/api/finance/assets/${encodeURIComponent(String(match.id))}`);
          }
        });

        expect(callRes.status).toBe(200);
        expect(typeof callRes.approvalId).toBe('string');
        expect(callRes.approvalId!.length).toBeGreaterThan(0);

        const beforeAssetsRes = await api.get('/api/finance/assets');
        expect(beforeAssetsRes.status).toBe(200);
        const beforeAssets = unwrapList<Record<string, any>>(beforeAssetsRes, ['assets']);
        expect(beforeAssets.some((a) => a.symbol === symbol)).toBe(false);

        const approvalsRes = await api.get('/api/mcp/approvals');
        expect(approvalsRes.status).toBe(200);
        const approvals = unwrapList<Record<string, any>>(approvalsRes, ['approvals']);
        const pendingApproval = approvals.find(
          (a) => String(a.id) === String(callRes.approvalId),
        );
        expect(pendingApproval).toBeDefined();
        expect(pendingApproval?.status).toBe('pending');
        expect(pendingApproval?.tool_name).toBe('finance_upsert_asset');

        const approveRes = await api.post(
          `/api/mcp/approvals/${encodeURIComponent(callRes.approvalId!)}/approve`,
          {},
        );
        expect(approveRes.status).toBe(200);

        const afterAssetsRes = await api.get('/api/finance/assets');
        expect(afterAssetsRes.status).toBe(200);
        const afterAssets = unwrapList<Record<string, any>>(afterAssetsRes, ['assets']);
        const createdAsset = afterAssets.find((a) => a.symbol === symbol);
        expect(createdAsset).toBeDefined();
        expect(Number(createdAsset?.quantity)).toBe(50);
        expect(Number(createdAsset?.current_price_cents)).toBe(2800);
      } finally {
        await mcp.closeSession();
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F10] queues destructive todos_delete_task in pending_mcp_approvals and deletes only after POST /api/mcp/approvals/{id}/approve',
    { tag: ['@tier1', '@F10'] },
    async () => {
      const api = createApiClient();
      const mcp = createMcpClient();
      const cleanup = new CleanupRegistry();
      const title = uniqueId('Task-Approve-Delete');

      try {
        const createRes = await api.post('/api/tasks', {
          title,
          status: 'todo',
          priority: 'medium',
        });
        expect(createRes.ok).toBe(true);
        const taskId = extractEntityId(createRes.json);
        expect(taskId.length).toBeGreaterThan(0);

        cleanup.defer(async () => {
          await api.delete(`/api/tasks/${encodeURIComponent(taskId)}`);
        });

        const delCall = await mcp.callTool('todos_delete_task', {
          id: taskId,
          task_id: taskId,
        });
        expect(delCall.status).toBe(200);
        expect(typeof delCall.approvalId).toBe('string');
        expect(delCall.approvalId!.length).toBeGreaterThan(0);

        const stillPresentRes = await api.get(`/api/tasks/${encodeURIComponent(taskId)}`);
        expect(stillPresentRes.status).toBe(200);

        const approveRes = await api.post(
          `/api/mcp/approvals/${encodeURIComponent(delCall.approvalId!)}/approve`,
          {},
        );
        expect(approveRes.status).toBe(200);

        const afterGetRes = await api.get(`/api/tasks/${encodeURIComponent(taskId)}`);
        expect(
          afterGetRes.status === 404 ||
            afterGetRes.json?.status === 'canceled' ||
            afterGetRes.json?.status === 'deleted',
        ).toBe(true);
      } finally {
        await mcp.closeSession();
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F10] authenticates /mcp requests using a valid SHA-256 Personal Access Token (plm_pat_...)',
    { tag: ['@tier1', '@F10'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const pat = await createPatToken(api, uniqueId('mcp-pat-auth'));
        cleanup.defer(async () => {
          if (pat.id) {
            await api.delete(`/api/auth/tokens/${encodeURIComponent(pat.id)}`);
          }
        });

        expect(pat.token.startsWith('plm_pat_')).toBe(true);

        const authedMcp = createMcpClient(E2E_URLS.mcpUrl, pat.token);
        try {
          const initRes = await authedMcp.initialize();
          expect(initRes.status).toBe(200);

          const tools = await authedMcp.listTools();
          expect(tools.status).toBe(200);
          expect(tools.length).toBeGreaterThan(0);

          const routinesRes = await authedMcp.callTool('routines_list', {});
          expect(routinesRes.status).toBe(200);
          expect(routinesRes.ok).toBe(true);
          expect(routinesRes.isError).toBe(false);
        } finally {
          await authedMcp.closeSession();
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  // ===========================================================================
  // Feature F12 — Backend Agent Studio Knights, Vault Inspector & Nudges (6 tests)
  // ===========================================================================

  test(
    '[T1][F12] seeds the 4 Starter Order of Knights and supports full Knight Forge CRUD on /api/agents',
    { tag: ['@tier1', '@F12'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const customSlug = uniqueId('artificer-daedalus');

      try {
        const listRes = await api.get('/api/agents');
        expect(listRes.status).toBe(200);
        const agents = unwrapList<Record<string, any>>(listRes, ['agents']);
        expect(agents.length).toBeGreaterThanOrEqual(4);

        const slugsAndNames = agents
          .map((a) => `${a.slug || ''} ${a.name || ''}`.toLowerCase())
          .join(' ');
        expect(
          slugsAndNames.includes('chronos') || slugsAndNames.includes('paladin'),
        ).toBe(true);
        expect(
          slugsAndNames.includes('aurum') || slugsAndNames.includes('vanguard'),
        ).toBe(true);
        expect(
          slugsAndNames.includes('lyra') || slugsAndNames.includes('lore'),
        ).toBe(true);
        expect(
          slugsAndNames.includes('vex') || slugsAndNames.includes('inquisitor'),
        ).toBe(true);

        const createRes = await api.post('/api/agents', {
          slug: customSlug,
          name: 'Artificer Daedalus',
          archetype: 'artificer',
          knight_archetype: 'artificer',
          crest_color: '#2CE5F2',
          zone: 'cron_watchtower',
          grid_pos: { x: 3, y: 2, zone: 'cron_watchtower' },
          system_prompt:
            'You are Artificer Daedalus on {{today}}. Goals: {{active_goals}}. Portfolio: {{portfolio_summary}}.',
          model_config: {
            model: 'nousresearch/hermes-3-llama-3.1-70b',
            thinking_effort: 'high',
            max_context_tokens: 128000,
          },
          tools_policy: {
            'todos.*': 'AUTO',
            'dashboards.*': 'READ',
            'finance.*': 'APPROVE',
          },
          monthly_budget_cents: 800,
        });
        expect(createRes.ok).toBe(true);
        const knightId = extractEntityId(createRes.json);
        expect(knightId.length).toBeGreaterThan(0);

        cleanup.defer(async () => {
          await api.delete(`/api/agents/${encodeURIComponent(knightId)}`);
        });

        const updateRes = await api.put(`/api/agents/${encodeURIComponent(knightId)}`, {
          name: 'Artificer Daedalus Prime',
          monthly_budget_cents: 1000,
          zone: 'mastermind_council',
          grid_pos: { x: 4, y: 2, zone: 'mastermind_council' },
        });
        expect(updateRes.status).toBe(200);
        const updatedKnight = updateRes.json?.data ?? updateRes.json;
        expect(Number(updatedKnight.monthly_budget_cents)).toBe(1000);

        const getRes = await api.get(`/api/agents/${encodeURIComponent(knightId)}`);
        expect(getRes.status).toBe(200);
        const fetchedKnight = getRes.json?.data ?? getRes.json;
        expect(fetchedKnight.name).toBe('Artificer Daedalus Prime');
        expect(Number(fetchedKnight.monthly_budget_cents)).toBe(1000);

        const delRes = await api.delete(`/api/agents/${encodeURIComponent(knightId)}`);
        expect(delRes.ok).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F12] manages Knight cron and domain-event triggers (/api/agents/{id}/triggers) and exposes Turn-Order Queue (/api/agents/queue)',
    { tag: ['@tier1', '@F12'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const slug = uniqueId('knight-triggers');

      try {
        const createKnightRes = await api.post('/api/agents', {
          slug,
          name: 'Watchtower Trigger Knight',
          archetype: 'paladin',
          knight_archetype: 'paladin',
          crest_color: '#F87C18',
          zone: 'cron_watchtower',
          grid_pos: { x: 1, y: 1, zone: 'cron_watchtower' },
          system_prompt: 'Execute scheduled watchtower checks.',
          monthly_budget_cents: 500,
        });
        expect(createKnightRes.ok).toBe(true);
        const knightId = extractEntityId(createKnightRes.json);
        cleanup.defer(async () => {
          await api.delete(`/api/agents/${encodeURIComponent(knightId)}`);
        });

        const cronRes = await api.post(
          `/api/agents/${encodeURIComponent(knightId)}/triggers`,
          {
            type: 'cron',
            trigger_type: 'cron',
            cron_expr: '0 0 7 * * *',
            config_json: { cron: '0 0 7 * * *' },
            enabled: true,
          },
        );
        expect(cronRes.ok).toBe(true);
        const cronTriggerId = extractEntityId(cronRes.json);
        expect(cronTriggerId.length).toBeGreaterThan(0);

        const eventRes = await api.post(
          `/api/agents/${encodeURIComponent(knightId)}/triggers`,
          {
            type: 'event',
            trigger_type: 'sse_event',
            event_filter: 'YoutubeCrawlerSynced',
            config_json: { event: 'YoutubeCrawlerSynced' },
            enabled: true,
          },
        );
        expect(eventRes.ok).toBe(true);

        const listTriggersRes = await api.get(
          `/api/agents/${encodeURIComponent(knightId)}/triggers`,
        );
        expect(listTriggersRes.status).toBe(200);
        const triggers = unwrapList<Record<string, any>>(listTriggersRes, ['triggers']);
        expect(triggers.length).toBeGreaterThanOrEqual(2);

        const updateTriggerRes = await api.put(
          `/api/agents/${encodeURIComponent(knightId)}/triggers/${encodeURIComponent(cronTriggerId)}`,
          {
            type: 'cron',
            trigger_type: 'cron',
            cron_expr: '0 30 8 * * *',
            config_json: { cron: '0 30 8 * * *' },
            enabled: false,
          },
        );
        expect(updateTriggerRes.status).toBe(200);

        const queueRes = await api.get('/api/agents/queue');
        expect(queueRes.status).toBe(200);
        expect(queueRes.json).toBeDefined();
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F12] interpolates SOUL.md template variables ({{today}}, {{active_goals}}, {{portfolio_summary}}) in Dry-Run Sandbox without spending HP budget',
    { tag: ['@tier1', '@F12'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const slug = uniqueId('knight-dryrun-soul');

      try {
        const createRes = await api.post('/api/agents', {
          slug,
          name: 'Dry-Run Paladin',
          archetype: 'paladin',
          knight_archetype: 'paladin',
          crest_color: '#F87C18',
          zone: 'cron_watchtower',
          grid_pos: { x: 2, y: 1, zone: 'cron_watchtower' },
          system_prompt:
            'OATH_DATE={{today}} | GOALS={{active_goals}} | WEALTH={{portfolio_summary}}',
          monthly_budget_cents: 500,
        });
        expect(createRes.ok).toBe(true);
        const knightId = extractEntityId(createRes.json);
        cleanup.defer(async () => {
          await api.delete(`/api/agents/${encodeURIComponent(knightId)}`);
        });

        const dispatchRes = await api.post(
          `/api/agents/${encodeURIComponent(knightId)}/dispatch`,
          {
            dry_run: true,
            input: 'Dry-run tactical check',
          },
        );
        expect(dispatchRes.ok).toBe(true);

        const serializedDispatch = JSON.stringify(dispatchRes.json);
        expect(serializedDispatch).not.toContain('{{today}}');
        expect(serializedDispatch).toMatch(/\d{4}-\d{2}-\d{2}/);

        const afterKnightRes = await api.get(`/api/agents/${encodeURIComponent(knightId)}`);
        expect(afterKnightRes.status).toBe(200);
        const afterKnight = afterKnightRes.json?.data ?? afterKnightRes.json;
        const spent = Number(
          afterKnight.spent_month_cents ?? afterKnight.monthly_spent_cents ?? 0,
        );
        expect(spent).toBe(0);
        if ('hp_pct' in afterKnight) {
          expect(Number(afterKnight.hp_pct)).toBe(100);
        }
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T1][F12] dispatches a live Knight run against startMockHermesGateway, recording agent_runs and updating EP/HP metrics',
    { tag: ['@tier1', '@F12'] },
    async () => {
      const mockGw = await startMockHermesGateway({
        responseText: 'Sir Chronos morning pulse complete.',
      });
      const slug = uniqueId('knight-live-run');

      try {
        await withIsolatedBackend(
          { HERMES_GATEWAY_URL: mockGw.baseV1Url },
          async ({ apiBaseUrl }) => {
            const isoApi = createApiClient(apiBaseUrl);
            const isoCleanup = new CleanupRegistry();

            try {
              const createRes = await isoApi.post('/api/agents', {
                slug,
                name: 'Live Dispatch Knight',
                archetype: 'paladin',
                knight_archetype: 'paladin',
                crest_color: '#F87C18',
                zone: 'cron_watchtower',
                grid_pos: { x: 1, y: 2, zone: 'cron_watchtower' },
                system_prompt: 'Execute morning operational pulse on {{today}}.',
                max_tokens_per_run: 10000,
                model_config: {
                  model: 'nousresearch/hermes-3-llama-3.1-70b',
                  thinking_effort: 'medium',
                  max_context_tokens: 10000,
                },
                monthly_budget_cents: 500,
              });
              expect(createRes.ok).toBe(true);
              const knightId = extractEntityId(createRes.json);
              expect(knightId.length).toBeGreaterThan(0);

              isoCleanup.defer(async () => {
                await isoApi.delete(`/api/agents/${encodeURIComponent(knightId)}`);
              });

              const dispatchRes = await isoApi.post(
                `/api/agents/${encodeURIComponent(knightId)}/dispatch`,
                {
                  dry_run: false,
                  input: 'Generate Morning Pulse',
                },
              );
              expect(dispatchRes.ok).toBe(true);

              const runObj = dispatchRes.json?.run ?? dispatchRes.json?.data ?? dispatchRes.json;
              const runId = extractEntityId(runObj);
              expect(runId.length).toBeGreaterThan(0);

              expect(mockGw.requests.length).toBeGreaterThanOrEqual(1);

              const runDetailRes = await isoApi.get(
                `/api/agent-runs/${encodeURIComponent(runId)}`,
              );
              expect(runDetailRes.status).toBe(200);
              const detail = runDetailRes.json?.data ?? runDetailRes.json;
              expect(String(detail.agent_id)).toBe(knightId);
              expect(['succeeded', 'completed']).toContain(String(detail.status));

              const listRunsRes = await isoApi.get('/api/agent-runs');
              expect(listRunsRes.status).toBe(200);
              const allRuns = unwrapList<Record<string, any>>(listRunsRes, [
                'agent_runs',
                'runs',
              ]);
              expect(allRuns.some((r) => extractEntityId(r) === runId)).toBe(true);
            } finally {
              await isoCleanup.runAll();
            }
          },
        );
      } finally {
        await mockGw.close();
      }
    },
  );

  test(
    '[T1][F12] lists, previews, and distills Markdown notes into Vault Inbox (/api/vault/notes, /api/vault/note, /api/vault/distill)',
    { tag: ['@tier1', '@F12'] },
    async () => {
      const api = createApiClient();
      const beforeSnapshot = snapshotSecondBrainFiles();

      try {
        const noteTitle = `E2E Distilled Architecture ${uniqueId('note')}`;
        const distillRes = await api.post('/api/vault/distill', {
          title: noteTitle,
          content_md:
            '# Architecture Synthesis\n\n- Zero-radius FUI verified.\n- 3-tier MCP autonomy active.',
          content:
            '# Architecture Synthesis\n\n- Zero-radius FUI verified.\n- 3-tier MCP autonomy active.',
          folder: 'Inbox',
          tags: ['e2e', 'architecture'],
        });
        expect(distillRes.ok).toBe(true);
        const distilled = distillRes.json?.data ?? distillRes.json;
        const relPath = String(distilled.path ?? distilled.file_path ?? '');
        expect(relPath.endsWith('.md')).toBe(true);

        const notesRes = await api.get('/api/vault/notes');
        expect(notesRes.status).toBe(200);
        const notes = unwrapList<Record<string, any>>(notesRes, ['notes']);
        expect(
          notes.some(
            (n) =>
              String(n.path ?? n.file_path ?? '') === relPath ||
              String(n.title ?? '').includes(noteTitle),
          ),
        ).toBe(true);

        const previewRes = await api.get(
          `/api/vault/note?path=${encodeURIComponent(relPath)}`,
        );
        expect(previewRes.status).toBe(200);
        const previewData = previewRes.json?.data ?? previewRes.json;
        const markdownBody = String(
          previewData.content_md ?? previewData.content ?? previewRes.text,
        );
        expect(markdownBody).toContain('Architecture Synthesis');
        expect(markdownBody).toContain('Zero-radius FUI verified.');
      } finally {
        cleanupNewSecondBrainFiles(beforeSnapshot);
      }
    },
  );

  test(
    '[T1][F12] serves proactive Companion nudges (/api/companion/nudges) and full CRUD on offline phrases (/api/companion/phrases)',
    { tag: ['@tier1', '@F12'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const customQuote = `Even a 1000-year mage writes E2E tests first (${uniqueId('quote')}).`;

      try {
        const nudgesRes = await api.get('/api/companion/nudges');
        expect(nudgesRes.status).toBe(200);
        const nudges = unwrapList<Record<string, any>>(nudgesRes, ['nudges']);
        expect(Array.isArray(nudges)).toBe(true);

        const initialPhrasesRes = await api.get('/api/companion/phrases');
        expect(initialPhrasesRes.status).toBe(200);
        const initialPhrases = unwrapList<Record<string, any>>(initialPhrasesRes, ['phrases']);
        expect(initialPhrases.length).toBeGreaterThan(0);

        const createPhraseRes = await api.post('/api/companion/phrases', {
          phrase_text: customQuote,
          category: 'todo_done',
          trigger_context: 'todo_done',
          animation_hint: 'grimoire',
          active: true,
          enabled: true,
        });
        expect(createPhraseRes.ok).toBe(true);
        const phraseId = extractEntityId(createPhraseRes.json);
        expect(phraseId.length).toBeGreaterThan(0);

        cleanup.defer(async () => {
          await api.delete(`/api/companion/phrases/${encodeURIComponent(phraseId)}`);
        });

        const afterCreateRes = await api.get('/api/companion/phrases');
        expect(afterCreateRes.status).toBe(200);
        const afterCreatePhrases = unwrapList<Record<string, any>>(afterCreateRes, ['phrases']);
        expect(afterCreatePhrases.some((p) => p.phrase_text === customQuote)).toBe(true);

        const delRes = await api.delete(
          `/api/companion/phrases/${encodeURIComponent(phraseId)}`,
        );
        expect(delRes.ok).toBe(true);

        const afterDelRes = await api.get('/api/companion/phrases');
        expect(afterDelRes.status).toBe(200);
        const afterDelPhrases = unwrapList<Record<string, any>>(afterDelRes, ['phrases']);
        expect(afterDelPhrases.some((p) => String(p.id) === phraseId)).toBe(false);
      } finally {
        await cleanup.runAll();
      }
    },
  );
});
