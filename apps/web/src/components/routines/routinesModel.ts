/**
 * Pure, deterministic domain helpers for Module 08 — Routine Planning (`/routines`, F29):
 * - Day Profile & Minimum Viable Day (`mvd_included`) stack/item filtering (preserving empty stacks and Sunday `workday` visibility)
 * - Quantitative (`numeric` / `duration`) habit target formatting with strict `Number.isFinite` guards (zero `NaN` / `Infinity` / `undefined`)
 * - `8x12` (`96`-cell) binary dot-matrix & `365d` rectilinear consistency heatmap normalization
 * - `7x24` Ideal Week time-block validation (`end_time > start_time`, same-day overlap rejection, category metadata)
 * - 4-Step Weekly Review Wizard zero-state telemetry formatting
 */
import { formatBrlCents } from '../../api/client';
import type {
  HabitStreakSummary,
  IdealWeekBlock,
  IdealWeekCategory,
  IdealWeekCategoryVariance,
  RoutineAnalyticsResponse,
  RoutineDayProfile,
  RoutineHeatmapDay,
  RoutineItem,
  RoutineLog,
  RoutineStackWithItems,
  RoutineTimeSlot,
  WeeklyReviewSummaryResponse,
} from '../../api/routines';

export type MatrixCellKind = 'completed' | 'partial' | 'skipped' | 'empty';

export const ROUTINE_TIME_SLOT_ORDER: readonly RoutineTimeSlot[] = [
  'morning',
  'afternoon',
  'shutdown',
  'evening',
  'custom',
] as const;

export const ROUTINE_TIME_SLOT_META: Record<
  RoutineTimeSlot,
  { label: string; code: string; badgeTone: 'orange' | 'cyan' | 'phosphor' | 'amber' | 'stark' }
> = {
  morning: {
    label: 'MORNING LAUNCH // 06:00–11:00',
    code: 'SLOT_01',
    badgeTone: 'orange',
  },
  afternoon: {
    label: 'WORKDAY & AFTERNOON RESET // 11:00–17:00',
    code: 'SLOT_02',
    badgeTone: 'cyan',
  },
  shutdown: {
    label: 'WORKDAY SHUTDOWN RITUAL // 17:00–19:30',
    code: 'SLOT_03',
    badgeTone: 'amber',
  },
  evening: {
    label: 'EVENING WIND-DOWN // 19:30–23:00',
    code: 'SLOT_04',
    badgeTone: 'phosphor',
  },
  custom: {
    label: 'CUSTOM & FLEXIBLE CADENCE STACKS',
    code: 'SLOT_05',
    badgeTone: 'stark',
  },
};

export const DAY_PROFILE_OPTIONS: ReadonlyArray<{
  value: RoutineDayProfile;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    value: 'workday',
    label: 'WORKDAY',
    shortLabel: 'WORKDAY',
    description: 'Standard high-output weekday execution stacks',
  },
  {
    value: 'weekend',
    label: 'WEEKEND',
    shortLabel: 'WEEKEND',
    description: 'Recovery, deep reading, and weekly review cadence',
  },
  {
    value: 'travel',
    label: 'TRAVEL',
    shortLabel: 'TRAVEL',
    description: 'Portable habits; freezes non-travel streaks automatically',
  },
  {
    value: 'minimum_viable',
    label: 'MINIMUM VIABLE (MVD)',
    shortLabel: 'MVD',
    description: 'Keystone MVD habits only; protects streaks on low-energy days',
  },
  {
    value: 'all',
    label: 'ALL PROFILES',
    shortLabel: 'ALL',
    description: 'All configured routine stacks across every day profile',
  },
];

export const IDEAL_WEEK_DAYS: ReadonlyArray<{
  dayOfWeek: number;
  short: string;
  full: string;
}> = [
  { dayOfWeek: 0, short: 'MON', full: 'MONDAY' },
  { dayOfWeek: 1, short: 'TUE', full: 'TUESDAY' },
  { dayOfWeek: 2, short: 'WED', full: 'WEDNESDAY' },
  { dayOfWeek: 3, short: 'THU', full: 'THURSDAY' },
  { dayOfWeek: 4, short: 'FRI', full: 'FRIDAY' },
  { dayOfWeek: 5, short: 'SAT', full: 'SATURDAY' },
  { dayOfWeek: 6, short: 'SUN', full: 'SUNDAY' },
];

