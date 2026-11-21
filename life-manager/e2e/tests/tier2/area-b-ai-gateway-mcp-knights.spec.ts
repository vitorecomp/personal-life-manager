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
  startMockHermesGateway,
} from '../../harness';

function extractEntityId(record: Record<string, any> | null | undefined): string {
  if (!record || typeof record !== 'object') return '';
  const data = record.data && typeof record.data === 'object' ? record.data : record;
  return String(data.id ?? data.session_key ?? data.key ?? '');
}

test.describe('Tier 2 — Area B: Boundary, Negative & Resilience for AI Gateway, /mcp & Knights (F09, F10, F12)', () => {
  test.beforeAll(async () => {
    await ensureStackReady();
  });

  // ===========================================================================
  // Feature F09 — hermes gateway SSE Bridge & Offline Mock Resilience (6 tests)
  // ===========================================================================

  test(
    '[T2][F09] degrades gracefully to offline_mock SSE stream without HTTP 500 when hermes gateway is unreachable',
    { tag: ['@tier2', '@F09'] },
    async () => {
      const offlineSessionKey = uniqueId('sess-f09-offline');

      await withIsolatedBackend(
        { HERMES_GATEWAY_URL: 'http://127.0.0.1:59999/v1' },
        async ({ apiBaseUrl }) => {
          const isoApi = createApiClient(apiBaseUrl);
          const isoCleanup = new CleanupRegistry();

          try {
            isoCleanup.defer(async () => {
              await isoApi.delete(
                `/api/hermes/sessions/${encodeURIComponent(offlineSessionKey)}`,
              );
            });

            const healthRes = await isoApi.get('/api/health');
            expect(healthRes.status).toBe(200);
            expect(healthRes.json.status).toBe('ok');
            expect(healthRes.json.hermes_gateway).toBe('offline_mock');

            const events = await readSseEvents(`${apiBaseUrl}/hermes/chat/stream`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Hermes-Session-Key': offlineSessionKey,
              },
              body: JSON.stringify({
                message: 'Plan my day while gateway is offline',
                session_key: offlineSessionKey,
                high_level_mode: true,
                origin: 'hermes_view',
              }),
              stopOnEvent: 'done',
              timeoutMs: 10_000,
            });

            expect(events.length).toBeGreaterThan(0);
            const streamPayload = JSON.stringify(events).toLowerCase();
            expect(
              streamPayload.includes('offline_mock') ||
                streamPayload.includes('offline') ||
                streamPayload.includes('mock'),
            ).toBe(true);

            const sessionRes = await isoApi.get(
              `/api/hermes/sessions/${encodeURIComponent(offlineSessionKey)}`,
            );
            expect(sessionRes.status).toBe(200);
          } finally {
            await isoCleanup.runAll();
          }
        },
      );
    },
  );

  test(
    '[T2][F09] handles upstream hermes gateway HTTP 502 failure without crashing backend or returning unhandled 500',
    { tag: ['@tier2', '@F09'] },
    async () => {
      const mockGw = await startMockHermesGateway({ failStatus: 502 });
      const fail502Key = uniqueId('sess-f09-502');

      try {
        await withIsolatedBackend(
          { HERMES_GATEWAY_URL: mockGw.baseV1Url },
          async ({ apiBaseUrl }) => {
            const isoApi = createApiClient(apiBaseUrl);
            const isoCleanup = new CleanupRegistry();

            try {
              isoCleanup.defer(async () => {
                await isoApi.delete(`/api/hermes/sessions/${encodeURIComponent(fail502Key)}`);
              });

              const res = await isoApi.raw('/api/hermes/chat/stream', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Accept: 'text/event-stream',
                  'X-Hermes-Session-Key': fail502Key,
                },
                body: JSON.stringify({
                  message: 'Test upstream 502 resilience',
                  session_key: fail502Key,
                  origin: 'hermes_view',
                }),
              });

              expect(res.status).toBeLessThan(500);

              const postHealthRes = await isoApi.get('/api/health');
              expect(postHealthRes.status).toBe(200);
              expect(postHealthRes.json.status).toBe('ok');
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
    '[T2][F09] rejects missing or whitespace-only message in POST /api/hermes/chat/stream with 400 or 422',
    { tag: ['@tier2', '@F09'] },
    async () => {
      const api = createApiClient();
      const sessionKey = uniqueId('sess-f09-empty-msg');

      const missingRes = await api.post(
        '/api/hermes/chat/stream',
        {},
        { 'X-Hermes-Session-Key': sessionKey },
      );
      expect(missingRes.ok).toBe(false);
      expect([400, 422]).toContain(missingRes.status);

      const blankRes = await api.post(
        '/api/hermes/chat/stream',
        { message: '   \n\t  ', content: '   \n\t  ' },
        { 'X-Hermes-Session-Key': sessionKey },
      );
      expect(blankRes.ok).toBe(false);
      expect([400, 422]).toContain(blankRes.status);
    },
  );

  test(
    '[T2][F09] returns 404 Not Found on GET, PATCH, DELETE, and fork for a non-existent session key',
    { tag: ['@tier2', '@F09'] },
    async () => {
      const api = createApiClient();
      const ghostKey = uniqueId('ghost-session-404');

      const getRes = await api.get(`/api/hermes/sessions/${encodeURIComponent(ghostKey)}`);
      expect(getRes.status).toBe(404);

      const patchRes = await api.patch(
        `/api/hermes/sessions/${encodeURIComponent(ghostKey)}`,
        { title: 'Ghost Session' },
      );
      expect(patchRes.status).toBe(404);

      const forkRes = await api.post(
        `/api/hermes/sessions/${encodeURIComponent(ghostKey)}/fork`,
        { title: 'Ghost Fork' },
      );
      expect(forkRes.status).toBe(404);

      const delRes = await api.delete(`/api/hermes/sessions/${encodeURIComponent(ghostKey)}`);
      expect(delRes.status).toBe(404);
    },
  );

  test(
    '[T2][F09] deleting a session cleans up session state and removes it from subsequent queries',
    { tag: ['@tier2', '@F09'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const delKey = uniqueId('sess-f09-del-cascade');

      try {
        const createRes = await api.post('/api/hermes/sessions', {
          session_key: delKey,
          title: 'Ephemeral Session To Delete',
          origin: 'hermes_view',
        });
        expect(createRes.ok).toBe(true);
        cleanup.defer(async () => {
          await api.delete(`/api/hermes/sessions/${encodeURIComponent(delKey)}`);
        });

        const delRes = await api.delete(`/api/hermes/sessions/${encodeURIComponent(delKey)}`);
        expect(delRes.ok).toBe(true);
        expect([200, 204]).toContain(delRes.status);

        const getAfterRes = await api.get(`/api/hermes/sessions/${encodeURIComponent(delKey)}`);
        expect(getAfterRes.status).toBe(404);

        const listRes = await api.get('/api/hermes/sessions');
        expect(listRes.status).toBe(200);
        const list = unwrapList<Record<string, any>>(listRes, ['sessions']);
        expect(list.some((s) => extractEntityId(s) === delKey)).toBe(false);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F09] handles mid-stream client abort or upstream timeout gracefully without wedging subsequent session streams',
    { tag: ['@tier2', '@F09'] },
    async () => {
      const mockGw = await startMockHermesGateway({
        hangMs: 2500,
        responseText: 'Delayed stream chunk',
      });
      const sessionKey = uniqueId('sess-f09-abort-recover');

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

              await readSseEvents(`${apiBaseUrl}/hermes/chat/stream`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Hermes-Session-Key': sessionKey,
                },
                body: JSON.stringify({
                  message: 'Aborted slow request',
                  session_key: sessionKey,
                }),
                timeoutMs: 250,
              }).catch(() => []);

              mockGw.setOptions({
                hangMs: 0,
                responseText: 'Recovered cleanly after client abort.',
              });

              const recoveryEvents = await readSseEvents(`${apiBaseUrl}/hermes/chat/stream`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Hermes-Session-Key': sessionKey,
                },
                body: JSON.stringify({
                  message: 'Follow-up after abort',
                  session_key: sessionKey,
                }),
                stopOnEvent: 'done',
                timeoutMs: 10_000,
              });

              expect(recoveryEvents.length).toBeGreaterThan(0);
              const combined = recoveryEvents.map((e) => e.data).join('\n');
              expect(combined).toContain('Recovered cleanly after client abort.');
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

  // ===========================================================================
  // Feature F10 — Native Rust /mcp Server & 3-Tier Write Autonomy Gate (6 tests)
  // ===========================================================================

  test(
    '[T2][F10] rejecting a pending /mcp approval via POST /api/mcp/approvals/{id}/reject leaves target entity untouched',
    { tag: ['@tier2', '@F10'] },
    async () => {
      const api = createApiClient();
      const mcp = createMcpClient();
      const cleanup = new CleanupRegistry();
      const title = uniqueId('Protected-Task-Against-Delete');

      try {
        const createRes = await api.post('/api/tasks', {
          title,
          status: 'todo',
          priority: 'high',
        });
        expect(createRes.ok).toBe(true);
        const taskId = extractEntityId(createRes.json);
        cleanup.defer(async () => {
          await api.delete(`/api/tasks/${encodeURIComponent(taskId)}`);
        });

        const delCall = await mcp.callTool('todos_delete_task', {
          id: taskId,
          task_id: taskId,
        });
        expect(typeof delCall.approvalId).toBe('string');

        const rejRes = await api.post(
          `/api/mcp/approvals/${encodeURIComponent(delCall.approvalId!)}/reject`,
          { reason: 'Operator rejected destructive delete' },
        );
        expect(rejRes.status).toBe(200);

        const taskCheckRes = await api.get(`/api/tasks/${encodeURIComponent(taskId)}`);
        expect(taskCheckRes.status).toBe(200);
        const taskData = taskCheckRes.json?.data ?? taskCheckRes.json;
        expect(taskData.title).toBe(title);

        const reApproveRes = await api.post(
          `/api/mcp/approvals/${encodeURIComponent(delCall.approvalId!)}/approve`,
          {},
        );
        expect(reApproveRes.ok).toBe(false);
        expect([400, 409, 422]).toContain(reApproveRes.status);
      } finally {
        await mcp.closeSession();
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F10] approving a pending /mcp write with an edited payload_json applies the modified arguments',
    { tag: ['@tier2', '@F10'] },
    async () => {
      const api = createApiClient();
      const mcp = createMcpClient();
      const cleanup = new CleanupRegistry();
      const symbol = `ED${Date.now().toString().slice(-4)}.SA`;

      try {
        const callRes = await mcp.callTool('finance_upsert_asset', {
          symbol,
          name: 'Original Unedited Equity',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 10,
          avg_cost_cents: 1000,
          current_price_cents: 1200,
          target_weight_pct: 5,
        });
        expect(typeof callRes.approvalId).toBe('string');

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

        const editedPayload = {
          symbol,
          name: 'Edited By Operator Before Approval',
          asset_class: 'br_equity',
          currency: 'BRL',
          in_portfolio: true,
          quantity: 250,
          avg_cost_cents: 1000,
          current_price_cents: 1500,
          target_weight_pct: 12,
        };

        const approveRes = await api.post(
          `/api/mcp/approvals/${encodeURIComponent(callRes.approvalId!)}/approve`,
          {
            payload_json: editedPayload,
            arguments: editedPayload,
          },
        );
        expect(approveRes.status).toBe(200);

        const assetsRes = await api.get('/api/finance/assets');
        expect(assetsRes.status).toBe(200);
        const assets = unwrapList<Record<string, any>>(assetsRes, ['assets']);
        const asset = assets.find((a) => a.symbol === symbol);
        expect(asset).toBeDefined();
        expect(Number(asset?.quantity)).toBe(250);
        expect(Number(asset?.current_price_cents)).toBe(1500);
        expect(asset?.name).toBe('Edited By Operator Before Approval');
      } finally {
        await mcp.closeSession();
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F10] rejects non-existent or double-used undo_id on POST /api/mcp/undo/{undo_id} with 400, 404, or 409',
    { tag: ['@tier2', '@F10'] },
    async () => {
      const api = createApiClient();
      const mcp = createMcpClient();
      const cleanup = new CleanupRegistry();
      const singleUseTitle = uniqueId('Single-Use-Undo-Task');

      try {
        const ghostUndoRes = await api.post(
          '/api/mcp/undo/01900000-0000-7000-8000-000000000999',
          {},
        );
        expect(ghostUndoRes.ok).toBe(false);
        expect([400, 404, 409, 422]).toContain(ghostUndoRes.status);

        const callRes = await mcp.callTool('todos_create_task', {
          title: singleUseTitle,
          status: 'todo',
        });
        cleanup.defer(async () => {
          const listRes = await api.get('/api/tasks');
          const tasks = unwrapList<Record<string, any>>(listRes, ['tasks']);
          const match = tasks.find((t) => t.title === singleUseTitle);
          if (match?.id) {
            await api.delete(`/api/tasks/${encodeURIComponent(String(match.id))}`);
          }
        });
        expect(typeof callRes.undoId).toBe('string');

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
    '[T2][F10] returns structured MCP or JSON-RPC error when calling an unknown tool name or passing invalid arguments',
    { tag: ['@tier2', '@F10'] },
    async () => {
      const mcp = createMcpClient();
      try {
        await mcp.initialize();

        const unknownRaw = await mcp.callToolRaw('unknown_domain_nonexistent_tool', {
          foo: 'bar',
        });
        expect(unknownRaw.status).toBeLessThan(500);
        const hasRpcError = Boolean(unknownRaw.rpc?.error);
        const hasResultError = Boolean(unknownRaw.rpc?.result?.isError);
        expect(hasRpcError || hasResultError || unknownRaw.status >= 400).toBe(true);

        const badArgsRaw = await mcp.callToolRaw('todos_create_task', {
          title: '',
        });
        expect(badArgsRaw.status).toBeLessThan(500);
        expect(
          Boolean(badArgsRaw.rpc?.error) ||
            Boolean(badArgsRaw.rpc?.result?.isError) ||
            badArgsRaw.status >= 400,
        ).toBe(true);
      } finally {
        await mcp.closeSession();
      }
    },
  );

  test(
    '[T2][F10] rejects /mcp requests carrying an invalid or revoked Bearer PAT with 401 Unauthorized',
    { tag: ['@tier2', '@F10'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();

      try {
        const invalidMcp = createMcpClient(
          E2E_URLS.mcpUrl,
          'plm_pat_invalid_token_deadbeef1234567890',
        );
        const invalidRes = await invalidMcp.sendRawRpc(
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              clientInfo: { name: 'invalid-pat-client', version: '1.0.0' },
            },
          },
          undefined,
          { includeProtocolHeader: false },
        );
        expect(invalidRes.status).toBe(401);

        const pat = await createPatToken(api, uniqueId('revoked-mcp-pat'));
        cleanup.defer(async () => {
          if (pat.id) {
            await api.delete(`/api/auth/tokens/${encodeURIComponent(pat.id)}`);
          }
        });
        const delRes = await api.delete(`/api/auth/tokens/${encodeURIComponent(pat.id)}`);
        expect(delRes.ok).toBe(true);

        const revokedMcp = createMcpClient(E2E_URLS.mcpUrl, pat.token);
        const revokedRes = await revokedMcp.sendRawRpc(
          {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
          },
          undefined,
          { includeProtocolHeader: false },
        );
        expect(revokedRes.status).toBe(401);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F10] gates high-risk dashboards_configure_command_widget and dashboards_configure_sql_widget behind REQUIRE_APPROVAL',
    { tag: ['@tier2', '@F10'] },
    async () => {
      const api = createApiClient();
      const mcp = createMcpClient();
      const cleanup = new CleanupRegistry();

      try {
        const dashboardsRes = await api.get('/api/dashboards');
        expect(dashboardsRes.status).toBe(200);
        const dashboards = unwrapList<Record<string, any>>(dashboardsRes, ['dashboards']);
        const deckId = String(dashboards[0]?.id ?? '01900000-0000-7000-8000-000000000001');

        const cmdCall = await mcp.callTool('dashboards_configure_command_widget', {
          dashboard_id: deckId,
          title: 'Host Disk Check',
          command: 'df -h',
        });
        expect(cmdCall.status).toBe(200);
        expect(typeof cmdCall.approvalId).toBe('string');
        expect(cmdCall.approvalId!.length).toBeGreaterThan(0);

        cleanup.defer(async () => {
          await api.post(
            `/api/mcp/approvals/${encodeURIComponent(cmdCall.approvalId!)}/reject`,
            { reason: 'Cleanup unapproved command widget' },
          );
        });

        const sqlCall = await mcp.callTool('dashboards_configure_sql_widget', {
          dashboard_id: deckId,
          title: 'Task Count SQL',
          sql_query: 'SELECT count(*) FROM tasks',
        });
        expect(sqlCall.status).toBe(200);
        expect(typeof sqlCall.approvalId).toBe('string');
        expect(sqlCall.approvalId!.length).toBeGreaterThan(0);

        cleanup.defer(async () => {
          await api.post(
            `/api/mcp/approvals/${encodeURIComponent(sqlCall.approvalId!)}/reject`,
            { reason: 'Cleanup unapproved sql widget' },
          );
        });
      } finally {
        await mcp.closeSession();
        await cleanup.runAll();
      }
    },
  );

  // ===========================================================================
  // Feature F12 — Backend Agent Studio Knights, Vault Inspector & Nudges (6 tests)
  // ===========================================================================

  test(
    '[T2][F12] trips HP = 0% monthly budget circuit breaker when monthly_budget_cents is exhausted',
    { tag: ['@tier2', '@F12'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const slug = uniqueId('knight-zero-budget');

      try {
        const createRes = await api.post('/api/agents', {
          slug,
          name: 'Zero Budget Knight',
          archetype: 'inquisitor',
          knight_archetype: 'inquisitor',
          crest_color: '#EB4511',
          zone: 'cron_watchtower',
          grid_pos: { x: 1, y: 1, zone: 'cron_watchtower' },
          system_prompt: 'Attempt run with 0 budget.',
          monthly_budget_cents: 0,
        });
        expect(createRes.ok).toBe(true);
        const knightId = extractEntityId(createRes.json);
        cleanup.defer(async () => {
          await api.delete(`/api/agents/${encodeURIComponent(knightId)}`);
        });

        const dispatchRes = await api.post(
          `/api/agents/${encodeURIComponent(knightId)}/dispatch`,
          {
            dry_run: false,
            input: 'Should be blocked by HP=0 circuit breaker',
          },
        );

        const bodyStr = JSON.stringify(dispatchRes.json || {}).toLowerCase();
        const blockedByHttp = [402, 409, 422, 429].includes(dispatchRes.status);
        const blockedInStatus =
          bodyStr.includes('aborted_budget') ||
          bodyStr.includes('budget') ||
          bodyStr.includes('circuit') ||
          bodyStr.includes('blocked') ||
          bodyStr.includes('failed');

        expect(blockedByHttp || blockedInStatus).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F12] refuses background trigger dispatch when Knight is stationed in Standby Barracks (zone: standby_barracks)',
    { tag: ['@tier2', '@F12'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const slug = uniqueId('knight-barracks-paused');

      try {
        const createRes = await api.post('/api/agents', {
          slug,
          name: 'Barracks Resting Knight',
          archetype: 'paladin',
          knight_archetype: 'paladin',
          crest_color: '#F87C18',
          zone: 'standby_barracks',
          grid_pos: { x: 0, y: 0, zone: 'standby_barracks' },
          status: 'paused',
          enabled: false,
          system_prompt: 'Resting in barracks.',
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
            dry_run: false,
            trigger_type: 'cron',
            respect_barracks: true,
            input: 'Scheduled cron while in standby_barracks',
          },
        );

        const bodyStr = JSON.stringify(dispatchRes.json || {}).toLowerCase();
        const refusedByHttp = [400, 409, 422].includes(dispatchRes.status);
        const refusedInStatus =
          bodyStr.includes('paused') ||
          bodyStr.includes('barracks') ||
          bodyStr.includes('skipped') ||
          bodyStr.includes('blocked') ||
          bodyStr.includes('cancelled');

        expect(refusedByHttp || refusedInStatus).toBe(true);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F12] rejects invalid cron expression or invalid trigger type on POST /api/agents/{id}/triggers with 400 or 422',
    { tag: ['@tier2', '@F12'] },
    async () => {
      const api = createApiClient();
      const cleanup = new CleanupRegistry();
      const slug = uniqueId('knight-bad-triggers');

      try {
        const createRes = await api.post('/api/agents', {
          slug,
          name: 'Trigger Validation Knight',
          archetype: 'paladin',
          knight_archetype: 'paladin',
          crest_color: '#F87C18',
          zone: 'cron_watchtower',
          grid_pos: { x: 1, y: 1, zone: 'cron_watchtower' },
          system_prompt: 'Validate trigger inputs.',
          monthly_budget_cents: 500,
        });
        expect(createRes.ok).toBe(true);
        const knightId = extractEntityId(createRes.json);
        cleanup.defer(async () => {
          await api.delete(`/api/agents/${encodeURIComponent(knightId)}`);
        });

        const badCronRes = await api.post(
          `/api/agents/${encodeURIComponent(knightId)}/triggers`,
          {
            type: 'cron',
            trigger_type: 'cron',
            cron_expr: 'not-a-valid-cron-expression * * *',
            config_json: { cron: 'not-a-valid-cron-expression * * *' },
            enabled: true,
          },
        );
        expect(badCronRes.ok).toBe(false);
        expect([400, 422]).toContain(badCronRes.status);

        const badTypeRes = await api.post(
          `/api/agents/${encodeURIComponent(knightId)}/triggers`,
          {
            type: 'telepathic_unknown_trigger',
            trigger_type: 'telepathic_unknown_trigger',
            config_json: {},
            enabled: true,
          },
        );
        expect(badTypeRes.ok).toBe(false);
        expect([400, 422]).toContain(badTypeRes.status);
      } finally {
        await cleanup.runAll();
      }
    },
  );

  test(
    '[T2][F12] blocks Vault Inspector path traversal attacks on GET /api/vault/note with 400 or 403',
    { tag: ['@tier2', '@F12'] },
    async () => {
      const api = createApiClient();

      const traversalPaths = [
        '../../etc/passwd',
        '../../../Cargo.toml',
        '../backend/Cargo.toml',
        '/etc/passwd',
      ];

      let blockedCount = 0;
      for (const maliciousPath of traversalPaths) {
        const res = await api.get(
          `/api/vault/note?path=${encodeURIComponent(maliciousPath)}`,
        );
        expect(res.ok).toBe(false);
        expect([400, 403, 404, 422]).toContain(res.status);
        expect(res.text).not.toContain('root:x:');
        expect(res.text).not.toContain('[workspace]');
        blockedCount++;
      }

      expect(blockedCount).toBe(traversalPaths.length);
      expect(traversalPaths.length).toBe(4);
    },
  );

  test(
    '[T2][F12] returns 404 Not Found when fetching, updating, deleting, or dispatching a non-existent Knight ID',
    { tag: ['@tier2', '@F12'] },
    async () => {
      const api = createApiClient();
      const ghostId = '01900000-0000-7000-8000-000000000404';

      const getRes = await api.get(`/api/agents/${ghostId}`);
      expect(getRes.status).toBe(404);

      const putRes = await api.put(`/api/agents/${ghostId}`, {
        name: 'Ghost Knight',
      });
      expect(putRes.status).toBe(404);

      const dispatchRes = await api.post(`/api/agents/${ghostId}/dispatch`, {
        dry_run: true,
      });
      expect(dispatchRes.status).toBe(404);

      const delRes = await api.delete(`/api/agents/${ghostId}`);
      expect(delRes.status).toBe(404);
    },
  );

  test(
    '[T2][F12] executes Knight dispatch gracefully via deterministic fallback when hermes gateway (:8642) is offline',
    { tag: ['@tier2', '@F12'] },
    async () => {
      const slug = uniqueId('knight-offline-fallback');

      await withIsolatedBackend(
        { HERMES_GATEWAY_URL: 'http://127.0.0.1:59998/v1' },
        async ({ apiBaseUrl }) => {
          const isoApi = createApiClient(apiBaseUrl);
          const isoCleanup = new CleanupRegistry();

          try {
            const createRes = await isoApi.post('/api/agents', {
              slug,
              name: 'Offline Fallback Knight',
              archetype: 'paladin',
              knight_archetype: 'paladin',
              crest_color: '#F87C18',
              zone: 'cron_watchtower',
              grid_pos: { x: 1, y: 1, zone: 'cron_watchtower' },
              system_prompt: 'Execute offline briefing resilience check on {{today}}.',
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
                input: 'Offline morning briefing resilience check',
              },
            );

            expect(dispatchRes.status).toBeLessThan(500);
            expect(dispatchRes.ok).toBe(true);
          } finally {
            await isoCleanup.runAll();
          }
        },
      );
    },
  );
});
