import React from 'react';
import { MicroAnimIcon } from '@hermes/ui';
import type { McpUndoActionDto, PendingMcpApprovalDto } from '../../api/hermes';
import { HermesMarkdown } from './markdown/HermesMarkdown';
import { McpApprovalCard, McpUndoCard } from './McpCards';
import {
  humanizeToolName,
  summarizePayload,
  type HermesMessageView,
  type ToolCallView,
} from './hermesModel';

export interface TranscriptProps {
  messages: HermesMessageView[];
  streaming: boolean;
  pendingUserText: string | null;
  thinkingText: string;
  replyText: string;
  liveToolCalls: ToolCallView[];
  errorText: string | null;
  undoEntries: Array<McpUndoActionDto & { undone?: boolean }>;
  approvals: PendingMcpApprovalDto[];
  busyUndoId: string | null;
  undoErrors: Record<string, string>;
  undoNotes: Record<string, string>;
  busyApprovalId: string | null;
  approvalErrors: Record<string, string>;
  onUndo: (undoId: string) => void | Promise<void>;
  onApprove: (
    approvalId: string,
    payloadOverride?: unknown,
  ) => void | Promise<void>;
  onReject: (approvalId: string) => void | Promise<void>;
  onForkFromTurn: (turnIndex: number) => void | Promise<void>;
  onSelectCitation: (notePath: string) => void;
}

function ToolCallBadge({ tc }: { tc: ToolCallView }): React.ReactElement {
  const headline = humanizeToolName(tc.toolName);
  const tierColor =
    tc.autonomyTier === 'REQUIRE_APPROVAL'
      ? 'border-fui-orange text-fui-orange'
      : tc.autonomyTier === 'IMMEDIATE_UNDO'
        ? 'border-fui-green text-fui-green'
        : 'border-fui-cyan text-fui-cyan';

  return (
    <div
      data-testid="hermes-tool-call-card"
      data-tool-name={tc.toolName}
      data-tool-tier={tc.autonomyTier}
      className="border border-fui-border bg-fui-bg-carbon p-2.5 font-mono text-xs space-y-1"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`border px-1.5 py-0.5 font-semibold ${tierColor}`}>
            /MCP // {tc.autonomyTier}
          </span>
          <span className="font-semibold text-fui-text-primary">
            {headline.domain} // {headline.action}
          </span>
          <span className="text-fui-text-muted">({tc.toolName})</span>
        </div>
        <span className="text-fui-cyan uppercase">{tc.status}</span>
      </div>
      <div className="text-fui-text-secondary">
        <span className="text-fui-text-muted mr-1">ARGS:</span>
        {summarizePayload(tc.arguments)}
      </div>
      {tc.result !== undefined && (
        <div className="text-fui-green">
          <span className="text-fui-text-muted mr-1">RESULT:</span>
          {summarizePayload(tc.result)}
        </div>
      )}
      {tc.error && (
        <div className="text-fui-red">
          <span className="text-fui-text-muted mr-1">ERROR:</span>
          {tc.error}
        </div>
      )}
    </div>
  );
}

