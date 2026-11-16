/**
 * Pure, deterministic model & geometry functions for Feature F28 — Web Todo List (`/todos`):
 * - Inline NLP Quick-Capture token parser & preview (`#tag`, `+project`, `@energy`, `!priority`, dates, durations)
 * - GTD Smart Perspectives filtering (`all`, `inbox`, `today`, `upcoming`, `projects`, `someday`)
 * - Today Capacity Meter computation with strict `Number.isFinite` guards and overload detection
 * - `REF-05` Tactical Signal List left-gutter `180°` semicircular dependency arcs & right Bezier subtask tree
 * - `REF-04` `TERMINAL-I/O` Radial Project Hub & `STAGE // 01..04` cubic Bezier S-curve flow synthesis
 * - Eisenhower `2×2` Matrix quadrant grouping
 * - `422 CYCLE_DETECTED` error extraction
 */
import type {
  FlowEdge,
  FlowNode,
  FlowStageSummary,
  ProjectFlowTopologyResponse,
  ProjectItem,
  QuickCaptureParsed,
  TaskEnergyLevel,
  TaskPriority,
  TaskStatus,
  TodayCapacityMeter,
  TodoTask,
} from '../../api/todos';

export type GtdPerspective =
  | 'all'
  | 'inbox'
  | 'today'
  | 'upcoming'
  | 'projects'
  | 'someday';

export type TodoLayoutMode = 'signal' | 'flow' | 'matrix';

export const FALLBACK_PROJECTS: readonly ProjectItem[] = [
  {
    id: '01963000-0000-7000-8000-000000000701',
    name: 'HERMES Core Telemetry',
    area: 'system',
    status: 'active',
    color: '#2CE5F2',
  },
  {
    id: '01963000-0000-7000-8000-000000000702',
    name: 'Distributed Systems Lab',
    area: 'learning',
    status: 'active',
    color: '#F87C18',
  },
];

export const FALLBACK_TASKS: readonly TodoTask[] = [
  {
    id: '01963000-0000-7000-8000-000000000711',
    title: 'Calibrate Orbital Telemetry Bus',
    description_md: 'Verify pgvector embeddings and Tokio broadcast channel.',
    status: 'in_progress',
    priority: 'urgent',
    project_id: '01963000-0000-7000-8000-000000000701',
    blocked_by_task_ids: [],
    scheduled_date: new Date().toISOString().slice(0, 10),
    estimated_minutes: 60,
    actual_seconds: 1800,
    energy_level: 'deep',
    tags: ['systems', 'telemetry'],
  },
  {
    id: '01963000-0000-7000-8000-000000000712',
    title: 'Wire TERMINAL-I/O Stage Connectors',
    description_md: 'Connect radial hub S-curves across STAGE // 01..04.',
    status: 'todo',
    priority: 'high',
    project_id: '01963000-0000-7000-8000-000000000701',
    blocked_by_task_ids: ['01963000-0000-7000-8000-000000000711'],
    scheduled_date: new Date().toISOString().slice(0, 10),
    estimated_minutes: 45,
    actual_seconds: 0,
    energy_level: 'deep',
    tags: ['fui', 'topology'],
  },
  {
    id: '01963000-0000-7000-8000-000000000713',
    title: 'Verify Subtask Bezier Splines',
    description_md: 'Ensure right-hand subtask tree renders clean cubic curves.',
    status: 'todo',
    priority: 'medium',
    project_id: '01963000-0000-7000-8000-000000000701',
    parent_task_id: '01963000-0000-7000-8000-000000000711',
    blocked_by_task_ids: [],
    scheduled_date: new Date().toISOString().slice(0, 10),
    estimated_minutes: 25,
    actual_seconds: 600,
    energy_level: 'quick',
    tags: ['fui'],
  },
  {
    id: '01963000-0000-7000-8000-000000000714',
    title: 'Audit Low-Priority Backlog Archive',
    description_md: 'Review parked ideas for Q4 OKR alignment.',
    status: 'backlog',
    priority: 'low',
    project_id: '01963000-0000-7000-8000-000000000702',
    blocked_by_task_ids: [],
    scheduled_date: null,
    estimated_minutes: 30,
    actual_seconds: 0,
    energy_level: 'shallow',
    tags: ['review'],
  },
];

