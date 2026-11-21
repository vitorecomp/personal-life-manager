import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  UUID_RE,
  type AgentRecord,
  type AllocationRecord,
  type CourseRecord,
  type DashboardDeckRecord,
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

export type GalleryCategoryKey =
  | 'all'
  | 'life_ops'
  | 'wealth'
  | 'strategy'
  | 'infra_ai'
  | 'custom';

export interface WidgetGalleryTemplate {
  key: string;
  title: string;
  category: Exclude<GalleryCategoryKey, 'all'>;
  categoryLabel: string;
  description: string;
  source_kind: 'builtin' | 'sql' | 'http' | 'command' | 'hermes';
  renderer_kind: 'kpi' | 'sparkline' | 'waffle' | 'bar' | 'table' | 'terminal' | 'custom_module';
  defaultSpan: { w: number; h: number };
  recommendedSpans: Array<{ w: number; h: number; label: string }>;
  source_config: Record<string, any>;
}

export const WIDGET_GALLERY_CATALOG: WidgetGalleryTemplate[] = [
  {
    key: 'life_radar',
    title: 'LIFE_TELEMETRY_INDEX',
    category: 'life_ops',
    categoryLabel: 'LIFE OPS',
    description: 'Composite 0-100 Life Score and 5-pillar radar reticle (Focus, Routines, Goals, Learning, Wealth).',
    source_kind: 'builtin',
    renderer_kind: 'custom_module',
    defaultSpan: { w: 4, h: 4 },
    recommendedSpans: [
      { w: 4, h: 4, label: '4×4 (Standard)' },
      { w: 6, h: 4, label: '6×4 (Wide)' },
      { w: 6, h: 5, label: '6×5 (Expanded)' },
    ],
    source_config: { builtin_key: 'life_score' },
  },
  {
    key: 'focus_todos',
    title: '24H_FOCUS_BARCODE',
    category: 'life_ops',
    categoryLabel: 'LIFE OPS',
    description: '24-hour focus session barcode (96×15min slots), deep-work minutes, and active task queue velocity.',
    source_kind: 'builtin',
    renderer_kind: 'bar',
    defaultSpan: { w: 4, h: 4 },
    recommendedSpans: [
      { w: 4, h: 4, label: '4×4 (Standard)' },
      { w: 6, h: 4, label: '6×4 (Wide)' },
      { w: 3, h: 2, label: '3×2 (Compact)' },
    ],
    source_config: { builtin_key: 'focus_barcode' },
  },
  {
    key: 'routines_bio',
    title: 'ROUTINES_&_BIO_CONSISTENCY',
    category: 'life_ops',
    categoryLabel: 'LIFE OPS',
    description: 'Active day profile, 8×12 binary dot matrix habit streaks, and 7-day routine completion waveform.',
    source_kind: 'builtin',
    renderer_kind: 'sparkline',
    defaultSpan: { w: 4, h: 4 },
    recommendedSpans: [
      { w: 4, h: 4, label: '4×4 (Standard)' },
      { w: 6, h: 4, label: '6×4 (Wide)' },
      { w: 4, h: 3, label: '4×3 (Medium)' },
    ],
    source_config: { builtin_key: 'routines_bio' },
  },
  {
    key: 'portfolio_waffle',
    title: 'PORTFOLIO_WAFFLE_&_TICKER',
    category: 'wealth',
    categoryLabel: 'WEALTH & FIRE',
    description: '10×20 200-tile asset allocation waffle grid with multi-market BRL + USD net worth telemetry.',
    source_kind: 'builtin',
    renderer_kind: 'waffle',
    defaultSpan: { w: 6, h: 5 },
    recommendedSpans: [
      { w: 6, h: 5, label: '6×5 (Standard)' },
      { w: 6, h: 4, label: '6×4 (Medium)' },
      { w: 12, h: 4, label: '12×4 (Full Width)' },
    ],
    source_config: { builtin_key: 'portfolio_waffle' },
  },
  {
    key: 'fire_gauge',
    title: 'RETIREMENT_FIRE_GAUGE',
    category: 'wealth',
    categoryLabel: 'WEALTH & FIRE',
    description: 'Hatched donut FI progress gauge, safe withdrawal target, and projected years to retirement.',
    source_kind: 'builtin',
    renderer_kind: 'kpi',
    defaultSpan: { w: 6, h: 5 },
    recommendedSpans: [
      { w: 6, h: 5, label: '6×5 (Standard)' },
      { w: 4, h: 4, label: '4×4 (Compact)' },
      { w: 6, h: 4, label: '6×4 (Medium)' },
    ],
    source_config: { builtin_key: 'fire_gauge' },
  },
  {
    key: 'monthly_surplus',
    title: 'MONTHLY_INVESTABLE_SURPLUS',
    category: 'wealth',
    categoryLabel: 'WEALTH & FIRE',
    description: 'Paired hatched bar chart tracking monthly salary vs. planned and actual investment surplus.',
    source_kind: 'builtin',
    renderer_kind: 'bar',
    defaultSpan: { w: 6, h: 4 },
    recommendedSpans: [
      { w: 6, h: 4, label: '6×4 (Standard)' },
      { w: 4, h: 4, label: '4×4 (Square)' },
      { w: 12, h: 4, label: '12×4 (Full Width)' },
    ],
    source_config: { builtin_key: 'monthly_surplus' },
  },
  {
    key: 'goals_blueprint',
    title: 'YEARLY_GOAL_BLUEPRINT',
    category: 'strategy',
    categoryLabel: 'STRATEGY & LORE',
    description: 'Q1-Q4 North Star OKR progress rollups and pace drift telemetry (on_track / at_risk / off_track).',
    source_kind: 'builtin',
    renderer_kind: 'custom_module',
    defaultSpan: { w: 6, h: 4 },
    recommendedSpans: [
      { w: 6, h: 4, label: '6×4 (Standard)' },
      { w: 4, h: 4, label: '4×4 (Square)' },
      { w: 12, h: 4, label: '12×4 (Full Width)' },
    ],
    source_config: { builtin_key: 'goals_blueprint' },
  },
  {
    key: 'courses_momentum',
    title: 'COURSES_&_SPACED_REVIEWS',
    category: 'strategy',
    categoryLabel: 'STRATEGY & LORE',
    description: 'Active learning syllabus progress and 7d / 30d / 90d spaced repetition reviews due.',
    source_kind: 'builtin',
    renderer_kind: 'bar',
    defaultSpan: { w: 4, h: 3 },
    recommendedSpans: [
      { w: 4, h: 3, label: '4×3 (Standard)' },
      { w: 4, h: 4, label: '4×4 (Square)' },
      { w: 6, h: 4, label: '6×4 (Wide)' },
    ],
    source_config: { builtin_key: 'courses_momentum' },
  },
  {
    key: 'second_brain_constellation',
    title: 'SECOND_BRAIN_CONSTELLATION',
    category: 'strategy',
    categoryLabel: 'STRATEGY & LORE',
    description: 'Obsidian Second Brain vault note graph mesh and semantic cluster connectivity.',
    source_kind: 'builtin',
    renderer_kind: 'custom_module',
    defaultSpan: { w: 6, h: 4 },
    recommendedSpans: [
      { w: 6, h: 4, label: '6×4 (Standard)' },
      { w: 4, h: 4, label: '4×4 (Square)' },
      { w: 6, h: 5, label: '6×5 (Tall)' },
    ],
    source_config: { builtin_key: 'second_brain_constellation' },
  },
  {
    key: 'server_prober',
    title: 'SERVER_INFRASTRUCTURE_PROBER',
    category: 'infra_ai',
    categoryLabel: 'INFRA & AI',
    description: 'Concurrent Tokio TCP/HTTP server health matrix with live latency sparklines and 1-click probe.',
    source_kind: 'builtin',
    renderer_kind: 'table',
    defaultSpan: { w: 6, h: 5 },
    recommendedSpans: [
      { w: 6, h: 5, label: '6×5 (Standard)' },
      { w: 6, h: 4, label: '6×4 (Medium)' },
      { w: 12, h: 4, label: '12×4 (Full Width)' },
    ],
    source_config: { builtin_key: 'server_prober' },
  },
  {
    key: 'knights_pulse',
    title: 'KNIGHT_ORDER_&_HERMES_PULSE',
    category: 'infra_ai',
    categoryLabel: 'INFRA & AI',
    description: 'Autonomous Isometric Knight roster, HP/EP budget bars, and Tier-3 MCP approval queue.',
    source_kind: 'builtin',
    renderer_kind: 'custom_module',
    defaultSpan: { w: 6, h: 5 },
    recommendedSpans: [
      { w: 6, h: 5, label: '6×5 (Standard)' },
      { w: 6, h: 4, label: '6×4 (Medium)' },
      { w: 4, h: 4, label: '4×4 (Compact)' },
    ],
    source_config: { builtin_key: 'knights_pulse' },
  },
  {
    key: 'custom_sql',
    title: 'POSTGRES_TELEMETRY_QUERY',
    category: 'custom',
    categoryLabel: 'CUSTOM TELEMETRY',
    description: 'Read-only PostgreSQL SELECT/WITH query rendered as a tactical table, KPI, or chart.',
    source_kind: 'sql',
    renderer_kind: 'table',
    defaultSpan: { w: 6, h: 4 },
    recommendedSpans: [
      { w: 6, h: 4, label: '6×4 (Standard)' },
      { w: 4, h: 3, label: '4×3 (Medium)' },
      { w: 12, h: 4, label: '12×4 (Full Width)' },
    ],
    source_config: {
      query: 'SELECT slug, title, cycle_seconds FROM dashboards ORDER BY sort_order ASC',
    },
  },
  {
    key: 'custom_http',
    title: 'HTTP_JSON_ENDPOINT_PROBE',
    category: 'custom',
    categoryLabel: 'CUSTOM TELEMETRY',
    description: 'Polls an external or local HTTP JSON endpoint with optional JSONPointer value extraction.',
    source_kind: 'http',
    renderer_kind: 'kpi',
    defaultSpan: { w: 4, h: 3 },
    recommendedSpans: [
      { w: 4, h: 3, label: '4×3 (Standard)' },
      { w: 3, h: 2, label: '3×2 (Compact)' },
      { w: 6, h: 4, label: '6×4 (Wide)' },
    ],
    source_config: {
      url: 'http://127.0.0.1:8080/api/health',
      json_pointer: '/status',
    },
  },
  {
    key: 'custom_command',
    title: 'HOST_SHELL_COMMAND_PANEL',
    category: 'custom',
    categoryLabel: 'CUSTOM TELEMETRY',
    description: 'Executes a Tier-3 operator-approved shell command and streams stdout/stderr into a terminal card.',
    source_kind: 'command',
    renderer_kind: 'terminal',
    defaultSpan: { w: 6, h: 4 },
    recommendedSpans: [
      { w: 6, h: 4, label: '6×4 (Standard)' },
      { w: 4, h: 3, label: '4×3 (Medium)' },
      { w: 12, h: 4, label: '12×4 (Full Width)' },
    ],
    source_config: {
      command: 'uptime',
      timeout_ms: 5000,
    },
  },
  {
    key: 'custom_hermes',
    title: 'HERMES_AI_BRIEF_PROMPT',
    category: 'custom',
    categoryLabel: 'CUSTOM TELEMETRY',
    description: 'Scheduled Hermes Gateway synthesis prompt with deterministic offline mock resilience.',
    source_kind: 'hermes',
    renderer_kind: 'terminal',
    defaultSpan: { w: 6, h: 4 },
    recommendedSpans: [
      { w: 6, h: 4, label: '6×4 (Standard)' },
      { w: 4, h: 4, label: '4×4 (Square)' },
      { w: 12, h: 4, label: '12×4 (Full Width)' },
    ],
    source_config: {
      prompt: 'Summarize today tactical priorities and system posture.',
    },
  },
];

