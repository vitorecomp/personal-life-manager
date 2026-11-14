import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import {
  apiPatch,
  parseQuickCaptureFallback,
  streamHermesChat,
  toRfc3339DueDate,
  UUID_RE,
} from './api/client';
import { WidgetRenderer } from './components/monitor/WidgetRenderer';
import { useAppStore } from './store/appStore';

describe('HERMES // OS Web SPA — Sub-Milestone M4A (F23, F24, F27)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    HTMLFormElement.prototype.requestSubmit = function (submitter?: HTMLElement) {
      this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      void submitter;
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      drawImage: vi.fn(),
      fillText: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    useAppStore.setState({
      activeSessionKey: 'hermes-primary-session',
      quickCaptureOpen: false,
      authModalOpen: false,
      companionOpen: false,
      activeDashboardId: null,
      selectedEntityId: null,
      selectedEntityLabel: null,
      isAssistantStreaming: false,
      bootDismissed: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
  });

  it('[F23] renders CSR shell with SystemApertureLogo, MicroAnimIcon, and navigates across all 9 routes', async () => {
    render(<App initialPath="/dashboard" />);

    expect(screen.getByTestId('hermes-web-shell')).toBeTruthy();
    expect(screen.getByText('HERMES // OS')).toBeTruthy();
    expect(document.querySelector('[data-fui="system-aperture-logo"]')).toBeTruthy();
    expect(document.querySelector('[data-fui="micro-anim-icon"]')).toBeTruthy();

    // Navigate across routes via header links without full reload
    const routesToCheck = [
      { label: 'todos', testId: 'todos-page' },
      { label: 'routines', testId: 'routines-page' },
      { label: 'goals', testId: 'goals-page' },
      { label: 'courses', testId: 'courses-page' },
      { label: 'finance', testId: 'finance-page' },
      { label: 'knights', testId: 'knights-page' },
      { label: 'hermes', testId: 'hermes-page' },
    ];

    for (const r of routesToCheck) {
      fireEvent.click(screen.getByTestId(`nav-link-${r.label}`));
      expect(await screen.findByTestId(r.testId)).toBeTruthy();
    }
  });

  it('[F23] renders REF-09 OrbitalBootScreen when bootDismissed is false and skips on Escape or button click', () => {
    useAppStore.setState({ bootDismissed: false });
    render(<App initialPath="/dashboard" />);

    expect(screen.getByTestId('boot-gate-overlay')).toBeTruthy();
    expect(screen.getByTestId('boot-stage-label').textContent).toContain('[1 // DB_ONLINE]');

    fireEvent.click(screen.getByTestId('boot-skip-btn'));
    expect(screen.queryByTestId('boot-gate-overlay')).toBeNull();
    expect(window.sessionStorage.getItem('hermes-boot-complete')).toBe('true');
  });

  it('[F23] parses Quick Capture NLP tokens into valid Rust TaskEnergyLevel/TaskPriority enums, preserves @mentions, deduplicates #tags, and emits RFC3339 due_at', () => {
    const parsedDeep = parseQuickCaptureFallback(
      'Finish Raft consensus lab #courses #courses @deep_work !high tomorrow 1h30m',
    );
    expect(parsedDeep.clean_title).toBe('Finish Raft consensus lab');
    expect(parsedDeep.tags).toEqual(['courses']);
    expect(parsedDeep.energy_level).toBe('deep');
    expect(parsedDeep.priority).toBe('high');
    expect(parsedDeep.estimated_minutes).toBe(90);
    expect(parsedDeep.scheduled_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parsedDeep.due_at).toBe(`${parsedDeep.scheduled_date}T23:59:59Z`);

    const parsedShallow = parseQuickCaptureFallback(
      'Sync with @alice on deployment #ops, #ops; @shallow !p1 2026-12-01 15m',
    );
    expect(parsedShallow.clean_title).toBe('Sync with @alice on deployment');
    expect(parsedShallow.tags).toEqual(['ops']);
    expect(parsedShallow.energy_level).toBe('shallow');
    expect(parsedShallow.priority).toBe('urgent');
    expect(parsedShallow.scheduled_date).toBe('2026-12-01');
    expect(parsedShallow.due_at).toBe('2026-12-01T23:59:59Z');
    expect(parsedShallow.estimated_minutes).toBe(15);

    const parsedQuick = parseQuickCaptureFallback('Pay utility bill @quick !p4 in 3 days');
    expect(parsedQuick.energy_level).toBe('quick');
    expect(parsedQuick.priority).toBe('low');
    expect(parsedQuick.due_at).toMatch(/^\d{4}-\d{2}-\d{2}T23:59:59Z$/);

    const parsedNextWeek = parseQuickCaptureFallback('Review quarterly OKRs @low_energy next week');
    expect(parsedNextWeek.energy_level).toBe('shallow');
    expect(parsedNextWeek.due_at).toMatch(/^\d{4}-\d{2}-\d{2}T23:59:59Z$/);
  });

  it('[F23] opens Cmd+K QuickCaptureModal, rejects blank input, dismisses on Escape, and submits valid Rust DTO in offline fallback mode', async () => {
    let submittedTaskBody: Record<string, any> | null = null;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/tasks/parse')) {
        return new Response(JSON.stringify({ error: 'parse offline' }), { status: 503 });
      }
      if (url.includes('/api/tasks') && init?.method === 'POST') {
        submittedTaskBody = JSON.parse(String(init.body || '{}'));
        return new Response(JSON.stringify({ id: 'task-1', title: submittedTaskBody?.title }), {
          status: 201,
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(<App initialPath="/dashboard" />);

    // Open via Ctrl+K
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByTestId('quick-capture-modal')).toBeTruthy();

    // Reject blank submission client-side
    fireEvent.click(screen.getByTestId('quick-capture-submit'));
    expect(screen.getByTestId('quick-capture-error')).toBeTruthy();

    // Dismiss on Escape without creating a task
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('quick-capture-modal')).toBeNull();

    // Reopen via header button and submit valid task using local fallback NLP
    fireEvent.click(screen.getByTestId('quick-capture-trigger'));
    const input = screen.getByTestId('quick-capture-input');
    fireEvent.change(input, {
      target: { value: 'Follow up with @alice #ops #ops @shallow !p1 2026-12-01 1h30m' },
    });

    expect(screen.getByTestId('quick-capture-tokens').textContent).toContain('#ops');
    fireEvent.click(screen.getByTestId('quick-capture-submit'));

    await waitFor(() => {
      expect(screen.queryByTestId('quick-capture-modal')).toBeNull();
    });
    expect(fetchSpy).toHaveBeenCalled();
    expect(submittedTaskBody).toBeTruthy();
    expect(submittedTaskBody!.title).toBe('Follow up with @alice');
    expect(submittedTaskBody!.energy_level).toBe('shallow');
    expect(submittedTaskBody!.priority).toBe('urgent');
    expect(submittedTaskBody!.tags).toEqual(['ops']);
    expect(submittedTaskBody!.estimated_minutes).toBe(90);
    expect(submittedTaskBody!.due_date).toBe('2026-12-01T23:59:59Z');
    expect(submittedTaskBody!.due_at).toBe('2026-12-01T23:59:59Z');
  });

  it('[F23] toggles global Privacy Mask to redact live API BRL/USD currency while preserving percentages and durations', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/finance/allocation')) {
        return new Response(
          JSON.stringify({
            base_currency: 'BRL',
            total_brl_cents: 14250000,
            total_usd_cents: 2840000,
            fx_usd_brl: '5.01',
            waffle_tiles: [
              ...Array.from({ length: 120 }, (_, i) => ({
                tile_index: i,
                symbol: 'WEGE3',
                asset_class: 'br_equity',
              })),
              ...Array.from({ length: 80 }, (_, i) => ({
                tile_index: 120 + i,
                symbol: 'VOO',
                asset_class: 'us_etf',
              })),
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/api/finance/retirement')) {
        return new Response(
          JSON.stringify({
            current_net_worth_brl_cents: 14250000,
            fi_target_brl_cents: 22200000,
            fi_progress_pct: 64.2,
            passive_income_coverage_pct: 15.8,
            months_to_fi: 88,
            years_to_fi: 7.33,
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(<App initialPath="/finance" />);

    expect(await screen.findByText('R$ 142.500,00')).toBeTruthy();
    expect(screen.getByText('$ 28,400.00')).toBeTruthy();
    expect(screen.getAllByText('64.2%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('7Y 4M').length).toBeGreaterThan(0);

    const toggle = screen.getByTestId('fui-privacy-toggle');
    fireEvent.click(toggle);

    expect(window.localStorage.getItem('hermes-fui-privacy-mask')).toBe('true');
    expect(screen.getAllByText('R$ ••••••').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$ ••••••').length).toBeGreaterThan(0);
    // Non-currency percentages and durations remain unmasked
    expect(screen.getAllByText('64.2%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('7Y 4M').length).toBeGreaterThan(0);
  });

  it('[F23] displays ActiveTimerBar active task title, supports 25/5, 50/10, 90/15 Pomodoro presets, and clears immediately on discard', async () => {
    let running = true;
    let startedPayload: Record<string, any> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/time/timer/discard') && init?.method === 'POST') {
        running = false;
        return new Response(JSON.stringify({ discarded: true }), { status: 200 });
      }
      if (url.includes('/api/time/timer/start') && init?.method === 'POST') {
        startedPayload = JSON.parse(String(init.body || '{}'));
        running = true;
        return new Response(JSON.stringify({ running: true }), { status: 200 });
      }
      if (url.includes('/api/time/timer')) {
        return new Response(
          JSON.stringify(
            running
              ? {
                  running: true,
                  elapsed_seconds: 125,
                  session: {
                    id: 'sess-1',
                    task_id: 'task-focus-1',
                    timer_mode: startedPayload?.timer_mode ?? 'pomodoro_25_5',
                    work_minutes: startedPayload?.work_minutes ?? 25,
                  },
                }
              : { running: false, session: null, elapsed_seconds: 0 },
          ),
          { status: 200 },
        );
      }
      if (url.includes('/api/tasks')) {
        return new Response(
          JSON.stringify([
            { id: 'task-focus-1', title: 'Audit Kernel Memory Map', status: 'in_progress' },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(<App initialPath="/dashboard" />);

    expect(await screen.findByTestId('active-timer-task-title')).toBeTruthy();
    expect(screen.getByTestId('active-timer-task-title').textContent).toBe(
      'Audit Kernel Memory Map',
    );
    expect(screen.getByTestId('active-timer-clock').textContent).toBe('02:05');

    fireEvent.click(screen.getByTestId('timer-discard-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('active-timer-task-title')).toBeNull();
    });

    // Select 90/15 preset and start Pomodoro
    const presetSelect = screen.getByTestId('timer-pomodoro-preset') as HTMLSelectElement;
    expect(Array.from(presetSelect.options).map((o) => o.value)).toEqual([
      'pomodoro_25_5',
      'pomodoro_50_10',
      'pomodoro_90_15',
    ]);
    fireEvent.change(presetSelect, { target: { value: 'pomodoro_90_15' } });
    fireEvent.click(screen.getByTestId('timer-start-pomodoro-btn'));

    await waitFor(() => {
      expect(startedPayload).toEqual({
        timer_mode: 'pomodoro_90_15',
        work_minutes: 90,
        break_minutes: 15,
      });
    });
  });

  it('[F23] opens AuthSettingsModal, validates PAT name, mints PAT, dismisses on Escape, and clears one-time PAT secret on reopen', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/auth/tokens') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            id: 'pat-123',
            name: 'Workstation CLI',
            token: 'plm_pat_1234567890abcdef1234567890abcdef',
            token_prefix: 'plm_pat_1234',
            scopes: ['read', 'write', 'mcp'],
            created_at: new Date().toISOString(),
          }),
          { status: 201 },
        );
      }
      if (url.includes('/api/auth/pairing-qr')) {
        return new Response(
          JSON.stringify({
            primary_url: 'http://127.0.0.1:8080',
            fallback_url: 'http://100.64.0.1:8080',
            token: 'plm_pat_qrsecret',
            token_name: 'Mobile Companion',
            qr_payload_json: '{"version":1,"primary_url":"http://127.0.0.1:8080"}',
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(<App initialPath="/dashboard" />);
    fireEvent.click(screen.getByTestId('auth-settings-trigger'));
    expect(screen.getByTestId('auth-settings-modal')).toBeTruthy();

    // Empty PAT name rejected
    fireEvent.click(screen.getByTestId('mint-pat-btn'));
    expect(screen.getByTestId('pat-error-banner')).toBeTruthy();

    // Mint valid PAT
    fireEvent.change(screen.getByTestId('pat-name-input'), {
      target: { value: 'Workstation CLI' },
    });
    fireEvent.click(screen.getByTestId('mint-pat-btn'));

    expect(await screen.findByTestId('minted-pat-value')).toBeTruthy();
    expect(screen.getByTestId('minted-pat-value').textContent).toContain('plm_pat_');

    // Generate Pairing QR
    fireEvent.click(screen.getByTestId('generate-pairing-qr-btn'));
    expect(await screen.findByTestId('pairing-qr-code')).toBeTruthy();

    // Dismiss via Escape key
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('auth-settings-modal')).toBeNull();

    // Reopen and verify one-time minted PAT & QR secrets were cleared
    fireEvent.click(screen.getByTestId('auth-settings-trigger'));
    expect(screen.getByTestId('auth-settings-modal')).toBeTruthy();
    expect(screen.queryByTestId('minted-pat-value')).toBeNull();
    expect(screen.queryByTestId('pairing-qr-code')).toBeNull();
  });

  it('[F24] renders /dashboard starter decks, switches tabs, and surfaces SQL guardrail error on forbidden query', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/widgets') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ error: 'Read-only SQL guardrail: api_tokens is forbidden' }),
          { status: 403 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(<App initialPath="/dashboard" />);

    expect(screen.getByTestId('deck-tab-tactical-ops')).toBeTruthy();
    expect(screen.getByTestId('deck-tab-wealth-fire')).toBeTruthy();
    expect(screen.getByTestId('deck-tab-strategy-lore')).toBeTruthy();
    expect(screen.getByTestId('deck-tab-infra-knights')).toBeTruthy();

    // Switch to WEALTH deck
    fireEvent.click(screen.getByTestId('deck-tab-wealth-fire'));
    expect(screen.getByText('PORTFOLIO_WAFFLE_&_TICKER')).toBeTruthy();

    // Open Add Widget modal and trigger SQL guardrail rejection
    fireEvent.click(screen.getByTestId('add-widget-btn'));
    expect(screen.getByTestId('add-widget-modal')).toBeTruthy();
    fireEvent.change(screen.getByTestId('widget-query-input'), {
      target: { value: 'SELECT * FROM api_tokens' },
    });
    fireEvent.click(screen.getByTestId('widget-submit-btn'));

    expect(await screen.findByTestId('widget-sql-guardrail-error')).toBeTruthy();
  });

  it('[F24] renders /monitor kiosk with 1px #F87C18 countdown hairline, ArrowRight/ArrowLeft deck jump, and Space pause/pin', () => {
    render(<App initialPath="/monitor" />);

    const hairline = screen.getByTestId('monitor-countdown-hairline');
    expect(hairline).toBeTruthy();
    expect(hairline.style.height).toBe('1px');

    const initialTitle = screen.getByTestId('monitor-active-deck-title').textContent;
    expect(initialTitle).toContain('TACTICAL_OPS');

    // Jump to next deck with ArrowRight
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const nextTitle = screen.getByTestId('monitor-active-deck-title').textContent;
    expect(nextTitle).not.toBe(initialTitle);

    // Jump back with ArrowLeft
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('monitor-active-deck-title').textContent).toBe(initialTitle);

    // Toggle Space pause/pin
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(screen.getByTestId('monitor-paused-badge').textContent).toContain('PAUSED // PINNED');
  });

  it('[F27] mounts Frieren on 3px #F87C18 ledge, toggles Cmd+J popover, injects page_context, and expands to /hermes', async () => {
    render(<App initialPath="/todos" />);

    expect(screen.getByTestId('companion-stage-ledge')).toBeTruthy();
    expect(document.querySelector('[data-companion-ledge="true"]')).toBeTruthy();
    expect(screen.getByTestId('companion-mini-sprite')).toBeTruthy();

    // Open popover via Ctrl+J
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    expect(screen.getByTestId('companion-stage-popover')).toBeTruthy();
    expect(screen.getByTestId('companion-page-context').textContent).toContain('CTX // /todos');

    // Close on Escape
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('companion-stage-popover')).toBeNull();

    // Reopen and click Expand in Full Hermes View
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    fireEvent.click(screen.getByTestId('companion-expand-hermes'));

    expect(await screen.findByTestId('hermes-page')).toBeTruthy();
  });

  it('[F24] binds all Room Monitor built-in widgets to live API data, auto-refreshes seeded empty widgets once, honors renderer_kind & grid_rect.{x,y}, and tolerates [null] arrays', async () => {
    let sqlRefreshCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/widgets/seeded-sql-1/refresh') && init?.method === 'POST') {
        sqlRefreshCalls += 1;
        return new Response(JSON.stringify({ error: 'temporary db busy' }), { status: 500 });
      }
      if (url.includes('/api/dashboards')) {
        return new Response(
          JSON.stringify([
            null,
            {
              id: 'live-deck-1',
              slug: 'live-ops',
              title: 'DECK_01 // LIVE_TELEMETRY',
              cycle_seconds: 60,
              in_rotation: true,
              sort_order: 1,
              layout_cols: 12,
              layout_rows: 8,
              widgets: [
                null,
                {
                  id: 'w-live-focus',
                  dashboard_id: 'live-deck-1',
                  title: 'FOCUS_PANEL',
                  source_kind: 'builtin',
                  renderer_kind: 'bar',
                  grid_rect: { x: 0, y: 0, w: 4, h: 4 },
                  source_config: { builtin_key: 'focus_barcode' },
                  last_refreshed_at: '2026-11-14T10:00:00Z',
                  cached_payload: { completed_tasks: 1, total_tasks: 2 },
                },
                {
                  id: 'w-live-surplus',
                  dashboard_id: 'live-deck-1',
                  title: 'MONTHLY_SURPLUS_PANEL',
                  source_kind: 'builtin',
                  renderer_kind: 'bar',
                  grid_rect: { x: 8, y: 0, w: 4, h: 4 },
                  source_config: { builtin_key: 'monthly_surplus' },
                  last_refreshed_at: '2026-11-14T10:00:00Z',
                  cached_payload: { total_brl_cents: 550000 },
                },
                {
                  id: 'w-live-knights',
                  dashboard_id: 'live-deck-1',
                  title: 'KNIGHTS_PANEL',
                  source_kind: 'builtin',
                  renderer_kind: 'custom_module',
                  grid_rect: { x: 0, y: 4, w: 4, h: 4 },
                  source_config: { builtin_key: 'knights_pulse' },
                  last_refreshed_at: '2026-11-14T10:00:00Z',
                  cached_payload: { enabled_knights: 1 },
                },
                {
                  id: 'seeded-sql-1',
                  dashboard_id: 'live-deck-1',
                  title: 'ACTIVE_DECK_TELEMETRY_SQL',
                  source_kind: 'sql',
                  renderer_kind: 'table',
                  grid_rect: { x: 4, y: 4, w: 4, h: 4 },
                  source_config: { query: 'SELECT 1 AS ok' },
                  last_refreshed_at: null,
                  cached_payload: {},
                },
                {
                  id: 'null-rows-sql-1',
                  dashboard_id: 'live-deck-1',
                  title: 'NULL_SAFE_SQL',
                  source_kind: 'sql',
                  renderer_kind: 'table',
                  grid_rect: { x: 8, y: 4, w: 4, h: 4 },
                  source_config: { query: 'SELECT 1' },
                  last_refreshed_at: '2026-11-14T10:00:00Z',
                  cached_payload: { rows: [null, { metric: 'SQL_ROW_OK', count: 7 }] },
                },
              ],
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes('/api/time/stats')) {
        return new Response(
          JSON.stringify({
            today_seconds: 5400,
            barcode_buckets_96: Array.from({ length: 96 }, (_, i) => (i < 6 ? 900 : 0)),
          }),
          { status: 200 },
        );
      }
      if (url.includes('/api/tasks')) {
        return new Response(
          JSON.stringify([
            { id: 't1', title: 'Done 1', status: 'done' },
            { id: 't2', title: 'Done 2', status: 'done' },
            { id: 't3', title: 'Todo 3', status: 'todo' },
          ]),
          { status: 200 },
        );
      }
      if (url.includes('/api/finance/monthly-plans')) {
        return new Response(
          JSON.stringify([
            {
              month: '2026-11',
              salary_income_cents: 2000000,
              planned_investment_cents: 600000,
              actual_invested_cents: 650000,
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes('/api/agents')) {
        return new Response(
          JSON.stringify([
            {
              id: 'agent-chronos',
              name: 'Sir Chronos',
              knight_archetype: 'paladin',
              enabled: true,
              hp_pct: 95,
              ep_pct: 40,
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(<App initialPath="/dashboard" />);

    expect(await screen.findByText('90M LOGGED')).toBeTruthy();
    expect(screen.getByText('TASKS COMPLETED: 2/3')).toBeTruthy();
    expect(screen.getAllByText('Sir Chronos').length).toBeGreaterThan(0);
    expect(screen.getByText('SQL_ROW_OK')).toBeTruthy();
    expect(document.querySelector('[data-fui="paired-hatch-bar-chart"]')).toBeTruthy();

    // Verify grid_rect.{x: 8, y: 0, w: 4, h: 4} places widget at column 9
    const surplusCard = screen.getByTestId('widget-card-w-live-surplus');
    expect(surplusCard.style.gridColumn).toBe('9 / span 4');
    expect(surplusCard.style.gridRow).toBe('1 / span 4');

    // Auto-refresh on unpopulated seeded widget fires at most once (no infinite loop on 500)
    await waitFor(() => {
      expect(sqlRefreshCalls).toBe(1);
    });

      // Verify all 7 renderer_kind modes produce distinct DOM structures on custom widgets
    const testQc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rendererKinds = [
      'kpi',
      'sparkline',
      'waffle',
      'bar',
      'table',
      'terminal',
      'custom_module',
    ] as const;
    const distinctVizTags = new Set<string>();
    for (const rk of rendererKinds) {
      const { container, unmount } = render(
        <QueryClientProvider client={testQc}>
          <WidgetRenderer
            deckId="d-custom"
            widget={{
              id: `w-rk-${rk}`,
              dashboard_id: 'd-custom',
              title: `HTTP_${rk.toUpperCase()}`,
              source_kind: 'http',
              renderer_kind: rk,
              grid_rect: { x: 0, y: 0, w: 4, h: 4 },
              cached_payload: {
                status: 200,
                extracted: { cpu_pct: 42, mem_pct: 58 },
              },
            }}
          />
        </QueryClientProvider>,
      );
      const vizEl = container.querySelector(`[data-custom-viz="${rk}"]`);
      expect(vizEl).toBeTruthy();
      distinctVizTags.add(`${rk}:${vizEl?.tagName}:${container.innerHTML.length}`);
      expect(container.querySelector('[data-testid="widget-http-value"]')?.textContent).toContain(
        '42',
      );
      unmount();
    }
    expect(distinctVizTags.size).toBe(7);

    // Also verify routines_bio, goals_blueprint, courses_momentum, and second_brain_constellation live bindings
    const { container: extraBuiltins, unmount: unmountExtra } = render(
      <QueryClientProvider client={testQc}>
        <div>
          <WidgetRenderer
            deckId="d-live"
            widget={{
              id: 'wb-r',
              dashboard_id: 'd-live',
              title: 'ROUTINES_LIVE',
              source_kind: 'builtin',
              renderer_kind: 'sparkline',
              source_config: { builtin_key: 'routines_bio' },
            }}
            liveTelemetry={{
              routines: [{ id: 'r1', day_profiles: ['weekend'] }],
              routineAnalytics: {
                consistency_score_pct: 91.4,
                streaks: [{ routine_item_id: 'ri-1', title: 'Read', current_streak: 21 }],
                matrix_8x12: Array.from({ length: 96 }, (_, i) => i % 2 === 0),
                heatmap_365d: [{ date: '2026-11-14', completed_count: 4, total_count: 4, completion_ratio: 1 }],
              },
            }}
          />
          <WidgetRenderer
            deckId="d-live"
            widget={{
              id: 'wb-g',
              dashboard_id: 'd-live',
              title: 'GOALS_LIVE',
              source_kind: 'builtin',
              renderer_kind: 'custom_module',
              source_config: { builtin_key: 'goals_blueprint' },
            }}
            liveTelemetry={{
              goals: [{ id: 'g1', title: 'Ship HERMES // OS', status: 'in_progress', progress_pct: 82 }],
            }}
          />
          <WidgetRenderer
            deckId="d-live"
            widget={{
              id: 'wb-c',
              dashboard_id: 'd-live',
              title: 'COURSES_LIVE',
              source_kind: 'builtin',
              renderer_kind: 'bar',
              source_config: { builtin_key: 'courses_momentum' },
            }}
            liveTelemetry={{
              courses: [{ id: 'c1', title: 'MIT 6.824', status: 'active', progress_pct: 75 }],
              dueReviews: [{ id: 'rev-1' }, { id: 'rev-2' }, { id: 'rev-3' }],
            }}
          />
          <WidgetRenderer
            deckId="d-live"
            widget={{
              id: 'wb-v',
              dashboard_id: 'd-live',
              title: 'VAULT_LIVE',
              source_kind: 'builtin',
              renderer_kind: 'custom_module',
              source_config: { builtin_key: 'second_brain_constellation' },
            }}
            liveTelemetry={{
              vaultNotes: [
                { path: 'Projects/hermes.md', title: 'Hermes', folder: 'Projects' },
                { path: 'Projects/fui.md', title: 'FUI', folder: 'Projects' },
              ],
            }}
          />
        </div>
      </QueryClientProvider>,
    );
    expect(extraBuiltins.textContent).toContain('PROFILE // WEEKEND');
    expect(extraBuiltins.textContent).toContain('91.4%');
    expect(extraBuiltins.textContent).toContain('21D');
    expect(extraBuiltins.textContent).toContain('82.0%');
    expect(extraBuiltins.textContent).toContain('SPACED REVIEWS DUE: 3');
    expect(extraBuiltins.textContent).toContain('VAULT NOTES: 2');
    unmountExtra();
  });

  it('[F24] advances /monitor auto-cycle by +1 (never +2) under <StrictMode> on 2-deck and 4-deck playlists and guards NaN cycle_seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let activeDeckPlaylist: any[] = [
      {
        id: 'd1',
        slug: 'alpha',
        title: 'ALPHA_DECK_ONE',
        cycle_seconds: 5,
        in_rotation: true,
        sort_order: 1,
        layout_cols: 12,
        layout_rows: 8,
        widgets: [],
      },
      {
        id: 'd2',
        slug: 'beta',
        title: 'BETA_DECK_TWO',
        cycle_seconds: 5,
        in_rotation: true,
        sort_order: 2,
        layout_cols: 12,
        layout_rows: 8,
        widgets: [],
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/dashboards')) {
        return new Response(JSON.stringify(activeDeckPlaylist), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    const firstRender = render(
      <React.StrictMode>
        <App initialPath="/monitor" />
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('monitor-active-deck-title').textContent).toBe('ALPHA_DECK_ONE');
    });
    // Inactive deck title must NOT appear in body text on /monitor
    expect(document.body.textContent).not.toContain('BETA_DECK_TWO');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByTestId('monitor-active-deck-title').textContent).toBe('BETA_DECK_TWO');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByTestId('monitor-active-deck-title').textContent).toBe('ALPHA_DECK_ONE');
    firstRender.unmount();

    // 4-deck StrictMode rotation + corrupt_nan cycle_seconds guard
    activeDeckPlaylist = [
      {
        id: 'f1',
        slug: 'd1',
        title: 'FOUR_DECK_01',
        cycle_seconds: 5,
        in_rotation: true,
        sort_order: 1,
        layout_cols: 12,
        layout_rows: 8,
        widgets: [],
      },
      {
        id: 'f2',
        slug: 'd2',
        title: 'FOUR_DECK_02',
        cycle_seconds: 5,
        in_rotation: true,
        sort_order: 2,
        layout_cols: 12,
        layout_rows: 8,
        widgets: [],
      },
      {
        id: 'f3',
        slug: 'd3',
        title: 'FOUR_DECK_03',
        cycle_seconds: 'corrupt_nan' as any,
        in_rotation: true,
        sort_order: 3,
        layout_cols: 12,
        layout_rows: 8,
        widgets: [],
      },
      {
        id: 'f4',
        slug: 'd4',
        title: 'FOUR_DECK_04',
        cycle_seconds: 5,
        in_rotation: true,
        sort_order: 4,
        layout_cols: 12,
        layout_rows: 8,
        widgets: [],
      },
    ];

    render(
      <React.StrictMode>
        <App initialPath="/monitor" />
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('monitor-active-deck-title').textContent).toBe('FOUR_DECK_01');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByTestId('monitor-active-deck-title').textContent).toBe('FOUR_DECK_02');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByTestId('monitor-active-deck-title').textContent).toBe('FOUR_DECK_03');
    // Corrupt NaN cycle_seconds falls back to 60s and maintains a valid percentage width
    expect(screen.getByTestId('monitor-countdown-hairline').style.width).toBe('100%');

    // Jump via numeric [04] button and exit monitor via F shortcut
    fireEvent.click(screen.getByTestId('monitor-jump-3'));
    expect(screen.getByTestId('monitor-active-deck-title').textContent).toBe('FOUR_DECK_04');

    fireEvent.keyDown(window, { key: 'f' });
    expect(await screen.findByTestId('room-monitor-dashboard')).toBeTruthy();
  });

  it('[F24] isolates approved command widgets from unrelated pending MCP approvals, renders target-deck MCP banner, flags HTTP 502/0 DEGRADED, and supports deck reorder & edit', async () => {
    let reorderedIds: string[] | null = null;
    let updatedDeckBody: Record<string, any> | null = null;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/dashboards/reorder') && init?.method === 'POST') {
        reorderedIds = JSON.parse(String(init.body || '{}')).dashboard_ids;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes('/api/dashboards/deck-a') && init?.method === 'PUT') {
        updatedDeckBody = JSON.parse(String(init.body || '{}'));
        return new Response(JSON.stringify({ id: 'deck-a', ...updatedDeckBody }), { status: 200 });
      }
      if (url.includes('/api/widgets/w-broken-http/refresh') && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'Upstream connection refused' }), {
          status: 502,
        });
      }
      if (url.includes('/api/dashboards')) {
        return new Response(
          JSON.stringify([
            {
              id: 'deck-a',
              slug: 'deck-alpha',
              title: 'DECK_ALPHA',
              cycle_seconds: 60,
              in_rotation: true,
              sort_order: 1,
              layout_cols: 12,
              layout_rows: 8,
              widgets: [
                {
                  id: 'w-approved-cmd',
                  dashboard_id: 'deck-a',
                  title: 'ALREADY_APPROVED_UPTIME',
                  source_kind: 'command',
                  renderer_kind: 'terminal',
                  grid_rect: { x: 0, y: 0, w: 4, h: 4 },
                  source_config: { command: 'uptime', approved: true },
                  last_refreshed_at: '2026-11-14T10:00:00Z',
                  cached_payload: { stdout: 'UPTIME_OK_12345', exit_code: 0 },
                },
                {
                  id: 'w-broken-http',
                  dashboard_id: 'deck-a',
                  title: 'BROKEN_NET_HTTP',
                  source_kind: 'http',
                  renderer_kind: 'kpi',
                  grid_rect: { x: 4, y: 0, w: 4, h: 4 },
                  source_config: { url: 'http://127.0.0.1:59999/dead' },
                  last_refreshed_at: null,
                  cached_payload: null,
                },
                {
                  id: 'w-zero-http',
                  dashboard_id: 'deck-a',
                  title: 'STATUS_ZERO_HTTP',
                  source_kind: 'http',
                  renderer_kind: 'kpi',
                  grid_rect: { x: 8, y: 0, w: 4, h: 4 },
                  source_config: {
                    url: 'http://127.0.0.1:8080/metrics',
                    json_pointer: '/nested/metric',
                  },
                  last_refreshed_at: '2026-11-14T10:00:00Z',
                  cached_payload: { status: 0, raw: { nested: { metric: 'EXTRACTED_PTR_99' } } },
                },
              ],
            },
            {
              id: 'deck-b',
              slug: 'deck-beta',
              title: 'DECK_BETA',
              cycle_seconds: 45,
              in_rotation: true,
              sort_order: 2,
              layout_cols: 12,
              layout_rows: 8,
              widgets: [],
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes('/api/mcp/approvals')) {
        return new Response(
          JSON.stringify([
            {
              id: 'approval-deck-b',
              tool_name: 'dashboards_configure_command_widget',
              status: 'pending',
              payload_json: {
                dashboard_id: 'deck-b',
                title: 'PROPOSED_CMD_ON_B',
                command: 'echo SECRET_ON_DECK_B',
              },
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(<App initialPath="/dashboard" />);

    // Approved command widget on Deck A keeps stdout and is NOT hijacked by Deck B's pending approval
    expect(await screen.findByTestId('widget-command-stdout')).toBeTruthy();
    expect(screen.getByTestId('widget-command-stdout').textContent).toBe('UPTIME_OK_12345');
    expect(screen.queryByTestId('widget-command-pending-approval')).toBeNull();
    expect(document.body.textContent).not.toContain('SECRET_ON_DECK_B');

    // HTTP 502 network error & status=0 both render DEGRADED // HTTP ERR (never HTTP 200)
    await waitFor(() => {
      const brokenCard = screen.getByTestId('widget-card-w-broken-http');
      expect(brokenCard.textContent).toContain('DEGRADED // HTTP ERR');
      expect(brokenCard.textContent).not.toContain('HTTP 200');
    });
    const zeroCard = screen.getByTestId('widget-card-w-zero-http');
    expect(zeroCard.textContent).toContain('DEGRADED // HTTP ERR');
    expect(zeroCard.textContent).toContain('EXTRACTED_PTR_99');

    // Reorder Deck A right -> ['deck-b', 'deck-a']
    fireEvent.click(screen.getByTestId('move-deck-right-btn'));
    await waitFor(() => {
      expect(reorderedIds).toEqual(['deck-b', 'deck-a']);
    });

    // Edit Deck A title & cycle_seconds
    fireEvent.click(screen.getByTestId('edit-deck-btn'));
    fireEvent.change(screen.getByTestId('edit-deck-title-input'), {
      target: { value: 'DECK_ALPHA_RENAMED' },
    });
    fireEvent.change(screen.getByTestId('edit-deck-cycle-input'), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByTestId('save-deck-edit-btn'));
    await waitFor(() => {
      expect(updatedDeckBody).toEqual({ title: 'DECK_ALPHA_RENAMED', cycle_seconds: 30 });
    });

    // Switch to Deck B and verify pending MCP dashboard approval banner renders
    fireEvent.click(screen.getByTestId('deck-tab-deck-beta'));
    expect(await screen.findByTestId('pending-mcp-dashboard-approvals')).toBeTruthy();
    expect(screen.getByText('PROPOSED_CMD_ON_B')).toBeTruthy();
    expect(screen.getByText('echo SECRET_ON_DECK_B')).toBeTruthy();
  });

  it('[F27] streams SSE tokens incrementally and losslessly (100, hello, code fences, Done.message), avoids duplicate chat turns or session leaks, clears undone [Undo] cards, and survives malformed URLs', async () => {
    expect(typeof apiPatch).toBe('function');

    // 1. Incremental ReadableStream test: tokens arrive BEFORE EOF and preserve repeated suffixes
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const liveTokensBeforeClose: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
      });
      return new Response(stream, { status: 200 });
    });

    const streamPromise = streamHermesChat(
      { sessionKey: 's-inc', message: 'Count to 100' },
      {
        onToken: (tok) => liveTokensBeforeClose.push(tok),
      },
    );

    await act(async () => {
      streamController.enqueue(
        encoder.encode(
          'event: token\ndata: {"type":"token","delta":"1","content":"1"}\n\n' +
            'event: token\ndata: {"type":"token","delta":"0","content":"10"}\n\n' +
            'event: token\ndata: {"type":"token","delta":"0","content":"100"}\n\n',
        ),
      );
      await Promise.resolve();
    });
    // Delivered live while stream is still open!
    expect(liveTokensBeforeClose.join('')).toBe('100');

    streamController.enqueue(
      encoder.encode(
        'event: token\ndata: {"type":"token","delta":" hel"}\n\n' +
          'event: token\ndata: {"type":"token","delta":"l"}\n\n' +
          'event: token\ndata: {"type":"token","delta":"o\\n"}\n\n' +
          'event: token\ndata: {"type":"token","delta":"\\n"}\n\n' +
          'event: token\ndata: {"type":"token","delta":"`"}\n\n' +
          'event: token\ndata: {"type":"token","delta":"`"}\n\n' +
          'event: token\ndata: {"type":"token","delta":"`"}\n\n',
      ),
    );
    streamController.close();

    const finalText = await streamPromise;
    expect(finalText).toBe('100 hello\n\n```');

    // 2. Done event with message and zero prior token events
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      return new Response(
        'event: done\ndata: {"type":"done","message":"Exact authoritative reply from HermesStreamEvent::Done"}\n\n',
        { status: 200 },
      );
    });
    const doneOnlyResult = await streamHermesChat({ sessionKey: 's-done', message: 'Status?' });
    expect(doneOnlyResult).toBe('Exact authoritative reply from HermesStreamEvent::Done');

    // 3. FrierenCompanionController non-duplication, session isolation, and McpUndoAction undone_at filter
    let persistedSession1Messages: any[] = [];
    let undoUndoneAt: string | null = null;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/hermes/chat/stream') && init?.method === 'POST') {
        persistedSession1Messages = [
          { id: 'm1', role: 'user', content: 'Audit my tasks' },
          { id: 'm2', role: 'assistant', content: '100% tasks nominal.' },
        ];
        return new Response(
          'event: thinking\ndata: {"type":"thinking","thinking":"Inspecting tasks..."}\n\n' +
            'event: token\ndata: {"type":"token","delta":"100% tasks nominal."}\n\n' +
            'event: done\ndata: {"type":"done","message":"100% tasks nominal."}\n\n',
          { status: 200 },
        );
      }
      if (url.includes('/api/hermes/sessions/hermes-primary-session')) {
        return new Response(
          JSON.stringify({
            session_key: 'hermes-primary-session',
            messages: persistedSession1Messages,
          }),
          { status: 200 },
        );
      }
      if (url.includes('/api/hermes/sessions/clean-session-2')) {
        return new Response(
          JSON.stringify({ session_key: 'clean-session-2', messages: [] }),
          { status: 200 },
        );
      }
      if (url.includes('/api/mcp/undo/undo-1') && init?.method === 'POST') {
        undoUndoneAt = new Date().toISOString();
        return new Response(JSON.stringify({ undone: true }), { status: 200 });
      }
      if (url.includes('/api/mcp/undo')) {
        return new Response(
          JSON.stringify([
            {
              id: 'undo-1',
              session_key: 'hermes-primary-session',
              tool_name: 'todos_create_task',
              entity_table: 'tasks',
              undone_at: undoUndoneAt,
              expires_at: new Date(Date.now() + 60_000).toISOString(),
            },
            {
              id: 'undo-expired',
              session_key: 'hermes-primary-session',
              tool_name: 'todos_create_task',
              entity_table: 'tasks',
              undone_at: null,
              expires_at: new Date(Date.now() - 60_000).toISOString(),
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    // Also verify malformed percent-encoded /dashboard/%E0%A4%A never throws URIError
    render(<App initialPath="/dashboard/%E0%A4%A" />);
    expect(screen.getByTestId('room-monitor-dashboard')).toBeTruthy();

    // Open Frieren popover via Ctrl+J
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    expect(await screen.findByTestId('companion-undo-undo-1')).toBeTruthy();
    // Expired undo action is filtered out
    expect(screen.queryByTestId('companion-undo-undo-expired')).toBeNull();

    // Click [Undo] -> sets undone_at -> card disappears
    const undoCard = screen.getByTestId('companion-undo-undo-1');
    fireEvent.click(within(undoCard).getByText('[Undo]'));
    await waitFor(() => {
      expect(screen.queryByTestId('companion-undo-undo-1')).toBeNull();
    });

    // Send 1 chat message -> verify exact 2 bubbles (no 2 -> 4 duplication)
    fireEvent.change(screen.getByLabelText('Message Frieren'), {
      target: { value: 'Audit my tasks' },
    });
    fireEvent.click(within(screen.getByTestId('companion-online-chat')).getByText('SEND'));

    await waitFor(() => {
      const msgBubbles = document.querySelectorAll('[data-testid^="companion-msg-"]');
      expect(msgBubbles.length).toBe(2);
    });

    // Switch session key -> both localStorage keys sync and Session 1 messages do NOT leak into Session 2
    act(() => {
      useAppStore.getState().setActiveSessionKey('clean-session-2');
    });
    expect(window.localStorage.getItem('hermes-active-session-key')).toBe('clean-session-2');
    expect(window.localStorage.getItem('hermes-session-key')).toBe('clean-session-2');

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="companion-msg-"]').length).toBe(0);
    });
  });

  it('[F24/F27] guards active_dashboard_id with UUID_RE across /dashboard -> /todos navigation and skips fallback deck detail fetches', async () => {
    const requestedUrls: string[] = [];
    let capturedChatStreamBody: Record<string, any> | null = null;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes('/api/hermes/chat/stream') && init?.method === 'POST') {
        capturedChatStreamBody = JSON.parse(String(init.body || '{}'));
        return new Response(
          'event: token\ndata: {"type":"token","delta":"Inbox triaged."}\n\n' +
            'event: done\ndata: {"type":"done","message":"Inbox triaged."}\n\n',
          { status: 200 },
        );
      }
      if (url === '/api/dashboards') {
        // Return empty array so FALLBACK_STARTER_DECKS ('deck-01-tactical-ops') is active on /dashboard
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(<App initialPath="/dashboard" />);
    expect(screen.getByTestId('room-monitor-dashboard')).toBeTruthy();

    // Non-UUID fallback deck ID must NOT be stored in Zustand or fetched via GET /api/dashboards/deck-01-tactical-ops
    expect(UUID_RE.test('deck-01-tactical-ops')).toBe(false);
    expect(useAppStore.getState().activeDashboardId).toBeNull();
    expect(
      requestedUrls.some((u) => u.includes('/api/dashboards/deck-01-tactical-ops')),
    ).toBe(false);

    // Navigate to /todos, open Cmd+J Frieren popover, and send a chat message
    fireEvent.click(screen.getByTestId('nav-link-todos'));
    expect(await screen.findByTestId('todos-page')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    expect(screen.getByTestId('companion-stage-popover')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Message Frieren'), {
      target: { value: 'Triage my inbox' },
    });
    fireEvent.click(within(screen.getByTestId('companion-online-chat')).getByText('SEND'));

    await waitFor(() => {
      expect(capturedChatStreamBody).toBeTruthy();
    });
    expect(capturedChatStreamBody!.page_context.active_route).toBe('/todos');
    expect(capturedChatStreamBody!.page_context.active_dashboard_id).toBeNull();

    // Direct streamHermesChat call also sanitizes non-UUID active_dashboard_id to null
    let directBody: Record<string, any> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_input, init) => {
      directBody = JSON.parse(String(init?.body || '{}'));
      return new Response('event: token\ndata: hello\n\nevent: token\ndata:  \n\nevent: token\ndata: world\n\n', {
        status: 200,
      });
    });
    const plainRes = await streamHermesChat({
      sessionKey: 's-sanitize',
      message: 'Ping',
      pageContext: {
        active_route: '/dashboard',
        active_dashboard_id: 'deck-01-tactical-ops',
      },
    });
    expect(directBody!.page_context.active_dashboard_id).toBeNull();
    expect(plainRes).toBe('hello world');
  });

  it('[F32/M4A] fetches /finance candles using asset UUID (assets[0].id) rather than ticker symbol', async () => {
    const assetUuid = '01932a00-0000-7000-8000-000000000901';
    const candleUrls: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/candles')) {
        candleUrls.push(url);
        return new Response(
          JSON.stringify([
            {
              timestamp: '2026-11-14T00:00:00Z',
              open_cents: 5200,
              high_cents: 5450,
              low_cents: 5150,
              close_cents: 5400,
              volume: 12000,
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes('/api/finance/assets')) {
        return new Response(
          JSON.stringify([
            {
              id: assetUuid,
              symbol: 'WEGE3',
              asset_class: 'br_equity',
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(<App initialPath="/finance" />);
    expect(await screen.findByTestId('finance-page')).toBeTruthy();

    await waitFor(() => {
      expect(candleUrls.length).toBeGreaterThan(0);
    });
    expect(candleUrls).toContain(`/api/finance/assets/${assetUuid}/candles`);
    expect(candleUrls.some((u) => u.includes('/WEGE3/candles'))).toBe(false);
    expect(document.body.textContent).toContain('WEGE3');
  });

  it('[F27] prevents stale closure in hermes-sessions-sync from hijacking explicit setActiveSessionKey and keeps repeated prompt bubbles visible during Turn 2 streaming', async () => {
    let resolveInitialSessions!: (res: Response) => void;
    let streamTurn2Controller!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    let chatTurnCount = 0;
    let persistedMessages: any[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/hermes/sessions') {
        return new Promise<Response>((resolve) => {
          resolveInitialSessions = resolve;
        });
      }
      if (url.includes('/api/hermes/sessions/explicit-user-session')) {
        return new Response(
          JSON.stringify({
            session_key: 'explicit-user-session',
            messages: persistedMessages,
          }),
          { status: 200 },
        );
      }
      if (url.includes('/api/hermes/chat/stream') && init?.method === 'POST') {
        chatTurnCount += 1;
        if (chatTurnCount === 1) {
          persistedMessages = [
            { id: 'srv-u1', role: 'user', content: 'Ping?' },
            { id: 'srv-a1', role: 'assistant', content: 'Pong 1!' },
          ];
          return new Response(
            'event: token\ndata: {"type":"token","delta":"Pong 1!"}\n\n' +
              'event: done\ndata: {"type":"done","message":"Pong 1!"}\n\n',
            { status: 200 },
          );
        }
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            streamTurn2Controller = controller;
          },
        });
        return new Response(stream, { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(<App initialPath="/todos" />);

    // While initial GET /api/hermes/sessions is still in-flight, user explicitly switches session key
    act(() => {
      useAppStore.getState().setActiveSessionKey('explicit-user-session');
    });
    expect(useAppStore.getState().activeSessionKey).toBe('explicit-user-session');

    // Resolve stale initial GET /api/hermes/sessions -> must NOT overwrite 'explicit-user-session'
    await act(async () => {
      resolveInitialSessions(
        new Response(
          JSON.stringify([{ session_key: 'stale-old-session', title: 'Old Session' }]),
          { status: 200 },
        ),
      );
      await Promise.resolve();
    });
    expect(useAppStore.getState().activeSessionKey).toBe('explicit-user-session');

    // Open Cmd+J and send "Ping?" on Turn 1 -> 2 bubbles after Turn 1 refetch
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    fireEvent.change(screen.getByLabelText('Message Frieren'), {
      target: { value: 'Ping?' },
    });
    fireEvent.click(within(screen.getByTestId('companion-online-chat')).getByText('SEND'));

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="companion-msg-"]').length).toBe(2);
    });

    // Send identical prompt "Ping?" on Turn 2 -> must render all 4 bubbles while Turn 2 is streaming
    fireEvent.change(screen.getByLabelText('Message Frieren'), {
      target: { value: 'Ping?' },
    });
    fireEvent.click(within(screen.getByTestId('companion-online-chat')).getByText('SEND'));

    await waitFor(() => {
      expect(streamTurn2Controller).toBeTruthy();
      expect(document.querySelectorAll('[data-testid^="companion-msg-"]').length).toBe(4);
    });

    await act(async () => {
      streamTurn2Controller.enqueue(
        encoder.encode('event: token\ndata: {"type":"token","delta":"Pong 2!"}\n\n'),
      );
      await Promise.resolve();
    });
    expect(document.querySelectorAll('[data-testid^="companion-msg-"]').length).toBe(4);

    // Complete Turn 2 stream and persist 4 messages -> still exactly 4 bubbles after refetch
    persistedMessages = [
      { id: 'srv-u1', role: 'user', content: 'Ping?' },
      { id: 'srv-a1', role: 'assistant', content: 'Pong 1!' },
      { id: 'srv-u2', role: 'user', content: 'Ping?' },
      { id: 'srv-a2', role: 'assistant', content: 'Pong 2!' },
    ];
    await act(async () => {
      streamTurn2Controller.enqueue(
        encoder.encode('event: done\ndata: {"type":"done","message":"Pong 2!"}\n\n'),
      );
      streamTurn2Controller.close();
    });

    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="companion-msg-"]').length).toBe(4);
      expect(screen.getByTestId('companion-stage-popover').textContent).toContain('Pong 2!');
    });
  });

  it('[F23/F24] enforces strict NLP calendar rollover, 1..=1440 minute bounds, #tag sanitization, orphan MCP approval scoping, and widget-edit source_config merge', async () => {
    const invalidParsed = parseQuickCaptureFallback(
      'Review 2026-02-29 2026-04-31 999999999999m ##',
    );
    expect(invalidParsed.scheduled_date).toBeUndefined();
    expect(invalidParsed.due_at).toBeUndefined();
    expect(invalidParsed.estimated_minutes).toBeUndefined();
    expect(invalidParsed.tags).toEqual([]);
    expect(invalidParsed.clean_title).toBe('Review 2026-02-29 2026-04-31 999999999999m ##');

    expect(toRfc3339DueDate('2026-02-29')).toBeUndefined();
    expect(toRfc3339DueDate('2026-04-31')).toBeUndefined();
    expect(toRfc3339DueDate('2024-02-29')).toBe('2024-02-29T23:59:59Z');

    const boundOk = parseQuickCaptureFallback('Max full-day sprint 1440m #rust_2024');
    expect(boundOk.estimated_minutes).toBe(1440);
    expect(boundOk.tags).toEqual(['rust_2024']);

    const boundOver = parseQuickCaptureFallback('Over-day sprint 1441m 0m');
    expect(boundOver.estimated_minutes).toBeUndefined();

    // Verify orphan/alias pending MCP approval isolation and widget-edit source_config merge + post-PUT refresh
    let putWidgetBody: Record<string, any> | null = null;
    let refreshedEditedWidget = false;
    const deckUuid = '01932a00-0000-7000-8000-000000000101';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (
        url.includes(`/api/dashboards/${deckUuid}/widgets/w-edit-http`) &&
        init?.method === 'PUT'
      ) {
        putWidgetBody = JSON.parse(String(init.body || '{}'));
        return new Response(JSON.stringify({ id: 'w-edit-http', ...putWidgetBody }), {
          status: 200,
        });
      }
      if (url.includes('/api/widgets/w-edit-http/refresh') && init?.method === 'POST') {
        refreshedEditedWidget = true;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes('/api/dashboards')) {
        return new Response(
          JSON.stringify([
            {
              id: deckUuid,
              slug: 'tactical-ops',
              title: 'DECK_01 // TACTICAL_OPS',
              cycle_seconds: 60,
              in_rotation: true,
              sort_order: 1,
              layout_cols: 12,
              layout_rows: 8,
              widgets: [
                {
                  id: 'w-edit-http',
                  dashboard_id: deckUuid,
                  title: 'HTTP_WITH_POINTER',
                  source_kind: 'http',
                  renderer_kind: 'kpi',
                  grid_rect: { x: 0, y: 0, w: 4, h: 3 },
                  source_config: {
                    url: 'http://127.0.0.1:8080/api/health',
                    json_pointer: '/status',
                    headers: { 'X-Probe': '1' },
                  },
                  last_refreshed_at: '2026-11-14T10:00:00Z',
                  cached_payload: { status: 200, extracted: 'ok' },
                },
              ],
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes('/api/mcp/approvals')) {
        return new Response(
          JSON.stringify([
            {
              id: 'orphan-approval',
              tool_name: 'dashboards_configure_command_widget',
              status: 'pending',
              payload_json: {
                dashboard_id: '01932a00-dead-7000-8000-000000009999',
                title: 'ORPHAN_CMD',
                command: 'echo ORPHAN_LEAK',
              },
            },
            {
              id: 'alias-approval',
              tool_name: 'dashboards_configure_command_widget',
              status: 'pending',
              payload_json: {
                id: '01932a00-0000-7000-8000-000000000102',
                title: 'ALIAS_CMD',
                command: 'echo ALIAS_LEAK',
              },
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(<App initialPath="/dashboard" />);
    expect(await screen.findByTestId('widget-card-w-edit-http')).toBeTruthy();

    // Neither orphan nor id-aliased approval for another deck leaks onto DECK_01
    expect(document.body.textContent).not.toContain('ORPHAN_LEAK');
    expect(document.body.textContent).not.toContain('ALIAS_LEAK');

    // Edit widget renderer_kind -> preserves json_pointer & headers and triggers post-PUT refresh
    fireEvent.click(screen.getByTestId('edit-widget-w-edit-http'));
    fireEvent.click(screen.getByTestId('widget-submit-btn'));

    await waitFor(() => {
      expect(putWidgetBody).toBeTruthy();
      expect(refreshedEditedWidget).toBe(true);
    });
    expect(putWidgetBody!.source_config).toEqual({
      url: 'http://127.0.0.1:8080/api/health',
      json_pointer: '/status',
      headers: { 'X-Probe': '1' },
    });
  });
});