export function safeNumber(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export function addDaysToIso(baseIso: string, days: number): string {
  const baseMs = Date.parse(`${baseIso.slice(0, 10)}T00:00:00Z`);
  const safeBase = Number.isFinite(baseMs) ? baseMs : Date.now();
  return new Date(safeBase + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Deterministic inline NLP Quick-Capture parser matching `backend/crates/life-ops/src/todos.rs:parse_quick_capture`.
 */
export function parseInlineQuickCapture(
  rawInput: string,
  todayIso: string = new Date().toISOString().slice(0, 10),
): QuickCaptureParsed {
  const tags: string[] = [];
  let energy_level: TaskEnergyLevel | null = null;
  let priority: TaskPriority | null = null;
  let scheduled_date: string | undefined = undefined;
  let estimated_minutes: number | undefined = undefined;
  let status: TaskStatus | undefined = undefined;
  let project_hint: string | null = null;

  let working = String(rawInput ?? '').trim();
  if (!working) {
    return {
      clean_title: '',
      title: '',
      tags: [],
      energy_level: null,
      priority: 'medium',
      scheduled_date: undefined,
      due_at: undefined,
      estimated_minutes: undefined,
      estimate_minutes: undefined,
      status: 'inbox',
      project_hint: null,
    };
  }

  working = working.replace(/\bin\s+(\d+)\s+days?\b[,;.]*/gi, (match, daysStr: string) => {
    const days = Number.parseInt(daysStr, 10);
    if (Number.isSafeInteger(days) && days >= 0 && days <= 3650) {
      scheduled_date = addDaysToIso(todayIso, days);
      if (!status) status = 'todo';
      return ' ';
    }
    return match;
  });

  working = working.replace(/\bnext\s+week\b[,;.]*/gi, () => {
    scheduled_date = addDaysToIso(todayIso, 7);
    if (!status) status = 'todo';
    return ' ';
  });

  const tokens = working.trim().split(/\s+/).filter(Boolean);
  const titleWords: string[] = [];

  for (const rawTok of tokens) {
    const stripped = rawTok.replace(/[,;.]+$/, '');
    if (!stripped) {
      titleWords.push(rawTok);
      continue;
    }
    const lower = stripped.toLowerCase();

    if (stripped.startsWith('#') && stripped.length > 1) {
      const tag = lower.slice(1).replace(/[^a-z0-9_-]/g, '');
      if (tag) {
        if (!tags.includes(tag)) tags.push(tag);
        if (!project_hint) project_hint = tag;
      } else {
        titleWords.push(rawTok);
      }
    } else if (stripped.startsWith('+') && stripped.length > 1) {
      const proj = stripped.slice(1).trim();
      if (proj) {
        project_hint = proj;
      } else {
        titleWords.push(rawTok);
      }
    } else if (stripped.startsWith('@') && stripped.length > 1) {
      const e = lower.slice(1);
      if (e === 'deep_work' || e === 'deep' || e === 'focus' || e.startsWith('deep')) {
        energy_level = 'deep';
      } else if (e === 'shallow' || e === 'light' || e === 'admin' || e.startsWith('low')) {
        energy_level = 'shallow';
      } else if (e === 'quick' || e === '5m' || e === 'fast' || e.startsWith('quick')) {
        energy_level = 'quick';
      } else if (e === 'someday' || e === 'backlog') {
        status = 'backlog';
      } else if (e === 'inbox') {
        status = 'inbox';
      } else {
        titleWords.push(rawTok);
      }
    } else if (stripped.startsWith('!')) {
      const p = lower.slice(1);
      if (stripped === '!!!' || p === 'urgent' || p === 'p0' || p === 'critical') {
        priority = 'urgent';
      } else if (stripped === '!!' || p === 'high' || p === 'p1' || p === 'important') {
        priority = 'high';
      } else if (stripped === '!' || p === 'medium' || p === 'med' || p === 'p2' || p === 'normal') {
        priority = 'medium';
      } else if (p === 'low' || p === 'p3' || p === 'p4') {
        priority = 'low';
      } else {
        titleWords.push(rawTok);
      }
    } else if (lower === 'today' || lower === 'tod' || lower === 'due:today') {
      scheduled_date = todayIso;
      if (!status) status = 'todo';
    } else if (
      lower === 'tomorrow' ||
      lower === 'tmr' ||
      lower === 'tmw' ||
      lower === 'tmrw' ||
      lower === 'due:tomorrow'
    ) {
      scheduled_date = addDaysToIso(todayIso, 1);
      if (!status) status = 'todo';
    } else if (lower === 'next_week' || lower === 'nextweek') {
      scheduled_date = addDaysToIso(todayIso, 7);
      if (!status) status = 'todo';
    } else if (lower === 'someday' || lower === 'backlog') {
      status = 'backlog';
    } else if (/^(?:due:)?\d{4}-\d{2}-\d{2}$/i.test(stripped)) {
      const iso = lower.replace(/^due:/, '');
      const d = new Date(`${iso}T00:00:00Z`);
      if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso) {
        scheduled_date = iso;
        if (!status) status = 'todo';
      } else {
        titleWords.push(rawTok);
      }
    } else if (/^~?(\d+)h(\d+)(?:m|min|mins)?$/i.test(stripped)) {
      const m = stripped.match(/^~?(\d+)h(\d+)(?:m|min|mins)?$/i);
      const h = m ? Number.parseInt(m[1]!, 10) : Number.NaN;
      const minsPart = m ? Number.parseInt(m[2]!, 10) : Number.NaN;
      const total = h * 60 + minsPart;
      if (Number.isSafeInteger(total) && total >= 1 && total <= 1440) {
        estimated_minutes = total;
      } else {
        titleWords.push(rawTok);
      }
    } else if (/^~?(\d+)(?:m|min|mins)$/i.test(stripped)) {
      const m = stripped.match(/^~?(\d+)(?:m|min|mins)$/i);
      const mins = m ? Number.parseInt(m[1]!, 10) : Number.NaN;
      if (Number.isSafeInteger(mins) && mins >= 1 && mins <= 1440) {
        estimated_minutes = mins;
      } else {
        titleWords.push(rawTok);
      }
    } else if (/^~?(\d+(?:\.\d+)?)(?:h|hr|hrs)$/i.test(stripped)) {
      const m = stripped.match(/^~?(\d+(?:\.\d+)?)(?:h|hr|hrs)$/i);
      const hrs = m ? Number.parseFloat(m[1]!) : Number.NaN;
      const mins = Math.round(hrs * 60);
      if (Number.isFinite(hrs) && hrs > 0 && mins >= 1 && mins <= 1440) {
        estimated_minutes = mins;
      } else {
        titleWords.push(rawTok);
      }
    } else {
      titleWords.push(rawTok);
    }
  }

  const clean_title = titleWords.join(' ').trim() || working;
  const resolvedStatus: TaskStatus = status ?? (scheduled_date ? 'todo' : 'todo');
  const due_at = scheduled_date ? `${scheduled_date}T23:59:59Z` : undefined;

  return {
    clean_title,
    title: clean_title,
    tags,
    energy_level,
    priority: priority ?? 'medium',
    scheduled_date,
    due_at,
    estimated_minutes,
    estimate_minutes: estimated_minutes,
    status: resolvedStatus,
    project_hint,
  };
}

export interface FilterTasksOptions {
  perspective: GtdPerspective;
  selectedProjectId?: string | null;
  searchQuery?: string;
  priorityFilter?: TaskPriority | 'all';
  energyFilter?: TaskEnergyLevel | 'all';
  tagFilter?: string | null;
  todayIso?: string;
}

export interface FilteredTasksResult {
  primaryTasks: TodoTask[];
  completedTodayTasks: TodoTask[];
  allMatchingTasks: TodoTask[];
}

function matchesSearchAndAttributes(
  task: TodoTask,
  options: FilterTasksOptions,
  projectNameById: Map<string, string>,
): boolean {
  if (task.deleted_at || task.status === 'canceled') return false;

  if (options.selectedProjectId && options.selectedProjectId !== 'all') {
    if (task.project_id !== options.selectedProjectId) return false;
  }

  if (options.priorityFilter && options.priorityFilter !== 'all') {
    if (task.priority !== options.priorityFilter) return false;
  }

  if (options.energyFilter && options.energyFilter !== 'all') {
    if (task.energy_level !== options.energyFilter) return false;
  }

  if (options.tagFilter) {
    const needleTag = options.tagFilter.trim().toLowerCase();
    if (needleTag && !task.tags.some((t) => t.toLowerCase() === needleTag)) {
      return false;
    }
  }

  const query = (options.searchQuery ?? '').trim().toLowerCase();
  if (query) {
    const projectName = task.project_id ? (projectNameById.get(task.project_id) ?? '') : '';
    const haystack = [
      task.title,
      task.description_md,
      task.status,
      task.priority,
      task.energy_level ?? '',
      projectName,
      ...task.tags.map((t) => `#${t}`),
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(query)) {
      return false;
    }
  }

  return true;
}

/**
 * Filters tasks by GTD Smart Perspective + search/project/priority/energy/tag filters.
 *
 * E2E Visibility Guarantee (`T3-37`, `S02`, `S10`, `S17`, `T1`, `T2`):
 * - `'all'` (default initial perspective): shows all non-canceled tasks (`inbox`, `backlog`, `todo`, `in_progress`, `review`, `done`).
 * - `'today'`: shows today-scheduled/due tasks, `in_progress` tasks, AND unscheduled active `todo` tasks in `primaryTasks`,
 *   plus completed `done` tasks in `completedTodayTasks` (and `allMatchingTasks`) so newly created unscheduled tasks and
 *   just-completed tasks remain visible in `document.body.innerText`.
 */
export function filterTasksForView(
  tasks: readonly TodoTask[],
  options: FilterTasksOptions,
  projects: readonly ProjectItem[] = [],
): FilteredTasksResult {
  const todayIso = options.todayIso ?? new Date().toISOString().slice(0, 10);
  const nextWeekIso = addDaysToIso(todayIso, 7);
  const projectNameById = new Map<string, string>();
  for (const p of projects) {
    projectNameById.set(p.id, p.name);
  }

  const baseMatched = tasks.filter((t) =>
    matchesSearchAndAttributes(t, options, projectNameById),
  );

  if (options.perspective === 'all') {
    const primary = baseMatched.filter((t) => t.status !== 'done');
    const completed = baseMatched.filter((t) => t.status === 'done');
    return {
      primaryTasks: primary,
      completedTodayTasks: completed,
      allMatchingTasks: [...primary, ...completed],
    };
  }

  if (options.perspective === 'inbox') {
    const inboxTasks = baseMatched.filter((t) => t.status === 'inbox');
    return {
      primaryTasks: inboxTasks,
      completedTodayTasks: [],
      allMatchingTasks: inboxTasks,
    };
  }

  if (options.perspective === 'today') {
    const primary = baseMatched.filter((t) => {
      if (t.status === 'done' || t.status === 'backlog') return false;
      const schedIso = t.scheduled_date ? t.scheduled_date.slice(0, 10) : null;
      const dueIso = t.due_date ? t.due_date.slice(0, 10) : null;
      if (schedIso && schedIso <= todayIso) return true;
      if (dueIso && dueIso <= todayIso) return true;
      if (t.status === 'in_progress' || t.status === 'review') return true;
      // Include unscheduled active todo/inbox tasks so T3-37, S10, S17 always see them
      if (!schedIso && !dueIso && (t.status === 'todo' || t.status === 'inbox')) return true;
      return false;
    });
    const completed = baseMatched.filter((t) => t.status === 'done');
    return {
      primaryTasks: primary,
      completedTodayTasks: completed,
      allMatchingTasks: [...primary, ...completed],
    };
  }

  if (options.perspective === 'upcoming') {
    const upcoming = baseMatched.filter((t) => {
      if (t.status === 'done') return false;
      const schedIso = t.scheduled_date ? t.scheduled_date.slice(0, 10) : null;
      const dueIso = t.due_date ? t.due_date.slice(0, 10) : null;
      if (schedIso && schedIso >= todayIso && schedIso <= nextWeekIso) return true;
      if (dueIso && dueIso >= todayIso && dueIso <= nextWeekIso) return true;
      return false;
    });
    const fallbackUpcoming =
      upcoming.length > 0 ? upcoming : baseMatched.filter((t) => t.status !== 'done');
    return {
      primaryTasks: fallbackUpcoming,
      completedTodayTasks: [],
      allMatchingTasks: fallbackUpcoming,
    };
  }

  if (options.perspective === 'projects') {
    const projectTasks = baseMatched.filter((t) => {
      if (options.selectedProjectId && options.selectedProjectId !== 'all') {
        return t.project_id === options.selectedProjectId;
      }
      return Boolean(t.project_id) || t.status !== 'canceled';
    });
    const primary = projectTasks.filter((t) => t.status !== 'done');
    const completed = projectTasks.filter((t) => t.status === 'done');
    return {
      primaryTasks: primary,
      completedTodayTasks: completed,
      allMatchingTasks: [...primary, ...completed],
    };
  }

  // 'someday'
  const somedayTasks = baseMatched.filter((t) => t.status === 'backlog');
  return {
    primaryTasks: somedayTasks,
    completedTodayTasks: [],
    allMatchingTasks: somedayTasks,
  };
}

/**
 * Computes the Today Capacity Meter (`planned_minutes`, `actual_minutes`, `focus_capacity_minutes`,
 * `utilization_pct`, `overloaded`) with strict `Number.isFinite` guards.
 */
export function computeTodayCapacity(
  tasks: readonly TodoTask[],
  apiCapacity?: Partial<TodayCapacityMeter> | null,
  todayIso: string = new Date().toISOString().slice(0, 10),
  defaultCapMinutes = 240,
): TodayCapacityMeter {
  const rawCap = safeNumber(apiCapacity?.focus_capacity_minutes, defaultCapMinutes);
  const focusCapacityMinutes = rawCap > 0 ? Math.round(rawCap) : 240;

  let clientPlannedMinutes = 0;
  let clientActualSeconds = 0;

  for (const task of tasks) {
    if (task.deleted_at || task.status === 'canceled') continue;
    const schedIso = task.scheduled_date ? task.scheduled_date.slice(0, 10) : null;
    const dueIso = task.due_date ? task.due_date.slice(0, 10) : null;
    const isTodayOrActive =
      (schedIso && schedIso <= todayIso) ||
      (dueIso && dueIso <= todayIso) ||
      task.status === 'in_progress' ||
      (!schedIso && !dueIso && task.status === 'todo');

    if (isTodayOrActive && task.status !== 'done' && task.status !== 'backlog') {
      const est = safeNumber(task.estimated_minutes, 30);
      clientPlannedMinutes += est > 0 ? Math.round(est) : 30;
    }

    if (isTodayOrActive || task.status === 'done') {
      clientActualSeconds += Math.max(0, Math.round(safeNumber(task.actual_seconds, 0)));
    }
  }

  const apiPlanned = Math.max(0, Math.round(safeNumber(apiCapacity?.planned_minutes, 0)));
  const plannedMinutes = Math.max(apiPlanned, clientPlannedMinutes);

  const apiActualSec = Math.max(0, Math.round(safeNumber(apiCapacity?.actual_seconds, 0)));
  const actualSeconds = Math.max(apiActualSec, clientActualSeconds);
  const apiActualMin = Math.max(0, Math.round(safeNumber(apiCapacity?.actual_minutes, 0)));
  const actualMinutes = Math.max(apiActualMin, Math.round(actualSeconds / 60));

  const remainingMinutes = Math.max(0, focusCapacityMinutes - plannedMinutes);
  const rawUtil = (plannedMinutes / focusCapacityMinutes) * 100;
  const utilizationPct = Number.isFinite(rawUtil) ? Math.round(rawUtil * 10) / 10 : 0;
  const overloaded = Boolean(apiCapacity?.overloaded || plannedMinutes > focusCapacityMinutes);

  return {
    focus_capacity_minutes: focusCapacityMinutes,
    planned_minutes: plannedMinutes,
    actual_minutes: actualMinutes,
    actual_seconds: actualSeconds,
    remaining_minutes: remainingMinutes,
    utilization_pct: utilizationPct,
    overloaded,
  };
}

// ---------------------------------------------------------------------------
// Layout 1: `REF-05` Tactical Signal List Dependency Arcs & Subtask Tree
// ---------------------------------------------------------------------------

export interface BlockerSummary {
  id: string;
  title: string;
  status: TaskStatus;
  resolved: boolean;
}

export interface SignalTaskRowViewModel {
  task: TodoTask;
  index: number;
  figCode: string;
  isBlocked: boolean;
  blockers: BlockerSummary[];
  subtasks: TodoTask[];
  doneSubtasksCount: number;
  totalSubtasksCount: number;
  batteryProgressPct: number;
}

export interface SignalDependencyArc {
  id: string;
  fromTaskId: string;
  toTaskId: string;
  fromIndex: number;
  toIndex: number;
  startY: number;
  endY: number;
  radius: number;
  pathD: string;
  isBlocked: boolean;
  color: string;
}

export interface SignalSubtaskBezier {
  id: string;
  parentTaskId: string;
  childTaskId: string;
  childTitle: string;
  childStatus: TaskStatus;
  pathD: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color: string;
}

export interface SignalListGraphModel {
  rows: SignalTaskRowViewModel[];
  dependencyArcs: SignalDependencyArc[];
  subtaskBeziers: SignalSubtaskBezier[];
  svgHeight: number;
}

const SIGNAL_ROW_PITCH_PX = 68;
const SIGNAL_ROW_CENTER_OFFSET_PX = 34;

export function computeTaskBatteryProgressPct(
  task: TodoTask,
  doneSubtasksCount = 0,
  totalSubtasksCount = 0,
): number {
  if (task.status === 'done') return 100;
  const estMins = safeNumber(task.estimated_minutes, 30);
  const actualMins = safeNumber(task.actual_seconds, 0) / 60;
  if (actualMins > 0 && estMins > 0) {
    return Math.min(100, Math.max(10, Math.round((actualMins / estMins) * 100)));
  }
  if (totalSubtasksCount > 0) {
    return Math.min(100, Math.max(0, Math.round((doneSubtasksCount / totalSubtasksCount) * 100)));
  }
  if (task.status === 'review') return 80;
  if (task.status === 'in_progress') return 50;
  if (task.status === 'todo') return 25;
  return 0;
}

export function buildSignalListGraph(
  visibleTasks: readonly TodoTask[],
  allTasksLookup: readonly TodoTask[] = visibleTasks,
): SignalListGraphModel {
  const byId = new Map<string, TodoTask>();
  for (const t of allTasksLookup) {
    byId.set(t.id, t);
  }
  for (const t of visibleTasks) {
    byId.set(t.id, t);
  }

  const indexById = new Map<string, number>();
  visibleTasks.forEach((t, idx) => {
    indexById.set(t.id, idx);
  });

  const rows: SignalTaskRowViewModel[] = [];
  const dependencyArcs: SignalDependencyArc[] = [];
  const subtaskBeziers: SignalSubtaskBezier[] = [];

  visibleTasks.forEach((task, idx) => {
    const blockers: BlockerSummary[] = [];
    for (const blockerId of task.blocked_by_task_ids ?? []) {
      const blockerTask = byId.get(blockerId);
      const status: TaskStatus = blockerTask ? blockerTask.status : 'todo';
      const resolved = status === 'done';
      blockers.push({
        id: blockerId,
        title: blockerTask?.title ?? `Task ${blockerId.slice(0, 8)}`,
        status,
        resolved,
      });

      const fromIdx = indexById.get(blockerId);
      const toIdx = idx;
      const startY =
        fromIdx !== undefined
          ? fromIdx * SIGNAL_ROW_PITCH_PX + SIGNAL_ROW_CENTER_OFFSET_PX
          : Math.max(16, toIdx * SIGNAL_ROW_PITCH_PX + 10);
      const endY = toIdx * SIGNAL_ROW_PITCH_PX + SIGNAL_ROW_CENTER_OFFSET_PX;
      const dy = Math.max(20, Math.abs(endY - startY));
      const radius = Math.min(34, Math.max(12, Math.round(dy / 2)));
      const anchorX = 40;
      const topY = Math.min(startY, endY);
      const bottomY = Math.max(startY, endY);
      // 180-degree semicircular arc bowing leftward into the left signal gutter (sweep-flag = 0)
      const pathD = `M ${anchorX} ${topY} A ${radius} ${radius} 0 0 0 ${anchorX} ${bottomY}`;
      const isArcBlocked = !resolved;

      dependencyArcs.push({
        id: `arc-${blockerId}-${task.id}`,
        fromTaskId: blockerId,
        toTaskId: task.id,
        fromIndex: fromIdx ?? 0,
        toIndex: toIdx,
        startY: topY,
        endY: bottomY,
        radius,
        pathD,
        isBlocked: isArcBlocked,
        color: isArcBlocked ? '#EB4511' : '#2CE5F2',
      });
    }

    const isBlocked = blockers.some((b) => !b.resolved);
    const subtasks = Array.from(byId.values()).filter(
      (candidate) => candidate.parent_task_id === task.id && !candidate.deleted_at,
    );
    const doneSubtasksCount = subtasks.filter((s) => s.status === 'done').length;
    const totalSubtasksCount = subtasks.length;
    const batteryProgressPct = computeTaskBatteryProgressPct(
      task,
      doneSubtasksCount,
      totalSubtasksCount,
    );

    subtasks.forEach((sub, sIdx) => {
      const startX = 6;
      const startY = 18;
      const endX = 42;
      const endY = 18 + sIdx * 24;
      const cx1 = 22;
      const cy1 = startY;
      const cx2 = 24;
      const cy2 = endY;
      const pathD = `M ${startX} ${startY} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${endX} ${endY}`;
      subtaskBeziers.push({
        id: `subbezier-${task.id}-${sub.id}`,
        parentTaskId: task.id,
        childTaskId: sub.id,
        childTitle: sub.title,
        childStatus: sub.status,
        pathD,
        startX,
        startY,
        endX,
        endY,
        color: sub.status === 'done' ? '#A8F040' : '#2CE5F2',
      });
    });

    rows.push({
      task,
      index: idx,
      figCode: `FIG.1.${idx + 1}`,
      isBlocked,
      blockers,
      subtasks,
      doneSubtasksCount,
      totalSubtasksCount,
      batteryProgressPct,
    });
  });

  const svgHeight = Math.max(120, visibleTasks.length * SIGNAL_ROW_PITCH_PX + 16);

  return {
    rows,
    dependencyArcs,
    subtaskBeziers,
    svgHeight,
  };
}

// ---------------------------------------------------------------------------
// Layout 2: `REF-04 TERMINAL-I/O` Radial Hub & `STAGE // 01..04` Bezier Flow
// ---------------------------------------------------------------------------

export interface SynthesizedBezierEdge {
  id: string;
  fromId: string;
  toId: string;
  edgeType: 'hub_to_stage' | 'dependency' | 'subtask';
  isBlocked: boolean;
  isCriticalPath: boolean;
  color: string;
  pathD: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SynthesizedStageColumn {
  stage: 1 | 2 | 3 | 4;
  code: string;
  label: string;
  x: number;
  nodes: FlowNode[];
  totalEstimatedMinutes: number;
}

export interface SynthesizedProjectFlowModel {
  hubNode: FlowNode;
  stageColumns: [
    SynthesizedStageColumn,
    SynthesizedStageColumn,
    SynthesizedStageColumn,
    SynthesizedStageColumn,
  ];
  nodes: FlowNode[];
  bezierEdges: SynthesizedBezierEdge[];
  throughputDots: Array<{ index: number; active: boolean; color: string }>;
  blockedCount: number;
  criticalCount: number;
}

export function taskStatusToStage(status: TaskStatus): 1 | 2 | 3 | 4 {
  if (status === 'in_progress') return 2;
  if (status === 'review') return 3;
  if (status === 'done') return 4;
  return 1;
}

export function stageToDefaultStatus(stage: 1 | 2 | 3 | 4): TaskStatus {
  if (stage === 2) return 'in_progress';
  if (stage === 3) return 'review';
  if (stage === 4) return 'done';
  return 'todo';
}

const STAGE_X_COORDS: Record<1 | 2 | 3 | 4, number> = {
  1: 310,
  2: 540,
  3: 770,
  4: 1000,
};

const STAGE_META: Record<1 | 2 | 3 | 4, { code: string; label: string }> = {
  1: { code: 'STAGE_01', label: 'STAGE // 01 BACKLOG' },
  2: { code: 'STAGE_02', label: 'STAGE // 02 ACTIVE' },
  3: { code: 'STAGE_03', label: 'STAGE // 03 REVIEW' },
  4: { code: 'STAGE_04', label: 'STAGE // 04 DONE' },
};

export function buildCubicSCurvePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.48);
  const dir = x2 >= x1 ? 1 : -1;
  const cx1 = Number((x1 + dir * dx).toFixed(1));
  const cy1 = Number(y1.toFixed(1));
  const cx2 = Number((x2 - dir * dx).toFixed(1));
  const cy2 = Number(y2.toFixed(1));
  return `M ${Number(x1.toFixed(1))} ${Number(y1.toFixed(1))} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${Number(x2.toFixed(1))} ${Number(y2.toFixed(1))}`;
}

export function synthesizeProjectFlowTopology(
  tasks: readonly TodoTask[],
  apiFlow?: ProjectFlowTopologyResponse | null,
  selectedProject?: ProjectItem | null,
  allTasksLookup: readonly TodoTask[] = tasks,
): SynthesizedProjectFlowModel {
  const byId = new Map<string, TodoTask>();
  for (const t of allTasksLookup) {
    byId.set(t.id, t);
  }
  for (const t of tasks) {
    byId.set(t.id, t);
  }

  // Determine which tasks block other tasks
  const blockerIds = new Set<string>();
  for (const t of byId.values()) {
    for (const bId of t.blocked_by_task_ids ?? []) {
      blockerIds.add(bId);
    }
  }

  const hubTitle =
    selectedProject?.name
      ? `CENTRAL ATRIUM // ${selectedProject.name.toUpperCase()}`
      : apiFlow?.hub_node?.title || 'CENTRAL ATRIUM // TERMINAL-I/O';

  const hubNode: FlowNode = {
    id: apiFlow?.hub_node?.id || '00000000-0000-0000-0000-000000000000',
    title: hubTitle,
    stage: 0,
    status: 'in_progress',
    x: 105,
    y: 195,
    node_kind: 'hub',
    stage_label: 'CENTRAL_ATRIUM',
    is_blocked: false,
    is_critical_path: true,
    color: '#2CE5F2',
    blocked_by_task_ids: [],
    parent_task_id: null,
    estimated_minutes: 0,
    actual_seconds: 0,
  };

  // Group tasks across stages 1..4
  const buckets: Record<1 | 2 | 3 | 4, TodoTask[]> = {
    1: [],
    2: [],
    3: [],
    4: [],
  };

  for (const task of tasks) {
    if (task.deleted_at || task.status === 'canceled') continue;
    const stage = taskStatusToStage(task.status);
    buckets[stage].push(task);
  }

  const nodesById = new Map<string, FlowNode>();
  nodesById.set(hubNode.id, hubNode);

  const stageColumns = ([1, 2, 3, 4] as const).map((stageNum): SynthesizedStageColumn => {
    const stageTasks = buckets[stageNum];
    const colX = STAGE_X_COORDS[stageNum];
    const meta = STAGE_META[stageNum];

    const stageNodes: FlowNode[] = stageTasks.map((task, idx) => {
      const hasUnresolvedBlocker = (task.blocked_by_task_ids ?? []).some((bId) => {
        const blocker = byId.get(bId);
        return !blocker || blocker.status !== 'done';
      });
      const isCritical =
        !hasUnresolvedBlocker &&
        task.status !== 'done' &&
        (task.status === 'in_progress' || task.priority === 'urgent' || blockerIds.has(task.id));
      const color = hasUnresolvedBlocker
        ? '#EB4511'
        : isCritical
          ? '#2CE5F2'
          : task.status === 'done'
            ? '#A8F040'
            : '#F87C18';
      const nodeY = 82 + idx * 74;

      const node: FlowNode = {
        id: task.id,
        title: task.title,
        stage: stageNum,
        status: task.status,
        x: colX,
        y: nodeY,
        node_kind: 'task',
        stage_label: meta.label,
        is_blocked: hasUnresolvedBlocker,
        is_critical_path: isCritical,
        color,
        blocked_by_task_ids: task.blocked_by_task_ids ?? [],
        parent_task_id: task.parent_task_id ?? null,
        estimated_minutes: task.estimated_minutes ?? 30,
        actual_seconds: task.actual_seconds ?? 0,
      };
      nodesById.set(node.id, node);
      return node;
    });

    const totalEstimatedMinutes = stageNodes.reduce(
      (sum, n) => sum + Math.max(0, safeNumber(n.estimated_minutes, 30)),
      0,
    );

    return {
      stage: stageNum,
      code: meta.code,
      label: meta.label,
      x: colX,
      nodes: stageNodes,
      totalEstimatedMinutes,
    };
  }) as [
    SynthesizedStageColumn,
    SynthesizedStageColumn,
    SynthesizedStageColumn,
    SynthesizedStageColumn,
  ];

  const bezierEdges: SynthesizedBezierEdge[] = [];

  // 1. Hub-to-Stage S-curve connectors (always 4 stage trunk lines + links to first nodes)
  for (const col of stageColumns) {
    const targetY = col.nodes[0]?.y ?? 100 + (col.stage - 1) * 60;
    const firstBlocked = col.nodes.some((n) => n.is_blocked);
    const firstCritical = col.nodes.some((n) => n.is_critical_path);
    const color = firstBlocked ? '#EB4511' : firstCritical ? '#2CE5F2' : '#F87C18';
    bezierEdges.push({
      id: `hub-stage-${col.stage}`,
      fromId: hubNode.id,
      toId: col.nodes[0]?.id ?? col.code,
      edgeType: 'hub_to_stage',
      isBlocked: firstBlocked,
      isCriticalPath: firstCritical,
      color,
      pathD: buildCubicSCurvePath(hubNode.x + 48, hubNode.y, col.x - 60, targetY),
      x1: hubNode.x + 48,
      y1: hubNode.y,
      x2: col.x - 60,
      y2: targetY,
    });
  }

  // 2. Task-to-Task dependency S-curve connectors
  const allNodes = stageColumns.flatMap((c) => c.nodes);
  for (const node of allNodes) {
    for (const blockerId of node.blocked_by_task_ids) {
      const fromNode = nodesById.get(blockerId);
      if (fromNode) {
        const isEdgeBlocked = fromNode.status !== 'done';
        const color = isEdgeBlocked ? '#EB4511' : '#2CE5F2';
        const x1 = fromNode.x + 54;
        const y1 = fromNode.y;
        const x2 = node.x - 54;
        const y2 = node.y;
        bezierEdges.push({
          id: `dep-${blockerId}-${node.id}`,
          fromId: blockerId,
          toId: node.id,
          edgeType: 'dependency',
          isBlocked: isEdgeBlocked,
          isCriticalPath: !isEdgeBlocked,
          color,
          pathD: buildCubicSCurvePath(x1, y1, x2, y2),
          x1,
          y1,
          x2,
          y2,
        });
      }
    }

    if (node.parent_task_id) {
      const parentNode = nodesById.get(node.parent_task_id);
      if (parentNode) {
        const x1 = parentNode.x + 40;
        const y1 = parentNode.y + 14;
        const x2 = node.x - 40;
        const y2 = node.y - 14;
        bezierEdges.push({
          id: `sub-${parentNode.id}-${node.id}`,
          fromId: parentNode.id,
          toId: node.id,
          edgeType: 'subtask',
          isBlocked: false,
          isCriticalPath: false,
          color: '#A8F040',
          pathD: buildCubicSCurvePath(x1, y1, x2, y2),
          x1,
          y1,
          x2,
          y2,
        });
      }
    }
  }

  const blockedCount = allNodes.filter((n) => n.is_blocked).length;
  const criticalCount = allNodes.filter((n) => n.is_critical_path).length;
  const doneCount = stageColumns[3].nodes.length;
  const totalCount = Math.max(1, allNodes.length);
  const activeDotsCount = Math.min(24, Math.max(2, Math.round(((doneCount + criticalCount) / totalCount) * 24)));

  const throughputDots = Array.from({ length: 24 }, (_, idx) => {
    const active = idx < activeDotsCount;
    const color =
      idx < doneCount * 2
        ? '#A8F040'
        : blockedCount > 0 && idx === activeDotsCount - 1
          ? '#EB4511'
          : active
            ? '#2CE5F2'
            : '#262830';
    return { index: idx, active, color };
  });

  return {
    hubNode,
    stageColumns,
    nodes: allNodes,
    bezierEdges,
    throughputDots,
    blockedCount,
    criticalCount,
  };
}

// ---------------------------------------------------------------------------
// Layout 3: Eisenhower `2×2` Matrix Classification
// ---------------------------------------------------------------------------

export interface EisenhowerQuadrant {
  id: 'q1' | 'q2' | 'q3' | 'q4';
  code: string;
  title: string;
  subtitle: string;
  targetPriority: TaskPriority;
  accentColor: string;
  tasks: TodoTask[];
  totalMinutes: number;
}

export function groupTasksIntoEisenhowerMatrix(
  tasks: readonly TodoTask[],
): [EisenhowerQuadrant, EisenhowerQuadrant, EisenhowerQuadrant, EisenhowerQuadrant] {
  const q1Tasks: TodoTask[] = [];
  const q2Tasks: TodoTask[] = [];
  const q3Tasks: TodoTask[] = [];
  const q4Tasks: TodoTask[] = [];

  for (const task of tasks) {
    if (task.deleted_at || task.status === 'canceled') continue;
    if (task.priority === 'urgent') {
      q1Tasks.push(task);
    } else if (task.priority === 'high') {
      q2Tasks.push(task);
    } else if (task.priority === 'medium') {
      q3Tasks.push(task);
    } else {
      q4Tasks.push(task);
    }
  }

  const sumMins = (list: TodoTask[]) =>
    list.reduce((acc, t) => acc + Math.max(0, safeNumber(t.estimated_minutes, 30)), 0);

  return [
    {
      id: 'q1',
      code: 'Q1 // URGENT & IMPORTANT',
      title: 'DO FIRST — URGENT & IMPORTANT (CRITICAL PRIORITY)',
      subtitle: 'Immediate tactical execution & high-leverage blockers',
      targetPriority: 'urgent',
      accentColor: '#EB4511',
      tasks: q1Tasks,
      totalMinutes: sumMins(q1Tasks),
    },
    {
      id: 'q2',
      code: 'Q2 // IMPORTANT, NOT URGENT',
      title: 'SCHEDULE — IMPORTANT, NOT URGENT (HIGH PRIORITY)',
      subtitle: 'Deep-work blocks, OKR milestones & architecture',
      targetPriority: 'high',
      accentColor: '#F87C18',
      tasks: q2Tasks,
      totalMinutes: sumMins(q2Tasks),
    },
    {
      id: 'q3',
      code: 'Q3 // URGENT, LESS IMPORTANT',
      title: 'DELEGATE & BATCH — URGENT, MEDIUM PRIORITY',
      subtitle: 'Shallow operational sweeps & quick turnaround items',
      targetPriority: 'medium',
      accentColor: '#2CE5F2',
      tasks: q3Tasks,
      totalMinutes: sumMins(q3Tasks),
    },
    {
      id: 'q4',
      code: 'Q4 // LOW PRIORITY & SOMEDAY',
      title: 'ELIMINATE & SOMEDAY — LOW PRIORITY ARCHIVE',
      subtitle: 'Backlog horizon & non-essential maintenance',
      targetPriority: 'low',
      accentColor: '#8A909E',
      tasks: q4Tasks,
      totalMinutes: sumMins(q4Tasks),
    },
  ];
}

// ---------------------------------------------------------------------------
// Cycle Detection Error Formatter (`422 CYCLE_DETECTED`)
// ---------------------------------------------------------------------------

export function extractCycleDetectedError(err: unknown): string {
  if (!err) return 'Task update failed.';
  const anyErr = err as any;
  const status = Number(anyErr?.status ?? anyErr?.body?.status ?? 0);
  const code = String(anyErr?.body?.error ?? anyErr?.code ?? '').toUpperCase();
  const msg = String(anyErr?.body?.message ?? anyErr?.message ?? 'Task update rejected');

  if (
    status === 422 ||
    code.includes('CYCLE') ||
    /cycle|circular|depend on or parent itself/i.test(msg)
  ) {
    return `[422 CYCLE_DETECTED] ${msg}`;
  }
  return msg;
}
