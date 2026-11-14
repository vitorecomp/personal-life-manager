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
  PrivacyValue,
  WaffleGrid10x20,
  WaveformSparkline,
  type WaffleSliceInput,
} from '@hermes/ui';
import {
  apiDelete,
  apiPost,
  type DashboardWidgetRecord,
  type LifeScoreResponse,
  type PendingApprovalRecord,
  type ServerNodeRecord,
  type ServerSummaryResponse,
} from '../../api/client';

export interface WidgetRendererProps {
  deckId: string;
  widget: DashboardWidgetRecord;
  lifeScore?: LifeScoreResponse | null;
  servers?: ServerNodeRecord[];
  serverSummary?: ServerSummaryResponse | null;
  pendingApprovals?: PendingApprovalRecord[];
  kioskMode?: boolean;
}

const DEFAULT_WAFFLE_SLICES: WaffleSliceInput[] = [
  { id: 'br-eq', label: 'B3 EQUITIES', weightPct: 35, targetWeightPct: 35 },
  { id: 'us-eq', label: 'US / GLOBAL ETF', weightPct: 35, targetWeightPct: 35 },
  { id: 'fixed', label: 'FIXED INCOME BRL', weightPct: 20, targetWeightPct: 20 },
  { id: 'crypto', label: 'CRYPTO CORE', weightPct: 10, targetWeightPct: 10 },
];

