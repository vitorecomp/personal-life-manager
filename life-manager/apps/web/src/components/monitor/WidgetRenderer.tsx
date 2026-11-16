import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BinaryDotMatrix8x12,
  ConstellationMesh,
  FocusBarcode24h,
  FuiBadge,
  FuiBatteryCapsule,
  FuiButton,
  FuiInput,
  FuiPanelHeader,
  FUI_TOKENS,
  HatchedDonutGauge,
  IsometricKnightSprite,
  LifeRadarReticle,
  PairedHatchBarChart,
  PrivacyValue,
  WaffleGrid10x20,
  WaveformSparkline,
  type ConstellationEdge,
  type ConstellationNode,
  type KnightArchetype,
  type PairedMonthDatum,
  type WaffleSliceInput,
} from '@hermes/ui';
import {
  apiDelete,
  apiPost,
  formatBrlCents,
  formatFireDuration,
  formatUsdCents,
  type AgentRecord,
  type AllocationRecord,
  type CourseRecord,
  type DashboardWidgetRecord,
  type FireProjectionRecord,
  type GoalRecord,
  type GridRect,
  type LifeScoreResponse,
  type MonthlyPlanRecord,
  type PendingApprovalRecord,
  type RoutineAnalyticsRecord,
  type ServerNodeRecord,
  type ServerSummaryResponse,
  type TaskRecord,
  type TimeStatsRecord,
  type VaultNoteRecord,
} from '../../api/client';

export interface LiveMonitorTelemetry {
  timeStats?: TimeStatsRecord | null;
  tasks?: TaskRecord[];
  routineAnalytics?: RoutineAnalyticsRecord | null;
  routines?: any[];
  allocation?: AllocationRecord | null;
  retirement?: FireProjectionRecord | null;
  monthlyPlans?: MonthlyPlanRecord[];
  goals?: GoalRecord[];
  courses?: CourseRecord[];
  dueReviews?: any[];
  agents?: AgentRecord[];
  vaultNotes?: VaultNoteRecord[];
}

export interface WidgetRendererProps {
  deckId: string;
  widget: DashboardWidgetRecord;
  lifeScore?: LifeScoreResponse | null;
  servers?: ServerNodeRecord[];
  serverSummary?: ServerSummaryResponse | null;
  pendingApprovals?: PendingApprovalRecord[];
  liveTelemetry?: LiveMonitorTelemetry;
  resolvedGridPlacement?: {
    gridColumn: string;
    gridRow: string;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  };
  initialRefreshError?: string | null;
  onEditWidget?: (widget: DashboardWidgetRecord) => void;
  isEditMode?: boolean;
  onResizeWidget?: (widget: DashboardWidgetRecord, nextRect: GridRect) => void;
  onDeleteWidget?: (widgetId: string) => void;
  onStashWidget?: (widget: DashboardWidgetRecord) => void;
  onDragStartWidget?: (widget: DashboardWidgetRecord, e: React.DragEvent) => void;
  onDragOverWidget?: (widget: DashboardWidgetRecord, e: React.DragEvent) => void;
  onDropOnWidget?: (targetWidget: DashboardWidgetRecord, e: React.DragEvent) => void;
  onDragEndWidget?: () => void;
  isDragging?: boolean;
  isDropTarget?: boolean;
  kioskMode?: boolean;
}

function extractByPointerOrPath(source: any, pointerOrPath: string): unknown {
  if (source == null || typeof source !== 'object' || !pointerOrPath) {
    return undefined;
  }
  const trimmed = pointerOrPath.trim();
  if (!trimmed) return undefined;

  const segments = trimmed.startsWith('/')
    ? trimmed
        .slice(1)
        .split('/')
        .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    : trimmed
        .replace(/^\$\.?/, '')
        .split('.')
        .filter(Boolean);

  let cursor: any = source;
  for (const seg of segments) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    if (Array.isArray(cursor)) {
      const idx = Number.parseInt(seg, 10);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cursor.length) return undefined;
      cursor = cursor[idx];
    } else {
      if (!(seg in cursor)) return undefined;
      cursor = cursor[seg];
    }
  }
  return cursor;
}

function buildWaffleSlicesFromData(
  allocation: AllocationRecord | null | undefined,
  fallbackTiles?: Array<{ symbol?: string; asset_class?: string }>,
): WaffleSliceInput[] {
  if (allocation?.recommendations && Array.isArray(allocation.recommendations) && allocation.recommendations.length > 0) {
    return allocation.recommendations
      .filter((rec) => Boolean(rec && rec.symbol))
      .map((rec) => ({
        id: String(rec.asset_id || rec.symbol),
        label: String(rec.symbol),
        weightPct: Number(rec.current_weight_pct ?? 0),
        targetWeightPct: Number(rec.target_weight_pct ?? 0),
      }));
  }
  const tiles = Array.isArray(allocation?.waffle_tiles)
    ? allocation.waffle_tiles
    : Array.isArray(fallbackTiles)
      ? fallbackTiles
      : [];
  if (tiles.length > 0) {
    const counts = new Map<string, number>();
    for (const t of tiles) {
      if (!t || typeof t !== 'object') continue;
      const key = String(t.symbol || t.asset_class || '').trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const total = Math.max(1, tiles.length);
    return Array.from(counts.entries()).map(([label, count]) => ({
      id: label,
      label,
      weightPct: (count / total) * 100,
    }));
  }
  return [];
}

function normalizeArchetype(raw: string | undefined | null): KnightArchetype {
  const clean = String(raw || '').toLowerCase();
  if (clean === 'vanguard') return 'vanguard';
  if (clean === 'lore_warden') return 'lore_warden';
  if (clean === 'inquisitor') return 'inquisitor';
  if (clean === 'artificer') return 'artificer';
  return 'paladin';
}

function extractNumbersFromAny(val: unknown): number[] {
  const nums: number[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 3 || nums.length >= 24 || node == null) return;
    if (typeof node === 'number' && Number.isFinite(node)) {
      nums.push(node);
      return;
    }
    if (typeof node === 'string') {
      const matches = node.match(/-?\d+(?:\.\d+)?/g);
      if (matches) {
        for (const m of matches) {
          const parsed = Number.parseFloat(m);
          if (Number.isFinite(parsed)) nums.push(parsed);
          if (nums.length >= 24) break;
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, depth + 1);
        if (nums.length >= 24) break;
      }
      return;
    }
    if (typeof node === 'object') {
      for (const v of Object.values(node as Record<string, unknown>)) {
        visit(v, depth + 1);
        if (nums.length >= 24) break;
      }
    }
  };
  visit(val, 0);
  return nums;
}

function extractKeyValueEntries(val: unknown): Array<{ key: string; value: string; num: number | null }> {
  if (Array.isArray(val)) {
    const validObjs = val.filter((r): r is Record<string, any> => Boolean(r && typeof r === 'object' && !Array.isArray(r)));
    if (validObjs.length > 0) {
      const first = validObjs[0]!;
      return Object.entries(first)
        .slice(0, 6)
        .map(([k, v]) => {
          const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
          return { key: k, value: String(v ?? ''), num: Number.isFinite(n) ? n : null };
        });
    }
    return val.slice(0, 6).map((item, idx) => {
      const n = typeof item === 'number' ? item : Number.parseFloat(String(item));
      return { key: `ITEM_${idx + 1}`, value: String(item ?? ''), num: Number.isFinite(n) ? n : null };
    });
  }
  if (val && typeof val === 'object') {
    return Object.entries(val as Record<string, unknown>)
      .slice(0, 6)
      .map(([k, v]) => {
        const str = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
        const n = typeof v === 'number' ? v : Number.parseFloat(str);
        return { key: k, value: str, num: Number.isFinite(n) ? n : null };
      });
  }
  const str = String(val ?? '');
  const n = Number.parseFloat(str);
  return [{ key: 'VALUE', value: str, num: Number.isFinite(n) ? n : null }];
}

