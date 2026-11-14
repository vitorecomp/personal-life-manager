import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALLOWED_MOBILE_SURFACES, App } from './App';
import { parseTodoQuickCapture } from './db/nlpParser';
import { decryptPat, encryptPat, parsePairingQrPayload } from './db/patCrypto';
import { ALL_MOBILE_SQLITE_TABLES, MobileSqliteEngine } from './db/sqliteEngine';
import { generateUuidV7, isValidUuidV7, RFC9562_UUIDV7_RE } from './db/uuidv7';
import {
  executeMcpApproval,
  executeMcpUndo,
  probeAndVerifyUplink,
  runDeltaSync,
  streamCompanionChat,
} from './services/uplinkSync';

describe('HERMES Companion Mobile App — F33, F34, F35 Verification Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.pushState({}, '', '/');
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  // =========================================================================
  // F33: Strictly Scoped Capacitor Mobile Shell & Excluded Route Guard
  // =========================================================================

  it('[F33] locks ALLOWED_MOBILE_SURFACES to ROUTINES, TODOS, COMPANION, and UPLINK_CONFIG and renders SystemApertureLogo', async () => {
    expect(ALLOWED_MOBILE_SURFACES).toEqual([
      'ROUTINES',
      'TODOS',
      'COMPANION',
      'UPLINK_CONFIG',
    ]);

    render(<App />);
    const shell = screen.getByTestId('hermes-mobile-shell');
    expect(shell).toBeTruthy();
    expect(document.title).toMatch(/HERMES Companion/i);

    // Header renders REF-10 SystemApertureLogo
    const logo = shell.querySelector('svg[data-fui="system-aperture-logo"]');
    expect(logo).toBeTruthy();

    // Navigation bar has exact 4 buttons in order
    const nav = screen.getByRole('navigation', { name: 'Mobile Navigation' });
    const buttons = Array.from(nav.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      'ROUTINES',
      'TODOS',
      'COMPANION',
      'UPLINK_CONFIG',
    ]);

    // Zero excluded desktop links
    const excludedLinks = shell.querySelectorAll(
      'a[href="/monitor"], a[href="/hermes"], a[href="/agents"], a[href="/goals"], a[href="/courses"], a[href="/finance"]',
    );
    expect(excludedLinks.length).toBe(0);

    // Clicking each surface updates the header title
    for (const surface of ALLOWED_MOBILE_SURFACES) {
      const btn = screen.getByTestId(`mobile-tab-${surface.toLowerCase()}`);
      fireEvent.click(btn);
      expect(shell.textContent).toContain(`HERMES COMPANION // ${surface}`);
    }
  });

  it('[F33] guards excluded desktop routes (/dashboard, /monitor, /hermes, /agents, /goals, /courses, /finance) with OUT_OF_MOBILE_SCOPE banner', async () => {
    window.history.pushState({}, '', '/finance');
    render(<App />);

    const shell = screen.getByTestId('hermes-mobile-shell');
    expect(shell).toBeTruthy();
    const banner = screen.getByTestId('out-of-mobile-scope-banner');
    expect(banner.textContent).toContain('OUT_OF_MOBILE_SCOPE');
    expect(banner.textContent).toContain('/finance');

    // Dismissing the guard banner returns cleanly to the mobile surface
    fireEvent.click(screen.getByTestId('dismiss-excluded-route-btn'));
    expect(screen.queryByTestId('out-of-mobile-scope-banner')).toBeNull();
  });

  // =========================================================================
  // F34: 10-Table SQLite Engine, UUIDv7, NLP Capture, Timer, Routines & Sync
  // =========================================================================

  it('[F34] generates monotonic RFC 9562 UUIDv7 identifiers', () => {
    const ids = Array.from({ length: 20 }, () => generateUuidV7(1763145600000));
    const unique = new Set(ids);
    expect(unique.size).toBe(20);
    for (const id of ids) {
      expect(isValidUuidV7(id)).toBe(true);
      expect(id).toMatch(RFC9562_UUIDV7_RE);
    }
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it('[F34] initializes all 10 SQLite tables, seeds default rows with 0 outbox mutations, and persists across reloads', async () => {
    const engine1 = await MobileSqliteEngine.create({ fresh: true });
    const tableNames = engine1.listTableNames();
    for (const expectedTable of ALL_MOBILE_SQLITE_TABLES) {
      expect(tableNames).toContain(expectedTable);
    }

    // Seed data should not pollute sync_outbox before user mutation
    expect(engine1.getOutboxMutations().length).toBe(0);
    expect(engine1.listOfflinePhrases().length).toBeGreaterThanOrEqual(8);
    expect(engine1.listRoutineStacks('workday').length).toBeGreaterThanOrEqual(3);

    // Perform an offline task capture
    const { task, mutation } = engine1.createTaskFromQuickCapture(
      'Calibrate field antenna #ops @deep !p1 tomorrow 45m',
      '2026-11-14',
    );
    expect(task.id).toMatch(RFC9562_UUIDV7_RE);
    expect(mutation.mutation_id).toMatch(RFC9562_UUIDV7_RE);
    expect(task.priority).toBe('urgent');
    expect(task.energy_level).toBe('deep');
    expect(task.estimated_minutes).toBe(45);
    expect(task.scheduled_date).toBe('2026-11-15');
    expect(task.tags).toContain('ops');

    // Reload a brand-new engine instance from localStorage snapshot
    const engine2 = await MobileSqliteEngine.create({ fresh: false });
    const reloadedTask = engine2.getTask(task.id);
    expect(reloadedTask?.title).toBe('Calibrate field antenna');
    expect(engine2.getOutboxMutations().length).toBe(1);
  });

  it('[F34] rejects blank Todo quick-capture titles and rolls up Focus Timer sessions into tasks.actual_seconds', async () => {
    const parsedBlank = parseTodoQuickCapture('   ');
    expect(parsedBlank.valid).toBe(false);
    const parsedDirectivesOnly = parseTodoQuickCapture('#ops !p1 @deep 30m');
    expect(parsedDirectivesOnly.valid).toBe(false);

    const engine = await MobileSqliteEngine.create({ fresh: true });
    expect(() => engine.createTaskFromQuickCapture('   ')).toThrow();
    expect(engine.getOutboxMutations().length).toBe(0);

    const { task } = engine.createTaskFromQuickCapture('Write Rust sync unit tests @deep 25m');
    const session = engine.startFocusTimer({
      taskId: task.id,
      timerMode: 'pomodoro_25_5',
    });
    expect(session.id).toMatch(RFC9562_UUIDV7_RE);
    expect(engine.getActiveTimer()?.id).toBe(session.id);

    const stopped = engine.stopFocusTimer(300);
    expect(stopped?.duration_seconds).toBe(300);
    expect(engine.getActiveTimer()).toBeNull();
    expect(engine.getTask(task.id)?.actual_seconds).toBe(300);

    // Toggle completion & delete
    const completed = engine.toggleTaskCompletion(task.id);
    expect(completed?.status).toBe('done');
    expect(completed?.completed_at).toBeTruthy();

    expect(engine.deleteTask(task.id)).toBe(true);
    expect(engine.listTasks().find((t) => t.id === task.id)).toBeUndefined();
  });

  it('[F34] logs Routine habits across Day Profiles and saves Daily Pulse check-ins', async () => {
    const engine = await MobileSqliteEngine.create({ fresh: true });
    const workdayStacks = engine.listRoutineStacks('workday', '2026-11-14');
    const mvdStacks = engine.listRoutineStacks('minimum_viable', '2026-11-14');
    expect(workdayStacks.length).toBeGreaterThanOrEqual(mvdStacks.length);

    const firstItem = workdayStacks[0]!.items[0]!;
    const log1 = engine.toggleRoutineItemLog(firstItem.id, '2026-11-14');
    expect(log1.status).toBe('completed');
    expect(log1.id).toMatch(RFC9562_UUIDV7_RE);

    // Step numeric/duration item
    const durationItem = workdayStacks[0]!.items[1]!;
    const stepped = engine.stepRoutineItemValue(durationItem.id, 15, '2026-11-14');
    expect(stepped.numeric_value).toBe(15);
    expect(stepped.status).toBe('completed');

    // Save Daily Pulse check-in
    const checkin = engine.upsertDailyCheckin({
      logDate: '2026-11-14',
      dayProfileUsed: 'workday',
      energyScore: 5,
      moodScore: 4,
      sleepHours: 8,
      highlight: 'Shipped Mobile Companion M5',
    });
    expect(checkin.energy_score).toBe(5);
    expect(checkin.highlight).toBe('Shipped Mobile Companion M5');
  });

  it('[F34] encrypts PAT at rest and never leaks plaintext plm_pat_ token to localStorage or sessionStorage', async () => {
    const rawToken = 'plm_pat_99887766554433221100aabbccddeeff';
    const cipher = encryptPat(rawToken, 'client-01');
    expect(cipher).toMatch(/^enc:v1:[0-9a-f]+$/);
    expect(cipher).not.toContain('plm_pat_');
    expect(cipher).not.toContain('99887766');
    expect(decryptPat(cipher, 'client-01')).toBe(rawToken);

    // Parse QR pairing payload
    const qrParsed = parsePairingQrPayload(
      JSON.stringify({
        primary_url: 'http://192.168.1.10:8080',
        fallback_url: 'http://100.64.0.5:8080',
        token: rawToken,
      }),
    );
    expect(qrParsed).toEqual({
      primaryUrl: 'http://192.168.1.10:8080',
      fallbackUrl: 'http://100.64.0.5:8080',
      token: rawToken,
      tokenName: undefined,
    });

    // Render App, navigate to UPLINK_CONFIG, fill inputs 0..2, and click TEST UPLINK
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('59998')) {
        throw new Error('Connection refused');
      }
      if (url.endsWith('/api/auth/verify')) {
        return new Response(
          JSON.stringify({
            authenticated: true,
            auth_type: 'pat',
            token_name: 'Test Mobile PAT',
            latest_server_seq: 12,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/sync/pull')) {
        return new Response(
          JSON.stringify({ changes: [], latest_server_seq: 12, has_more: false }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      render(<App />);
      await waitFor(() => {
        expect(screen.getByTestId('hermes-mobile-shell').getAttribute('data-db-ready')).toBe(
          'true',
        );
      });

      fireEvent.click(screen.getByTestId('mobile-tab-uplink_config'));

      const allInputs = Array.from(document.querySelectorAll('input'));
      expect(allInputs.length).toBeGreaterThanOrEqual(3);
      fireEvent.change(allInputs[0]!, { target: { value: 'http://127.0.0.1:59998' } });
      fireEvent.change(allInputs[1]!, { target: { value: 'http://127.0.0.1:8080' } });
      fireEvent.change(allInputs[2]!, { target: { value: rawToken } });

      fireEvent.click(screen.getByTestId('uplink-test-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('uplink-telemetry-panel').textContent).toContain(
          'http://127.0.0.1:8080 [FALLBACK]',
        );
      });

      const storageDump = JSON.stringify({
        local: Object.entries(localStorage),
        session: Object.entries(sessionStorage),
      });
      expect(storageDump).not.toContain(rawToken);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('[F34] fails over from unreachable Primary URL to Fallback URL, preserves outbox on HTTP 503/401, and reconciles LWW + delete tombstones on pull', async () => {
    const engine = await MobileSqliteEngine.create({ fresh: true });
    const rawToken = 'plm_pat_abcdef0123456789abcdef0123456789';
    engine.saveUplinkConfig({
      primaryServerUrl: 'http://127.0.0.1:59997',
      fallbackServerUrl: 'http://127.0.0.1:8080',
      rawPat: rawToken,
    });

    const { task } = engine.createTaskFromQuickCapture('Offline task queued for push');
    expect(engine.getOutboxMutations().length).toBe(1);

    // 1. Probe fails over from 59997 to 8080
    const probeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('http://127.0.0.1:59997')) {
        throw new Error('ECONNREFUSED');
      }
      expect((init?.headers as Record<string, string>)?.Authorization).toBe(`Bearer ${rawToken}`);
      return new Response(
        JSON.stringify({ authenticated: true, latest_server_seq: 5 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const probeRes = await probeAndVerifyUplink(engine, { fetchImpl: probeFetch });
    expect(probeRes.online).toBe(true);
    expect(probeRes.activeRole).toBe('FALLBACK');
    expect(probeRes.activeUrl).toBe('http://127.0.0.1:8080');

    // 2. Simulate HTTP 503 during push -> outbox must remain intact with incremented retry_count
    const failPushFetch = vi.fn(async () => new Response('Unavailable', { status: 503 }));
    const failedSync = await runDeltaSync(engine, { fetchImpl: failPushFetch });
    expect(failedSync.success).toBe(false);
    expect(engine.getOutboxMutations().length).toBe(1);
    expect(engine.getOutboxMutations()[0]!.retry_count).toBe(1);

    // 3. Simulate HTTP 200 push + pull with LWW update and delete tombstone
    const remoteTaskId = generateUuidV7();
    const okSyncFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/sync/push')) {
        return new Response(
          JSON.stringify({ applied_count: 1, conflicts_resolved: 0, server_seq: 6 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          changes: [
            {
              server_seq: 7,
              entity_table: 'tasks',
              entity_id: remoteTaskId,
              op: 'upsert',
              payload: {
                id: remoteTaskId,
                title: 'Server Hydrated Task',
                status: 'todo',
                priority: 'high',
                updated_at: '2026-11-14T20:00:00Z',
              },
              changed_at: '2026-11-14T20:00:00Z',
            },
            {
              server_seq: 8,
              entity_table: 'tasks',
              entity_id: task.id,
              op: 'delete',
              payload: {
                id: task.id,
                deleted_at: '2099-01-01T00:00:00Z',
                updated_at: '2099-01-01T00:00:00Z',
              },
              changed_at: '2099-01-01T00:00:00Z',
            },
          ],
          latest_server_seq: 8,
          has_more: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const okSync = await runDeltaSync(engine, { fetchImpl: okSyncFetch });
    expect(okSync.success).toBe(true);
    expect(okSync.pushedCount).toBe(1);
    expect(okSync.pulledCount).toBe(2);
    expect(engine.getOutboxMutations().length).toBe(0);
    expect(engine.getUplinkConfig().last_server_seq).toBe(8);
    expect(engine.getTask(remoteTaskId)?.title).toBe('Server Hydrated Task');
    expect(engine.listTasks().find((t) => t.id === task.id)).toBeUndefined();
  });

  // =========================================================================
  // F35: Dual-Mode Frieren Companion (Offline Loops/Quotes vs Online SSE Chat)
  // =========================================================================

  it('[F35] renders Offline Mode on COMPANION with 6 animation loops, non-repeating quotes, and zero chat HTTP calls', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    try {
      render(<App />);
      await waitFor(() => {
        expect(screen.getByTestId('hermes-mobile-shell').getAttribute('data-db-ready')).toBe(
          'true',
        );
      });

      fireEvent.click(screen.getByTestId('mobile-tab-companion'));

      expect(screen.getByTestId('companion-mobile-offline')).toBeTruthy();
      expect(screen.getByTestId('companion-offline-banner').textContent).toContain(
        'OFFLINE_MODE',
      );
      expect(screen.queryByTestId('companion-online-chat')).toBeNull();

      const bubble = screen.getByTestId('companion-offline-speech-bubble');
      const initialQuote = bubble.textContent;

      // Cycle animation and quote
      fireEvent.click(screen.getByTestId('companion-cycle-anim-btn'));
      expect(screen.getByTestId('companion-active-loop-badge').textContent).toContain(
        'idle_breeze',
      );

      fireEvent.click(screen.getByTestId('companion-next-quote-btn'));
      expect(bubble.textContent).not.toBe(initialQuote);

      // Add a custom offline phrase
      const input = screen.getByTestId('companion-add-phrase-input');
      fireEvent.change(input, {
        target: { value: 'Field grimoires sync when you return to camp.' },
      });
      fireEvent.click(screen.getByTestId('companion-add-phrase-btn'));
      expect(screen.getByTestId('companion-custom-phrases-list').textContent).toContain(
        'Field grimoires sync when you return to camp.',
      );

      // Zero HTTP requests made in offline mode
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('[F35] streams Online SSE chat with X-Hermes-Session-Key and executes [Undo] and [Approve]/[Reject] MCP actions', async () => {
    const ssePayload = [
      'event: thinking\ndata: {"type":"thinking","content":"Inspecting today tasks...","gateway_mode":"offline_mock"}',
      'event: undo_available\ndata: {"type":"undo_available","undo_id":"undo-101","tool_name":"todos_complete_task","summary":"Completed top task"}',
      'event: approval_required\ndata: {"type":"approval_required","approval_id":"app-202","tool_name":"todos_delete_task","summary":"Delete archived task","payload_json":{"id":"t1"}}',
      'event: token\ndata: {"type":"token","delta":"Here is your ","content":"Here is your "}',
      'event: done\ndata: {"type":"done","message":"Here is your field briefing.","gateway_mode":"offline_mock"}',
      '',
    ].join('\n\n');

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/hermes/chat/stream')) {
        const headers = init?.headers as Record<string, string>;
        expect(headers['X-Hermes-Session-Key']).toBe('mobile-companion-main');
        return new Response(ssePayload, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const streamRes = await streamCompanionChat({
      activeUrl: 'http://127.0.0.1:8080',
      decryptedPat: 'plm_pat_test',
      sessionKey: 'mobile-companion-main',
      message: 'Brief me',
      fetchImpl: mockFetch,
    });

    expect(streamRes.finalMessage).toBe('Here is your field briefing.');
    expect(streamRes.thinkingText).toBe('Inspecting today tasks...');
    expect(streamRes.gatewayMode).toBe('offline_mock');
    expect(streamRes.undoActions[0]?.undoId).toBe('undo-101');
    expect(streamRes.pendingApprovals[0]?.id).toBe('app-202');

    const undoOk = await executeMcpUndo({
      activeUrl: 'http://127.0.0.1:8080',
      decryptedPat: 'plm_pat_test',
      undoId: 'undo-101',
      fetchImpl: mockFetch,
    });
    expect(undoOk).toBe(true);

    const approveOk = await executeMcpApproval({
      activeUrl: 'http://127.0.0.1:8080',
      decryptedPat: 'plm_pat_test',
      approvalId: 'app-202',
      decision: 'approve',
      payloadJson: { id: 't1' },
      fetchImpl: mockFetch,
    });
    expect(approveOk).toBe(true);
  });
});