export function WidgetRenderer({
  deckId,
  widget,
  lifeScore,
  servers = [],
  serverSummary,
  pendingApprovals = [],
  kioskMode = false,
}: WidgetRendererProps) {
  const queryClient = useQueryClient();
  const [newSrvName, setNewSrvName] = useState('');
  const [newSrvHost, setNewSrvHost] = useState('127.0.0.1');
  const [newSrvPort, setNewSrvPort] = useState('8080');
  const [showAddServer, setShowAddServer] = useState(false);

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
    mutationFn: async () =>
      apiDelete(
        `/api/dashboards/${encodeURIComponent(deckId)}/widgets/${encodeURIComponent(widget.id)}`,
      ),
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
        focus: 72,
        routines: 80,
        goals: 68,
        learning: 75,
        wealth: 70,
      };
      const composite = Number(
        payload?.composite_score ?? payload?.score ?? lifeScore?.composite_score ?? 73,
      );
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
              size={180}
              compositeScore={composite}
              pillars={[
                { key: 'focus', label: 'FOCUS', score: Number(p.focus ?? 70) },
                { key: 'routines', label: 'ROUTINES', score: Number(p.routines ?? 75) },
                { key: 'goals', label: 'GOALS', score: Number(p.goals ?? 68) },
                { key: 'learning', label: 'LEARNING', score: Number(p.learning ?? 74) },
                {
                  key: 'wealth_fi',
                  label: 'WEALTH_FI',
                  score: Number(p.wealth ?? p.wealth_fi ?? 70),
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
      builtinKey.includes('todo')
    ) {
      const done = Number(payload?.completed_tasks ?? 4);
      const total = Math.max(1, Number(payload?.total_tasks ?? 6));
      const pct = Math.round((done / total) * 100);
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
          <FocusBarcode24h title="24H_FOCUS_BARCODE" totalMinutesLabel="210M LOGGED" />
        </div>
      );
    }

    // 3. Routines Matrix & Bio Consistency
    if (builtinKey.includes('routine') || builtinKey.includes('habit')) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRadius: '0px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <FuiBadge tone="phosphor">PROFILE // WORKDAY</FuiBadge>
            <PrivacyValue kind="percent" value="88.5%" />
          </div>
          <BinaryDotMatrix8x12 adherencePct={88.5} streakCount={12} />
          <div data-fui-ring="true" style={{ borderRadius: '0px' }}>
            <WaveformSparkline
              data={[72, 76, 80, 78, 85, 88, 91, 89]}
              title="BIO_CONSISTENCY_7D"
              height={56}
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
      const totalBrlCents = Number(payload?.total_brl_cents ?? 14250000);
      const brlFormatted = `R$ ${(totalBrlCents / 100).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
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
            <div>
              FI PROGRESS: <PrivacyValue kind="percent" value="64.2%" />
            </div>
            <div>
              TIME TO FI: <PrivacyValue kind="duration" value="7Y 4M" />
            </div>
          </div>
          {builtinKey.includes('fire_gauge') ? (
            <div data-fui-ring="true" style={{ display: 'flex', justifyContent: 'center' }}>
              <HatchedDonutGauge
                solidPct={64.2}
                hatchedPct={15.8}
                centerLabel="64.2%"
                durationLabel="7Y 4M"
                size={148}
              />
            </div>
          ) : (
            <WaffleGrid10x20 items={DEFAULT_WAFFLE_SLICES} totalValueCents={totalBrlCents} />
          )}
        </div>
      );
    }

    // 5. Yearly Goals / OKRs
    if (builtinKey.includes('goal') || builtinKey.includes('okr')) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRadius: '0px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <FuiBadge tone="vermilion">NORTH_STAR // Q1-Q4 BLUEPRINT</FuiBadge>
            <PrivacyValue kind="percent" value="74.0%" />
          </div>
          <div style={{ fontSize: '12px', color: FUI_TOKENS.inkProse }}>
            ACTIVE GOALS: {Number(payload?.active_goals ?? 4)} | PACE: ON_TRACK
          </div>
          <FuiBatteryCapsule progressPct={74} segments={4} />
        </div>
      );
    }

    // 6. Courses & Spaced Reviews
    if (builtinKey.includes('course')) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRadius: '0px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <FuiBadge tone="cyan">ACTIVE COURSES: {Number(payload?.active_courses ?? 3)}</FuiBadge>
            <FuiBadge tone="amber">SPACED REVIEWS DUE: 2</FuiBadge>
          </div>
          <FuiBatteryCapsule progressPct={68} segments={4} />
        </div>
      );
    }

    // 7. Server Infrastructure Prober
    if (builtinKey.includes('server') || builtinKey.includes('infra')) {
      const mergedServers: ServerNodeRecord[] =
        servers.length > 0
          ? servers
          : Array.isArray(payload?.servers)
            ? payload.servers
            : [];
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
                        height={44}
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
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            borderRadius: '0px',
          }}
        >
          <div>
            <FuiBadge tone="orange">
              ACTIVE KNIGHTS: {Number(payload?.enabled_knights ?? 4)}
            </FuiBadge>
            <div style={{ marginTop: '6px', fontSize: '12px', color: FUI_TOKENS.inkMuted }}>
              PENDING MCP APPROVALS: {Number(payload?.pending_approvals ?? pendingApprovals.length)}
            </div>
          </div>
          <IsometricKnightSprite
            archetype="paladin"
            state="idle"
            scale={2}
            name="Paladin"
            hpPct={92}
            epPct={78}
          />
        </div>
      );
    }

    // 9. Second Brain Constellation
    return (
      <div data-fui-ring="true" style={{ display: 'flex', justifyContent: 'center' }}>
        <ConstellationMesh size={180} title="SECOND_BRAIN // CONSTELLATION" />
      </div>
    );
  };

  const renderCustomBody = () => {
    // 1. Command widget (with Tier-3 MCP Approval Guard)
    if (widget.source_kind === 'command') {
      const matchingApproval = pendingApprovals.find(
        (a) =>
          a.status === 'pending' &&
          (String(a.tool_name).includes('command_widget') ||
            JSON.stringify(a.payload_json || {}).includes(widget.title)),
      );
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
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <FuiBadge tone={timedOut ? 'vermilion' : 'phosphor'}>
              {timedOut ? 'TIMEOUT' : `EXIT:${payload?.exit_code ?? 0}`}
            </FuiBadge>
          </div>
          <pre
            data-testid="widget-command-stdout"
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
            }}
          >
            {stdout}
          </pre>
        </div>
      );
    }

    // 2. HTTP widget
    if (widget.source_kind === 'http') {
      const status = Number(payload?.status ?? 200);
      const isDegraded = status >= 400 || Boolean(payload?.error);
      const extracted =
        payload?.extracted !== undefined && payload?.extracted !== null
          ? payload.extracted
          : payload?.raw ?? payload?.body ?? payload?.data ?? payload;

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <FuiBadge tone={isDegraded ? 'amber' : 'cyan'}>
              {isDegraded ? `DEGRADED // HTTP ${status || 'ERR'}` : `HTTP ${status}`}
            </FuiBadge>
          </div>
          <div
            data-testid="widget-http-value"
            style={{
              padding: '8px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '14px',
              fontWeight: 700,
              color: isDegraded ? FUI_TOKENS.accentAmber : FUI_TOKENS.inkStark,
            }}
          >
            {typeof extracted === 'object' ? JSON.stringify(extracted) : String(extracted ?? '')}
          </div>
        </div>
      );
    }

    // 3. SQL widget
    if (widget.source_kind === 'sql') {
      const rows: Array<Record<string, any>> = Array.isArray(payload?.rows)
        ? payload.rows
        : Array.isArray(payload?.data?.rows)
          ? payload.data.rows
          : [];
      const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];

      return (
        <div style={{ overflowX: 'auto', fontSize: '12px' }}>
          {rows.length > 0 ? (
            <table
              data-testid="widget-sql-table"
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
        <FuiBadge tone="cyan">
          HERMES // {String(payload?.gateway_mode || 'OFFLINE_MOCK').toUpperCase()}
        </FuiBadge>
        <div
          data-testid="widget-hermes-response"
          style={{
            padding: '8px',
            backgroundColor: FUI_TOKENS.bgCarbon,
            border: `1px solid ${FUI_TOKENS.borderHairline}`,
            color: FUI_TOKENS.inkProse,
          }}
        >
          {hermesText}
        </div>
      </div>
    );
  };

  return (
    <article
      data-testid={`widget-card-${widget.id}`}
      data-widget-id={widget.id}
      data-source-kind={widget.source_kind}
      style={{
        gridColumn: `span ${Math.min(12, Math.max(1, rect.w || 4))}`,
        gridRow: `span ${Math.min(8, Math.max(1, rect.h || 3))}`,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: FUI_TOKENS.bgPanel,
        border: `1px solid ${FUI_TOKENS.borderHairline}`,
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
            <div style={{ display: 'flex', gap: '4px' }}>
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
                data-testid={`delete-widget-${widget.id}`}
                onClick={() => deleteMutation.mutate()}
              >
                ✕
              </FuiButton>
            </div>
          ) : undefined
        }
      />

      <div style={{ flex: 1, padding: '10px', borderRadius: '0px' }}>
        {widget.source_kind === 'builtin' ? renderBuiltinBody() : renderCustomBody()}
      </div>
    </article>
  );
}