export function Transcript({
  messages,
  streaming,
  pendingUserText,
  thinkingText,
  replyText,
  liveToolCalls,
  errorText,
  undoEntries,
  approvals,
  busyUndoId,
  undoErrors,
  undoNotes,
  busyApprovalId,
  approvalErrors,
  onUndo,
  onApprove,
  onReject,
  onForkFromTurn,
  onSelectCitation,
}: TranscriptProps): React.ReactElement {
  const undoById = new Map<string, McpUndoActionDto & { undone?: boolean }>();
  for (const u of undoEntries) undoById.set(u.id, u);

  const approvalById = new Map<string, PendingMcpApprovalDto>();
  for (const a of approvals) approvalById.set(a.id, a);

  const renderedUndoIds = new Set<string>();
  const renderedApprovalIds = new Set<string>();

  const renderToolCallWithCards = (tc: ToolCallView, keyPrefix: string, idx: number) => {
    const linkedUndo = tc.undoId ? undoById.get(tc.undoId) : undefined;
    if (linkedUndo) renderedUndoIds.add(linkedUndo.id);

    const linkedApproval = tc.approvalId ? approvalById.get(tc.approvalId) : undefined;
    if (linkedApproval) renderedApprovalIds.add(linkedApproval.id);

    return (
      <div key={`${keyPrefix}-${idx}-${tc.toolName}`} className="space-y-1.5">
        <ToolCallBadge tc={tc} />
        {linkedUndo && (
          <McpUndoCard
            entry={linkedUndo}
            busy={busyUndoId === linkedUndo.id}
            errorMessage={undoErrors[linkedUndo.id] ?? null}
            statusNote={undoNotes[linkedUndo.id] ?? null}
            onUndo={onUndo}
          />
        )}
        {linkedApproval && (
          <McpApprovalCard
            approval={linkedApproval}
            busy={busyApprovalId === linkedApproval.id}
            errorMessage={approvalErrors[linkedApproval.id] ?? null}
            onApprove={onApprove}
            onReject={onReject}
          />
        )}
      </div>
    );
  };

  return (
    <div
      data-testid="hermes-transcript"
      className="flex-1 space-y-3 overflow-y-auto border border-fui-border bg-fui-bg-carbon p-3 min-h-0"
    >
      {/* REF-12 Micro-Animation Telemetry Bar (DOTS = LLM wait, WIFI = SSE stream, ICONS = Vault RAG) */}
      <div
        data-testid="hermes-telemetry-strip"
        className="flex flex-wrap items-center justify-between gap-2 border-b border-fui-border pb-2 font-mono text-xs text-fui-text-secondary"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <MicroAnimIcon
              variant="DOTS"
              size={16}
              active={streaming}
              ariaLabel="LLM token synthesis indicator"
            />
            <span>LLM_WAIT</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MicroAnimIcon
              variant="WIFI"
              size={16}
              active={streaming}
              ariaLabel="SSE gateway uplink indicator"
            />
            <span>SSE_STREAM</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MicroAnimIcon
              variant="ICONS"
              size={16}
              active={streaming}
              ariaLabel="Vault RAG grimoire indicator"
            />
            <span>VAULT_RAG</span>
          </span>
        </div>
        <span className="text-fui-cyan">TURNS: {messages.length}</span>
      </div>

      {messages.length === 0 && !pendingUserText && !streaming && (
        <div
          data-testid="hermes-transcript-empty"
          className="border border-fui-border bg-fui-bg-panel p-4 font-mono text-xs text-fui-text-secondary space-y-1.5"
        >
          <div className="font-semibold text-fui-text-primary uppercase">
            HERMES // SECOND BRAIN & LIFE OPS TERMINAL READY
          </div>
          <p>
            Reference domains with <span className="text-fui-cyan">@vault</span>,{' '}
            <span className="text-fui-cyan">@youtube</span>,{' '}
            <span className="text-fui-cyan">@goals</span>,{' '}
            <span className="text-fui-cyan">@todos</span>,{' '}
            <span className="text-fui-cyan">@routines</span>,{' '}
            <span className="text-fui-cyan">@courses</span>, or{' '}
            <span className="text-fui-cyan">@portfolio</span>, or issue a directive with{' '}
            <span className="text-fui-orange">/deep-plan</span>,{' '}
            <span className="text-fui-orange">/weekly-review</span>,{' '}
            <span className="text-fui-orange">/quiz-me</span>,{' '}
            <span className="text-fui-orange">/rebalance</span>, or{' '}
            <span className="text-fui-orange">/mcp</span>.
          </p>
        </div>
      )}

      {/* Persisted Transcript Turns (REF-07 High-Contrast AI Chat Cards) */}
      {messages.map((msg) => {
        const isUser = msg.role === 'user';
        return (
          <article
            key={msg.id || `turn-${msg.index}`}
            data-testid={`hermes-turn-${msg.index}`}
            data-chat-card={isUser ? 'user' : 'assistant'}
            className={
              isUser
                ? 'border border-fui-orange bg-fui-bg-panel p-3 space-y-2'
                : 'border border-fui-cyan bg-fui-bg-elevated p-3 space-y-2.5'
            }
          >
            {/* Card Header + [⑂ Fork from turn] */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-fui-border pb-1.5 font-mono text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    isUser
                      ? 'border border-fui-orange bg-fui-bg-carbon px-1.5 py-0.5 font-bold uppercase text-fui-orange'
                      : 'border border-fui-cyan bg-fui-text-primary px-1.5 py-0.5 font-bold uppercase text-fui-bg-carbon'
                  }
                >
                  {isUser ? 'OPERATOR // PROMPT' : 'HERMES // RESPONSE'}
                </span>
                <span className="text-fui-text-secondary">TURN #{msg.index + 1}</span>
                {msg.gatewayMode && (
                  <span className="border border-fui-border px-1.5 py-0.5 text-fui-text-muted uppercase">
                    {msg.gatewayMode}
                  </span>
                )}
              </div>

              <button
                type="button"
                data-testid={`hermes-fork-turn-${msg.index}`}
                title="Fork new session from this turn"
                onClick={() => void onForkFromTurn(msg.index)}
                className="border border-fui-border bg-fui-bg-carbon px-2 py-0.5 font-mono text-xs text-fui-text-secondary hover:border-fui-cyan hover:text-fui-cyan"
              >
                [⑂ Fork from turn]
              </button>
            </div>

            {/* Collapsible Reasoning / Thinking Disclosure (F25-R06) */}
            {!isUser && msg.thinking && msg.thinking.trim().length > 0 && (
              <details
                data-testid="hermes-thinking-block"
                className="border border-fui-border bg-fui-bg-carbon p-2 font-mono text-xs text-fui-text-secondary"
              >
                <summary className="cursor-pointer font-semibold text-fui-cyan">
                  THINKING // REASONING TRACE
                </summary>
                <p className="mt-1.5 whitespace-pre-wrap">{msg.thinking}</p>
              </details>
            )}

            {/* Message Content (GFM + KaTeX + Mermaid) */}
            <HermesMarkdown content={msg.content} onSelectCitation={onSelectCitation} />

            {/* Inline /mcp Tool Calls & Undo/Approval Cards */}
            {msg.toolCalls.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {msg.toolCalls.map((tc, tcIdx) =>
                  renderToolCallWithCards(tc, `msg-${msg.index}`, tcIdx),
                )}
              </div>
            )}
          </article>
        );
      })}

      {/* Optimistic Pending User Prompt */}
      {pendingUserText && (
        <article
          data-testid="hermes-pending-user-turn"
          data-chat-card="user"
          className="border border-fui-orange bg-fui-bg-panel p-3 space-y-2"
        >
          <div className="flex items-center justify-between border-b border-fui-border pb-1.5 font-mono text-xs">
            <span className="border border-fui-orange bg-fui-bg-carbon px-1.5 py-0.5 font-bold uppercase text-fui-orange">
              OPERATOR // PROMPT (IN_FLIGHT)
            </span>
            <span className="text-fui-cyan">TRANSMITTING...</span>
          </div>
          <HermesMarkdown content={pendingUserText} onSelectCitation={onSelectCitation} />
        </article>
      )}

      {/* Live Streaming Assistant Turn */}
      {(thinkingText || replyText || liveToolCalls.length > 0 || streaming) && (
        <article
          data-testid="hermes-live-assistant-turn"
          data-chat-card="assistant"
          className="border border-fui-cyan bg-fui-bg-elevated p-3 space-y-2.5"
        >
          <div className="flex items-center justify-between border-b border-fui-border pb-1.5 font-mono text-xs">
            <span className="border border-fui-cyan bg-fui-text-primary px-1.5 py-0.5 font-bold uppercase text-fui-bg-carbon">
              HERMES // STREAMING SYNTHESIS
            </span>
            <span className="text-fui-cyan">{streaming ? 'SSE_ACTIVE' : 'COMPLETE'}</span>
          </div>

          {thinkingText && (
            <details
              open
              data-testid="hermes-thinking-block"
              className="border border-fui-border bg-fui-bg-carbon p-2 font-mono text-xs text-fui-text-secondary"
            >
              <summary className="cursor-pointer font-semibold text-fui-cyan">
                THINKING // REASONING TRACE
              </summary>
              <p className="mt-1.5 whitespace-pre-wrap">{thinkingText}</p>
            </details>
          )}

          {liveToolCalls.length > 0 && (
            <div className="space-y-1.5">
              {liveToolCalls.map((tc, tcIdx) => renderToolCallWithCards(tc, 'live', tcIdx))}
            </div>
          )}

          {replyText && (
            <HermesMarkdown content={replyText} onSelectCitation={onSelectCitation} />
          )}
        </article>
      )}

      {/* Session-Level Undo & Approval Cards not already rendered inside a specific turn */}
      {(undoEntries.some((u) => !renderedUndoIds.has(u.id)) ||
        approvals.some((a) => !renderedApprovalIds.has(a.id))) && (
        <section
          data-testid="hermes-mcp-action-ledger"
          className="space-y-2 border-t border-fui-border pt-2"
        >
          <div className="font-mono text-xs font-semibold uppercase tracking-wider text-fui-text-secondary">
            MCP // AUTONOMY & UNDO LEDGER
          </div>
          {approvals
            .filter((a) => !renderedApprovalIds.has(a.id))
            .map((approval) => (
              <McpApprovalCard
                key={approval.id}
                approval={approval}
                busy={busyApprovalId === approval.id}
                errorMessage={approvalErrors[approval.id] ?? null}
                onApprove={onApprove}
                onReject={onReject}
              />
            ))}
          {undoEntries
            .filter((u) => !renderedUndoIds.has(u.id))
            .map((entry) => (
              <McpUndoCard
                key={entry.id}
                entry={entry}
                busy={busyUndoId === entry.id}
                errorMessage={undoErrors[entry.id] ?? null}
                statusNote={undoNotes[entry.id] ?? null}
                onUndo={onUndo}
              />
            ))}
        </section>
      )}

      {/* Stream Error Banner */}
      {errorText && (
        <div
          data-testid="hermes-stream-error"
          role="alert"
          className="border border-fui-red bg-fui-bg-panel px-3 py-2 font-mono text-xs text-fui-red"
        >
          [STREAM_ERROR] {errorText}
        </div>
      )}
    </div>
  );
}
