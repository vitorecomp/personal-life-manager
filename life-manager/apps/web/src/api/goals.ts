import { apiDelete, apiGet, apiPatch, apiPost, apiPut, unwrapList } from './client';
import {
  buildOrthogonalWaypoints,
  clampPercentage,
  computeKrProgressPct,
  computeWeightedGoalProgressPct,
  formatOrthogonalPathD,
  GOAL_PILLAR_LABELS,
  KR_METRIC_LABELS,
  normalizeBlueprintLayout,
  normalizeBlueprintPos,
  normalizeCycleStatus,
  normalizeGoalCheckin,
  normalizeGoalPillar,
  normalizeGoalStatus,
  normalizeGoalWithDetails,
  normalizeKeyResult,
  normalizeKrMetricType,
  normalizeOkrQuarter,
  normalizePaceHealth,
  normalizeYearlyCycle,
  OKR_QUARTERS,
  safeFiniteNumber,
  sanitizeOrthogonalWaypoints,
  type BlueprintCorridor,
  type BlueprintLayoutResponse,
  type BlueprintNode,
  type BlueprintPillarZone,
  type BlueprintPos,
  type BlueprintQuarterMatrixCell,
  type BlueprintTitleBlock,
  type CycleStatus,
  type GoalCheckin,
  type GoalKeyResult,
  type GoalPillar,
  type GoalStatus,
  type GoalWithDetails,
  type KrMetricType,
  type KrMilestoneItem,
  type OkrQuarter,
  type PaceHealthStatus,
  type YearlyCycle,
} from '../components/goals/goalsModel';

export {
  buildOrthogonalWaypoints,
  clampPercentage,
  computeKrProgressPct,
  computeWeightedGoalProgressPct,
  formatOrthogonalPathD,
  GOAL_PILLAR_LABELS,
  KR_METRIC_LABELS,
  normalizeBlueprintLayout,
  normalizeBlueprintPos,
  normalizeCycleStatus,
  normalizeGoalCheckin,
  normalizeGoalPillar,
  normalizeGoalStatus,
  normalizeGoalWithDetails,
  normalizeKeyResult,
  normalizeKrMetricType,
  normalizeOkrQuarter,
  normalizePaceHealth,
  normalizeYearlyCycle,
  OKR_QUARTERS,
  safeFiniteNumber,
  sanitizeOrthogonalWaypoints,
  type BlueprintCorridor,
  type BlueprintLayoutResponse,
  type BlueprintNode,
  type BlueprintPillarZone,
  type BlueprintPos,
  type BlueprintQuarterMatrixCell,
  type BlueprintTitleBlock,
  type CycleStatus,
  type GoalCheckin,
  type GoalKeyResult,
  type GoalPillar,
  type GoalStatus,
  type GoalWithDetails,
  type KrMetricType,
  type KrMilestoneItem,
  type OkrQuarter,
  type PaceHealthStatus,
  type YearlyCycle,
};

export interface UpsertYearlyCyclePayload {
  year?: number;
  theme?: string;
  vision_md?: string;
  reflection_wins_md?: string;
  reflection_lessons_md?: string;
  anti_goals_md?: string;
  focus_cap_limit?: number;
  status?: CycleStatus;
}

export interface CreateGoalPayload {
  year?: number;
  pillar: GoalPillar;
  code?: string;
  title: string;
  why_motivation_md?: string;
  status?: GoalStatus;
  priority_rank?: number;
  target_date?: string | null;
  confidence_score?: number;
  blueprint_pos?: BlueprintPos | null;
}

export interface UpdateGoalPayload {
  pillar?: GoalPillar;
  code?: string;
  title?: string;
  why_motivation_md?: string;
  status?: GoalStatus;
  priority_rank?: number;
  target_date?: string | null;
  confidence_score?: number;
  blueprint_pos?: BlueprintPos | null;
}

export interface CreateKeyResultPayload {
  quarter?: OkrQuarter;
  code?: string;
  title: string;
  metric_type?: KrMetricType;
  start_value?: number | string;
  current_value?: number | string;
  target_value: number | string;
  unit?: string;
  milestones_json?: KrMilestoneItem[];
  linked_entity_id?: string | null;
  weight?: number | string;
  blueprint_pos?: BlueprintPos | null;
}

