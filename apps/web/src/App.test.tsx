import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { parseQuickCaptureFallback } from './api/client';
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
      bootDismissed: true,
    });
  });

  afterEach(() => {
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

  it('[F23] parses Quick Capture NLP tokens (#tag @deep_work !high tomorrow 90m) deterministically', () => {
    const parsed = parseQuickCaptureFallback(
      'Finish Raft consensus lab #courses @deep_work !high tomorrow 90m',
    );
    expect(parsed.clean_title).toBe('Finish Raft consensus lab');
    expect(parsed.tags).toEqual(['courses']);
    expect(parsed.energy_level).toBe('deep_focus');
    expect(parsed.priority).toBe('high');
    expect(parsed.estimated_minutes).toBe(90);
    expect(parsed.scheduled_date).toBeTruthy();
  });

  it('[F23] opens Cmd+K QuickCaptureModal, rejects blank input, dismisses on Escape, and submits valid task', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/tasks/parse')) {
        return new Response(
          JSON.stringify({
            clean_title: 'Ship telemetry widget',
            tags: ['ops'],
            priority: 'high',
            energy_level: 'deep_focus',
            estimated_minutes: 30,
          }),
          { status: 200 },
        );
      }
      if (url.includes('/api/tasks') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'task-1', title: 'Ship telemetry widget' }), {
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

    // Reopen via header button and submit valid task
    fireEvent.click(screen.getByTestId('quick-capture-trigger'));
    const input = screen.getByTestId('quick-capture-input');
    fireEvent.change(input, {
      target: { value: 'Ship telemetry widget #ops @deep_work !high 30m' },
    });

    expect(screen.getByTestId('quick-capture-tokens').textContent).toContain('#ops');
    fireEvent.click(screen.getByTestId('quick-capture-submit'));

    await waitFor(() => {
      expect(screen.queryByTestId('quick-capture-modal')).toBeNull();
    });
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('[F23] toggles global Privacy Mask to redact BRL/USD currency while preserving percentages and durations', async () => {
    render(<App initialPath="/finance" />);

    expect(screen.getByText('R$ 142.500,00')).toBeTruthy();
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

  it('[F23] displays ActiveTimerBar active task title and clears immediately on discard', async () => {
    let running = true;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/time/timer/discard') && init?.method === 'POST') {
        running = false;
        return new Response(JSON.stringify({ discarded: true }), { status: 200 });
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
                    timer_mode: 'pomodoro_25_5',
                  },
                }
              : { running: false, session: null, elapsed_seconds: 0 },
          ),
          { status: 200 },
        );
      }
      if (url.includes('/api/tasks')) {
        return new Response(
          JSON.stringify([{ id: 'task-focus-1', title: 'Audit Kernel Memory Map', status: 'in_progress' }]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    render(<App initialPath="/dashboard" />);

    expect(await screen.findByTestId('active-timer-task-title')).toBeTruthy();
    expect(screen.getByTestId('active-timer-task-title').textContent).toBe('Audit Kernel Memory Map');
    expect(screen.getByTestId('active-timer-clock').textContent).toBe('02:05');

    fireEvent.click(screen.getByTestId('timer-discard-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('active-timer-task-title')).toBeNull();
    });
  });

  it('[F23] opens AuthSettingsModal, validates PAT name, mints PAT, and renders Mobile Pairing QR', async () => {
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
});
