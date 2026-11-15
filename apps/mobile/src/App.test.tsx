import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALLOWED_MOBILE_SURFACES, App } from './App';
import { parseTodoQuickCapture } from './db/nlpParser';
import { decryptPat, encryptPat, maskPatPrefix, parsePairingQrPayload } from './db/patCrypto';
import {
  ALL_MOBILE_SQLITE_TABLES,
  compareIsoTimestamps,
  MobileSqliteEngine,
} from './db/sqliteEngine';
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
    const cipherOtherClient = encryptPat(rawToken, 'client-02');
    expect(cipher).toMatch(/^enc:v1:[0-9a-f]+$/);
    expect(cipher).not.toBe(cipherOtherClient);
    expect(cipher.slice(0, 16)).not.toBe(cipherOtherClient.slice(0, 16));
    expect(cipher).not.toContain('plm_pat_');
    expect(cipher).not.toContain('99887766');
    expect(decryptPat(cipher, 'client-01')).toBe(rawToken);
    expect(decryptPat(cipherOtherClient, 'client-02')).toBe(rawToken);

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
    expect(probeRes.latestServerSeq).toBe(5);
    // probeAndVerifyUplink MUST NOT advance uplink_config.last_server_seq before pulling
    expect(engine.getUplinkConfig().last_server_seq).toBe(0);

    // 2. Simulate HTTP 503 during push -> outbox must remain intact with incremented retry_count
    const failPushFetch = vi.fn(async () => new Response('Unavailable', { status: 503 }));
    const failedSync = await runDeltaSync(engine, { fetchImpl: failPushFetch });
    expect(failedSync.success).toBe(false);
    expect(engine.getOutboxMutations().length).toBe(1);
    expect(engine.getOutboxMutations()[0]!.retry_count).toBe(1);

    // 3. Simulate HTTP 200 push + stateful pull filtering server_seq > since (starting from since=0)
    const remoteTaskId = generateUuidV7();
    const serverLog: Array<{
      server_seq: number;
      entity_table: string;
      entity_id: string;
      op: 'upsert' | 'delete';
      payload: Record<string, unknown>;
      changed_at: string;
    }> = [
      {
        server_seq: 4,
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
        server_seq: 7,
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
    ];
    const okSyncFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/sync/push')) {
        return new Response(
          JSON.stringify({ applied_count: 1, conflicts_resolved: 0, server_seq: 6 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const parsedUrl = new URL(url);
      const since = Number(parsedUrl.searchParams.get('since') ?? 0);
      const matching = serverLog.filter((entry) => entry.server_seq > since);
      return new Response(
        JSON.stringify({
          changes: matching,
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
        const reqBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        expect(reqBody.origin).toBe('frieren_popover');
        expect((reqBody.page_context as Record<string, unknown>)?.selected_entity_id).toBe(
          'entity-42',
        );
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
      entityIds: ['entity-42'],
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

  // =========================================================================
  // Iteration 2 Adversarial & Backend-Contract Regression Suite
  // =========================================================================

  it('[F34] preserves strict UUIDv7 monotonicity across 5,000-ID same-ms bursts and negative clock jitter', () => {
    const baseMs = Date.now() + 100_000;
    const burstIds = Array.from({ length: 5000 }, () => generateUuidV7(baseMs));
    expect(new Set(burstIds).size).toBe(5000);
    for (let i = 0; i < burstIds.length; i += 1) {
      expect(isValidUuidV7(burstIds[i]!)).toBe(true);
      if (i > 0) {
        expect(burstIds[i - 1]! < burstIds[i]!).toBe(true);
      }
    }

    // Negative clock jitter (-1ms, -5ms, 0ms) must never regress lexicographical order
    const jitterStartMs = Date.now() + 200_000;
    const id1 = generateUuidV7(jitterStartMs);
    const id2 = generateUuidV7(jitterStartMs - 1);
    const id3 = generateUuidV7(jitterStartMs - 5);
    const id4 = generateUuidV7(jitterStartMs);
    expect(id1 < id2).toBe(true);
    expect(id2 < id3).toBe(true);
    expect(id3 < id4).toBe(true);
  });

  it('[F34] enforces PRAGMA foreign_keys = ON, rejects orphan child writes, defaults quick-capture project_id to null, and enqueues ancestor FK chains with parsed JSON objects', async () => {
    const engine = await MobileSqliteEngine.create({ fresh: true });
    expect(engine.isForeignKeysEnabled()).toBe(true);
    expect(engine.listTableNames().length).toBe(10);
    expect(engine.getOutboxMutations().length).toBe(0);

    // 1. Reject orphan child inserts cleanly
    expect(() =>
      engine.createRoutineItem({
        routineId: '01932a00-dead-7000-8000-000000009999',
        title: 'Orphan Habit',
      }),
    ).toThrow(/Parent routine not found/);
    expect(() =>
      engine.toggleRoutineItemLog('01932a00-dead-7000-8000-000000009999', '2026-11-14'),
    ).toThrow(/Parent routine_item not found/);
    expect(() =>
      engine.startFocusTimer({ taskId: '01932a00-dead-7000-8000-000000009999' }),
    ).toThrow(/Task not found/);
    expect(() =>
      engine.createTaskFromQuickCapture('Orphan project task', '2026-11-14', {
        projectId: '01932a00-dead-7000-8000-000000009999',
      }),
    ).toThrow(/Project not found/);

    // 2. Quick capture without +project keeps project_id === null (1 outbox row, zero FK poison)
    const { task: standaloneTask } = engine.createTaskFromQuickCapture('Buy lithium cells');
    expect(standaloneTask.project_id).toBeNull();
    expect(engine.getOutboxMutations().length).toBe(1);
    expect(engine.getOutboxMutations()[0]!.entity_table).toBe('tasks');
    engine.acknowledgeOutboxMutations(
      engine.getOutboxMutations().map((m) => m.mutation_id),
      1,
    );
    expect(engine.getOutboxMutations().length).toBe(0);

    // 3. Logging a starter routine habit enqueues routines -> routine_items (parsed JSON frequency_config) -> routine_logs
    const morningStacks = engine.listRoutineStacks('workday', '2026-11-14');
    const firstHabit = morningStacks[0]!.items[0]!;
    const secondHabit = morningStacks[0]!.items[1]!;
    engine.toggleRoutineItemLog(firstHabit.id, '2026-11-14');
    engine.toggleRoutineItemLog(secondHabit.id, '2026-11-14');

    const routineOutbox = engine.getOutboxMutations();
    expect(routineOutbox.map((m) => m.entity_table)).toEqual([
      'routines',
      'routine_items',
      'routine_items',
      'routine_logs',
      'routine_logs',
    ]);
    expect(typeof routineOutbox[0]!.payload.active).toBe('boolean');
    const itemPayload = routineOutbox[1]!.payload;
    expect(typeof itemPayload.frequency_config).toBe('object');
    expect(itemPayload.frequency_config).not.toBeNull();
    expect(typeof itemPayload.frequency_config).not.toBe('string');

    // Acknowledge batch -> subsequent toggle on firstHabit only enqueues routine_logs!
    engine.acknowledgeOutboxMutations(
      routineOutbox.map((m) => m.mutation_id),
      10,
    );
    engine.toggleRoutineItemLog(firstHabit.id, '2026-11-14');
    const postAckOutbox = engine.getOutboxMutations();
    expect(postAckOutbox.map((m) => m.entity_table)).toEqual(['routine_logs']);
    engine.acknowledgeOutboxMutations(
      postAckOutbox.map((m) => m.mutation_id),
      11,
    );

    // 4. Timing a starter task (0611 -> project 0601) enqueues projects -> tasks (array tags/blocked_by) -> time_sessions
    const starterTask = engine.getTask('01932a00-0000-7000-8000-000000000611')!;
    expect(starterTask.project_id).toBe('01932a00-0000-7000-8000-000000000601');
    engine.startFocusTimer({ taskId: starterTask.id, timerMode: 'stopwatch' });
    engine.stopFocusTimer(120);

    const timerOutbox = engine.getOutboxMutations();
    expect(timerOutbox.map((m) => m.entity_table)).toEqual([
      'projects',
      'tasks',
      'time_sessions',
    ]);
    expect(Array.isArray(timerOutbox[1]!.payload.tags)).toBe(true);
    expect(Array.isArray(timerOutbox[1]!.payload.blocked_by_task_ids)).toBe(true);
    engine.acknowledgeOutboxMutations(
      timerOutbox.map((m) => m.mutation_id),
      20,
    );

    // 5. Public projects & routines CRUD
    const createdProj = engine.createProject({ name: 'Hardware Lab', area: 'systems' });
    expect(engine.getProject(createdProj.id)?.name).toBe('Hardware Lab');
    expect(engine.deleteProject(createdProj.id)).toBe(true);
    expect(engine.listProjects().some((p) => p.id === createdProj.id)).toBe(false);

    const createdRoutine = engine.createRoutine({
      name: 'Travel Mobility',
      timeSlot: 'morning',
      dayProfile: 'travel',
    });
    expect(engine.getRoutine(createdRoutine.id)?.name).toBe('Travel Mobility');
    expect(engine.deleteRoutine(createdRoutine.id)).toBe(true);
    expect(engine.listRoutines().some((r) => r.id === createdRoutine.id)).toBe(false);
  });

  it('[F34] automatically fails over from Primary (502/network) to Fallback in runDeltaSync and paginates multi-page has_more /api/sync/pull responses', async () => {
    const engine = await MobileSqliteEngine.create({ fresh: true });
    engine.saveUplinkConfig({
      primaryServerUrl: 'http://192.168.1.42:8080',
      fallbackServerUrl: 'http://100.64.0.10:8080',
      rawPat: 'plm_pat_failover_token_1234567890',
    });

    const { task: localTask } = engine.createTaskFromQuickCapture('Sync across Tailscale fallback');
    const calledUrls: string[] = [];
    const page1TaskId = generateUuidV7();
    const page2TaskId = generateUuidV7();

    const failoverAndPaginatedFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calledUrls.push(url);

      // Primary returns 502 Bad Gateway
      if (url.startsWith('http://192.168.1.42:8080')) {
        return new Response(JSON.stringify({ error: 'bad_gateway' }), { status: 502 });
      }

      if (url === 'http://100.64.0.10:8080/api/sync/push') {
        return new Response(
          JSON.stringify({ applied_count: 1, conflicts_resolved: 0, server_seq: 1 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url === 'http://100.64.0.10:8080/api/sync/pull?since=0') {
        return new Response(
          JSON.stringify({
            changes: [
              {
                server_seq: 2,
                entity_table: 'tasks',
                entity_id: page1TaskId,
                op: 'upsert',
                payload: {
                  id: page1TaskId,
                  title: 'Paginated Task Page 1',
                  status: 'todo',
                  priority: 'medium',
                  updated_at: '2026-11-14T20:00:00Z',
                },
              },
            ],
            next_seq: 2,
            latest_server_seq: 3,
            has_more: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url === 'http://100.64.0.10:8080/api/sync/pull?since=2') {
        return new Response(
          JSON.stringify({
            changes: [
              {
                server_seq: 3,
                entity_table: 'tasks',
                entity_id: page2TaskId,
                op: 'upsert',
                payload: {
                  id: page2TaskId,
                  title: 'Paginated Task Page 2',
                  status: 'todo',
                  priority: 'high',
                  updated_at: '2026-11-14T20:01:00Z',
                },
              },
            ],
            next_seq: 3,
            latest_server_seq: 3,
            has_more: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('Not Found', { status: 404 });
    });

    const res = await runDeltaSync(engine, { fetchImpl: failoverAndPaginatedFetch });
    expect(res.success).toBe(true);
    expect(res.activeUrl).toBe('http://100.64.0.10:8080');
    expect(res.pushedCount).toBe(1);
    expect(res.pulledCount).toBe(2);
    expect(res.latestServerSeq).toBe(3);
    expect(calledUrls).toEqual([
      'http://192.168.1.42:8080/api/sync/push',
      'http://100.64.0.10:8080/api/sync/push',
      'http://100.64.0.10:8080/api/sync/pull?since=0',
      'http://100.64.0.10:8080/api/sync/pull?since=2',
    ]);
    expect(engine.getTask(localTask.id)).toBeTruthy();
    expect(engine.getTask(page1TaskId)?.title).toBe('Paginated Task Page 1');
    expect(engine.getTask(page2TaskId)?.title).toBe('Paginated Task Page 2');
    expect(engine.getUplinkConfig().active_server_url).toBe('http://100.64.0.10:8080');
    expect(engine.getUplinkConfig().last_server_seq).toBe(3);
  });

  it('[F34] resolves cross-format RFC 3339 LWW (.950Z vs Z and +00:00), preserves focus duration on auto-stop, computes consecutive streaks, validates NLP calendar/tokens, and normalizes DB constraints', async () => {
    // 1. Epoch + nanosecond RFC 3339 comparator
    expect(compareIsoTimestamps('2026-11-14T20:15:30.950Z', '2026-11-14T20:15:30Z')).toBeGreaterThan(
      0,
    );
    expect(
      compareIsoTimestamps('2026-11-14T20:15:30.100500+00:00', '2026-11-14T20:15:30.100Z'),
    ).toBeGreaterThan(0);

    const engine = await MobileSqliteEngine.create({ fresh: true });
    const { task: lwwTask } = engine.createTaskFromQuickCapture('Newer Local Subsecond Task');
    // Force local timestamp to .950Z and pull a stale whole-second .000 'Z' row
    const applied = engine.applyPulledChanges(
      [
        {
          server_seq: 5,
          entity_table: 'tasks',
          entity_id: lwwTask.id,
          op: 'upsert',
          payload: {
            id: lwwTask.id,
            title: 'Stale Whole-Second Server Clobber Attempt',
            status: 'todo',
            priority: 'low',
            updated_at: '2020-01-01T00:00:00Z',
          },
          changed_at: '2020-01-01T00:00:00Z',
        },
      ],
      5,
    );
    expect(applied).toBe(0);
    expect(engine.getTask(lwwTask.id)?.title).toBe('Newer Local Subsecond Task');

    // Also test exact same-second .950Z local vs whole-second Z server pull
    const subSecTaskId = generateUuidV7();
    engine.applyPulledChanges(
      [
        {
          server_seq: 6,
          entity_table: 'tasks',
          entity_id: subSecTaskId,
          op: 'upsert',
          payload: {
            id: subSecTaskId,
            title: 'Local 950ms Version',
            status: 'todo',
            priority: 'high',
            updated_at: '2026-11-14T20:15:30.950Z',
          },
        },
      ],
      6,
    );
    engine.applyPulledChanges(
      [
        {
          server_seq: 7,
          entity_table: 'tasks',
          entity_id: subSecTaskId,
          op: 'upsert',
          payload: {
            id: subSecTaskId,
            title: 'Stale 000ms Whole-Second Version',
            status: 'todo',
            priority: 'low',
            updated_at: '2026-11-14T20:15:30Z',
          },
        },
      ],
      7,
    );
    expect(engine.getTask(subSecTaskId)?.title).toBe('Local 950ms Version');

    // 2. Non-destructive startFocusTimer auto-stop rollup (25m = 1,500s)
    const { task: taskA } = engine.createTaskFromQuickCapture('Deep work Task A');
    const { task: taskB } = engine.createTaskFromQuickCapture('Switch to Task B');
    const twentyFiveMinAgoIso = new Date(Date.now() - 1500 * 1000).toISOString();
    const timerA = engine.startFocusTimer({
      taskId: taskA.id,
      timerMode: 'pomodoro_25_5',
      startedAtIso: twentyFiveMinAgoIso,
    });
    engine.startFocusTimer({ taskId: taskB.id, timerMode: 'stopwatch' });
    const closedTimerA = engine.listTimeSessions().find((s) => s.id === timerA.id)!;
    expect(closedTimerA.duration_seconds).toBeGreaterThanOrEqual(1499);
    expect(closedTimerA.duration_seconds).toBeLessThanOrEqual(1505);
    expect(engine.getTask(taskA.id)?.actual_seconds).toBe(closedTimerA.duration_seconds);
    engine.stopFocusTimer();

    // 3. Consecutive habit streaks (breaks to 0 on skipped/missing days)
    const habitId = engine.listRoutineStacks('workday', '2026-11-14')[0]!.items[0]!.id;
    engine.toggleRoutineItemLog(habitId, '2026-01-01', 'completed');
    engine.toggleRoutineItemLog(habitId, '2026-11-13', 'skipped');
    const afterSkippedYesterday = engine
      .listRoutineStacks('workday', '2026-11-14')[0]!
      .items.find((i) => i.id === habitId)!;
    expect(afterSkippedYesterday.streakDays).toBe(0);

    engine.toggleRoutineItemLog(habitId, '2026-11-12', 'completed');
    engine.toggleRoutineItemLog(habitId, '2026-11-13', 'completed');
    const unloggedTodayWith2DayRun = engine
      .listRoutineStacks('workday', '2026-11-14')[0]!
      .items.find((i) => i.id === habitId)!;
    expect(unloggedTodayWith2DayRun.streakDays).toBe(2);

    engine.toggleRoutineItemLog(habitId, '2026-11-14', 'completed');
    const completedToday3DayRun = engine
      .listRoutineStacks('workday', '2026-11-14')[0]!
      .items.find((i) => i.id === habitId)!;
    expect(completedToday3DayRun.streakDays).toBe(3);

    // 4. NLP calendar validation & token parity
    const invalidCalendar = parseTodoQuickCapture('Submit tax filing 2026-99-99 2026-02-30');
    expect(invalidCalendar.scheduledDate).toBeNull();
    const compoundAndAliases = parseTodoQuickCapture(
      'Ship kernel patch @deep_focus, !critical; 1h30m. 2026-11-20,',
      '2026-11-14',
    );
    expect(compoundAndAliases.energyLevel).toBe('deep');
    expect(compoundAndAliases.tags).not.toContain('deep_focus');
    expect(compoundAndAliases.priority).toBe('urgent');
    expect(compoundAndAliases.estimatedMinutes).toBe(90);
    expect(compoundAndAliases.scheduledDate).toBe('2026-11-20');
    expect(parseTodoQuickCapture('Quick ping @quick-win 999999h').energyLevel).toBe('quick');
    expect(parseTodoQuickCapture('Quick ping @quick-win 999999h').estimatedMinutes).toBe(1440);
    expect(parseTodoQuickCapture('Archive receipts @low-energy').energyLevel).toBe('shallow');

    // 5. PostgreSQL constraint normalization & sleep_hours clamping
    const normalizedPhrase = engine.createOfflinePhrase({
      phraseText: 'Evening mana recovery complete.',
      triggerContext: 'evening_reflection',
      animationHint: 'read_grimoire',
    });
    expect(normalizedPhrase.trigger_context).toBe('any');
    expect(normalizedPhrase.animation_hint).toBe('grimoire');

    const clampedCheckin = engine.upsertDailyCheckin({
      logDate: '2026-11-14',
      energyScore: 99,
      moodScore: -3,
      sleepHours: 36.789,
      highlight: 'Clamped pulse',
    });
    expect(clampedCheckin.energy_score).toBe(5);
    expect(clampedCheckin.mood_score).toBe(1);
    expect(clampedCheckin.sleep_hours).toBe(24);
  });

  it('[F33][F34][F35] hydrates persisted SQLite state into RoutinesSurface and UplinkConfigSurface across reloads, renders Frieren ledge motivation on ROUTINES/TODOS, and triggers online range sync', async () => {
    // Seed persisted SQLite state prior to mounting <App />
    const seedEngine = await MobileSqliteEngine.create({ fresh: true });
    seedEngine.upsertDailyCheckin({
      energyScore: 5,
      moodScore: 3,
      sleepHours: 8.25,
      highlight: 'Persisted Offline Field Highlight',
    });
    seedEngine.saveUplinkConfig({
      primaryServerUrl: 'http://192.168.1.77:8080',
      fallbackServerUrl: 'http://100.64.0.99:8080',
      rawPat: 'plm_pat_range_watcher_secret_token',
    });

    const rangeFetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/verify')) {
        return new Response(
          JSON.stringify({ authenticated: true, latest_server_seq: 1 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/sync/push')) {
        return new Response(
          JSON.stringify({ applied_count: 1, conflicts_resolved: 0, server_seq: 2 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/sync/pull')) {
        return new Response(
          JSON.stringify({ changes: [], next_seq: 2, latest_server_seq: 2, has_more: false }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', rangeFetchSpy);

    try {
      render(<App />);
      await waitFor(() => {
        expect(screen.getByTestId('hermes-mobile-shell').getAttribute('data-db-ready')).toBe(
          'true',
        );
      });

      // 1. RoutinesSurface hydrates persisted daily_checkins values across reload
      await waitFor(() => {
        expect(
          (screen.getByTestId('checkin-highlight-input') as HTMLInputElement).value,
        ).toBe('Persisted Offline Field Highlight');
        expect((screen.getByTestId('checkin-sleep-input') as HTMLInputElement).value).toBe('8.25');
      });

      // 2. Offline Frieren ledge + motivation strip is present on ROUTINES and updates quote on habit toggle
      expect(screen.getByTestId('mobile-frieren-ledge')).toBeTruthy();
      const initialFieldQuote = screen.getByTestId('mobile-field-motivation-quote').textContent;
      fireEvent.click(
        screen.getByTestId('routine-item-toggle-01932a00-0000-7000-8000-000000000711'),
      );
      expect(screen.getByTestId('mobile-field-motivation-quote').textContent).not.toBe(
        initialFieldQuote,
      );

      // 3. TODOS also renders Frieren ledge strip
      fireEvent.click(screen.getByTestId('mobile-tab-todos'));
      expect(screen.getByTestId('mobile-frieren-ledge')).toBeTruthy();

      // 4. UplinkConfigSurface hydrates persisted URLs, keeps 3-input DOM order, and keeps patInput empty
      fireEvent.click(screen.getByTestId('mobile-tab-uplink_config'));
      const inputs = Array.from(document.querySelectorAll('input'));
      expect(inputs[0]?.getAttribute('data-testid')).toBe('uplink-primary-url-input');
      expect(inputs[1]?.getAttribute('data-testid')).toBe('uplink-fallback-url-input');
      expect(inputs[2]?.getAttribute('data-testid')).toBe('uplink-pat-input');
      expect((inputs[0] as HTMLInputElement).value).toBe('http://192.168.1.77:8080');
      expect((inputs[1] as HTMLInputElement).value).toBe('http://100.64.0.99:8080');
      expect((inputs[2] as HTMLInputElement).value).toBe('');

      // 5. Window 'online' range event triggers probeAndVerifyUplink + runDeltaSync
      expect(rangeFetchSpy).not.toHaveBeenCalled();
      fireEvent.online(window);
      await waitFor(() => {
        expect(rangeFetchSpy).toHaveBeenCalled();
        expect(screen.getByTestId('mobile-header-uplink-badge').textContent).toContain(
          'ONLINE // SYNCED',
        );
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // =========================================================================
  // Iteration 3 Stateful Sync Watermark, Natural-Key LWW/Tombstone & DAG Suite
  // =========================================================================

  it('[F34] preserves pre-pull last_server_seq across probeAndVerifyUplink (latest_server_seq: 42), UI TEST UPLINK, and window online range reconnect to hydrate pre-existing server tasks', async () => {
    // Part A: Direct probeAndVerifyUplink (latest_server_seq: 42) -> runDeltaSync queries ?since=0
    const engine = await MobileSqliteEngine.create({ fresh: true });
    engine.saveUplinkConfig({
      primaryServerUrl: 'http://127.0.0.1:8080',
      rawPat: 'plm_pat_iter3_cursor_guard_token',
    });

    const preExistingId1 = generateUuidV7();
    const preExistingId2 = generateUuidV7();
    const pullUrlsA: string[] = [];

    const statefulOracleA = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/auth/verify')) {
        return new Response(
          JSON.stringify({
            authenticated: true,
            auth_type: 'pat',
            token_name: 'Cursor Guard PAT',
            latest_server_seq: 42,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/sync/pull')) {
        pullUrlsA.push(url);
        const since = Number(new URL(url).searchParams.get('since') ?? 0);
        const serverChanges = [
          {
            server_seq: 41,
            entity_table: 'tasks',
            entity_id: preExistingId1,
            op: 'upsert' as const,
            payload: {
              id: preExistingId1,
              title: 'Bootstrap Desktop Task 41',
              status: 'todo',
              priority: 'high',
              updated_at: '2026-11-14T19:00:00Z',
            },
            changed_at: '2026-11-14T19:00:00Z',
          },
          {
            server_seq: 42,
            entity_table: 'tasks',
            entity_id: preExistingId2,
            op: 'upsert' as const,
            payload: {
              id: preExistingId2,
              title: 'Bootstrap Desktop Task 42',
              status: 'in_progress',
              priority: 'urgent',
              updated_at: '2026-11-14T19:05:00Z',
            },
            changed_at: '2026-11-14T19:05:00Z',
          },
        ].filter((c) => c.server_seq > since);

        return new Response(
          JSON.stringify({
            changes: serverChanges,
            next_seq: 42,
            latest_server_seq: 42,
            has_more: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not Found', { status: 404 });
    });

    const probe = await probeAndVerifyUplink(engine, { fetchImpl: statefulOracleA });
    expect(probe.online).toBe(true);
    expect(probe.latestServerSeq).toBe(42);
    expect(engine.getUplinkConfig().last_server_seq).toBe(0);

    const delta = await runDeltaSync(engine, { fetchImpl: statefulOracleA });
    expect(delta.success).toBe(true);
    expect(pullUrlsA).toEqual(['http://127.0.0.1:8080/api/sync/pull?since=0']);
    expect(delta.pulledCount).toBe(2);
    expect(engine.getUplinkConfig().last_server_seq).toBe(42);
    expect(engine.getTask(preExistingId1)?.title).toBe('Bootstrap Desktop Task 41');
    expect(engine.getTask(preExistingId2)?.title).toBe('Bootstrap Desktop Task 42');

    // Part B: Full <App /> UI pairing via ⚡ TEST UPLINK + window 'online' range reconnect hydrating TodosSurface
    localStorage.clear();
    const uiBootstrapTaskId = generateUuidV7();
    const uiRangeTaskId = generateUuidV7();
    const uiServerLog: Array<{
      server_seq: number;
      entity_table: string;
      entity_id: string;
      op: 'upsert';
      payload: Record<string, unknown>;
      changed_at: string;
    }> = [
      {
        server_seq: 1,
        entity_table: 'tasks',
        entity_id: uiBootstrapTaskId,
        op: 'upsert',
        payload: {
          id: uiBootstrapTaskId,
          title: 'UI Paired Bootstrap Server Task',
          status: 'todo',
          priority: 'high',
          updated_at: '2026-11-14T20:00:00Z',
        },
        changed_at: '2026-11-14T20:00:00Z',
      },
    ];
    const uiPullUrls: string[] = [];

    const uiOracleFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const maxSeq = uiServerLog.reduce((acc, item) => Math.max(acc, item.server_seq), 0);
      if (url.endsWith('/api/auth/verify')) {
        return new Response(
          JSON.stringify({
            authenticated: true,
            auth_type: 'pat',
            token_name: 'UI Pairing PAT',
            latest_server_seq: maxSeq,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/sync/pull')) {
        uiPullUrls.push(url);
        const since = Number(new URL(url).searchParams.get('since') ?? 0);
        const filtered = uiServerLog.filter((item) => item.server_seq > since);
        return new Response(
          JSON.stringify({
            changes: filtered,
            next_seq: maxSeq,
            latest_server_seq: maxSeq,
            has_more: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', uiOracleFetch);

    try {
      render(<App />);
      await waitFor(() => {
        expect(screen.getByTestId('hermes-mobile-shell').getAttribute('data-db-ready')).toBe(
          'true',
        );
      });

      fireEvent.click(screen.getByTestId('mobile-tab-uplink_config'));
      const inputs = Array.from(document.querySelectorAll('input'));
      fireEvent.change(inputs[0]!, { target: { value: 'http://127.0.0.1:8080' } });
      fireEvent.change(inputs[2]!, { target: { value: 'plm_pat_ui_pairing_123456' } });
      fireEvent.click(screen.getByTestId('uplink-test-btn'));

      await waitFor(() => {
        expect(uiPullUrls).toContain('http://127.0.0.1:8080/api/sync/pull?since=0');
      });

      fireEvent.click(screen.getByTestId('mobile-tab-todos'));
      await waitFor(() => {
        expect(screen.getByTestId('hermes-mobile-shell').textContent).toContain(
          'UI Paired Bootstrap Server Task',
        );
      });

      // Server receives seq=2 while mobile briefly goes offline then returns to Wi-Fi range
      fireEvent.offline(window);
      uiServerLog.push({
        server_seq: 2,
        entity_table: 'tasks',
        entity_id: uiRangeTaskId,
        op: 'upsert',
        payload: {
          id: uiRangeTaskId,
          title: 'UI Range Reconnect Server Task',
          status: 'todo',
          priority: 'urgent',
          updated_at: '2026-11-14T20:10:00Z',
        },
        changed_at: '2026-11-14T20:10:00Z',
      });
      fireEvent.online(window);

      await waitFor(() => {
        expect(uiPullUrls).toContain('http://127.0.0.1:8080/api/sync/pull?since=1');
        expect(screen.getByTestId('hermes-mobile-shell').textContent).toContain(
          'UI Range Reconnect Server Task',
        );
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('[F34] pulls from pre-push cursor (?since=10) when sync_outbox pushes server_seq=13/14 so concurrent Web tasks 11..12 and server LWW winner are hydrated', async () => {
    const engine = await MobileSqliteEngine.create({ fresh: true });
    engine.saveUplinkConfig({
      primaryServerUrl: 'http://127.0.0.1:8080',
      rawPat: 'plm_pat_concurrent_push_pull_token',
    });

    // Seed shared task at seq=10
    const sharedTaskId = generateUuidV7();
    engine.applyPulledChanges(
      [
        {
          server_seq: 10,
          entity_table: 'tasks',
          entity_id: sharedTaskId,
          op: 'upsert',
          payload: {
            id: sharedTaskId,
            title: 'Shared Task Initial v1',
            status: 'todo',
            priority: 'medium',
            updated_at: '2026-11-14T18:00:00Z',
          },
          changed_at: '2026-11-14T18:00:00Z',
        },
      ],
      10,
    );
    expect(engine.getUplinkConfig().last_server_seq).toBe(10);

    // Offline Mobile captures a new task
    const { task: mobileOfflineTask } = engine.createTaskFromQuickCapture(
      'Mobile Commuter Offline Capture',
    );
    expect(engine.getOutboxMutations().length).toBe(1);

    const webTask11Id = generateUuidV7();
    const webTask12Id = generateUuidV7();
    const pullUrls: string[] = [];
    let failFirstPull = true;

    const concurrentOracle = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/sync/push')) {
        return new Response(
          JSON.stringify({
            applied_count: 1,
            conflicts_resolved: 0,
            server_seq: 13,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/sync/pull')) {
        pullUrls.push(url);
        if (failFirstPull) {
          failFirstPull = false;
          return new Response('Temporary pull outage', { status: 503 });
        }
        const since = Number(new URL(url).searchParams.get('since') ?? 0);
        const serverLog = [
          {
            server_seq: 11,
            entity_table: 'tasks',
            entity_id: webTask11Id,
            op: 'upsert' as const,
            payload: {
              id: webTask11Id,
              title: 'Concurrent Web Task 11',
              status: 'todo',
              priority: 'high',
              updated_at: '2026-11-14T19:01:00Z',
            },
            changed_at: '2026-11-14T19:01:00Z',
          },
          {
            server_seq: 12,
            entity_table: 'tasks',
            entity_id: webTask12Id,
            op: 'upsert' as const,
            payload: {
              id: webTask12Id,
              title: 'Concurrent Web Task 12',
              status: 'in_progress',
              priority: 'urgent',
              updated_at: '2026-11-14T19:02:00Z',
            },
            changed_at: '2026-11-14T19:02:00Z',
          },
          {
            server_seq: 12,
            entity_table: 'tasks',
            entity_id: sharedTaskId,
            op: 'upsert' as const,
            payload: {
              id: sharedTaskId,
              title: 'Shared Task — WEB_LWW_WINNER',
              status: 'done',
              priority: 'urgent',
              updated_at: '2099-01-01T00:00:00Z',
            },
            changed_at: '2099-01-01T00:00:00Z',
          },
          {
            server_seq: 13,
            entity_table: 'tasks',
            entity_id: mobileOfflineTask.id,
            op: 'upsert' as const,
            payload: {
              id: mobileOfflineTask.id,
              title: mobileOfflineTask.title,
              status: mobileOfflineTask.status,
              priority: mobileOfflineTask.priority,
              updated_at: mobileOfflineTask.updated_at,
            },
            changed_at: mobileOfflineTask.updated_at,
          },
        ].filter((c) => c.server_seq > since);

        return new Response(
          JSON.stringify({
            changes: serverLog,
            next_seq: 13,
            latest_server_seq: 13,
            has_more: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('Not Found', { status: 404 });
    });

    // Attempt 1: Push succeeds (seq=13), Step 2 pull fails (503) -> last_server_seq MUST stay 10!
    const interrupted = await runDeltaSync(engine, { fetchImpl: concurrentOracle });
    expect(interrupted.success).toBe(false);
    expect(engine.getOutboxMutations().length).toBe(0);
    expect(engine.getUplinkConfig().last_server_seq).toBe(10);
    expect(pullUrls).toEqual(['http://127.0.0.1:8080/api/sync/pull?since=10']);

    // Attempt 2: Pull resumes from ?since=10 and hydrates 11..12 + server LWW winner!
    const recovered = await runDeltaSync(engine, { fetchImpl: concurrentOracle });
    expect(recovered.success).toBe(true);
    expect(pullUrls).toEqual([
      'http://127.0.0.1:8080/api/sync/pull?since=10',
      'http://127.0.0.1:8080/api/sync/pull?since=10',
    ]);
    expect(engine.getUplinkConfig().last_server_seq).toBe(13);
    expect(engine.getTask(webTask11Id)?.title).toBe('Concurrent Web Task 11');
    expect(engine.getTask(webTask12Id)?.title).toBe('Concurrent Web Task 12');
    expect(engine.getTask(sharedTaskId)?.title).toBe('Shared Task — WEB_LWW_WINNER');
    expect(engine.getTask(mobileOfflineTask.id)?.title).toBe('Mobile Commuter Offline Capture');
  });

  it('[F34] enforces natural-key LWW, canonical id adoption, and server delete tombstones on routine_logs (routine_item_id, log_date) and daily_checkins (checkin_date)', async () => {
    const engine = await MobileSqliteEngine.create({ fresh: true });
    const habitItem = engine.listRoutineStacks('workday', '2026-11-14')[0]!.items[0]!;

    // 1. Local offline habit completion with UUID_MOB
    const localLog = engine.toggleRoutineItemLog(habitItem.id, '2026-11-14', 'completed');
    expect(localLog.status).toBe('completed');

    // Stale Web log with distinct UUID_WEB_STALE MUST NOT clobber newer local 'completed' row
    const staleWebLogId = generateUuidV7();
    const staleApplied = engine.applyPulledChanges(
      [
        {
          server_seq: 1,
          entity_table: 'routine_logs',
          entity_id: staleWebLogId,
          op: 'upsert',
          payload: {
            id: staleWebLogId,
            routine_item_id: habitItem.id,
            log_date: '2026-11-14',
            status: 'skipped',
            notes: 'stale-web-log',
            updated_at: '2020-01-01T00:00:00Z',
          },
          changed_at: '2020-01-01T00:00:00Z',
        },
      ],
      1,
    );
    expect(staleApplied).toBe(0);
    const afterStale = engine
      .listRoutineStacks('workday', '2026-11-14')[0]!
      .items.find((i) => i.id === habitItem.id)!.todayLog;
    expect(afterStale?.status).toBe('completed');
    expect(afterStale?.id).toBe(localLog.id);

    // 2. Newer Web log with distinct UUID_WEB_WIN wins LWW AND adopts canonical id = UUID_WEB_WIN
    const newerWebLogId = generateUuidV7();
    const winApplied = engine.applyPulledChanges(
      [
        {
          server_seq: 2,
          entity_table: 'routine_logs',
          entity_id: newerWebLogId,
          op: 'upsert',
          payload: {
            id: newerWebLogId,
            routine_item_id: habitItem.id,
            log_date: '2026-11-14',
            status: 'partial',
            notes: 'newer-web-winner',
            updated_at: '2099-01-01T00:00:00Z',
          },
          changed_at: '2099-01-01T00:00:00Z',
        },
      ],
      2,
    );
    expect(winApplied).toBe(1);
    const afterWin = engine
      .listRoutineStacks('workday', '2026-11-14')[0]!
      .items.find((i) => i.id === habitItem.id)!.todayLog;
    expect(afterWin?.status).toBe('partial');
    expect(afterWin?.id).toBe(newerWebLogId);

    // 3. Subsequent server op: 'delete' tombstone for UUID_WEB_WIN (without natural key in payload) deletes cleanly!
    const delApplied = engine.applyPulledChanges(
      [
        {
          server_seq: 3,
          entity_table: 'routine_logs',
          entity_id: newerWebLogId,
          op: 'delete',
          payload: {
            id: newerWebLogId,
            deleted_at: '2099-01-02T00:00:00Z',
          },
          changed_at: '2099-01-02T00:00:00Z',
        },
      ],
      3,
    );
    expect(delApplied).toBe(1);
    const afterDelete = engine
      .listRoutineStacks('workday', '2026-11-14')[0]!
      .items.find((i) => i.id === habitItem.id)!.todayLog;
    expect(afterDelete).toBeNull();

    // 4. daily_checkins natural-key (checkin_date / log_date) LWW, canonical id adoption, and tombstone deletion
    engine.upsertDailyCheckin({
      logDate: '2026-11-14',
      energyScore: 5,
      moodScore: 5,
      sleepHours: 8,
      highlight: 'Local Newer Checkin',
    });

    const staleCheckinUuid = generateUuidV7();
    const staleCheckinApplied = engine.applyPulledChanges(
      [
        {
          server_seq: 4,
          entity_table: 'daily_checkins',
          entity_id: staleCheckinUuid,
          op: 'upsert',
          payload: {
            id: staleCheckinUuid,
            checkin_date: '2026-11-14',
            energy_score: 1,
            mood_score: 1,
            sleep_hours: 4,
            highlight: 'Stale Web Checkin',
            updated_at: '2020-01-01T00:00:00Z',
          },
          changed_at: '2020-01-01T00:00:00Z',
        },
      ],
      4,
    );
    expect(staleCheckinApplied).toBe(0);
    expect(engine.getDailyCheckin('2026-11-14')?.highlight).toBe('Local Newer Checkin');

    const winningCheckinUuid = generateUuidV7();
    const winCheckinApplied = engine.applyPulledChanges(
      [
        {
          server_seq: 5,
          entity_table: 'daily_checkins',
          entity_id: winningCheckinUuid,
          op: 'upsert',
          payload: {
            id: winningCheckinUuid,
            checkin_date: '2026-11-14',
            energy_score: 4,
            mood_score: 4,
            sleep_hours: 7.5,
            highlight: 'Canonical Web Checkin Winner',
            updated_at: '2099-01-01T00:00:00Z',
          },
          changed_at: '2099-01-01T00:00:00Z',
        },
      ],
      5,
    );
    expect(winCheckinApplied).toBe(1);
    expect(engine.getDailyCheckin('2026-11-14')?.highlight).toBe('Canonical Web Checkin Winner');

    const delCheckinApplied = engine.applyPulledChanges(
      [
        {
          server_seq: 6,
          entity_table: 'daily_checkins',
          entity_id: winningCheckinUuid,
          op: 'delete',
          payload: {
            id: winningCheckinUuid,
            deleted_at: '2099-01-02T00:00:00Z',
          },
          changed_at: '2099-01-02T00:00:00Z',
        },
      ],
      6,
    );
    expect(delCheckinApplied).toBe(1);
    expect(engine.getDailyCheckin('2026-11-14')).toBeNull();
  });

  it('[F34][F35] topologically sorts [Child, Unrelated, Parent] tasks in getOutboxMutations and guards malformed JSON in executeMcpApproval', async () => {
    const engine = await MobileSqliteEngine.create({ fresh: true });

    // Seed synced Parent & Child tasks on the client, then enqueue [Child (_seq=1), Unrelated (_seq=2), Parent (_seq=3)]
    const parentId = generateUuidV7();
    const childId = generateUuidV7();
    engine.applyPulledChanges(
      [
        {
          server_seq: 1,
          entity_table: 'tasks',
          entity_id: parentId,
          op: 'upsert',
          payload: {
            id: parentId,
            title: 'Parent Task',
            status: 'todo',
            priority: 'high',
            parent_task_id: null,
            updated_at: '2026-11-14T18:00:00Z',
          },
        },
        {
          server_seq: 2,
          entity_table: 'tasks',
          entity_id: childId,
          op: 'upsert',
          payload: {
            id: childId,
            title: 'Child Subtask',
            status: 'todo',
            priority: 'medium',
            parent_task_id: parentId,
            updated_at: '2026-11-14T18:01:00Z',
          },
        },
      ],
      2,
    );

    // Enqueue in adversarial order: Child (_seq=1), Unrelated (_seq=2), Parent (_seq=3)
    engine.toggleTaskCompletion(childId);
    const { task: unrelatedTask } = engine.createTaskFromQuickCapture('Unrelated Middle Task');
    engine.toggleTaskCompletion(parentId);

    const ordered = engine.getOutboxMutations();
    expect(ordered.length).toBe(3);
    const parentIdx = ordered.findIndex((m) => m.entity_id === parentId);
    const childIdx = ordered.findIndex((m) => m.entity_id === childId);
    const unrelatedIdx = ordered.findIndex((m) => m.entity_id === unrelatedTask.id);
    expect(parentIdx).toBeGreaterThanOrEqual(0);
    expect(childIdx).toBeGreaterThan(parentIdx);
    expect(unrelatedIdx).toBe(0);

    // Multi-level subtask chain created directly via parentTaskId
    engine.acknowledgeOutboxMutations(ordered.map((m) => m.mutation_id));
    const { task: rootTask } = engine.createTaskFromQuickCapture('Root Epic');
    const { task: midTask } = engine.createTaskFromQuickCapture('Mid Task', '2026-11-14', {
      parentTaskId: rootTask.id,
    });
    const { task: leafTask } = engine.createTaskFromQuickCapture('Leaf Subtask', '2026-11-14', {
      parentTaskId: midTask.id,
    });
    const chainOrdered = engine.getOutboxMutations();
    expect(chainOrdered.map((m) => m.entity_id)).toEqual([rootTask.id, midTask.id, leafTask.id]);

    // Malformed payloadJson in executeMcpApproval returns false cleanly without throwing
    const neverCalledFetch = vi.fn();
    await expect(
      executeMcpApproval({
        activeUrl: 'http://127.0.0.1:8080',
        decryptedPat: 'plm_pat_test',
        approvalId: 'approval-malformed-1',
        decision: 'approve',
        payloadJson: '{not-valid-json',
        fetchImpl: neverCalledFetch,
      }),
    ).resolves.toBe(false);
    expect(neverCalledFetch).not.toHaveBeenCalled();
  });

  it('adv_mobile_decryptPat_corrupted_envelopes_and_qr_nested_payload_and_nlp_bounds', () => {
    expect(decryptPat('')).toBe('');
    expect(decryptPat('enc:v1:not-valid-hex!!!')).toBe('');
    expect(decryptPat('enc:v1:abc')).toBe('');
    const validCipher = encryptPat('plm_pat_mobile_secret', 'device-a');
    expect(decryptPat(validCipher, 'device-a')).toBe('plm_pat_mobile_secret');
    expect(maskPatPrefix('plm_pat_abcd1234')).toBe('PAT // ABCD••••');

    const nestedQr = parsePairingQrPayload(
      JSON.stringify({
        qr_payload_json: JSON.stringify({
          primary_url: 'http://100.64.0.10:8080',
          fallback_url: 'http://192.168.1.50:8080',
          pat: 'plm_pat_qr_nested',
          token_name: 'Pixel-9-Pro',
        }),
      }),
    );
    expect(nestedQr).toEqual({
      primaryUrl: 'http://100.64.0.10:8080',
      fallbackUrl: 'http://192.168.1.50:8080',
      token: 'plm_pat_qr_nested',
      tokenName: 'Pixel-9-Pro',
    });
    expect(parsePairingQrPayload('not-json')).toBeNull();

    const parsedNlp = parseTodoQuickCapture(
      'Review mobile sync 1h30m in 5 days #mobile !p1 @deep_focus',
      '2026-11-15',
    );
    expect(parsedNlp.valid).toBe(true);
    expect(parsedNlp.estimatedMinutes).toBe(90);
    expect(parsedNlp.scheduledDate).toBe('2026-11-20');
    expect(parsedNlp.priority).toBe('urgent');
    expect(parsedNlp.energyLevel).toBe('deep');
    expect(parsedNlp.tags).toEqual(['mobile']);
  });
});