export interface UpdateKeyResultPayload {
  quarter?: OkrQuarter;
  code?: string;
  title?: string;
  metric_type?: KrMetricType;
  start_value?: number | string;
  current_value?: number | string;
  target_value?: number | string;
  unit?: string;
  milestones_json?: KrMilestoneItem[];
  linked_entity_id?: string | null;
  weight?: number | string;
  blueprint_pos?: BlueprintPos | null;
}

export interface CreateGoalCheckinPayload {
  checkin_date?: string;
  progress_snapshot?: number | string;
  confidence_score: number;
  wins_md?: string;
  blockers_md?: string;
  next_steps_md?: string;
  kr_id?: string | null;
  kr_current_value?: number | string | null;
}

function withQuery(
  basePath: string,
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      qs.set(k, String(v));
    }
  }
  const str = qs.toString();
  return str ? `${basePath}?${str}` : basePath;
}

export async function listYearlyCycles(): Promise<YearlyCycle[]> {
  const res = await apiGet<unknown>('/api/goals/cycles');
  const items = unwrapList<any>(res, ['cycles', 'yearly_cycles']).map((c) =>
    normalizeYearlyCycle(c, Number(c?.year) || 2026),
  );
  const years = new Set(items.map((c) => c.year));
  if (!years.has(2026)) {
    items.push(normalizeYearlyCycle({ year: 2026 }, 2026));
  }
  if (!years.has(2027)) {
    items.push(normalizeYearlyCycle({ year: 2027, status: 'planning' }, 2027));
  }
  return items.sort((a, b) => a.year - b.year);
}

export async function getYearlyCycle(year: number): Promise<YearlyCycle> {
  const safeYear = Math.round(safeFiniteNumber(year, 2026));
  const res = await apiGet<unknown>(`/api/goals/cycles/${encodeURIComponent(String(safeYear))}`);
  return normalizeYearlyCycle(res, safeYear);
}

export async function upsertYearlyCycle(
  year: number,
  payload: UpsertYearlyCyclePayload,
): Promise<YearlyCycle> {
  const safeYear = Math.round(safeFiniteNumber(year, 2026));
  const body: Record<string, unknown> = {
    year: safeYear,
    ...(payload.theme !== undefined ? { theme: payload.theme.trim() } : {}),
    ...(payload.vision_md !== undefined ? { vision_md: payload.vision_md } : {}),
    ...(payload.reflection_wins_md !== undefined
      ? { reflection_wins_md: payload.reflection_wins_md }
      : {}),
    ...(payload.reflection_lessons_md !== undefined
      ? { reflection_lessons_md: payload.reflection_lessons_md }
      : {}),
    ...(payload.anti_goals_md !== undefined ? { anti_goals_md: payload.anti_goals_md } : {}),
    ...(payload.focus_cap_limit !== undefined
      ? { focus_cap_limit: Math.max(1, Math.round(safeFiniteNumber(payload.focus_cap_limit, 6))) }
      : {}),
    ...(payload.status !== undefined ? { status: normalizeCycleStatus(payload.status) } : {}),
  };
  const res = await apiPut<unknown>(
    `/api/goals/cycles/${encodeURIComponent(String(safeYear))}`,
    body,
  );
  return normalizeYearlyCycle(res, safeYear);
}

export async function listGoals(params?: {
  year?: number;
  pillar?: string;
  status?: string;
}): Promise<GoalWithDetails[]> {
  const res = await apiGet<unknown>(
    withQuery('/api/goals', {
      year: params?.year,
      pillar: params?.pillar,
      status: params?.status,
    }),
  );
  return unwrapList<any>(res, ['goals']).map(normalizeGoalWithDetails);
}

export async function getGoal(id: string): Promise<GoalWithDetails> {
  const res = await apiGet<unknown>(`/api/goals/${encodeURIComponent(id)}`);
  return normalizeGoalWithDetails(res);
}

