/**
 * Typed REST client bindings and payload normalizers for Module 08 — Routine Planning & Habit Architecture (`/routines`, F29):
 * - `/api/routines` CRUD & `/api/routines/{id}/items`
 * - `/api/routine-items/{item_id}` update & delete
 * - `/api/routine-logs` list & idempotent `(routine_item_id, log_date)` upsert
 * - `/api/routines/day-profile` active Day Profile switcher
 * - `/api/routines/analytics` (`streaks`, `matrix_8x12` 96 cells, `consistency_score_pct`, `heatmap_365d`, `routine_adherence`)
 * - `/api/ideal-week` `7x24` Ideal Week blueprint & trailing 7-day category variance
 * - `/api/checkins/{date}` Daily Pulse check-in & atomic `Daily/YYYY-MM-DD.md` Vault export
 * - `/api/weekly-review/summary` & `/api/reviews/{week_key}` 4-Step Weekly Review Wizard & atomic `Reviews/YYYY-Www.md` Vault export
 */
import { apiDelete, apiGet, apiPost, apiPut, unwrapList } from './client';

export type RoutineTimeSlot = 'morning' | 'afternoon' | 'shutdown' | 'evening' | 'custom';

export type RoutineDayProfile =
  | 'workday'
  | 'weekend'
  | 'travel'
  | 'minimum_viable'
  | 'all';

export type RoutineTrackingType = 'boolean' | 'numeric' | 'duration';

export type RoutineFrequencyType = 'daily' | 'weekdays' | 'times_per_week';

export type RoutineLogStatus = 'completed' | 'partial' | 'skipped';

export type IdealWeekCategory =
  | 'deep_work'
  | 'learning'
  | 'health'
  | 'exercise'
  | 'admin'
  | 'maintenance'
  | 'rest';

export interface RoutineFrequencyConfig {
  mvd_included?: boolean;
  days?: number[];
  times?: number;
  [key: string]: unknown;
}

