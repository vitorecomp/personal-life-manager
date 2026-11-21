import React, { useEffect, useState } from 'react';
import type { McpUndoActionDto, PendingMcpApprovalDto } from '../../api/hermes';
import {
  describeUndoTarget,
  formatCountdown,
  humanizeToolName,
  parseEditedPayload,
  prettyJson,
  summarizePayload,
} from './hermesModel';

export interface McpUndoCardProps {
  entry: McpUndoActionDto & { undone?: boolean };
  busy?: boolean;
  errorMessage?: string | null;
  statusNote?: string | null;
  onUndo: (undoId: string) => void | Promise<void>;
}

export function McpUndoCard({
  entry,
  busy = false,
  errorMessage = null,
  statusNote = null,
  onUndo,
}: McpUndoCardProps): React.ReactElement {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const isUndone = Boolean(entry.undone_at || entry.undone);

  useEffect(() => {
    if (isUndone) return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isUndone]);

  const countdown = formatCountdown(entry.expires_at, nowMs);
  const expired = !isUndone && countdown === null;
  const headline = humanizeToolName(entry.tool_name);
  const targetLabel = describeUndoTarget(entry.entity_table, entry.entity_id);

  return (
    <div
      data-testid="hermes-undo-card"
      data-undo-id={entry.id}
      data-undone={isUndone ? 'true' : 'false'}
      className="flex flex-wrap items-center justify-between gap-2 border border-fui-border bg-fui-bg-carbon px-3 py-2 font-mono text-xs"
    >
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <span className="border border-fui-green bg-fui-bg-panel px-1.5 py-0.5 text-fui-green font-semibold">
          TIER_2 // IMMEDIATE_UNDO
        </span>
        <span className="text-fui-text-primary font-semibold">
          {headline.domain} // {headline.action}
        </span>
        <span className="text-fui-text-secondary truncate">{targetLabel}</span>
        <span className="border border-fui-border px-1.5 py-0.5 text-fui-cyan">
          TTL {isUndone ? 'REVERTED' : (countdown ?? 'EXPIRED')}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {statusNote && <span className="text-fui-cyan">{statusNote}</span>}
        {errorMessage && <span className="text-fui-red">{errorMessage}</span>}
        {isUndone ? (
          <span
            data-testid={`hermes-undone-badge-${entry.id}`}
            className="border border-fui-border bg-fui-bg-panel px-2 py-1 text-fui-text-secondary"
          >
            [REVERTED]
          </span>
        ) : (
          <button
            type="button"
            data-testid={`hermes-undo-${entry.id}`}
            disabled={busy || expired}
            onClick={() => void onUndo(entry.id)}
            className="border border-fui-orange bg-fui-bg-elevated px-2.5 py-1 font-mono text-xs font-semibold text-fui-orange hover:bg-fui-orange hover:text-fui-bg-carbon disabled:opacity-40"
          >
            {busy ? '[REVERTING...]' : '[Undo]'}
          </button>
        )}
      </div>
    </div>
  );
}

export interface McpApprovalCardProps {
  approval: PendingMcpApprovalDto;
  busy?: boolean;
  errorMessage?: string | null;
  onApprove: (
    approvalId: string,
    payloadOverride?: unknown,
  ) => void | Promise<void>;
  onReject: (approvalId: string) => void | Promise<void>;
}