export function WidgetRenderer({
  deckId,
  widget,
  lifeScore,
  servers = [],
  serverSummary,
  pendingApprovals = [],
  liveTelemetry,
  resolvedGridPlacement,
  initialRefreshError = null,
  onEditWidget,
  isEditMode = false,
  onResizeWidget,
  onDeleteWidget,
  onStashWidget,
  onDragStartWidget,
  onDragOverWidget,
  onDropOnWidget,
  onDragEndWidget,
  isDragging = false,
  isDropTarget = false,
  kioskMode = false,
}: WidgetRendererProps) {
  const queryClient = useQueryClient();
  const [newSrvName, setNewSrvName] = useState('');
  const [newSrvHost, setNewSrvHost] = useState('127.0.0.1');
  const [newSrvPort, setNewSrvPort] = useState('8080');
  const [showAddServer, setShowAddServer] = useState(false);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);

  const rect = widget.grid_rect ?? {
    x: widget.grid_x ?? 0,
    y: widget.grid_y ?? 0,
    w: widget.grid_w ?? 4,
    h: widget.grid_h ?? 4,
  };

  const refreshMutation = useMutation({
    mutationFn: async () => apiPost(`/api/widgets/${encodeURIComponent(widget.id)}/refresh`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      onDeleteWidget?.(widget.id);
      return apiDelete(
        `/api/dashboards/${encodeURIComponent(deckId)}/widgets/${encodeURIComponent(widget.id)}`,
      ).catch(() => null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  const probeServerMutation = useMutation({
    mutationFn: async (serverId: string) =>
      apiPost(`/api/servers/${encodeURIComponent(serverId)}/check`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['servers-summary'] });
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  const createServerMutation = useMutation({
    mutationFn: async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newSrvName.trim()) return null;
      return apiPost('/api/servers', {
        name: newSrvName.trim(),
        host: newSrvHost.trim() || '127.0.0.1',
        port: Number.parseInt(newSrvPort, 10) || 8080,
        check_type: 'tcp',
      });
    },
    onSuccess: () => {
      setNewSrvName('');
      setShowAddServer(false);
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: ['servers-summary'] });
    },
  });

  const approveCmdMutation = useMutation({
    mutationFn: async (approvalId: string) => {
      await apiPost(`/api/mcp/approvals/${encodeURIComponent(approvalId)}/approve`, {});
      return apiPost(`/api/widgets/${encodeURIComponent(widget.id)}/refresh`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  const builtinKey = String(
    widget.source_config?.builtin_key ??
      widget.source_config?.builtin_type ??
      widget.source_config?.widget_type ??
      widget.cached_payload?.builtin_key ??
      widget.title ??
      '',
  ).toLowerCase();

  const payload = widget.cached_payload ?? {};

  const renderBuiltinBody = () => {
    // 1. Life Score / Life Radar
    if (builtinKey.includes('life_score') || builtinKey.includes('life_radar')) {
      const p = payload?.pillars ?? lifeScore?.pillars ?? {
        focus: 0,
        routines: 0,
        goals: 0,
        learning: 0,
        wealth: 0,
      };
      const compositeRaw = Number(
        payload?.composite_score ?? payload?.score ?? lifeScore?.composite_score ?? 0,
      );
      const composite = Number.isFinite(compositeRaw) ? compositeRaw : 0;
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            borderRadius: '0px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            <FuiBadge tone="orange">COMPOSITE SCORE: {Math.round(composite)} / 100</FuiBadge>
            <PrivacyValue kind="percent" value={`${composite.toFixed(1)}%`} />
          </div>
          <div data-fui-ring="true" style={{ borderRadius: '0px' }}>
            <LifeRadarReticle
              size={isEditMode ? 80 : 180}
              compositeScore={composite}
              pillars={[
                { key: 'focus', label: 'FOCUS', score: Number(p.focus ?? 0) },
                { key: 'routines', label: 'ROUTINES', score: Number(p.routines ?? 0) },
                { key: 'goals', label: 'GOALS', score: Number(p.goals ?? 0) },
                { key: 'learning', label: 'LEARNING', score: Number(p.learning ?? 0) },
                {
                  key: 'wealth_fi',
                  label: 'WEALTH_FI',
                  score: Number(p.wealth ?? p.wealth_fi ?? 0),
                },
              ]}
            />
          </div>
        </div>
      );
    }

    // 2. Focus Barcode & Todo Velocity
    if (
      builtinKey.includes('focus') ||
      builtinKey.includes('barcode') ||
      builtinKey.includes('todo') ||
      builtinKey.includes('execution')
    ) {
      const liveTasks = (liveTelemetry?.tasks ?? []).filter((t): t is TaskRecord =>
        Boolean(t && typeof t === 'object'),
      );
      const hasLiveTasks = liveTasks.length > 0;
      const done = hasLiveTasks
        ? liveTasks.filter((t) => t.status === 'done').length
        : Number(payload?.completed_tasks ?? 0);
      const total = hasLiveTasks
        ? liveTasks.filter((t) => t.status !== 'canceled').length
        : Number(payload?.total_tasks ?? 0);
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;

      const stats = liveTelemetry?.timeStats;
      const focusSecondsRaw = Number(
        stats?.today_seconds ?? payload?.focus_seconds_24h ?? 0,
      );
      const focusMinutes = Math.max(
        0,
        Math.round((Number.isFinite(focusSecondsRaw) ? focusSecondsRaw : 0) / 60),
      );

      let slotCount: 24 | 48 | 96 = 48;
      let slotValues: number[] = [];
      if (Array.isArray(stats?.barcode_buckets_96) && stats.barcode_buckets_96.length > 0) {
        slotCount = 96;
        slotValues = stats.barcode_buckets_96.map((sec) =>
          Math.min(1, Math.max(0, Number(sec || 0) / 900)),
        );
      } else if (Array.isArray(stats?.hourly_buckets_24h) && stats.hourly_buckets_24h.length > 0) {
        slotCount = 24;
        slotValues = stats.hourly_buckets_24h.map((sec) =>
          Math.min(1, Math.max(0, Number(sec || 0) / 3600)),
        );
      }

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRadius: '0px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <span>
              TASKS COMPLETED: {done}/{total}
            </span>
            <FuiBatteryCapsule progressPct={pct} segments={4} />
          </div>
          <FocusBarcode24h
            title="24H_FOCUS_BARCODE"
            slotCount={slotCount}
            slotValues={slotValues}
            totalMinutesLabel={`${focusMinutes}M LOGGED`}
          />
        </div>
      );
    }

    // 3. Routines Matrix & Bio Consistency
    if (builtinKey.includes('routine') || builtinKey.includes('habit')) {
      const ra = liveTelemetry?.routineAnalytics;
      const routinesList = (liveTelemetry?.routines ?? []).filter((r) =>
        Boolean(r && typeof r === 'object'),
      );
      const activeProfile = String(
        routinesList[0]?.day_profiles?.[0] ??
          routinesList[0]?.day_profile ??
          payload?.day_profile ??
          (routinesList.length > 0 ? 'ACTIVE' : 'STANDBY'),
      ).toUpperCase();

      const activeHabits = Number(payload?.active_habits ?? routinesList.length ?? 0);
      const logs7d = Number(payload?.logs_7d ?? 0);
      const fallbackAdherence =
        activeHabits > 0 ? Math.min(100, (logs7d / (activeHabits * 7)) * 100) : 0;
      const adherenceRaw = Number(
        ra?.consistency_score_pct ?? payload?.adherence_pct ?? fallbackAdherence,
      );
      const adherencePct = Number.isFinite(adherenceRaw) ? adherenceRaw : 0;

      const streaks = Array.isArray(ra?.streaks) ? ra.streaks : [];
      const streakCount =
        streaks.length > 0
          ? streaks.reduce((max, s) => Math.max(max, Number(s?.current_streak ?? 0)), 0)
          : Number(payload?.streak_count ?? 0);

      const matrixValues = Array.isArray(ra?.matrix_8x12) ? ra.matrix_8x12 : [];

      const heatmap = Array.isArray(ra?.heatmap_365d) ? ra.heatmap_365d : [];
      const sparkData =
        heatmap.length > 0
          ? heatmap
              .slice(-7)
              .map((d) => Math.round(Number(d?.completion_ratio ?? 0) * 100))
          : Array.isArray(ra?.routine_adherence) && ra.routine_adherence.length > 0
            ? ra.routine_adherence.map((r) => Number(r?.adherence_pct ?? 0))
            : [];

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRadius: '0px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <FuiBadge tone="phosphor">PROFILE // {activeProfile}</FuiBadge>
            <PrivacyValue kind="percent" value={`${adherencePct.toFixed(1)}%`} />
          </div>
          <BinaryDotMatrix8x12
            values={matrixValues}
            adherencePct={adherencePct}
            streakCount={streakCount}
          />
          <div data-fui-ring="true" style={{ borderRadius: '0px' }}>
            <WaveformSparkline
              data={sparkData}
              title="BIO_CONSISTENCY_7D"
              height={isEditMode ? 24 : 56}
            />
          </div>
        </div>
      );
    }

    // 4. Finance / Portfolio Waffle / FIRE Gauge / Monthly Surplus
    if (
      builtinKey.includes('finance') ||
      builtinKey.includes('portfolio') ||
      builtinKey.includes('fire') ||
      builtinKey.includes('waffle') ||
      builtinKey.includes('surplus')
    ) {
      const alloc = liveTelemetry?.allocation;
      const effectiveFire: FireProjectionRecord | null =
        liveTelemetry?.retirement ?? payload?.fire_projection ?? null;
      const plans = (liveTelemetry?.monthlyPlans ?? []).filter(
        (p): p is MonthlyPlanRecord => Boolean(p && typeof p === 'object'),
      );

      const totalBrlCents = Number(
        alloc?.total_brl_cents ??
          payload?.total_brl_cents ??
          effectiveFire?.current_net_worth_brl_cents ??
          0,
      );
      const totalUsdCents = Number(alloc?.total_usd_cents ?? payload?.total_usd_cents ?? 0);
      const brlFormatted = formatBrlCents(totalBrlCents);
      const usdFormatted = formatUsdCents(totalUsdCents);

      const fiPctRaw = Number(
        effectiveFire?.fi_progress_pct ?? effectiveFire?.progress_pct ?? 0,
      );
      const fiPct = Number.isFinite(fiPctRaw) ? fiPctRaw : 0;
      const passivePctRaw = Number(effectiveFire?.passive_income_coverage_pct ?? 0);
      const passivePct = Number.isFinite(passivePctRaw) ? passivePctRaw : 0;
      const durationLabel = formatFireDuration(effectiveFire);

      const waffleSlices = buildWaffleSlicesFromData(alloc, payload?.waffle_tiles);

      const monthlySurplusData: PairedMonthDatum[] = plans.map((p) => ({
        month: String(p.month || ''),
        planned: Number(p.planned_investment_cents ?? p.planned_spend_cents ?? 0) / 100,
        actual:
          p.actual_invested_cents !== undefined
            ? Number(p.actual_invested_cents) / 100
            : p.actual_spend_cents != null
              ? Number(p.actual_spend_cents) / 100
              : null,
        income: Number(p.salary_income_cents ?? 0) / 100,
      }));

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRadius: '0px' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              gap: '8px',
              fontSize: '12px',
            }}
          >
            <div>
              NET WORTH: <PrivacyValue kind="currency" currency="BRL" value={brlFormatted} />
            </div>
            {totalUsdCents > 0 && (
              <div>
                USD: <PrivacyValue kind="currency" currency="USD" value={usdFormatted} />
              </div>
            )}
            <div>
              FI PROGRESS: <PrivacyValue kind="percent" value={`${fiPct.toFixed(1)}%`} />
            </div>
            <div>
              TIME TO FI: <PrivacyValue kind="duration" value={durationLabel} />
            </div>
          </div>
          {builtinKey.includes('surplus') ? (
            <PairedHatchBarChart
              data={monthlySurplusData}
              mode="investment"
              currency="BRL"
              title="MONTHLY_INVESTABLE_SURPLUS"
              height={isEditMode ? 68 : 156}
            />
          ) : builtinKey.includes('fire_gauge') || builtinKey === 'net_worth_fire' ? (
            <div data-fui-ring="true" style={{ display: 'flex', justifyContent: 'center' }}>
              <HatchedDonutGauge
                solidPct={fiPct}
                hatchedPct={passivePct}
                centerLabel={`${fiPct.toFixed(1)}%`}
                durationLabel={durationLabel}
                size={isEditMode ? 72 : 148}
              />
            </div>
          ) : (
            <WaffleGrid10x20
              items={waffleSlices}
              totalValueCents={totalBrlCents}
              preserveUnallocated={waffleSlices.length === 0}
            />
          )}
        </div>
      );
    }

    // 5. Yearly Goals / OKRs
    if (builtinKey.includes('goal') || builtinKey.includes('okr')) {
      const goalsList = (liveTelemetry?.goals ?? []).filter((g): g is GoalRecord =>
        Boolean(g && typeof g === 'object'),
      );
      const activeGoalsCount =
        goalsList.length > 0
          ? goalsList.filter(
              (g) => !g.status || g.status === 'not_started' || g.status === 'in_progress',
            ).length
          : Number(payload?.active_goals ?? 0);
      const avgGoalPct =
        goalsList.length > 0
          ? goalsList.reduce((acc, g) => acc + (Number(g.progress_pct) || 0), 0) /
            goalsList.length
          : Number(payload?.avg_progress_pct ?? 0);
      const safeGoalPct = Number.isFinite(avgGoalPct) ? avgGoalPct : 0;
      const paceLabel =
        goalsList.length === 0 && activeGoalsCount === 0
          ? 'STANDBY'
          : safeGoalPct >= 50
            ? 'ON_TRACK'
            : 'IN_PROGRESS';

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRadius: '0px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <FuiBadge tone="vermilion">NORTH_STAR // Q1-Q4 BLUEPRINT</FuiBadge>
            <PrivacyValue kind="percent" value={`${safeGoalPct.toFixed(1)}%`} />
          </div>
          <div style={{ fontSize: '12px', color: FUI_TOKENS.inkProse }}>
            ACTIVE GOALS: {activeGoalsCount} | PACE: {paceLabel}
          </div>
          <FuiBatteryCapsule progressPct={Math.round(safeGoalPct)} segments={4} />
        </div>
      );
    }

    // 6. Courses & Spaced Reviews
    if (builtinKey.includes('course')) {
      const coursesList = (liveTelemetry?.courses ?? []).filter((c): c is CourseRecord =>
        Boolean(c && typeof c === 'object'),
      );
      const dueList = Array.isArray(liveTelemetry?.dueReviews)
        ? liveTelemetry.dueReviews.filter(Boolean)
        : [];
      const activeCoursesCount =
        coursesList.length > 0
          ? coursesList.filter(
              (c) => !c.status || c.status === 'active' || c.status === 'capstone',
            ).length
          : Number(payload?.active_courses ?? 0);
      const dueReviewsCount =
        dueList.length > 0 ? dueList.length : Number(payload?.due_reviews ?? 0);
      const avgCoursePct =
        coursesList.length > 0
          ? coursesList.reduce((acc, c) => {
              if (c.progress_pct !== undefined && c.progress_pct !== null) {
                return acc + (Number(c.progress_pct) || 0);
              }
              const tot = Number(c.total_items ?? c.total_lessons ?? 0);
              const comp = Number(c.completed_items ?? c.completed_lessons ?? 0);
              return acc + (tot > 0 ? (comp / tot) * 100 : 0);
            }, 0) / coursesList.length
          : Number(payload?.progress_pct ?? 0);
      const safeCoursePct = Number.isFinite(avgCoursePct) ? avgCoursePct : 0;

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRadius: '0px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
            <FuiBadge tone="cyan">ACTIVE COURSES: {activeCoursesCount}</FuiBadge>
            <FuiBadge tone="amber">SPACED REVIEWS DUE: {dueReviewsCount}</FuiBadge>
          </div>
          <FuiBatteryCapsule progressPct={Math.round(safeCoursePct)} segments={4} />
        </div>
      );
    }

    // 7. Server Infrastructure Prober
    if (builtinKey.includes('server') || builtinKey.includes('infra')) {
      const rawServers: ServerNodeRecord[] =
        servers.length > 0
          ? servers
          : Array.isArray(payload?.servers)
            ? payload.servers
            : [];
      const mergedServers = rawServers.filter((s): s is ServerNodeRecord =>
        Boolean(s && typeof s === 'object'),
      );
      const summary = serverSummary ?? payload?.summary;

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRadius: '0px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
            <FuiBadge tone="phosphor">
              ONLINE: {summary?.online ?? mergedServers.filter((s) => s.status === 'online').length}
            </FuiBadge>
            <FuiBadge tone="amber">
              DEGRADED:{' '}
              {summary?.degraded ?? mergedServers.filter((s) => s.status === 'degraded').length}
            </FuiBadge>
            <FuiBadge tone="vermilion">
              OFFLINE:{' '}
              {summary?.offline ?? mergedServers.filter((s) => s.status === 'offline').length}
            </FuiBadge>
            {!kioskMode && (
              <FuiButton
                size="sm"
                variant="secondary"
                data-testid="toggle-add-server-btn"
                onClick={() => setShowAddServer(!showAddServer)}
              >
                + Add Server
              </FuiButton>
            )}
          </div>

          {showAddServer && !kioskMode && (
            <form
              onSubmit={(e) => createServerMutation.mutate(e)}
              style={{
                display: 'flex',
                gap: '6px',
                flexWrap: 'wrap',
                padding: '6px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
              }}
            >
              <FuiInput
                placeholder="Node Name"
                value={newSrvName}
                onChange={(e) => setNewSrvName(e.target.value)}
              />
              <FuiInput
                placeholder="Host"
                value={newSrvHost}
                onChange={(e) => setNewSrvHost(e.target.value)}
              />
              <FuiInput
                placeholder="Port"
                value={newSrvPort}
                onChange={(e) => setNewSrvPort(e.target.value)}
              />
              <FuiButton type="submit" size="sm" variant="primary">
                Save Node
              </FuiButton>
            </form>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {mergedServers.map((srv) => {
              const statusUpper = String(srv.status || 'unknown').toUpperCase();
              const tone =
                statusUpper === 'ONLINE'
                  ? 'phosphor'
                  : statusUpper === 'DEGRADED'
                    ? 'amber'
                    : 'vermilion';
              return (
                <div
                  key={srv.id}
                  data-testid={`server-row-${srv.id}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    padding: '6px 8px',
                    backgroundColor: FUI_TOKENS.bgCarbon,
                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                    fontSize: '12px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '6px',
                    }}
                  >
                    <strong>{srv.name}</strong>
                    <span style={{ color: FUI_TOKENS.inkMuted }}>
                      {srv.host}:{srv.port} ({String(srv.check_type || 'tcp').toUpperCase()})
                    </span>
                    <FuiBadge tone={tone}>{statusUpper}</FuiBadge>
                    <span>{srv.last_latency_ms ?? 0}ms</span>
                    {!kioskMode && (
                      <FuiButton
                        size="sm"
                        variant="ghost"
                        data-testid={`probe-server-${srv.id}`}
                        onClick={() => probeServerMutation.mutate(srv.id)}
                      >
                        Probe Now
                      </FuiButton>
                    )}
                  </div>
                  {Array.isArray(srv.latency_history_ms) && srv.latency_history_ms.length > 0 && (
                    <div data-fui-ring="true" style={{ borderRadius: '0px' }}>
                      <WaveformSparkline
                        data={srv.latency_history_ms.slice(-24)}
                        title={`LATENCY // ${srv.name}`}
                        height={isEditMode ? 22 : 44}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // 8. Knights Order & Hermes Pulse
    if (builtinKey.includes('knight')) {
      const agentsList = (liveTelemetry?.agents ?? []).filter((a): a is AgentRecord =>
        Boolean(a && typeof a === 'object'),
      );
      const enabledAgents = agentsList.filter((a) => a.enabled !== false);
      const activeKnightsCount =
        agentsList.length > 0 ? enabledAgents.length : Number(payload?.enabled_knights ?? 0);
      const pendingCount = Number(
        payload?.pending_approvals ??
          pendingApprovals.filter(
            (a) => a && String(a.status || '').toLowerCase() === 'pending',
          ).length,
      );
      const leadKnight = enabledAgents[0] ?? agentsList[0] ?? null;

      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
            borderRadius: '0px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <FuiBadge tone="orange">ACTIVE KNIGHTS: {activeKnightsCount}</FuiBadge>
            <div style={{ fontSize: '12px', color: FUI_TOKENS.inkMuted }}>
              PENDING MCP APPROVALS: {pendingCount}
            </div>
            {agentsList.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {agentsList.slice(0, 4).map((k) => (
                  <FuiBadge key={k.id} tone="cyan">
                    {k.name}
                  </FuiBadge>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: FUI_TOKENS.inkMuted }}>
                [STANDBY // 0 KNIGHTS LOADED]
              </div>
            )}
          </div>
          {leadKnight && (
            <IsometricKnightSprite
              archetype={normalizeArchetype(leadKnight.knight_archetype)}
              state={leadKnight.is_paused ? 'barracks_rest' : 'idle'}
              scale={2}
              name={leadKnight.name}
              hpPct={Math.round(Number(leadKnight.hp_pct ?? 100))}
              epPct={Math.round(Number(leadKnight.ep_pct ?? 0))}
            />
          )}
        </div>
      );
    }

    // 9. Second Brain Constellation
    const vaultNotes = (liveTelemetry?.vaultNotes ?? []).filter((n): n is VaultNoteRecord =>
      Boolean(n && typeof n === 'object' && n.path),
    );
    const constellationNodes: ConstellationNode[] = vaultNotes.slice(0, 32).map((n) => ({
      id: n.path,
      label: n.title || n.path,
      cluster: n.folder || 'root',
      vaultPath: n.path,
    }));
    const constellationEdges: ConstellationEdge[] = [];
    const byFolder = new Map<string, string[]>();
    for (const node of constellationNodes) {
      const folder = node.cluster || 'root';
      const arr = byFolder.get(folder) ?? [];
      if (arr.length > 0) {
        constellationEdges.push({
          source: arr[arr.length - 1]!,
          target: node.id,
          weight: 1,
        });
      }
      arr.push(node.id);
      byFolder.set(folder, arr);
    }
    const vaultChunks = Number(payload?.vault_chunks ?? vaultNotes.length);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderRadius: '0px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
          <FuiBadge tone="cyan">VAULT NOTES: {vaultNotes.length}</FuiBadge>
          <span style={{ color: FUI_TOKENS.inkMuted }}>CHUNKS: {vaultChunks}</span>
        </div>
        <div data-fui-ring="true" style={{ display: 'flex', justifyContent: 'center' }}>
          <ConstellationMesh
            size={isEditMode ? 80 : 180}
            nodes={constellationNodes}
            edges={constellationEdges}
            title="SECOND_BRAIN // CONSTELLATION"
          />
        </div>
      </div>
    );
  };

  const renderRendererVisual = (
    rendererKind: DashboardWidgetRecord['renderer_kind'],
    rawData: unknown,
    textDigest: string,
  ) => {
    const entries = extractKeyValueEntries(rawData);
    const numbers = extractNumbersFromAny(rawData);

    if (rendererKind === 'kpi') {
      const primaryNum = numbers.length > 0 ? numbers[0] : null;
      const kpiHeadline =
        primaryNum !== null ? String(primaryNum) : textDigest.slice(0, 32) || '--';
      return (
        <div
          data-custom-viz="kpi"
          style={{
            padding: '8px 10px',
            backgroundColor: FUI_TOKENS.bgCarbon,
            border: `1px solid ${FUI_TOKENS.borderHairline}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            borderRadius: '0px',
          }}
        >
          <span style={{ color: FUI_TOKENS.inkMuted, fontSize: '12px' }}>KPI_METRIC</span>
          <strong
            style={{
              fontFamily: FUI_TOKENS.fontDisplay,
              fontSize: '26px',
              color: FUI_TOKENS.accentOrange,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {kpiHeadline}
          </strong>
        </div>
      );
    }

    if (rendererKind === 'sparkline') {
      return (
        <div data-fui-ring="true" data-custom-viz="sparkline" style={{ borderRadius: '0px' }}>
          <WaveformSparkline
            data={numbers}
            title={`TRACE // ${widget.title}`}
            height={isEditMode ? 24 : 52}
          />
        </div>
      );
    }

    if (rendererKind === 'waffle') {
      const positiveEntries = entries.filter((e) => e.num !== null && e.num > 0);
      const sum = positiveEntries.reduce((acc, e) => acc + (e.num ?? 0), 0);
      const slices: WaffleSliceInput[] =
        sum > 0
          ? positiveEntries.map((e, i) => ({
              id: `${e.key}-${i}`,
              label: e.key,
              weightPct: ((e.num ?? 0) / sum) * 100,
            }))
          : [];
      return (
        <div data-custom-viz="waffle" style={{ borderRadius: '0px' }}>
          <WaffleGrid10x20
            items={slices}
            preserveUnallocated={slices.length === 0}
            title={`WAFFLE // ${widget.title}`}
          />
        </div>
      );
    }

    if (rendererKind === 'bar') {
      const pct =
        numbers.length > 0 ? Math.max(0, Math.min(100, Math.round(numbers[0]!))) : 0;
      return (
        <div
          data-custom-viz="bar"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            padding: '8px',
            backgroundColor: FUI_TOKENS.bgCarbon,
            border: `1px solid ${FUI_TOKENS.borderHairline}`,
            borderRadius: '0px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: FUI_TOKENS.inkMuted, fontSize: '12px' }}>BAR_GAUGE</span>
            <FuiBatteryCapsule progressPct={pct} segments={5} />
          </div>
          {entries.slice(0, 3).map((e, idx) => {
            const barWidth =
              e.num !== null ? Math.max(4, Math.min(100, Math.round(Math.abs(e.num)))) : 0;
            return (
              <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span>{e.key}</span>
                  <span>{e.value}</span>
                </div>
                <div
                  style={{
                    height: '6px',
                    width: '100%',
                    backgroundColor: FUI_TOKENS.bgPanel,
                    borderRadius: '0px',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${barWidth}%`,
                      backgroundColor: FUI_TOKENS.accentOrange,
                      borderRadius: '0px',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (rendererKind === 'table') {
      return (
        <table
          data-custom-viz="table"
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  textAlign: 'left',
                  padding: '4px 6px',
                  borderBottom: `1px solid ${FUI_TOKENS.accentOrange}`,
                  color: FUI_TOKENS.accentOrange,
                }}
              >
                FIELD
              </th>
              <th
                style={{
                  textAlign: 'left',
                  padding: '4px 6px',
                  borderBottom: `1px solid ${FUI_TOKENS.accentOrange}`,
                  color: FUI_TOKENS.accentOrange,
                }}
              >
                VALUE
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, idx) => (
              <tr key={idx}>
                <td
                  style={{
                    padding: '4px 6px',
                    borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
                    color: FUI_TOKENS.inkMuted,
                  }}
                >
                  {e.key}
                </td>
                <td
                  style={{
                    padding: '4px 6px',
                    borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
                    color: FUI_TOKENS.inkStark,
                  }}
                >
                  {e.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (rendererKind === 'terminal') {
      return (
        <pre
          data-custom-viz="terminal"
          style={{
            margin: 0,
            padding: '8px',
            backgroundColor: FUI_TOKENS.bgCarbon,
            border: `1px solid ${FUI_TOKENS.borderHairline}`,
            color: FUI_TOKENS.accentPhosphor,
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            whiteSpace: 'pre-wrap',
            overflowX: 'auto',
            borderRadius: '0px',
          }}
        >
          {`[TTY // ${String(widget.source_kind || 'custom').toUpperCase()}]\n${textDigest}`}
        </pre>
      );
    }

    // custom_module
    return (
      <div
        data-custom-viz="custom_module"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: '6px',
          padding: '8px',
          backgroundColor: FUI_TOKENS.bgCarbon,
          border: `1px solid ${FUI_TOKENS.borderHairline}`,
          fontSize: '12px',
          borderRadius: '0px',
        }}
      >
        <div>
          <span style={{ color: FUI_TOKENS.inkMuted }}>MODULE:</span>{' '}
          <strong>{String(widget.source_kind || 'custom').toUpperCase()}</strong>
        </div>
        <div>
          <span style={{ color: FUI_TOKENS.inkMuted }}>FIELDS:</span>{' '}
          <strong>{entries.length}</strong>
        </div>
        {entries.slice(0, 2).map((e, idx) => (
          <div key={idx} style={{ gridColumn: 'span 2' }}>
            <FuiBadge tone="cyan">{e.key}</FuiBadge> <span>{e.value}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderCustomBody = () => {
    const rendererKind = widget.renderer_kind || 'custom_module';

    // 1. Command widget (with strict Tier-3 MCP Approval Guard)
    if (widget.source_kind === 'command') {
      const hasExecutedOutput =
        (payload?.stdout !== undefined || payload?.exit_code !== undefined) &&
        widget.source_config?.approved !== false &&
        payload?.status !== 'pending_approval';

      const matchingApproval = hasExecutedOutput
        ? undefined
        : pendingApprovals.find((a) => {
            if (!a || String(a.status || '').toLowerCase() !== 'pending') return false;
            if (!String(a.tool_name || '').includes('command_widget')) return false;
            const pj =
              a.payload_json && typeof a.payload_json === 'object' ? a.payload_json : {};
            if (pj.widget_id && String(pj.widget_id) === String(widget.id)) return true;
            const matchesDeck = !pj.dashboard_id || String(pj.dashboard_id) === String(deckId);
            const matchesTitle = Boolean(pj.title) && String(pj.title) === String(widget.title);
            return matchesDeck && matchesTitle;
          });

      const isUnapproved =
        Boolean(matchingApproval) ||
        widget.source_config?.approved === false ||
        payload?.status === 'pending_approval' ||
        (payload?.stdout === undefined && payload?.exit_code === undefined);

      if (isUnapproved) {
        return (
          <div
            data-testid="widget-command-pending-approval"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '8px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.accentOrange}`,
              fontSize: '12px',
              borderRadius: '0px',
            }}
          >
            <FuiBadge tone="amber">[PENDING APPROVAL // TIER 3 AUTONOMY]</FuiBadge>
            <div>Command execution awaits explicit operator approval.</div>
            {matchingApproval && (
              <FuiButton
                size="sm"
                variant="primary"
                data-testid={`approve-widget-cmd-${matchingApproval.id}`}
                onClick={() => approveCmdMutation.mutate(matchingApproval.id)}
              >
                Approve & Execute
              </FuiButton>
            )}
          </div>
        );
      }

      const stdout = String(payload?.stdout ?? payload?.output ?? '');
      const timedOut = Boolean(payload?.timed_out || payload?.status === 'timeout');
      const cmdData = payload?.parsed_json ?? stdout;

      return (
        <div
          data-renderer-kind={rendererKind}
          style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderRadius: '0px' }}
        >
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <FuiBadge tone={timedOut ? 'vermilion' : 'phosphor'}>
              {timedOut ? 'TIMEOUT' : `EXIT:${payload?.exit_code ?? 0}`}
            </FuiBadge>
            <FuiBadge tone="stark">{rendererKind.toUpperCase()}</FuiBadge>
          </div>
          {rendererKind !== 'terminal' && renderRendererVisual(rendererKind, cmdData, stdout)}
          <pre
            data-testid="widget-command-stdout"
            data-custom-viz={rendererKind === 'terminal' ? 'terminal' : undefined}
            style={{
              margin: 0,
              padding: '8px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              color: FUI_TOKENS.accentPhosphor,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              overflowX: 'auto',
              borderRadius: '0px',
            }}
          >
            {stdout}
          </pre>
        </div>
      );
    }

    // 2. HTTP widget
    if (widget.source_kind === 'http') {
      const hasCachedPayload =
        widget.cached_payload !== null &&
        widget.cached_payload !== undefined &&
        (typeof widget.cached_payload !== 'object' ||
          Object.keys(widget.cached_payload).length > 0);

      const rawStatus = payload?.status;
      const numericStatus =
        rawStatus !== undefined && rawStatus !== null ? Number(rawStatus) : Number.NaN;
      const errorText = refreshMutation.isError
        ? String((refreshMutation.error as any)?.message || 'HTTP refresh failed')
        : initialRefreshError
          ? String(initialRefreshError)
          : payload?.error
            ? String(payload.error)
            : null;

      const isStatusInvalidOrError =
        rawStatus !== undefined &&
        rawStatus !== null &&
        (Number.isNaN(numericStatus) || numericStatus <= 0 || numericStatus >= 400);

      const isDegraded =
        refreshMutation.isError ||
        Boolean(initialRefreshError) ||
        Boolean(payload?.error) ||
        payload?.degraded === true ||
        isStatusInvalidOrError;

      const isPendingUnprobed =
        !isDegraded && (!hasCachedPayload || rawStatus === undefined || rawStatus === null);

      const pointerCfg = String(
        widget.source_config?.json_pointer ?? widget.source_config?.json_path ?? '',
      ).trim();
      const sourceBody = payload?.raw ?? payload?.body ?? payload?.data;
      const pointerExtracted =
        (payload?.extracted === undefined || payload?.extracted === null) && pointerCfg
          ? extractByPointerOrPath(sourceBody, pointerCfg)
          : undefined;

      const extracted =
        payload?.extracted !== undefined && payload?.extracted !== null
          ? payload.extracted
          : pointerExtracted !== undefined
            ? pointerExtracted
            : errorText !== null && !hasCachedPayload
              ? errorText
              : sourceBody !== undefined
                ? sourceBody
                : hasCachedPayload
                  ? payload
                  : '';

      const formattedExtracted =
        typeof extracted === 'object' && extracted !== null
          ? JSON.stringify(extracted)
          : String(extracted ?? '');

      return (
        <div
          data-renderer-kind={rendererKind}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            fontSize: '12px',
            borderRadius: '0px',
          }}
        >
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            {isDegraded ? (
              <FuiBadge tone="amber">
                {`DEGRADED // HTTP ${
                  Number.isFinite(numericStatus) && numericStatus > 0 ? numericStatus : 'ERR'
                }`}
              </FuiBadge>
            ) : isPendingUnprobed ? (
              <FuiBadge tone="amber">PENDING // UNPROBED</FuiBadge>
            ) : (
              <FuiBadge tone="cyan">{`HTTP ${numericStatus}`}</FuiBadge>
            )}
            <FuiBadge tone="stark">{rendererKind.toUpperCase()}</FuiBadge>
          </div>
          {errorText && (
            <div style={{ color: FUI_TOKENS.accentAmber, fontSize: '12px' }}>{errorText}</div>
          )}
          {rendererKind !== 'kpi' &&
            renderRendererVisual(rendererKind, extracted, formattedExtracted)}
          <div
            data-testid="widget-http-value"
            data-custom-viz={rendererKind === 'kpi' ? 'kpi' : undefined}
            style={{
              padding: '8px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              fontFamily:
                rendererKind === 'kpi' ? FUI_TOKENS.fontDisplay : FUI_TOKENS.fontMono,
              fontSize: rendererKind === 'kpi' ? '22px' : '14px',
              fontWeight: 700,
              color: isDegraded ? FUI_TOKENS.accentAmber : FUI_TOKENS.inkStark,
              borderRadius: '0px',
            }}
          >
            {formattedExtracted}
          </div>
        </div>
      );
    }

    // 3. SQL widget
    if (widget.source_kind === 'sql') {
      const rawRows = Array.isArray(payload?.rows)
        ? payload.rows
        : Array.isArray(payload?.data?.rows)
          ? payload.data.rows
          : [];
      const rows: Array<Record<string, any>> = rawRows.filter(
        (r: any): r is Record<string, any> =>
          Boolean(r && typeof r === 'object' && !Array.isArray(r)),
      );
      const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
      const sqlDigest = rows.length > 0 ? JSON.stringify(rows[0]) : '[0 ROWS RETURNED]';

      return (
        <div
          data-renderer-kind={rendererKind}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            overflowX: 'auto',
            fontSize: '12px',
            borderRadius: '0px',
          }}
        >
          {rendererKind !== 'table' && renderRendererVisual(rendererKind, rows, sqlDigest)}
          {rows.length > 0 ? (
            <table
              data-testid="widget-sql-table"
              data-custom-viz={rendererKind === 'table' ? 'table' : undefined}
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
              }}
            >
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col}
                      style={{
                        textAlign: 'left',
                        padding: '4px 6px',
                        borderBottom: `1px solid ${FUI_TOKENS.accentOrange}`,
                        color: FUI_TOKENS.accentOrange,
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    {columns.map((col) => (
                      <td
                        key={col}
                        style={{
                          padding: '4px 6px',
                          borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
                          color: FUI_TOKENS.inkStark,
                        }}
                      >
                        {String(row[col] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ color: FUI_TOKENS.inkMuted }}>[0 ROWS RETURNED]</div>
          )}
        </div>
      );
    }

    // 4. Hermes widget
    const hermesText = String(
      payload?.response ??
        payload?.summary ??
        payload?.content ??
        'HERMES // OFFLINE_MOCK TELEMETRY BRIEF READY',
    );
    return (
      <div
        data-renderer-kind={rendererKind}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          fontSize: '12px',
          borderRadius: '0px',
        }}
      >
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <FuiBadge tone="cyan">
            HERMES // {String(payload?.gateway_mode || 'OFFLINE_MOCK').toUpperCase()}
          </FuiBadge>
          <FuiBadge tone="stark">{rendererKind.toUpperCase()}</FuiBadge>
        </div>
        {rendererKind !== 'terminal' &&
          renderRendererVisual(rendererKind, payload, hermesText)}
        <div
          data-testid="widget-hermes-response"
          data-custom-viz={rendererKind === 'terminal' ? 'terminal' : undefined}
          style={{
            padding: '8px',
            backgroundColor: FUI_TOKENS.bgCarbon,
            border: `1px solid ${FUI_TOKENS.borderHairline}`,
            color: FUI_TOKENS.inkProse,
            fontFamily: FUI_TOKENS.fontMono,
            whiteSpace: rendererKind === 'terminal' ? 'pre-wrap' : 'normal',
            borderRadius: '0px',
          }}
        >
          {hermesText}
        </div>
      </div>
    );
  };

  const spanW = Math.min(12, Math.max(1, Number(rect.w) || 4));
  const spanH = Math.min(8, Math.max(1, Number(rect.h) || 3));
  const rawX = Number(rect.x);
  const rawY = Number(rect.y);
  const effectiveW = resolvedGridPlacement?.w ?? spanW;
  const effectiveH = resolvedGridPlacement?.h ?? spanH;
  const effectiveX =
    resolvedGridPlacement?.x ??
    (Number.isInteger(rawX) && rawX >= 0 ? Math.min(12 - effectiveW, rawX) : 0);
  const effectiveY =
    resolvedGridPlacement?.y ??
    (Number.isInteger(rawY) && rawY >= 0 ? Math.min(8 - effectiveH, rawY) : 0);

  const defaultGridColumn =
    Number.isInteger(rawX) && rawX >= 0 && rawX + spanW <= 12
      ? `${rawX + 1} / span ${spanW}`
      : `span ${spanW}`;
  const defaultGridRow =
    Number.isInteger(rawY) && rawY >= 0 && rawY + spanH <= 8
      ? `${rawY + 1} / span ${spanH}`
      : `span ${spanH}`;

  const clampCardRect = (next: { x: number; y: number; w: number; h: number }): GridRect => {
    const w = Math.min(12, Math.max(1, Math.round(Number(next.w)) || 4));
    const h = Math.min(8, Math.max(1, Math.round(Number(next.h)) || 3));
    const x = Math.min(12 - w, Math.max(0, Math.round(Number(next.x)) || 0));
    const y = Math.min(8 - h, Math.max(0, Math.round(Number(next.y)) || 0));
    return { x, y, w, h };
  };

  const resizeActiveRef = React.useRef(false);

  const startResizeDrag = (
    axis: 'e' | 's' | 'se',
    startClientX: number,
    startClientY: number,
  ) => {
    if (!onResizeWidget || resizeActiveRef.current) return;
    resizeActiveRef.current = true;
    const gridEl = document.querySelector('[data-testid="room-monitor-grid"]');
    const gridBounds = gridEl?.getBoundingClientRect();
    const colStepPx =
      gridBounds && gridBounds.width > 120 ? gridBounds.width / 12 : 80;
    const rowStepPx =
      gridBounds && gridBounds.height > 160 ? Math.max(28, gridBounds.height / 8) : 80;

    let latestW = effectiveW;
    let latestH = effectiveH;

    const computeNext = (clientX: number, clientY: number) => {
      const dx = clientX - startClientX;
      const dy = clientY - startClientY;
      const deltaCols = axis === 'e' || axis === 'se' ? Math.round(dx / colStepPx) : 0;
      const deltaRows = axis === 's' || axis === 'se' ? Math.round(dy / rowStepPx) : 0;
      latestW = Math.min(12, Math.max(1, effectiveW + deltaCols));
      latestH = Math.min(8, Math.max(1, effectiveH + deltaRows));
    };

    const handleMove = (ev: MouseEvent | PointerEvent) => {
      computeNext(ev.clientX, ev.clientY);
    };

    let finished = false;
    const handleUp = (ev: MouseEvent | PointerEvent) => {
      if (finished) return;
      finished = true;
      resizeActiveRef.current = false;
      computeNext(ev.clientX, ev.clientY);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('mouseup', handleUp);
      onResizeWidget(
        widget,
        clampCardRect({
          x: effectiveX,
          y: effectiveY,
          w: latestW,
          h: latestH,
        }),
      );
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('mouseup', handleUp);
  };

  const presetSpans: Array<[number, number]> = [
    [3, 2],
    [4, 3],
    [4, 4],
    [6, 4],
    [6, 5],
    [12, 4],
  ];

  return (
    <article
      data-testid={`widget-card-${widget.id}`}
      data-widget-id={widget.id}
      data-source-kind={widget.source_kind}
      data-renderer-kind={widget.renderer_kind}
      data-grid-x={effectiveX}
      data-grid-y={effectiveY}
      data-grid-w={effectiveW}
      data-grid-h={effectiveH}
      data-grid-span={`${effectiveW}x${effectiveH}`}
      draggable={!kioskMode}
      onDragStart={(e) => onDragStartWidget?.(widget, e)}
      onDragOver={(e) => {
        if (!kioskMode) {
          e.preventDefault();
          e.stopPropagation();
          onDragOverWidget?.(widget, e);
        }
      }}
      onDrop={(e) => {
        if (!kioskMode) {
          e.preventDefault();
          e.stopPropagation();
          onDropOnWidget?.(widget, e);
        }
      }}
      onDragEnd={() => onDragEndWidget?.()}
      style={{
        gridColumn: resolvedGridPlacement?.gridColumn ?? defaultGridColumn,
        gridRow: resolvedGridPlacement?.gridRow ?? defaultGridRow,
        position: 'relative',
        zIndex: 2,
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        maxHeight: '100%',
        overflow: 'hidden',
        boxSizing: 'border-box',
        pointerEvents: isDragging ? 'none' : 'auto',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: FUI_TOKENS.bgPanel,
        border: isDropTarget
          ? `2px solid ${FUI_TOKENS.accentVermilion}`
          : isEditMode && !kioskMode
            ? `1px solid ${FUI_TOKENS.accentOrange}`
            : `1px solid ${FUI_TOKENS.borderHairline}`,
        opacity: isDragging ? 0.65 : 1,
        color: FUI_TOKENS.inkStark,
        borderRadius: '0px',
      }}
    >
      <FuiPanelHeader
        title={widget.title}
        code={String(widget.source_kind || 'builtin').toUpperCase()}
        accent="orange"
        actions={
          !kioskMode ? (
            <div
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                flexWrap: 'wrap',
                borderRadius: '0px',
              }}
            >
              <span
                data-testid={`widget-span-badge-${widget.id}`}
                style={{
                  padding: '2px 6px',
                  fontSize: '12px',
                  fontFamily: FUI_TOKENS.fontMono,
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  color: isEditMode ? FUI_TOKENS.accentCyan : FUI_TOKENS.inkMuted,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  borderRadius: '0px',
                }}
              >
                {isEditMode
                  ? `${effectiveW}×${effectiveH} @${effectiveX},${effectiveY}`
                  : `${effectiveW}×${effectiveH}`}
              </span>
              <button
                type="button"
                data-testid={`drag-handle-${widget.id}`}
                aria-label={`Drag ${widget.title}`}
                draggable={!kioskMode}
                onDragStart={(e) => {
                  e.stopPropagation();
                  onDragStartWidget?.(widget, e);
                }}
                style={{
                  padding: '2px 6px',
                  fontSize: '12px',
                  fontFamily: FUI_TOKENS.fontMono,
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  color: isEditMode ? FUI_TOKENS.accentOrange : FUI_TOKENS.inkMuted,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  cursor: 'grab',
                  borderRadius: '0px',
                }}
              >
                ⠿
              </button>
              {onStashWidget && (
                <FuiButton
                  size="sm"
                  variant="ghost"
                  aria-label={`Save ${widget.title} for later`}
                  title="Save card for later"
                  data-testid={`stash-widget-${widget.id}`}
                  onClick={() => onStashWidget(widget)}
                >
                  📥
                </FuiButton>
              )}
              {onEditWidget && (
                <FuiButton
                  size="sm"
                  variant="ghost"
                  aria-label={`Edit ${widget.title}`}
                  data-testid={`edit-widget-${widget.id}`}
                  onClick={() => onEditWidget(widget)}
                >
                  ✎
                </FuiButton>
              )}
              <FuiButton
                size="sm"
                variant="ghost"
                aria-label={`Refresh ${widget.title}`}
                data-testid={`refresh-widget-${widget.id}`}
                onClick={() => refreshMutation.mutate()}
              >
                ↻
              </FuiButton>
              <FuiButton
                size="sm"
                variant="ghost"
                aria-label={`Delete ${widget.title}`}
                title="Delete card"
                data-testid={`delete-widget-${widget.id}`}
                onClick={() => deleteMutation.mutate()}
              >
                🗑
              </FuiButton>
              <button
                type="button"
                data-testid={`widget-options-btn-${widget.id}`}
                aria-label={`Options menu for ${widget.title}`}
                aria-expanded={showOptionsMenu}
                onClick={() => setShowOptionsMenu((prev) => !prev)}
                style={{
                  padding: '2px 6px',
                  fontSize: '12px',
                  fontFamily: FUI_TOKENS.fontMono,
                  backgroundColor: showOptionsMenu ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgCarbon,
                  color: showOptionsMenu ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                  border: `1px solid ${
                    showOptionsMenu ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                  }`,
                  cursor: 'pointer',
                  borderRadius: '0px',
                }}
              >
                ⋮
              </button>

              {showOptionsMenu && (
                <div
                  data-testid={`widget-options-menu-${widget.id}`}
                  role="menu"
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '4px',
                    minWidth: '176px',
                    zIndex: 30,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    padding: '4px',
                    backgroundColor: FUI_TOKENS.bgCarbon,
                    border: `1px solid ${FUI_TOKENS.accentOrange}`,
                    borderRadius: '0px',
                  }}
                >
                  {onEditWidget && (
                    <button
                      type="button"
                      role="menuitem"
                      data-testid={`option-edit-widget-${widget.id}`}
                      onClick={() => {
                        setShowOptionsMenu(false);
                        onEditWidget(widget);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        width: '100%',
                        padding: '5px 8px',
                        fontSize: '12px',
                        fontFamily: FUI_TOKENS.fontMono,
                        color: FUI_TOKENS.inkStark,
                        backgroundColor: FUI_TOKENS.bgPanel,
                        border: `1px solid ${FUI_TOKENS.borderHairline}`,
                        cursor: 'pointer',
                        borderRadius: '0px',
                      }}
                    >
                      <span>✎ Edit Options</span>
                    </button>
                  )}
                  {onStashWidget && (
                    <button
                      type="button"
                      role="menuitem"
                      data-testid={`option-stash-widget-${widget.id}`}
                      onClick={() => {
                        setShowOptionsMenu(false);
                        onStashWidget(widget);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        width: '100%',
                        padding: '5px 8px',
                        fontSize: '12px',
                        fontFamily: FUI_TOKENS.fontMono,
                        color: FUI_TOKENS.accentCyan,
                        backgroundColor: FUI_TOKENS.bgPanel,
                        border: `1px solid ${FUI_TOKENS.borderHairline}`,
                        cursor: 'pointer',
                        borderRadius: '0px',
                      }}
                    >
                      <span>📥 Save for Later</span>
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`option-delete-widget-${widget.id}`}
                    onClick={() => {
                      setShowOptionsMenu(false);
                      deleteMutation.mutate();
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      width: '100%',
                      padding: '5px 8px',
                      fontSize: '12px',
                      fontFamily: FUI_TOKENS.fontMono,
                      fontWeight: 700,
                      color: FUI_TOKENS.accentVermilion,
                      backgroundColor: FUI_TOKENS.bgPanel,
                      border: `1px solid ${FUI_TOKENS.accentVermilion}`,
                      cursor: 'pointer',
                      borderRadius: '0px',
                    }}
                  >
                    <span>🗑 Delete Card</span>
                  </button>
                </div>
              )}
            </div>
          ) : undefined
        }
      />

      {/* R1 & R2 Edit Mode 2D Space Control Bar */}
      {isEditMode && !kioskMode && (
        <div
          data-testid={`widget-size-controls-${widget.id}`}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
            gap: '2px',
            padding: '2px 4px',
            backgroundColor: FUI_TOKENS.bgCarbon,
            borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            lineHeight: 1.1,
            borderRadius: '0px',
          }}
        >
          {/* Width & Height Span Steppers + Selects */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid={`resize-widget-w-dec-${widget.id}`}
              aria-label="Decrease width span"
              onClick={() =>
                onResizeWidget?.(
                  widget,
                  clampCardRect({
                    x: effectiveX,
                    y: effectiveY,
                    w: Math.max(1, effectiveW - 1),
                    h: effectiveH,
                  }),
                )
              }
              style={{
                padding: '1px 4px',
                fontSize: '12px',
                lineHeight: 1.1,
                fontFamily: FUI_TOKENS.fontMono,
                backgroundColor: FUI_TOKENS.bgPanel,
                color: FUI_TOKENS.inkStark,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                cursor: 'pointer',
                borderRadius: '0px',
              }}
            >
              -W
            </button>
            <select
              data-testid={`widget-select-w-${widget.id}`}
              aria-label="Column span"
              value={String(effectiveW)}
              onChange={(e) =>
                onResizeWidget?.(
                  widget,
                  clampCardRect({
                    x: effectiveX,
                    y: effectiveY,
                    w: Number.parseInt(e.target.value, 10) || effectiveW,
                    h: effectiveH,
                  }),
                )
              }
              style={{
                padding: '1px 3px',
                fontSize: '12px',
                lineHeight: 1.1,
                fontFamily: FUI_TOKENS.fontMono,
                backgroundColor: FUI_TOKENS.bgPanel,
                color: FUI_TOKENS.inkStark,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderRadius: '0px',
              }}
            >
              {Array.from({ length: 12 }, (_, idx) => idx + 1).map((colSpan) => (
                <option key={colSpan} value={String(colSpan)}>
                  W:{colSpan}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid={`resize-widget-w-inc-${widget.id}`}
              aria-label="Increase width span"
              onClick={() =>
                onResizeWidget?.(
                  widget,
                  clampCardRect({
                    x: effectiveX,
                    y: effectiveY,
                    w: Math.min(12, effectiveW + 1),
                    h: effectiveH,
                  }),
                )
              }
              style={{
                padding: '1px 4px',
                fontSize: '12px',
                lineHeight: 1.1,
                fontFamily: FUI_TOKENS.fontMono,
                backgroundColor: FUI_TOKENS.bgPanel,
                color: FUI_TOKENS.inkStark,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                cursor: 'pointer',
                borderRadius: '0px',
              }}
            >
              +W
            </button>

            <button
              type="button"
              data-testid={`resize-widget-h-dec-${widget.id}`}
              aria-label="Decrease height span"
              onClick={() =>
                onResizeWidget?.(
                  widget,
                  clampCardRect({
                    x: effectiveX,
                    y: effectiveY,
                    w: effectiveW,
                    h: Math.max(1, effectiveH - 1),
                  }),
                )
              }
              style={{
                padding: '1px 4px',
                fontSize: '12px',
                lineHeight: 1.1,
                fontFamily: FUI_TOKENS.fontMono,
                backgroundColor: FUI_TOKENS.bgPanel,
                color: FUI_TOKENS.inkStark,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                cursor: 'pointer',
                borderRadius: '0px',
              }}
            >
              -H
            </button>
            <select
              data-testid={`widget-select-h-${widget.id}`}
              aria-label="Row span"
              value={String(effectiveH)}
              onChange={(e) =>
                onResizeWidget?.(
                  widget,
                  clampCardRect({
                    x: effectiveX,
                    y: effectiveY,
                    w: effectiveW,
                    h: Number.parseInt(e.target.value, 10) || effectiveH,
                  }),
                )
              }
              style={{
                padding: '1px 3px',
                fontSize: '12px',
                lineHeight: 1.1,
                fontFamily: FUI_TOKENS.fontMono,
                backgroundColor: FUI_TOKENS.bgPanel,
                color: FUI_TOKENS.inkStark,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderRadius: '0px',
              }}
            >
              {Array.from({ length: 8 }, (_, idx) => idx + 1).map((rowSpan) => (
                <option key={rowSpan} value={String(rowSpan)}>
                  H:{rowSpan}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid={`resize-widget-h-inc-${widget.id}`}
              aria-label="Increase height span"
              onClick={() =>
                onResizeWidget?.(
                  widget,
                  clampCardRect({
                    x: effectiveX,
                    y: effectiveY,
                    w: effectiveW,
                    h: Math.min(8, effectiveH + 1),
                  }),
                )
              }
              style={{
                padding: '1px 4px',
                fontSize: '12px',
                lineHeight: 1.1,
                fontFamily: FUI_TOKENS.fontMono,
                backgroundColor: FUI_TOKENS.bgPanel,
                color: FUI_TOKENS.inkStark,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                cursor: 'pointer',
                borderRadius: '0px',
              }}
            >
              +H
            </button>
          </div>

          {/* Quick Preset Span Chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexWrap: 'wrap' }}>
            {presetSpans.map(([pw, ph]) => {
              const isCurrent = effectiveW === pw && effectiveH === ph;
              return (
                <button
                  key={`${pw}x${ph}`}
                  type="button"
                  data-testid={`widget-preset-${pw}x${ph}-${widget.id}`}
                  onClick={() =>
                    onResizeWidget?.(
                      widget,
                      clampCardRect({
                        x: effectiveX,
                        y: effectiveY,
                        w: pw,
                        h: ph,
                      }),
                    )
                  }
                  style={{
                    padding: '1px 4px',
                    fontSize: '12px',
                    lineHeight: 1.1,
                    fontFamily: FUI_TOKENS.fontMono,
                    backgroundColor: isCurrent ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgPanel,
                    color: isCurrent ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                    border: `1px solid ${
                      isCurrent ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                    }`,
                    cursor: 'pointer',
                    borderRadius: '0px',
                  }}
                >
                  {pw}×{ph}
                </button>
              );
            })}
          </div>

          {/* Accessible Directional Move Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            <button
              type="button"
              data-testid={`move-widget-left-${widget.id}`}
              aria-label="Move widget left"
              onClick={() =>
                onResizeWidget?.(
                  widget,
                  clampCardRect({
                    x: Math.max(0, effectiveX - 1),
                    y: effectiveY,
                    w: effectiveW,
                    h: effectiveH,
                  }),
                )
              }
              style={{
                padding: '1px 4px',
                fontSize: '12px',
                lineHeight: 1.1,
                fontFamily: FUI_TOKENS.fontMono,
                backgroundColor: FUI_TOKENS.bgPanel,
                color: FUI_TOKENS.inkStark,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                cursor: 'pointer',
                borderRadius: '0px',
              }}
            >
              ←
            </button>
            <button
              type="button"
              data-testid={`move-widget-up-${widget.id}`}
              aria-label="Move widget up"
              onClick={() =>
                onResizeWidget?.(
                  widget,
                  clampCardRect({
                    x: effectiveX,
                    y: Math.max(0, effectiveY - 1),
                    w: effectiveW,
                    h: effectiveH,
                  }),
                )
              }
              style={{
                padding: '1px 4px',
                fontSize: '12px',
                lineHeight: 1.1,
                fontFamily: FUI_TOKENS.fontMono,
                backgroundColor: FUI_TOKENS.bgPanel,
                color: FUI_TOKENS.inkStark,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                cursor: 'pointer',
                borderRadius: '0px',
              }}
            >
              ↑
            </button>
            <button
              type="button"
              data-testid={`move-widget-down-${widget.id}`}
              aria-label="Move widget down"
              onClick={() =>
                onResizeWidget?.(
                  widget,
                  clampCardRect({
                    x: effectiveX,
                    y: Math.min(8 - effectiveH, effectiveY + 1),
                    w: effectiveW,
                    h: effectiveH,
                  }),
                )
              }
              style={{
                padding: '1px 4px',
                fontSize: '12px',
                lineHeight: 1.1,
                fontFamily: FUI_TOKENS.fontMono,
                backgroundColor: FUI_TOKENS.bgPanel,
                color: FUI_TOKENS.inkStark,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                cursor: 'pointer',
                borderRadius: '0px',
              }}
            >
              ↓
            </button>
            <button
              type="button"
              data-testid={`move-widget-right-${widget.id}`}
              aria-label="Move widget right"
              onClick={() =>
                onResizeWidget?.(
                  widget,
                  clampCardRect({
                    x: Math.min(12 - effectiveW, effectiveX + 1),
                    y: effectiveY,
                    w: effectiveW,
                    h: effectiveH,
                  }),
                )
              }
              style={{
                padding: '1px 4px',
                fontSize: '12px',
                lineHeight: 1.1,
                fontFamily: FUI_TOKENS.fontMono,
                backgroundColor: FUI_TOKENS.bgPanel,
                color: FUI_TOKENS.inkStark,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                cursor: 'pointer',
                borderRadius: '0px',
              }}
            >
              →
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: isEditMode && !kioskMode ? '4px 6px' : '6px 8px',
          overflow: 'hidden',
          borderRadius: '0px',
        }}
      >
        {widget.source_kind === 'builtin' ? renderBuiltinBody() : renderCustomBody()}
      </div>

      {/* Android Home Screen Widget Resize Handles in Edit Mode */}
      {isEditMode && !kioskMode && (
        <>
          <button
            type="button"
            data-testid={`resize-handle-e-${widget.id}`}
            aria-label={`Resize ${widget.title} width`}
            onPointerDown={(e) => {
              e.stopPropagation();
              startResizeDrag('e', e.clientX, e.clientY);
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startResizeDrag('e', e.clientX, e.clientY);
            }}
            style={{
              position: 'absolute',
              top: '50%',
              right: '0px',
              transform: 'translateY(-50%)',
              padding: '4px 3px',
              fontSize: '12px',
              fontFamily: FUI_TOKENS.fontMono,
              backgroundColor: FUI_TOKENS.accentOrange,
              color: FUI_TOKENS.bgCarbon,
              border: 'none',
              cursor: 'ew-resize',
              borderRadius: '0px',
              zIndex: 5,
            }}
          >
            ⋮
          </button>
          <button
            type="button"
            data-testid={`resize-handle-s-${widget.id}`}
            aria-label={`Resize ${widget.title} height`}
            onPointerDown={(e) => {
              e.stopPropagation();
              startResizeDrag('s', e.clientX, e.clientY);
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startResizeDrag('s', e.clientX, e.clientY);
            }}
            style={{
              position: 'absolute',
              bottom: '0px',
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '1px 8px',
              fontSize: '12px',
              fontFamily: FUI_TOKENS.fontMono,
              backgroundColor: FUI_TOKENS.accentOrange,
              color: FUI_TOKENS.bgCarbon,
              border: 'none',
              cursor: 'ns-resize',
              borderRadius: '0px',
              zIndex: 5,
            }}
          >
            ⋯
          </button>
          <button
            type="button"
            data-testid={`resize-handle-${widget.id}`}
            aria-label={`Resize ${widget.title} span`}
            onPointerDown={(e) => {
              e.stopPropagation();
              startResizeDrag('se', e.clientX, e.clientY);
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startResizeDrag('se', e.clientX, e.clientY);
            }}
            style={{
              position: 'absolute',
              bottom: '0px',
              right: '0px',
              padding: '2px 5px',
              fontSize: '12px',
              fontFamily: FUI_TOKENS.fontMono,
              backgroundColor: FUI_TOKENS.accentOrange,
              color: FUI_TOKENS.bgCarbon,
              border: 'none',
              cursor: 'nwse-resize',
              borderRadius: '0px',
              zIndex: 6,
            }}
          >
            ◢
          </button>
        </>
      )}
    </article>
  );
}