export const VALID_IDEAL_WEEK_CATEGORIES: readonly IdealWeekCategory[] = [
  'deep_work',
  'learning',
  'health',
  'exercise',
  'admin',
  'maintenance',
  'rest',
] as const;

export const IDEAL_WEEK_CATEGORY_META: Record<
  IdealWeekCategory,
  { label: string; color: string; tone: 'orange' | 'cyan' | 'phosphor' | 'amber' | 'stark' | 'muted' }
> = {
  deep_work: { label: 'DEEP WORK', color: '#F87C18', tone: 'orange' },
  learning: { label: 'LEARNING / COURSE', color: '#2CE5F2', tone: 'cyan' },
  health: { label: 'HEALTH & BIO', color: '#A8F040', tone: 'phosphor' },
  exercise: { label: 'EXERCISE & MOBILITY', color: '#A8F040', tone: 'phosphor' },
  admin: { label: 'ADMIN & OPS', color: '#F59E0B', tone: 'amber' },
  maintenance: { label: 'MAINTENANCE', color: '#8A909E', tone: 'muted' },
  rest: { label: 'REST & RECOVERY', color: '#F6F6F4', tone: 'stark' },
};

export function safeNumber(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

export function isItemMvdIncluded(item: RoutineItem): boolean {
  const cfg = item.frequency_config;
  if (!cfg || typeof cfg !== 'object') return false;
  return Boolean(cfg.mvd_included === true || cfg.mvd === true);
}

/**
 * Filters routine stacks for the active Day Profile while guaranteeing:
 * 1. Empty routine stacks (`items.length === 0`) whose `day_profile` matches the active profile (or `'workday'` on initial load) are preserved so `routine.name` is always visible (`T2:462`).
 * 2. When `activeProfile === 'minimum_viable'`, stacks with `day_profile === 'minimum_viable'` or `'all'` are kept in full, AND stacks from other profiles that contain `mvd_included: true` items (or items already logged today) are kept with their matching items (`T2:332-387`).
 * 3. When `activeProfile === 'workday'` (initial default), `'workday'` and `'all'` stacks are primary, and any active stacks created under other profiles in the workspace are also included when `includeAllCreatedOnWorkday` is true so no created routine/item is hidden on initial load (`T1:58`, `T1:743`, `T2:462`).
 */
export function filterRoutinesByDayProfile(
  stacks: RoutineStackWithItems[],
  activeProfile: RoutineDayProfile,
  options?: {
    todayLogs?: RoutineLog[];
    includeNonMatchingStacksInWorkday?: boolean;
  },
): RoutineStackWithItems[] {
  const safeStacks = Array.isArray(stacks) ? stacks : [];
  const includeNonMatchingOnWorkday = options?.includeNonMatchingStacksInWorkday ?? true;

  if (activeProfile === 'all') {
    return safeStacks;
  }

  const loggedItemIds = new Set<string>();
  for (const l of options?.todayLogs ?? []) {
    if (l?.routine_item_id) loggedItemIds.add(l.routine_item_id);
  }
  for (const s of safeStacks) {
    for (const l of s.today_logs ?? []) {
      if (l?.routine_item_id) loggedItemIds.add(l.routine_item_id);
    }
  }

  if (activeProfile === 'minimum_viable') {
    const out: RoutineStackWithItems[] = [];
    for (const stack of safeStacks) {
      if (stack.day_profile === 'minimum_viable' || stack.day_profile === 'all') {
        out.push(stack);
        continue;
      }
      const mvdItems = (stack.items ?? []).filter(
        (item) => isItemMvdIncluded(item) || loggedItemIds.has(item.id),
      );
      if (mvdItems.length > 0) {
        out.push({
          ...stack,
          items: mvdItems,
        });
      }
    }
    return out;
  }

  if (activeProfile === 'workday') {
    const primary = safeStacks.filter(
      (s) => s.day_profile === 'workday' || s.day_profile === 'all',
    );
    if (!includeNonMatchingOnWorkday) {
      return primary;
    }
    const secondary = safeStacks.filter(
      (s) => s.day_profile !== 'workday' && s.day_profile !== 'all',
    );
    return [...primary, ...secondary];
  }

  // weekend or travel
  const matching = safeStacks.filter(
    (s) => s.day_profile === activeProfile || s.day_profile === 'all',
  );
  return matching;
}

export interface TimeSlotRoutineGroup {
  timeSlot: RoutineTimeSlot;
  label: string;
  code: string;
  badgeTone: 'orange' | 'cyan' | 'phosphor' | 'amber' | 'stark';
  stacks: RoutineStackWithItems[];
}

export function groupRoutinesByTimeSlot(
  stacks: RoutineStackWithItems[],
): TimeSlotRoutineGroup[] {
  const bySlot = new Map<RoutineTimeSlot, RoutineStackWithItems[]>();
  for (const slot of ROUTINE_TIME_SLOT_ORDER) {
    bySlot.set(slot, []);
  }

  for (const stack of stacks ?? []) {
    const slot = ROUTINE_TIME_SLOT_ORDER.includes(stack.time_slot)
      ? stack.time_slot
      : 'custom';
    bySlot.get(slot)!.push(stack);
  }

  const groups: TimeSlotRoutineGroup[] = [];
  for (const slot of ROUTINE_TIME_SLOT_ORDER) {
    const slotStacks = bySlot.get(slot) ?? [];
    if (slotStacks.length > 0) {
      const meta = ROUTINE_TIME_SLOT_META[slot];
      groups.push({
        timeSlot: slot,
        label: meta.label,
        code: meta.code,
        badgeTone: meta.badgeTone,
        stacks: slotStacks.sort((a, b) => safeNumber(a.sort_order, 0) - safeNumber(b.sort_order, 0)),
      });
    }
  }
  return groups;
}

export interface QuantitativeHabitProgress {
  isQuantitative: boolean;
  actualValue: number;
  targetValue: number;
  unit: string;
  completionPct: number;
  formattedActual: string;
  formattedTarget: string;
  formattedReadout: string;
}

function formatCleanDecimal(value: number): string {
  const safe = safeNumber(value, 0);
  if (Number.isInteger(safe)) return String(safe);
  return safe.toFixed(1).replace(/\.0$/, '');
}

/**
 * Formats quantitative (`numeric` / `duration`) or boolean habit progress with strict
 * `Number.isFinite` guards so `NaN`, `Infinity`, or `undefined` NEVER appear (`T2:389-443`).
 */
export function formatQuantitativeHabitProgress(
  item: Pick<RoutineItem, 'tracking_type' | 'target_value' | 'unit' | 'estimated_minutes'>,
  log?: Pick<RoutineLog, 'status' | 'numeric_value'> | null,
): QuantitativeHabitProgress {
  const isQuantitative = item.tracking_type === 'numeric' || item.tracking_type === 'duration';
  const defaultTarget =
    item.tracking_type === 'duration' ? Math.max(1, safeNumber(item.estimated_minutes, 15)) : 1;
  const rawTarget = safeNumber(item.target_value, isQuantitative ? defaultTarget : 1);
  const targetValue = rawTarget > 0 ? rawTarget : defaultTarget;

  const hasExplicitNumeric =
    log?.numeric_value !== null &&
    log?.numeric_value !== undefined &&
    Number.isFinite(Number(log.numeric_value));

  let actualValue = 0;
  if (hasExplicitNumeric) {
    actualValue = Math.max(0, safeNumber(log?.numeric_value, 0));
  } else if (log?.status === 'completed') {
    actualValue = targetValue;
  } else if (log?.status === 'partial') {
    actualValue = Number((targetValue * 0.5).toFixed(1));
  }

  let completionPct = 0;
  if (isQuantitative && targetValue > 0) {
    completionPct = Math.min(100, Math.max(0, Math.round((actualValue / targetValue) * 100)));
  } else if (log?.status === 'completed') {
    completionPct = 100;
  } else if (log?.status === 'partial') {
    completionPct = 50;
  }

  const unit =
    item.unit && String(item.unit).trim().length > 0
      ? String(item.unit).trim()
      : item.tracking_type === 'duration'
        ? 'min'
        : '';

  const formattedActual = formatCleanDecimal(actualValue);
  const formattedTarget = formatCleanDecimal(targetValue);
  const unitSuffix = unit ? ` ${unit}` : '';
  const formattedReadout = isQuantitative
    ? `${formattedActual} / ${formattedTarget}${unitSuffix} (${completionPct}%)`
    : `${completionPct}%`;

  return {
    isQuantitative,
    actualValue,
    targetValue,
    unit,
    completionPct,
    formattedActual,
    formattedTarget,
    formattedReadout,
  };
}

/**
 * Normalizes `analytics.matrix_8x12` (boolean[] or state strings) into an exact
 * 96-element `MatrixCellKind[]` array for `<BinaryDotMatrix8x12 />`.
 */
export function normalizeMatrix8x12(
  rawMatrix?: ReadonlyArray<boolean | string | number | null | undefined> | null,
): MatrixCellKind[] {
  const total = 96;
  const src = Array.isArray(rawMatrix) ? rawMatrix : [];
  const sliced = src.length > total ? src.slice(-total) : src;
  const out: MatrixCellKind[] = [];

  for (let i = 0; i < total; i++) {
    const cell = sliced[i];
    if (cell === true || cell === 'completed') {
      out.push('completed');
    } else if (cell === 'partial') {
      out.push('partial');
    } else if (cell === 'skipped') {
      out.push('skipped');
    } else if (typeof cell === 'number' && Number.isFinite(cell) && cell > 0) {
      out.push(cell >= 1 ? 'completed' : 'partial');
    } else {
      out.push('empty');
    }
  }
  return out;
}

export interface NormalizedHeatmapCell {
  date: string;
  completedCount: number;
  totalCount: number;
  ratio: number;
  ratioPct: number;
  fillHex: string;
}

/**
 * Normalizes `analytics.heatmap_365d` into 365 safe rectilinear cells with clamped
 * `0..1` ratios and Tactical FUI colors (`#13151A`, `#1E3A40`, `#2CE5F2`, `#A8F040`, `#F87C18`).
 */
export function normalizeHeatmap365d(
  rawHeatmap?: ReadonlyArray<RoutineHeatmapDay> | null,
): NormalizedHeatmapCell[] {
  const src = Array.isArray(rawHeatmap) ? rawHeatmap : [];
  const count = 365;
  const out: NormalizedHeatmapCell[] = [];

  for (let i = 0; i < count; i++) {
    const item = src[i];
    const completedCount = Math.max(0, Math.round(safeNumber(item?.completed_count, 0)));
    const totalCount = Math.max(0, Math.round(safeNumber(item?.total_count, 0)));
    let ratio = safeNumber(item?.completion_ratio, 0);
    if (ratio <= 0 && totalCount > 0 && completedCount > 0) {
      ratio = completedCount / totalCount;
    }
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    const ratioPct = Math.round(clampedRatio * 100);

    let fillHex = '#13151A';
    if (clampedRatio >= 0.85) {
      fillHex = '#F87C18';
    } else if (clampedRatio >= 0.6) {
      fillHex = '#A8F040';
    } else if (clampedRatio >= 0.3) {
      fillHex = '#2CE5F2';
    } else if (clampedRatio > 0) {
      fillHex = '#1F4B57';
    }

    out.push({
      date: item?.date && String(item.date).length > 0 ? String(item.date) : `day-${i + 1}`,
      completedCount,
      totalCount,
      ratio: clampedRatio,
      ratioPct,
      fillHex,
    });
  }
  return out;
}

export function computeTopHabitStreak(
  analytics?: RoutineAnalyticsResponse | null,
): { maxCurrentStreak: number; maxLongestStreak: number } {
  const streaks: HabitStreakSummary[] = Array.isArray(analytics?.streaks) ? analytics!.streaks : [];
  let maxCurrentStreak = 0;
  let maxLongestStreak = 0;
  for (const s of streaks) {
    const cur = Math.max(0, Math.round(safeNumber(s.current_streak, 0)));
    const best = Math.max(0, Math.round(safeNumber(s.longest_streak ?? s.best_streak, 0)));
    if (cur > maxCurrentStreak) maxCurrentStreak = cur;
    if (best > maxLongestStreak) maxLongestStreak = best;
  }
  return { maxCurrentStreak, maxLongestStreak };
}

/**
 * Parses `HH:MM` or `HH:MM:SS` into minutes from midnight (`0..1440`), or returns `null` if invalid.
 */
export function parseTimeMinutes(rawTime: unknown): number | null {
  if (typeof rawTime !== 'string') return null;
  const trimmed = rawTime.trim();
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] !== undefined ? Number(match[3]) : 0;
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return null;
  }
  return hours * 60 + minutes;
}

