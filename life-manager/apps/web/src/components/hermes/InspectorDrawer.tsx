import React, { useMemo, useState } from 'react';
import type {
  DistillVaultResponseDto,
  McpUndoActionDto,
  PendingMcpApprovalDto,
  VaultNoteDetailDto,
  VaultNoteSummaryDto,
} from '../../api/hermes';
import { HermesMarkdown } from './markdown/HermesMarkdown';
import {
  extractCitedNotePaths,
  humanizeToolName,
  summarizePayload,
  type HermesMessageView,
  type ToolCallView,
} from './hermesModel';

export interface InspectorDrawerProps {
  sessionKey: string;
  sessionTitle: string;
  messages: HermesMessageView[];
  liveToolCalls: ToolCallView[];
  approvals: PendingMcpApprovalDto[];
  undoEntries: McpUndoActionDto[];
  vaultQuery: string;
  onVaultQueryChange: (q: string) => void;
  vaultNotes: VaultNoteSummaryDto[];
  selectedNotePath: string | null;
  onSelectNotePath: (path: string) => void;
  selectedNote: VaultNoteDetailDto | null | undefined;
  noteLoading: boolean;
  noteError: string | null;
  distillPending: boolean;
  distillError: string | null;
  lastDistilled: DistillVaultResponseDto | null;
  onDistillToVault: (customTitle?: string) => void | Promise<void>;
}

function classifyNoteSource(path: string): { badge: string; color: string } {
  const lower = path.toLowerCase();
  if (lower.includes('youtube') || lower.startsWith('lists/youtube')) {
    return {
      badge: 'YOUTUBE-AI // NOTE',
      color: 'border-fui-orange text-fui-orange',
    };
  }
  if (lower.startsWith('01-inbox') || lower.startsWith('inbox/')) {
    return {
      badge: 'VAULT // INBOX',
      color: 'border-fui-green text-fui-green',
    };
  }
  return {
    badge: 'OBSIDIAN // VAULT',
    color: 'border-fui-cyan text-fui-cyan',
  };
}

function notePathOf(n: VaultNoteSummaryDto | VaultNoteDetailDto): string {
  const rec = n as unknown as Record<string, unknown>;
  if (typeof rec.path === 'string' && rec.path) return rec.path;
  if (typeof rec.relative_path === 'string' && rec.relative_path) return rec.relative_path;
  return '';
}

function noteMarkdownOf(n: VaultNoteDetailDto): string {
  const rec = n as unknown as Record<string, unknown>;
  if (typeof rec.content_md === 'string') return rec.content_md;
  if (typeof rec.content_markdown === 'string') return rec.content_markdown;
  return '';
}