export async function createGoal(payload: CreateGoalPayload): Promise<GoalWithDetails> {
  const body: Record<string, unknown> = {
    year: Math.round(safeFiniteNumber(payload.year, 2026)),
    pillar: normalizeGoalPillar(payload.pillar),
    title: payload.title.trim(),
    ...(payload.code ? { code: payload.code.trim() } : {}),
    why_motivation_md: payload.why_motivation_md ?? '',
    status: normalizeGoalStatus(payload.status ?? 'in_progress'),
    priority_rank: Math.max(1, Math.round(safeFiniteNumber(payload.priority_rank, 1))),
    ...(payload.target_date !== undefined
      ? { target_date: payload.target_date ? String(payload.target_date).slice(0, 10) : null }
      : {}),
    confidence_score: Math.min(
      10,
      Math.max(1, Math.round(safeFiniteNumber(payload.confidence_score, 8))),
    ),
    ...(payload.blueprint_pos ? { blueprint_pos: normalizeBlueprintPos(payload.blueprint_pos) } : {}),
  };
  const res = await apiPost<unknown>('/api/goals', body);
  return normalizeGoalWithDetails(res);
}

export async function updateGoal(id: string, payload: UpdateGoalPayload): Promise<GoalWithDetails> {
  const body: Record<string, unknown> = {
    ...(payload.pillar !== undefined ? { pillar: normalizeGoalPillar(payload.pillar) } : {}),
    ...(payload.code !== undefined ? { code: payload.code.trim() } : {}),
    ...(payload.title !== undefined ? { title: payload.title.trim() } : {}),
    ...(payload.why_motivation_md !== undefined
      ? { why_motivation_md: payload.why_motivation_md }
      : {}),
    ...(payload.status !== undefined ? { status: normalizeGoalStatus(payload.status) } : {}),
    ...(payload.priority_rank !== undefined
      ? { priority_rank: Math.max(1, Math.round(safeFiniteNumber(payload.priority_rank, 1))) }
      : {}),
    ...(payload.target_date !== undefined
      ? { target_date: payload.target_date ? String(payload.target_date).slice(0, 10) : null }
      : {}),
    ...(payload.confidence_score !== undefined
      ? {
          confidence_score: Math.min(
            10,
            Math.max(1, Math.round(safeFiniteNumber(payload.confidence_score, 8))),
          ),
        }
      : {}),
    ...(payload.blueprint_pos !== undefined
      ? { blueprint_pos: normalizeBlueprintPos(payload.blueprint_pos) }
      : {}),
  };
  const res = await apiPut<unknown>(`/api/goals/${encodeURIComponent(id)}`, body);
  return normalizeGoalWithDetails(res);
}

export async function updateGoalBlueprintPos(
  id: string,
  blueprint_pos: BlueprintPos,
): Promise<GoalWithDetails> {
  const safePos = {
    x: Math.round(safeFiniteNumber(blueprint_pos?.x, 380)),
    y: Math.round(safeFiniteNumber(blueprint_pos?.y, 180)),
  };
  const res = await apiPatch<unknown>(`/api/goals/${encodeURIComponent(id)}/blueprint-pos`, {
    blueprint_pos: safePos,
  });
  return normalizeGoalWithDetails(res);
}

export function deleteGoal(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiDelete(`/api/goals/${encodeURIComponent(id)}`);
}

export async function createKeyResult(
  goalId: string,
  payload: CreateKeyResultPayload,
): Promise<GoalKeyResult> {
  const metricType = normalizeKrMetricType(payload.metric_type);
  const body: Record<string, unknown> = {
    quarter: normalizeOkrQuarter(payload.quarter ?? 'Q1'),
    ...(payload.code ? { code: payload.code.trim() } : {}),
    title: payload.title.trim(),
    metric_type: metricType,
    start_value: String(safeFiniteNumber(payload.start_value, 0)),
    current_value: String(safeFiniteNumber(payload.current_value, 0)),
    target_value: String(
      safeFiniteNumber(payload.target_value, metricType === 'binary' ? 1 : 100),
    ),
    unit: payload.unit ?? '%',
    ...(payload.milestones_json ? { milestones_json: payload.milestones_json } : {}),
    ...(payload.linked_entity_id !== undefined
      ? { linked_entity_id: payload.linked_entity_id || null }
      : {}),
    weight: String(Math.max(0.01, safeFiniteNumber(payload.weight, 1))),
    ...(payload.blueprint_pos
      ? { blueprint_pos: normalizeBlueprintPos(payload.blueprint_pos) }
      : {}),
  };
  const res = await apiPost<unknown>(
    `/api/goals/${encodeURIComponent(goalId)}/key-results`,
    body,
  );
  return normalizeKeyResult(res);
}