export interface RoutineItem {
  id: string;
  routine_id: string;
  goal_id?: string | null;
  title: string;
  tracking_type: RoutineTrackingType;
  target_value?: number | null;
  unit?: string | null;
  frequency_type: RoutineFrequencyType;
  frequency_config: RoutineFrequencyConfig;
  estimated_minutes: number;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface RoutineLog {
  id: string;
  routine_item_id: string;
  log_date: string;
  status: RoutineLogStatus;
  numeric_value?: number | null;
  completed_at?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface RoutineStackWithItems {
  id: string;
  name: string;
  time_slot: RoutineTimeSlot;
  day_profile: RoutineDayProfile;
  target_start_time?: string | null;
  sort_order: number;
  active: boolean;
  items: RoutineItem[];
  today_logs: RoutineLog[];
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface CreateRoutinePayload {
  name: string;
  time_slot?: RoutineTimeSlot;
  day_profile?: RoutineDayProfile;
  target_start_time?: string | null;
  sort_order?: number;
  active?: boolean;
}

export interface UpdateRoutinePayload {
  name?: string;
  time_slot?: RoutineTimeSlot;
  day_profile?: RoutineDayProfile;
  target_start_time?: string | null;
  sort_order?: number;
  active?: boolean;
}

export interface CreateRoutineItemPayload {
  title: string;
  goal_id?: string | null;
  tracking_type?: RoutineTrackingType;
  target_value?: number | string | null;
  unit?: string | null;
  frequency_type?: RoutineFrequencyType;
  frequency_config?: RoutineFrequencyConfig;
  estimated_minutes?: number;
  sort_order?: number;
}

export interface UpdateRoutineItemPayload {
  title?: string;
  goal_id?: string | null;
  tracking_type?: RoutineTrackingType;
  target_value?: number | string | null;
  unit?: string | null;
  frequency_type?: RoutineFrequencyType;
  frequency_config?: RoutineFrequencyConfig;
  estimated_minutes?: number;
  sort_order?: number;
}

export interface LogRoutineItemPayload {
  routine_item_id: string;
  log_date?: string;
  status?: RoutineLogStatus;
  numeric_value?: number | string | null;
  notes?: string | null;
}

export interface HabitStreakSummary {
  routine_item_id: string;
  item_id?: string;
  routine_id: string;
  title: string;
  current_streak: number;
  longest_streak: number;
  best_streak?: number;
  completion_rate_30d_pct: number;
  linked_goal_id?: string | null;
}

export interface RoutineHeatmapDay {
  date: string;
  completed_count: number;
  total_count: number;
  completion_ratio: number;
}

export interface RoutineStackAdherence {
  routine_id: string;
  routine_name: string;
  time_slot: RoutineTimeSlot;
  adherence_30d_pct: number;
  completed_logs_30d: number;
  expected_logs_30d: number;
}

export interface RoutineAnalyticsResponse {
  streaks: HabitStreakSummary[];
  matrix_8x12: Array<boolean | 'completed' | 'partial' | 'skipped' | 'empty'>;
  consistency_score_pct: number;
  heatmap_365d: RoutineHeatmapDay[];
  routine_adherence: RoutineStackAdherence[];
}

export interface IdealWeekBlock {
  id?: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  category: IdealWeekCategory;
  linked_goal_id?: string | null;
  label: string;
  color?: string;
  created_at?: string;
  updated_at?: string;
}

export interface IdealWeekCategoryVariance {
  category: IdealWeekCategory | string;
  planned_minutes: number;
  actual_minutes: number;
  variance_minutes: number;
}

export interface IdealWeekResponse {
  blocks: IdealWeekBlock[];
  total_planned_minutes: number;
  total_actual_minutes: number;
  variance_by_category: IdealWeekCategoryVariance[];
}

export interface DailyCheckin {
  id: string;
  checkin_date: string;
  date?: string;
  energy_score?: number | null;
  mood_score?: number | null;
  sleep_hours?: number | null;
  highlight?: string | null;
  highlights_md?: string | null;
  reflection_md?: string | null;
  notes_md?: string | null;
  blockers_md?: string | null;
  day_profile_used: RoutineDayProfile;
  weekly_review_json?: Record<string, unknown> | null;
  obsidian_vault_path: string;
  created_at?: string;
  updated_at?: string;
}

export interface UpsertDailyCheckinPayload {
  energy_score?: number | null;
  mood_score?: number | null;
  sleep_hours?: number | string | null;
  highlight?: string | null;
  reflection_md?: string | null;
  day_profile_used?: RoutineDayProfile;
  weekly_review_json?: Record<string, unknown> | null;
}

export interface WeeklyReviewSummaryResponse {
  week_key: string;
  iso_week: string;
  week_start: string;
  week_end: string;
  completed_tasks_count: number;
  inbox_tasks_count: number;
  focus_minutes: number;
  focus_hours: number;
  routine_consistency_pct: number;
  consistency_pct?: number;
  routine_adherence_pct?: number;
  completed_lessons_count: number;
  goals_avg_progress_pct: number;
  investable_surplus_cents: number;
  obsidian_vault_path: string;
  weekly_review_vault_path?: string;
  vault_export_path?: string;
  wins?: string;
  wins_md?: string;
  challenges?: string;
  challenges_md?: string;
  blockers?: string;
  blockers_md?: string;
  next_week_priorities?: string[] | string;
  next_steps_md?: string;
  adjustments?: string;
  adjustments_md?: string;
}

export interface UpsertWeeklyReviewPayload {
  week_key?: string;
  iso_week?: string;
  wins?: string;
  wins_md?: string;
  challenges?: string;
  challenges_md?: string;
  blockers?: string;
  blockers_md?: string;
  next_week_priorities?: string[] | string;
  next_steps_md?: string;
  adjustments?: string;
  adjustments_md?: string;
}

function toFiniteNumberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function toFiniteNumber(raw: unknown, fallback = 0): number {
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

export function normalizeRoutineTimeSlot(raw: unknown): RoutineTimeSlot {
  const s = String(raw ?? 'morning').trim().toLowerCase();
  if (s === 'morning' || s === 'afternoon' || s === 'shutdown' || s === 'evening' || s === 'custom') {
    return s;
  }
  return 'morning';
}

export function normalizeRoutineDayProfile(raw: unknown): RoutineDayProfile {
  const s = String(raw ?? 'workday').trim().toLowerCase();
  if (s === 'weekday' || s === 'workday') return 'workday';
  if (s === 'weekend') return 'weekend';
  if (s === 'travel') return 'travel';
  if (s === 'mvd' || s === 'minimum_viable' || s === 'minimum_viable_day') return 'minimum_viable';
  if (s === 'all') return 'all';
  return 'workday';
}

export function normalizeRoutineTrackingType(raw: unknown): RoutineTrackingType {
  const s = String(raw ?? 'boolean').trim().toLowerCase();
  if (s === 'numeric' || s === 'duration' || s === 'boolean') return s;
  return 'boolean';
}

export function normalizeRoutineFrequencyType(raw: unknown): RoutineFrequencyType {
  const s = String(raw ?? 'daily').trim().toLowerCase();
  if (s === 'weekdays') return 'weekdays';
  if (s === 'times_per_week' || s === 'custom') return 'times_per_week';
  return 'daily';
}

export function normalizeRoutineLogStatus(raw: unknown): RoutineLogStatus {
  const s = String(raw ?? 'completed').trim().toLowerCase();
  if (s === 'partial') return 'partial';
  if (s === 'skipped') return 'skipped';
  return 'completed';
}

export function normalizeIdealWeekCategory(raw: unknown): IdealWeekCategory {
  const s = String(raw ?? 'deep_work').trim().toLowerCase();
  if (
    s === 'deep_work' ||
    s === 'learning' ||
    s === 'health' ||
    s === 'exercise' ||
    s === 'admin' ||
    s === 'maintenance' ||
    s === 'rest'
  ) {
    return s;
  }
  return 'deep_work';
}

export function normalizeRoutineItem(raw: any): RoutineItem {
  const freqCfg =
    raw?.frequency_config && typeof raw.frequency_config === 'object' && !Array.isArray(raw.frequency_config)
      ? (raw.frequency_config as RoutineFrequencyConfig)
      : {};
  return {
    id: String(raw?.id ?? ''),
    routine_id: String(raw?.routine_id ?? ''),
    goal_id: raw?.goal_id ?? raw?.linked_goal_id ?? null,
    title: String(raw?.title ?? raw?.name ?? 'Untitled Habit'),
    tracking_type: normalizeRoutineTrackingType(raw?.tracking_type),
    target_value: toFiniteNumberOrNull(raw?.target_value),
    unit: raw?.unit ? String(raw.unit) : null,
    frequency_type: normalizeRoutineFrequencyType(raw?.frequency_type),
    frequency_config: freqCfg,
    estimated_minutes: Math.max(0, Math.round(toFiniteNumber(raw?.estimated_minutes, 5))),
    sort_order: Math.round(toFiniteNumber(raw?.sort_order, 0)),
    created_at: raw?.created_at,
    updated_at: raw?.updated_at,
    deleted_at: raw?.deleted_at ?? null,
  };
}

export function normalizeRoutineLog(raw: any): RoutineLog {
  return {
    id: String(raw?.id ?? ''),
    routine_item_id: String(raw?.routine_item_id ?? raw?.item_id ?? ''),
    log_date: String(raw?.log_date ?? raw?.date ?? '').slice(0, 10),
    status: normalizeRoutineLogStatus(raw?.status),
    numeric_value: toFiniteNumberOrNull(raw?.numeric_value),
    completed_at: raw?.completed_at ?? null,
    notes: raw?.notes ?? null,
    created_at: raw?.created_at,
    updated_at: raw?.updated_at,
    deleted_at: raw?.deleted_at ?? null,
  };
}

export function normalizeRoutineStack(raw: any): RoutineStackWithItems {
  const base = raw?.routine && typeof raw.routine === 'object' ? { ...raw.routine, ...raw } : raw;
  const rawItems = unwrapList<any>(base?.items ?? [], ['items', 'routine_items']);
  const rawLogs = unwrapList<any>(base?.today_logs ?? [], ['today_logs', 'logs']);
  return {
    id: String(base?.id ?? ''),
    name: String(base?.name ?? base?.title ?? 'Untitled Routine Stack'),
    time_slot: normalizeRoutineTimeSlot(base?.time_slot),
    day_profile: normalizeRoutineDayProfile(base?.day_profile),
    target_start_time: base?.target_start_time ? String(base.target_start_time) : null,
    sort_order: Math.round(toFiniteNumber(base?.sort_order, 0)),
    active: base?.active !== false && base?.enabled !== false,
    items: rawItems.map(normalizeRoutineItem),
    today_logs: rawLogs.map(normalizeRoutineLog),
    created_at: base?.created_at,
    updated_at: base?.updated_at,
    deleted_at: base?.deleted_at ?? null,
  };
}

export function normalizeRoutineAnalytics(raw: any): RoutineAnalyticsResponse {
  const body = raw?.analytics && typeof raw.analytics === 'object' ? raw.analytics : raw;
  const rawStreaks = unwrapList<any>(body?.streaks ?? [], ['streaks']);
  const rawHeatmap = unwrapList<any>(body?.heatmap_365d ?? [], ['heatmap_365d']);
  const rawAdherence = unwrapList<any>(body?.routine_adherence ?? [], ['routine_adherence']);
  const rawMatrix = Array.isArray(body?.matrix_8x12) ? body.matrix_8x12 : [];

  return {
    streaks: rawStreaks.map((s: any) => ({
      routine_item_id: String(s?.routine_item_id ?? s?.item_id ?? ''),
      item_id: String(s?.item_id ?? s?.routine_item_id ?? ''),
      routine_id: String(s?.routine_id ?? ''),
      title: String(s?.title ?? 'Habit'),
      current_streak: Math.max(0, Math.round(toFiniteNumber(s?.current_streak, 0))),
      longest_streak: Math.max(0, Math.round(toFiniteNumber(s?.longest_streak ?? s?.best_streak, 0))),
      best_streak: Math.max(0, Math.round(toFiniteNumber(s?.best_streak ?? s?.longest_streak, 0))),
      completion_rate_30d_pct: Math.max(0, Math.min(100, toFiniteNumber(s?.completion_rate_30d_pct, 0))),
      linked_goal_id: s?.linked_goal_id ?? null,
    })),
    matrix_8x12: rawMatrix,
    consistency_score_pct: Math.max(0, Math.min(100, toFiniteNumber(body?.consistency_score_pct, 0))),
    heatmap_365d: rawHeatmap.map((h: any) => ({
      date: String(h?.date ?? ''),
      completed_count: Math.max(0, Math.round(toFiniteNumber(h?.completed_count, 0))),
      total_count: Math.max(0, Math.round(toFiniteNumber(h?.total_count ?? h?.scheduled_count, 0))),
      completion_ratio: Math.max(0, Math.min(1, toFiniteNumber(h?.completion_ratio ?? h?.intensity, 0))),
    })),
    routine_adherence: rawAdherence.map((a: any) => ({
      routine_id: String(a?.routine_id ?? ''),
      routine_name: String(a?.routine_name ?? 'Routine'),
      time_slot: normalizeRoutineTimeSlot(a?.time_slot),
      adherence_30d_pct: Math.max(0, Math.min(100, toFiniteNumber(a?.adherence_30d_pct, 0))),
      completed_logs_30d: Math.max(0, Math.round(toFiniteNumber(a?.completed_logs_30d, 0))),
      expected_logs_30d: Math.max(0, Math.round(toFiniteNumber(a?.expected_logs_30d, 0))),
    })),
  };
}

export function normalizeIdealWeekBlock(raw: any): IdealWeekBlock {
  return {
    id: raw?.id ? String(raw.id) : undefined,
    day_of_week: Math.max(0, Math.min(6, Math.round(toFiniteNumber(raw?.day_of_week ?? raw?.day, 0)))),
    start_time: String(raw?.start_time ?? '09:00').slice(0, 8),
    end_time: String(raw?.end_time ?? '10:00').slice(0, 8),
    category: normalizeIdealWeekCategory(raw?.category ?? raw?.block_type),
    linked_goal_id: raw?.linked_goal_id ?? null,
    label: String(raw?.label ?? raw?.title ?? 'Time Block'),
    color: raw?.color ? String(raw.color) : '#F87C18',
    created_at: raw?.created_at,
    updated_at: raw?.updated_at,
  };
}

export function normalizeIdealWeekResponse(raw: any): IdealWeekResponse {
  const rawBlocks = unwrapList<any>(raw?.blocks ?? raw, ['blocks']);
  const rawVariance = unwrapList<any>(raw?.variance_by_category ?? [], ['variance_by_category']);
  return {
    blocks: rawBlocks.map(normalizeIdealWeekBlock),
    total_planned_minutes: Math.max(0, Math.round(toFiniteNumber(raw?.total_planned_minutes, 0))),
    total_actual_minutes: Math.max(0, Math.round(toFiniteNumber(raw?.total_actual_minutes, 0))),
    variance_by_category: rawVariance.map((v: any) => ({
      category: String(v?.category ?? 'deep_work'),
      planned_minutes: Math.max(0, Math.round(toFiniteNumber(v?.planned_minutes, 0))),
      actual_minutes: Math.max(0, Math.round(toFiniteNumber(v?.actual_minutes, 0))),
      variance_minutes: Math.round(toFiniteNumber(v?.variance_minutes, 0)),
    })),
  };
}

export function normalizeDailyCheckin(raw: any, fallbackDate?: string): DailyCheckin {
  const body = raw?.checkin && typeof raw.checkin === 'object' ? raw.checkin : raw;
  const dateStr = String(
    body?.checkin_date ?? body?.date ?? body?.log_date ?? fallbackDate ?? new Date().toISOString().slice(0, 10),
  ).slice(0, 10);
  return {
    id: String(body?.id ?? '00000000-0000-0000-0000-000000000000'),
    checkin_date: dateStr,
    date: dateStr,
    energy_score: toFiniteNumberOrNull(body?.energy_score),
    mood_score: toFiniteNumberOrNull(body?.mood_score),
    sleep_hours: toFiniteNumberOrNull(body?.sleep_hours),
    highlight: body?.highlight ?? body?.highlights_md ?? null,
    highlights_md: body?.highlights_md ?? body?.highlight ?? null,
    reflection_md: body?.reflection_md ?? body?.notes_md ?? body?.blockers_md ?? null,
    notes_md: body?.notes_md ?? body?.reflection_md ?? null,
    blockers_md: body?.blockers_md ?? null,
    day_profile_used: normalizeRoutineDayProfile(body?.day_profile_used ?? body?.day_profile),
    weekly_review_json:
      body?.weekly_review_json && typeof body.weekly_review_json === 'object'
        ? (body.weekly_review_json as Record<string, unknown>)
        : null,
    obsidian_vault_path: String(body?.obsidian_vault_path ?? `Daily/${dateStr}.md`),
    created_at: body?.created_at,
    updated_at: body?.updated_at,
  };
}

export function normalizeWeeklyReviewSummary(raw: any): WeeklyReviewSummaryResponse {
  const body = raw?.summary && typeof raw.summary === 'object' ? raw.summary : raw;
  const isoWeek = String(body?.iso_week ?? body?.week_key ?? '2026-W46');
  const vaultPath = String(
    body?.obsidian_vault_path ??
      body?.weekly_review_vault_path ??
      body?.vault_export_path ??
      `Reviews/${isoWeek}.md`,
  );
  return {
    week_key: String(body?.week_key ?? isoWeek),
    iso_week: isoWeek,
    week_start: String(body?.week_start ?? ''),
    week_end: String(body?.week_end ?? ''),
    completed_tasks_count: Math.max(0, Math.round(toFiniteNumber(body?.completed_tasks_count, 0))),
    inbox_tasks_count: Math.max(0, Math.round(toFiniteNumber(body?.inbox_tasks_count, 0))),
    focus_minutes: Math.max(0, Math.round(toFiniteNumber(body?.focus_minutes, 0))),
    focus_hours: Math.max(0, toFiniteNumber(body?.focus_hours, 0)),
    routine_consistency_pct: Math.max(
      0,
      Math.min(
        100,
        toFiniteNumber(
          body?.routine_consistency_pct ?? body?.consistency_pct ?? body?.routine_adherence_pct,
          0,
        ),
      ),
    ),
    consistency_pct: toFiniteNumber(body?.consistency_pct ?? body?.routine_consistency_pct, 0),
    routine_adherence_pct: toFiniteNumber(body?.routine_adherence_pct ?? body?.routine_consistency_pct, 0),
    completed_lessons_count: Math.max(0, Math.round(toFiniteNumber(body?.completed_lessons_count, 0))),
    goals_avg_progress_pct: Math.max(0, Math.min(100, toFiniteNumber(body?.goals_avg_progress_pct, 0))),
    investable_surplus_cents: Math.round(toFiniteNumber(body?.investable_surplus_cents, 0)),
    obsidian_vault_path: vaultPath,
    weekly_review_vault_path: vaultPath,
    vault_export_path: vaultPath,
    wins: body?.wins ?? body?.wins_md ?? undefined,
    wins_md: body?.wins_md ?? body?.wins ?? undefined,
    challenges: body?.challenges ?? body?.challenges_md ?? body?.blockers ?? body?.blockers_md ?? undefined,
    challenges_md: body?.challenges_md ?? body?.challenges ?? body?.blockers_md ?? body?.blockers ?? undefined,
    blockers: body?.blockers ?? body?.blockers_md ?? undefined,
    blockers_md: body?.blockers_md ?? body?.blockers ?? undefined,
    next_week_priorities: body?.next_week_priorities ?? body?.priorities ?? undefined,
    next_steps_md: body?.next_steps_md ?? undefined,
    adjustments: body?.adjustments ?? body?.adjustments_md ?? undefined,
    adjustments_md: body?.adjustments_md ?? body?.adjustments ?? undefined,
  };
}

export async function listRoutines(filter?: {
  day_profile?: RoutineDayProfile;
  date?: string;
}): Promise<RoutineStackWithItems[]> {
  const qs = new URLSearchParams();
  if (filter?.day_profile) qs.set('day_profile', filter.day_profile);
  if (filter?.date) qs.set('date', filter.date);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await apiGet<unknown>(`/api/routines${suffix}`);
  return unwrapList<any>(res, ['routines']).map(normalizeRoutineStack);
}

export async function getRoutine(id: string, date?: string): Promise<RoutineStackWithItems> {
  const suffix = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await apiGet<unknown>(`/api/routines/${id}${suffix}`);
  return normalizeRoutineStack(res);
}

export async function createRoutine(payload: CreateRoutinePayload): Promise<RoutineStackWithItems> {
  const res = await apiPost<unknown>('/api/routines', payload);
  return normalizeRoutineStack(res);
}

export async function updateRoutine(
  id: string,
  payload: UpdateRoutinePayload,
): Promise<RoutineStackWithItems> {
  const res = await apiPut<unknown>(`/api/routines/${id}`, payload);
  return normalizeRoutineStack(res);
}

export async function deleteRoutine(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiDelete<{ id: string; deleted: boolean }>(`/api/routines/${id}`);
}

export async function createRoutineItem(
  routineId: string,
  payload: CreateRoutineItemPayload,
): Promise<RoutineItem> {
  const res = await apiPost<unknown>(`/api/routines/${routineId}/items`, payload);
  const raw = (res as any)?.routine_item ?? (res as any)?.item ?? res;
  return normalizeRoutineItem(raw);
}

export async function updateRoutineItem(
  itemId: string,
  payload: UpdateRoutineItemPayload,
): Promise<RoutineItem> {
  const res = await apiPut<unknown>(`/api/routine-items/${itemId}`, payload);
  const raw = (res as any)?.routine_item ?? (res as any)?.item ?? res;
  return normalizeRoutineItem(raw);
}

export async function deleteRoutineItem(itemId: string): Promise<{ id: string; deleted: boolean }> {
  return apiDelete<{ id: string; deleted: boolean }>(`/api/routine-items/${itemId}`);
}

export async function listRoutineLogs(date?: string): Promise<RoutineLog[]> {
  const suffix = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await apiGet<unknown>(`/api/routine-logs${suffix}`);
  return unwrapList<any>(res, ['routine_logs', 'logs']).map(normalizeRoutineLog);
}

export async function logRoutineItem(payload: LogRoutineItemPayload): Promise<RoutineLog> {
  const res = await apiPost<unknown>('/api/routine-logs', payload);
  const raw = (res as any)?.routine_log ?? (res as any)?.log ?? res;
  return normalizeRoutineLog(raw);
}

export async function setActiveDayProfile(
  dayProfile: RoutineDayProfile,
  date?: string,
): Promise<DailyCheckin> {
  const res = await apiPost<unknown>('/api/routines/day-profile', {
    day_profile: dayProfile,
    date,
  });
  return normalizeDailyCheckin(res, date);
}

export async function getRoutineAnalytics(): Promise<RoutineAnalyticsResponse> {
  const res = await apiGet<unknown>('/api/routines/analytics');
  return normalizeRoutineAnalytics(res);
}

export async function getIdealWeek(): Promise<IdealWeekResponse> {
  const res = await apiGet<unknown>('/api/ideal-week');
  return normalizeIdealWeekResponse(res);
}

export async function upsertIdealWeek(blocks: IdealWeekBlock[]): Promise<IdealWeekResponse> {
  const res = await apiPut<unknown>('/api/ideal-week', { blocks });
  return normalizeIdealWeekResponse(res);
}

export async function getDailyCheckin(date: string): Promise<DailyCheckin> {
  const res = await apiGet<unknown>(`/api/checkins/${encodeURIComponent(date)}`);
  return normalizeDailyCheckin(res, date);
}

export async function upsertDailyCheckin(
  date: string,
  payload: UpsertDailyCheckinPayload,
): Promise<DailyCheckin> {
  const res = await apiPut<unknown>(`/api/checkins/${encodeURIComponent(date)}`, payload);
  return normalizeDailyCheckin(res, date);
}

export async function getWeeklyReviewSummary(params?: {
  week?: string;
  date?: string;
}): Promise<WeeklyReviewSummaryResponse> {
  const qs = new URLSearchParams();
  if (params?.week) qs.set('week', params.week);
  if (params?.date) qs.set('date', params.date);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await apiGet<unknown>(`/api/weekly-review/summary${suffix}`);
  return normalizeWeeklyReviewSummary(res);
}

export async function getWeeklyReviewByKey(weekKey: string): Promise<WeeklyReviewSummaryResponse> {
  const res = await apiGet<unknown>(`/api/reviews/${encodeURIComponent(weekKey)}`);
  return normalizeWeeklyReviewSummary(res);
}

export async function upsertWeeklyReviewByKey(
  weekKey: string,
  payload: UpsertWeeklyReviewPayload,
): Promise<WeeklyReviewSummaryResponse> {
  const res = await apiPut<unknown>(`/api/reviews/${encodeURIComponent(weekKey)}`, payload);
  return normalizeWeeklyReviewSummary(res);
}

export async function exportWeeklyReviewByKey(
  weekKey: string,
  payload: UpsertWeeklyReviewPayload,
): Promise<WeeklyReviewSummaryResponse> {
  const res = await apiPost<unknown>(`/api/reviews/${encodeURIComponent(weekKey)}/export`, payload);
  return normalizeWeeklyReviewSummary(res);
}