export function InspectorDrawer({
  sessionKey,
  sessionTitle,
  messages,
  liveToolCalls,
  approvals,
  undoEntries,
  vaultQuery,
  onVaultQueryChange,
  vaultNotes,
  selectedNotePath,
  onSelectNotePath,
  selectedNote,
  noteLoading,
  noteError,
  distillPending,
  distillError,
  lastDistilled,
  onDistillToVault,
}: InspectorDrawerProps): React.ReactElement {
  const [distillTitle, setDistillTitle] = useState('');

  const citedPaths = useMemo(
    () => extractCitedNotePaths(messages.map((m) => m.content)),
    [messages],
  );

  const allToolCalls = useMemo<ToolCallView[]>(() => {
    const list: ToolCallView[] = [];
    for (const msg of messages) {
      if (msg.toolCalls.length > 0) {
        list.push(...msg.toolCalls);
      }
    }
    list.push(...liveToolCalls);
    return list;
  }, [messages, liveToolCalls]);

  return (
    <aside
      aria-label="Source and Tool Inspector"
      data-testid="hermes-vault-drawer"
      className="flex flex-col gap-3 border border-fui-border bg-fui-bg-panel p-3 min-h-0 overflow-y-auto"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-fui-border pb-2">
        <div className="font-mono text-xs font-semibold uppercase tracking-wider text-fui-text-secondary">
          SOURCE & TOOL INSPECTOR // VAULT
        </div>
        <span className="border border-fui-cyan bg-fui-bg-carbon px-1.5 py-0.5 font-mono text-xs text-fui-cyan">
          RAG + /MCP
        </span>
      </div>

      {/* 1-Click Distill to Vault Inbox (04:37, F25-R17) */}
      <section
        data-testid="hermes-distill-panel"
        className="space-y-2 border border-fui-border bg-fui-bg-carbon p-2.5"
      >
        <div className="flex items-center justify-between font-mono text-xs">
          <span className="font-semibold uppercase text-fui-green">
            01-INBOX // DISTILL INSIGHT
          </span>
          <span className="text-fui-text-muted">{sessionKey}</span>
        </div>

        <input
          type="text"
          data-testid="hermes-distill-title"
          aria-label="Distilled Vault Note Title"
          value={distillTitle}
          onChange={(e) => setDistillTitle(e.target.value)}
          placeholder={sessionTitle || `Hermes Distill — ${sessionKey}`}
          className="w-full border border-fui-border bg-fui-bg-panel px-2 py-1 font-mono text-xs text-fui-text-primary placeholder:text-fui-text-muted focus:border-fui-green focus:outline-none"
        />

        <button
          type="button"
          data-testid="hermes-vault-distill-btn"
          disabled={distillPending}
          onClick={() => void onDistillToVault(distillTitle.trim() || undefined)}
          className="w-full border border-fui-green bg-fui-bg-elevated px-2.5 py-1.5 font-mono text-xs font-semibold text-fui-green hover:bg-fui-green hover:text-fui-bg-carbon disabled:opacity-40"
        >
          {distillPending ? 'DISTILLING TO VAULT...' : 'Distill to Vault Inbox'}
        </button>

        {lastDistilled && (
          <div
            data-testid="hermes-distill-result"
            className="flex flex-wrap items-center justify-between gap-2 border border-fui-green bg-fui-bg-panel px-2 py-1.5 font-mono text-xs text-fui-green"
          >
            <span className="truncate" title={lastDistilled.vault_note_path}>
              SAVED: {lastDistilled.vault_note_path}
            </span>
            <button
              type="button"
              data-testid="hermes-open-distilled-note"
              onClick={() => onSelectNotePath(lastDistilled.vault_note_path)}
              className="border border-fui-green px-1.5 py-0.5 font-mono text-xs text-fui-green hover:bg-fui-green hover:text-fui-bg-carbon"
            >
              [OPEN]
            </button>
          </div>
        )}

        {distillError && (
          <div
            data-testid="hermes-distill-error"
            className="border border-fui-red bg-fui-bg-panel px-2 py-1 font-mono text-xs text-fui-red"
          >
            {distillError}
          </div>
        )}
      </section>

      {/* Cited Obsidian & youtube-ai Notes in Active Transcript */}
      {citedPaths.length > 0 && (
        <section
          data-testid="hermes-cited-notes-section"
          className="space-y-1.5 border border-fui-border bg-fui-bg-carbon p-2.5"
        >
          <div className="font-mono text-xs font-semibold uppercase text-fui-cyan">
            CITED SOURCES IN THREAD [{citedPaths.length}]
          </div>
          <div className="flex flex-wrap gap-1.5">
            {citedPaths.map((path) => {
              const sourceInfo = classifyNoteSource(path);
              const active = selectedNotePath === path;
              return (
                <button
                  key={path}
                  type="button"
                  data-testid="hermes-citation-pill"
                  data-note-path={path}
                  onClick={() => onSelectNotePath(path)}
                  className={`border px-2 py-1 text-left font-mono text-xs ${
                    active
                      ? 'border-fui-cyan bg-fui-bg-elevated text-fui-cyan font-semibold'
                      : `${sourceInfo.color} bg-fui-bg-panel hover:border-fui-cyan`
                  }`}
                >
                  [{sourceInfo.badge}] {path}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Vault & youtube-ai Note Search & Preview (04:36, F25-R16) */}
      <section className="space-y-2 border border-fui-border bg-fui-bg-carbon p-2.5">
        <div className="flex items-center justify-between font-mono text-xs">
          <span className="font-semibold uppercase text-fui-text-primary">
            OBSIDIAN VAULT & YOUTUBE-AI NOTES
          </span>
          <span className="text-fui-text-muted">[{vaultNotes.length}]</span>
        </div>

        <input
          type="search"
          data-testid="hermes-vault-search"
          aria-label="Search Vault notes"
          value={vaultQuery}
          onChange={(e) => onVaultQueryChange(e.target.value)}
          placeholder="Search Obsidian Vault & youtube-ai notes..."
          className="w-full border border-fui-border bg-fui-bg-panel px-2.5 py-1.5 font-mono text-xs text-fui-text-primary placeholder:text-fui-text-muted focus:border-fui-cyan focus:outline-none"
        />

        <div className="max-h-40 space-y-1 overflow-y-auto pr-0.5">
          {vaultNotes.length === 0 ? (
            <div className="py-2 font-mono text-xs text-fui-text-muted">
              No Vault notes indexed for current filter.
            </div>
          ) : (
            vaultNotes.map((n) => {
              const path = notePathOf(n);
              const sourceInfo = classifyNoteSource(path);
              const active = selectedNotePath === path;
              return (
                <button
                  key={path}
                  type="button"
                  data-testid="hermes-vault-note-item"
                  data-note-path={path}
                  onClick={() => onSelectNotePath(path)}
                  className={`w-full border p-2 text-left font-mono text-xs ${
                    active
                      ? 'border-fui-cyan bg-fui-bg-elevated text-fui-text-primary'
                      : 'border-fui-border bg-fui-bg-panel text-fui-text-secondary hover:border-fui-cyan'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-fui-text-primary">
                      {n.title || path}
                    </span>
                    <span className={`shrink-0 border px-1 py-0.5 text-xs ${sourceInfo.color}`}>
                      {sourceInfo.badge}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-fui-text-muted">{path}</div>
                </button>
              );
            })
          )}
        </div>

        {/* Selected Note Preview or Inline 400/403/404 Error Banner */}
        {noteError && (
          <div
            data-testid="hermes-vault-note-error"
            role="alert"
            className="border border-fui-red bg-fui-bg-panel p-2.5 font-mono text-xs text-fui-red"
          >
            [VAULT_READ_ERROR] {noteError}
          </div>
        )}

        {noteLoading && !noteError && (
          <div
            data-testid="hermes-vault-note-loading"
            className="border border-fui-border bg-fui-bg-panel p-2.5 font-mono text-xs text-fui-cyan"
          >
            LOADING_NOTE // {selectedNotePath}
          </div>
        )}

        {selectedNote && !noteError && (
          <div
            data-testid="hermes-vault-note-preview"
            className="space-y-2 border border-fui-cyan bg-fui-bg-panel p-2.5"
          >
            <div className="flex items-center justify-between gap-2 border-b border-fui-border pb-1 font-mono text-xs">
              <span className="font-semibold text-fui-cyan truncate">
                {selectedNote.title || notePathOf(selectedNote)}
              </span>
              <span className="shrink-0 text-fui-text-muted">{notePathOf(selectedNote)}</span>
            </div>
            <div className="max-h-60 overflow-y-auto">
              <HermesMarkdown
                content={noteMarkdownOf(selectedNote)}
                onSelectCitation={onSelectNotePath}
              />
            </div>
          </div>
        )}
      </section>

      {/* Side-by-Side /mcp Tool Payloads & Autonomy Inspector (04:36) */}
      <section
        data-testid="hermes-inspector-mcp-payloads"
        className="space-y-2 border border-fui-border bg-fui-bg-carbon p-2.5 font-mono text-xs"
      >
        <div className="flex items-center justify-between border-b border-fui-border pb-1">
          <span className="font-semibold uppercase text-fui-orange">
            /MCP TOOL PAYLOAD INSPECTOR
          </span>
          <span className="text-fui-text-muted">
            CALLS:{allToolCalls.length} · PENDING:
            {approvals.filter((a) => (a.status || '').toLowerCase() === 'pending').length} · UNDO:
            {undoEntries.length}
          </span>
        </div>

        {allToolCalls.length === 0 && approvals.length === 0 && undoEntries.length === 0 ? (
          <div className="text-fui-text-muted">
            No /mcp tool payloads recorded in this session yet.
          </div>
        ) : (
          <div className="max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
            {allToolCalls.map((tc, idx) => {
              const headline = humanizeToolName(tc.toolName);
              return (
                <div
                  key={`${idx}-${tc.toolName}`}
                  data-testid="hermes-inspector-tool-item"
                  className="border border-fui-border bg-fui-bg-panel p-2 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-fui-text-primary">
                      {headline.domain} // {headline.action}
                    </span>
                    <span className="text-fui-cyan">{tc.autonomyTier}</span>
                  </div>
                  <pre className="overflow-x-auto text-xs text-fui-text-secondary">
                    <code>{summarizePayload(tc.arguments, 8)}</code>
                  </pre>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </aside>
  );
}
