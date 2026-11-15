/**
 * Typed REST client bindings for Module 07 — Todo List & Project Execution (`/todos`, F28):
 * - `/api/projects` CRUD & `/api/projects/{id}/flow`
 * - `/api/tasks` CRUD, `/api/tasks/perspectives/{perspective}`, `/api/tasks/parse`, `/api/tasks/bulk`
 * - `/api/tasks/flow` (`REF-04 TERMINAL-I/O` topology) & `/api/tasks/capacity` (Today Capacity Meter)
 * - `/api/time/timer` (`start`, `stop`, `discard`), `/api/time/sessions`, `/api/time/stats`
 *
 * Uses `./client` (`apiGet`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete`, `unwrapList`) so Vitest
 * `globalThis.fetch` spies and production runtime share identical behavior.
 */
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  isValidIsoCalendarDate,
  normalizeTaskEnergyLevel,
  toRfc3339DueDate,
  unwrapList,
  type QuickCaptureParsed,
} from './client';

export type { QuickCaptureParsed };

export type TaskStatus =
  | 'inbox'
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'review'
  | 'done'
  | 'canceled';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type TaskEnergyLevel = 'deep' | 'shallow' | 'quick';

export type ProjectArea =
  | 'work'
  | 'personal'
  | 'health'
  | 'learning'
  | 'system'
  | 'finance';

export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived';

export type TimerMode =
  | 'stopwatch'
  | 'pomodoro_25_5'
  | 'pomodoro_50_10'
  | 'pomodoro_90_15'
  | 'pomodoro_custom';

export type TimeCategory =
  | 'deep_work'
  | 'learning'
  | 'health'
  | 'exercise'
  | 'admin'
  | 'maintenance'
  | 'rest';

