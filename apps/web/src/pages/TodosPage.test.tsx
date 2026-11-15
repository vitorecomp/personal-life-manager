import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodosPage } from './TodosPage';

function renderTodosPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <TodosPage />
    </QueryClientProvider>,
  );
}

describe('TodosPage (/todos) — F28 Perspectives, 3 Layouts, Dependencies & Focus Timer', () => {
  const todayIso = new Date().toISOString().slice(0, 10);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function stubTodosApiMocks(options?: { overloaded?: boolean; timerRunningTaskId?: string | null }) {
    const initialTasks = [
      {
        id: '01963000-0000-7000-8000-000000000801',
        title: 'Blocker Alpha Engine',
        description_md: 'Core Raft log replication.',
        status: 'in_progress',
        priority: 'urgent',
        project_id: '01963000-0000-7000-8000-000000000701',
        blocked_by_task_ids: [],
        scheduled_date: todayIso,
        estimated_minutes: options?.overloaded ? 180 : 60,
        actual_seconds: 1200,
        energy_level: 'deep',
        tags: ['systems', 'raft'],
      },
      {
        id: '01963000-0000-7000-8000-000000000802',
        title: 'Dependent Beta Snapshot',
        description_md: 'Blocked until Alpha finishes.',
        status: 'todo',
        priority: 'high',
        project_id: '01963000-0000-7000-8000-000000000701',
        blocked_by_task_ids: ['01963000-0000-7000-8000-000000000801'],
        scheduled_date: todayIso,
        estimated_minutes: options?.overloaded ? 180 : 45,
        actual_seconds: 0,
        energy_level: 'deep',
        tags: ['systems'],
      },
      {
        id: '01963000-0000-7000-8000-000000000803',
        title: 'Child Subtask Verification',
        description_md: 'Subtask under Blocker Alpha.',
        status: 'todo',
        priority: 'medium',
        project_id: '01963000-0000-7000-8000-000000000701',
        parent_task_id: '01963000-0000-7000-8000-000000000801',
        blocked_by_task_ids: [],
        scheduled_date: todayIso,
        estimated_minutes: options?.overloaded ? 180 : 25,
        actual_seconds: 300,
        energy_level: 'quick',
        tags: ['qa'],
      },
      {
        id: '01963000-0000-7000-8000-000000000804',
        title: 'Inbox Triage Capture',
        description_md: 'Unprocessed inbox item.',
        status: 'inbox',
        priority: 'low',
        project_id: null,
        blocked_by_task_ids: [],
        scheduled_date: null,
        estimated_minutes: options?.overloaded ? 180 : 15,
        actual_seconds: 0,
        energy_level: 'shallow',
        tags: ['inbox'],
      },
      {
        id: '01963000-0000-7000-8000-000000000805',
        title: 'Completed Today Telemetry Task',
        description_md: 'Finished earlier today.',
        status: 'done',
        priority: 'high',
        project_id: '01963000-0000-7000-8000-000000000701',
        blocked_by_task_ids: [],
        scheduled_date: todayIso,
        estimated_minutes: 30,
        actual_seconds: 1800,
        energy_level: 'deep',
        tags: ['done'],
      },
    ];

    let tasksState = [...initialTasks];
    let runningTaskId = options?.timerRunningTaskId ?? null;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();

      if (url.includes('/api/projects') && method === 'GET') {
        return new Response(
          JSON.stringify([
            {
              id: '01963000-0000-7000-8000-000000000701',
              name: 'Terminal-IO Engine',
              area: 'system',
              status: 'active',
              color: '#2CE5F2',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/tasks/capacity') && method === 'GET') {
        const planned = options?.overloaded ? 720 : 145;
        return new Response(
          JSON.stringify({
            focus_capacity_minutes: 240,
            planned_minutes: planned,
            actual_minutes: 55,
            actual_seconds: 3300,
            remaining_minutes: Math.max(0, 240 - planned),
            utilization_pct: Number(((planned / 240) * 100).toFixed(1)),
            overloaded: planned > 240,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/tasks/flow') && method === 'GET') {
        return new Response(
          JSON.stringify({
            project_id: '01963000-0000-7000-8000-000000000701',
            nodes: [],
            edges: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/tasks') && method === 'GET') {
        return new Response(JSON.stringify(tasksState), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/api/tasks') && method === 'POST') {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const created = {
          id: `01963000-0000-7000-8000-00000000089${tasksState.length}`,
          title: body.title || 'Created Task',
          description_md: body.description_md || '',
          status: body.status || 'todo',
          priority: body.priority || 'medium',
          project_id: body.project_id ?? null,
          parent_task_id: body.parent_task_id ?? null,
          blocked_by_task_ids: body.blocked_by_task_ids ?? [],
          scheduled_date: body.scheduled_date ?? todayIso,
          estimated_minutes: body.estimated_minutes ?? 30,
          actual_seconds: 0,
          energy_level: body.energy_level ?? 'deep',
          tags: body.tags ?? [],
        };
        tasksState = [created, ...tasksState];
        return new Response(JSON.stringify(created), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (/\/api\/tasks\/[^/]+\/status$/.test(url) && method === 'PATCH') {
        const id = url.split('/').slice(-2)[0]!;
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        tasksState = tasksState.map((t) =>
          t.id === id ? { ...t, status: body.status } : t,
        );
        const found = tasksState.find((t) => t.id === id) ?? tasksState[0];
        return new Response(JSON.stringify(found), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (/\/api\/tasks\/[^/]+$/.test(url) && method === 'PUT') {
        const id = url.split('/').pop()!;
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (
          Array.isArray(body.blocked_by_task_ids) &&
          (body.blocked_by_task_ids.includes(id) ||
            body.blocked_by_task_ids.includes('01963000-0000-7000-8000-000000000802'))
        ) {
          return new Response(
            JSON.stringify({
              error: 'CYCLE_DETECTED',
              message: `Circular task dependency or parent chain detected involving task ${id}`,
            }),
            { status: 422, headers: { 'Content-Type': 'application/json' } },
          );
        }
        tasksState = tasksState.map((t) => (t.id === id ? { ...t, ...body } : t));
        const updated = tasksState.find((t) => t.id === id) ?? tasksState[0];
        return new Response(JSON.stringify(updated), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/time/timer/start') && method === 'POST') {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        runningTaskId = body.task_id ?? '01963000-0000-7000-8000-000000000801';
        return new Response(
          JSON.stringify({
            running: true,
            session: {
              id: 'sess-active-1',
              task_id: runningTaskId,
              category: body.category ?? 'deep_work',
              timer_mode: body.timer_mode ?? 'pomodoro_25_5',
              started_at: new Date().toISOString(),
              duration_seconds: 0,
              notes: '',
            },
            elapsed_seconds: 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/time/timer/stop') && method === 'POST') {
        runningTaskId = null;
        return new Response(
          JSON.stringify({
            id: 'sess-stopped-1',
            duration_seconds: 1500,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/time/timer') && method === 'GET') {
        return new Response(
          JSON.stringify({
            running: Boolean(runningTaskId),
            session: runningTaskId
              ? {
                  id: 'sess-active-1',
                  task_id: runningTaskId,
                  category: 'deep_work',
                  timer_mode: 'pomodoro_25_5',
                  started_at: new Date().toISOString(),
                  duration_seconds: 120,
                  notes: '',
                }
              : null,
            elapsed_seconds: runningTaskId ? 120 : 0,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/time/sessions') && method === 'GET') {
        return new Response(
          JSON.stringify([
            {
              id: 'sess-hist-1',
              task_id: '01963000-0000-7000-8000-000000000801',
              category: 'deep_work',
              timer_mode: 'pomodoro_25_5',
              started_at: new Date().toISOString(),
              duration_seconds: 1500,
              notes: 'Initial Raft block',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.includes('/api/time/sessions') && method === 'POST') {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        return new Response(
          JSON.stringify({
            id: 'sess-created-1',
            task_id: body.task_id,
            category: body.category ?? 'deep_work',
            timer_mode: body.timer_mode ?? 'pomodoro_25_5',
            started_at: new Date().toISOString(),
            duration_seconds: body.duration_seconds ?? 1500,
            notes: body.notes ?? '',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('renders GTD Smart Perspectives, Today Capacity Meter, and Overload Warning Banner without NaN/Infinity', async () => {
    stubTodosApiMocks({ overloaded: true });
    renderTodosPage();

    await waitFor(() => {
      expect(screen.getByTestId('today-capacity-meter').textContent).toMatch(
        /TODAY CAPACITY \/\/ PLANNED: 720 MIN/i,
      );
      expect(screen.getByTestId('capacity-overload-banner').textContent).toMatch(
        /OVERLOAD WARNING/i,
      );
    });

    // Click through GTD perspective tabs
    for (const pattern of [/inbox/i, /today/i, /upcoming/i, /projects/i, /someday/i, /all tasks/i]) {
      const tab = screen.getByRole('tab', { name: pattern });
      fireEvent.click(tab);
      expect(document.body.textContent).not.toContain('NaN');
      expect(document.body.textContent).not.toContain('Infinity');
    }

    // Verify Today perspective keeps both active and completed today tasks visible
    fireEvent.click(screen.getByRole('tab', { name: /today/i }));
    await waitFor(() => {
      expect(document.body.textContent).toContain('Blocker Alpha Engine');
      expect(document.body.textContent).toContain('Completed Today Telemetry Task');
    });
  });

  it('enforces inline NLP quick-capture as first input[type="text"], rejects whitespace submission, and creates task on valid Enter', async () => {
    const fetchMock = stubTodosApiMocks();
    renderTodosPage();

    await waitFor(() => {
      expect(screen.getByTestId('todos-quick-capture-input')).toBeTruthy();
    });

    const firstTextInput = document.querySelector('input[type="text"]') as HTMLInputElement;
    expect(firstTextInput.getAttribute('data-testid')).toBe('todos-quick-capture-input');

    // Whitespace-only submission must NOT call POST /api/tasks
    fireEvent.change(firstTextInput, { target: { value: '     ' } });
    fireEvent.submit(firstTextInput.closest('form')!);

    const postCallsBefore = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith('/api/tasks') && (init?.method ?? '').toUpperCase() === 'POST',
    );
    expect(postCallsBefore).toHaveLength(0);

    // Valid NLP quick-capture submission
    fireEvent.change(firstTextInput, {
      target: { value: 'Ship Raft Snapshotter #systems @deep_work !high today 45m' },
    });
    expect(screen.getByTestId('todos-quick-capture-preview').textContent).toContain(
      'Ship Raft Snapshotter',
    );

    fireEvent.submit(firstTextInput.closest('form')!);

    await waitFor(() => {
      const postCallsAfter = fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith('/api/tasks') && (init?.method ?? '').toUpperCase() === 'POST',
      );
      expect(postCallsAfter).toHaveLength(1);
      const payload = JSON.parse(String(postCallsAfter[0]?.[1]?.body));
      expect(payload.title).toBe('Ship Raft Snapshotter');
      expect(payload.priority).toBe('high');
      expect(payload.energy_level).toBe('deep');
      expect(payload.estimated_minutes).toBe(45);
      expect(payload.tags).toContain('systems');
    });
  });

  it('switches cleanly across all 3 tactical layouts (Signal List REF-05, Project Flow REF-04, Eisenhower Matrix) without blueprint SVG trap or duplicate timer bars', async () => {
    stubTodosApiMocks();
    renderTodosPage();

    await waitFor(() => {
      expect(screen.getByTestId('signal-list-view')).toBeTruthy();
      expect(screen.getByTestId('signal-dependency-svg')).toBeTruthy();
      expect(
        screen.getByTestId('task-blocked-badge-01963000-0000-7000-8000-000000000802').textContent,
      ).toBe('BLOCKED');
    });

    // Switch to Layout 2: Project Flow (REF-04 TERMINAL-I/O)
    fireEvent.click(screen.getByRole('tab', { name: /flow|terminal/i }));
    await waitFor(() => {
      expect(screen.getByTestId('project-flow-view')).toBeTruthy();
      expect(screen.getByTestId('project-flow-svg')).toBeTruthy();
    });
    expect(document.body.textContent).toContain('CENTRAL ATRIUM');
    expect(document.body.textContent).toContain('STAGE // 01 BACKLOG');
    expect(document.body.textContent).toContain('STAGE // 02 ACTIVE');
    expect(document.body.textContent).toContain('STAGE // 03 REVIEW');
    expect(document.body.textContent).toContain('STAGE // 04 DONE');
    // Must NEVER put data-fui-blueprint on /todos SVGs
    expect(document.querySelectorAll('svg[data-fui-blueprint]').length).toBe(0);

    // Switch to Layout 3: Eisenhower Matrix
    fireEvent.click(screen.getByRole('tab', { name: /matrix|eisenhower/i }));
    await waitFor(() => {
      expect(screen.getByTestId('eisenhower-matrix-view')).toBeTruthy();
    });
    expect(document.body.textContent).toMatch(/URGENT & IMPORTANT/i);
    expect(document.body.textContent).toMatch(/LOW PRIORITY/i);

    // Must not mount any duplicate timer-bar inside TodosPage
    expect(
      document.querySelectorAll('[data-testid*="timer-bar"], [data-fui*="timer"]').length,
    ).toBe(0);
  });

  it('starts and stops Focus Timer via FuiBatteryCapsule play button and surfaces 422 CYCLE_DETECTED in TaskInspectorModal', async () => {
    const fetchMock = stubTodosApiMocks();
    renderTodosPage();

    await waitFor(() => {
      expect(screen.getByTestId('signal-list-view')).toBeTruthy();
    });

    const playTriggers = document.querySelectorAll('[data-fui-part="battery-play-trigger"]');
    expect(playTriggers.length).toBeGreaterThan(0);
    fireEvent.click(playTriggers[0]!);

    await waitFor(() => {
      const startCalls = fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes('/api/time/timer/start') &&
          (init?.method ?? '').toUpperCase() === 'POST',
      );
      expect(startCalls.length).toBe(1);
    });

    // Open TaskInspectorModal on Blocker Alpha and trigger 422 CYCLE_DETECTED
    const inspectBtn = screen.getByTestId(
      'task-inspect-btn-01963000-0000-7000-8000-000000000801',
    );
    fireEvent.click(inspectBtn);

    await waitFor(() => {
      expect(screen.getByTestId('task-inspector-modal')).toBeTruthy();
    });

    const cycleBlockerToggle = screen.getByTestId(
      'inspector-blocker-toggle-01963000-0000-7000-8000-000000000802',
    );
    fireEvent.click(cycleBlockerToggle);
    fireEvent.click(screen.getByTestId('inspector-save-task-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('task-cycle-error-alert').textContent).toContain(
        '422 CYCLE_DETECTED',
      );
    });

    // Search filter zero-state check
    fireEvent.click(screen.getByText('CLOSE'));
    const searchInput = screen.getByTestId('todos-search-input');
    fireEvent.change(searchInput, {
      target: { value: '__NONEXISTENT_QUERY_TOKEN_99999__' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('todos-empty-state')).toBeTruthy();
      expect(document.body.textContent).not.toContain('NaN');
      expect(document.body.textContent).not.toContain('undefined');
    });
  });
});
