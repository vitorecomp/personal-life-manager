import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnightsPage } from './KnightsPage';
import { FALLBACK_STARTER_KNIGHTS } from '../components/knights/knightsModel';

function renderKnightsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <KnightsPage />
    </QueryClientProvider>,
  );
}

describe('KnightsPage (/agents) — F26 Isometric Knight Arena & Knight Forge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function stubArenaApiMocks() {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url.endsWith('/api/agents') && method === 'GET') {
        return new Response(
          JSON.stringify({
            items: [
              {
                ...FALLBACK_STARTER_KNIGHTS[0],
                monthly_budget_cents: 500,
                month_spent_cents: 160,
                hp_remaining_cents: 340,
                ep_Context_tokens_used: 14000,
                ep_max_tokens: 128000,
              },
              ...FALLBACK_STARTER_KNIGHTS.slice(1),
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/api/agents/queue') && method === 'GET') {
        return new Response(
          JSON.stringify({
            items: [
              {
                agent_id: FALLBACK_STARTER_KNIGHTS[0].id,
                name: 'Sir Chronos',
                zone: 'cron_watchtower',
                knight_archetype: 'paladin',
                next_trigger: '0 8 * * *',
                status: 'scheduled',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/agent-runs') && method === 'GET') {
        if (url.includes('/api/agent-runs/run-initial-1')) {
          return new Response(
            JSON.stringify({
              id: 'run-initial-1',
              agent_id: FALLBACK_STARTER_KNIGHTS[0].id,
              trigger_type: 'cron',
              status: 'completed',
              is_dry_run: false,
              summary: 'Completed morning watchtower sweep across Todos & Routines.',
              hermes_session_key: 'knight-sir-chronos-01',
              steps_trace: [
                {
                  step: 1,
                  phase: 'soul_hydrated',
                  status: 'ok',
                  detail: 'Hydrated SOUL.md variables.',
                },
                {
                  step: 2,
                  tool: 'todos.list',
                  status: 'ok',
                  detail: 'Inspected 4 high-priority action items.',
                },
              ],
              tokens_used: 920,
              cost_cents: 2,
              duration_ms: 215,
              started_at: '2026-11-15T08:00:00Z',
              finished_at: '2026-11-15T08:00:01Z',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'run-initial-1',
                agent_id: FALLBACK_STARTER_KNIGHTS[0].id,
                trigger_type: 'cron',
                status: 'completed',
                is_dry_run: false,
                summary: 'Completed morning watchtower sweep across Todos & Routines.',
                hermes_session_key: 'knight-sir-chronos-01',
                steps_trace: [
                  {
                    step: 1,
                    phase: 'soul_hydrated',
                    status: 'ok',
                    detail: 'Hydrated SOUL.md variables.',
                  },
                ],
                tokens_used: 920,
                cost_cents: 2,
                duration_ms: 215,
                started_at: '2026-11-15T08:00:00Z',
                finished_at: '2026-11-15T08:00:01Z',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/triggers') && method === 'GET') {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'trig-1',
                agent_id: FALLBACK_STARTER_KNIGHTS[0].id,
                trigger_type: 'cron',
                cron_expr: '0 8 * * *',
                enabled: true,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/triggers') && method === 'POST') {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        return new Response(
          JSON.stringify({
            id: 'trig-created-1',
            agent_id: FALLBACK_STARTER_KNIGHTS[0].id,
            trigger_type: body.trigger_type ?? 'cron',
            cron_expr: body.cron_expr ?? null,
            event_type: body.event_type ?? null,
            enabled: true,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/api/agents') && method === 'POST') {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        return new Response(
          JSON.stringify({
            id: '01963000-0000-7000-8000-000000000099',
            name: body.name,
            slug: body.slug,
            knight_archetype: body.knight_archetype,
            crest_color: body.crest_color,
            system_prompt: body.system_prompt,
            model: body.model,
            thinking_effort: body.thinking_effort,
            tools_policy: body.tools_policy,
            cron_schedule: body.cron_schedule ?? null,
            event_triggers: body.event_triggers ?? [],
            zone: body.zone,
            grid_pos: body.grid_pos,
            monthly_budget_cents: body.monthly_budget_cents ?? 500,
            month_spent_cents: 0,
            hp_remaining_cents: body.monthly_budget_cents ?? 500,
            ep_Context_tokens_used: 0,
            ep_max_tokens: body.ep_max_tokens ?? 128000,
            enabled: body.enabled ?? true,
            is_paused: body.is_paused ?? false,
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (/\/api\/agents\/[^/]+$/.test(url) && method === 'PUT') {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const id = url.split('/').pop() ?? FALLBACK_STARTER_KNIGHTS[0].id;
        const existing =
          FALLBACK_STARTER_KNIGHTS.find((k) => k.id === id) ?? FALLBACK_STARTER_KNIGHTS[0];
        return new Response(
          JSON.stringify({
            ...existing,
            ...body,
            id,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/dispatch') && method === 'POST') {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const isDry = Boolean(body.dry_run);
        return new Response(
          JSON.stringify({
            id: isDry ? 'run-dry-99' : 'run-live-99',
            agent_id: FALLBACK_STARTER_KNIGHTS[0].id,
            trigger_type: isDry ? 'dry_run' : 'manual',
            status: isDry ? 'dry_run' : 'completed',
            is_dry_run: isDry,
            summary: isDry
              ? 'Simulated Dry-Run Sandbox execution: write tools intercepted.'
              : `Executed live run for task: ${body.task}`,
            hermes_session_key: 'knight-sir-chronos-99',
            steps_trace: [
              {
                step: 1,
                phase: 'soul_hydrated',
                status: 'ok',
                detail: 'Hydrated SOUL.md template variables.',
              },
              {
                step: 2,
                tool: 'todos.create',
                status: isDry ? 'simulated_dry_run' : 'ok',
                detail: isDry
                  ? 'Intercepted todos.create in Dry-Run Sandbox ($0.00 cost).'
                  : 'Created high-priority action item.',
              },
            ],
            tokens_used: 710,
            cost_cents: isDry ? 0 : 3,
            duration_ms: 185,
            started_at: '2026-11-15T08:30:00Z',
            finished_at: '2026-11-15T08:30:01Z',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('renders the 4 Isometric Arena zones, Turn-Order Queue, Starter Knights, pixelated sprites, and HP/EP telemetry', async () => {
    stubArenaApiMocks();
    renderKnightsPage();

    expect(screen.getByTestId('knights-page')).toBeTruthy();
    expect(screen.getByTestId('knights-arena')).toBeTruthy();
    expect(screen.getByTestId('knights-turn-order')).toBeTruthy();

    // All 4 arena zones exist with exact wire data-zone attributes
    expect(screen.getByTestId('arena-zone-cron_watchtower').getAttribute('data-zone')).toBe(
      'cron_watchtower',
    );
    expect(screen.getByTestId('arena-zone-event_ambush').getAttribute('data-zone')).toBe(
      'event_ambush',
    );
    expect(screen.getByTestId('arena-zone-mastermind_council').getAttribute('data-zone')).toBe(
      'mastermind_council',
    );
    expect(screen.getByTestId('arena-zone-standby_barracks').getAttribute('data-zone')).toBe(
      'standby_barracks',
    );

    // Wait for Sir Chronos HP ($3.40 / $5.00) and EP (14k / 128k ctx) to render
    await waitFor(() => {
      expect(screen.getByTestId('selected-knight-hp-label').textContent).toBe('$3.40 / $5.00');
      expect(screen.getByTestId('selected-knight-ep-label').textContent).toBe('14k / 128k ctx');
    });

    // Verify all 4 starter knights render on the board with pixelated canvas sprites
    expect(screen.getAllByText(/Sir Chronos/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Vanguard Aurum/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Lore-Warden Lyra/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Inquisitor Vex/i).length).toBeGreaterThan(0);

    const canvases = document.querySelectorAll('[data-fui="isometric-knight-sprite"] canvas');
    expect(canvases.length).toBeGreaterThanOrEqual(4);
    for (const c of Array.from(canvases)) {
      expect((c as HTMLCanvasElement).style.imageRendering).toBe('pixelated');
    }
  });

  it('redeploys a Knight across zones (including Standby Barracks) via PUT /api/agents/{id} with top-level zone and grid_pos', async () => {
    const fetchMock = stubArenaApiMocks();
    renderKnightsPage();

    await waitFor(() => {
      expect(screen.getByTestId('selected-knight-name').textContent).toBe('Sir Chronos');
    });

    const deployBarracksBtn = screen.getByTestId('deploy-to-standby_barracks');
    fireEvent.click(deployBarracksBtn);

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes(`/api/agents/${FALLBACK_STARTER_KNIGHTS[0].id}`) &&
          (init?.method ?? '').toUpperCase() === 'PUT',
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse(String(putCall?.[1]?.body));
      expect(body.zone).toBe('standby_barracks');
      expect(body.grid_pos).toEqual({ x: 2, y: 2, zone: 'standby_barracks' });
      expect(body.is_paused).toBe(true);
      expect(body.enabled).toBe(false);
    });

    // Standby Barracks Knight is excluded from Turn-Order Queue upcoming nodes
    const upcomingQueue = screen.getByTestId('turn-order-upcoming-queue');
    expect(within(upcomingQueue).queryByText(/Sir Chronos/i)).toBeNull();
  });

  it('toggles a Skill-Slot HUD autonomy gate (READ / APPROVE / AUTO) and persists tools_policy via PUT /api/agents/{id}', async () => {
    const fetchMock = stubArenaApiMocks();
    renderKnightsPage();

    await waitFor(() => {
      expect(screen.getByTestId('skill-slot-portfolio')).toBeTruthy();
    });

    const approveBtn = screen.getByTestId('skill-policy-portfolio-approve');
    fireEvent.click(approveBtn);

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes(`/api/agents/${FALLBACK_STARTER_KNIGHTS[0].id}`) &&
          (init?.method ?? '').toUpperCase() === 'PUT',
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse(String(putCall?.[1]?.body));
      expect(body.zone).toBe('cron_watchtower');
      expect(body.grid_pos.zone).toBe('cron_watchtower');
      expect(body.tools_policy['portfolio.*']).toBe('APPROVE');
    });
  });

  it('forges a new Knight via Knight Forge modal with SOUL.md template variables and lowercase knight_archetype', async () => {
    const fetchMock = stubArenaApiMocks();
    renderKnightsPage();

    fireEvent.click(screen.getByTestId('forge-knight-btn'));

    const modal = await screen.findByTestId('knight-forge-modal');
    expect(modal).toBeTruthy();

    fireEvent.change(screen.getByTestId('forge-name-input'), {
      target: { value: 'Artificer Talos' },
    });
    fireEvent.change(screen.getByTestId('forge-archetype-select'), {
      target: { value: 'artificer' },
    });
    fireEvent.change(screen.getByTestId('forge-soul-textarea'), {
      target: { value: 'Audit build pipelines.' },
    });

    // Click 1-click template variable buttons
    fireEvent.click(screen.getByTestId('soul-var-today'));
    fireEvent.click(screen.getByTestId('soul-var-active_goals'));
    fireEvent.click(screen.getByTestId('soul-var-portfolio_summary'));

    const soulValue = (screen.getByTestId('forge-soul-textarea') as HTMLTextAreaElement).value;
    expect(soulValue).toContain('{{today}}');
    expect(soulValue).toContain('{{active_goals}}');
    expect(soulValue).toContain('{{portfolio_summary}}');

    fireEvent.click(screen.getByTestId('forge-submit-btn'));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).endsWith('/api/agents') && (init?.method ?? '').toUpperCase() === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(String(postCall?.[1]?.body));
      expect(body.name).toBe('Artificer Talos');
      expect(body.knight_archetype).toBe('artificer');
      expect(body.zone).toBe('cron_watchtower');
      expect(body.grid_pos.zone).toBe('cron_watchtower');
      expect(body.system_prompt).toContain('{{today}}');
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Artificer Talos/i).length).toBeGreaterThan(0);
    });
  });

  it('dispatches Dry-Run Sandbox and live runs via POST /api/agents/{id}/dispatch and displays step traces in Battle Logs', async () => {
    const fetchMock = stubArenaApiMocks();
    renderKnightsPage();

    await waitFor(() => {
      expect(screen.getByTestId('dry-run-knight-btn')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('dry-run-knight-btn'));

    await waitFor(() => {
      const dispatchCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes('/dispatch') && (init?.method ?? '').toUpperCase() === 'POST',
      );
      expect(dispatchCall).toBeDefined();
      const body = JSON.parse(String(dispatchCall?.[1]?.body));
      expect(body.dry_run).toBe(true);
    });

    await waitFor(() => {
      expect(screen.getByTestId('battle-log-dry-run-badge')).toBeTruthy();
      expect(screen.getByTestId('battle-log-cost').textContent).toBe('$0.00');
      expect(screen.getByTestId('battle-log-session-link').getAttribute('href')).toContain(
        '/hermes?session=',
      );
    });
  });

  it('gracefully renders fallback Starter Order of Knights when backend fetch rejects offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Network offline');
      }),
    );

    renderKnightsPage();

    await waitFor(() => {
      expect(screen.getAllByText(/Sir Chronos/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Vanguard Aurum/i).length).toBeGreaterThan(0);
    });
  });

  it('supports HTML5 drag-and-drop redeployment onto an Isometric Arena zone tile', async () => {
    const fetchMock = stubArenaApiMocks();
    renderKnightsPage();

    const unitCard = await screen.findByTestId('knight-unit-sir-chronos');
    const ambushZone = screen.getByTestId('arena-zone-event_ambush');

    fireEvent.dragStart(unitCard);
    fireEvent.dragOver(ambushZone);
    fireEvent.drop(ambushZone);

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes(`/api/agents/${FALLBACK_STARTER_KNIGHTS[0].id}`) &&
          (init?.method ?? '').toUpperCase() === 'PUT',
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse(String(putCall?.[1]?.body));
      expect(body.zone).toBe('event_ambush');
      expect(body.grid_pos).toEqual({ x: 2, y: 0, zone: 'event_ambush' });
      expect(body.is_paused).toBe(false);
    });
  });

  it('trips the HP $0.00 circuit breaker when monthly budget is exhausted, locking live dispatch while keeping Dry-Run Sandbox active', async () => {
    const fetchMock = stubArenaApiMocks();
    renderKnightsPage();

    await screen.findByTestId('edit-knight-btn');
    fireEvent.click(screen.getByTestId('edit-knight-btn'));

    const budgetInput = await screen.findByTestId('forge-budget-input');
    fireEvent.change(budgetInput, { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('forge-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('selected-knight-hp-label').textContent).toBe('$0.00 / $0.00');
      expect(screen.getByTestId('selected-knight-circuit-breaker')).toBeTruthy();
      expect(
        (screen.getByTestId('dispatch-knight-btn') as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        (screen.getByTestId('dry-run-knight-btn') as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('attaches a trigger and dismisses a Knight unit in Knight Forge edit mode', async () => {
    const fetchMock = stubArenaApiMocks();
    renderKnightsPage();

    await screen.findByTestId('edit-knight-btn');
    fireEvent.click(screen.getByTestId('edit-knight-btn'));

    const addTrigBtn = await screen.findByTestId('forge-add-trigger-btn');
    fireEvent.click(addTrigBtn);

    await waitFor(() => {
      const trigCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes('/triggers') && (init?.method ?? '').toUpperCase() === 'POST',
      );
      expect(trigCall).toBeDefined();
    });

    const deleteBtn = screen.getByTestId('forge-delete-btn');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      const delCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          String(url).includes(`/api/agents/${FALLBACK_STARTER_KNIGHTS[0].id}`) &&
          (init?.method ?? '').toUpperCase() === 'DELETE',
      );
      expect(delCall).toBeDefined();
    });
  });
});