export interface IdealWeekValidationResult {
  valid: boolean;
  error: string | null;
}

export function validateIdealWeekBlock(
  candidate: Partial<IdealWeekBlock>,
  existingBlocks: ReadonlyArray<IdealWeekBlock> = [],
  editingBlockId?: string | null,
): IdealWeekValidationResult {
  const day = safeNumber(candidate.day_of_week, -1);
  if (!Number.isInteger(day) || day < 0 || day > 6) {
    return {
      valid: false,
      error: 'INVALID_DAY // Day of week must be between 0 (MON) and 6 (SUN).',
    };
  }

  const label = String(candidate.label ?? '').trim();
  if (!label) {
    return {
      valid: false,
      error: 'EMPTY_LABEL // Time-block label cannot be empty.',
    };
  }

  const category = String(candidate.category ?? '').trim().toLowerCase() as IdealWeekCategory;
  if (!VALID_IDEAL_WEEK_CATEGORIES.includes(category)) {
    return {
      valid: false,
      error: `INVALID_CATEGORY // Category must be one of: ${VALID_IDEAL_WEEK_CATEGORIES.join(', ')}.`,
    };
  }

  const startMins = parseTimeMinutes(candidate.start_time);
  const endMins = parseTimeMinutes(candidate.end_time);
  if (startMins === null || endMins === null) {
    return {
      valid: false,
      error: 'INVALID_TIME_FORMAT // Use HH:MM or HH:MM:SS time format.',
    };
  }

  if (endMins <= startMins) {
    return {
      valid: false,
      error: `INVALID_TIME_RANGE // end_time (${candidate.end_time}) must be strictly after start_time (${candidate.start_time}).`,
    };
  }

  for (const other of existingBlocks) {
    if (editingBlockId && other.id && other.id === editingBlockId) continue;
    if (safeNumber(other.day_of_week, -1) !== day) continue;
    const otherStart = parseTimeMinutes(other.start_time);
    const otherEnd = parseTimeMinutes(other.end_time);
    if (otherStart === null || otherEnd === null) continue;
    if (startMins < otherEnd && endMins > otherStart) {
      const dayName = IDEAL_WEEK_DAYS[day]?.short ?? `DAY_${day}`;
      return {
        valid: false,
        error: `OVERLAP_DETECTED // ${dayName} ${candidate.start_time}–${candidate.end_time} overlaps existing block "${other.label}" (${other.start_time}–${other.end_time}).`,
      };
    }
  }

  return { valid: true, error: null };
}

