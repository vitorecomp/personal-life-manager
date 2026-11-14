import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FuiBadge,
  FuiButton,
  FuiInput,
  FuiPanelHeader,
  FUI_TOKENS,
  ModularHudLoader,
  PrivacyMaskToggle,
  PrivacyValue,
  WaffleGrid10x20,
  type WaffleSliceInput,
} from '@hermes/ui';
import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  formatBrlCents,
  formatFireDuration,
  formatUsdCents,
  unwrapList,
  type AgentRecord,
  type AllocationRecord,
  type CourseRecord,
  type DashboardDeckRecord,
  type DashboardWidgetRecord,
  type FireProjectionRecord,
  type GoalRecord,
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
import { useAppStore } from '../../store/appStore';
import { WidgetRenderer, type LiveMonitorTelemetry } from './WidgetRenderer';

export interface RoomMonitorViewProps {
  kioskMode?: boolean;
  initialSlug?: string;
  onNavigate: (to: string) => void;
}

const FALLBACK_STARTER_DECKS: DashboardDeckRecord[] = [
  {
    id: 'deck-01-tactical-ops',
    slug: 'tactical-ops',
    title: 'DECK_01 // TACTICAL_OPS',
    cycle_seconds: 60,
    in_rotation: true,
    sort_order: 1,
    layout_cols: 12,
    layout_rows: 8,
    widgets: [
      {
        id: 'w-life-score',
        dashboard_id: 'deck-01-tactical-ops',
        title: 'LIFE_TELEMETRY_INDEX',
        source_kind: 'builtin',
        renderer_kind: 'custom_module',
        grid_rect: { x: 0, y: 0, w: 4, h: 4 },
        source_config: { builtin_key: 'life_score' },
      },
      {
        id: 'w-focus-barcode',
        dashboard_id: 'deck-01-tactical-ops',
        title: '24H_FOCUS_BARCODE',
        source_kind: 'builtin',
        renderer_kind: 'bar',
        grid_rect: { x: 4, y: 0, w: 4, h: 4 },
        source_config: { builtin_key: 'focus_barcode' },
      },
      {
        id: 'w-routines-bio',
        dashboard_id: 'deck-01-tactical-ops',
        title: 'ROUTINES_&_BIO_CONSISTENCY',
        source_kind: 'builtin',
        renderer_kind: 'sparkline',
        grid_rect: { x: 8, y: 0, w: 4, h: 4 },
        source_config: { builtin_key: 'routines_bio' },
      },
    ],
  },
  {
    id: 'deck-02-wealth-fire',
    slug: 'wealth-fire',
    title: 'DECK_02 // WEALTH_&_FIRE',
    cycle_seconds: 60,
    in_rotation: true,
    sort_order: 2,
    layout_cols: 12,
    layout_rows: 8,
    widgets: [
      {
        id: 'w-portfolio-waffle',
        dashboard_id: 'deck-02-wealth-fire',
        title: 'PORTFOLIO_WAFFLE_&_TICKER',
        source_kind: 'builtin',
        renderer_kind: 'waffle',
        grid_rect: { x: 0, y: 0, w: 6, h: 5 },
        source_config: { builtin_key: 'portfolio_waffle' },
      },
      {
        id: 'w-fire-gauge',
        dashboard_id: 'deck-02-wealth-fire',
        title: 'RETIREMENT_FIRE_GAUGE',
        source_kind: 'builtin',
        renderer_kind: 'kpi',
        grid_rect: { x: 6, y: 0, w: 6, h: 5 },
        source_config: { builtin_key: 'fire_gauge' },
      },
    ],
  },
  {
    id: 'deck-03-strategy-lore',
    slug: 'strategy-lore',
    title: 'DECK_03 // STRATEGY_&_LORE',
    cycle_seconds: 60,
    in_rotation: true,
    sort_order: 3,
    layout_cols: 12,
    layout_rows: 8,
    widgets: [
      {
        id: 'w-goals-blueprint',
        dashboard_id: 'deck-03-strategy-lore',
        title: 'YEARLY_GOAL_BLUEPRINT',
        source_kind: 'builtin',
        renderer_kind: 'custom_module',
        grid_rect: { x: 0, y: 0, w: 6, h: 4 },
        source_config: { builtin_key: 'goals_blueprint' },
      },
      {
        id: 'w-constellation',
        dashboard_id: 'deck-03-strategy-lore',
        title: 'SECOND_BRAIN_CONSTELLATION',
        source_kind: 'builtin',
        renderer_kind: 'custom_module',
        grid_rect: { x: 6, y: 0, w: 6, h: 4 },
        source_config: { builtin_key: 'second_brain_constellation' },
      },
    ],
  },
  {
    id: 'deck-04-infra-knights',
    slug: 'infra-knights',
    title: 'DECK_04 // INFRA_&_KNIGHTS',
    cycle_seconds: 60,
    in_rotation: true,
    sort_order: 4,
    layout_cols: 12,
    layout_rows: 8,
    widgets: [
      {
        id: 'w-server-prober',
        dashboard_id: 'deck-04-infra-knights',
        title: 'SERVER_INFRASTRUCTURE_PROBER',
        source_kind: 'builtin',
        renderer_kind: 'table',
        grid_rect: { x: 0, y: 0, w: 6, h: 5 },
        source_config: { builtin_key: 'server_prober' },
      },
      {
        id: 'w-knights-pulse',
        dashboard_id: 'deck-04-infra-knights',
        title: 'KNIGHT_ORDER_&_HERMES_PULSE',
        source_kind: 'builtin',
        renderer_kind: 'custom_module',
        grid_rect: { x: 6, y: 0, w: 6, h: 5 },
        source_config: { builtin_key: 'knights_pulse' },
      },
    ],
  },
];

const FALLBACK_STARTER_WIDGET_IDS = new Set([
  'w-life-score',
  'w-focus-barcode',
  'w-routines-bio',
  'w-portfolio-waffle',
  'w-fire-gauge',
  'w-goals-blueprint',
  'w-constellation',
  'w-server-prober',
  'w-knights-pulse',
]);