export async function updateKeyResult(
  krId: string,
  payload: UpdateKeyResultPayload,
): Promise<GoalKeyResult> {
  const body: Record<string, unknown> = {
    ...(payload.quarter !== undefined ? { quarter: normalizeOkrQuarter(payload.quarter) } : {}),
    ...(payload.code !== undefined ? { code: payload.code.trim() } : {}),
    ...(payload.title !== undefined ? { title: payload.title.trim() } : {}),
    ...(payload.metric_type !== undefined
      ? { metric_type: normalizeKrMetricType(payload.metric_type) }
      : {}),
    ...(payload.start_value !== undefined
      ? { start_value: String(safeFiniteNumber(payload.start_value, 0)) }
      : {}),
    ...(payload.current_value !== undefined
      ? { current_value: String(safeFiniteNumber(payload.current_value, 0)) }
      : {}),
    ...(payload.target_value !== undefined
      ? { target_value: String(safeFiniteNumber(payload.target_value, 100)) }
      : {}),
    ...(payload.unit !== undefined ? { unit: payload.unit } : {}),
    ...(payload.milestones_json !== undefined
      ? { milestones_json: payload.milestones_json }
      : {}),
    ...(payload.linked_entity_id !== undefined
      ? { linked_entity_id: payload.linked_entity_id || null }
      : {}),
    ...(payload.weight !== undefined
      ? { weight: String(Math.max(0.01, safeFiniteNumber(payload.weight, 1))) }
      : {}),
    ...(payload.blueprint_pos !== undefined
      ? { blueprint_pos: normalizeBlueprintPos(payload.blueprint_pos) }
      : {}),
  };
  const res = await apiPut<unknown>(`/api/key-results/${encodeURIComponent(krId)}`, body);
  return normalizeKeyResult(res);
}

export function deleteKeyResult(krId: string): Promise<{ id: string; deleted: boolean }> {
  return apiDelete(`/api/key-results/${encodeURIComponent(krId)}`);
}

export async function listGoalCheckins(goalId: string): Promise<GoalCheckin[]> {
  const res = await apiGet<unknown>(`/api/goals/${encodeURIComponent(goalId)}/checkins`);
  return unwrapList<any>(res, ['checkins']).map(normalizeGoalCheckin);
}

export async function createGoalCheckin(
  goalId: string,
  payload: CreateGoalCheckinPayload,
): Promise<GoalCheckin> {
  const body: Record<string, unknown> = {
    ...(payload.checkin_date ? { checkin_date: payload.checkin_date.slice(0, 10) } : {}),
    ...(payload.progress_snapshot !== undefined
      ? { progress_snapshot: String(clampPercentage(payload.progress_snapshot, 0)) }
      : {}),
    confidence_score: Math.min(
      10,
      Math.max(1, Math.round(safeFiniteNumber(payload.confidence_score, 8))),
    ),
    wins_md: payload.wins_md ?? '',
    blockers_md: payload.blockers_md ?? '',
    next_steps_md: payload.next_steps_md ?? '',
    ...(payload.kr_id ? { kr_id: payload.kr_id } : {}),
    ...(payload.kr_current_value !== undefined && payload.kr_current_value !== null
      ? { kr_current_value: String(safeFiniteNumber(payload.kr_current_value, 0)) }
      : {}),
  };
  const res = await apiPost<unknown>(
    `/api/goals/${encodeURIComponent(goalId)}/checkins`,
    body,
  );
  return normalizeGoalCheckin(res);
}

export async function getGoalBlueprint(
  year: number,
  goalsFallback: GoalWithDetails[] = [],
  cycleFallback?: YearlyCycle,
): Promise<BlueprintLayoutResponse> {
  const safeYear = Math.round(safeFiniteNumber(year, 2026));
  const res = await apiGet<unknown>(
    `/api/goals/cycles/${encodeURIComponent(String(safeYear))}/blueprint`,
  );
  return normalizeBlueprintLayout(res, safeYear, goalsFallback, cycleFallback);
}

export async function listPaceDriftGoals(year?: number): Promise<GoalWithDetails[]> {
  const res = await apiGet<unknown>(withQuery('/api/goals/pace-drift', { year }));
  return unwrapList<any>(res, ['goals', 'pace_drift']).map(normalizeGoalWithDetails);
}
