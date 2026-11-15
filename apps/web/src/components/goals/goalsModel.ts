export type CycleStatus = 'planning' | 'active' | 'closed';

export type GoalPillar =
  | 'career'
  | 'health'
  | 'learning'
  | 'finance'
  | 'personal'
  | 'personal_project'
  | 'relationships'
  | 'systems';

export type GoalStatus = 'not_started' | 'in_progress' | 'completed' | 'paused' | 'dropped';

export type OkrQuarter = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'ANNUAL';

export type KrMetricType =
  | 'numeric'
  | 'milestones'
  | 'binary'
  | 'linked_course'
  | 'linked_finance'
  | 'linked_habit'
  | 'linked_project';

export type PaceHealthStatus = 'on_track' | 'at_risk' | 'off_track';

export interface BlueprintPos {
  x: number;
  y: number;
}

export interface YearlyCycle {
  year: number;
  theme: string;
  vision_md: string;
  reflection_wins_md: string;
  reflection_lessons_md: string;
  anti_goals_md: string;
  focus_cap_limit: number;
  status: CycleStatus;
  created_at?: string;
  updated_at?: string;
}

export interface KrMilestoneItem {
  id?: string;
  title: string;
  label?: string;
  done: boolean;
  completed?: boolean;
  weight: number;
}

export interface GoalKeyResult {
  id: string;
  goal_id: string;
  quarter: OkrQuarter;
  code: string;
  title: string;
  metric_type: KrMetricType;
  start_value: string;
  current_value: string;
  target_value: string;
  start_value_num: number;
  current_value_num: number;
  target_value_num: number;
  unit: string;
  milestones_json: KrMilestoneItem[];
  linked_entity_id: string | null;
  weight: string;
  weight_num: number;
  progress_pct: string;
  progress_pct_num: number;
  blueprint_pos: BlueprintPos | null;
  created_at?: string;
  updated_at?: string;
}

export interface GoalCheckin {
  id: string;
  goal_id: string;
  checkin_date: string;
  progress_snapshot: string;
  progress_snapshot_num: number;
  confidence_score: number;
  wins_md: string;
  blockers_md: string;
  next_steps_md: string;
  created_at?: string;
}