export function RoomMonitorView({
  kioskMode = false,
  initialSlug,
  onNavigate,
}: RoomMonitorViewProps) {
  const queryClient = useQueryClient();
  const setActiveDashboardId = useAppStore((s) => s.setActiveDashboardId);
  const quickCaptureOpen = useAppStore((s) => s.quickCaptureOpen);
  const authModalOpen = useAppStore((s) => s.authModalOpen);
  const companionOpen = useAppStore((s) => s.companionOpen);

  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(initialSlug ?? null);
  const [cycleState, setCycleState] = useState<{ rotationIndex: number; elapsedMs: number }>({
    rotationIndex: 0,
    elapsedMs: 0,
  });
  const [isPaused, setIsPaused] = useState(false);

  const autoRefreshedIdsRef = useRef<Set<string>>(new Set());
  const [widgetRefreshErrors, setWidgetRefreshErrors] = useState<Record<string, string>>({});

  // Modals / forms on /dashboard
  const [showCreateDeck, setShowCreateDeck] = useState(false);
  const [newDeckTitle, setNewDeckTitle] = useState('');
  const [newDeckCycleSec, setNewDeckCycleSec] = useState('60');
  const [deckError, setDeckError] = useState<string | null>(null);

  const [showEditDeck, setShowEditDeck] = useState(false);
  const [editDeckTitle, setEditDeckTitle] = useState('');
  const [editDeckCycleSec, setEditDeckCycleSec] = useState('60');
  const [editDeckError, setEditDeckError] = useState<string | null>(null);

  const [showAddWidget, setShowAddWidget] = useState(false);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const [widgetTitle, setWidgetTitle] = useState('');
  const [widgetSourceKind, setWidgetSourceKind] = useState<
    'builtin' | 'sql' | 'http' | 'command' | 'hermes'
  >('sql');
  const [widgetRendererKind, setWidgetRendererKind] = useState<
    'kpi' | 'sparkline' | 'waffle' | 'bar' | 'table' | 'terminal' | 'custom_module'
  >('table');
  const [widgetQueryOrConfig, setWidgetQueryOrConfig] = useState(
    'SELECT slug, title, cycle_seconds FROM dashboards ORDER BY sort_order ASC',
  );
  const [widgetGridX, setWidgetGridX] = useState('0');
  const [widgetGridY, setWidgetGridY] = useState('0');
  const [widgetGridW, setWidgetGridW] = useState('4');
  const [widgetGridH, setWidgetGridH] = useState('3');
  const [widgetError, setWidgetError] = useState<string | null>(null);

  const { data: rawDecks = [] } = useQuery({
    queryKey: ['dashboards'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/dashboards');
        const list = unwrapList<DashboardDeckRecord>(res, ['dashboards']).filter(
          (d): d is DashboardDeckRecord => Boolean(d && typeof d === 'object'),
        );
        return list;
      } catch {
        return [];
      }
    },
  });

  const decks = useMemo(() => {
    const clean = rawDecks.filter((d): d is DashboardDeckRecord =>
      Boolean(d && typeof d === 'object'),
    );
    return clean.length > 0 ? clean : FALLBACK_STARTER_DECKS;
  }, [rawDecks]);

  const rotationDecks = useMemo(() => {
    const active = decks.filter((d) => d.in_rotation !== false);
    return active.length > 0 ? active : decks.slice(0, 1);
  }, [decks]);

  const noDecksInRotation = useMemo(
    () => decks.length > 0 && decks.every((d) => d.in_rotation === false),
    [decks],
  );

  const activeDeck: DashboardDeckRecord = useMemo(() => {
    if (kioskMode) {
      const safeIdx =
        rotationDecks.length > 0
          ? ((cycleState.rotationIndex % rotationDecks.length) + rotationDecks.length) %
            rotationDecks.length
          : 0;
      return rotationDecks[safeIdx] ?? decks[0] ?? FALLBACK_STARTER_DECKS[0]!;
    }
    if (selectedDeckId) {
      const found = decks.find(
        (d) => d.id === selectedDeckId || d.slug === selectedDeckId,
      );
      if (found) return found;
    }
    return decks[0] ?? FALLBACK_STARTER_DECKS[0]!;
  }, [kioskMode, rotationDecks, cycleState.rotationIndex, selectedDeckId, decks]);

  useEffect(() => {
    if (activeDeck?.id) {
      setActiveDashboardId(activeDeck.id);
    }
  }, [activeDeck?.id, setActiveDashboardId]);

  const { data: activeDeckDetail } = useQuery({
    queryKey: ['dashboards', activeDeck?.id],
    queryFn: async () => {
      if (!activeDeck?.id) return null;
      try {
        const res = await apiGet<any>(`/api/dashboards/${encodeURIComponent(activeDeck.id)}`);
        if (Array.isArray(res)) {
          const matched = res.find(
            (d: any) => d && (d.id === activeDeck.id || d.slug === activeDeck.id),
          );
          return (matched ?? null) as DashboardDeckRecord | null;
        }
        return (res?.dashboard ?? res?.data ?? res) as DashboardDeckRecord | null;
      } catch {
        return null;
      }
    },
    enabled: Boolean(activeDeck?.id),
  });

  const { data: lifeScore } = useQuery({
    queryKey: ['life-score'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/telemetry/life-score');
        return (res?.data ?? res) as LifeScoreResponse;
      } catch {
        return {
          composite_score: 0,
          pillars: { focus: 0, routines: 0, goals: 0, learning: 0, wealth: 0 },
        } satisfies LifeScoreResponse;
      }
    },
  });

  const { data: servers = [] } = useQuery({
    queryKey: ['servers'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/servers');
        return unwrapList<ServerNodeRecord>(res, ['servers']).filter(
          (s): s is ServerNodeRecord => Boolean(s && typeof s === 'object'),
        );
      } catch {
        return [];
      }
    },
  });

  const { data: serverSummary } = useQuery({
    queryKey: ['servers-summary'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/servers/summary');
        return (res?.data ?? res) as ServerSummaryResponse;
      } catch {
        return null;
      }
    },
  });

  const { data: pendingApprovals = [] } = useQuery({
    queryKey: ['mcp-approvals'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/mcp/approvals');
        return unwrapList<PendingApprovalRecord>(res, ['approvals']).filter(
          (a): a is PendingApprovalRecord => Boolean(a && typeof a === 'object'),
        );
      } catch {
        return [];
      }
    },
  });

  // Live Cross-Domain Room Monitor Telemetry Queries
  const { data: timeStats } = useQuery({
    queryKey: ['time-stats'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/time/stats');
        return (res?.data ?? res) as TimeStatsRecord | null;
      } catch {
        return null;
      }
    },
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/tasks');
        return unwrapList<TaskRecord>(res, ['tasks']).filter((t): t is TaskRecord =>
          Boolean(t && typeof t === 'object'),
        );
      } catch {
        return [];
      }
    },
  });

  const { data: routineAnalytics } = useQuery({
    queryKey: ['routines-analytics'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/routines/analytics');
        return (res?.data ?? res) as RoutineAnalyticsRecord | null;
      } catch {
        return null;
      }
    },
  });

  const { data: routines = [] } = useQuery({
    queryKey: ['routines'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/routines');
        return unwrapList<any>(res, ['routines']).filter((r) => Boolean(r && typeof r === 'object'));
      } catch {
        return [];
      }
    },
  });

  const { data: allocation } = useQuery({
    queryKey: ['finance-allocation'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/finance/allocation');
        return (res?.data ?? res) as AllocationRecord | null;
      } catch {
        return null;
      }
    },
  });

  const { data: retirement } = useQuery({
    queryKey: ['finance-retirement'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/finance/retirement');
        return (res?.data ?? res) as FireProjectionRecord | null;
      } catch {
        return null;
      }
    },
  });

  const { data: monthlyPlans = [] } = useQuery({
    queryKey: ['finance-monthly-plans'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/finance/monthly-plans');
        return unwrapList<MonthlyPlanRecord>(res, ['plans', 'monthly_plans']).filter(
          (p): p is MonthlyPlanRecord => Boolean(p && typeof p === 'object'),
        );
      } catch {
        return [];
      }
    },
  });

  const { data: goals = [] } = useQuery({
    queryKey: ['goals'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/goals');
        return unwrapList<GoalRecord>(res, ['goals']).filter((g): g is GoalRecord =>
          Boolean(g && typeof g === 'object'),
        );
      } catch {
        return [];
      }
    },
  });

  const { data: courses = [] } = useQuery({
    queryKey: ['courses'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/courses');
        return unwrapList<CourseRecord>(res, ['courses']).filter((c): c is CourseRecord =>
          Boolean(c && typeof c === 'object'),
        );
      } catch {
        return [];
      }
    },
  });

  const { data: dueReviews = [] } = useQuery({
    queryKey: ['courses-spaced-reviews-due'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/courses/spaced-reviews/due');
        return unwrapList<any>(res, ['due_reviews', 'reviews', 'lessons']).filter(Boolean);
      } catch {
        return [];
      }
    },
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/agents');
        return unwrapList<AgentRecord>(res, ['agents']).filter((a): a is AgentRecord =>
          Boolean(a && typeof a === 'object'),
        );
      } catch {
        return [];
      }
    },
  });

  const { data: vaultNotes = [] } = useQuery({
    queryKey: ['vault-notes'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/vault/notes');
        return unwrapList<VaultNoteRecord>(res, ['notes']).filter(
          (n): n is VaultNoteRecord => Boolean(n && typeof n === 'object'),
        );
      } catch {
        return [];
      }
    },
  });

  const liveTelemetry: LiveMonitorTelemetry = useMemo(
    () => ({
      timeStats,
      tasks,
      routineAnalytics,
      routines,
      allocation,
      retirement,
      monthlyPlans,
      goals,
      courses,
      dueReviews,
      agents,
      vaultNotes,
    }),
    [
      timeStats,
      tasks,
      routineAnalytics,
      routines,
      allocation,
      retirement,
      monthlyPlans,
      goals,
      courses,
      dueReviews,
      agents,
      vaultNotes,
    ],
  );

  // Pure <StrictMode>-safe auto-cycle timer on /monitor with NaN cycle_seconds guard
  const rawCycleSeconds = Number(activeDeck?.cycle_seconds);
  const cycleDurationMs =
    Math.max(5, Number.isFinite(rawCycleSeconds) && rawCycleSeconds > 0 ? rawCycleSeconds : 60) *
    1000;

  useEffect(() => {
    if (!kioskMode || isPaused || rotationDecks.length <= 1) {
      return undefined;
    }
    const stepMs = 200;
    const timer = window.setInterval(() => {
      setCycleState((prev) => {
        const nextElapsed = prev.elapsedMs + stepMs;
        if (nextElapsed >= cycleDurationMs) {
          return {
            rotationIndex:
              rotationDecks.length > 0
                ? (prev.rotationIndex + 1) % rotationDecks.length
                : 0,
            elapsedMs: 0,
          };
        }
        return {
          rotationIndex: prev.rotationIndex,
          elapsedMs: nextElapsed,
        };
      });
    }, stepMs);

    return () => window.clearInterval(timer);
  }, [kioskMode, isPaused, rotationDecks.length, cycleDurationMs]);

  // Keyboard navigation on /monitor (Space, ArrowRight, ArrowLeft, F, Escape) & /dashboard (F, Modal Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (quickCaptureOpen || authModalOpen || companionOpen) return;

      if (!kioskMode && showAddWidget && e.key === 'Escape') {
        e.preventDefault();
        setShowAddWidget(false);
        setEditingWidgetId(null);
        setWidgetError(null);
        return;
      }

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (kioskMode) {
        if (e.code === 'Space' || e.key === ' ') {
          e.preventDefault();
          setIsPaused((prev) => !prev);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          setCycleState((prev) => ({
            rotationIndex:
              rotationDecks.length > 0
                ? (prev.rotationIndex + 1) % rotationDecks.length
                : 0,
            elapsedMs: 0,
          }));
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setCycleState((prev) => ({
            rotationIndex:
              rotationDecks.length > 0
                ? (prev.rotationIndex - 1 + rotationDecks.length) % rotationDecks.length
                : 0,
            elapsedMs: 0,
          }));
        } else if (e.key === 'f' || e.key === 'F' || e.key === 'Escape') {
          e.preventDefault();
          onNavigate('/dashboard');
        }
      } else if (!showAddWidget && !showCreateDeck && !showEditDeck) {
        if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          onNavigate('/monitor');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    kioskMode,
    rotationDecks.length,
    onNavigate,
    showAddWidget,
    showCreateDeck,
    showEditDeck,
    quickCaptureOpen,
    authModalOpen,
    companionOpen,
  ]);

  const createDeckMutation = useMutation({
    mutationFn: async (e: React.FormEvent) => {
      e.preventDefault();
      const title = newDeckTitle.trim();
      const cycle = Number.parseInt(newDeckCycleSec, 10);
      if (!title) {
        throw new Error('Deck title is required');
      }
      if (!Number.isFinite(cycle) || cycle < 5 || cycle > 86400) {
        throw new Error('Cycle seconds must be between 5 and 86400');
      }
      return apiPost<DashboardDeckRecord>('/api/dashboards', {
        title,
        cycle_seconds: cycle,
        in_rotation: true,
        layout_cols: 12,
        layout_rows: 8,
      });
    },
    onSuccess: (created) => {
      const d = (created as any)?.data ?? created;
      if (d?.id) setSelectedDeckId(d.id);
      setNewDeckTitle('');
      setShowCreateDeck(false);
      setDeckError(null);
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
    onError: (err: any) => {
      setDeckError(String(err?.message || 'Failed to create deck'));
    },
  });

  const cloneDeckMutation = useMutation({
    mutationFn: async () =>
      apiPost<DashboardDeckRecord>(
        `/api/dashboards/${encodeURIComponent(activeDeck.id)}/clone`,
        {
          title: `${activeDeck.title}_CLONE`,
        },
      ),
    onSuccess: (cloned) => {
      const d = (cloned as any)?.data ?? cloned;
      if (d?.id) setSelectedDeckId(d.id);
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  const updateDeckMutation = useMutation({
    mutationFn: async (e: React.FormEvent) => {
      e.preventDefault();
      const title = editDeckTitle.trim();
      const cycle = Number.parseInt(editDeckCycleSec, 10);
      if (!title) {
        throw new Error('Deck title is required');
      }
      if (!Number.isFinite(cycle) || cycle < 5 || cycle > 86400) {
        throw new Error('Cycle seconds must be between 5 and 86400');
      }
      return apiPut(`/api/dashboards/${encodeURIComponent(activeDeck.id)}`, {
        title,
        cycle_seconds: cycle,
      });
    },
    onSuccess: () => {
      setShowEditDeck(false);
      setEditDeckError(null);
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
    onError: (err: any) => {
      setEditDeckError(String(err?.message || 'Failed to update deck'));
    },
  });

  const reorderDecksMutation = useMutation({
    mutationFn: async (direction: -1 | 1) => {
      const currentIdx = decks.findIndex((d) => d.id === activeDeck.id);
      if (currentIdx < 0) return null;
      const targetIdx = currentIdx + direction;
      if (targetIdx < 0 || targetIdx >= decks.length) return null;
      const nextDecks = [...decks];
      const [moved] = nextDecks.splice(currentIdx, 1);
      if (!moved) return null;
      nextDecks.splice(targetIdx, 0, moved);
      return apiPost('/api/dashboards/reorder', {
        dashboard_ids: nextDecks.map((d) => d.id),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  const resolveDashboardApprovalMutation = useMutation({
    mutationFn: async ({
      approvalId,
      action,
    }: {
      approvalId: string;
      action: 'approve' | 'reject';
    }) => apiPost(`/api/mcp/approvals/${encodeURIComponent(approvalId)}/${action}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  const toggleRotationMutation = useMutation({
    mutationFn: async () =>
      apiPut(`/api/dashboards/${encodeURIComponent(activeDeck.id)}`, {
        in_rotation: !activeDeck.in_rotation,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  const deleteDeckMutation = useMutation({
    mutationFn: async () => apiDelete(`/api/dashboards/${encodeURIComponent(activeDeck.id)}`),
    onSuccess: () => {
      setSelectedDeckId(null);
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  const saveWidgetMutation = useMutation({
    mutationFn: async (e: React.FormEvent) => {
      e.preventDefault();
      setWidgetError(null);
      const title = widgetTitle.trim() || `CUSTOM_${widgetSourceKind.toUpperCase()}_PANEL`;
      const gx = Number.parseInt(widgetGridX, 10);
      const gy = Number.parseInt(widgetGridY, 10);
      const gw = Number.parseInt(widgetGridW, 10);
      const gh = Number.parseInt(widgetGridH, 10);
      const grid_rect = {
        x: Number.isFinite(gx) ? Math.max(0, Math.min(11, gx)) : 0,
        y: Number.isFinite(gy) ? Math.max(0, Math.min(7, gy)) : 0,
        w: Number.isFinite(gw) ? Math.max(1, Math.min(12, gw)) : 4,
        h: Number.isFinite(gh) ? Math.max(1, Math.min(8, gh)) : 3,
      };
      if (grid_rect.x + grid_rect.w > 12) {
        grid_rect.x = Math.max(0, 12 - grid_rect.w);
      }
      if (grid_rect.y + grid_rect.h > 8) {
        grid_rect.y = Math.max(0, 8 - grid_rect.h);
      }

      const source_config =
        widgetSourceKind === 'sql'
          ? { query: widgetQueryOrConfig }
          : widgetSourceKind === 'http'
            ? { url: widgetQueryOrConfig }
            : widgetSourceKind === 'command'
              ? { command: widgetQueryOrConfig, timeout_ms: 5000 }
              : widgetSourceKind === 'hermes'
                ? { prompt: widgetQueryOrConfig }
                : { builtin_key: widgetQueryOrConfig || 'life_score' };

      if (editingWidgetId) {
        const updated = await apiPut<any>(
          `/api/dashboards/${encodeURIComponent(activeDeck.id)}/widgets/${encodeURIComponent(editingWidgetId)}`,
          {
            title,
            source_kind: widgetSourceKind,
            renderer_kind: widgetRendererKind,
            grid_rect,
            source_config,
          },
        );
        return updated;
      }

      const created = await apiPost<any>(
        `/api/dashboards/${encodeURIComponent(activeDeck.id)}/widgets`,
        {
          title,
          source_kind: widgetSourceKind,
          renderer_kind: widgetRendererKind,
          grid_rect,
          source_config,
          refresh_interval_seconds: 60,
        },
      );
      const wId = (created?.data ?? created)?.id;
      if (wId) {
        autoRefreshedIdsRef.current.add(String(wId));
        await apiPost(`/api/widgets/${encodeURIComponent(String(wId))}/refresh`, {}).catch(
          (err: any) => {
            setWidgetRefreshErrors((prev) => ({
              ...prev,
              [String(wId)]: String(err?.message || 'Widget refresh failed'),
            }));
          },
        );
      }
      return created;
    },
    onSuccess: () => {
      setWidgetTitle('');
      setEditingWidgetId(null);
      setShowAddWidget(false);
      setWidgetError(null);
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
    onError: (err: any) => {
      setWidgetError(
        `[REJECTED // READ-ONLY SQL GUARDRAIL] ${String(err?.message || 'Query rejected')}`,
      );
    },
  });

  const activeWidgets: DashboardWidgetRecord[] = useMemo(() => {
    const detailWidgets =
      activeDeckDetail && !Array.isArray(activeDeckDetail)
        ? activeDeckDetail.widgets
        : undefined;
    const fromDetail = unwrapList<DashboardWidgetRecord>(detailWidgets, ['widgets']).filter(
      (w): w is DashboardWidgetRecord => Boolean(w && typeof w === 'object'),
    );
    if (fromDetail.length > 0) return fromDetail;
    const fromList = unwrapList<DashboardWidgetRecord>(activeDeck?.widgets, ['widgets']).filter(
      (w): w is DashboardWidgetRecord => Boolean(w && typeof w === 'object'),
    );
    return fromList;
  }, [activeDeckDetail, activeDeck]);

  // Auto-refresh unpopulated seeded/backend widgets at most once per widget ID
  useEffect(() => {
    if (rawDecks.length === 0) return;
    for (const w of activeWidgets) {
      if (!w?.id || FALLBACK_STARTER_WIDGET_IDS.has(w.id)) continue;
      if (autoRefreshedIdsRef.current.has(w.id)) continue;
      if (w.last_refreshed_at != null) continue;
      const cp = w.cached_payload;
      const isEmptyPayload =
        cp == null ||
        (typeof cp === 'object' && !Array.isArray(cp) && Object.keys(cp).length === 0);
      if (!isEmptyPayload) continue;
      if (w.source_kind === 'command' && w.source_config?.approved === false) continue;

      autoRefreshedIdsRef.current.add(w.id);
      apiPost(`/api/widgets/${encodeURIComponent(w.id)}/refresh`, {})
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['dashboards'] });
        })
        .catch((err: any) => {
          setWidgetRefreshErrors((prev) => ({
            ...prev,
            [w.id]: String(err?.message || 'Widget refresh failed'),
          }));
        });
    }
  }, [activeWidgets, rawDecks.length, queryClient]);

  // Compute non-overlapping 12x8 grid placements (falling back to auto-flow span when sibling cells collide)
  const resolvedPlacements = useMemo(() => {
    const placements = new Map<string, { gridColumn: string; gridRow: string }>();
    const occupied: boolean[][] = Array.from({ length: 8 }, () =>
      Array.from({ length: 12 }, () => false),
    );

    for (const w of activeWidgets) {
      const rect = w.grid_rect ?? {
        x: w.grid_x ?? 0,
        y: w.grid_y ?? 0,
        w: w.grid_w ?? 4,
        h: w.grid_h ?? 4,
      };
      const spanW = Math.min(12, Math.max(1, Number(rect.w) || 4));
      const spanH = Math.min(8, Math.max(1, Number(rect.h) || 3));
      const rx = Number(rect.x);
      const ry = Number(rect.y);

      const inBounds =
        Number.isInteger(rx) &&
        Number.isInteger(ry) &&
        rx >= 0 &&
        ry >= 0 &&
        rx + spanW <= 12 &&
        ry + spanH <= 8;

      let canPlaceExplicit = inBounds;
      if (canPlaceExplicit) {
        for (let r = ry; r < ry + spanH && canPlaceExplicit; r++) {
          for (let c = rx; c < rx + spanW; c++) {
            if (occupied[r]?.[c]) {
              canPlaceExplicit = false;
              break;
            }
          }
        }
      }

      if (canPlaceExplicit) {
        for (let r = ry; r < ry + spanH; r++) {
          for (let c = rx; c < rx + spanW; c++) {
            if (occupied[r]) occupied[r]![c] = true;
          }
        }
        placements.set(w.id, {
          gridColumn: `${rx + 1} / span ${spanW}`,
          gridRow: `${ry + 1} / span ${spanH}`,
        });
      } else {
        placements.set(w.id, {
          gridColumn: `span ${spanW}`,
          gridRow: `span ${spanH}`,
        });
      }
    }
    return placements;
  }, [activeWidgets]);

  // Pending Tier-3 MCP approvals targeting dashboards_* tools scoped to activeDeck
  const deckPendingApprovals = useMemo(() => {
    return pendingApprovals.filter((a) => {
      if (!a || String(a.status || '').toLowerCase() !== 'pending') return false;
      const tool = String(a.tool_name || '');
      if (!tool.startsWith('dashboards_') && !tool.includes('command_widget')) return false;

      const pj = a.payload_json && typeof a.payload_json === 'object' ? a.payload_json : {};
      const targetDashId = pj.dashboard_id ? String(pj.dashboard_id) : '';
      if (targetDashId) {
        const dashExistsInList = decks.some(
          (d) => String(d.id) === targetDashId || String(d.slug) === targetDashId,
        );
        if (
          dashExistsInList &&
          String(activeDeck.id) !== targetDashId &&
          String(activeDeck.slug) !== targetDashId
        ) {
          return false;
        }
      }

      // Skip if already rendered inline inside an unapproved widget card on this deck
      const alreadyRenderedInline = activeWidgets.some(
        (w) =>
          w.source_kind === 'command' &&
          ((pj.widget_id && String(pj.widget_id) === String(w.id)) ||
            (pj.title && String(pj.title) === String(w.title) && w.cached_payload?.stdout === undefined)),
      );
      return !alreadyRenderedInline;
    });
  }, [pendingApprovals, decks, activeDeck.id, activeDeck.slug, activeWidgets]);

  const isWealthDeck = /wealth|fire/i.test(`${activeDeck.slug} ${activeDeck.title}`);
  const isInfraDeck = /infra|server|knight/i.test(`${activeDeck.slug} ${activeDeck.title}`);

  const rawCountdownPct = 100 - Math.round((cycleState.elapsedMs / cycleDurationMs) * 100);
  const countdownPct = Number.isFinite(rawCountdownPct)
    ? Math.max(0, Math.min(100, rawCountdownPct))
    : 100;

  const wealthBrlCents = Number(
    allocation?.total_brl_cents ?? retirement?.current_net_worth_brl_cents ?? 0,
  );
  const wealthUsdCents = Number(allocation?.total_usd_cents ?? 0);
  const wealthFiPctRaw = Number(retirement?.fi_progress_pct ?? retirement?.progress_pct ?? 0);
  const wealthFiPct = Number.isFinite(wealthFiPctRaw) ? wealthFiPctRaw : 0;
  const wealthDurationLabel = formatFireDuration(retirement);
  const wealthWaffleSlices: WaffleSliceInput[] = useMemo(() => {
    if (
      allocation?.recommendations &&
      Array.isArray(allocation.recommendations) &&
      allocation.recommendations.length > 0
    ) {
      return allocation.recommendations.map((rec) => ({
        id: String(rec.asset_id || rec.symbol),
        label: String(rec.symbol),
        weightPct: Number(rec.current_weight_pct ?? 0),
        targetWeightPct: Number(rec.target_weight_pct ?? 0),
      }));
    }
    if (Array.isArray(allocation?.waffle_tiles) && allocation.waffle_tiles.length > 0) {
      const counts = new Map<string, number>();
      for (const tile of allocation.waffle_tiles) {
        if (!tile?.symbol) continue;
        counts.set(tile.symbol, (counts.get(tile.symbol) ?? 0) + 1);
      }
      const total = Math.max(1, allocation.waffle_tiles.length);
      return Array.from(counts.entries()).map(([symbol, count]) => ({
        id: symbol,
        label: symbol,
        weightPct: (count / total) * 100,
      }));
    }
    return [];
  }, [allocation]);

  const handleOpenEditWidget = (w: DashboardWidgetRecord) => {
    const r = w.grid_rect ?? {
      x: w.grid_x ?? 0,
      y: w.grid_y ?? 0,
      w: w.grid_w ?? 4,
      h: w.grid_h ?? 3,
    };
    setEditingWidgetId(w.id);
    setWidgetTitle(w.title || '');
    setWidgetSourceKind(w.source_kind || 'sql');
    setWidgetRendererKind(w.renderer_kind || 'table');
    const cfg = w.source_config ?? {};
    setWidgetQueryOrConfig(
      String(
        cfg.query ??
          cfg.url ??
          cfg.command ??
          cfg.prompt ??
          cfg.builtin_key ??
          '',
      ),
    );
    setWidgetGridX(String(r.x ?? 0));
    setWidgetGridY(String(r.y ?? 0));
    setWidgetGridW(String(r.w ?? 4));
    setWidgetGridH(String(r.h ?? 3));
    setWidgetError(null);
    setShowAddWidget(true);
  };

  return (
    <div
      data-testid={kioskMode ? 'room-monitor-kiosk' : 'room-monitor-dashboard'}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: FUI_TOKENS.bgCarbon,
        color: FUI_TOKENS.inkStark,
        borderRadius: '0px',
      }}
    >
      {/* Top 1px #F87C18 Countdown Hairline on /monitor */}
      {kioskMode && (
        <div
          data-testid="monitor-countdown-hairline"
          style={{
            height: '1px',
            width: `${countdownPct}%`,
            backgroundColor: FUI_TOKENS.accentOrange,
            borderRadius: '0px',
          }}
        />
      )}

      {/* Deck Control Strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          padding: '10px 16px',
          backgroundColor: FUI_TOKENS.bgPanel,
          borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
          borderRadius: '0px',
        }}
      >
        {kioskMode ? (
          /* Kiosk Header: Active Deck Title ONLY + numeric selectors + Pause/Pin badge */
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <FuiBadge tone="orange">ROOM MONITOR // KIOSK</FuiBadge>
            <strong
              data-testid="monitor-active-deck-title"
              style={{ fontSize: '15px', color: FUI_TOKENS.inkStark }}
            >
              {activeDeck.title}
            </strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {rotationDecks.map((d, idx) => {
                const isActive = d.id === activeDeck.id;
                const numCode = String(idx + 1).padStart(2, '0');
                return (
                  <button
                    key={d.id}
                    type="button"
                    data-testid={`monitor-jump-${idx}`}
                    aria-label={`Select deck ${numCode}`}
                    onClick={() => setCycleState({ rotationIndex: idx, elapsedMs: 0 })}
                    style={{
                      padding: '3px 7px',
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '12px',
                      fontWeight: isActive ? 700 : 500,
                      backgroundColor: isActive ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgCarbon,
                      color: isActive ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                      border: `1px solid ${
                        isActive ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                      }`,
                      cursor: 'pointer',
                      borderRadius: '0px',
                    }}
                  >
                    [{numCode}]
                  </button>
                );
              })}
            </div>
            {isPaused && (
              <span
                data-testid="monitor-paused-badge"
                style={{
                  padding: '2px 8px',
                  backgroundColor: FUI_TOKENS.accentAmber,
                  color: FUI_TOKENS.bgCarbon,
                  fontWeight: 700,
                  fontSize: '12px',
                  borderRadius: '0px',
                }}
              >
                [⏸ PAUSED // PINNED — HOLD]
              </span>
            )}
            {noDecksInRotation && (
              <FuiBadge tone="amber">NO DECKS IN ROTATION — STANDBY FALLBACK</FuiBadge>
            )}
          </div>
        ) : (
          /* Command Deck Switcher Tabs on /dashboard */
          <div
            role="tablist"
            aria-label="Dashboard Decks"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}
          >
            {decks.map((deck, idx) => {
              const isSelected = deck.id === activeDeck.id;
              const prefix = `DECK_0${idx + 1}`;
              const displayLabel = deck.title.toUpperCase().includes('DECK_')
                ? deck.title
                : `${prefix} // ${deck.title}`;
              return (
                <button
                  key={deck.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  data-deck-id={deck.id}
                  data-deck-slug={deck.slug}
                  data-testid={`deck-tab-${deck.slug}`}
                  onClick={() => setSelectedDeckId(deck.id)}
                  style={{
                    padding: '6px 12px',
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    fontWeight: isSelected ? 700 : 500,
                    backgroundColor: isSelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgCarbon,
                    color: isSelected ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                    border: `1px solid ${
                      isSelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                    }`,
                    cursor: 'pointer',
                    borderRadius: '0px',
                  }}
                >
                  {displayLabel}
                </button>
              );
            })}
          </div>
        )}

        {/* Right-Side Deck Controls & Telemetry Loader */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {!kioskMode && (
            <>
              <ModularHudLoader
                variant="proximity_scan"
                size={48}
                label="LIFE_IDX"
                value={`${Math.round(lifeScore?.composite_score ?? 0)}%`}
              />
              {decks.length > 1 && (
                <>
                  <FuiButton
                    size="sm"
                    variant="secondary"
                    data-testid="move-deck-left-btn"
                    onClick={() => reorderDecksMutation.mutate(-1)}
                  >
                    ◀ Move
                  </FuiButton>
                  <FuiButton
                    size="sm"
                    variant="secondary"
                    data-testid="move-deck-right-btn"
                    onClick={() => reorderDecksMutation.mutate(1)}
                  >
                    Move ▶
                  </FuiButton>
                </>
              )}
              <FuiButton
                size="sm"
                variant="secondary"
                data-testid="edit-deck-btn"
                onClick={() => {
                  setEditDeckTitle(activeDeck.title);
                  setEditDeckCycleSec(String(activeDeck.cycle_seconds ?? 60));
                  setEditDeckError(null);
                  setShowEditDeck(!showEditDeck);
                }}
              >
                Edit Deck
              </FuiButton>
              <FuiButton
                size="sm"
                variant="secondary"
                data-testid="create-deck-btn"
                onClick={() => setShowCreateDeck(!showCreateDeck)}
              >
                + New Deck
              </FuiButton>
              <FuiButton
                size="sm"
                variant="secondary"
                data-testid="clone-deck-btn"
                onClick={() => cloneDeckMutation.mutate()}
              >
                Clone Deck
              </FuiButton>
              <FuiButton
                size="sm"
                variant="secondary"
                data-testid="deck-rotation-toggle"
                onClick={() => toggleRotationMutation.mutate()}
              >
                Rotation: {activeDeck.in_rotation ? 'ON' : 'OFF'}
              </FuiButton>
              <FuiButton
                size="sm"
                variant="primary"
                data-testid="add-widget-btn"
                onClick={() => {
                  setEditingWidgetId(null);
                  setWidgetTitle('');
                  setWidgetGridX('0');
                  setWidgetGridY('0');
                  setWidgetGridW('4');
                  setWidgetGridH('3');
                  setWidgetError(null);
                  setShowAddWidget(true);
                }}
              >
                + Add Widget
              </FuiButton>
              {decks.length > 1 && (
                <FuiButton
                  size="sm"
                  variant="danger"
                  data-testid="delete-deck-btn"
                  onClick={() => deleteDeckMutation.mutate()}
                >
                  Delete Deck
                </FuiButton>
              )}
              <FuiButton
                size="sm"
                variant="cyan"
                data-testid="launch-monitor-btn"
                onClick={() => onNavigate('/monitor')}
              >
                ⛶ Monitor Kiosk
              </FuiButton>
            </>
          )}

          {kioskMode && (
            <>
              <FuiButton
                size="sm"
                variant="secondary"
                data-testid="monitor-prev-btn"
                onClick={() => {
                  setCycleState((prev) => ({
                    rotationIndex:
                      rotationDecks.length > 0
                        ? (prev.rotationIndex - 1 + rotationDecks.length) % rotationDecks.length
                        : 0,
                    elapsedMs: 0,
                  }));
                }}
              >
                ← PREV
              </FuiButton>
              <FuiButton
                size="sm"
                variant={isPaused ? 'primary' : 'secondary'}
                data-testid="monitor-pause-btn"
                onClick={() => setIsPaused((p) => !p)}
              >
                {isPaused ? '▶ RESUME (SPACE)' : '⏸ PAUSE / PIN (SPACE)'}
              </FuiButton>
              <FuiButton
                size="sm"
                variant="secondary"
                data-testid="monitor-next-btn"
                onClick={() => {
                  setCycleState((prev) => ({
                    rotationIndex:
                      rotationDecks.length > 0
                        ? (prev.rotationIndex + 1) % rotationDecks.length
                        : 0,
                    elapsedMs: 0,
                  }));
                }}
              >
                NEXT →
              </FuiButton>
              <PrivacyMaskToggle label="👁️ PRIVACY" />
              <FuiButton
                size="sm"
                variant="secondary"
                data-testid="exit-monitor-btn"
                onClick={() => onNavigate('/dashboard')}
              >
                EXIT MONITOR ↗
              </FuiButton>
            </>
          )}
        </div>
      </div>

      {/* Inline Edit Deck Form on /dashboard */}
      {showEditDeck && !kioskMode && (
        <form
          data-testid="edit-deck-form"
          onSubmit={(e) => updateDeckMutation.mutate(e)}
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '8px',
            flexWrap: 'wrap',
            padding: '10px 16px',
            backgroundColor: FUI_TOKENS.bgPanel,
            borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
            borderRadius: '0px',
          }}
        >
          <FuiInput
            label="EDIT DECK TITLE"
            data-testid="edit-deck-title-input"
            value={editDeckTitle}
            onChange={(e) => setEditDeckTitle(e.target.value)}
          />
          <FuiInput
            label="CYCLE SECONDS (5..86400)"
            data-testid="edit-deck-cycle-input"
            value={editDeckCycleSec}
            onChange={(e) => setEditDeckCycleSec(e.target.value)}
          />
          <FuiButton
            type="submit"
            size="sm"
            variant="primary"
            data-testid="save-deck-edit-btn"
          >
            Save Deck
          </FuiButton>
          <FuiButton
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setShowEditDeck(false)}
          >
            Cancel
          </FuiButton>
          {editDeckError && (
            <span style={{ color: FUI_TOKENS.accentVermilion, fontSize: '12px' }}>
              {editDeckError}
            </span>
          )}
        </form>
      )}

      {/* Inline Create Deck Form on /dashboard */}
      {showCreateDeck && !kioskMode && (
        <form
          onSubmit={(e) => createDeckMutation.mutate(e)}
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '8px',
            padding: '10px 16px',
            backgroundColor: FUI_TOKENS.bgPanel,
            borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
          }}
        >
          <FuiInput
            label="DECK TITLE"
            data-testid="new-deck-title-input"
            placeholder="DECK_05 // CUSTOM_OPS"
            value={newDeckTitle}
            onChange={(e) => setNewDeckTitle(e.target.value)}
          />
          <FuiInput
            label="CYCLE SECONDS (5..86400)"
            data-testid="new-deck-cycle-input"
            value={newDeckCycleSec}
            onChange={(e) => setNewDeckCycleSec(e.target.value)}
          />
          <FuiButton type="submit" size="sm" variant="primary">
            Create Deck
          </FuiButton>
          {deckError && (
            <span style={{ color: FUI_TOKENS.accentVermilion, fontSize: '12px' }}>{deckError}</span>
          )}
        </form>
      )}

      {/* Pending Tier-3 MCP Dashboard Approvals Strip on /dashboard */}
      {!kioskMode && deckPendingApprovals.length > 0 && (
        <section
          data-testid="pending-mcp-dashboard-approvals"
          style={{
            padding: '10px 16px',
            backgroundColor: FUI_TOKENS.bgPanel,
            borderBottom: `1px solid ${FUI_TOKENS.accentOrange}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            borderRadius: '0px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
            <FuiBadge tone="amber">[PENDING APPROVAL // TIER 3 AUTONOMY]</FuiBadge>
            <span>Pending MCP Dashboard Configuration Proposals ({deckPendingApprovals.length})</span>
          </div>
          {deckPendingApprovals.map((approval) => {
            const pj =
              approval.payload_json && typeof approval.payload_json === 'object'
                ? approval.payload_json
                : {};
            return (
              <div
                key={approval.id}
                data-testid={`pending-dashboard-approval-${approval.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '10px',
                  padding: '8px 10px',
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  fontSize: '12px',
                  borderRadius: '0px',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div>
                    <strong>{String(pj.title || approval.tool_name)}</strong>{' '}
                    <span style={{ color: FUI_TOKENS.inkMuted }}>({approval.tool_name})</span>
                  </div>
                  {pj.command && (
                    <code style={{ color: FUI_TOKENS.accentAmber }}>{String(pj.command)}</code>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <FuiButton
                    size="sm"
                    variant="primary"
                    data-testid={`approve-dashboard-mcp-${approval.id}`}
                    onClick={() =>
                      resolveDashboardApprovalMutation.mutate({
                        approvalId: approval.id,
                        action: 'approve',
                      })
                    }
                  >
                    Approve
                  </FuiButton>
                  <FuiButton
                    size="sm"
                    variant="danger"
                    data-testid={`reject-dashboard-mcp-${approval.id}`}
                    onClick={() =>
                      resolveDashboardApprovalMutation.mutate({
                        approvalId: approval.id,
                        action: 'reject',
                      })
                    }
                  >
                    Reject
                  </FuiButton>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* 12x8 Tactical Widget Grid */}
      <div
        data-testid="room-monitor-grid"
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
          gap: '10px',
          padding: '12px 16px',
          borderRadius: '0px',
        }}
      >
        {activeWidgets.map((widget) => (
          <WidgetRenderer
            key={widget.id}
            deckId={activeDeck.id}
            widget={widget}
            lifeScore={lifeScore}
            servers={servers}
            serverSummary={serverSummary}
            pendingApprovals={pendingApprovals}
            liveTelemetry={liveTelemetry}
            resolvedGridPlacement={resolvedPlacements.get(widget.id)}
            initialRefreshError={widgetRefreshErrors[widget.id] ?? null}
            onEditWidget={!kioskMode ? handleOpenEditWidget : undefined}
            kioskMode={kioskMode}
          />
        ))}
      </div>

      {/* Live Telemetry Guarantees for WEALTH and INFRA decks on /dashboard */}
      {!kioskMode && isWealthDeck && (
        <section
          data-testid="wealth-deck-telemetry-strip"
          style={{
            padding: '10px 16px',
            backgroundColor: FUI_TOKENS.bgPanel,
            borderTop: `1px solid ${FUI_TOKENS.borderHairline}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            fontSize: '12px',
          }}
        >
          <div>
            PORTFOLIO BRL:{' '}
            <PrivacyValue
              kind="currency"
              currency="BRL"
              value={formatBrlCents(wealthBrlCents)}
            />
          </div>
          <div>
            PORTFOLIO USD:{' '}
            <PrivacyValue
              kind="currency"
              currency="USD"
              value={formatUsdCents(wealthUsdCents)}
            />
          </div>
          <div>
            ALLOCATION: <PrivacyValue kind="percent" value={`${wealthFiPct.toFixed(1)}%`} />
          </div>
          <div>
            FIRE TARGET: <PrivacyValue kind="duration" value={wealthDurationLabel} />
          </div>
          <div style={{ width: '100%' }}>
            <WaffleGrid10x20
              items={wealthWaffleSlices}
              totalValueCents={wealthBrlCents}
              preserveUnallocated={wealthWaffleSlices.length === 0}
            />
          </div>
        </section>
      )}

      {!kioskMode && isInfraDeck && servers.length > 0 && (
        <section
          data-testid="infra-deck-servers-strip"
          style={{
            padding: '10px 16px',
            backgroundColor: FUI_TOKENS.bgPanel,
            borderTop: `1px solid ${FUI_TOKENS.borderHairline}`,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            fontSize: '12px',
          }}
        >
          {servers.map((srv) => (
            <div
              key={srv.id}
              style={{
                padding: '4px 8px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                display: 'inline-flex',
                gap: '6px',
                alignItems: 'center',
              }}
            >
              <strong>{srv.name}</strong>
              <FuiBadge
                tone={
                  srv.status === 'online'
                    ? 'phosphor'
                    : srv.status === 'degraded'
                      ? 'amber'
                      : 'vermilion'
                }
              >
                {String(srv.status || 'unknown').toUpperCase()}
              </FuiBadge>
            </div>
          ))}
        </section>
      )}

      {/* Add Custom Widget Modal */}
      {showAddWidget && !kioskMode && (
        <div
          data-testid="add-widget-modal"
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 950,
            backgroundColor: 'rgba(8, 8, 11, 0.84)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '580px',
              backgroundColor: FUI_TOKENS.bgPanel,
              border: `1px solid ${FUI_TOKENS.accentOrange}`,
              color: FUI_TOKENS.inkStark,
              fontFamily: FUI_TOKENS.fontMono,
            }}
          >
            <FuiPanelHeader
              title={
                editingWidgetId
                  ? 'EDIT TELEMETRY WIDGET // 12X8 GRID BUILDER'
                  : 'ADD TELEMETRY WIDGET // 12X8 GRID BUILDER'
              }
              code={editingWidgetId ? 'WIDGET_EDIT' : 'WIDGET_NEW'}
              accent="orange"
              actions={
                <FuiButton
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setShowAddWidget(false);
                    setEditingWidgetId(null);
                    setWidgetError(null);
                  }}
                >
                  [ESC]
                </FuiButton>
              }
            />

            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveWidgetMutation.mutate(e);
              }}
              style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}
            >
              <FuiInput
                label="WIDGET TITLE"
                data-testid="widget-title-input"
                placeholder="CUSTOM_SQL_PANEL"
                value={widgetTitle}
                onChange={(e) => setWidgetTitle(e.target.value)}
              />

              <div>
                <div style={{ fontSize: '12px', marginBottom: '6px', color: FUI_TOKENS.inkMuted }}>
                  SOURCE KIND
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {(['builtin', 'sql', 'http', 'command', 'hermes'] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      role="tab"
                      aria-selected={widgetSourceKind === kind}
                      onClick={() => setWidgetSourceKind(kind)}
                      style={{
                        padding: '5px 10px',
                        fontSize: '12px',
                        fontFamily: FUI_TOKENS.fontMono,
                        backgroundColor:
                          widgetSourceKind === kind ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgCarbon,
                        color:
                          widgetSourceKind === kind ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                        border: `1px solid ${FUI_TOKENS.borderHairline}`,
                        cursor: 'pointer',
                      }}
                    >
                      {kind.toUpperCase()}
                    </button>
                  ))}
                  <select
                    data-testid="widget-source-kind"
                    aria-label="Widget Source Kind"
                    value={widgetSourceKind}
                    onChange={(e) => setWidgetSourceKind(e.target.value as any)}
                    style={{
                      padding: '5px 8px',
                      fontSize: '12px',
                      fontFamily: FUI_TOKENS.fontMono,
                      backgroundColor: FUI_TOKENS.bgCarbon,
                      color: FUI_TOKENS.inkStark,
                      border: `1px solid ${FUI_TOKENS.borderHairline}`,
                    }}
                  >
                    <option value="builtin">BUILTIN</option>
                    <option value="sql">SQL</option>
                    <option value="http">HTTP</option>
                    <option value="command">COMMAND</option>
                    <option value="hermes">HERMES</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="widget-query-textarea"
                  style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}
                >
                  QUERY / ENDPOINT / COMMAND / PROMPT
                </label>
                <textarea
                  id="widget-query-textarea"
                  data-testid="widget-query-input"
                  rows={3}
                  value={widgetQueryOrConfig}
                  onChange={(e) => {
                    setWidgetQueryOrConfig(e.target.value);
                    if (widgetError) setWidgetError(null);
                  }}
                  style={{
                    width: '100%',
                    padding: '8px',
                    backgroundColor: FUI_TOKENS.bgCarbon,
                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                    color: FUI_TOKENS.inkStark,
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="widget-renderer-select"
                  style={{ display: 'block', fontSize: '12px', marginBottom: '4px' }}
                >
                  RENDERER
                </label>
                <select
                  id="widget-renderer-select"
                  data-testid="widget-renderer-kind"
                  value={widgetRendererKind}
                  onChange={(e) => setWidgetRendererKind(e.target.value as any)}
                  style={{
                    padding: '6px 8px',
                    fontSize: '12px',
                    fontFamily: FUI_TOKENS.fontMono,
                    backgroundColor: FUI_TOKENS.bgCarbon,
                    color: FUI_TOKENS.inkStark,
                    border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  }}
                >
                  <option value="table">TABLE</option>
                  <option value="kpi">KPI</option>
                  <option value="sparkline">SPARKLINE</option>
                  <option value="waffle">WAFFLE</option>
                  <option value="bar">BAR</option>
                  <option value="terminal">TERMINAL</option>
                  <option value="custom_module">CUSTOM_MODULE</option>
                </select>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: '8px',
                }}
              >
                <FuiInput
                  label="GRID X (0..11)"
                  data-testid="widget-grid-x"
                  value={widgetGridX}
                  onChange={(e) => setWidgetGridX(e.target.value)}
                />
                <FuiInput
                  label="GRID Y (0..7)"
                  data-testid="widget-grid-y"
                  value={widgetGridY}
                  onChange={(e) => setWidgetGridY(e.target.value)}
                />
                <FuiInput
                  label="WIDTH W (1..12)"
                  data-testid="widget-grid-w"
                  value={widgetGridW}
                  onChange={(e) => setWidgetGridW(e.target.value)}
                />
                <FuiInput
                  label="HEIGHT H (1..8)"
                  data-testid="widget-grid-h"
                  value={widgetGridH}
                  onChange={(e) => setWidgetGridH(e.target.value)}
                />
              </div>

              {widgetError && (
                <div
                  data-testid="widget-sql-guardrail-error"
                  style={{
                    padding: '8px 10px',
                    backgroundColor: FUI_TOKENS.bgCarbon,
                    border: `1px solid ${FUI_TOKENS.accentVermilion}`,
                    color: FUI_TOKENS.accentVermilion,
                    fontSize: '12px',
                  }}
                >
                  {widgetError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <FuiButton
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setShowAddWidget(false);
                    setEditingWidgetId(null);
                  }}
                >
                  Cancel
                </FuiButton>
                <FuiButton
                  type="submit"
                  size="sm"
                  variant="primary"
                  data-testid="widget-submit-btn"
                >
                  {editingWidgetId ? 'Save Widget' : 'Create Widget'}
                </FuiButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
