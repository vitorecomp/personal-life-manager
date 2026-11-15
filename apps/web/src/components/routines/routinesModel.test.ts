import { describe, expect, it } from 'vitest';
import type { RoutineStackWithItems } from '../../api/routines';
import {
  computeTopHabitStreak,
  filterRoutinesByDayProfile,
  formatIdealWeekVariance,
  formatQuantitativeHabitProgress,
  formatWeeklyReviewMetrics,
  groupRoutinesByTimeSlot,
  normalizeHeatmap365d,
  normalizeMatrix8x12,
  parseTimeMinutes,
  validateIdealWeekBlock,
  validateIdealWeekSchedule,
} from './routinesModel';

describe('routinesModel — F29 Pure Domain Logic & Boundary Guards', () => {
  const sampleStacks: RoutineStackWithItems[] = [
    {
      id: 'stack-morning-workday',
      name: 'Morning Launch Stack',
      time_slot: 'morning',
      day_profile: 'workday',
      target_start_time: '07:00:00',
      sort_order: 1,
      active: true,
      today_logs: [],
      items: [
        {
          id: 'item-mvd-hydrate',
          routine_id: 'stack-morning-workday',
          title: 'Hydrate 500ml + Electrolytes',
          tracking_type: 'boolean',
          frequency_type: 'daily',
          frequency_config: { mvd_included: true },
          estimated_minutes: 5,
          sort_order: 1,
        },
        {
          id: 'item-non-mvd-workout',
          routine_id: 'stack-morning-workday',
          title: 'Heavy Zone-2 Cardio 45m',
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
      id: 'stack-empty-shutdown',
      name: 'Empty Shutdown Ritual',
      time_slot: 'shutdown',
      day_profile: 'workday',
      target_start_time: '18:00:00',
      sort_order: 2,
      active: true,
      today_logs: [],
      items: [],
    },
    {
      id: 'stack-mvd-evening',
      name: 'Evening MVD Wind-Down',
      time_slot: 'evening',
      day_profile: 'minimum_viable',
      target_start_time: '21:30:00',
      sort_order: 3,
      active: true,
      today_logs: [],
      items: [
        {
          id: 'item-evening-read',
          routine_id: 'stack-mvd-evening',
          title: 'Read 10 Pages',
          tracking_type: 'numeric',
          target_value: 10,
          unit: 'pages',
          frequency_type: 'daily',
          frequency_config: { mvd_included: true },
          estimated_minutes: 15,
          sort_order: 1,
        },
      ],
    },
  ];

  it('filters routines for Workday and MVD profiles while preserving empty stacks and MVD items', () => {
    const workdayStacks = filterRoutinesByDayProfile(sampleStacks, 'workday');
    expect(workdayStacks.some((s) => s.id === 'stack-morning-workday')).toBe(true);
    expect(workdayStacks.some((s) => s.id === 'stack-empty-shutdown')).toBe(true);

    const mvdStacks = filterRoutinesByDayProfile(sampleStacks, 'minimum_viable');
    expect(mvdStacks.some((s) => s.id === 'stack-mvd-evening')).toBe(true);
    const filteredMorning = mvdStacks.find((s) => s.id === 'stack-morning-workday');
    expect(filteredMorning).toBeTruthy();
    expect(filteredMorning!.items.map((i) => i.id)).toEqual(['item-mvd-hydrate']);
  });

  it('preserves already-completed non-MVD habits when switching to Minimum Viable Day mid-day', () => {
    const mvdWithCompletedLog = filterRoutinesByDayProfile(sampleStacks, 'minimum_viable', {
      todayLogs: [
        {
          id: 'log-1',
          routine_item_id: 'item-non-mvd-workout',
          log_date: '2026-11-15',
          status: 'completed',
          numeric_value: 45,
        },
      ],
    });
    const filteredMorning = mvdWithCompletedLog.find((s) => s.id === 'stack-morning-workday');
    expect(filteredMorning?.items.length).toBe(2);
  });

  it('groups routine stacks in canonical time_slot order (morning -> afternoon -> shutdown -> evening -> custom)', () => {
    const groups = groupRoutinesByTimeSlot(sampleStacks);
    expect(groups.map((g) => g.timeSlot)).toEqual(['morning', 'shutdown', 'evening']);
  });

  it('formats quantitative habit progress for partial and completed states without ever emitting NaN or undefined', () => {
    const partialWater = formatQuantitativeHabitProgress(
      {
        tracking_type: 'numeric',
        target_value: 3.0,
        unit: 'L',
        estimated_minutes: 5,
      },
      {
        status: 'partial',
        numeric_value: 1.5,
      },
    );
    expect(partialWater.completionPct).toBe(50);
    expect(partialWater.formattedReadout).toBe('1.5 / 3 L (50%)');
    expect(partialWater.formattedReadout).not.toContain('NaN');

    const malformed = formatQuantitativeHabitProgress(
      {
        tracking_type: 'numeric',
        target_value: Number.NaN as any,
        unit: undefined,
        estimated_minutes: Number.NaN as any,
      },
      {
        status: 'partial',
        numeric_value: Number.NaN as any,
      },
    );
    expect(malformed.formattedReadout).not.toContain('NaN');
    expect(malformed.formattedReadout).not.toContain('Infinity');
    expect(malformed.formattedReadout).not.toContain('undefined');
  });

  it('normalizes matrix_8x12 to exact 96 cells and heatmap_365d to exact 365 rectilinear cells', () => {
    const matrix = normalizeMatrix8x12([true, false, 'partial', 'skipped']);
    expect(matrix).toHaveLength(96);
    expect(matrix[0]).toBe('completed');
    expect(matrix[1]).toBe('empty');
    expect(matrix[2]).toBe('partial');
    expect(matrix[3]).toBe('skipped');

    const heatmap = normalizeHeatmap365d([
      { date: '2026-11-15', completed_count: 4, total_count: 4, completion_ratio: 1.0 },
    ]);
    expect(heatmap).toHaveLength(365);
    expect(heatmap[0]?.fillHex).toBe('#F87C18');
    expect(heatmap[1]?.fillHex).toBe('#13151A');

    const topStreak = computeTopHabitStreak({
      streaks: [
        {
          routine_item_id: 'i1',
          routine_id: 'r1',
          title: 'Hydrate',
          current_streak: 9,
          longest_streak: 21,
          completion_rate_30d_pct: 93.3,
        },
      ],
      matrix_8x12: [],
      consistency_score_pct: 93.3,
      heatmap_365d: [],
      routine_adherence: [],
    });
    expect(topStreak.maxCurrentStreak).toBe(9);
    expect(topStreak.maxLongestStreak).toBe(21);
  });

  it('validates Ideal Week blocks and rejects end_time <= start_time, invalid days/categories, and overlaps', () => {
    expect(parseTimeMinutes('09:30')).toBe(570);
    expect(parseTimeMinutes('invalid')).toBeNull();

    const inverted = validateIdealWeekBlock({
      day_of_week: 1,
      start_time: '14:00:00',
      end_time: '12:00:00',
      category: 'deep_work',
      label: 'Inverted Block',
    });
    expect(inverted.valid).toBe(false);
    expect(inverted.error).toMatch(/end_time.*after.*start_time/i);

    const equalTimes = validateIdealWeekBlock({
      day_of_week: 1,
      start_time: '10:00',
      end_time: '10:00',
      category: 'deep_work',
      label: 'Zero Duration Block',
    });
    expect(equalTimes.valid).toBe(false);

    const scheduleCheck = validateIdealWeekSchedule([
      {
        day_of_week: 0,
        start_time: '09:00',
        end_time: '11:00',
        category: 'deep_work',
        label: 'Morning Deep Work',
      },
      {
        day_of_week: 0,
        start_time: '10:30',
        end_time: '12:00',
        category: 'learning',
        label: 'Overlapping Study',
      },
    ]);
    expect(scheduleCheck.valid).toBe(false);
    expect(scheduleCheck.error).toMatch(/OVERLAP_DETECTED/i);

    const variance = formatIdealWeekVariance([], [
      {
        day_of_week: 0,
        start_time: '08:00',
        end_time: '10:00',
        category: 'deep_work',
        label: 'Deep Work',
      },
    ]);
    const dw = variance.find((v) => v.category === 'deep_work');
    expect(dw?.plannedMinutes).toBe(120);
    expect(dw?.plannedHoursText).toBe('2.0h');
  });

  it('formats Weekly Review zero-state metrics without NaN, Infinity, or undefined', () => {
    const zeroMetrics = formatWeeklyReviewMetrics(null);
    const serialized = JSON.stringify(zeroMetrics);
    expect(serialized).not.toContain('NaN');
    expect(serialized).not.toContain('Infinity');
    expect(serialized).not.toContain('undefined');
    expect(zeroMetrics.inboxTasksCount).toBe(0);
    expect(zeroMetrics.focusReadout).toBe('0.0h (0m)');
    expect(zeroMetrics.routineConsistencyReadout).toBe('0.0%');
    expect(zeroMetrics.vaultExportPath).toMatch(/^Reviews\/.*\.md$/);
  });
});
