import { describe, expect, it } from 'vitest';
import {
  buildOrthogonalWaypoints,
  computeKrProgressPct,
  computeWeightedGoalProgressPct,
  formatOrthogonalPathD,
  normalizeBlueprintLayout,
  normalizeGoalWithDetails,
  normalizeKeyResult,
  safeFiniteNumber,
  sanitizeOrthogonalWaypoints,
} from './goalsModel';

describe('goalsModel — F30 OKR Normalizers, Zero-Range Guards & 90° Orthogonal Routing', () => {
  it('safeFiniteNumber parses Decimal strings and guards against NaN and Infinity', () => {
    expect(safeFiniteNumber('42.50', 0)).toBe(42.5);
    expect(safeFiniteNumber(100, 0)).toBe(100);
    expect(safeFiniteNumber(Number.NaN, 12)).toBe(12);
    expect(safeFiniteNumber(Number.POSITIVE_INFINITY, 7)).toBe(7);
    expect(safeFiniteNumber('not-a-number', 5)).toBe(5);
    expect(safeFiniteNumber('', 3)).toBe(3);
  });

  it('computeKrProgressPct handles zero-range Key Results without NaN or Infinity', () => {
    const zeroRangeDone = computeKrProgressPct({
      metric_type: 'numeric',
      start_value: '100',
      current_value: '100',
      target_value: '100',
    });
    expect(Number.isFinite(zeroRangeDone)).toBe(true);
    expect(zeroRangeDone).toBe(100);

    const zeroRangePending = computeKrProgressPct({
      metric_type: 'numeric',
      start_value: '100',
      current_value: '50',
      target_value: '100',
    });
    expect(Number.isFinite(zeroRangePending)).toBe(true);
    expect(zeroRangePending).toBe(0);

    const binaryDone = computeKrProgressPct({
      metric_type: 'binary',
      start_value: '0',
      current_value: '1',
      target_value: '1',
    });
    expect(binaryDone).toBe(100);

    const milestonesKr = computeKrProgressPct({
      metric_type: 'milestones',
      milestones_json: [
        { title: 'Step 1', done: true, weight: 2 },
        { title: 'Step 2', done: false, weight: 2 },
      ],
    });
    expect(milestonesKr).toBe(50);
  });

  it('computeWeightedGoalProgressPct computes weighted average across Q1-Q4 KRs', () => {
    const krs = [
      normalizeKeyResult({
        id: 'kr-1',
        goal_id: 'g-1',
        quarter: 'Q1',
        title: 'Numeric KR',
        metric_type: 'numeric',
        start_value: '0',
        current_value: '50',
        target_value: '100',
        weight: '2',
      }),
      normalizeKeyResult({
        id: 'kr-2',
        goal_id: 'g-1',
        quarter: 'Q2',
        title: 'Binary KR',
        metric_type: 'binary',
        start_value: '0',
        current_value: '1',
        target_value: '1',
        weight: '1',
      }),
    ];
    const weighted = computeWeightedGoalProgressPct(krs, 0);
    expect(weighted).toBeCloseTo(66.7, 1);
  });

  it('buildOrthogonalWaypoints and formatOrthogonalPathD produce 100% 90-degree Manhattan segments with 0 curves', () => {
    const waypoints = buildOrthogonalWaypoints({ x: 120, y: 140 }, { x: 480, y: 320 });
    expect(waypoints.length).toBeGreaterThanOrEqual(2);

    for (let i = 1; i < waypoints.length; i += 1) {
      const p1 = waypoints[i - 1]!;
      const p2 = waypoints[i]!;
      const dx = Math.abs(p2.x - p1.x);
      const dy = Math.abs(p2.y - p1.y);
      expect(dx === 0 || dy === 0).toBe(true);
    }

    const d = formatOrthogonalPathD(waypoints);
    expect(/[CcSsQqTtAa]/.test(d)).toBe(false);
    expect(d.startsWith('M 120 140')).toBe(true);
  });

  it('sanitizeOrthogonalWaypoints splits any diagonal segment into horizontal and vertical elbows', () => {
    const diagonalInput = [
      { x: 100, y: 100 },
      { x: 300, y: 260 },
    ];
    const sanitized = sanitizeOrthogonalWaypoints(diagonalInput);
    expect(sanitized.length).toBeGreaterThan(2);
    for (let i = 1; i < sanitized.length; i += 1) {
      const p1 = sanitized[i - 1]!;
      const p2 = sanitized[i]!;
      expect(p1.x === p2.x || p1.y === p2.y).toBe(true);
    }
  });

  it('normalizeGoalWithDetails normalizes pace_health/pace_status and focus_cap fields', () => {
    const goal = normalizeGoalWithDetails({
      id: 'goal-1',
      year: 2026,
      pillar: 'systems',
      code: 'G99',
      title: 'Off-Track Drift Goal',
      status: 'in_progress',
      pace_health: 'off_track',
      elapsed_year_pct: 55.2,
      invested_seconds_14d: 7200,
      focus_cap_limit: 2,
      active_goals_in_cycle: 3,
      focus_cap_exceeded: true,
      progress_pct: '10.0',
    });

    expect(goal.pace_health).toBe('off_track');
    expect(goal.pace_status).toBe('off_track');
    expect(goal.elapsed_year_pct).toBe(55.2);
    expect(goal.elapsed_pct).toBe(55.2);
    expect(goal.invested_hours).toBe(2);
    expect(goal.focus_cap_exceeded).toBe(true);
    expect(goal.progress_pct_num).toBe(10);
  });

  it('normalizeBlueprintLayout synthesizes cycle_root and orthogonal corridors when backend nodes are empty', () => {
    const goal = normalizeGoalWithDetails({
      id: 'goal-101',
      year: 2026,
      pillar: 'systems',
      code: 'G01',
      title: 'Resilient Runtime',
      status: 'in_progress',
      priority_rank: 1,
      progress_pct: '50',
      blueprint_pos: { x: 420, y: 200 },
      key_results: [
        {
          id: 'kr-101',
          goal_id: 'goal-101',
          quarter: 'Q1',
          code: 'KR1',
          title: 'Ship Core Engine',
          metric_type: 'linked_project',
          progress_pct: '50',
        },
      ],
    });

    const layout = normalizeBlueprintLayout({}, 2026, [goal]);
    expect(layout.nodes.some((n) => n.node_kind === 'cycle_root')).toBe(true);
    expect(layout.nodes.some((n) => n.id === 'goal-101' && n.node_kind === 'goal')).toBe(true);
    expect(layout.corridors.length).toBeGreaterThanOrEqual(2);
    for (const c of layout.corridors) {
      for (let i = 1; i < c.waypoints.length; i += 1) {
        const a = c.waypoints[i - 1]!;
        const b = c.waypoints[i]!;
        expect(a.x === b.x || a.y === b.y).toBe(true);
      }
    }
  });

  it('adv_computeKrProgressPct_and_normalizeBlueprintLayout_handle_linked_krs_weighted_milestones_and_corridors', () => {
    expect(
      computeKrProgressPct({
        metric_type: 'numeric',
        start_value: 200,
        target_value: 100,
        current_value: 150,
      }),
    ).toBe(50);

    expect(
      computeKrProgressPct({
        metric_type: 'milestones',
        milestones_json: [
          { id: 'm1', title: 'M1', weight: 3, done: true },
          { id: 'm2', title: 'M2', weight: 1, done: false },
        ],
      }),
    ).toBe(75);

    const goals = [
      normalizeGoalWithDetails({
        id: 'g1',
        title: 'Goal 1',
        key_results: [{ id: 'kr1', goal_id: 'g1', title: 'KR 1', quarter: 'Q1' }],
      }),
    ];
    const layout = normalizeBlueprintLayout(null, 2026, goals);
    expect(layout.corridors.length).toBeGreaterThanOrEqual(2);
    for (const corridor of layout.corridors) {
      const pathD = formatOrthogonalPathD(corridor.waypoints);
      expect(pathD).not.toMatch(/[CSQTA]/i);
    }
  });
});
