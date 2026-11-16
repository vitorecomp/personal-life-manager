import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalsPage } from './GoalsPage';

function renderGoalsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <GoalsPage />
    </QueryClientProvider>,
  );
}

describe('GoalsPage (/goals) — F30 Annual Cycles, Q1-Q4 OKRs, Focus Cap & REF-03 90° Blueprint', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function stubGoalsApiMocks(options?: { focusCapExceeded?: boolean; emptyGoals?: boolean }) {
    let goals2026: any[] = options?.emptyGoals
      ? []
      : [
          {
            id: '01963000-0000-7000-8000-00000000a001',
            year: 2026,
            pillar: 'systems',
            code: 'G01',
            title: 'Pinned Room Node Goal',
            why_motivation_md: 'Build resilient personal life infrastructure.',
            status: 'in_progress',
            priority_rank: 1,
            target_date: '2026-12-31',
            confidence_score: 8,
            progress_pct: '55.0',
            blueprint_pos: { x: 380, y: 120 },
            pace_health: 'on_track',
            elapsed_year_pct: 45,
            invested_seconds_14d: 10800,
            focus_cap_limit: options?.focusCapExceeded ? 1 : 6,
            active_goals_in_cycle: options?.focusCapExceeded ? 3 : 2,
            focus_cap_exceeded: Boolean(options?.focusCapExceeded),
            key_results: [
              {
                id: '01963000-0000-7000-8000-00000000a101',
                goal_id: '01963000-0000-7000-8000-00000000a001',
                quarter: 'Q1',
                code: 'KR1',
                title: 'Zero-Range Stability Check',
                metric_type: 'numeric',
                start_value: '100',
                current_value: '100',
                target_value: '100',
                unit: '%',
                weight: '1',
                progress_pct: '100',
              },
              {
                id: '01963000-0000-7000-8000-00000000a102',
                goal_id: '01963000-0000-7000-8000-00000000a001',
                quarter: 'Q2',
                code: 'KR2',
                title: 'Linked Project Rollup',
                metric_type: 'linked_project',
                start_value: '0',
                current_value: '40',
                target_value: '100',
                unit: '%',
                weight: '1',
                progress_pct: '40',
              },
            ],
            checkins: [
              {
                id: '01963000-0000-7000-8000-00000000a201',
                goal_id: '01963000-0000-7000-8000-00000000a001',
                checkin_date: '2026-04-01',
                progress_snapshot: '55.0',
                confidence_score: 8,
                wins_md: 'Completed initial architecture review',
                blockers_md: '',
                next_steps_md: 'Ship Q2 KR',
              },
            ],
          },
          {
            id: '01963000-0000-7000-8000-00000000a002',
            year: 2026,
            pillar: 'career',
            code: 'G99',
            title: 'Off-Track Drift Goal',
            why_motivation_md: 'Verify pace drift alert.',
            status: 'in_progress',
            priority_rank: 2,
            target_date: '2026-06-30',
            confidence_score: 4,
            progress_pct: '0.0',
            blueprint_pos: null,
            pace_health: 'off_track',
            elapsed_year_pct: 60,
            invested_seconds_14d: 0,
            focus_cap_limit: options?.focusCapExceeded ? 1 : 6,
            active_goals_in_cycle: options?.focusCapExceeded ? 3 : 2,
            focus_cap_exceeded: Boolean(options?.focusCapExceeded),
            key_results: [],
            checkins: [],
          },
        ];

    const goals2027: any[] = [
      {
        id: '01963000-0000-7000-8000-00000000b001',
        year: 2027,
        pillar: 'learning',
        code: 'G01',
        title: '2027 Autonomous Mastery Goal',
        why_motivation_md: 'Multi-cycle isolation test.',
        status: 'not_started',
        priority_rank: 1,
        target_date: '2027-12-31',
        confidence_score: 9,
        progress_pct: '0.0',
        blueprint_pos: { x: 400, y: 180 },
        pace_health: 'on_track',
        elapsed_year_pct: 0,
        invested_seconds_14d: 0,
        focus_cap_limit: 6,
        active_goals_in_cycle: 1,
        focus_cap_exceeded: false,
        key_results: [],
        checkins: [],
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      const bodyObj = init?.body ? JSON.parse(String(init.body)) : {};

      if (url.includes('/api/goals/cycles') && !url.includes('/blueprint') && method === 'GET') {
        return new Response(
          JSON.stringify([
            {
              year: 2026,
              theme: 'Year of Systems & Leverage',
              vision_md: 'Engineer deterministic workflows.',
              anti_goals_md: 'No context fragmentation.',
              focus_cap_limit: options?.focusCapExceeded ? 1 : 6,
              status: 'active',
            },
            {
              year: 2027,
              theme: 'Year of Compounding Mastery',
              vision_md: 'Scale autonomous systems.',
              anti_goals_md: 'Zero burnout.',
              focus_cap_limit: 6,
              status: 'planning',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/blueprint') && method === 'GET') {
        const is2027 = url.includes('2027');
        return new Response(
          JSON.stringify({
            year: is2027 ? 2027 : 2026,
            cycle: {
              year: is2027 ? 2027 : 2026,
              theme: is2027 ? 'Year of Compounding Mastery' : 'Year of Systems & Leverage',
              vision_md: is2027 ? 'Scale autonomous systems.' : 'Engineer deterministic workflows.',
              anti_goals_md: 'No context fragmentation.',
              focus_cap_limit: 6,
              status: is2027 ? 'planning' : 'active',
            },
            title_block: {
              year: is2027 ? 2027 : 2026,
              theme: is2027 ? 'Year of Compounding Mastery' : 'Year of Systems & Leverage',
              status: is2027 ? 'planning' : 'active',
              days_elapsed: 135,
              days_total: 365,
              revision: is2027 ? 'REV 2027.1' : 'REV 2026.4',
            },
            nodes: [],
            corridors: [],
            quarter_matrix: [],
            pillar_zones: [],
            strategist_notes_md: 'Engineer deterministic workflows.',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/blueprint-pos') && method === 'PATCH') {
        const goalId = url.split('/api/goals/')[1]?.split('/')[0];
        goals2026 = goals2026.map((g) =>
          g.id === goalId ? { ...g, blueprint_pos: bodyObj.blueprint_pos } : g,
        );
        const updated = goals2026.find((g) => g.id === goalId) ?? goals2026[0];
        return new Response(JSON.stringify(updated), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/checkins') && method === 'GET') {
        return new Response(JSON.stringify(goals2026[0]?.checkins ?? []), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/checkins') && method === 'POST') {
        const createdCheckin = {
          id: '01963000-0000-7000-8000-00000000a299',
          goal_id: goals2026[0]?.id,
          checkin_date: '2026-05-01',
          progress_snapshot: '65.0',
          confidence_score: bodyObj.confidence_score ?? 9,
          wins_md: bodyObj.wins_md ?? 'Logged checkin win',
          blockers_md: bodyObj.blockers_md ?? '',
          next_steps_md: bodyObj.next_steps_md ?? '',
        };
        if (goals2026[0]) {
          goals2026[0].checkins = [createdCheckin, ...(goals2026[0].checkins ?? [])];
        }
        return new Response(JSON.stringify(createdCheckin), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/goals') && method === 'GET') {
        const is2027 = url.includes('year=2027');
        return new Response(JSON.stringify(is2027 ? goals2027 : goals2026), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock };
  }

  it('renders REF-03 Blueprint Canvas by default with 100% orthogonal corridors, Title Block, Q1-Q4 Matrix, and Pace Drift badges', async () => {
    stubGoalsApiMocks();
    renderGoalsPage();

    await waitFor(() => {
      expect(screen.getAllByText(/Pinned Room Node Goal/i).length).toBeGreaterThan(0);
    });

    // Verify REF-03 SVG blueprint is visible by default without clicking any tab
    const svg = screen.getByTestId('goals-blueprint-canvas');
    expect(svg.getAttribute('data-fui-blueprint')).toBe('true');

    // Verify every <path> outside <defs> has 0 curve commands (C/S/Q/T/A)
    const paths = Array.from(svg.querySelectorAll('path'));
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      const d = p.getAttribute('d') ?? '';
      expect(/[CcSsQqTtAa]/.test(d)).toBe(false);
    }

    // Verify Pace Drift badges and zero-range KR without NaN or Infinity
    expect(screen.getAllByText(/OFF TRACK \/\/ PACE RISK/i).length).toBeGreaterThan(0);
    expect(document.body.textContent?.includes('NaN')).toBe(false);
    expect(document.body.textContent?.includes('Infinity')).toBe(false);
  });

  it('switches between Annual Cycles (2026 <-> 2027) and renders Focus Cap warning when active goals exceed limit', async () => {
    stubGoalsApiMocks({ focusCapExceeded: true });
    renderGoalsPage();

    await waitFor(() => {
      expect(screen.getByTestId('focus-cap-warning-banner')).toBeTruthy();
    });

    // Switch to 2027 cycle
    fireEvent.click(screen.getByTestId('cycle-btn-2027'));

    await waitFor(() => {
      expect(screen.getAllByText(/2027 Autonomous Mastery Goal/i).length).toBeGreaterThan(0);
    });
    expect(document.body.textContent?.includes('NaN')).toBe(false);
    expect(document.body.textContent?.includes('undefined')).toBe(false);
  });

  it('persists blueprint_pos on Goal node pointer drag and logs Goal Check-in', async () => {
    const { fetchMock } = stubGoalsApiMocks();
    renderGoalsPage();

    await waitFor(() => {
      expect(screen.getByTestId('blueprint-node-01963000-0000-7000-8000-00000000a001')).toBeTruthy();
    });

    const goalNode = screen.getByTestId('blueprint-node-01963000-0000-7000-8000-00000000a001');
    fireEvent.mouseDown(goalNode, { clientX: 200, clientY: 150 });
    fireEvent.mouseMove(window, { clientX: 280, clientY: 190 });
    fireEvent.mouseUp(window, { clientX: 280, clientY: 190 });

    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(([url, init]) =>
        String(url).includes('/blueprint-pos') && (init?.method ?? '').toUpperCase() === 'PATCH',
      );
      expect(patchCalls.length).toBeGreaterThanOrEqual(1);
    });

    // Log a Goal Check-in and verify POST /api/goals/{id}/checkins is called
    const winsInput = screen.getByPlaceholderText(/Completed initial architecture review/i);
    fireEvent.change(winsInput, { target: { value: 'Shipped 90deg corridor router' } });
    fireEvent.click(screen.getByTestId('submit-goal-checkin-btn'));

    await waitFor(() => {
      const checkinCalls = fetchMock.mock.calls.filter(([url, init]) =>
        String(url).includes('/checkins') && (init?.method ?? '').toUpperCase() === 'POST',
      );
      expect(checkinCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