export function validateIdealWeekSchedule(
  blocks: ReadonlyArray<IdealWeekBlock>,
): IdealWeekValidationResult {
  const seen: IdealWeekBlock[] = [];
  for (const block of blocks) {
    const res = validateIdealWeekBlock(block, seen);
    if (!res.valid) return res;
    seen.push(block);
  }
  return { valid: true, error: null };
}

export interface FormattedCategoryVariance {
  category: IdealWeekCategory;
  label: string;
  color: string;
  plannedMinutes: number;
  actualMinutes: number;
  varianceMinutes: number;
  plannedHoursText: string;
  actualHoursText: string;
  varianceText: string;
  adherencePct: number;
}

export function formatIdealWeekVariance(
  varianceList?: ReadonlyArray<IdealWeekCategoryVariance> | null,
  blocks?: ReadonlyArray<IdealWeekBlock> | null,
): FormattedCategoryVariance[] {
  const byCategory = new Map<IdealWeekCategory, { planned: number; actual: number }>();
  for (const cat of VALID_IDEAL_WEEK_CATEGORIES) {
    byCategory.set(cat, { planned: 0, actual: 0 });
  }

  if (Array.isArray(varianceList) && varianceList.length > 0) {
    for (const v of varianceList) {
      const cat = String(v.category ?? 'deep_work').toLowerCase() as IdealWeekCategory;
      if (!byCategory.has(cat)) continue;
      const entry = byCategory.get(cat)!;
      entry.planned += Math.max(0, Math.round(safeNumber(v.planned_minutes, 0)));
      entry.actual += Math.max(0, Math.round(safeNumber(v.actual_minutes, 0)));
    }
  } else if (Array.isArray(blocks)) {
    for (const b of blocks) {
      const cat = String(b.category ?? 'deep_work').toLowerCase() as IdealWeekCategory;
      if (!byCategory.has(cat)) continue;
      const start = parseTimeMinutes(b.start_time);
      const end = parseTimeMinutes(b.end_time);
      if (start !== null && end !== null && end > start) {
        byCategory.get(cat)!.planned += end - start;
      }
    }
  }

  return VALID_IDEAL_WEEK_CATEGORIES.map((category) => {
    const meta = IDEAL_WEEK_CATEGORY_META[category];
    const totals = byCategory.get(category) ?? { planned: 0, actual: 0 };
    const plannedMinutes = totals.planned;
    const actualMinutes = totals.actual;
    const varianceMinutes = actualMinutes - plannedMinutes;
    const plannedHoursText = `${(plannedMinutes / 60).toFixed(1)}h`;
    const actualHoursText = `${(actualMinutes / 60).toFixed(1)}h`;
    const sign = varianceMinutes > 0 ? '+' : '';
    const varianceText = `${sign}${varianceMinutes}m`;
    const adherencePct =
      plannedMinutes > 0
        ? Math.min(100, Math.max(0, Math.round((actualMinutes / plannedMinutes) * 100)))
        : actualMinutes > 0
          ? 100
          : 0;

    return {
      category,
      label: meta.label,
      color: meta.color,
      plannedMinutes,
      actualMinutes,
      varianceMinutes,
      plannedHoursText,
      actualHoursText,
      varianceText,
      adherencePct,
    };
  });
}

