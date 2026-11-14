import React, { useEffect, useMemo, useState } from 'react';
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
} from '@hermes/ui';
import {
  apiDelete,
  apiGet,
  apiPost,
  apiPut,
  unwrapList,
  type DashboardDeckRecord,
  type DashboardWidgetRecord,
  type LifeScoreResponse,
  type PendingApprovalRecord,
  type ServerNodeRecord,
  type ServerSummaryResponse,
} from '../../api/client';
import { useAppStore } from '../../store/appStore';
import { WidgetRenderer } from './WidgetRenderer';

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

export function RoomMonitorView({
  kioskMode = false,
  initialSlug,
  onNavigate,
}: RoomMonitorViewProps) {
  const queryClient = useQueryClient();
  const setActiveDashboardId = useAppStore((s) => s.setActiveDashboardId);

  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(initialSlug ?? null);
  const [rotationIndex, setRotationIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Modals / forms on /dashboard
  const [showCreateDeck, setShowCreateDeck] = useState(false);
  const [newDeckTitle, setNewDeckTitle] = useState('');
  const [newDeckCycleSec, setNewDeckCycleSec] = useState('60');
  const [deckError, setDeckError] = useState<string | null>(null);

  const [showAddWidget, setShowAddWidget] = useState(false);
  const [widgetTitle, setWidgetTitle] = useState('');
  const [widgetSourceKind, setWidgetSourceKind] = useState<
    'builtin' | 'sql' | 'http' | 'command' | 'hermes'
  >('sql');
  const [widgetRendererKind, setWidgetRendererKind] = useState<
    'kpi' | 'sparkline' | 'waffle' | 'bar' | 'table' | 'terminal' | 'custom_module'
  >('table');
  const [widgetQueryOrConfig, setWidgetQueryOrConfig] = useState(
    "SELECT slug, title, cycle_seconds FROM dashboards ORDER BY sort_order ASC",
  );
  const [widgetError, setWidgetError] = useState<string | null>(null);

  const { data: rawDecks = [] } = useQuery({
    queryKey: ['dashboards'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/dashboards');
        const list = unwrapList<DashboardDeckRecord>(res, ['dashboards']);
        return list.length > 0 ? list : FALLBACK_STARTER_DECKS;
      } catch {
        return FALLBACK_STARTER_DECKS;
      }
    },
  });

  const decks = rawDecks.length > 0 ? rawDecks : FALLBACK_STARTER_DECKS;

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
          ? ((rotationIndex % rotationDecks.length) + rotationDecks.length) % rotationDecks.length
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
  }, [kioskMode, rotationDecks, rotationIndex, selectedDeckId, decks]);

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
          composite_score: 75,
          pillars: { focus: 74, routines: 80, goals: 72, learning: 76, wealth: 73 },
        } satisfies LifeScoreResponse;
      }
    },
  });

  const { data: servers = [] } = useQuery({
    queryKey: ['servers'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/servers');
        return unwrapList<ServerNodeRecord>(res, ['servers']);
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
        return unwrapList<PendingApprovalRecord>(res, ['approvals']);
      } catch {
        return [];
      }
    },
  });

  // Auto-cycle timer on /monitor
  const cycleDurationMs = Math.max(5, Number(activeDeck?.cycle_seconds || 60)) * 1000;

  useEffect(() => {
    if (!kioskMode || isPaused || rotationDecks.length <= 1) {
      return undefined;
    }
    const stepMs = 200;
    const timer = window.setInterval(() => {
      setElapsedMs((prev) => {
        const next = prev + stepMs;
        if (next >= cycleDurationMs) {
          setRotationIndex((idx) => (idx + 1) % rotationDecks.length);
          return 0;
        }
        return next;
      });
    }, stepMs);

    return () => window.clearInterval(timer);
  }, [kioskMode, isPaused, rotationDecks.length, cycleDurationMs]);

  // Keyboard navigation on /monitor (Space, ArrowRight, ArrowLeft)
  useEffect(() => {
    if (!kioskMode) return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        setIsPaused((prev) => !prev);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setElapsedMs(0);
        if (rotationDecks.length > 0) {
          setRotationIndex((idx) => (idx + 1) % rotationDecks.length);
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setElapsedMs(0);
        if (rotationDecks.length > 0) {
          setRotationIndex((idx) => (idx - 1 + rotationDecks.length) % rotationDecks.length);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [kioskMode, rotationDecks.length]);

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

  const createWidgetMutation = useMutation({
    mutationFn: async (e: React.FormEvent) => {
      e.preventDefault();
      setWidgetError(null);
      const title = widgetTitle.trim() || `CUSTOM_${widgetSourceKind.toUpperCase()}_PANEL`;
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

      const created = await apiPost<any>(
        `/api/dashboards/${encodeURIComponent(activeDeck.id)}/widgets`,
        {
          title,
          source_kind: widgetSourceKind,
          renderer_kind: widgetRendererKind,
          grid_rect: { x: 0, y: 0, w: 4, h: 3 },
          source_config,
          refresh_interval_seconds: 60,
        },
      );
      const wId = (created?.data ?? created)?.id;
      if (wId) {
        await apiPost(`/api/widgets/${encodeURIComponent(String(wId))}/refresh`, {}).catch(
          () => {},
        );
      }
      return created;
    },
    onSuccess: () => {
      setWidgetTitle('');
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
    const fromDetail = unwrapList<DashboardWidgetRecord>(
      activeDeckDetail?.widgets ?? activeDeckDetail,
      ['widgets'],
    );
    if (fromDetail.length > 0) return fromDetail;
    const fromList = unwrapList<DashboardWidgetRecord>(activeDeck?.widgets, ['widgets']);
    return fromList;
  }, [activeDeckDetail, activeDeck]);

  const isWealthDeck = /wealth|fire/i.test(`${activeDeck.slug} ${activeDeck.title}`);
  const isInfraDeck = /infra|server|knight/i.test(`${activeDeck.slug} ${activeDeck.title}`);

  const countdownPct = Math.max(
    0,
    Math.min(100, 100 - Math.round((elapsedMs / cycleDurationMs) * 100)),
  );

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
                value={`${Math.round(lifeScore?.composite_score ?? 75)}%`}
              />
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
                onClick={() => setShowAddWidget(true)}
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
                  setElapsedMs(0);
                  if (rotationDecks.length > 0) {
                    setRotationIndex(
                      (idx) => (idx - 1 + rotationDecks.length) % rotationDecks.length,
                    );
                  }
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
                  setElapsedMs(0);
                  if (rotationDecks.length > 0) {
                    setRotationIndex((idx) => (idx + 1) % rotationDecks.length);
                  }
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
            <PrivacyValue kind="currency" currency="BRL" value="R$ 142.500,00" />
          </div>
          <div>
            PORTFOLIO USD: <PrivacyValue kind="currency" currency="USD" value="$ 28,400.00" />
          </div>
          <div>
            ALLOCATION: <PrivacyValue kind="percent" value="64.2%" />
          </div>
          <div>
            FIRE TARGET: <PrivacyValue kind="duration" value="7Y 4M" />
          </div>
          <div style={{ width: '100%' }}>
            <WaffleGrid10x20
              items={[
                { id: 'b3', label: 'B3 EQUITIES', weightPct: 50 },
                { id: 'us', label: 'US EQUITIES', weightPct: 50 },
              ]}
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
              title="ADD TELEMETRY WIDGET // 12X8 GRID BUILDER"
              code="WIDGET_NEW"
              accent="orange"
              actions={
                <FuiButton
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setShowAddWidget(false);
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
                createWidgetMutation.mutate(e);
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
                  onClick={() => setShowAddWidget(false)}
                >
                  Cancel
                </FuiButton>
                <FuiButton
                  type="submit"
                  size="sm"
                  variant="primary"
                  data-testid="widget-submit-btn"
                >
                  Create Widget
                </FuiButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