function clampGridRectToDeck(
  rect: { x: number; y: number; w: number; h: number },
  cols = 12,
  rows = 8,
): GridRect {
  const safeCols = Math.max(1, Number(cols) || 12);
  const safeRows = Math.max(1, Number(rows) || 8);
  const w = Math.min(safeCols, Math.max(1, Math.round(Number(rect.w)) || 4));
  const h = Math.min(safeRows, Math.max(1, Math.round(Number(rect.h)) || 3));
  const x = Math.min(safeCols - w, Math.max(0, Math.round(Number(rect.x)) || 0));
  const y = Math.min(safeRows - h, Math.max(0, Math.round(Number(rect.y)) || 0));
  return { x, y, w, h };
}

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

  // R1, R2, R3: 2D Grid Edit Mode, Drag-and-Drop, Widget Gallery, Cards for Later & Cancel Editing
  const [isEditMode, setIsEditMode] = useState(false);
  const [showWidgetGallery, setShowWidgetGallery] = useState(false);
  const [galleryCategory, setGalleryCategory] = useState<GalleryCategoryKey>('all');
  const [gallerySearch, setGallerySearch] = useState('');
  const [gallerySpanSelection, setGallerySpanSelection] = useState<
    Record<string, { w: number; h: number }>
  >({});
  const [localDeckWidgetsOverride, setLocalDeckWidgetsOverride] = useState<
    Record<string, DashboardWidgetRecord[]>
  >({});
  const [localDeletedWidgets, setLocalDeletedWidgets] = useState<Record<string, Set<string>>>({});
  const [priorityWidgetId, setPriorityWidgetId] = useState<string | null>(null);
  const [stashedCardsByDeck, setStashedCardsByDeck] = useState<
    Record<string, DashboardWidgetRecord[]>
  >(() => {
    try {
      const raw = window.localStorage.getItem('hermes-dashboard-stashed-cards');
      return raw ? (JSON.parse(raw) as Record<string, DashboardWidgetRecord[]>) : {};
    } catch {
      return {};
    }
  });
  const [stashSidebarCollapsed, setStashSidebarCollapsed] = useState(false);
  const [editingStashSizeId, setEditingStashSizeId] = useState<string | null>(null);
  const [dragHoverStash, setDragHoverStash] = useState(false);
  const editSessionSnapshotRef = useRef<
    Record<
      string,
      {
        widgets: DashboardWidgetRecord[];
        deletedIds: Set<string>;
        stashedCards: DashboardWidgetRecord[];
        createdWidgetIds: Set<string>;
        deletedBackendWidgets: DashboardWidgetRecord[];
      }
    >
  >({});

  useEffect(() => {
    try {
      window.localStorage.setItem(
        'hermes-dashboard-stashed-cards',
        JSON.stringify(stashedCardsByDeck),
      );
    } catch {
      // ignore storage errors
    }
  }, [stashedCardsByDeck]);

  // Drag-and-Drop state & ref (ref ensures synchronous access in Vitest fireEvent.drop without dataTransfer)
  const dashboardRootRef = useRef<HTMLDivElement | null>(null);
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  const [editViewportHeight, setEditViewportHeight] = useState<number | null>(null);
  const dragPayloadRef = useRef<
    | { kind: 'widget'; widgetId: string }
    | { kind: 'gallery'; itemKey: string }
    | { kind: 'stash'; widgetId: string }
    | null
  >(null);
  const [draggingWidgetId, setDraggingWidgetId] = useState<string | null>(null);
  const [draggingGalleryKey, setDraggingGalleryKey] = useState<string | null>(null);
  const [draggingStashId, setDraggingStashId] = useState<string | null>(null);
  const [dragHoverCell, setDragHoverCell] = useState<{ x: number; y: number } | null>(null);
  const [dragHoverWidgetId, setDragHoverWidgetId] = useState<string | null>(null);

  // Measure viewport height & lock document/shell vertical scroll so the grid uses all available space without scroll
  useLayoutEffect(() => {
    const updateViewportHeight = () => {
      const rootEl = dashboardRootRef.current;
      const rawTop = rootEl ? rootEl.getBoundingClientRect().top : 0;
      const topOffset = rawTop > 0 ? Math.ceil(rawTop) : 56;
      const viewportH =
        typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 900;
      setEditViewportHeight(Math.max(320, viewportH - topOffset));
    };

    updateViewportHeight();
    window.addEventListener('resize', updateViewportHeight);
    return () => window.removeEventListener('resize', updateViewportHeight);
  }, [isEditMode, kioskMode]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }
    const docEl = document.documentElement;
    const bodyEl = document.body;
    const shellEl = document.querySelector(
      '[data-testid="hermes-web-shell"]',
    ) as HTMLElement | null;
    const sidebarEl = document.querySelector(
      '[data-testid="app-shell-sidebar"]',
    ) as HTMLElement | null;
    const workspaceEl = document.querySelector(
      '[data-testid="app-shell-workspace"]',
    ) as HTMLElement | null;
    const mainEl = document.querySelector('[data-testid="app-shell-body"]') as HTMLElement | null;

    const prevDocOverflow = docEl.style.overflow;
    const prevDocMaxH = docEl.style.maxHeight;
    const prevBodyOverflow = bodyEl.style.overflow;
    const prevBodyMaxH = bodyEl.style.maxHeight;
    const prevShellH = shellEl?.style.height ?? '';
    const prevShellMaxH = shellEl?.style.maxHeight ?? '';
    const prevShellOverflow = shellEl?.style.overflow ?? '';
    const prevSidebarH = sidebarEl?.style.height ?? '';
    const prevSidebarMaxH = sidebarEl?.style.maxHeight ?? '';
    const prevSidebarMinH = sidebarEl?.style.minHeight ?? '';
    const prevSidebarOverflow = sidebarEl?.style.overflow ?? '';
    const prevWorkspaceH = workspaceEl?.style.height ?? '';
    const prevWorkspaceMaxH = workspaceEl?.style.maxHeight ?? '';
    const prevWorkspaceMinH = workspaceEl?.style.minHeight ?? '';
    const prevWorkspaceOverflow = workspaceEl?.style.overflow ?? '';
    const prevMainOverflow = mainEl?.style.overflow ?? '';
    const prevMainMaxH = mainEl?.style.maxHeight ?? '';

    docEl.style.overflow = 'hidden';
    docEl.style.maxHeight = '100vh';
    bodyEl.style.overflow = 'hidden';
    bodyEl.style.maxHeight = '100vh';
    if (shellEl) {
      shellEl.style.height = '100vh';
      shellEl.style.maxHeight = '100vh';
      shellEl.style.overflow = 'hidden';
    }
    if (sidebarEl) {
      sidebarEl.style.height = '100vh';
      sidebarEl.style.maxHeight = '100vh';
      sidebarEl.style.minHeight = '100vh';
      sidebarEl.style.overflow = 'hidden';
    }
    if (workspaceEl) {
      workspaceEl.style.height = '100vh';
      workspaceEl.style.maxHeight = '100vh';
      workspaceEl.style.minHeight = '100vh';
      workspaceEl.style.overflow = 'hidden';
    }
    if (mainEl) {
      mainEl.style.overflow = 'hidden';
      mainEl.style.maxHeight = '100%';
    }

    return () => {
      docEl.style.overflow = prevDocOverflow;
      docEl.style.maxHeight = prevDocMaxH;
      bodyEl.style.overflow = prevBodyOverflow;
      bodyEl.style.maxHeight = prevBodyMaxH;
      if (shellEl) {
        shellEl.style.height = prevShellH;
        shellEl.style.maxHeight = prevShellMaxH;
        shellEl.style.overflow = prevShellOverflow;
      }
      if (sidebarEl) {
        sidebarEl.style.height = prevSidebarH;
        sidebarEl.style.maxHeight = prevSidebarMaxH;
        sidebarEl.style.minHeight = prevSidebarMinH;
        sidebarEl.style.overflow = prevSidebarOverflow;
      }
      if (workspaceEl) {
        workspaceEl.style.height = prevWorkspaceH;
        workspaceEl.style.maxHeight = prevWorkspaceMaxH;
        workspaceEl.style.minHeight = prevWorkspaceMinH;
        workspaceEl.style.overflow = prevWorkspaceOverflow;
      }
      if (mainEl) {
        mainEl.style.overflow = prevMainOverflow;
        mainEl.style.maxHeight = prevMainMaxH;
      }
    };
  }, [isEditMode, kioskMode]);

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

  const kioskNavDecks = useMemo(
    () => (rotationDecks.length > 1 ? rotationDecks : decks),
    [rotationDecks, decks],
  );

  const noDecksInRotation = useMemo(
    () => decks.length > 0 && decks.every((d) => d.in_rotation === false),
    [decks],
  );

  const activeDeck: DashboardDeckRecord = useMemo(() => {
    if (kioskMode) {
      const safeIdx =
        kioskNavDecks.length > 0
          ? ((cycleState.rotationIndex % kioskNavDecks.length) + kioskNavDecks.length) %
            kioskNavDecks.length
          : 0;
      return kioskNavDecks[safeIdx] ?? decks[0] ?? FALLBACK_STARTER_DECKS[0]!;
    }
    if (selectedDeckId) {
      const found = decks.find(
        (d) => d.id === selectedDeckId || d.slug === selectedDeckId,
      );
      if (found) return found;
    }
    return decks[0] ?? FALLBACK_STARTER_DECKS[0]!;
  }, [kioskMode, kioskNavDecks, cycleState.rotationIndex, selectedDeckId, decks]);

  useEffect(() => {
    setActiveDashboardId(activeDeck?.id && UUID_RE.test(activeDeck.id) ? activeDeck.id : null);
  }, [activeDeck?.id, setActiveDashboardId]);

  const { data: activeDeckDetail } = useQuery({
    queryKey: ['dashboards', activeDeck?.id],
    queryFn: async () => {
      if (!activeDeck?.id || !UUID_RE.test(activeDeck.id)) return null;
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
    enabled: Boolean(activeDeck?.id && UUID_RE.test(activeDeck.id)),
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

      if (!kioskMode && showWidgetGallery && e.key === 'Escape') {
        e.preventDefault();
        setShowWidgetGallery(false);
        return;
      }

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
              kioskNavDecks.length > 0
                ? (prev.rotationIndex + 1) % kioskNavDecks.length
                : 0,
            elapsedMs: 0,
          }));
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setCycleState((prev) => ({
            rotationIndex:
              kioskNavDecks.length > 0
                ? (prev.rotationIndex - 1 + kioskNavDecks.length) % kioskNavDecks.length
                : 0,
            elapsedMs: 0,
          }));
        } else if (e.key === 'f' || e.key === 'F' || e.key === 'Escape') {
          e.preventDefault();
          onNavigate('/dashboard');
        }
      } else if (!showAddWidget && !showCreateDeck && !showEditDeck && !showWidgetGallery) {
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
    kioskNavDecks.length,
    onNavigate,
    showAddWidget,
    showCreateDeck,
    showEditDeck,
    showWidgetGallery,
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

  const activeWidgets: DashboardWidgetRecord[] = useMemo(() => {
    const detailWidgets =
      activeDeckDetail && !Array.isArray(activeDeckDetail)
        ? activeDeckDetail.widgets
        : undefined;
    const fromDetail = unwrapList<DashboardWidgetRecord>(detailWidgets, ['widgets']).filter(
      (w): w is DashboardWidgetRecord => Boolean(w && typeof w === 'object'),
    );
    const fromList = unwrapList<DashboardWidgetRecord>(activeDeck?.widgets, ['widgets']).filter(
      (w): w is DashboardWidgetRecord => Boolean(w && typeof w === 'object'),
    );
    const serverBase = fromDetail.length > 0 ? fromDetail : fromList;
    const deckKey = activeDeck?.id ?? '';
    const localList = localDeckWidgetsOverride[deckKey];
    const deletedSet = localDeletedWidgets[deckKey];

    if (!localList) {
      if (!deletedSet || deletedSet.size === 0) return serverBase;
      return serverBase.filter((w) => !deletedSet.has(w.id));
    }

    const serverById = new Map(serverBase.map((w) => [w.id, w]));
    const merged: DashboardWidgetRecord[] = [];
    const seenIds = new Set<string>();

    for (const localW of localList) {
      if (deletedSet?.has(localW.id)) continue;
      const srvW = serverById.get(localW.id);
      merged.push(
        srvW
          ? {
              ...srvW,
              title: localW.title || srvW.title,
              source_kind: localW.source_kind || srvW.source_kind,
              renderer_kind: localW.renderer_kind || srvW.renderer_kind,
              grid_rect: localW.grid_rect ?? srvW.grid_rect,
              sort_order: localW.sort_order ?? srvW.sort_order,
              source_config: localW.source_config ?? srvW.source_config,
            }
          : localW,
      );
      seenIds.add(localW.id);
    }

    for (const srvW of serverBase) {
      if (!seenIds.has(srvW.id) && !deletedSet?.has(srvW.id)) {
        merged.push(srvW);
      }
    }

    return merged;
  }, [activeDeckDetail, activeDeck, localDeckWidgetsOverride, localDeletedWidgets]);

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

      const editingWidget = editingWidgetId
        ? activeWidgets.find((w) => w.id === editingWidgetId)
        : undefined;
      const commandTimeoutMs =
        editingWidget?.source_kind === 'command' &&
        typeof editingWidget.source_config?.timeout_ms === 'number'
          ? editingWidget.source_config.timeout_ms
          : 5000;

      const updatedConfig =
        widgetSourceKind === 'sql'
          ? { query: widgetQueryOrConfig }
          : widgetSourceKind === 'http'
             ? { url: widgetQueryOrConfig }
            : widgetSourceKind === 'command'
              ? { command: widgetQueryOrConfig, timeout_ms: commandTimeoutMs }
              : widgetSourceKind === 'hermes'
                ? { prompt: widgetQueryOrConfig }
                : { builtin_key: widgetQueryOrConfig || 'life_score' };

      const source_config: Record<string, any> =
        editingWidget && editingWidget.source_kind === widgetSourceKind
          ? { ...(editingWidget.source_config ?? {}), ...updatedConfig }
          : updatedConfig;

      if (editingWidgetId) {
        setLocalDeckWidgetsOverride((prev) => {
          const list = prev[activeDeck.id];
          if (!list) return prev;
          return {
            ...prev,
            [activeDeck.id]: list.map((w) =>
              w.id === editingWidgetId
                ? {
                    ...w,
                    title,
                    source_kind: widgetSourceKind,
                    renderer_kind: widgetRendererKind,
                    grid_rect,
                    source_config,
                  }
                : w,
            ),
          };
        });
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
        const isUnapprovedCommand =
          widgetSourceKind === 'command' && source_config?.approved === false;
        if (!isUnapprovedCommand) {
          await apiPost(`/api/widgets/${encodeURIComponent(editingWidgetId)}/refresh`, {}).catch(
            () => null,
          );
        }
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
        editSessionSnapshotRef.current[activeDeck.id]?.createdWidgetIds.add(String(wId));
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

  // Compute non-overlapping 12x8 2D grid placements (preserving exact coordinates and deterministically packing collisions)
  const resolvedPlacements = useMemo(() => {
    const placements = new Map<
      string,
      { gridColumn: string; gridRow: string; x: number; y: number; w: number; h: number }
    >();
    const maxPackRows = 32;
    const occupied: boolean[][] = Array.from({ length: maxPackRows }, () =>
      Array.from({ length: 12 }, () => false),
    );

    const placeSingleWidget = (w: DashboardWidgetRecord) => {
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
          x: rx,
          y: ry,
          w: spanW,
          h: spanH,
        });
        return;
      }

      // Deterministic 2D first-fit packing for colliding or out-of-bounds widgets
      let packedX = Math.min(12 - spanW, Math.max(0, Number.isInteger(rx) ? rx : 0));
      let packedY = Math.min(8 - spanH, Math.max(0, Number.isInteger(ry) ? ry : 0));
      let foundSlot = false;

      for (let r = 0; r <= maxPackRows - spanH && !foundSlot; r++) {
        for (let c = 0; c <= 12 - spanW; c++) {
          let fits = true;
          for (let dr = 0; dr < spanH && fits; dr++) {
            for (let dc = 0; dc < spanW; dc++) {
              if (occupied[r + dr]?.[c + dc]) {
                fits = false;
                break;
              }
            }
          }
          if (fits) {
            packedX = c;
            packedY = r;
            foundSlot = true;
            for (let dr = 0; dr < spanH; dr++) {
              for (let dc = 0; dc < spanW; dc++) {
                if (occupied[r + dr]) occupied[r + dr]![c + dc] = true;
              }
            }
            break;
          }
        }
      }

      const clampedY = Math.min(8 - spanH, Math.max(0, packedY));
      const effectiveGridRowY = isEditMode && !kioskMode ? clampedY : packedY;
      placements.set(w.id, {
        gridColumn: `${packedX + 1} / span ${spanW}`,
        gridRow: `${effectiveGridRowY + 1} / span ${spanH}`,
        x: packedX,
        y: clampedY,
        w: spanW,
        h: spanH,
      });
    };

    if (priorityWidgetId) {
      const priorityW = activeWidgets.find((w) => w.id === priorityWidgetId);
      if (priorityW) {
        placeSingleWidget(priorityW);
      }
    }

    for (const w of activeWidgets) {
      if (priorityWidgetId && w.id === priorityWidgetId) continue;
      placeSingleWidget(w);
    }

    return placements;
  }, [activeWidgets, priorityWidgetId, isEditMode, kioskMode]);

  const findFirstFreeSlotOnGrid = (spanW: number, spanH: number): GridRect => {
    const w = Math.min(12, Math.max(1, Math.round(spanW) || 4));
    const h = Math.min(8, Math.max(1, Math.round(spanH) || 3));
    const occupied: boolean[][] = Array.from({ length: 8 }, () =>
      Array.from({ length: 12 }, () => false),
    );
    for (const widget of activeWidgets) {
      const p = resolvedPlacements.get(widget.id);
      const rx = p?.x ?? widget.grid_rect?.x ?? 0;
      const ry = p?.y ?? widget.grid_rect?.y ?? 0;
      const rw = p?.w ?? widget.grid_rect?.w ?? 4;
      const rh = p?.h ?? widget.grid_rect?.h ?? 3;
      for (let r = Math.max(0, ry); r < Math.min(8, ry + rh); r++) {
        for (let c = Math.max(0, rx); c < Math.min(12, rx + rw); c++) {
          if (occupied[r]) occupied[r]![c] = true;
        }
      }
    }
    for (let r = 0; r <= 8 - h; r++) {
      for (let c = 0; c <= 12 - w; c++) {
        let fits = true;
        for (let dr = 0; dr < h && fits; dr++) {
          for (let dc = 0; dc < w; dc++) {
            if (occupied[r + dr]?.[c + dc]) {
              fits = false;
              break;
            }
          }
        }
        if (fits) {
          return { x: c, y: r, w, h };
        }
      }
    }
    return { x: 0, y: 0, w, h };
  };

  const persistWidgetLayoutToApi = (
    deckId: string,
    widget: DashboardWidgetRecord,
    nextRect: GridRect,
    nextSortOrder?: number,
  ) => {
    const clamped = clampGridRectToDeck(nextRect);
    apiPut(
      `/api/dashboards/${encodeURIComponent(deckId)}/widgets/${encodeURIComponent(widget.id)}`,
      {
        title: widget.title,
        source_kind: widget.source_kind,
        renderer_kind: widget.renderer_kind,
        grid_rect: clamped,
        source_config: widget.source_config ?? {},
        ...(nextSortOrder !== undefined ? { sort_order: nextSortOrder } : {}),
      },
    )
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      })
      .catch(() => null);
  };

  const handleResizeOrMoveWidget = (widget: DashboardWidgetRecord, rawNextRect: GridRect) => {
    const deckId = activeDeck.id;
    const clamped = clampGridRectToDeck(rawNextRect);
    setPriorityWidgetId(widget.id);

    setLocalDeckWidgetsOverride((prev) => {
      const base = prev[deckId] ? [...prev[deckId]!] : [...activeWidgets];
      const nextList = base.map((item) =>
        item.id === widget.id
          ? {
              ...item,
              grid_rect: clamped,
            }
          : item,
      );
      return {
        ...prev,
        [deckId]: nextList,
      };
    });

    persistWidgetLayoutToApi(deckId, widget, clamped, widget.sort_order);
  };

  const handleAutoPackGrid = () => {
    const deckId = activeDeck.id;
    setPriorityWidgetId(null);
    const occupied: boolean[][] = Array.from({ length: 8 }, () =>
      Array.from({ length: 12 }, () => false),
    );
    const nextList: DashboardWidgetRecord[] = activeWidgets.map((w, idx) => {
      const current = resolvedPlacements.get(w.id);
      const spanW = Math.min(12, Math.max(1, current?.w ?? w.grid_rect?.w ?? 4));
      const spanH = Math.min(8, Math.max(1, current?.h ?? w.grid_rect?.h ?? 3));
      let chosenX = 0;
      let chosenY = 0;
      let placed = false;
      for (let r = 0; r <= 8 - spanH && !placed; r++) {
        for (let c = 0; c <= 12 - spanW; c++) {
          let fits = true;
          for (let dr = 0; dr < spanH && fits; dr++) {
            for (let dc = 0; dc < spanW; dc++) {
              if (occupied[r + dr]?.[c + dc]) {
                fits = false;
                break;
              }
            }
          }
          if (fits) {
            chosenX = c;
            chosenY = r;
            placed = true;
            for (let dr = 0; dr < spanH; dr++) {
              for (let dc = 0; dc < spanW; dc++) {
                if (occupied[r + dr]) occupied[r + dr]![c + dc] = true;
              }
            }
            break;
          }
        }
      }
      const nextRect = clampGridRectToDeck({ x: chosenX, y: chosenY, w: spanW, h: spanH });
      persistWidgetLayoutToApi(deckId, w, nextRect, idx + 1);
      return {
        ...w,
        grid_rect: nextRect,
        sort_order: idx + 1,
      };
    });

    setLocalDeckWidgetsOverride((prev) => ({
      ...prev,
      [deckId]: nextList,
    }));
  };

  const stashedCardsForActiveDeck: DashboardWidgetRecord[] = useMemo(
    () => stashedCardsByDeck[activeDeck.id] ?? [],
    [stashedCardsByDeck, activeDeck.id],
  );

  const captureEditSessionSnapshot = (deckId: string) => {
    editSessionSnapshotRef.current[deckId] = {
      widgets: activeWidgets.map((w) => ({
        ...w,
        grid_rect: w.grid_rect ? { ...w.grid_rect } : undefined,
        source_config: w.source_config ? { ...w.source_config } : undefined,
      })),
      deletedIds: new Set(localDeletedWidgets[deckId] ?? []),
      stashedCards: (stashedCardsByDeck[deckId] ?? []).map((w) => ({
        ...w,
        grid_rect: w.grid_rect ? { ...w.grid_rect } : undefined,
        source_config: w.source_config ? { ...w.source_config } : undefined,
      })),
      createdWidgetIds: new Set<string>(),
      deletedBackendWidgets: [],
    };
  };

  useEffect(() => {
    setEditDeckTitle(activeDeck.title);
    setEditDeckCycleSec(String(activeDeck.cycle_seconds ?? 60));
    setEditDeckError(null);
  }, [activeDeck.id, activeDeck.title, activeDeck.cycle_seconds]);

  const enterEditMode = () => {
    setEditDeckTitle(activeDeck.title);
    setEditDeckCycleSec(String(activeDeck.cycle_seconds ?? 60));
    setEditDeckError(null);
    if (!isEditMode) {
      captureEditSessionSnapshot(activeDeck.id);
      setIsEditMode(true);
    }
  };

  const handleCancelEditing = () => {
    const deckId = activeDeck.id;
    const snap = editSessionSnapshotRef.current[deckId];
    if (snap) {
      setLocalDeckWidgetsOverride((prev) => ({
        ...prev,
        [deckId]: snap.widgets.map((w) => ({
          ...w,
          grid_rect: w.grid_rect ? { ...w.grid_rect } : undefined,
        })),
      }));
      setLocalDeletedWidgets((prev) => ({
        ...prev,
        [deckId]: new Set(snap.deletedIds),
      }));
      setStashedCardsByDeck((prev) => ({
        ...prev,
        [deckId]: snap.stashedCards.map((w) => ({
          ...w,
          grid_rect: w.grid_rect ? { ...w.grid_rect } : undefined,
        })),
      }));

      // Roll back backend changes performed during this edit session
      for (const createdId of snap.createdWidgetIds) {
        apiDelete(
          `/api/dashboards/${encodeURIComponent(deckId)}/widgets/${encodeURIComponent(createdId)}`,
        ).catch(() => null);
      }
      for (const origW of snap.widgets) {
        if (origW.grid_rect) {
          persistWidgetLayoutToApi(deckId, origW, origW.grid_rect, origW.sort_order);
        }
      }
      for (const deletedW of snap.deletedBackendWidgets) {
        apiPost(`/api/dashboards/${encodeURIComponent(deckId)}/widgets`, {
          title: deletedW.title,
          source_kind: deletedW.source_kind,
          renderer_kind: deletedW.renderer_kind,
          grid_rect: deletedW.grid_rect ?? { x: 0, y: 0, w: 4, h: 3 },
          source_config: deletedW.source_config ?? {},
          refresh_interval_seconds: deletedW.refresh_interval_seconds ?? 60,
        }).catch(() => null);
      }
      delete editSessionSnapshotRef.current[deckId];
    }
    setPriorityWidgetId(null);
    setIsEditMode(false);
    setShowWidgetGallery(false);
    clearDragState();
  };

  const handleDeleteWidgetLocal = (widgetId: string) => {
    const deckId = activeDeck.id;
    const existing = activeWidgets.find((w) => w.id === widgetId);
    const snap = editSessionSnapshotRef.current[deckId];
    if (snap && existing) {
      if (snap.createdWidgetIds.has(widgetId)) {
        snap.createdWidgetIds.delete(widgetId);
      } else if (!snap.deletedBackendWidgets.some((w) => w.id === widgetId)) {
        snap.deletedBackendWidgets.push({
          ...existing,
          grid_rect: existing.grid_rect ? { ...existing.grid_rect } : undefined,
        });
      }
    }
    setLocalDeletedWidgets((prev) => {
      const nextSet = new Set(prev[deckId] ?? []);
      nextSet.add(widgetId);
      return {
        ...prev,
        [deckId]: nextSet,
      };
    });
    setLocalDeckWidgetsOverride((prev) => {
      if (!prev[deckId]) return prev;
      return {
        ...prev,
        [deckId]: prev[deckId]!.filter((w) => w.id !== widgetId),
      };
    });
  };

  const handleStashWidgetForLater = (widget: DashboardWidgetRecord) => {
    const deckId = activeDeck.id;
    const placement = resolvedPlacements.get(widget.id);
    const savedRect = clampGridRectToDeck({
      x: placement?.x ?? widget.grid_rect?.x ?? 0,
      y: placement?.y ?? widget.grid_rect?.y ?? 0,
      w: placement?.w ?? widget.grid_rect?.w ?? 4,
      h: placement?.h ?? widget.grid_rect?.h ?? 3,
    });
    const stashedCopy: DashboardWidgetRecord = {
      ...widget,
      grid_rect: savedRect,
    };

    setStashedCardsByDeck((prev) => {
      const current = prev[deckId] ?? [];
      if (current.some((c) => c.id === widget.id)) return prev;
      return {
        ...prev,
        [deckId]: [stashedCopy, ...current],
      };
    });

    handleDeleteWidgetLocal(widget.id);
    apiDelete(
      `/api/dashboards/${encodeURIComponent(deckId)}/widgets/${encodeURIComponent(widget.id)}`,
    )
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      })
      .catch(() => null);
  };

  const handleDeleteStashedCardPermanently = (stashedId: string) => {
    const deckId = activeDeck.id;
    setEditingStashSizeId((curr) => (curr === stashedId ? null : curr));
    setStashedCardsByDeck((prev) => ({
      ...prev,
      [deckId]: (prev[deckId] ?? []).filter((c) => c.id !== stashedId),
    }));
  };

  const handleResizeStashedCard = (stashedId: string, nextW: number, nextH: number) => {
    const deckId = activeDeck.id;
    const safeW = Math.min(12, Math.max(1, Math.round(nextW) || 4));
    const safeH = Math.min(8, Math.max(1, Math.round(nextH) || 3));
    setStashedCardsByDeck((prev) => ({
      ...prev,
      [deckId]: (prev[deckId] ?? []).map((c) =>
        c.id === stashedId
          ? {
              ...c,
              grid_rect: {
                x: Math.min(12 - safeW, Math.max(0, c.grid_rect?.x ?? 0)),
                y: Math.min(8 - safeH, Math.max(0, c.grid_rect?.y ?? 0)),
                w: safeW,
                h: safeH,
              },
            }
          : c,
      ),
    }));
  };

  const handleRestoreStashedCard = (
    stashedCard: DashboardWidgetRecord,
    explicitTarget?: { x: number; y: number },
  ) => {
    const deckId = activeDeck.id;
    const spanW = stashedCard.grid_rect?.w ?? 4;
    const spanH = stashedCard.grid_rect?.h ?? 3;
    const targetRect = explicitTarget
      ? clampGridRectToDeck({
          x: explicitTarget.x,
          y: explicitTarget.y,
          w: spanW,
          h: spanH,
        })
      : findFirstFreeSlotOnGrid(spanW, spanH);

    setStashedCardsByDeck((prev) => ({
      ...prev,
      [deckId]: (prev[deckId] ?? []).filter((c) => c.id !== stashedCard.id),
    }));

    const tempId = `w-restored-${Date.now()}`;
    const optimisticWidget: DashboardWidgetRecord = {
      ...stashedCard,
      id: tempId,
      dashboard_id: deckId,
      grid_rect: targetRect,
      sort_order: activeWidgets.length + 1,
    };

    setPriorityWidgetId(tempId);
    setLocalDeckWidgetsOverride((prev) => {
      const base = prev[deckId] ? [...prev[deckId]!] : [...activeWidgets];
      return {
        ...prev,
        [deckId]: [...base, optimisticWidget],
      };
    });

    apiPost<any>(`/api/dashboards/${encodeURIComponent(deckId)}/widgets`, {
      title: stashedCard.title,
      source_kind: stashedCard.source_kind,
      renderer_kind: stashedCard.renderer_kind,
      grid_rect: targetRect,
      source_config: stashedCard.source_config ?? {},
      refresh_interval_seconds: stashedCard.refresh_interval_seconds ?? 60,
    })
      .then(async (created) => {
        const createdObj = created?.data ?? created;
        const createdId = createdObj?.id ? String(createdObj.id) : null;
        if (createdId) {
          editSessionSnapshotRef.current[deckId]?.createdWidgetIds.add(createdId);
          setPriorityWidgetId((curr) => (curr === tempId ? createdId : curr));
          setLocalDeckWidgetsOverride((prev) => {
            const list = prev[deckId];
            if (!list) return prev;
            return {
              ...prev,
              [deckId]: list.map((w) =>
                w.id === tempId
                  ? {
                      ...optimisticWidget,
                      ...(typeof createdObj === 'object' ? createdObj : {}),
                      id: createdId,
                      grid_rect: createdObj?.grid_rect ?? optimisticWidget.grid_rect,
                    }
                  : w,
              ),
            };
          });
          autoRefreshedIdsRef.current.add(createdId);
          const isUnapprovedCommand =
            stashedCard.source_kind === 'command' &&
            stashedCard.source_config?.approved === false;
          if (!isUnapprovedCommand) {
            await apiPost(`/api/widgets/${encodeURIComponent(createdId)}/refresh`, {}).catch(
              () => null,
            );
          }
        }
        queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      })
      .catch(() => null);
  };

  const handleAddWidgetFromGallery = (
    itemKey: string,
    explicitTarget?: { x: number; y: number },
  ) => {
    const template = WIDGET_GALLERY_CATALOG.find((t) => t.key === itemKey);
    if (!template) return;
    const deckId = activeDeck.id;
    const chosenSpan = gallerySpanSelection[template.key] ?? template.defaultSpan;
    const targetRect = explicitTarget
      ? clampGridRectToDeck({
          x: explicitTarget.x,
          y: explicitTarget.y,
          w: chosenSpan.w,
          h: chosenSpan.h,
        })
      : findFirstFreeSlotOnGrid(chosenSpan.w, chosenSpan.h);

    const tempId = `w-gallery-${template.key}-${Date.now()}`;
    const optimisticWidget: DashboardWidgetRecord = {
      id: tempId,
      dashboard_id: deckId,
      title: template.title,
      source_kind: template.source_kind,
      renderer_kind: template.renderer_kind,
      grid_rect: targetRect,
      source_config: { ...template.source_config },
      refresh_interval_seconds: 60,
      sort_order: activeWidgets.length + 1,
    };

    editSessionSnapshotRef.current[deckId]?.createdWidgetIds.add(tempId);
    setPriorityWidgetId(tempId);
    setLocalDeckWidgetsOverride((prev) => {
      const base = prev[deckId] ? [...prev[deckId]!] : [...activeWidgets];
      return {
        ...prev,
        [deckId]: [...base, optimisticWidget],
      };
    });

    apiPost<any>(`/api/dashboards/${encodeURIComponent(deckId)}/widgets`, {
      title: template.title,
      source_kind: template.source_kind,
      renderer_kind: template.renderer_kind,
      grid_rect: targetRect,
      source_config: template.source_config,
      refresh_interval_seconds: 60,
    })
      .then(async (created) => {
        const createdObj = created?.data ?? created;
        const createdId = createdObj?.id ? String(createdObj.id) : null;
        if (createdId) {
          editSessionSnapshotRef.current[deckId]?.createdWidgetIds.delete(tempId);
          editSessionSnapshotRef.current[deckId]?.createdWidgetIds.add(createdId);
          setPriorityWidgetId((curr) => (curr === tempId ? createdId : curr));
          setLocalDeckWidgetsOverride((prev) => {
            const list = prev[deckId];
            if (!list) return prev;
            return {
              ...prev,
              [deckId]: list.map((w) =>
                w.id === tempId
                  ? {
                      ...optimisticWidget,
                      ...(typeof createdObj === 'object' ? createdObj : {}),
                      id: createdId,
                      title: createdObj?.title || optimisticWidget.title,
                      source_kind: createdObj?.source_kind || optimisticWidget.source_kind,
                      renderer_kind: createdObj?.renderer_kind || optimisticWidget.renderer_kind,
                      grid_rect: createdObj?.grid_rect ?? optimisticWidget.grid_rect,
                      source_config: createdObj?.source_config ?? optimisticWidget.source_config,
                    }
                  : w,
              ),
            };
          });
          autoRefreshedIdsRef.current.add(createdId);
          const isUnapprovedCommand =
            template.source_kind === 'command' && template.source_config?.approved === false;
          if (!isUnapprovedCommand) {
            await apiPost(`/api/widgets/${encodeURIComponent(createdId)}/refresh`, {}).catch(
              () => null,
            );
          }
        }
        queryClient.invalidateQueries({ queryKey: ['dashboards'] });
      })
      .catch(() => null);
  };

  const resolveActiveDragPayload = (e?: React.DragEvent) => {
    if (dragPayloadRef.current) return dragPayloadRef.current;
    try {
      const raw = e?.dataTransfer?.getData('text/plain') || '';
      if (raw.startsWith('gallery:')) {
        return { kind: 'gallery' as const, itemKey: raw.slice('gallery:'.length) };
      }
      if (raw.startsWith('stash:')) {
        return { kind: 'stash' as const, widgetId: raw.slice('stash:'.length) };
      }
      if (raw) {
        return { kind: 'widget' as const, widgetId: raw };
      }
    } catch {
      // ignore dataTransfer access errors in synthetic test events
    }
    if (draggingGalleryKey) return { kind: 'gallery' as const, itemKey: draggingGalleryKey };
    if (draggingStashId) return { kind: 'stash' as const, widgetId: draggingStashId };
    if (draggingWidgetId) return { kind: 'widget' as const, widgetId: draggingWidgetId };
    return null;
  };

  const clearDragState = () => {
    dragPayloadRef.current = null;
    setDraggingWidgetId(null);
    setDraggingGalleryKey(null);
    setDraggingStashId(null);
    setDragHoverCell(null);
    setDragHoverWidgetId(null);
    setDragHoverStash(false);
  };

  const handleDragStartWidget = (widget: DashboardWidgetRecord, e: React.DragEvent) => {
    dragPayloadRef.current = { kind: 'widget', widgetId: widget.id };
    setDraggingWidgetId(widget.id);
    setDraggingGalleryKey(null);
    setDraggingStashId(null);
    try {
      e.dataTransfer?.setData('text/plain', widget.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    } catch {
      // ignore synthetic event dataTransfer restrictions
    }
  };

  const handleDragStartGalleryItem = (itemKey: string, e: React.DragEvent) => {
    dragPayloadRef.current = { kind: 'gallery', itemKey };
    setDraggingGalleryKey(itemKey);
    setDraggingWidgetId(null);
    setDraggingStashId(null);
    try {
      e.dataTransfer?.setData('text/plain', `gallery:${itemKey}`);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
    } catch {
      // ignore synthetic event dataTransfer restrictions
    }
  };

  const handleDragStartStashItem = (stashedCard: DashboardWidgetRecord, e: React.DragEvent) => {
    dragPayloadRef.current = { kind: 'stash', widgetId: stashedCard.id };
    setDraggingStashId(stashedCard.id);
    setDraggingWidgetId(null);
    setDraggingGalleryKey(null);
    try {
      e.dataTransfer?.setData('text/plain', `stash:${stashedCard.id}`);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    } catch {
      // ignore synthetic event dataTransfer restrictions
    }
  };

  const handleDropOnStashSidebar = (e: React.DragEvent) => {
    const payload = resolveActiveDragPayload(e);
    clearDragState();
    if (!payload || payload.kind !== 'widget') return;
    const sourceWidget = activeWidgets.find((w) => w.id === payload.widgetId);
    if (!sourceWidget) return;
    handleStashWidgetForLater(sourceWidget);
  };

  const getActiveDragInfo = (
    payloadOverride?: ReturnType<typeof resolveActiveDragPayload>,
  ): { w: number; h: number; excludeWidgetId: string | null } => {
    const payload = payloadOverride ?? resolveActiveDragPayload();
    if (payload?.kind === 'widget') {
      const sourceWidget = activeWidgets.find((w) => w.id === payload.widgetId);
      const sourcePlacement = sourceWidget ? resolvedPlacements.get(sourceWidget.id) : undefined;
      return {
        w: Math.min(12, Math.max(1, sourcePlacement?.w ?? sourceWidget?.grid_rect?.w ?? 4)),
        h: Math.min(8, Math.max(1, sourcePlacement?.h ?? sourceWidget?.grid_rect?.h ?? 3)),
        excludeWidgetId: payload.widgetId,
      };
    }
    if (payload?.kind === 'gallery') {
      const template = WIDGET_GALLERY_CATALOG.find((t) => t.key === payload.itemKey);
      const chosenSpan = template
        ? (gallerySpanSelection[template.key] ?? template.defaultSpan)
        : { w: 4, h: 3 };
      return {
        w: Math.min(12, Math.max(1, chosenSpan.w)),
        h: Math.min(8, Math.max(1, chosenSpan.h)),
        excludeWidgetId: null,
      };
    }
    if (payload?.kind === 'stash') {
      const stashed = stashedCardsForActiveDeck.find((c) => c.id === payload.widgetId);
      return {
        w: Math.min(12, Math.max(1, stashed?.grid_rect?.w ?? 4)),
        h: Math.min(8, Math.max(1, stashed?.grid_rect?.h ?? 3)),
        excludeWidgetId: null,
      };
    }
    return { w: 4, h: 3, excludeWidgetId: draggingWidgetId };
  };

  const doesRectOverlapOtherWidgets = (
    targetRect: GridRect,
    excludeWidgetId: string | null,
  ): boolean => {
    for (const widget of activeWidgets) {
      if (excludeWidgetId && widget.id === excludeWidgetId) continue;
      const p = resolvedPlacements.get(widget.id);
      const ox = p?.x ?? widget.grid_rect?.x ?? 0;
      const oy = p?.y ?? widget.grid_rect?.y ?? 0;
      const ow = p?.w ?? widget.grid_rect?.w ?? 4;
      const oh = p?.h ?? widget.grid_rect?.h ?? 3;
      const overlaps =
        targetRect.x < ox + ow &&
        targetRect.x + targetRect.w > ox &&
        targetRect.y < oy + oh &&
        targetRect.y + targetRect.h > oy;
      if (overlaps) return true;
    }
    return false;
  };

  const activeDragPreview = useMemo(() => {
    if (!dragHoverCell) return null;
    const dragInfo = getActiveDragInfo();
    const footprint = clampGridRectToDeck({
      x: dragHoverCell.x,
      y: dragHoverCell.y,
      w: dragInfo.w,
      h: dragInfo.h,
    });
    const isCollision = doesRectOverlapOtherWidgets(footprint, dragInfo.excludeWidgetId);
    return {
      footprint,
      isCollision,
    };
  }, [
    dragHoverCell,
    draggingWidgetId,
    draggingGalleryKey,
    draggingStashId,
    activeWidgets,
    resolvedPlacements,
    gallerySpanSelection,
    stashedCardsForActiveDeck,
  ]);

  const handleDropOnWidget = (_targetWidget: DashboardWidgetRecord, _e: React.DragEvent) => {
    // Prevent dropping one card directly on top of another card
    clearDragState();
  };

  const computeGridCellFromDragEvent = (e: React.DragEvent): { x: number; y: number } => {
    const targetEl = e.target as HTMLElement | null;
    const cellEl = targetEl?.closest?.('[data-grid-col][data-grid-row]') as HTMLElement | null;
    if (cellEl) {
      const cx = Number.parseInt(cellEl.getAttribute('data-grid-col') || '0', 10);
      const cy = Number.parseInt(cellEl.getAttribute('data-grid-row') || '0', 10);
      if (Number.isFinite(cx) && Number.isFinite(cy)) {
        return { x: Math.min(11, Math.max(0, cx)), y: Math.min(7, Math.max(0, cy)) };
      }
    }
    const rect = gridContainerRef.current?.getBoundingClientRect();
    const hasClientCoords = Number(e.clientX) > 0 || Number(e.clientY) > 0;
    if (rect && rect.width > 0 && rect.height > 0 && hasClientCoords) {
      const relX = Math.max(0, Math.min(rect.width - 1, Number(e.clientX) - rect.left));
      const relY = Math.max(0, Math.min(rect.height - 1, Number(e.clientY) - rect.top));
      const col = Math.min(11, Math.max(0, Math.floor((relX / rect.width) * 12)));
      const row = Math.min(7, Math.max(0, Math.floor((relY / rect.height) * 8)));
      return { x: col, y: row };
    }
    const widgetEl = targetEl?.closest?.('[data-widget-id]') as HTMLElement | null;
    if (widgetEl) {
      const wx = Number.parseInt(widgetEl.getAttribute('data-grid-x') || '0', 10);
      const wy = Number.parseInt(widgetEl.getAttribute('data-grid-y') || '0', 10);
      if (Number.isFinite(wx) && Number.isFinite(wy)) {
        return { x: Math.min(11, Math.max(0, wx)), y: Math.min(7, Math.max(0, wy)) };
      }
    }
    return dragHoverCell ?? { x: 0, y: 0 };
  };

  const handleDropOnGridCell = (col: number, row: number, e: React.DragEvent) => {
    const payload = resolveActiveDragPayload(e);
    const dragInfo = getActiveDragInfo(payload);
    const candidateRect = clampGridRectToDeck({
      x: col,
      y: row,
      w: dragInfo.w,
      h: dragInfo.h,
    });
    const hasCollision = doesRectOverlapOtherWidgets(candidateRect, dragInfo.excludeWidgetId);
    clearDragState();
    if (!payload || hasCollision) return;

    if (payload.kind === 'gallery') {
      setShowWidgetGallery(false);
      handleAddWidgetFromGallery(payload.itemKey, { x: candidateRect.x, y: candidateRect.y });
      return;
    }

    if (payload.kind === 'stash') {
      const stashed = stashedCardsForActiveDeck.find((c) => c.id === payload.widgetId);
      if (stashed) {
        handleRestoreStashedCard(stashed, { x: candidateRect.x, y: candidateRect.y });
      }
      return;
    }

    const sourceWidget = activeWidgets.find((w) => w.id === payload.widgetId);
    if (!sourceWidget) return;
    const nextRect = candidateRect;

    const deckId = activeDeck.id;
    setPriorityWidgetId(sourceWidget.id);

    setLocalDeckWidgetsOverride((prev) => {
      const base = prev[deckId] ? [...prev[deckId]!] : [...activeWidgets];
      const nextList = base.map((w) => {
        if (w.id === sourceWidget.id) {
          return { ...w, grid_rect: nextRect };
        }
        const p = resolvedPlacements.get(w.id);
        if (p) {
          return {
            ...w,
            grid_rect: clampGridRectToDeck({ x: p.x, y: p.y, w: p.w, h: p.h }),
          };
        }
        return w;
      });
      return {
        ...prev,
        [deckId]: nextList,
      };
    });

    persistWidgetLayoutToApi(deckId, sourceWidget, nextRect, sourceWidget.sort_order);
  };

  const filteredGalleryItems = useMemo(() => {
    const q = gallerySearch.trim().toLowerCase();
    return WIDGET_GALLERY_CATALOG.filter((item) => {
      if (galleryCategory !== 'all' && item.category !== galleryCategory) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.key.toLowerCase().includes(q) ||
        item.categoryLabel.toLowerCase().includes(q) ||
        item.source_kind.toLowerCase().includes(q)
      );
    });
  }, [galleryCategory, gallerySearch]);

  // Pending Tier-3 MCP approvals targeting dashboards_* tools scoped to activeDeck
  const deckPendingApprovals = useMemo(() => {
    return pendingApprovals.filter((a) => {
      if (!a || String(a.status || '').toLowerCase() !== 'pending') return false;
      const tool = String(a.tool_name || '');
      if (!tool.startsWith('dashboards_') && !tool.includes('command_widget')) return false;

      const pj = a.payload_json && typeof a.payload_json === 'object' ? a.payload_json : {};
      const rawTarget = pj.dashboard_id ?? pj.id ?? pj.id_or_slug;
      const targetDashId = rawTarget != null ? String(rawTarget).trim() : '';

      if (rawDecks.length === 0) {
        if (
          !targetDashId ||
          (String(activeDeck.id) !== targetDashId && String(activeDeck.slug) !== targetDashId)
        ) {
          return false;
        }
      }

      if (
        targetDashId &&
        String(activeDeck.id) !== targetDashId &&
        String(activeDeck.slug) !== targetDashId
      ) {
        return false;
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
  }, [pendingApprovals, rawDecks.length, activeDeck.id, activeDeck.slug, activeWidgets]);

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
      ref={dashboardRootRef}
      data-testid={kioskMode ? 'room-monitor-kiosk' : 'room-monitor-dashboard'}
      data-edit-mode={isEditMode && !kioskMode ? 'true' : 'false'}
      style={{
        flex: 1,
        minHeight: 0,
        width: '100%',
        height: editViewportHeight ? `${editViewportHeight}px` : 'calc(100vh - 56px)',
        maxHeight: editViewportHeight ? `${editViewportHeight}px` : 'calc(100vh - 56px)',
        overflow: 'hidden',
        boxSizing: 'border-box',
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
          flexShrink: 0,
          gap: isEditMode && !kioskMode ? '4px' : '8px',
          padding: isEditMode && !kioskMode ? '4px 10px' : '6px 12px',
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
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: isEditMode ? '4px' : '6px',
              flexWrap: 'wrap',
            }}
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
                  onClick={() => {
                    setSelectedDeckId(deck.id);
                  }}
                  style={{
                    padding: isEditMode ? '3px 8px' : '4px 10px',
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: isEditMode && !kioskMode ? '4px' : '6px',
            flexWrap: 'wrap',
          }}
        >
          {!kioskMode && (
            <>
              {!isEditMode && (
                <ModularHudLoader
                  variant="proximity_scan"
                  size={40}
                  label="LIFE_IDX"
                  value={`${Math.round(lifeScore?.composite_score ?? 0)}%`}
                />
              )}
              <FuiButton
                size="sm"
                variant={isEditMode ? 'primary' : 'secondary'}
                data-testid="toggle-edit-mode-btn"
                onClick={() => {
                  if (!isEditMode) {
                    enterEditMode();
                  } else {
                    delete editSessionSnapshotRef.current[activeDeck.id];
                    setIsEditMode(false);
                    setShowWidgetGallery(false);
                    clearDragState();
                  }
                }}
              >
                {isEditMode ? '✓ Done Editing' : '⊞ Edit Deck'}
              </FuiButton>
              {isEditMode && (
                <FuiButton
                  size="sm"
                  variant="danger"
                  data-testid="cancel-edit-mode-btn"
                  onClick={handleCancelEditing}
                >
                  ✕ Cancel Editing
                </FuiButton>
              )}
              <FuiButton
                size="sm"
                variant={showWidgetGallery ? 'primary' : 'secondary'}
                data-testid="open-widget-gallery-btn"
                onClick={() => {
                  const nextOpen = !showWidgetGallery;
                  if (nextOpen && !isEditMode) {
                    enterEditMode();
                  }
                  setShowWidgetGallery(nextOpen);
                }}
              >
                ◈ Widget Gallery
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
                      kioskNavDecks.length > 0
                        ? (prev.rotationIndex - 1 + kioskNavDecks.length) % kioskNavDecks.length
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
                      kioskNavDecks.length > 0
                        ? (prev.rotationIndex + 1) % kioskNavDecks.length
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

      {/* Inline Create Deck Form on /dashboard */}
      {showCreateDeck && !kioskMode && (
        <form
          onSubmit={(e) => createDeckMutation.mutate(e)}
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '8px',
            flexShrink: 0,
            padding: '8px 14px',
            backgroundColor: FUI_TOKENS.bgPanel,
            borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
            borderRadius: '0px',
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
            padding: '6px 12px',
            flexShrink: 0,
            backgroundColor: FUI_TOKENS.bgPanel,
            borderBottom: `1px solid ${FUI_TOKENS.accentOrange}`,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
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
                  gap: '8px',
                  padding: '6px 8px',
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  fontSize: '12px',
                  borderRadius: '0px',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
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

      {/* R1, R2, R3: Compact 2D Grid Edit Mode Banner */}
      {isEditMode && !kioskMode && (
        <section
          data-testid="dashboard-edit-banner"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            flexShrink: 0,
            gap: '6px',
            padding: '4px 10px',
            backgroundColor: FUI_TOKENS.bgPanel,
            borderBottom: `1px solid ${FUI_TOKENS.accentOrange}`,
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            borderRadius: '0px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <FuiBadge tone="orange">12×8 2D TACTICAL GRID</FuiBadge>
            <span style={{ color: FUI_TOKENS.inkStark }}>
              Resize W×H spans (-W/+W, -H/+H, presets, corner handle ◢), drag cards on the 12×8 grid, or park cards in the left Cards for Later sidebar.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <FuiButton
              size="sm"
              variant="secondary"
              data-testid="auto-pack-grid-btn"
              onClick={handleAutoPackGrid}
            >
              Auto-Pack Grid
            </FuiButton>
            <FuiButton
              size="sm"
              variant={showWidgetGallery ? 'primary' : 'secondary'}
              data-testid="banner-toggle-gallery-btn"
              onClick={() => {
                enterEditMode();
                setShowWidgetGallery((prev) => !prev);
              }}
            >
              {showWidgetGallery ? '▾ Close Widget Gallery' : '+ Add Card // Widget Gallery'}
            </FuiButton>
            <FuiButton
              size="sm"
              variant="danger"
              data-testid="banner-cancel-editing-btn"
              onClick={handleCancelEditing}
            >
              ✕ Cancel Editing
            </FuiButton>
            <FuiButton
              size="sm"
              variant="primary"
              data-testid="banner-done-editing-btn"
              onClick={() => {
                delete editSessionSnapshotRef.current[activeDeck.id];
                setIsEditMode(false);
                setShowWidgetGallery(false);
                clearDragState();
              }}
            >
              ✓ Done Editing
            </FuiButton>
          </div>
        </section>
      )}

      {/* Workspace Row: Left "Cards for Later" Sidebar + Full-Space 12x8 Tactical Widget Grid */}
      <div
        data-testid="dashboard-grid-workspace"
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'stretch',
          borderRadius: '0px',
        }}
      >
        {/* Left Sidebar for "Cards for Later" (only visible in Edit Mode) */}
        {isEditMode && !kioskMode && (
          <aside
            data-testid="cards-for-later-sidebar"
            data-position="left"
            data-collapsed={stashSidebarCollapsed ? 'true' : 'false'}
            aria-label="Cards for Later"
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragHoverStash) setDragHoverStash(true);
            }}
            onDragLeave={() => {
              if (dragHoverStash) setDragHoverStash(false);
            }}
            onDrop={handleDropOnStashSidebar}
            style={{
              width: stashSidebarCollapsed ? '44px' : '196px',
              minWidth: stashSidebarCollapsed ? '44px' : '196px',
              maxWidth: stashSidebarCollapsed ? '44px' : '196px',
              height: '100%',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: dragHoverStash
                ? 'rgba(44, 229, 242, 0.14)'
                : FUI_TOKENS.bgPanel,
              borderRight: `1px solid ${
                dragHoverStash ? FUI_TOKENS.accentCyan : FUI_TOKENS.borderHairline
              }`,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              overflow: 'hidden',
              boxSizing: 'border-box',
              borderRadius: '0px',
            }}
          >
            {/* Sidebar Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: stashSidebarCollapsed ? 'center' : 'space-between',
                gap: '4px',
                padding: '6px 8px',
                borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
                backgroundColor: FUI_TOKENS.bgCarbon,
                flexShrink: 0,
                borderRadius: '0px',
              }}
            >
              {!stashSidebarCollapsed && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    minWidth: 0,
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: '12px',
                      color: FUI_TOKENS.accentCyan,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    CARDS FOR LATER
                  </span>
                  <span
                    data-testid="cards-for-later-count"
                    style={{
                      padding: '1px 5px',
                      fontSize: '12px',
                      backgroundColor: FUI_TOKENS.bgPanel,
                      color: FUI_TOKENS.inkStark,
                      border: `1px solid ${FUI_TOKENS.borderHairline}`,
                      borderRadius: '0px',
                    }}
                  >
                    {stashedCardsForActiveDeck.length}
                  </span>
                </div>
              )}
              <button
                type="button"
                data-testid="stash-sidebar-collapse-toggle"
                aria-label={
                  stashSidebarCollapsed
                    ? 'Expand Cards for Later sidebar'
                    : 'Collapse Cards for Later sidebar'
                }
                aria-expanded={!stashSidebarCollapsed}
                onClick={() => setStashSidebarCollapsed((prev) => !prev)}
                style={{
                  padding: '2px 6px',
                  fontSize: '12px',
                  fontFamily: FUI_TOKENS.fontMono,
                  backgroundColor: FUI_TOKENS.bgPanel,
                  color: FUI_TOKENS.inkStark,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  cursor: 'pointer',
                  borderRadius: '0px',
                }}
              >
                {stashSidebarCollapsed ? '»' : '«'}
              </button>
            </div>

            {/* Sidebar Body */}
            {stashSidebarCollapsed ? (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  paddingTop: '10px',
                  gap: '8px',
                  color: FUI_TOKENS.inkMuted,
                  fontSize: '12px',
                  borderRadius: '0px',
                }}
              >
                <span title={`Cards for Later (${stashedCardsForActiveDeck.length})`}>
                  📥 {stashedCardsForActiveDeck.length}
                </span>
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  borderRadius: '0px',
                }}
              >
                {/* Deck Options Section inside Sidebar */}
                <section
                  data-testid="sidebar-deck-options"
                  style={{
                    padding: '6px 8px',
                    borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
                    backgroundColor: FUI_TOKENS.bgCarbon,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    flexShrink: 0,
                    borderRadius: '0px',
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: '12px',
                      color: FUI_TOKENS.accentOrange,
                    }}
                  >
                    DECK OPTIONS
                  </div>
                  <form
                    data-testid="edit-deck-form"
                    onSubmit={(e) => updateDeckMutation.mutate(e)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
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
                    {editDeckError && (
                      <span style={{ color: FUI_TOKENS.accentVermilion, fontSize: '12px' }}>
                        {editDeckError}
                      </span>
                    )}
                  </form>

                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '4px',
                      paddingTop: '4px',
                      borderTop: `1px solid ${FUI_TOKENS.borderHairline}`,
                      borderRadius: '0px',
                    }}
                  >
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
                      data-testid="deck-rotation-toggle"
                      onClick={() => toggleRotationMutation.mutate()}
                    >
                      Rotation: {activeDeck.in_rotation ? 'ON' : 'OFF'}
                    </FuiButton>
                    <FuiButton
                      size="sm"
                      variant="secondary"
                      data-testid="clone-deck-btn"
                      onClick={() => cloneDeckMutation.mutate()}
                    >
                      Clone Deck
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
                  </div>
                </section>

                {/* Cards for Later List Section */}
                <div
                  data-testid="cards-for-later-list"
                  style={{
                    flex: 1,
                    padding: '6px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    borderRadius: '0px',
                  }}
                >
                  {stashedCardsForActiveDeck.length === 0 ? (
                  <div
                    data-testid="cards-for-later-empty"
                    style={{
                      padding: '8px',
                      backgroundColor: FUI_TOKENS.bgCarbon,
                      border: `1px dashed ${FUI_TOKENS.borderHairline}`,
                      color: FUI_TOKENS.inkMuted,
                      fontSize: '12px',
                      lineHeight: 1.35,
                      borderRadius: '0px',
                    }}
                  >
                    Drag cards here or use 📥 Save for Later in a card&apos;s option menu to park cards off the grid.
                  </div>
                ) : (
                  stashedCardsForActiveDeck.map((card) => {
                    const spanW = card.grid_rect?.w ?? 4;
                    const spanH = card.grid_rect?.h ?? 3;
                    const isEditingSize = editingStashSizeId === card.id;
                    return (
                      <div
                        key={card.id}
                        data-testid={`stashed-card-${card.id}`}
                        data-stashed-title={card.title}
                        data-grid-w={spanW}
                        data-grid-h={spanH}
                        data-grid-span={`${spanW}x${spanH}`}
                        draggable
                        onDragStart={(e) => handleDragStartStashItem(card, e)}
                        onDragEnd={clearDragState}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          padding: '6px 8px',
                          backgroundColor: FUI_TOKENS.bgCarbon,
                          border: `1px solid ${
                            draggingStashId === card.id
                              ? FUI_TOKENS.accentCyan
                              : FUI_TOKENS.borderHairline
                          }`,
                          cursor: 'grab',
                          borderRadius: '0px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '4px',
                          }}
                        >
                          <strong
                            style={{
                              fontSize: '12px',
                              color: FUI_TOKENS.inkStark,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {card.title}
                          </strong>
                          <button
                            type="button"
                            data-testid={`stashed-card-size-btn-${card.id}`}
                            aria-label={`Edit size for ${card.title}`}
                            aria-expanded={isEditingSize}
                            title="Click to edit card size (W×H)"
                            onClick={() =>
                              setEditingStashSizeId((prev) => (prev === card.id ? null : card.id))
                            }
                            style={{
                              padding: '1px 5px',
                              fontSize: '12px',
                              fontFamily: FUI_TOKENS.fontMono,
                              fontWeight: 700,
                              backgroundColor: isEditingSize
                                ? FUI_TOKENS.accentCyan
                                : FUI_TOKENS.bgPanel,
                              color: isEditingSize ? FUI_TOKENS.bgCarbon : FUI_TOKENS.accentCyan,
                              border: `1px solid ${
                                isEditingSize ? FUI_TOKENS.accentCyan : FUI_TOKENS.borderHairline
                              }`,
                              cursor: 'pointer',
                              borderRadius: '0px',
                              flexShrink: 0,
                            }}
                          >
                            {spanW}×{spanH}
                          </button>
                        </div>

                        {isEditingSize && (
                          <div
                            data-testid={`stashed-card-size-editor-${card.id}`}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px',
                              padding: '4px',
                              backgroundColor: FUI_TOKENS.bgPanel,
                              border: `1px solid ${FUI_TOKENS.accentCyan}`,
                              borderRadius: '0px',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '2px',
                                flexWrap: 'wrap',
                              }}
                            >
                              <button
                                type="button"
                                data-testid={`stashed-card-w-dec-${card.id}`}
                                aria-label="Decrease stashed card width"
                                onClick={() =>
                                  handleResizeStashedCard(card.id, Math.max(1, spanW - 1), spanH)
                                }
                                style={{
                                  padding: '1px 4px',
                                  fontSize: '12px',
                                  fontFamily: FUI_TOKENS.fontMono,
                                  backgroundColor: FUI_TOKENS.bgCarbon,
                                  color: FUI_TOKENS.inkStark,
                                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                                  cursor: 'pointer',
                                  borderRadius: '0px',
                                }}
                              >
                                -W
                              </button>
                              <select
                                data-testid={`stashed-card-select-w-${card.id}`}
                                aria-label="Stashed card width span"
                                value={String(spanW)}
                                onChange={(e) =>
                                  handleResizeStashedCard(
                                    card.id,
                                    Number.parseInt(e.target.value, 10) || spanW,
                                    spanH,
                                  )
                                }
                                style={{
                                  padding: '1px 3px',
                                  fontSize: '12px',
                                  fontFamily: FUI_TOKENS.fontMono,
                                  backgroundColor: FUI_TOKENS.bgCarbon,
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
                                data-testid={`stashed-card-w-inc-${card.id}`}
                                aria-label="Increase stashed card width"
                                onClick={() =>
                                  handleResizeStashedCard(card.id, Math.min(12, spanW + 1), spanH)
                                }
                                style={{
                                  padding: '1px 4px',
                                  fontSize: '12px',
                                  fontFamily: FUI_TOKENS.fontMono,
                                  backgroundColor: FUI_TOKENS.bgCarbon,
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
                                data-testid={`stashed-card-h-dec-${card.id}`}
                                aria-label="Decrease stashed card height"
                                onClick={() =>
                                  handleResizeStashedCard(card.id, spanW, Math.max(1, spanH - 1))
                                }
                                style={{
                                  padding: '1px 4px',
                                  fontSize: '12px',
                                  fontFamily: FUI_TOKENS.fontMono,
                                  backgroundColor: FUI_TOKENS.bgCarbon,
                                  color: FUI_TOKENS.inkStark,
                                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                                  cursor: 'pointer',
                                  borderRadius: '0px',
                                }}
                              >
                                -H
                              </button>
                              <select
                                data-testid={`stashed-card-select-h-${card.id}`}
                                aria-label="Stashed card height span"
                                value={String(spanH)}
                                onChange={(e) =>
                                  handleResizeStashedCard(
                                    card.id,
                                    spanW,
                                    Number.parseInt(e.target.value, 10) || spanH,
                                  )
                                }
                                style={{
                                  padding: '1px 3px',
                                  fontSize: '12px',
                                  fontFamily: FUI_TOKENS.fontMono,
                                  backgroundColor: FUI_TOKENS.bgCarbon,
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
                                data-testid={`stashed-card-h-inc-${card.id}`}
                                aria-label="Increase stashed card height"
                                onClick={() =>
                                  handleResizeStashedCard(card.id, spanW, Math.min(8, spanH + 1))
                                }
                                style={{
                                  padding: '1px 4px',
                                  fontSize: '12px',
                                  fontFamily: FUI_TOKENS.fontMono,
                                  backgroundColor: FUI_TOKENS.bgCarbon,
                                  color: FUI_TOKENS.inkStark,
                                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                                  cursor: 'pointer',
                                  borderRadius: '0px',
                                }}
                              >
                                +H
                              </button>
                            </div>

                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '2px',
                                flexWrap: 'wrap',
                              }}
                            >
                              {(
                                [
                                  [3, 2],
                                  [4, 3],
                                  [4, 4],
                                  [6, 4],
                                  [12, 4],
                                ] as const
                              ).map(([pw, ph]) => {
                                const isCurrent = spanW === pw && spanH === ph;
                                return (
                                  <button
                                    key={`${pw}x${ph}`}
                                    type="button"
                                    data-testid={`stashed-card-preset-${pw}x${ph}-${card.id}`}
                                    onClick={() => handleResizeStashedCard(card.id, pw, ph)}
                                    style={{
                                      padding: '1px 4px',
                                      fontSize: '12px',
                                      fontFamily: FUI_TOKENS.fontMono,
                                      backgroundColor: isCurrent
                                        ? FUI_TOKENS.accentOrange
                                        : FUI_TOKENS.bgCarbon,
                                      color: isCurrent ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                                      border: `1px solid ${
                                        isCurrent
                                          ? FUI_TOKENS.accentOrange
                                          : FUI_TOKENS.borderHairline
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
                          </div>
                        )}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '4px',
                          }}
                        >
                          <button
                            type="button"
                            data-testid={`restore-stashed-card-${card.id}`}
                            aria-label={`Restore ${card.title} to grid`}
                            onClick={() => handleRestoreStashedCard(card)}
                            style={{
                              flex: 1,
                              padding: '2px 6px',
                              fontSize: '12px',
                              fontFamily: FUI_TOKENS.fontMono,
                              fontWeight: 700,
                              backgroundColor: FUI_TOKENS.accentOrange,
                              color: FUI_TOKENS.bgCarbon,
                              border: `1px solid ${FUI_TOKENS.accentOrange}`,
                              cursor: 'pointer',
                              borderRadius: '0px',
                            }}
                          >
                            + Restore
                          </button>
                          <button
                            type="button"
                            data-testid={`delete-stashed-card-${card.id}`}
                            aria-label={`Delete ${card.title} permanently`}
                            title="Delete card permanently"
                            onClick={() => handleDeleteStashedCardPermanently(card.id)}
                            style={{
                              padding: '2px 6px',
                              fontSize: '12px',
                              fontFamily: FUI_TOKENS.fontMono,
                              backgroundColor: FUI_TOKENS.bgPanel,
                              color: FUI_TOKENS.accentVermilion,
                              border: `1px solid ${FUI_TOKENS.accentVermilion}`,
                              cursor: 'pointer',
                              borderRadius: '0px',
                            }}
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
                </div>
              </div>
            )}
          </aside>
        )}

        {/* 12x8 Tactical Widget Grid (uses 100% of available space without scroll) */}
        <div
          ref={gridContainerRef}
          data-testid="room-monitor-grid"
          data-edit-mode={isEditMode && !kioskMode ? 'true' : 'false'}
          data-grid-cols="12"
          data-grid-rows="8"
          onDragOver={(e) => {
            if (kioskMode) return;
            e.preventDefault();
            const cell = computeGridCellFromDragEvent(e);
            if (dragHoverCell?.x !== cell.x || dragHoverCell?.y !== cell.y) {
              setDragHoverCell(cell);
            }
          }}
          onDrop={(e) => {
            if (kioskMode) return;
            e.preventDefault();
            const cell = computeGridCellFromDragEvent(e);
            handleDropOnGridCell(cell.x, cell.y, e);
          }}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            width: '100%',
            height: '100%',
            maxHeight: '100%',
            overflow: 'hidden',
            boxSizing: 'border-box',
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
            gridTemplateRows: 'repeat(8, minmax(0, 1fr))',
            gridAutoRows: 'minmax(0, 1fr)',
            gap: isEditMode && !kioskMode ? '4px' : '6px',
            padding: isEditMode && !kioskMode ? '4px 8px' : '6px 10px',
            borderRadius: '0px',
          }}
        >
          {isEditMode &&
            !kioskMode &&
            Array.from({ length: 8 }, (_, row) =>
              Array.from({ length: 12 }, (__, col) => {
                const isInFootprint =
                  activeDragPreview != null &&
                  col >= activeDragPreview.footprint.x &&
                  col < activeDragPreview.footprint.x + activeDragPreview.footprint.w &&
                  row >= activeDragPreview.footprint.y &&
                  row < activeDragPreview.footprint.y + activeDragPreview.footprint.h;
                const isCollisionCell = Boolean(isInFootprint && activeDragPreview?.isCollision);
                return (
                  <div
                    key={`grid-cell-${col}-${row}`}
                    data-testid={`grid-cell-${col}-${row}`}
                    data-grid-x={col}
                    data-grid-y={row}
                    data-grid-col={col}
                    data-grid-row={row}
                    data-highlighted={isInFootprint ? 'true' : 'false'}
                    data-drop-valid={
                      isInFootprint ? (isCollisionCell ? 'false' : 'true') : undefined
                    }
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (dragHoverCell?.x !== col || dragHoverCell?.y !== row) {
                        setDragHoverCell({ x: col, y: row });
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDropOnGridCell(col, row, e);
                    }}
                    style={{
                      gridColumn: `${col + 1} / span 1`,
                      gridRow: `${row + 1} / span 1`,
                      minHeight: 0,
                      minWidth: 0,
                      zIndex: 0,
                      boxSizing: 'border-box',
                      backgroundColor: isInFootprint
                        ? isCollisionCell
                          ? 'rgba(255, 59, 48, 0.22)'
                          : 'rgba(44, 229, 242, 0.22)'
                        : 'rgba(18, 18, 24, 0.35)',
                      border: isInFootprint
                        ? `1px solid ${
                            isCollisionCell ? FUI_TOKENS.accentVermilion : FUI_TOKENS.accentCyan
                          }`
                        : `1px dashed ${FUI_TOKENS.borderHairline}`,
                      borderRadius: '0px',
                    }}
                  />
                );
              }),
            )}

          {isEditMode && !kioskMode && activeDragPreview && (
            <div
              data-testid="grid-drop-preview"
              data-drop-x={activeDragPreview.footprint.x}
              data-drop-y={activeDragPreview.footprint.y}
              data-drop-w={activeDragPreview.footprint.w}
              data-drop-h={activeDragPreview.footprint.h}
              data-drop-span={`${activeDragPreview.footprint.w}x${activeDragPreview.footprint.h}`}
              data-drop-valid={activeDragPreview.isCollision ? 'false' : 'true'}
              style={{
                gridColumn: `${activeDragPreview.footprint.x + 1} / span ${activeDragPreview.footprint.w}`,
                gridRow: `${activeDragPreview.footprint.y + 1} / span ${activeDragPreview.footprint.h}`,
                pointerEvents: 'none',
                zIndex: 25,
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `2px solid ${
                  activeDragPreview.isCollision
                    ? FUI_TOKENS.accentVermilion
                    : FUI_TOKENS.accentCyan
                }`,
                backgroundColor: activeDragPreview.isCollision
                  ? 'rgba(255, 59, 48, 0.28)'
                  : 'rgba(44, 229, 242, 0.28)',
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                color: FUI_TOKENS.inkStark,
                borderRadius: '0px',
              }}
            >
              <span
                style={{
                  padding: '2px 8px',
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  border: `1px solid ${
                    activeDragPreview.isCollision
                      ? FUI_TOKENS.accentVermilion
                      : FUI_TOKENS.accentCyan
                  }`,
                  color: activeDragPreview.isCollision
                    ? FUI_TOKENS.accentVermilion
                    : FUI_TOKENS.accentCyan,
                  borderRadius: '0px',
                }}
              >
                {activeDragPreview.isCollision
                  ? `✕ OVERLAP BLOCKED (${activeDragPreview.footprint.w}×${activeDragPreview.footprint.h})`
                  : `${activeDragPreview.footprint.w}×${activeDragPreview.footprint.h} @ (${activeDragPreview.footprint.x},${activeDragPreview.footprint.y})`}
              </span>
            </div>
          )}

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
              onStashWidget={isEditMode && !kioskMode ? handleStashWidgetForLater : undefined}
              isEditMode={isEditMode && !kioskMode}
              onResizeWidget={!kioskMode ? handleResizeOrMoveWidget : undefined}
              onDeleteWidget={!kioskMode ? handleDeleteWidgetLocal : undefined}
              onDragStartWidget={!kioskMode ? handleDragStartWidget : undefined}
              onDragOverWidget={
                !kioskMode
                  ? (w, e) => {
                      if (dragHoverWidgetId !== w.id) setDragHoverWidgetId(w.id);
                      const wp = resolvedPlacements.get(w.id);
                      const fallbackCell = {
                        x: wp?.x ?? w.grid_rect?.x ?? 0,
                        y: wp?.y ?? w.grid_rect?.y ?? 0,
                      };
                      const hasCoords = Number(e.clientX) > 0 || Number(e.clientY) > 0;
                      const cell = hasCoords
                        ? computeGridCellFromDragEvent(e)
                        : fallbackCell;
                      if (dragHoverCell?.x !== cell.x || dragHoverCell?.y !== cell.y) {
                        setDragHoverCell(cell);
                      }
                    }
                  : undefined
              }
              onDropOnWidget={!kioskMode ? handleDropOnWidget : undefined}
              onDragEndWidget={!kioskMode ? clearDragState : undefined}
              isDragging={draggingWidgetId === widget.id}
              isDropTarget={dragHoverWidgetId === widget.id && draggingWidgetId !== widget.id}
              kioskMode={kioskMode}
            />
          ))}
        </div>
      </div>

      {/* Live Telemetry Guarantees for WEALTH and INFRA decks on /dashboard */}
      {!kioskMode && !isEditMode && isWealthDeck && (
        <section
          data-testid="wealth-deck-telemetry-strip"
          style={{
            padding: '4px 12px',
            flexShrink: 0,
            backgroundColor: FUI_TOKENS.bgPanel,
            borderTop: `1px solid ${FUI_TOKENS.borderHairline}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            fontSize: '12px',
            borderRadius: '0px',
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
          {!activeWidgets.some((w) =>
            String(w.source_config?.builtin_key || '').includes('waffle'),
          ) && (
            <div style={{ width: '100%' }}>
              <WaffleGrid10x20
                items={wealthWaffleSlices}
                totalValueCents={wealthBrlCents}
                preserveUnallocated={wealthWaffleSlices.length === 0}
              />
            </div>
          )}
        </section>
      )}

      {!kioskMode && !isEditMode && isInfraDeck && servers.length > 0 && (
        <section
          data-testid="infra-deck-servers-strip"
          style={{
            padding: '4px 12px',
            flexShrink: 0,
            backgroundColor: FUI_TOKENS.bgPanel,
            borderTop: `1px solid ${FUI_TOKENS.borderHairline}`,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            fontSize: '12px',
            borderRadius: '0px',
          }}
        >
          {servers.map((srv) => (
            <div
              key={srv.id}
              style={{
                padding: '2px 6px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                display: 'inline-flex',
                gap: '6px',
                alignItems: 'center',
                borderRadius: '0px',
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

      {/* R1: Widget Gallery Modal Overlay */}
      {showWidgetGallery && !kioskMode && (
        <div
          data-testid="widget-gallery-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowWidgetGallery(false);
            }
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 960,
            backgroundColor: 'rgba(8, 8, 11, 0.84)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            pointerEvents: draggingGalleryKey ? 'none' : 'auto',
            opacity: draggingGalleryKey ? 0.15 : 1,
            borderRadius: '0px',
          }}
        >
          <div
            data-testid="widget-gallery"
            role="dialog"
            aria-modal="true"
            aria-label="Widget Gallery"
            style={{
              width: '100%',
              maxWidth: '940px',
              maxHeight: '84vh',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: FUI_TOKENS.bgPanel,
              border: `1px solid ${FUI_TOKENS.accentCyan}`,
              color: FUI_TOKENS.inkStark,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              borderRadius: '0px',
              overflow: 'hidden',
            }}
          >
            <FuiPanelHeader
              title="WIDGET GALLERY // ADD CARDS TO 12×8 GRID"
              code="15_MODULES"
              accent="cyan"
              actions={
                <FuiButton
                  size="sm"
                  variant="secondary"
                  data-testid="close-widget-gallery-btn"
                  aria-label="Close widget gallery"
                  onClick={() => setShowWidgetGallery(false)}
                >
                  [ESC] ✕
                </FuiButton>
              }
            />

            <div
              style={{
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                overflowY: 'auto',
                borderRadius: '0px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '10px',
                  borderRadius: '0px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <FuiBadge tone="cyan">WIDGET GALLERY // 15 MODULES</FuiBadge>
                  <div
                    role="tablist"
                    aria-label="Widget Gallery Categories"
                    style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', borderRadius: '0px' }}
                  >
                    {(
                      [
                        ['all', 'ALL (15)'],
                        ['life_ops', 'LIFE OPS'],
                        ['wealth', 'WEALTH & FIRE'],
                        ['strategy', 'STRATEGY & LORE'],
                        ['infra_ai', 'INFRA & AI'],
                        ['custom', 'CUSTOM TELEMETRY'],
                      ] as const
                    ).map(([catKey, catLabel]) => {
                      const isActiveCat = galleryCategory === catKey;
                      return (
                        <button
                          key={catKey}
                          type="button"
                          role="tab"
                          aria-selected={isActiveCat}
                          data-testid={`widget-gallery-category-${catKey}`}
                          onClick={() => setGalleryCategory(catKey)}
                          style={{
                            padding: '4px 8px',
                            fontSize: '12px',
                            fontFamily: FUI_TOKENS.fontMono,
                            backgroundColor: isActiveCat
                              ? FUI_TOKENS.accentOrange
                              : FUI_TOKENS.bgCarbon,
                            color: isActiveCat ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                            border: `1px solid ${
                              isActiveCat ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                            }`,
                            cursor: 'pointer',
                            borderRadius: '0px',
                          }}
                        >
                          {catLabel}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input
                    type="search"
                    data-testid="widget-gallery-search"
                    aria-label="Search widget gallery"
                    placeholder="Search widgets (e.g. Radar, FIRE, Server)..."
                    value={gallerySearch}
                    onChange={(e) => setGallerySearch(e.target.value)}
                    style={{
                      minWidth: '240px',
                      padding: '5px 8px',
                      fontSize: '12px',
                      fontFamily: FUI_TOKENS.fontMono,
                      backgroundColor: FUI_TOKENS.bgCarbon,
                      color: FUI_TOKENS.inkStark,
                      border: `1px solid ${FUI_TOKENS.borderHairline}`,
                      borderRadius: '0px',
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                  gap: '8px',
                  borderRadius: '0px',
                }}
              >
                {filteredGalleryItems.map((item) => {
                  const selectedSpan = gallerySpanSelection[item.key] ?? item.defaultSpan;
                  const selectedSpanValue = `${selectedSpan.w}x${selectedSpan.h}`;
                  return (
                    <div
                      key={item.key}
                      data-testid={`gallery-item-${item.key}`}
                      draggable
                      onDragStart={(e) => handleDragStartGalleryItem(item.key, e)}
                      onDragEnd={clearDragState}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: '6px',
                        padding: '8px 10px',
                        backgroundColor: FUI_TOKENS.bgCarbon,
                        border: `1px solid ${
                          draggingGalleryKey === item.key
                            ? FUI_TOKENS.accentCyan
                            : FUI_TOKENS.borderHairline
                        }`,
                        cursor: 'grab',
                        borderRadius: '0px',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '6px',
                          }}
                        >
                          <strong style={{ color: FUI_TOKENS.inkStark, fontSize: '12px' }}>
                            {item.title}
                          </strong>
                          <FuiBadge tone={item.source_kind === 'builtin' ? 'phosphor' : 'cyan'}>
                            {item.categoryLabel}
                          </FuiBadge>
                        </div>
                        <div
                          style={{
                            color: FUI_TOKENS.inkMuted,
                            fontSize: '12px',
                            lineHeight: 1.35,
                          }}
                        >
                          {item.description}
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '6px',
                          paddingTop: '4px',
                          borderTop: `1px solid ${FUI_TOKENS.borderHairline}`,
                          borderRadius: '0px',
                        }}
                      >
                        <select
                          data-testid={`gallery-size-${item.key}`}
                          aria-label={`Grid span for ${item.title}`}
                          value={selectedSpanValue}
                          onChange={(e) => {
                            const [rawW, rawH] = e.target.value.split('x');
                            const nextW = Number.parseInt(rawW || '4', 10) || item.defaultSpan.w;
                            const nextH = Number.parseInt(rawH || '4', 10) || item.defaultSpan.h;
                            setGallerySpanSelection((prev) => ({
                              ...prev,
                              [item.key]: { w: nextW, h: nextH },
                            }));
                          }}
                          style={{
                            padding: '3px 6px',
                            fontSize: '12px',
                            fontFamily: FUI_TOKENS.fontMono,
                            backgroundColor: FUI_TOKENS.bgPanel,
                            color: FUI_TOKENS.inkStark,
                            border: `1px solid ${FUI_TOKENS.borderHairline}`,
                            borderRadius: '0px',
                          }}
                        >
                          {item.recommendedSpans.map((sp) => (
                            <option key={`${sp.w}x${sp.h}`} value={`${sp.w}x${sp.h}`}>
                              {sp.label}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          data-testid={`gallery-add-${item.key}`}
                          onClick={() => handleAddWidgetFromGallery(item.key)}
                          style={{
                            padding: '4px 8px',
                            fontSize: '12px',
                            fontFamily: FUI_TOKENS.fontMono,
                            fontWeight: 700,
                            backgroundColor: FUI_TOKENS.accentOrange,
                            color: FUI_TOKENS.bgCarbon,
                            border: `1px solid ${FUI_TOKENS.accentOrange}`,
                            cursor: 'pointer',
                            borderRadius: '0px',
                          }}
                        >
                          + Add to Grid
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Custom Widget Modal */}
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
            borderRadius: '0px',
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
              borderRadius: '0px',
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FuiButton
                    size="sm"
                    variant="secondary"
                    data-testid="modal-open-widget-gallery-btn"
                    onClick={() => {
                      setShowAddWidget(false);
                      setEditingWidgetId(null);
                      setWidgetError(null);
                      enterEditMode();
                      setShowWidgetGallery(true);
                    }}
                  >
                    ◈ Browse Gallery
                  </FuiButton>
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
                </div>
              }
            />

            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveWidgetMutation.mutate(e);
              }}
              style={{
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                borderRadius: '0px',
              }}
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
                        borderRadius: '0px',
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
                      borderRadius: '0px',
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
                    borderRadius: '0px',
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
                    borderRadius: '0px',
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
                    borderRadius: '0px',
                  }}
                >
                  {widgetError}
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {editingWidgetId && (
                    <>
                      <FuiButton
                        type="button"
                        size="sm"
                        variant="danger"
                        data-testid="modal-delete-widget-btn"
                        onClick={() => {
                          const targetId = editingWidgetId;
                          setShowAddWidget(false);
                          setEditingWidgetId(null);
                          setWidgetError(null);
                          handleDeleteWidgetLocal(targetId);
                          if (!FALLBACK_STARTER_WIDGET_IDS.has(targetId)) {
                            apiDelete(
                              `/api/dashboards/${encodeURIComponent(activeDeck.id)}/widgets/${encodeURIComponent(targetId)}`,
                            )
                              .then(() => {
                                queryClient.invalidateQueries({ queryKey: ['dashboards'] });
                              })
                              .catch(() => null);
                          }
                        }}
                      >
                        🗑 Delete Card
                      </FuiButton>
                      <FuiButton
                        type="button"
                        size="sm"
                        variant="secondary"
                        data-testid="modal-stash-widget-btn"
                        onClick={() => {
                          const targetWidget = activeWidgets.find((w) => w.id === editingWidgetId);
                          setShowAddWidget(false);
                          setEditingWidgetId(null);
                          setWidgetError(null);
                          if (targetWidget) {
                            handleStashWidgetForLater(targetWidget);
                          }
                        }}
                      >
                        📥 Save for Later
                      </FuiButton>
                    </>
                  )}
                </div>

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
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
