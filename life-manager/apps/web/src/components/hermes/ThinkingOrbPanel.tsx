import React, { useMemo, useState } from 'react';
import { GeodesicThinkingOrb, type ThinkingOrbQueryNode } from '@hermes/ui';
import { mentionSource, originLabel, type ToolCallView } from './hermesModel';
import type { TurnOrbState } from './useHermesChat';

export interface ThinkingOrbPanelProps {
  streaming: boolean;
  thinkingText: string;
  activeMentions: string[];
  activeSlashCommand: string | null;
  toolCalls: ToolCallView[];
  messageCount: number;
  sessionOrigin?: string;
  orbState?: TurnOrbState | null;
}

export interface SubPlanStage {
  index: number;
  code: string;
  title: string;
  source: 'vault' | 'mcp' | 'gateway';
  detail: string;
  locked: boolean;
  active: boolean;
}

export function ThinkingOrbPanel({
  streaming,
  thinkingText,
  activeMentions,
  activeSlashCommand,
  toolCalls,
  messageCount,
  sessionOrigin = 'hermes_view',
  orbState = null,
}: ThinkingOrbPanelProps): React.ReactElement {
  const [breakdownOpen, setBreakdownOpen] = useState(true);

  const activeQueries = useMemo<ThinkingOrbQueryNode[]>(() => {
    const queries: ThinkingOrbQueryNode[] = [];

    for (const mention of activeMentions) {
      const source = mentionSource(mention);
      queries.push({
        id: `mention-${mention.toLowerCase()}`,
        label: `${source.toUpperCase()} // ${mention.toUpperCase()}`,
        source,
      });
    }

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i]!;
      const isVaultTool = tc.toolName.startsWith('vault_');
      queries.push({
        id: `tool-${i}-${tc.toolName}`,
        label: `${isVaultTool ? 'VAULT' : 'MCP'} // ${tc.toolName.toUpperCase()}`,
        source: isVaultTool ? 'vault' : 'mcp',
      });
    }

    if (!queries.some((q) => q.source === 'vault')) {
      queries.push({
        id: 'vault-rag-index',
        label: 'VAULT // PGVECTOR_RAG_HYBRID',
        source: 'vault',
      });
    }
    if (!queries.some((q) => q.source === 'mcp')) {
      queries.push({
        id: 'mcp-life-ops',
        label: activeSlashCommand
          ? `MCP // ${activeSlashCommand.toUpperCase()}`
          : 'MCP // 7_DOMAIN_ROUTER',
        source: 'mcp',
      });
    }
    queries.push({
      id: 'gateway-synthesis',
      label: `GATEWAY // ${originLabel(sessionOrigin)}_SYNTHESIS`,
      source: 'gateway',
    });

    return queries;
  }, [activeMentions, activeSlashCommand, toolCalls, sessionOrigin]);

  const completedSteps = useMemo(() => {
    if (orbState && orbState.ringsLocked > 0) {
      return Math.min(3, Math.max(1, orbState.ringsLocked));
    }
    if (streaming) {
      let locked = 1;
      if (thinkingText.length > 0 || toolCalls.length > 0) locked = 2;
      return locked;
    }
    if (messageCount > 0 || toolCalls.length > 0 || thinkingText.length > 0) {
      return 3;
    }
    return 1;
  }, [orbState, streaming, thinkingText.length, toolCalls.length, messageCount]);

  const stages = useMemo<SubPlanStage[]>(
    () => [
      {
        index: 1,
        code: 'RING_01 // CONTEXT_RAG',
        title: 'Semantic Vault & Context Retrieval',
        source: 'vault',
        detail:
          activeMentions.length > 0
            ? `Scoped to ${activeMentions.join(', ')} + hybrid pgvector embeddings`
            : 'Hybrid pgvector + Second Brain Markdown index',
        locked: completedSteps >= 1,
        active: streaming && completedSteps === 1,
      },
      {
        index: 2,
        code: 'RING_02 // MCP_DISPATCH',
        title: 'Life Ops /mcp Tool & Autonomy Gate',
        source: 'mcp',
        detail:
          toolCalls.length > 0
            ? `${toolCalls.length} tool invocation(s): ${toolCalls.map((t) => t.toolName).join(', ')}`
            : activeSlashCommand
              ? `Directive ${activeSlashCommand} armed (READ / IMMEDIATE_UNDO / REQUIRE_APPROVAL)`
              : '3-tier autonomy gate armed across 7 Life Ops domains',
        locked: completedSteps >= 2,
        active: streaming && completedSteps === 2,
      },
      {
        index: 3,
        code: 'RING_03 // SYNTHESIS_LOCK',
        title: 'Multi-Step Plan Synthesis & Verification',
        source: 'gateway',
        detail: streaming
          ? 'Streaming reasoning & verified execution trace...'
          : completedSteps >= 3
            ? 'All 3 geodesic rings locked — plan verified'
            : 'Awaiting multi-step directive',
        locked: completedSteps >= 3,
        active: streaming && completedSteps >= 2,
      },
    ],
    [activeMentions, activeSlashCommand, completedSteps, streaming, toolCalls],
  );

  return (
    <section
      data-fui-orb="true"
      data-testid="hermes-thinking-orb-panel"
      data-rings-locked={String(completedSteps)}
      data-orb-streaming={streaming ? 'true' : 'false'}
      className="hermes-orb-panel border border-fui-border bg-fui-bg-panel p-3"
    >
      {/* Collapsible inspectable plan-breakdown header (04:33) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-fui-border pb-2">
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="border border-fui-orange bg-fui-bg-carbon px-1.5 py-0.5 text-fui-orange font-semibold">
            REF-08 // GEODESIC_ORB
          </span>
          <span className="text-fui-text-primary font-semibold uppercase tracking-wider">
            HIGH-LEVEL PLAN SYNTHESIS
          </span>
          <span
            data-testid="hermes-orb-lock-badge"
            className="border border-fui-border bg-fui-bg-carbon px-1.5 py-0.5 text-fui-cyan"
          >
            RINGS_LOCKED: {completedSteps}/3
          </span>
        </div>
        <button
          type="button"
          data-testid="hermes-plan-breakdown-toggle"
          aria-expanded={breakdownOpen}
          onClick={() => setBreakdownOpen((v) => !v)}
          className="border border-fui-border bg-fui-bg-elevated px-2.5 py-1 font-mono text-xs text-fui-text-primary hover:border-fui-cyan"
        >
          {breakdownOpen ? '[▾ HIDE PLAN BREAKDOWN]' : '[▸ INSPECT PLAN BREAKDOWN]'}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-12 items-center">
        <div className="lg:col-span-5 flex justify-center">
          <GeodesicThinkingOrb
            activeQueries={activeQueries}
            completedSteps={completedSteps}
            reasoningState={streaming ? 'thinking' : completedSteps >= 3 ? 'complete' : 'idle'}
            size={176}
          />
        </div>

        {breakdownOpen && (
          <div
            data-testid="hermes-plan-breakdown"
            className="lg:col-span-7 space-y-2 border border-fui-border bg-fui-bg-carbon p-2.5 font-mono text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-fui-border pb-1.5 text-fui-text-secondary">
              <span className="uppercase tracking-wider">SUB-PLAN RING TELEMETRY</span>
              <div className="flex items-center gap-2">
                <span className="text-fui-cyan">● VAULT_RAG</span>
                <span className="text-fui-orange">● MCP_TOOLS</span>
                <span className="text-fui-green">● GATEWAY_PLAN</span>
              </div>
            </div>

            <div className="space-y-1.5">
              {stages.map((stage) => {
                const badgeColor = stage.locked
                  ? 'border-fui-green text-fui-green'
                  : stage.active
                    ? 'border-fui-orange text-fui-orange'
                    : 'border-fui-border text-fui-text-muted';
                const statusLabel = stage.locked
                  ? 'LOCKED'
                  : stage.active
                    ? 'ILLUMINATED'
                    : 'STANDBY';
                return (
                  <div
                    key={stage.code}
                    data-testid={`hermes-plan-stage-${stage.index}`}
                    data-stage-locked={stage.locked ? 'true' : 'false'}
                    className="flex items-start justify-between gap-2 border border-fui-border bg-fui-bg-panel px-2.5 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-fui-cyan font-semibold">{stage.code}</span>
                        <span className="text-fui-text-primary">{stage.title}</span>
                      </div>
                      <div className="mt-0.5 truncate text-fui-text-secondary">{stage.detail}</div>
                    </div>
                    <span className={`shrink-0 border px-1.5 py-0.5 font-mono text-xs ${badgeColor}`}>
                      {statusLabel}
                    </span>
                  </div>
                );
              })}
            </div>

            {thinkingText.trim().length > 0 && (
              <div
                data-testid="hermes-orb-thinking-trace"
                className="border-t border-fui-border pt-1.5 text-fui-text-secondary"
              >
                <span className="text-fui-orange uppercase mr-1.5">[TRACE]</span>
                <span>{thinkingText}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
