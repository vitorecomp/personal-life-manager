import { describe, expect, it } from 'vitest';
import {
  buildSignalListGraph,
  computeTodayCapacity,
  extractCycleDetectedError,
  FALLBACK_PROJECTS,
  FALLBACK_TASKS,
  filterTasksForView,
  groupTasksIntoEisenhowerMatrix,
  parseInlineQuickCapture,
  synthesizeProjectFlowTopology,
} from './todosModel';
import type { TodoTask } from '../../api/todos';

describe('todosModel — Pure Model & Geometry Suite (F28)', () => {
  it('parses inline NLP quick-capture tokens (#tag, +project, @energy, !priority, dates, durations)', () => {
    const parsed = parseInlineQuickCapture(
      'Ship S02 Telemetry Parser #systems #rust +HermesCore @deep_work !urgent today 90m',
      '2026-11-15',
    );
    expect(parsed.clean_title).toBe('Ship S02 Telemetry Parser');
    expect(parsed.tags).toEqual(['systems', 'rust']);
    expect(parsed.project_hint).toBe('HermesCore');
    expect(parsed.energy_level).toBe('deep');
    expect(parsed.priority).toBe('urgent');
    expect(parsed.scheduled_date).toBe('2026-11-15');
    expect(parsed.estimated_minutes).toBe(90);
    expect(parsed.status).toBe('todo');

    const tmr = parseInlineQuickCapture('Review notes @quick !low tomorrow 1.5h', '2026-11-15');
    expect(tmr.clean_title).toBe('Review notes');
    expect(tmr.energy_level).toBe('quick');
    expect(tmr.priority).toBe('low');
    expect(tmr.scheduled_date).toBe('2026-11-16');
    expect(tmr.estimated_minutes).toBe(90);

    const blank = parseInlineQuickCapture('    ', '2026-11-15');
    expect(blank.clean_title).toBe('');
  });

  it('filters tasks across GTD perspectives and preserves unscheduled active and completed tasks on All & Today views', () => {
    const today = '2026-11-15';
    const sampleTasks: TodoTask[] = [
      {
        id: 't-inbox',
        title: 'Inbox Triage Item',
        description_md: '',
        status: 'inbox',
        priority: 'medium',
        blocked_by_task_ids: [],
        actual_seconds: 0,
        tags: ['triage'],
      },
      {
        id: 't-unscheduled-todo',
        title: 'T3-37 Offline Mobile Todo',
        description_md: '',
        status: 'todo',
        priority: 'high',
        blocked_by_task_ids: [],
        scheduled_date: null,
        actual_seconds: 0,
        tags: [],
      },
      {
        id: 't-done-today',
        title: 'Ship S02 Telemetry Parser',
        description_md: '',
        status: 'done',
        priority: 'high',
        blocked_by_task_ids: [],
        scheduled_date: today,
        actual_seconds: 1500,
        tags: ['systems'],
      },
      {
        id: 't-someday',
        title: 'Someday Horizon Idea',
        description_md: '',
        status: 'backlog',
        priority: 'low',
        blocked_by_task_ids: [],
        actual_seconds: 0,
        tags: [],
      },
    ];

    const allView = filterTasksForView(sampleTasks, { perspective: 'all', todayIso: today });
    expect(allView.allMatchingTasks.map((t) => t.id)).toContain('t-unscheduled-todo');
    expect(allView.allMatchingTasks.map((t) => t.id)).toContain('t-done-today');

    const todayView = filterTasksForView(sampleTasks, { perspective: 'today', todayIso: today });
    expect(todayView.primaryTasks.map((t) => t.id)).toContain('t-unscheduled-todo');
    expect(todayView.completedTodayTasks.map((t) => t.id)).toContain('t-done-today');
    expect(todayView.allMatchingTasks.map((t) => t.id)).toContain('t-done-today');

    const inboxView = filterTasksForView(sampleTasks, { perspective: 'inbox', todayIso: today });
    expect(inboxView.primaryTasks.map((t) => t.id)).toEqual(['t-inbox']);

    const somedayView = filterTasksForView(sampleTasks, { perspective: 'someday', todayIso: today });
    expect(somedayView.primaryTasks.map((t) => t.id)).toEqual(['t-someday']);

    const emptySearch = filterTasksForView(sampleTasks, {
      perspective: 'all',
      searchQuery: '__NONEXISTENT_QUERY_TOKEN_99999__',
      todayIso: today,
    });
    expect(emptySearch.allMatchingTasks).toHaveLength(0);
  });

  it('computes Today Capacity Meter and flags overload when planned minutes exceed daily focus capacity', () => {
    const today = '2026-11-15';
    const heavyTasks: TodoTask[] = [1, 2, 3, 4].map((idx) => ({
      id: `heavy-${idx}`,
      title: `Overload Task ${idx}`,
      description_md: '',
      status: 'todo',
      priority: 'urgent',
      blocked_by_task_ids: [],
      scheduled_date: today,
      estimated_minutes: 180,
      actual_seconds: 600,
      tags: [],
    }));

    const cap = computeTodayCapacity(heavyTasks, null, today, 240);
    expect(cap.focus_capacity_minutes).toBe(240);
    expect(cap.planned_minutes).toBe(720);
    expect(cap.actual_minutes).toBe(40);
    expect(cap.overloaded).toBe(true);
    expect(cap.utilization_pct).toBe(300);
    expect(Number.isFinite(cap.utilization_pct)).toBe(true);
  });

  it('builds REF-05 Signal List 180-degree semicircular dependency arcs and cubic Bezier subtask connectors', () => {
    const graph = buildSignalListGraph(FALLBACK_TASKS);
    expect(graph.rows).toHaveLength(FALLBACK_TASKS.length);

    const blockedRow = graph.rows.find((r) => r.task.id === '01963000-0000-7000-8000-000000000712');
    expect(blockedRow?.isBlocked).toBe(true);

    expect(graph.dependencyArcs.length).toBeGreaterThanOrEqual(1);
    expect(graph.dependencyArcs[0]?.pathD).toMatch(/^M \d+ \d+ A \d+ \d+ 0 0 0 \d+ \d+$/);
    expect(graph.dependencyArcs[0]?.color).toBe('#EB4511');

    expect(graph.subtaskBeziers.length).toBeGreaterThanOrEqual(1);
    expect(graph.subtaskBeziers[0]?.pathD).toMatch(/^M \d+ \d+ C /);
  });

  it('synthesizes REF-04 TERMINAL-I/O Radial Hub, STAGE // 01..04 columns, and cubic Bezier S-curves', () => {
    const flow = synthesizeProjectFlowTopology(FALLBACK_TASKS, null, FALLBACK_PROJECTS[0]);
    expect(flow.hubNode.title).toContain('CENTRAL ATRIUM');
    expect(flow.stageColumns).toHaveLength(4);
    expect(flow.stageColumns.map((c) => c.label)).toEqual([
      'STAGE // 01 BACKLOG',
      'STAGE // 02 ACTIVE',
      'STAGE // 03 REVIEW',
      'STAGE // 04 DONE',
    ]);
    expect(flow.bezierEdges.length).toBeGreaterThanOrEqual(4);
    expect(flow.bezierEdges[0]?.pathD).toMatch(/^M .* C /);
    expect(flow.blockedCount).toBeGreaterThanOrEqual(1);
    expect(flow.throughputDots).toHaveLength(24);
  });

  it('groups tasks into the 4 Eisenhower Matrix quadrants and formats 422 CYCLE_DETECTED errors', () => {
    const quadrants = groupTasksIntoEisenhowerMatrix(FALLBACK_TASKS);
    expect(quadrants).toHaveLength(4);
    expect(quadrants[0].tasks.some((t) => t.priority === 'urgent')).toBe(true);
    expect(quadrants[1].tasks.some((t) => t.priority === 'high')).toBe(true);
    expect(quadrants[2].tasks.some((t) => t.priority === 'medium')).toBe(true);
    expect(quadrants[3].tasks.some((t) => t.priority === 'low')).toBe(true);

    const cycleMsg = extractCycleDetectedError({
      status: 422,
      body: {
        error: 'CYCLE_DETECTED',
        message: 'Circular task dependency or parent chain detected',
      },
    });
    expect(cycleMsg).toContain('422 CYCLE_DETECTED');
  });
});