export function McpApprovalCard({
  approval,
  busy = false,
  errorMessage = null,
  onApprove,
  onReject,
}: McpApprovalCardProps): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draftJson, setDraftJson] = useState(() => prettyJson(approval.payload_json));
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setDraftJson(prettyJson(approval.payload_json));
  }, [approval.payload_json]);

  const statusUpper = (approval.status || 'pending').toUpperCase();
  const isPending = statusUpper === 'PENDING';
  const headline = humanizeToolName(approval.tool_name);
  const summaryLabel = summarizePayload(approval.payload_json);

  const handleApproveClick = () => {
    if (editing) {
      const parsed = parseEditedPayload(draftJson);
      if (!parsed.ok) {
        setValidationError(parsed.error);
        return;
      }
      setValidationError(null);
      void onApprove(approval.id, parsed.value);
      setEditing(false);
      return;
    }
    setValidationError(null);
    void onApprove(approval.id);
  };

  const handleToggleEdit = () => {
    setValidationError(null);
    setEditing((prev) => !prev);
  };

  return (
    <div
      data-testid="hermes-approval-card"
      data-approval-id={approval.id}
      data-approval-status={statusUpper}
      className="border border-fui-orange bg-fui-bg-carbon p-3 font-mono text-xs space-y-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-fui-border pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="border border-fui-orange bg-fui-bg-panel px-1.5 py-0.5 text-fui-orange font-semibold">
            TIER_3 // REQUIRE_APPROVAL
          </span>
          <span className="text-fui-text-primary font-semibold">
            {headline.domain} // {headline.action}
          </span>
          <span className="text-fui-text-secondary">{summaryLabel}</span>
        </div>
        <span
          data-testid={`hermes-approval-status-${approval.id}`}
          className={`border px-1.5 py-0.5 font-semibold ${
            statusUpper === 'APPROVED'
              ? 'border-fui-green text-fui-green'
              : statusUpper === 'REJECTED'
                ? 'border-fui-red text-fui-red'
                : 'border-fui-orange text-fui-orange'
          }`}
        >
          {statusUpper}
        </span>
      </div>

      {editing && isPending ? (
        <div className="space-y-1.5">
          <label
            htmlFor={`hermes-edit-payload-${approval.id}`}
            className="block text-xs text-fui-cyan uppercase"
          >
            EDIT JSON PAYLOAD BEFORE APPROVAL:
          </label>
          <textarea
            id={`hermes-edit-payload-${approval.id}`}
            data-testid={`hermes-edit-payload-${approval.id}`}
            value={draftJson}
            onChange={(e) => {
              setDraftJson(e.target.value);
              if (validationError) setValidationError(null);
            }}
            rows={5}
            className="w-full border border-fui-cyan bg-fui-bg-panel p-2 font-mono text-xs text-fui-text-primary focus:outline-none"
          />
        </div>
      ) : (
        <pre className="overflow-x-auto border border-fui-border bg-fui-bg-panel p-2 font-mono text-xs text-fui-text-secondary">
          <code>{prettyJson(approval.payload_json)}</code>
        </pre>
      )}

      {(validationError || errorMessage) && (
        <div
          data-testid={`hermes-approval-error-${approval.id}`}
          className="border border-fui-red bg-fui-bg-panel px-2.5 py-1.5 text-fui-red"
        >
          {validationError ?? errorMessage}
        </div>
      )}

      {isPending && (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button
            type="button"
            data-testid={`hermes-approve-${approval.id}`}
            disabled={busy}
            onClick={handleApproveClick}
            className="border border-fui-green bg-fui-bg-elevated px-2.5 py-1 font-mono text-xs font-semibold text-fui-green hover:bg-fui-green hover:text-fui-bg-carbon disabled:opacity-40"
          >
            [✓ Approve]
          </button>
          <button
            type="button"
            data-testid={`hermes-edit-${approval.id}`}
            disabled={busy}
            onClick={handleToggleEdit}
            className="border border-fui-cyan bg-fui-bg-elevated px-2.5 py-1 font-mono text-xs font-semibold text-fui-cyan hover:bg-fui-cyan hover:text-fui-bg-carbon disabled:opacity-40"
          >
            [✎ Edit]
          </button>
          <button
            type="button"
            data-testid={`hermes-cancel-${approval.id}`}
            disabled={busy}
            onClick={() => void onReject(approval.id)}
            className="border border-fui-red bg-fui-bg-elevated px-2.5 py-1 font-mono text-xs font-semibold text-fui-red hover:bg-fui-red hover:text-fui-bg-carbon disabled:opacity-40"
          >
            [✕ Cancel]
          </button>
        </div>
      )}
    </div>
  );
}