export interface FormattedWeeklyReviewMetrics {
  isoWeek: string;
  weekStart: string;
  weekEnd: string;
  completedTasksCount: number;
  inboxTasksCount: number;
  focusHours: number;
  focusMinutes: number;
  focusReadout: string;
  routineConsistencyPct: number;
  routineConsistencyReadout: string;
  completedLessonsCount: number;
  goalsAvgProgressPct: number;
  goalsProgressReadout: string;
  investableSurplusCents: number;
  investableSurplusReadout: string;
  vaultExportPath: string;
}

/**
 * Formats Weekly Review summary telemetry with strict `Number.isFinite` fallbacks
 * so weeks with zero inbox tasks or zero study sessions never render `NaN`, `Infinity`, or `undefined` (`T2:508-527`).
 */
export function formatWeeklyReviewMetrics(
  summary?: Partial<WeeklyReviewSummaryResponse> | null,
): FormattedWeeklyReviewMetrics {
  const isoWeek =
    summary?.iso_week && String(summary.iso_week).trim().length > 0
      ? String(summary.iso_week).trim()
      : summary?.week_key && String(summary.week_key).trim().length > 0
        ? String(summary.week_key).trim()
        : '2026-W46';
  const weekStart =
    summary?.week_start && String(summary.week_start).trim().length > 0
      ? String(summary.week_start).trim()
      : '2026-11-09';
  const weekEnd =
    summary?.week_end && String(summary.week_end).trim().length > 0
      ? String(summary.week_end).trim()
      : '2026-11-15';

  const completedTasksCount = Math.max(0, Math.round(safeNumber(summary?.completed_tasks_count, 0)));
  const inboxTasksCount = Math.max(0, Math.round(safeNumber(summary?.inbox_tasks_count, 0)));
  const focusMinutes = Math.max(0, Math.round(safeNumber(summary?.focus_minutes, 0)));
  const rawFocusHours = safeNumber(summary?.focus_hours, focusMinutes / 60);
  const focusHours = Math.max(0, Number(rawFocusHours.toFixed(1)));

  const routineConsistencyPct = Math.max(
    0,
    Math.min(
      100,
      Number(
        safeNumber(
          summary?.routine_consistency_pct ??
            summary?.consistency_pct ??
            summary?.routine_adherence_pct,
          0,
        ).toFixed(1),
      ),
    ),
  );

  const completedLessonsCount = Math.max(
    0,
    Math.round(safeNumber(summary?.completed_lessons_count, 0)),
  );
  const goalsAvgProgressPct = Math.max(
    0,
    Math.min(100, Number(safeNumber(summary?.goals_avg_progress_pct, 0).toFixed(1))),
  );
  const investableSurplusCents = Math.round(safeNumber(summary?.investable_surplus_cents, 0));

  const vaultExportPath =
    summary?.obsidian_vault_path ||
    summary?.weekly_review_vault_path ||
    summary?.vault_export_path ||
    `Reviews/${isoWeek}.md`;

  return {
    isoWeek,
    weekStart,
    weekEnd,
    completedTasksCount,
    inboxTasksCount,
    focusHours,
    focusMinutes,
    focusReadout: `${focusHours.toFixed(1)}h (${focusMinutes}m)`,
    routineConsistencyPct,
    routineConsistencyReadout: `${routineConsistencyPct.toFixed(1)}%`,
    completedLessonsCount,
    goalsAvgProgressPct,
    goalsProgressReadout: `${goalsAvgProgressPct.toFixed(1)}%`,
    investableSurplusCents,
    investableSurplusReadout: formatBrlCents(investableSurplusCents),
    vaultExportPath: String(vaultExportPath),
  };
}