export interface GoalWithDetails {
  id: string;
  year: number;
  pillar: GoalPillar;
  code: string;
  title: string;
  why_motivation_md: string;
  status: GoalStatus;
  priority_rank: number;
  target_date: string | null;
  confidence_score: number;
  progress_pct: string;
  progress_pct_num: number;
  blueprint_pos: BlueprintPos | null;
  key_results: GoalKeyResult[];
  checkins: GoalCheckin[];
  invested_seconds_14d: number;
  invested_seconds: number;
  invested_hours: number;
  pace_health: PaceHealthStatus;
  pace_status: PaceHealthStatus;
  elapsed_year_pct: number;
  elapsed_pct: number;
  focus_cap_limit: number;
  active_goals_in_cycle: number;
  focus_cap_exceeded: boolean;
  focus_cap_warning: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface BlueprintTitleBlock {
  year: number;
  theme: string;
  status: CycleStatus;
  days_elapsed: number;
  days_total: number;
  revision: string;
}

export interface BlueprintNode {
  id: string;
  node_kind: 'cycle_root' | 'goal' | 'key_result';
  code: string;
  title: string;
  quarter: OkrQuarter | null;
  x: number;
  y: number;
  progress_pct: number;
  pillar: GoalPillar | null;
  status: GoalStatus | null;
  width: number;
  height: number;
  is_north_star_beacon: boolean;
  pinned: boolean;
}

export interface BlueprintCorridor {
  from_id: string;
  to_id: string;
  waypoints: BlueprintPos[];
  style: 'solid' | 'dashed';
  polyline: Array<[number, number]>;
}

export interface BlueprintQuarterMatrixCell {
  quarter: OkrQuarter;
  kr_count: number;
  completed_count: number;
  avg_progress_pct: number;
}

export interface BlueprintPillarZone {
  pillar: GoalPillar;
  label: string;
  goal_count: number;
  avg_progress_pct: number;
  zone_y: number;
  zone_height: number;
}

export interface BlueprintLayoutResponse {
  year: number;
  cycle: YearlyCycle;
  title_block: BlueprintTitleBlock;
  nodes: BlueprintNode[];
  corridors: BlueprintCorridor[];
  quarter_matrix: BlueprintQuarterMatrixCell[];
  pillar_zones: BlueprintPillarZone[];
  strategist_notes_md: string;
}

export const GOAL_PILLAR_LABELS: Record<GoalPillar, string> = {
  systems: 'SYSTEMS // INFRA',
  career: 'CAREER // CRAFT',
  learning: 'LEARNING // MASTERY',
  finance: 'WEALTH // FINANCE',
  health: 'HEALTH // VITALITY',
  personal: 'PERSONAL // LIFE',
  personal_project: 'PROJECT // BUILD',
  relationships: 'RELATIONS // SOCIAL',
};

export const OKR_QUARTERS: OkrQuarter[] = ['Q1', 'Q2', 'Q3', 'Q4', 'ANNUAL'];

export const KR_METRIC_LABELS: Record<KrMetricType, string> = {
  numeric: 'NUMERIC',
  milestones: 'MILESTONES',
  binary: 'BINARY (0/1)',
  linked_project: 'LINKED // PROJECT',
  linked_course: 'LINKED // COURSE',
  linked_habit: 'LINKED // HABIT',
  linked_finance: 'LINKED // FINANCE',
};

export function safeFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function clampPercentage(value: unknown, fallback = 0): number {
  const num = safeFiniteNumber(value, fallback);
  const clamped = Math.min(100, Math.max(0, num));
  return Math.round(clamped * 10) / 10;
}

export function normalizeCycleStatus(raw: unknown): CycleStatus {
  const s = String(raw ?? 'active').trim().toLowerCase();
  if (s === 'planning' || s === 'closed') return s;
  return 'active';
}

export function normalizeGoalPillar(raw: unknown): GoalPillar {
  const s = String(raw ?? 'systems').trim().toLowerCase();
  if (s === 'career' || s === 'career_craft' || s === 'craft') return 'career';
  if (s === 'health' || s === 'health_vitality') return 'health';
  if (s === 'learning' || s === 'learning_mastery') return 'learning';
  if (s === 'finance' || s === 'wealth_finance' || s === 'wealth') return 'finance';
  if (s === 'personal') return 'personal';
  if (s === 'personal_project') return 'personal_project';
  if (s === 'relationships') return 'relationships';
  return 'systems';
}

export function normalizeGoalStatus(raw: unknown): GoalStatus {
  const s = String(raw ?? 'not_started').trim().toLowerCase();
  if (s === 'active' || s === 'in_progress') return 'in_progress';
  if (s === 'completed' || s === 'done') return 'completed';
  if (s === 'paused') return 'paused';
  if (s === 'dropped') return 'dropped';
  return 'not_started';
}

export function normalizeOkrQuarter(raw: unknown): OkrQuarter {
  const s = String(raw ?? 'ANNUAL').trim().toUpperCase();
  if (s === 'Q1' || s === 'Q2' || s === 'Q3' || s === 'Q4') return s;
  return 'ANNUAL';
}

export function normalizeKrMetricType(raw: unknown): KrMetricType {
  const s = String(raw ?? 'numeric').trim().toLowerCase();
  if (
    s === 'numeric' ||
    s === 'milestones' ||
    s === 'binary' ||
    s === 'linked_course' ||
    s === 'linked_finance' ||
    s === 'linked_habit' ||
    s === 'linked_project'
  ) {
    return s;
  }
  return 'numeric';
}

export function normalizePaceHealth(raw: unknown): PaceHealthStatus {
  const s = String(raw ?? 'on_track').trim().toLowerCase();
  if (s === 'at_risk' || s === 'off_track') return s;
  return 'on_track';
}

export function normalizeBlueprintPos(raw: unknown): BlueprintPos | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const x = safeFiniteNumber(obj.x, Number.NaN);
  const y = safeFiniteNumber(obj.y, Number.NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

export function computeKrProgressPct(rawKr: {
  metric_type?: KrMetricType | string;
  start_value?: unknown;
  current_value?: unknown;
  target_value?: unknown;
  milestones_json?: unknown[];
  progress_pct?: unknown;
}): number {
  const metricType = normalizeKrMetricType(rawKr.metric_type);
  const start = safeFiniteNumber(rawKr.start_value, 0);
  const current = safeFiniteNumber(rawKr.current_value, 0);
  const target = safeFiniteNumber(rawKr.target_value, 100);
  const serverPct = safeFiniteNumber(rawKr.progress_pct, Number.NaN);

  if (metricType.startsWith('linked_') && Number.isFinite(serverPct)) {
    return clampPercentage(serverPct, 0);
  }

  if (metricType === 'binary') {
    if ((target > 0 && current >= target) || current >= 1) return 100;
    if (Number.isFinite(serverPct) && serverPct > 0) return clampPercentage(serverPct, 0);
    return 0;
  }

  if (metricType === 'milestones' && Array.isArray(rawKr.milestones_json) && rawKr.milestones_json.length > 0) {
    let totalWeight = 0;
    let doneWeight = 0;
    for (const item of rawKr.milestones_json) {
      if (!item || typeof item !== 'object') continue;
      const m = item as Record<string, unknown>;
      const w = Math.max(0.01, safeFiniteNumber(m.weight, 1));
      const isDone = Boolean(m.done ?? m.completed);
      totalWeight += w;
      if (isDone) doneWeight += w;
    }
    if (totalWeight > 0) {
      return clampPercentage((doneWeight / totalWeight) * 100, 0);
    }
  }

  const range = target - start;
  if (Math.abs(range) < 1e-9) {
    if (Number.isFinite(serverPct)) return clampPercentage(serverPct, 0);
    return current >= target ? 100 : 0;
  }

  const computed = ((current - start) / range) * 100;
  if (!Number.isFinite(computed)) {
    return Number.isFinite(serverPct) ? clampPercentage(serverPct, 0) : 0;
  }
  if (Number.isFinite(serverPct) && Math.abs(serverPct - computed) <= 1) {
    return clampPercentage(serverPct, 0);
  }
  return clampPercentage(Number.isFinite(serverPct) ? serverPct : computed, 0);
}

export function computeWeightedGoalProgressPct(
  keyResults: GoalKeyResult[],
  fallbackPct: unknown = 0,
): number {
  if (!Array.isArray(keyResults) || keyResults.length === 0) {
    return clampPercentage(fallbackPct, 0);
  }
  let totalWeight = 0;
  let weightedSum = 0;
  for (const kr of keyResults) {
    const w = Math.max(0.01, safeFiniteNumber(kr.weight_num ?? kr.weight, 1));
    const pct = clampPercentage(kr.progress_pct_num ?? kr.progress_pct, 0);
    totalWeight += w;
    weightedSum += w * pct;
  }
  if (totalWeight <= 0) return clampPercentage(fallbackPct, 0);
  return clampPercentage(weightedSum / totalWeight, 0);
}

/**
 * Pure 90-degree Manhattan waypoint generator.
 * Guarantees every consecutive segment (p[i], p[i+1]) has dx === 0 OR dy === 0.
 */
export function buildOrthogonalWaypoints(
  from: BlueprintPos,
  to: BlueprintPos,
  midXOverride?: number,
): BlueprintPos[] {
  const sx = Math.round(safeFiniteNumber(from?.x, 120));
  const sy = Math.round(safeFiniteNumber(from?.y, 240));
  const ex = Math.round(safeFiniteNumber(to?.x, 420));
  const ey = Math.round(safeFiniteNumber(to?.y, 240));

  if (sx === ex && sy === ey) {
    return [
      { x: sx, y: sy },
      { x: sx + 12, y: sy },
    ];
  }

  if (sx === ex || sy === ey) {
    return [
      { x: sx, y: sy },
      { x: ex, y: ey },
    ];
  }

  const rawMidX =
    midXOverride !== undefined && Number.isFinite(midXOverride)
      ? Math.round(midXOverride)
      : Math.round((sx + ex) / 2);

  return [
    { x: sx, y: sy },
    { x: rawMidX, y: sy },
    { x: rawMidX, y: ey },
    { x: ex, y: ey },
  ];
}

/**
 * Sanitizes any waypoint or polyline array into strictly 90-degree orthogonal waypoints.
 * If any consecutive pair has both dx !== 0 and dy !== 0, inserts a Manhattan elbow.
 */
export function sanitizeOrthogonalWaypoints(
  rawPoints: unknown,
  fallbackFrom: BlueprintPos = { x: 120, y: 240 },
  fallbackTo: BlueprintPos = { x: 420, y: 240 },
): BlueprintPos[] {
  const extracted: BlueprintPos[] = [];
  if (Array.isArray(rawPoints)) {
    for (const pt of rawPoints) {
      if (Array.isArray(pt) && pt.length >= 2) {
        const x = Math.round(safeFiniteNumber(pt[0], Number.NaN));
        const y = Math.round(safeFiniteNumber(pt[1], Number.NaN));
        if (Number.isFinite(x) && Number.isFinite(y)) {
          extracted.push({ x, y });
        }
      } else if (pt && typeof pt === 'object') {
        const obj = pt as Record<string, unknown>;
        const x = Math.round(safeFiniteNumber(obj.x, Number.NaN));
        const y = Math.round(safeFiniteNumber(obj.y, Number.NaN));
        if (Number.isFinite(x) && Number.isFinite(y)) {
          extracted.push({ x, y });
        }
      }
    }
  }

  if (extracted.length < 2) {
    return buildOrthogonalWaypoints(fallbackFrom, fallbackTo);
  }

  const orthogonal: BlueprintPos[] = [extracted[0]!];
  for (let i = 1; i < extracted.length; i += 1) {
    const prev = orthogonal[orthogonal.length - 1]!;
    const next = extracted[i]!;
    if (prev.x === next.x && prev.y === next.y) {
      continue;
    }
    if (prev.x !== next.x && prev.y !== next.y) {
      const midX = Math.round((prev.x + next.x) / 2);
      if (midX !== prev.x) {
        orthogonal.push({ x: midX, y: prev.y });
      }
      orthogonal.push({ x: midX, y: next.y });
      if (midX !== next.x) {
        orthogonal.push({ x: next.x, y: next.y });
      }
    } else {
      orthogonal.push({ x: next.x, y: next.y });
    }
  }

  if (orthogonal.length < 2) {
    const first = orthogonal[0] ?? { x: Math.round(fallbackFrom.x), y: Math.round(fallbackFrom.y) };
    return [first, { x: first.x + 12, y: first.y }];
  }

  return orthogonal;
}

/**
 * Formats waypoints into an SVG `<path d="...">` string using strictly M, H, V commands.
 * Contains ZERO curve (C/S/Q/T/A) or diagonal commands.
 */
export function formatOrthogonalPathD(waypoints: BlueprintPos[]): string {
  const safe = sanitizeOrthogonalWaypoints(waypoints);
  const first = safe[0]!;
  const parts: string[] = [`M ${first.x} ${first.y}`];
  let cx = first.x;
  let cy = first.y;

  for (let i = 1; i < safe.length; i += 1) {
    const pt = safe[i]!;
    if (pt.x === cx && pt.y === cy) continue;
    if (pt.x !== cx && pt.y !== cy) {
      parts.push(`H ${pt.x}`);
      cx = pt.x;
      parts.push(`V ${pt.y}`);
      cy = pt.y;
    } else if (pt.x !== cx) {
      parts.push(`H ${pt.x}`);
      cx = pt.x;
    } else {
      parts.push(`V ${pt.y}`);
      cy = pt.y;
    }
  }

  if (parts.length === 1) {
    parts.push(`H ${cx + 12}`);
  }

  return parts.join(' ');
}

export function normalizeYearlyCycle(raw: any, fallbackYear = 2026): YearlyCycle {
  const obj = raw?.cycle ?? raw?.data ?? raw ?? {};
  const yearNum = Math.round(safeFiniteNumber(obj.year, fallbackYear));
  const safeYear = yearNum >= 2000 && yearNum <= 2100 ? yearNum : fallbackYear;
  const focusCap = Math.max(1, Math.round(safeFiniteNumber(obj.focus_cap_limit, 6)));

  const defaultTheme =
    safeYear === 2027 ? 'Year of Compounding Mastery' : 'Year of Systems & Leverage';

  return {
    year: safeYear,
    theme: String(obj.theme ?? defaultTheme).trim() || defaultTheme,
    vision_md: String(
      obj.vision_md ??
        'Build resilient personal systems, high-leverage software architecture, and sustainable physical energy.',
    ),
    reflection_wins_md: String(obj.reflection_wins_md ?? ''),
    reflection_lessons_md: String(obj.reflection_lessons_md ?? ''),
    anti_goals_md: String(
      obj.anti_goals_md ??
        'No fragmented context-switching across more than 6 active annual objectives.',
    ),
    focus_cap_limit: focusCap,
    status: normalizeCycleStatus(obj.status ?? (safeYear === 2027 ? 'planning' : 'active')),
    created_at: obj.created_at,
    updated_at: obj.updated_at,
  };
}

export function normalizeKeyResult(raw: any): GoalKeyResult {
  const obj = raw?.key_result ?? raw?.data ?? raw ?? {};
  const metric_type = normalizeKrMetricType(obj.metric_type);
  const startNum = safeFiniteNumber(obj.start_value, 0);
  const currentNum = safeFiniteNumber(obj.current_value, 0);
  const targetNum = safeFiniteNumber(obj.target_value, metric_type === 'binary' ? 1 : 100);
  const weightNum = Math.max(0.01, safeFiniteNumber(obj.weight, 1));

  const milestones: KrMilestoneItem[] = Array.isArray(obj.milestones_json)
    ? obj.milestones_json
        .filter((m: any) => m && typeof m === 'object')
        .map((m: any, idx: number) => ({
          id: m.id ? String(m.id) : `ms-${idx + 1}`,
          title: String(m.title ?? m.label ?? `Milestone ${idx + 1}`),
          label: m.label ? String(m.label) : undefined,
          done: Boolean(m.done ?? m.completed),
          completed: Boolean(m.done ?? m.completed),
          weight: Math.max(0.01, safeFiniteNumber(m.weight, 1)),
        }))
    : [];

  const pctNum = computeKrProgressPct({
    metric_type,
    start_value: startNum,
    current_value: currentNum,
    target_value: targetNum,
    milestones_json: milestones,
    progress_pct: obj.progress_pct,
  });

  return {
    id: String(obj.id ?? ''),
    goal_id: String(obj.goal_id ?? ''),
    quarter: normalizeOkrQuarter(obj.quarter),
    code: String(obj.code ?? 'KR1').trim() || 'KR1',
    title: String(obj.title ?? 'Key Result').trim() || 'Key Result',
    metric_type,
    start_value: String(obj.start_value ?? startNum),
    current_value: String(obj.current_value ?? currentNum),
    target_value: String(obj.target_value ?? targetNum),
    start_value_num: startNum,
    current_value_num: currentNum,
    target_value_num: targetNum,
    unit: String(obj.unit ?? '%'),
    milestones_json: milestones,
    linked_entity_id: obj.linked_entity_id ? String(obj.linked_entity_id) : null,
    weight: String(obj.weight ?? weightNum),
    weight_num: weightNum,
    progress_pct: String(pctNum),
    progress_pct_num: pctNum,
    blueprint_pos: normalizeBlueprintPos(obj.blueprint_pos),
    created_at: obj.created_at,
    updated_at: obj.updated_at,
  };
}

export function normalizeGoalCheckin(raw: any): GoalCheckin {
  const obj = raw?.checkin ?? raw?.data ?? raw ?? {};
  const snapshotNum = clampPercentage(obj.progress_snapshot, 0);
  const confRaw = Math.round(safeFiniteNumber(obj.confidence_score, 7));
  const confidence_score = Math.min(10, Math.max(1, confRaw));
  const todayIso = new Date().toISOString().slice(0, 10);

  return {
    id: String(obj.id ?? ''),
    goal_id: String(obj.goal_id ?? ''),
    checkin_date: String(obj.checkin_date ?? todayIso).slice(0, 10),
    progress_snapshot: String(obj.progress_snapshot ?? snapshotNum),
    progress_snapshot_num: snapshotNum,
    confidence_score,
    wins_md: String(obj.wins_md ?? ''),
    blockers_md: String(obj.blockers_md ?? ''),
    next_steps_md: String(obj.next_steps_md ?? ''),
    created_at: obj.created_at,
  };
}

export function normalizeGoalWithDetails(raw: any): GoalWithDetails {
  const obj = raw?.goal ?? raw?.data ?? raw ?? {};
  const key_results: GoalKeyResult[] = Array.isArray(obj.key_results)
    ? obj.key_results.map(normalizeKeyResult)
    : [];
  const checkins: GoalCheckin[] = Array.isArray(obj.checkins)
    ? obj.checkins.map(normalizeGoalCheckin)
    : [];

  const rawPct = safeFiniteNumber(obj.progress_pct, Number.NaN);
  const progress_pct_num = Number.isFinite(rawPct)
    ? clampPercentage(rawPct, 0)
    : computeWeightedGoalProgressPct(key_results, 0);

  const pace = normalizePaceHealth(obj.pace_health ?? obj.pace_status);
  const elapsed = clampPercentage(obj.elapsed_year_pct ?? obj.elapsed_pct, 25);
  const investedSeconds = Math.max(
    0,
    Math.round(safeFiniteNumber(obj.invested_seconds_14d ?? obj.invested_seconds, 0)),
  );
  const investedHoursRaw = safeFiniteNumber(
    obj.invested_hours,
    Math.round((investedSeconds / 3600) * 10) / 10,
  );
  const investedHours = Math.max(0, Math.round(investedHoursRaw * 10) / 10);

  const focusCapLimit = Math.max(1, Math.round(safeFiniteNumber(obj.focus_cap_limit, 6)));
  const activeGoalsInCycle = Math.max(0, Math.round(safeFiniteNumber(obj.active_goals_in_cycle, 0)));
  const focusCapExceeded = Boolean(
    obj.focus_cap_exceeded ?? activeGoalsInCycle > focusCapLimit,
  );

  const confRaw = Math.round(safeFiniteNumber(obj.confidence_score, 8));
  const confidence_score = Math.min(10, Math.max(1, confRaw));
  const priority_rank = Math.max(1, Math.round(safeFiniteNumber(obj.priority_rank, 1)));

  return {
    id: String(obj.id ?? ''),
    year: Math.round(safeFiniteNumber(obj.year, 2026)),
    pillar: normalizeGoalPillar(obj.pillar),
    code: String(obj.code ?? 'G01').trim() || 'G01',
    title: String(obj.title ?? 'Untitled Objective').trim() || 'Untitled Objective',
    why_motivation_md: String(obj.why_motivation_md ?? ''),
    status: normalizeGoalStatus(obj.status),
    priority_rank,
    target_date: obj.target_date ? String(obj.target_date).slice(0, 10) : null,
    confidence_score,
    progress_pct: String(progress_pct_num),
    progress_pct_num,
    blueprint_pos: normalizeBlueprintPos(obj.blueprint_pos),
    key_results,
    checkins,
    invested_seconds_14d: investedSeconds,
    invested_seconds: investedSeconds,
    invested_hours: investedHours,
    pace_health: pace,
    pace_status: pace,
    elapsed_year_pct: elapsed,
    elapsed_pct: elapsed,
    focus_cap_limit: focusCapLimit,
    active_goals_in_cycle: activeGoalsInCycle,
    focus_cap_exceeded: focusCapExceeded,
    focus_cap_warning: obj.focus_cap_warning ? String(obj.focus_cap_warning) : null,
    created_at: obj.created_at,
    updated_at: obj.updated_at,
  };
}

export function normalizeBlueprintLayout(
  raw: any,
  year = 2026,
  goalsFallback: GoalWithDetails[] = [],
  cycleFallback?: YearlyCycle,
): BlueprintLayoutResponse {
  const obj = raw?.blueprint ?? raw?.data ?? raw ?? {};
  const safeYear = Math.round(safeFiniteNumber(obj.year ?? cycleFallback?.year, year));
  const cycle = normalizeYearlyCycle(obj.cycle ?? cycleFallback ?? { year: safeYear }, safeYear);

  const rawTitle = obj.title_block ?? {};
  const title_block: BlueprintTitleBlock = {
    year: safeYear,
    theme: String(rawTitle.theme ?? cycle.theme),
    status: normalizeCycleStatus(rawTitle.status ?? cycle.status),
    days_elapsed: Math.max(0, Math.round(safeFiniteNumber(rawTitle.days_elapsed, 120))),
    days_total: Math.max(1, Math.round(safeFiniteNumber(rawTitle.days_total, 365))),
    revision: String(rawTitle.revision ?? `REV ${safeYear}.1`),
  };

  let nodes: BlueprintNode[] = Array.isArray(obj.nodes)
    ? obj.nodes.map((n: any, idx: number) => {
        const kind =
          n?.node_kind === 'cycle_root' || n?.node_kind === 'key_result' ? n.node_kind : 'goal';
        const defaultX = kind === 'cycle_root' ? 60 : kind === 'goal' ? 380 : 760;
        const defaultY = 100 + idx * 110;
        return {
          id: String(n?.id ?? `node-${idx}`),
          node_kind: kind,
          code: String(n?.code ?? (kind === 'cycle_root' ? String(safeYear) : `G0${idx + 1}`)),
          title: String(n?.title ?? cycle.theme),
          quarter: n?.quarter ? normalizeOkrQuarter(n.quarter) : null,
          x: Math.round(safeFiniteNumber(n?.x, defaultX)),
          y: Math.round(safeFiniteNumber(n?.y, defaultY)),
          progress_pct: clampPercentage(n?.progress_pct, 0),
          pillar: n?.pillar ? normalizeGoalPillar(n.pillar) : null,
          status: n?.status ? normalizeGoalStatus(n.status) : null,
          width: Math.max(120, Math.round(safeFiniteNumber(n?.width, kind === 'key_result' ? 200 : 220))),
          height: Math.max(56, Math.round(safeFiniteNumber(n?.height, kind === 'key_result' ? 72 : 86))),
          is_north_star_beacon: Boolean(n?.is_north_star_beacon ?? kind === 'cycle_root'),
          pinned: Boolean(n?.pinned),
        };
      })
    : [];

  const rootId = `cycle-${safeYear}`;
  if (!nodes.some((n) => n.node_kind === 'cycle_root')) {
    nodes = [
      {
        id: rootId,
        node_kind: 'cycle_root',
        code: String(safeYear),
        title: cycle.theme,
        quarter: 'ANNUAL',
        x: 56,
        y: 220,
        progress_pct: 0,
        pillar: 'systems',
        status: 'in_progress',
        width: 210,
        height: 84,
        is_north_star_beacon: true,
        pinned: false,
      },
      ...nodes,
    ];
  }

  // Merge any goals from goalsFallback that are not yet in nodes
  const existingNodeIds = new Set(nodes.map((n) => n.id));
  goalsFallback.forEach((g, idx) => {
    if (!g.id || existingNodeIds.has(g.id)) return;
    const gx = g.blueprint_pos?.x ?? 380;
    const gy = g.blueprint_pos?.y ?? 96 + idx * 116;
    nodes.push({
      id: g.id,
      node_kind: 'goal',
      code: g.code,
      title: g.title,
      quarter: 'ANNUAL',
      x: Math.round(gx),
      y: Math.round(gy),
      progress_pct: g.progress_pct_num,
      pillar: g.pillar,
      status: g.status,
      width: 220,
      height: 88,
      is_north_star_beacon: g.priority_rank <= 2,
      pinned: Boolean(g.blueprint_pos),
    });
    existingNodeIds.add(g.id);

    g.key_results.forEach((kr, krIdx) => {
      if (!kr.id || existingNodeIds.has(kr.id)) return;
      const kx = kr.blueprint_pos?.x ?? 760 + (krIdx % 2) * 230;
      const ky = kr.blueprint_pos?.y ?? Math.round(gy + (krIdx - 0.5) * 84);
      nodes.push({
        id: kr.id,
        node_kind: 'key_result',
        code: kr.code,
        title: kr.title,
        quarter: kr.quarter,
        x: Math.round(kx),
        y: Math.round(Math.max(64, ky)),
        progress_pct: kr.progress_pct_num,
        pillar: g.pillar,
        status: kr.progress_pct_num >= 100 ? 'completed' : 'in_progress',
        width: 200,
        height: 72,
        is_north_star_beacon: kr.progress_pct_num >= 100,
        pinned: Boolean(kr.blueprint_pos),
      });
      existingNodeIds.add(kr.id);
    });
  });

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const rootNode = nodes.find((n) => n.node_kind === 'cycle_root')!;

  let corridors: BlueprintCorridor[] = Array.isArray(obj.corridors)
    ? obj.corridors.map((c: any) => {
        const fromNode = nodeById.get(String(c?.from_id ?? ''));
        const toNode = nodeById.get(String(c?.to_id ?? ''));
        const fallbackFrom: BlueprintPos = fromNode
          ? { x: fromNode.x + fromNode.width, y: fromNode.y + Math.round(fromNode.height / 2) }
          : { x: 266, y: 262 };
        const fallbackTo: BlueprintPos = toNode
          ? { x: toNode.x, y: toNode.y + Math.round(toNode.height / 2) }
          : { x: 380, y: 140 };
        const rawPoints =
          Array.isArray(c?.waypoints) && c.waypoints.length >= 2 ? c.waypoints : c?.polyline;
        const waypoints = sanitizeOrthogonalWaypoints(rawPoints, fallbackFrom, fallbackTo);
        return {
          from_id: String(c?.from_id ?? rootNode.id),
          to_id: String(c?.to_id ?? ''),
          waypoints,
          style: c?.style === 'dashed' ? 'dashed' : 'solid',
          polyline: waypoints.map((p) => [p.x, p.y]),
        };
      })
    : [];

  if (corridors.length === 0) {
    const goalNodes = nodes.filter((n) => n.node_kind === 'goal');
    goalNodes.forEach((gn, idx) => {
      const fromPt = {
        x: rootNode.x + rootNode.width,
        y: rootNode.y + Math.round(rootNode.height / 2),
      };
      const toPt = {
        x: gn.x,
        y: gn.y + Math.round(gn.height / 2),
      };
      const wp = buildOrthogonalWaypoints(fromPt, toPt, 316 + (idx % 3) * 12);
      corridors.push({
        from_id: rootNode.id,
        to_id: gn.id,
        waypoints: wp,
        style: 'solid',
        polyline: wp.map((p) => [p.x, p.y]),
      });
    });

    goalsFallback.forEach((g) => {
      const gn = nodeById.get(g.id);
      if (!gn) return;
      g.key_results.forEach((kr, kIdx) => {
        const kn = nodeById.get(kr.id);
        if (!kn) return;
        const fromPt = {
          x: gn.x + gn.width,
          y: gn.y + Math.round(gn.height / 2),
        };
        const toPt = {
          x: kn.x,
          y: kn.y + Math.round(kn.height / 2),
        };
        const wp = buildOrthogonalWaypoints(fromPt, toPt, 668 + (kIdx % 3) * 12);
        corridors.push({
          from_id: gn.id,
          to_id: kn.id,
          waypoints: wp,
          style: kr.metric_type.startsWith('linked_') ? 'dashed' : 'solid',
          polyline: wp.map((p) => [p.x, p.y]),
        });
      });
    });
  }

  const quarter_matrix: BlueprintQuarterMatrixCell[] = Array.isArray(obj.quarter_matrix) &&
    obj.quarter_matrix.length > 0
    ? obj.quarter_matrix.map((q: any) => ({
        quarter: normalizeOkrQuarter(q?.quarter),
        kr_count: Math.max(0, Math.round(safeFiniteNumber(q?.kr_count, 0))),
        completed_count: Math.max(0, Math.round(safeFiniteNumber(q?.completed_count, 0))),
        avg_progress_pct: clampPercentage(q?.avg_progress_pct, 0),
      }))
    : (['Q1', 'Q2', 'Q3', 'Q4', 'ANNUAL'] as OkrQuarter[]).map((q) => {
        const krs = goalsFallback.flatMap((g) => g.key_results).filter((k) => k.quarter === q);
        const completed = krs.filter((k) => k.progress_pct_num >= 100).length;
        const avg =
          krs.length > 0
            ? clampPercentage(
                krs.reduce((acc, k) => acc + k.progress_pct_num, 0) / krs.length,
                0,
              )
            : 0;
        return {
          quarter: q,
          kr_count: krs.length,
          completed_count: completed,
          avg_progress_pct: avg,
        };
      });

  const pillar_zones: BlueprintPillarZone[] = Array.isArray(obj.pillar_zones)
    ? obj.pillar_zones.map((pz: any, idx: number) => {
        const pillar = normalizeGoalPillar(pz?.pillar);
        return {
          pillar,
          label: String(pz?.label ?? GOAL_PILLAR_LABELS[pillar]),
          goal_count: Math.max(0, Math.round(safeFiniteNumber(pz?.goal_count, 0))),
          avg_progress_pct: clampPercentage(pz?.avg_progress_pct, 0),
          zone_y: Math.round(safeFiniteNumber(pz?.zone_y, 72 + idx * 110)),
          zone_height: Math.max(60, Math.round(safeFiniteNumber(pz?.zone_height, 96))),
        };
      })
    : [];

  return {
    year: safeYear,
    cycle,
    title_block,
    nodes,
    corridors,
    quarter_matrix,
    pillar_zones,
    strategist_notes_md: String(
      obj.strategist_notes_md ?? `${cycle.vision_md}\n\nANTI-GOALS: ${cycle.anti_goals_md}`,
    ),
  };
}
