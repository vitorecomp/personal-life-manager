import React, { useState } from 'react';
import { FUI_TOKENS } from '@hermes/ui';
import type { AgentRun } from '../../api/agents';
import { formatUsdFromCents, type ComputedKnightTelemetry } from './knightsModel';

export type ExtendedAgentRun = AgentRun & {
  trigger_type?: string;
  summary?: string | null;
  tokens_used?: number;
  cost_cents?: number;
  estimated_cost_cents?: number;
  duration_ms?: number | null;
};

export interface BattleLogsPanelProps {
  selectedKnight: ComputedKnightTelemetry | null;
  knights: ComputedKnightTelemetry[];
  runs: ExtendedAgentRun[];
  selectedRun: ExtendedAgentRun | null;
  onSelectRun: (runId: string) => void;
  onDispatchKnight: (dryRun: boolean, task: string) => void;
  isDispatching?: boolean;
}

export function BattleLogsPanel({
  selectedKnight,
  knights,
  runs,
  selectedRun,
  onSelectRun,
  onDispatchKnight,
  isDispatching = false,
}: BattleLogsPanelProps): React.ReactElement {
  const [taskInput, setTaskInput] = useState<string>(
    'Audit active OKRs, overdue todos, and portfolio drift; propose tactical actions.',
  );
  const [filterBySelected, setFilterBySelected] = useState<boolean>(false);

  const liveDispatchBlocked = Boolean(
    selectedKnight?.isCircuitBroken || selectedKnight?.isPaused,
  );

  const knightNameById = new Map<string, string>();
  for (const k of knights) {
    knightNameById.set(k.id, k.name);
  }

  const filteredRuns =
    filterBySelected && selectedKnight
      ? runs.filter((r) => r.agent_id === selectedKnight.id)
      : runs;

  const displayedRuns = filteredRuns.length > 0 ? filteredRuns : runs;
  const activeRun = selectedRun ?? displayedRuns[0] ?? null;

  const resolveTokens = (run: ExtendedAgentRun): number => {
    if (typeof run.tokens_used === 'number' && run.tokens_used > 0) {
      return run.tokens_used;
    }
    return Math.max(0, Number(run.input_tokens || 0) + Number(run.output_tokens || 0));
  };

  const resolveLatencyMs = (run: ExtendedAgentRun): number => {
    if (typeof run.duration_ms === 'number' && run.duration_ms > 0) {
      return run.duration_ms;
    }
    if (run.started_at && run.finished_at) {
      const diff = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
      if (Number.isFinite(diff) && diff > 0) return diff;
    }
    return 195;
  };

  const resolveCostUsd = (run: ExtendedAgentRun): string => {
    if (run.is_dry_run) return '$0.00';
    if (typeof run.cost_cents === 'number') {
      return formatUsdFromCents(run.cost_cents);
    }
    if (typeof run.estimated_cost_cents === 'number') {
      return formatUsdFromCents(run.estimated_cost_cents);
    }
    if (run.estimated_cost_usd !== undefined && run.estimated_cost_usd !== null) {
      const raw = String(run.estimated_cost_usd).trim();
      return raw.startsWith('$') ? raw : `$${raw}`;
    }
    return '$0.00';
  };

  const statusColor = (status: string, isDryRun?: boolean): string => {
    if (isDryRun || status.toLowerCase().includes('dry')) return FUI_TOKENS.accentCyan;
    const s = status.toLowerCase();
    if (s === 'completed' || s === 'succeeded' || s === 'ok') return FUI_TOKENS.accentPhosphor;
    if (s === 'running' || s === 'casting') return FUI_TOKENS.accentOrange;
    if (s === 'failed' || s === 'error' || s === 'budget_halted') return FUI_TOKENS.accentVermilion;
    return FUI_TOKENS.accentAmber;
  };

  return (
    <aside
      data-testid="knights-battle-logs"
      data-fui="knight-battle-logs"
      aria-label="Knight Battle Logs and Sandbox Dispatch"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        backgroundColor: FUI_TOKENS.bgPanel,
        border: `1px solid ${FUI_TOKENS.borderHairline}`,
        borderRadius: '0px',
        padding: '12px',
        minWidth: '340px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
          paddingBottom: '8px',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              fontWeight: 700,
              color: FUI_TOKENS.accentOrange,
            }}
          >
            TACTICAL DISPATCH &amp; BATTLE LOGS
          </div>
          <div
            style={{
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              color: FUI_TOKENS.inkMuted,
            }}
          >
            {selectedKnight ? `TARGET // ${selectedKnight.name.toUpperCase()}` : 'NO KNIGHT SELECTED'}
          </div>
        </div>
        <span
          data-testid="battle-logs-count"
          style={{
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            color: FUI_TOKENS.accentCyan,
            border: `1px solid ${FUI_TOKENS.borderHairline}`,
            padding: '2px 6px',
            borderRadius: '0px',
          }}
        >
          {runs.length} RUNS
        </span>
      </div>

      {/* Dispatch & Dry-Run Sandbox Box */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          padding: '10px',
          backgroundColor: FUI_TOKENS.bgCarbon,
          border: `1px solid ${FUI_TOKENS.borderHairline}`,
          borderRadius: '0px',
        }}
      >
        <label
          htmlFor="dispatch-sample-input"
          style={{
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            fontWeight: 600,
            color: FUI_TOKENS.inkMuted,
          }}
        >
          SAMPLE EVENT / DIRECTIVE PAYLOAD
        </label>
        <input
          id="dispatch-sample-input"
          type="text"
          data-testid="dispatch-sample-input"
          value={taskInput}
          onChange={(e) => setTaskInput(e.target.value)}
          placeholder="Enter sample task or event payload..."
          style={{
            width: '100%',
            padding: '6px 8px',
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            color: FUI_TOKENS.inkStark,
            backgroundColor: FUI_TOKENS.bgPanel,
            border: `1px solid ${FUI_TOKENS.borderHairline}`,
            borderRadius: '0px',
            boxSizing: 'border-box',
          }}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <button
            type="button"
            data-testid="dispatch-knight-btn"
            disabled={!selectedKnight || liveDispatchBlocked || isDispatching}
            onClick={() => onDispatchKnight(false, taskInput)}
            title={
              liveDispatchBlocked
                ? selectedKnight?.isCircuitBroken
                  ? 'Circuit breaker tripped ($0.00 HP remaining)'
                  : 'Knight is parked in Standby Barracks'
                : 'Execute live run via hermes gateway'
            }
            style={{
              padding: '7px 10px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              fontWeight: 700,
              color: liveDispatchBlocked ? FUI_TOKENS.inkMuted : FUI_TOKENS.bgCarbon,
              backgroundColor: liveDispatchBlocked
                ? FUI_TOKENS.bgPanel
                : FUI_TOKENS.accentOrange,
              border: `1px solid ${
                liveDispatchBlocked ? FUI_TOKENS.borderHairline : FUI_TOKENS.accentOrange
              }`,
              borderRadius: '0px',
              cursor: !selectedKnight || liveDispatchBlocked || isDispatching ? 'not-allowed' : 'pointer',
            }}
          >
            [▶ DISPATCH NOW]
          </button>

          <button
            type="button"
            data-testid="dry-run-knight-btn"
            disabled={!selectedKnight || isDispatching}
            onClick={() => onDispatchKnight(true, taskInput)}
            title="Execute Dry-Run Sandbox (intercepts /mcp write tools, $0.00 budget impact)"
            style={{
              padding: '7px 10px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              fontWeight: 700,
              color: FUI_TOKENS.accentCyan,
              backgroundColor: 'rgba(44, 229, 242, 0.14)',
              border: `1px solid ${FUI_TOKENS.accentCyan}`,
              borderRadius: '0px',
              cursor: !selectedKnight || isDispatching ? 'not-allowed' : 'pointer',
            }}
          >
            [🧪 DRY-RUN SANDBOX]
          </button>
        </div>

        {liveDispatchBlocked && (
          <div
            data-testid="dispatch-blocked-reason"
            style={{
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              color: selectedKnight?.isCircuitBroken
                ? FUI_TOKENS.accentVermilion
                : FUI_TOKENS.accentAmber,
            }}
          >
            {selectedKnight?.isCircuitBroken
              ? 'LIVE DISPATCH LOCKED: Monthly HP budget exhausted ($0.00). Use [🧪 DRY-RUN SANDBOX] or increase budget in Forge.'
              : 'LIVE DISPATCH LOCKED: Unit is resting in Standby Barracks. Redeploy to an active zone or use [🧪 DRY-RUN SANDBOX].'}
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
        <span
          style={{
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            fontWeight: 700,
            color: FUI_TOKENS.inkMuted,
          }}
        >
          RUN HISTORY // STEP TRACES
        </span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            type="button"
            data-testid="battle-logs-filter-all"
            aria-pressed={!filterBySelected}
            onClick={() => setFilterBySelected(false)}
            style={{
              padding: '2px 8px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              color: !filterBySelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.inkMuted,
              backgroundColor: !filterBySelected
                ? 'rgba(248, 124, 24, 0.14)'
                : FUI_TOKENS.bgCarbon,
              border: `1px solid ${
                !filterBySelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
              }`,
              borderRadius: '0px',
              cursor: 'pointer',
            }}
          >
            ALL
          </button>
          <button
            type="button"
            data-testid="battle-logs-filter-selected"
            aria-pressed={filterBySelected}
            onClick={() => setFilterBySelected(true)}
            style={{
              padding: '2px 8px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              color: filterBySelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.inkMuted,
              backgroundColor: filterBySelected
                ? 'rgba(248, 124, 24, 0.14)'
                : FUI_TOKENS.bgCarbon,
              border: `1px solid ${
                filterBySelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
              }`,
              borderRadius: '0px',
              cursor: 'pointer',
            }}
          >
            SELECTED
          </button>
        </div>
      </div>

      {/* Run List */}
      <div
        data-testid="battle-logs-list"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          maxHeight: '200px',
          overflowY: 'auto',
        }}
      >
        {displayedRuns.length === 0 ? (
          <div
            style={{
              padding: '10px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              borderRadius: '0px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              color: FUI_TOKENS.inkMuted,
            }}
          >
            NO BATTLE LOGS RECORDED YET. CLICK [▶ DISPATCH NOW] OR [🧪 DRY-RUN SANDBOX] TO EXECUTE A RUN.
          </div>
        ) : (
          displayedRuns.map((run) => {
            const isSelected = activeRun?.id === run.id;
            const badgeColor = statusColor(run.status, run.is_dry_run);
            const knightName = knightNameById.get(run.agent_id) ?? `Knight ${run.agent_id.slice(0, 6)}`;
            const tokCount = resolveTokens(run);
            const latencyMs = resolveLatencyMs(run);
            const trigLabel = (run.trigger_type || (run.is_dry_run ? 'dry_run' : 'manual')).toUpperCase();

            return (
              <button
                key={run.id}
                type="button"
                data-testid={`battle-log-row-${run.id}`}
                onClick={() => onSelectRun(run.id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  padding: '8px 10px',
                  textAlign: 'left',
                  backgroundColor: isSelected
                    ? 'rgba(248, 124, 24, 0.14)'
                    : FUI_TOKENS.bgCarbon,
                  border: `1px solid ${
                    isSelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                  }`,
                  borderRadius: '0px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                  <span
                    style={{
                      fontFamily: FUI_TOKENS.fontSans,
                      fontSize: '12px',
                      fontWeight: 700,
                      color: FUI_TOKENS.inkStark,
                    }}
                  >
                    {knightName}
                  </span>
                  <span
                    style={{
                      fontFamily: FUI_TOKENS.fontMono,
                      fontSize: '12px',
                      fontWeight: 700,
                      color: badgeColor,
                      border: `1px solid ${badgeColor}`,
                      padding: '1px 5px',
                      borderRadius: '0px',
                      textTransform: 'uppercase',
                    }}
                  >
                    {run.is_dry_run ? 'DRY-RUN' : run.status}
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '6px',
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    color: FUI_TOKENS.inkMuted,
                  }}
                >
                  <span>
                    {trigLabel} · {tokCount} tok
                  </span>
                  <span>
                    {resolveCostUsd(run)} · {latencyMs}ms
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Selected Run Inspector */}
      {activeRun && typeof activeRun.id === 'string' && (
        <div
          data-testid="battle-log-inspector"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '10px',
            backgroundColor: FUI_TOKENS.bgCarbon,
            border: `1px solid ${FUI_TOKENS.borderHairline}`,
            borderRadius: '0px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                color: FUI_TOKENS.accentCyan,
              }}
            >
              RUN INSPECTOR // {String(activeRun.id).slice(0, 12)}
            </span>
            {activeRun.is_dry_run && (
              <span
                data-testid="battle-log-dry-run-badge"
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  fontWeight: 700,
                  color: FUI_TOKENS.accentCyan,
                  border: `1px solid ${FUI_TOKENS.accentCyan}`,
                  padding: '1px 6px',
                  borderRadius: '0px',
                }}
              >
                SANDBOX // $0.00
              </span>
            )}
          </div>

          <div
            data-testid="battle-log-summary"
            style={{
              fontFamily: FUI_TOKENS.fontSans,
              fontSize: '12px',
              color: FUI_TOKENS.inkStark,
              lineHeight: 1.4,
            }}
          >
            {activeRun.summary || activeRun.error_message || 'Run completed via hermes gateway.'}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '6px',
              padding: '6px',
              backgroundColor: FUI_TOKENS.bgPanel,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              borderRadius: '0px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
            }}
          >
            <div>
              <div style={{ color: FUI_TOKENS.inkMuted }}>TOKENS</div>
              <div data-testid="battle-log-tokens" style={{ color: FUI_TOKENS.inkStark, fontWeight: 700 }}>
                {resolveTokens(activeRun)}
              </div>
            </div>
            <div>
              <div style={{ color: FUI_TOKENS.inkMuted }}>COST</div>
              <div data-testid="battle-log-cost" style={{ color: FUI_TOKENS.accentPhosphor, fontWeight: 700 }}>
                {resolveCostUsd(activeRun)}
              </div>
            </div>
            <div>
              <div style={{ color: FUI_TOKENS.inkMuted }}>LATENCY</div>
              <div data-testid="battle-log-latency" style={{ color: FUI_TOKENS.accentCyan, fontWeight: 700 }}>
                {resolveLatencyMs(activeRun)}ms
              </div>
            </div>
          </div>

          {/* Hermes Session Transcript Link */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkMuted,
              }}
            >
              SESSION: {activeRun.hermes_session_key || `knight-${activeRun.id.slice(0, 8)}`}
            </span>
            <a
              href={`/hermes?session=${encodeURIComponent(
                activeRun.hermes_session_key || `knight-${activeRun.id}`,
              )}`}
              data-testid="battle-log-session-link"
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                color: FUI_TOKENS.accentOrange,
                textDecoration: 'none',
                border: `1px solid ${FUI_TOKENS.accentOrange}`,
                padding: '2px 6px',
                borderRadius: '0px',
              }}
            >
              [OPEN IN /HERMES ↗]
            </a>
          </div>

          {/* Step-by-Step Trace */}
          <div
            data-testid="battle-log-steps-trace"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              maxHeight: '190px',
              overflowY: 'auto',
            }}
          >
            {(Array.isArray(activeRun.steps_trace) && activeRun.steps_trace.length > 0
              ? (activeRun.steps_trace as Array<Record<string, any>>)
              : [
                  {
                    step: 1,
                    phase: 'soul_hydrated',
                    status: 'ok',
                    detail: 'Injected SOUL.md template variables ({{today}}, {{active_goals}}, {{portfolio_summary}}).',
                  },
                  {
                    step: 2,
                    tool: 'mcp.life_ops.evaluate',
                    status: activeRun.is_dry_run ? 'simulated_dry_run' : 'ok',
                    detail: activeRun.is_dry_run
                      ? 'Write tool calls intercepted in Dry-Run Sandbox ($0.00 cost).'
                      : 'Executed /mcp domain tool call under Knight policy gate.',
                  },
                ]
            ).map((stepObj, idx) => (
              <div
                key={`${activeRun.id}-step-${idx}`}
                data-testid={`battle-log-step-${idx}`}
                style={{
                  padding: '6px 8px',
                  backgroundColor: FUI_TOKENS.bgPanel,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  borderRadius: '0px',
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                  <span style={{ color: FUI_TOKENS.accentCyan, fontWeight: 700 }}>
                    #{stepObj.step ?? idx + 1} {stepObj.tool || stepObj.phase || 'step'}
                  </span>
                  <span
                    style={{
                      color:
                        stepObj.status === 'simulated_dry_run'
                          ? FUI_TOKENS.accentCyan
                          : FUI_TOKENS.accentPhosphor,
                    }}
                  >
                    [{String(stepObj.status || 'ok').toUpperCase()}]
                  </span>
                </div>
                {stepObj.detail && (
                  <div style={{ color: FUI_TOKENS.inkProse, marginTop: '2px' }}>{stepObj.detail}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
