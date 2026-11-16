import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoutinesPage } from './RoutinesPage';

function renderRoutinesPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RoutinesPage />
    </QueryClientProvider>,
  );
}

describe('RoutinesPage (/routines) — F29 Day Profiles, Guided Runner, Ideal Week, Check-In & Weekly Review', () => {
  const todayIso = new Date().toISOString().slice(0, 10);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function stubRoutinesApiMocks() {
    let routinesState: any[] = [
      {
        id: '01963000-0000-7000-8000-000000009001',
        name: 'Morning Launch Ritual',
        time_slot: 'morning',
        day_profile: 'workday',
        target_start_time: '07:00:00',
        sort_order: 1,
        active: true,
        today_logs: [],
        items: [
          {
            id: '01963000-0000-7000-8000-000000009101',
            routine_id: '01963000-0000-7000-8000-000000009001',
            title: 'Hydrate 3L Electrolytes',
            tracking_type: 'numeric',
            target_value: 3.0,
            unit: 'L',
            frequency_type: 'daily',
            frequency_config: { mvd_included: true },
            estimated_minutes: 5,
            sort_order: 1,
          },
          {
            id: '01963000-0000-7000-8000-000000009102',
            routine_id: '01963000-0000-7000-8000-000000009001',
            title: 'Deep Architecture Study 45m',
            tracking_type: 'duration',
            target_value: 45,
            unit: 'min',
            frequency_type: 'weekdays',
            frequency_config: { mvd_included: false },
            estimated_minutes: 45,
            sort_order: 2,
          },
        ],
      },
      {
        id: '01963000-0000-7000-8000-000000009002',
        name: 'Empty Shutdown Stack',
        time_slot: 'shutdown',
        day_profile: 'workday',
        target_start_time: '18:00:00',
        sort_order: 2,
        active: true,
        today_logs: [],
        items: [],
      },
    ];

    let logsState: any[] = [
      {
        id: '01963000-0000-7000-8000-000000009201',
        routine_item_id: '01963000-0000-7000-8000-000000009101',
        log_date: todayIso,
        status: 'partial',
        numeric_value: 1.5,
      },
    ];

    let idealBlocksState: any[] = [
      {
        id: '01963000-0000-7000-8000-000000009301',
        day_of_week: 0,
        start_time: '08:00:00',
        end_time: '10:00:00',
        category: 'deep_work',
        label: 'Systems Consensus Block',
        color: '#F87C18',
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      const bodyObj = init?.body ? JSON.parse(String(init.body)) : {};

      if (url.includes('/api/routines/analytics') && method === 'GET') {
        return new Response(
          JSON.stringify({
            streaks: [
              {
                routine_item_id: '01963000-0000-7000-8000-000000009101',
                routine_id: '01963000-0000-7000-8000-000000009001',
                title: 'Hydrate 3L Electrolytes',
                current_streak: 7,
                longest_streak: 19,
                completion_rate_30d_pct: 91.5,
              },
            ],
            matrix_8x12: Array.from({ length: 96 }, (_, idx) => idx % 2 === 0),
            consistency_score_pct: 91.5,
            heatmap_365d: Array.from({ length: 365 }, (_, idx) => ({
              date: `2026-01-${String((idx % 28) + 1).padStart(2, '0')}`,
              completed_count: idx % 3 === 0 ? 2 : 0,
              total_count: 2,
              completion_ratio: idx % 3 === 0 ? 1.0 : 0.0,
            })),
            routine_adherence: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/routines/day-profile') && method === 'POST') {
        return new Response(
          JSON.stringify({
            id: '01963000-0000-7000-8000-000000009401',
            checkin_date: todayIso,
            day_profile_used: bodyObj.day_profile ?? 'workday',
            obsidian_vault_path: `Daily/${todayIso}.md`,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (/\/api\/routines\/[^/]+\/items$/.test(url) && method === 'POST') {
        const routineId = url.split('/api/routines/')[1]?.split('/items')[0] ?? '';
        const createdItem = {
          id: `item-${Date.now()}`,
          routine_id: routineId,
          title: bodyObj.title,
          tracking_type: bodyObj.tracking_type ?? 'boolean',
          target_value: bodyObj.target_value ?? null,
          unit: bodyObj.unit ?? null,
          frequency_type: bodyObj.frequency_type ?? 'daily',
          frequency_config: bodyObj.frequency_config ?? { mvd_included: true },
          estimated_minutes: bodyObj.estimated_minutes ?? 10,
          sort_order: 1,
        };
        routinesState = routinesState.map((r) =>
          r.id === routineId ? { ...r, items: [...r.items, createdItem] } : r,
        );
        return new Response(JSON.stringify(createdItem), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/routines') && method === 'GET') {
        return new Response(JSON.stringify(routinesState), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/routine-logs') && method === 'GET') {
        return new Response(JSON.stringify(logsState), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/routine-logs') && method === 'POST') {
        const logEntry = {
          id: `log-${Date.now()}`,
          routine_item_id: bodyObj.routine_item_id,
          log_date: bodyObj.log_date ?? todayIso,
          status: bodyObj.status ?? 'completed',
          numeric_value: bodyObj.numeric_value ?? null,
        };
        logsState = [
          ...logsState.filter((l) => l.routine_item_id !== bodyObj.routine_item_id),
          logEntry,
        ];
        return new Response(JSON.stringify(logEntry), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/ideal-week') && method === 'GET') {
        return new Response(
          JSON.stringify({
            blocks: idealBlocksState,
            total_planned_minutes: 120,
            total_actual_minutes: 90,
            variance_by_category: [
              {
                category: 'deep_work',
                planned_minutes: 120,
                actual_minutes: 90,
                variance_minutes: -30,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/ideal-week') && method === 'PUT') {
        idealBlocksState = bodyObj.blocks ?? [];
        return new Response(
          JSON.stringify({
            blocks: idealBlocksState,
            total_planned_minutes: 240,
            total_actual_minutes: 90,
            variance_by_category: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/checkins/') && method === 'GET') {
        return new Response(
          JSON.stringify({
            id: '01963000-0000-7000-8000-000000009401',
            checkin_date: todayIso,
            energy_score: 4,
            mood_score: 5,
            sleep_hours: 7.5,
            highlight: 'Initial highlight',
            reflection_md: 'Initial reflection',
            day_profile_used: 'workday',
            obsidian_vault_path: `Daily/${todayIso}.md`,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/checkins/') && method === 'PUT') {
        return new Response(
          JSON.stringify({
            id: '01963000-0000-7000-8000-000000009401',
            checkin_date: todayIso,
            ...bodyObj,
            obsidian_vault_path: `Daily/${todayIso}.md`,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/weekly-review/summary') && method === 'GET') {
        return new Response(
          JSON.stringify({
            week_key: '2026-W46',
            iso_week: '2026-W46',
            week_start: '2026-11-09',
            week_end: '2026-11-15',
            completed_tasks_count: 0,
            inbox_tasks_count: 0,
            focus_minutes: 0,
            focus_hours: 0,
            routine_consistency_pct: 0,
            completed_lessons_count: 0,
            goals_avg_progress_pct: 0,
            investable_surplus_cents: 0,
            obsidian_vault_path: 'Reviews/2026-W46.md',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/reviews/') && (method === 'POST' || method === 'PUT')) {
        return new Response(
          JSON.stringify({
            week_key: '2026-W46',
            iso_week: '2026-W46',
            obsidian_vault_path: 'Reviews/2026-W46.md',
            vault_export_path: 'Reviews/2026-W46.md',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock };
  }

  it('renders Routine Stacks, Empty Stacks, Quantitative progress without NaN, 96-cell BinaryDotMatrix8x12, and 365d heatmap', async () => {
    stubRoutinesApiMocks();
    const { container } = renderRoutinesPage();

    await waitFor(() => {
      expect(screen.getByText('Morning Launch Ritual')).toBeTruthy();
      expect(screen.getByText('Empty Shutdown Stack')).toBeTruthy();
      expect(screen.getAllByText('Hydrate 3L Electrolytes').length).toBeGreaterThan(0);
    });

    const matrixEl = container.querySelector('[data-fui="binary-dot-matrix"]');
    expect(matrixEl).toBeTruthy();
    expect(matrixEl!.querySelectorAll('[data-matrix-cell]').length).toBe(96);

    const heatmapEl = container.querySelector('[data-testid="routines-heatmap-365d"]');
    expect(heatmapEl).toBeTruthy();
    expect(heatmapEl!.querySelectorAll('[data-heatmap-cell]').length).toBe(365);

    const fullText = container.textContent ?? '';
    expect(fullText).toContain('1.5 / 3 L (50%)');
    expect(fullText).not.toContain('NaN');
    expect(fullText).not.toContain('undefined');
  });

  it('switches Day Profile to Minimum Viable (MVD) and logs habit completions', async () => {
    const { fetchMock } = stubRoutinesApiMocks();
    renderRoutinesPage();

    await waitFor(() => {
      expect(screen.getByText('Deep Architecture Study 45m')).toBeTruthy();
    });

    const mvdBtn = screen.getByTestId('day-profile-btn-minimum_viable');
    fireEvent.click(mvdBtn);

    await waitFor(() => {
      expect(screen.getAllByText('Hydrate 3L Electrolytes').length).toBeGreaterThan(0);
      expect(screen.queryByText('Deep Architecture Study 45m')).toBeNull();
    });

    const completeBtn = screen.getByTestId(
      'habit-complete-btn-01963000-0000-7000-8000-000000009101',
    );
    fireEvent.click(completeBtn);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([u, init]) =>
            String(u).includes('/api/routine-logs') &&
            (init?.method ?? 'GET').toUpperCase() === 'POST',
        ),
      ).toBe(true);
    });
  });

  it('opens Guided Routine Runner and advances through steps', async () => {
    stubRoutinesApiMocks();
    renderRoutinesPage();

    await waitFor(() => {
      expect(screen.getByTestId('launch-guided-runner-btn')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('launch-guided-runner-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('guided-routine-runner-modal')).toBeTruthy();
      expect(screen.getByTestId('guided-runner-complete-step')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('guided-runner-complete-step'));
    await waitFor(() => {
      expect(screen.getByText(/STEP 2 OF 2/i)).toBeTruthy();
    });
  });

  it('validates Ideal Week blocks (rejecting end_time <= start_time) and renders Daily Pulse & Weekly Review without NaN', async () => {
    stubRoutinesApiMocks();
    const { container } = renderRoutinesPage();

    await waitFor(() => {
      expect(screen.getByTestId('routines-subtab-ideal_week')).toBeTruthy();
    });

    // Switch to Ideal Week Blueprint tab
    fireEvent.click(screen.getByTestId('routines-subtab-ideal_week'));
    await waitFor(() => {
      expect(screen.getByTestId('ideal-week-blueprint-panel')).toBeTruthy();
      expect(screen.getByText('Systems Consensus Block')).toBeTruthy();
    });

    // Try submitting inverted start/end time (14:00 -> 12:00)
    fireEvent.change(screen.getByTestId('ideal-week-start-input'), {
      target: { value: '14:00' },
    });
    fireEvent.change(screen.getByTestId('ideal-week-end-input'), {
      target: { value: '12:00' },
    });
    fireEvent.click(screen.getByTestId('ideal-week-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('ideal-week-validation-error')).toBeTruthy();
    });

    // Switch to Daily Pulse Check-In tab
    fireEvent.click(screen.getByTestId('routines-subtab-daily_pulse'));
    await waitFor(() => {
      expect(screen.getByTestId('daily-pulse-checkin-panel')).toBeTruthy();
      expect(screen.getByTestId('daily-checkin-vault-path').textContent).toContain(
        `Daily/${todayIso}.md`,
      );
    });
    fireEvent.click(screen.getByTestId('daily-checkin-save-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('daily-checkin-saved-banner')).toBeTruthy();
    });

    // Switch to Weekly Review Wizard tab
    fireEvent.click(screen.getByTestId('routines-subtab-weekly_review'));
    await waitFor(() => {
      expect(screen.getByTestId('weekly-review-wizard-panel')).toBeTruthy();
      expect(screen.getByTestId('weekly-review-vault-path').textContent).toContain(
        'Reviews/2026-W46.md',
      );
    });

    const reviewText = container.textContent ?? '';
    expect(reviewText).not.toContain('NaN');
    expect(reviewText).not.toContain('Infinity');
    expect(reviewText).not.toContain('undefined');

    fireEvent.click(screen.getByTestId('weekly-review-export-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('weekly-review-exported-banner')).toBeTruthy();
    });
  });
});