export interface ProjectItem {
  id: string;
  name: string;
  area: ProjectArea;
  goal_id?: string | null;
  status: ProjectStatus;
  color: string;
  task_count?: number;
  completed_task_count?: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface CreateProjectPayload {
  name: string;
  area?: ProjectArea | string;
  goal_id?: string | null;
  status?: ProjectStatus;
  color?: string;
}

export interface UpdateProjectPayload {
  name?: string;
  area?: ProjectArea | string;
  goal_id?: string | null;
  status?: ProjectStatus;
  color?: string;
}

export interface TodoTask {
  id: string;
  title: string;
  description_md: string;
  status: TaskStatus;
  priority: TaskPriority;
  project_id?: string | null;
  goal_id?: string | null;
  course_id?: string | null;
  lesson_id?: string | null;
  parent_task_id?: string | null;
  blocked_by_task_ids: string[];
  vault_note_path?: string | null;
  scheduled_date?: string | null;
  due_date?: string | null;
  estimated_minutes?: number | null;
  actual_seconds: number;
  energy_level?: TaskEnergyLevel | null;
  tags: string[];
  recurrence_rule?: string | null;
  sort_order?: number;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface CreateTaskPayload {
  title?: string;
  quick_capture?: string;
  description_md?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  project_id?: string | null;
  goal_id?: string | null;
  course_id?: string | null;
  lesson_id?: string | null;
  parent_task_id?: string | null;
  blocked_by_task_ids?: string[];
  vault_note_path?: string | null;
  scheduled_date?: string | null;
  due_date?: string | null;
  estimated_minutes?: number | null;
  energy_level?: TaskEnergyLevel | string | null;
  tags?: string[];
  recurrence_rule?: string | null;
  sort_order?: number;
}

export interface UpdateTaskPayload {
  title?: string;
  description_md?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  project_id?: string | null;
  goal_id?: string | null;
  course_id?: string | null;
  lesson_id?: string | null;
  parent_task_id?: string | null;
  blocked_by_task_ids?: string[];
  vault_note_path?: string | null;
  scheduled_date?: string | null;
  due_date?: string | null;
  estimated_minutes?: number | null;
  actual_seconds?: number;
  energy_level?: TaskEnergyLevel | string | null;
  tags?: string[];
  recurrence_rule?: string | null;
  sort_order?: number;
}

export interface BulkUpdateTasksPayload {
  task_ids: string[];
  status?: TaskStatus;
  priority?: TaskPriority;
  project_id?: string | null;
  goal_id?: string | null;
  energy_level?: TaskEnergyLevel | null;
  scheduled_date?: string | null;
  delete?: boolean;
}

export interface TaskListFilterParams {
  perspective?: string;
  status?: TaskStatus;
  project_id?: string;
  goal_id?: string;
  course_id?: string;
  parent_task_id?: string;
  priority?: TaskPriority;
  energy_level?: TaskEnergyLevel;
  due_before?: string;
  scheduled_date?: string;
  tag?: string;
  search?: string;
}

export interface TodayCapacityMeter {
  focus_capacity_minutes: number;
  planned_minutes: number;
  actual_minutes: number;
  actual_seconds: number;
  remaining_minutes: number;
  utilization_pct: number;
  overloaded: boolean;
}

export interface FlowNode {
  id: string;
  title: string;
  stage: number;
  status: TaskStatus;
  x: number;
  y: number;
  node_kind: string;
  stage_label: string;
  is_blocked: boolean;
  is_critical_path: boolean;
  color: string;
  blocked_by_task_ids: string[];
  parent_task_id?: string | null;
  estimated_minutes?: number | null;
  actual_seconds: number;
}

export interface FlowEdge {
  from_id: string;
  to_id: string;
  edge_type: 'hub_to_stage' | 'hub_link' | 'dependency' | 'subtask' | string;
  is_blocked: boolean;
}

export interface FlowStageSummary {
  stage: number;
  code: string;
  label: string;
  task_ids: string[];
  total_estimated_minutes: number;
}

export interface ProjectFlowTopologyResponse {
  project_id?: string | null;
  hub_node?: FlowNode;
  stages?: FlowStageSummary[];
  nodes: FlowNode[];
  edges: FlowEdge[];
  dependency_arcs?: FlowEdge[];
  subtask_edges?: FlowEdge[];
  capacity?: TodayCapacityMeter;
}

export interface TimeSessionItem {
  id: string;
  task_id?: string | null;
  course_id?: string | null;
  lesson_id?: string | null;
  category: TimeCategory | string;
  timer_mode: TimerMode | string;
  work_minutes?: number | null;
  break_minutes?: number | null;
  started_at: string;
  ended_at?: string | null;
  duration_seconds: number;
  notes: string;
  created_at?: string;
  updated_at?: string;
}

export interface ActiveTimerResponse {
  running: boolean;
  session: TimeSessionItem | null;
  elapsed_seconds: number;
}

export interface StartTimerPayload {
  task_id?: string | null;
  course_id?: string | null;
  lesson_id?: string | null;
  category?: TimeCategory | string;
  timer_mode?: TimerMode | string;
  work_minutes?: number | null;
  break_minutes?: number | null;
  notes?: string;
}

export interface StopTimerPayload {
  notes?: string;
  duration_seconds?: number;
}

export interface CreateTimeSessionPayload {
  task_id?: string | null;
  course_id?: string | null;
  lesson_id?: string | null;
  category?: TimeCategory | string;
  timer_mode?: TimerMode | string;
  work_minutes?: number | null;
  break_minutes?: number | null;
  started_at?: string;
  ended_at?: string;
  duration_seconds: number;
  notes?: string;
}

export interface TimeStatsResponse {
  today_seconds: number;
  week_seconds: number;
  deep_work_week_seconds: number;
  learning_week_seconds: number;
  hourly_buckets_24h: number[];
  barcode_buckets_96: number[];
  focus_capacity_minutes: number;
  planned_today_minutes: number;
  actual_today_minutes: number;
  capacity?: TodayCapacityMeter;
}

const VALID_STATUSES: readonly TaskStatus[] = [
  'inbox',
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'canceled',
];

const VALID_PRIORITIES: readonly TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

const VALID_AREAS: readonly ProjectArea[] = [
  'work',
  'personal',
  'health',
  'learning',
  'system',
  'finance',
];

export function normalizeTaskStatus(raw: unknown): TaskStatus {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
  if (s === 'completed' || s === 'complete') return 'done';
  if (s === 'active' || s === 'doing') return 'in_progress';
  if (s === 'someday') return 'backlog';
  if ((VALID_STATUSES as readonly string[]).includes(s)) {
    return s as TaskStatus;
  }
  return 'todo';
}

export function normalizeTaskPriority(raw: unknown): TaskPriority {
  const p = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (p === 'p0' || p === 'critical' || p === 'urgent') return 'urgent';
  if (p === 'p1' || p === 'high' || p === 'important') return 'high';
  if (p === 'p2' || p === 'medium' || p === 'med' || p === 'normal') return 'medium';
  if (p === 'p3' || p === 'p4' || p === 'low') return 'low';
  if ((VALID_PRIORITIES as readonly string[]).includes(p)) {
    return p as TaskPriority;
  }
  return 'medium';
}

export function normalizeProjectArea(raw: unknown): ProjectArea {
  const a = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (a === 'systems' || a === 'infra' || a === 'ops') return 'system';
  if ((VALID_AREAS as readonly string[]).includes(a)) {
    return a as ProjectArea;
  }
  return 'system';
}

export function normalizeTodoTask(raw: any): TodoTask {
  const obj =
    raw && typeof raw === 'object' && raw.task && !raw.id
      ? raw.task
      : raw && typeof raw === 'object' && raw.data && !raw.id
        ? raw.data
        : raw ?? {};
  const blockedRaw =
    obj.blocked_by_task_ids ??
    obj.depends_on ??
    obj.dependency_ids ??
    obj.dependencies ??
    obj.blocked_by ??
    [];
  const tagsRaw = Array.isArray(obj.tags) ? obj.tags : [];
  const estRaw = obj.estimated_minutes ?? obj.estimate_minutes ?? obj.duration_mins;
  const estNum = estRaw !== null && estRaw !== undefined ? Number(estRaw) : null;
  const actualRaw = Number(obj.actual_seconds ?? 0);

  return {
    id: String(obj.id ?? ''),
    title: String(obj.title ?? obj.name ?? '').trim() || 'Untitled Task',
    description_md: String(obj.description_md ?? obj.description ?? ''),
    status: normalizeTaskStatus(obj.status),
    priority: normalizeTaskPriority(obj.priority),
    project_id: obj.project_id ? String(obj.project_id) : null,
    goal_id: obj.goal_id ? String(obj.goal_id) : null,
    course_id: obj.course_id ? String(obj.course_id) : null,
    lesson_id: obj.lesson_id ? String(obj.lesson_id) : null,
    parent_task_id: obj.parent_task_id ? String(obj.parent_task_id) : null,
    blocked_by_task_ids: Array.isArray(blockedRaw)
      ? blockedRaw.map((id: any) => String(id).trim()).filter(Boolean)
      : [],
    vault_note_path: obj.vault_note_path ? String(obj.vault_note_path) : null,
    scheduled_date: obj.scheduled_date
      ? String(obj.scheduled_date).slice(0, 10)
      : null,
    due_date: obj.due_date ?? obj.due_at ? String(obj.due_date ?? obj.due_at) : null,
    estimated_minutes:
      estNum !== null && Number.isFinite(estNum) && estNum >= 0 ? Math.round(estNum) : null,
    actual_seconds: Number.isFinite(actualRaw) && actualRaw >= 0 ? Math.round(actualRaw) : 0,
    energy_level: normalizeTaskEnergyLevel(obj.energy_level ?? obj.energy),
    tags: tagsRaw.map((t: any) => String(t).trim().toLowerCase()).filter(Boolean),
    recurrence_rule: obj.recurrence_rule ? String(obj.recurrence_rule) : null,
    sort_order: Number.isFinite(Number(obj.sort_order)) ? Number(obj.sort_order) : 0,
    completed_at: obj.completed_at ? String(obj.completed_at) : null,
    created_at: obj.created_at ? String(obj.created_at) : undefined,
    updated_at: obj.updated_at ? String(obj.updated_at) : undefined,
    deleted_at: obj.deleted_at ? String(obj.deleted_at) : null,
  };
}

export function normalizeProject(raw: any): ProjectItem {
  const obj =
    raw && typeof raw === 'object' && raw.project && !raw.id
      ? raw.project
      : raw && typeof raw === 'object' && raw.data && !raw.id
        ? raw.data
        : raw ?? {};
  return {
    id: String(obj.id ?? ''),
    name: String(obj.name ?? obj.title ?? obj.label ?? '').trim() || 'Untitled Project',
    area: normalizeProjectArea(obj.area),
    goal_id: obj.goal_id ? String(obj.goal_id) : null,
    status: (obj.status as ProjectStatus) || 'active',
    color: String(obj.color || '#F87C18'),
    task_count: Number.isFinite(Number(obj.task_count)) ? Number(obj.task_count) : undefined,
    completed_task_count: Number.isFinite(Number(obj.completed_task_count))
      ? Number(obj.completed_task_count)
      : undefined,
    created_at: obj.created_at ? String(obj.created_at) : undefined,
    updated_at: obj.updated_at ? String(obj.updated_at) : undefined,
    deleted_at: obj.deleted_at ? String(obj.deleted_at) : null,
  };
}

function withQuery(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

// ---------------------------------------------------------------------------
// Projects (`/api/projects`)
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<ProjectItem[]> {
  const res = await apiGet<unknown>('/api/projects');
  return unwrapList<any>(res, ['projects'])
    .map(normalizeProject)
    .filter((p) => Boolean(p.id));
}

export async function createProject(payload: CreateProjectPayload): Promise<ProjectItem> {
  const body: Record<string, unknown> = {
    name: payload.name.trim(),
    area: normalizeProjectArea(payload.area),
    status: payload.status ?? 'active',
    color: payload.color || '#F87C18',
    ...(payload.goal_id ? { goal_id: payload.goal_id } : {}),
  };
  const res = await apiPost<unknown>('/api/projects', body);
  return normalizeProject(res);
}

export async function updateProject(
  id: string,
  payload: UpdateProjectPayload,
): Promise<ProjectItem> {
  const body: Record<string, unknown> = {};
  if (payload.name !== undefined) body.name = payload.name.trim();
  if (payload.area !== undefined) body.area = normalizeProjectArea(payload.area);
  if (payload.goal_id !== undefined) body.goal_id = payload.goal_id;
  if (payload.status !== undefined) body.status = payload.status;
  if (payload.color !== undefined) body.color = payload.color;

  const res = await apiPut<unknown>(`/api/projects/${encodeURIComponent(id)}`, body);
  return normalizeProject(res);
}

export function deleteProject(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiDelete(`/api/projects/${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------------------
// Tasks (`/api/tasks`)
// ---------------------------------------------------------------------------

export async function listTasks(filter: TaskListFilterParams = {}): Promise<TodoTask[]> {
  const res = await apiGet<unknown>(
    withQuery('/api/tasks', {
      perspective: filter.perspective,
      status: filter.status,
      project_id: filter.project_id,
      goal_id: filter.goal_id,
      course_id: filter.course_id,
      parent_task_id: filter.parent_task_id,
      priority: filter.priority,
      energy_level: filter.energy_level,
      due_before: filter.due_before,
      scheduled_date: filter.scheduled_date,
      tag: filter.tag,
      search: filter.search,
    }),
  );
  return unwrapList<any>(res, ['tasks'])
    .map(normalizeTodoTask)
    .filter((t) => Boolean(t.id) && !t.deleted_at);
}

export async function listTasksByPerspective(
  perspective: string,
  filter: TaskListFilterParams = {},
): Promise<TodoTask[]> {
  const res = await apiGet<unknown>(
    withQuery(`/api/tasks/perspectives/${encodeURIComponent(perspective)}`, {
      status: filter.status,
      project_id: filter.project_id,
      goal_id: filter.goal_id,
      course_id: filter.course_id,
      parent_task_id: filter.parent_task_id,
      priority: filter.priority,
      energy_level: filter.energy_level,
      due_before: filter.due_before,
      scheduled_date: filter.scheduled_date,
      tag: filter.tag,
      search: filter.search,
    }),
  );
  return unwrapList<any>(res, ['tasks'])
    .map(normalizeTodoTask)
    .filter((t) => Boolean(t.id) && !t.deleted_at);
}

export async function getTask(id: string): Promise<TodoTask> {
  const res = await apiGet<unknown>(`/api/tasks/${encodeURIComponent(id)}`);
  return normalizeTodoTask(res);
}

export async function createTask(payload: CreateTaskPayload): Promise<TodoTask> {
  const body: Record<string, unknown> = {};
  if (payload.title !== undefined) body.title = payload.title.trim();
  if (payload.quick_capture !== undefined && payload.quick_capture.trim()) {
    body.quick_capture = payload.quick_capture.trim();
  }
  if (payload.description_md !== undefined) body.description_md = payload.description_md;
  if (payload.status !== undefined) body.status = normalizeTaskStatus(payload.status);
  if (payload.priority !== undefined) body.priority = normalizeTaskPriority(payload.priority);
  if (payload.project_id !== undefined) body.project_id = payload.project_id || null;
  if (payload.goal_id !== undefined) body.goal_id = payload.goal_id || null;
  if (payload.course_id !== undefined) body.course_id = payload.course_id || null;
  if (payload.lesson_id !== undefined) body.lesson_id = payload.lesson_id || null;
  if (payload.parent_task_id !== undefined) body.parent_task_id = payload.parent_task_id || null;
  if (payload.blocked_by_task_ids !== undefined) {
    body.blocked_by_task_ids = payload.blocked_by_task_ids.filter(Boolean);
  }
  if (payload.vault_note_path !== undefined) {
    body.vault_note_path = payload.vault_note_path?.trim() || null;
  }
  if (payload.scheduled_date !== undefined) {
    const cleanSched = payload.scheduled_date ? String(payload.scheduled_date).slice(0, 10) : null;
    body.scheduled_date =
      cleanSched && isValidIsoCalendarDate(cleanSched) ? cleanSched : null;
  }
  if (payload.due_date !== undefined) {
    body.due_date = payload.due_date ? (toRfc3339DueDate(payload.due_date) ?? null) : null;
  }
  if (payload.estimated_minutes !== undefined && payload.estimated_minutes !== null) {
    const est = Number(payload.estimated_minutes);
    if (Number.isFinite(est) && est >= 0) {
      body.estimated_minutes = Math.round(est);
    }
  }
  if (payload.energy_level !== undefined) {
    body.energy_level = normalizeTaskEnergyLevel(payload.energy_level);
  }
  if (payload.tags !== undefined) {
    body.tags = Array.from(
      new Set(payload.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)),
    );
  }
  if (payload.recurrence_rule !== undefined) body.recurrence_rule = payload.recurrence_rule;
  if (payload.sort_order !== undefined) body.sort_order = payload.sort_order;

  const res = await apiPost<unknown>('/api/tasks', body);
  return normalizeTodoTask(res);
}

export async function updateTask(id: string, payload: UpdateTaskPayload): Promise<TodoTask> {
  const body: Record<string, unknown> = {};
  if (payload.title !== undefined) body.title = payload.title.trim();
  if (payload.description_md !== undefined) body.description_md = payload.description_md;
  if (payload.status !== undefined) body.status = normalizeTaskStatus(payload.status);
  if (payload.priority !== undefined) body.priority = normalizeTaskPriority(payload.priority);
  if (payload.project_id !== undefined) body.project_id = payload.project_id || null;
  if (payload.goal_id !== undefined) body.goal_id = payload.goal_id || null;
  if (payload.course_id !== undefined) body.course_id = payload.course_id || null;
  if (payload.lesson_id !== undefined) body.lesson_id = payload.lesson_id || null;
  if (payload.parent_task_id !== undefined) body.parent_task_id = payload.parent_task_id || null;
  if (payload.blocked_by_task_ids !== undefined) {
    body.blocked_by_task_ids = payload.blocked_by_task_ids.filter(Boolean);
  }
  if (payload.vault_note_path !== undefined) {
    body.vault_note_path = payload.vault_note_path?.trim() || null;
  }
  if (payload.scheduled_date !== undefined) {
    const cleanSched = payload.scheduled_date ? String(payload.scheduled_date).slice(0, 10) : null;
    body.scheduled_date =
      cleanSched && isValidIsoCalendarDate(cleanSched) ? cleanSched : null;
  }
  if (payload.due_date !== undefined) {
    body.due_date = payload.due_date ? (toRfc3339DueDate(payload.due_date) ?? null) : null;
  }
  if (payload.estimated_minutes !== undefined) {
    const est = payload.estimated_minutes !== null ? Number(payload.estimated_minutes) : null;
    body.estimated_minutes =
      est !== null && Number.isFinite(est) && est >= 0 ? Math.round(est) : null;
  }
  if (payload.actual_seconds !== undefined && Number.isFinite(payload.actual_seconds)) {
    body.actual_seconds = Math.max(0, Math.round(payload.actual_seconds));
  }
  if (payload.energy_level !== undefined) {
    body.energy_level = normalizeTaskEnergyLevel(payload.energy_level);
  }
  if (payload.tags !== undefined) {
    body.tags = Array.from(
      new Set(payload.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)),
    );
  }
  if (payload.recurrence_rule !== undefined) body.recurrence_rule = payload.recurrence_rule;
  if (payload.sort_order !== undefined) body.sort_order = payload.sort_order;

  const res = await apiPut<unknown>(`/api/tasks/${encodeURIComponent(id)}`, body);
  return normalizeTodoTask(res);
}

export async function updateTaskStatus(id: string, status: TaskStatus): Promise<TodoTask> {
  const res = await apiPatch<unknown>(`/api/tasks/${encodeURIComponent(id)}/status`, {
    status: normalizeTaskStatus(status),
  });
  return normalizeTodoTask(res);
}

export async function completeTask(id: string): Promise<TodoTask> {
  const res = await apiPost<unknown>(`/api/tasks/${encodeURIComponent(id)}/complete`, {});
  return normalizeTodoTask(res);
}

export async function bulkUpdateTasks(payload: BulkUpdateTasksPayload): Promise<TodoTask[]> {
  const res = await apiPost<unknown>('/api/tasks/bulk', payload);
  return unwrapList<any>(res, ['tasks']).map(normalizeTodoTask);
}

export function deleteTask(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiDelete(`/api/tasks/${encodeURIComponent(id)}`);
}

export async function parseQuickCapture(rawInput: string): Promise<QuickCaptureParsed> {
  const res = await apiPost<any>('/api/tasks/parse', {
    raw_input: rawInput,
  });
  return (res?.parsed ?? res?.data ?? res) as QuickCaptureParsed;
}

// ---------------------------------------------------------------------------
// Capacity & `REF-04 TERMINAL-I/O` Flow Topology (`/api/tasks/capacity`, `/api/tasks/flow`)
// ---------------------------------------------------------------------------

export async function getTodayCapacity(capMinutes?: number): Promise<TodayCapacityMeter> {
  const res = await apiGet<any>(
    withQuery('/api/tasks/capacity', {
      cap_minutes: capMinutes,
    }),
  );
  const raw = res?.capacity ?? res?.data ?? res ?? {};
  const cap = Number(raw.focus_capacity_minutes ?? raw.capacity_minutes ?? 240);
  const planned = Number(raw.planned_minutes ?? 0);
  const actual = Number(raw.actual_minutes ?? 0);
  const actualSec = Number(raw.actual_seconds ?? actual * 60);
  const safeCap = Number.isFinite(cap) && cap > 0 ? Math.round(cap) : 240;
  const safePlanned = Number.isFinite(planned) && planned >= 0 ? Math.round(planned) : 0;
  const safeActual = Number.isFinite(actual) && actual >= 0 ? Math.round(actual) : 0;
  const safeActualSec = Number.isFinite(actualSec) && actualSec >= 0 ? Math.round(actualSec) : 0;
  const remaining = Math.max(0, safeCap - safePlanned);
  const utilRaw = Number(raw.utilization_pct ?? (safePlanned / safeCap) * 100);
  const safeUtil = Number.isFinite(utilRaw) ? Math.round(utilRaw * 10) / 10 : 0;

  return {
    focus_capacity_minutes: safeCap,
    planned_minutes: safePlanned,
    actual_minutes: safeActual,
    actual_seconds: safeActualSec,
    remaining_minutes: remaining,
    utilization_pct: safeUtil,
    overloaded: Boolean(raw.overloaded ?? safePlanned > safeCap),
  };
}

export async function getTaskFlow(
  projectId?: string | null,
): Promise<ProjectFlowTopologyResponse> {
  const res = await apiGet<any>(
    withQuery('/api/tasks/flow', {
      project_id: projectId || undefined,
    }),
  );
  const raw = res?.flow ?? res?.data ?? res ?? {};
  return {
    project_id: raw.project_id ?? projectId ?? null,
    hub_node: raw.hub_node,
    stages: Array.isArray(raw.stages) ? raw.stages : [],
    nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
    edges: Array.isArray(raw.edges) ? raw.edges : [],
    dependency_arcs: Array.isArray(raw.dependency_arcs) ? raw.dependency_arcs : [],
    subtask_edges: Array.isArray(raw.subtask_edges) ? raw.subtask_edges : [],
    capacity: raw.capacity,
  };
}

export async function getProjectFlow(projectId: string): Promise<ProjectFlowTopologyResponse> {
  const res = await apiGet<any>(`/api/projects/${encodeURIComponent(projectId)}/flow`);
  const raw = res?.flow ?? res?.data ?? res ?? {};
  return {
    project_id: raw.project_id ?? projectId,
    hub_node: raw.hub_node,
    stages: Array.isArray(raw.stages) ? raw.stages : [],
    nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
    edges: Array.isArray(raw.edges) ? raw.edges : [],
    dependency_arcs: Array.isArray(raw.dependency_arcs) ? raw.dependency_arcs : [],
    subtask_edges: Array.isArray(raw.subtask_edges) ? raw.subtask_edges : [],
    capacity: raw.capacity,
  };
}

// ---------------------------------------------------------------------------
// Focus Timer & Time Sessions (`/api/time/*`)
// ---------------------------------------------------------------------------

export async function getActiveTimer(): Promise<ActiveTimerResponse> {
  const res = await apiGet<any>('/api/time/timer');
  const raw = res?.timer ?? res?.data ?? res ?? {};
  const session = raw.session ?? (raw.id ? raw : null);
  const running = Boolean(
    raw.running === true ||
      raw.active === true ||
      (session && session.id && !session.ended_at && raw.running !== false),
  );
  const elapsed = Number(raw.elapsed_seconds ?? session?.duration_seconds ?? 0);
  return {
    running,
    session: session ?? null,
    elapsed_seconds: Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : 0,
  };
}

export async function startTimer(payload: StartTimerPayload = {}): Promise<ActiveTimerResponse> {
  const body: Record<string, unknown> = {
    timer_mode: payload.timer_mode ?? 'pomodoro_25_5',
    category: payload.category ?? 'deep_work',
    ...(payload.task_id ? { task_id: payload.task_id } : {}),
    ...(payload.course_id ? { course_id: payload.course_id } : {}),
    ...(payload.lesson_id ? { lesson_id: payload.lesson_id } : {}),
    ...(payload.work_minutes !== undefined ? { work_minutes: payload.work_minutes } : {}),
    ...(payload.break_minutes !== undefined ? { break_minutes: payload.break_minutes } : {}),
    ...(payload.notes ? { notes: payload.notes } : {}),
  };
  const res = await apiPost<any>('/api/time/timer/start', body);
  const raw = res?.timer ?? res?.data ?? res ?? {};
  return {
    running: raw.running ?? true,
    session: raw.session ?? (raw.id ? raw : null),
    elapsed_seconds: Number(raw.elapsed_seconds ?? 0) || 0,
  };
}

export async function stopTimer(payload: StopTimerPayload = {}): Promise<TimeSessionItem> {
  const res = await apiPost<any>('/api/time/timer/stop', payload);
  return (res?.session ?? res?.data ?? res) as TimeSessionItem;
}

export async function discardTimer(): Promise<ActiveTimerResponse> {
  const res = await apiPost<any>('/api/time/timer/discard', {});
  const raw = res?.timer ?? res?.data ?? res ?? {};
  return {
    running: Boolean(raw.running ?? false),
    session: null,
    elapsed_seconds: 0,
  };
}

export async function listTimeSessions(
  params: { task_id?: string; limit?: number } = {},
): Promise<TimeSessionItem[]> {
  const res = await apiGet<unknown>(
    withQuery('/api/time/sessions', {
      task_id: params.task_id,
      limit: params.limit ?? 50,
    }),
  );
  return unwrapList<TimeSessionItem>(res, ['sessions', 'time_sessions']);
}

export async function createTimeSession(
  payload: CreateTimeSessionPayload,
): Promise<TimeSessionItem> {
  const res = await apiPost<any>('/api/time/sessions', {
    ...(payload.task_id ? { task_id: payload.task_id } : {}),
    ...(payload.course_id ? { course_id: payload.course_id } : {}),
    ...(payload.lesson_id ? { lesson_id: payload.lesson_id } : {}),
    category: payload.category ?? 'deep_work',
    timer_mode: payload.timer_mode ?? 'pomodoro_25_5',
    duration_seconds: Math.max(1, Math.round(Number(payload.duration_seconds) || 60)),
    ...(payload.started_at ? { started_at: payload.started_at } : {}),
    ...(payload.ended_at ? { ended_at: payload.ended_at } : {}),
    notes: payload.notes ?? '',
  });
  return (res?.session ?? res?.data ?? res) as TimeSessionItem;
}

export function deleteTimeSession(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiDelete(`/api/time/sessions/${encodeURIComponent(id)}`);
}

export async function getTimeStats(): Promise<TimeStatsResponse> {
  const res = await apiGet<any>('/api/time/stats');
  const raw = res?.stats ?? res?.data ?? res ?? {};
  return {
    today_seconds: Number(raw.today_seconds ?? 0) || 0,
    week_seconds: Number(raw.week_seconds ?? 0) || 0,
    deep_work_week_seconds: Number(raw.deep_work_week_seconds ?? 0) || 0,
    learning_week_seconds: Number(raw.learning_week_seconds ?? 0) || 0,
    hourly_buckets_24h: Array.isArray(raw.hourly_buckets_24h) ? raw.hourly_buckets_24h : [],
    barcode_buckets_96: Array.isArray(raw.barcode_buckets_96) ? raw.barcode_buckets_96 : [],
    focus_capacity_minutes: Number(raw.focus_capacity_minutes ?? 240) || 240,
    planned_today_minutes: Number(raw.planned_today_minutes ?? 0) || 0,
    actual_today_minutes: Number(raw.actual_today_minutes ?? 0) || 0,
    capacity: raw.capacity,
  };
}
