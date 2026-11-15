import React from 'react';
import { FUI_TOKENS, MicroAnimIcon } from '@hermes/ui';
import type { AgentRun, TurnOrderQueueItem } from '@hermes/api-client';
import { buildTurnOrderChain, type ComputedKnightTelemetry } from './knightsModel';

export interface TurnOrderBarProps {
  knights: ComputedKnightTelemetry[];
  queueItems: TurnOrderQueueItem[];
  recentRuns: AgentRun[];
  selectedKnightId: string | null;
  castingKnightId: string | null;
  onSelectKnight: (knightId: string) => void;
  onSelectRun: (runId: string) => void;
}

export function TurnOrderBar({
  knights,
  queueItems,
  recentRuns,
  selectedKnightId,
  castingKnightId,
  onSelectKnight,
  onSelectRun,
}: TurnOrderBarProps) {
  const { recentNodes, activeKnight, upcomingNodes } = buildTurnOrderChain({
    knights,
    queueItems,
    recentRuns,
    activeKnightId: selectedKnightId,
    castingKnightId,
  });

  return (
    <section
      aria-label="Tokio Scheduler & Event Queue Turn-Order Timeline"
      data-testid="knights-turn-order"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '10px 12px',
        backgroundColor: FUI_TOKENS.bgPanel,
        border: `1px solid ${FUI_TOKENS.borderHairline}`,
        borderTop: `2px solid ${FUI_TOKENS.accentOrange}`,
        borderRadius: '0px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
          borderRadius: '0px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '0px' }}>
          <span
            style={{
              padding: '2px 6px',
              backgroundColor: FUI_TOKENS.accentOrange,
              color: FUI_TOKENS.bgCarbon,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              fontWeight: 700,
              borderRadius: '0px',
            }}
          >
            INITIATIVE // QUEUE
          </span>
          <span
            style={{
              fontFamily: FUI_TOKENS.fontDisplay,
              fontSize: '14px',
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: FUI_TOKENS.inkStark,
              textTransform: 'uppercase',
            }}
          >
            TOKIO SCHEDULER &amp; EVENT TIMELINE (RECENT RUNS → [ACTIVE] KNIGHT → UPCOMING CRON / HOOKS)
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            color: FUI_TOKENS.inkMuted,
          }}
        >
          <MicroAnimIcon variant="TIME" size={16} />
          <span>
            RECENT:{recentNodes.length} // UPCOMING:{upcomingNodes.length}
          </span>
        </div>
      </div>

      {/* Horizontal Turn-Order Portrait Chain */}
      <div
        data-testid="agents-turn-order-queue"
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: '6px',
          overflowX: 'auto',
          paddingBottom: '2px',
          borderRadius: '0px',
        }}
      >
        {/* Stage 1: Recent Runs */}
        <div
          data-testid="turn-order-recent-runs"
          style={{
            display: 'flex',
            alignItems: 'stretch',
            gap: '6px',
            borderRadius: '0px',
          }}
        >
          {recentNodes.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                padding: '6px 10px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkMuted,
                borderRadius: '0px',
              }}
            >
              <span>RECENT_RUNS // NONE</span>
              <span>Awaiting first dispatch</span>
            </div>
          ) : (
            recentNodes.map((node) => (
              <button
                key={node.id}
                type="button"
                data-testid={`turn-order-recent-${node.id}`}
                onClick={() => onSelectRun(node.id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '2px',
                  padding: '6px 10px',
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  borderLeft: `3px solid ${node.crestColor}`,
                  color: FUI_TOKENS.inkStark,
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  minWidth: '148px',
                  borderRadius: '0px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    gap: '6px',
                  }}
                >
                  <span style={{ color: FUI_TOKENS.inkMuted, fontSize: '12px' }}>
                    {node.isDryRun ? '[DRY_RUN]' : '[RECENT]'}
                  </span>
                  <span
                    style={{
                      color:
                        node.status === 'succeeded'
                          ? FUI_TOKENS.accentPhosphor
                          : node.status === 'failed'
                            ? FUI_TOKENS.accentVermilion
                            : FUI_TOKENS.accentCyan,
                      fontWeight: 700,
                      fontSize: '12px',
                      textTransform: 'uppercase',
                    }}
                  >
                    {node.status}
                  </span>
                </div>
                <span style={{ fontWeight: 700, fontSize: '12px' }}>{node.knightName}</span>
                <span style={{ color: FUI_TOKENS.inkMuted, fontSize: '12px' }}>
                  {node.tokens} tok · ${node.costUsd}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Stepped Zig-Zag Connector */}
        <div
          aria-hidden="true"
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0 2px',
          }}
        >
          <svg width="28" height="24" viewBox="0 0 28 24" style={{ borderRadius: '0px' }}>
            <polyline
              points="0,16 10,16 16,8 28,8"
              fill="none"
              stroke={FUI_TOKENS.accentOrange}
              strokeWidth="1.5"
            />
            <polygon points="24,5 28,8 24,11" fill={FUI_TOKENS.accentOrange} />
          </svg>
        </div>

        {/* Stage 2: [ACTIVE] Knight Portrait Slot */}
        {activeKnight && (
          <button
            type="button"
            data-testid="turn-order-active-knight"
            onClick={() => onSelectKnight(activeKnight.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: '2px',
              padding: '6px 12px',
              backgroundColor: '#1B140E',
              border: `1px solid ${FUI_TOKENS.accentOrange}`,
              borderLeft: `4px solid ${FUI_TOKENS.accentOrange}`,
              color: FUI_TOKENS.inkStark,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              cursor: 'pointer',
              textAlign: 'left',
              minWidth: '185px',
              borderRadius: '0px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                gap: '6px',
              }}
            >
              <span
                style={{
                  padding: '0 4px',
                  backgroundColor: FUI_TOKENS.accentOrange,
                  color: FUI_TOKENS.bgCarbon,
                  fontWeight: 700,
                  fontSize: '12px',
                  borderRadius: '0px',
                }}
              >
                ▼ [ACTIVE]
              </span>
              <span style={{ color: FUI_TOKENS.accentCyan, fontSize: '12px' }}>
                {castingKnightId &&
                (castingKnightId === activeKnight.id || castingKnightId === activeKnight.slug)
                  ? 'CASTING_SSE'
                  : activeKnight.archetype.toUpperCase()}
              </span>
            </div>
            <span style={{ fontWeight: 700, fontSize: '13px', color: FUI_TOKENS.inkStark }}>
              {activeKnight.name}
            </span>
            <span style={{ color: FUI_TOKENS.accentCream, fontSize: '12px' }}>
              HP {activeKnight.hpLabel} · EP {activeKnight.epLabel}
            </span>
          </button>
        )}

        {/* Stepped Zig-Zag Connector */}
        <div
          aria-hidden="true"
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '0 2px',
          }}
        >
          <svg width="28" height="24" viewBox="0 0 28 24" style={{ borderRadius: '0px' }}>
            <polyline
              points="0,8 10,8 16,16 28,16"
              fill="none"
              stroke={FUI_TOKENS.accentCyan}
              strokeWidth="1.5"
            />
            <polygon points="24,13 28,16 24,19" fill={FUI_TOKENS.accentCyan} />
          </svg>
        </div>

        {/* Stage 3: Upcoming Scheduled Cron & Event Runs */}
        <div
          data-testid="turn-order-upcoming-queue"
          style={{
            display: 'flex',
            alignItems: 'stretch',
            gap: '6px',
            borderRadius: '0px',
          }}
        >
          {upcomingNodes.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                padding: '6px 10px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkMuted,
                borderRadius: '0px',
              }}
            >
              <span>UPCOMING_QUEUE // STANDBY</span>
              <span>No active triggers scheduled</span>
            </div>
          ) : (
            upcomingNodes.map((item, idx) => (
              <button
                key={`${item.id}-${idx}`}
                type="button"
                data-testid={`turn-order-upcoming-${idx}`}
                onClick={() => onSelectKnight(item.agentId)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '2px',
                  padding: '6px 10px',
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  borderLeft: `3px solid ${item.crestColor}`,
                  color: FUI_TOKENS.inkStark,
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  minWidth: '160px',
                  borderRadius: '0px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    gap: '6px',
                  }}
                >
                  <span style={{ color: FUI_TOKENS.accentCyan, fontWeight: 700, fontSize: '12px' }}>
                    NEXT_{String(idx + 1).padStart(2, '0')}
                  </span>
                  <span
                    style={{
                      color: FUI_TOKENS.inkMuted,
                      textTransform: 'uppercase',
                      fontSize: '12px',
                    }}
                  >
                    {item.triggerType}
                  </span>
                </div>
                <span style={{ fontWeight: 700, fontSize: '12px' }}>{item.knightName}</span>
                <span
                  style={{
                    color: FUI_TOKENS.inkProse,
                    fontSize: '12px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '180px',
                  }}
                >
                  {item.label}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
