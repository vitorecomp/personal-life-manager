import React, { useMemo, useState } from 'react';
import { FuiFigureRow, FUI_TOKENS } from '@hermes/ui';
import type { AgentProfileDto, HermesSessionDto } from '../../api/hermes';
import { groupSessionsForRail, originLabel } from './hermesModel';

export interface SessionRailProps {
  sessions: HermesSessionDto[];
  activeSessionKey: string;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  showArchived: boolean;
  onToggleShowArchived: () => void;
  selectedProfileSlug: string;
  onSelectProfileSlug: (slug: string) => void;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  agents: AgentProfileDto[];
  onSelectSession: (sessionKey: string) => void;
  onCreateNewSession: () => void;
  onRenameSession: (sessionKey: string, nextTitle: string) => void | Promise<void>;
  onTogglePinSession: (session: HermesSessionDto) => void | Promise<void>;
  onToggleArchiveSession: (session: HermesSessionDto) => void | Promise<void>;
  onForkSession: (sessionKey: string) => void | Promise<void>;
  onDeleteSession: (sessionKey: string) => void | Promise<void>;
}

const AVAILABLE_MODELS = [
  { id: 'hermes-3-llama-3.1-70b', label: 'HERMES-3 // LLAMA-3.1-70B' },
  { id: 'hermes-3-llama-3.1-405b', label: 'HERMES-3 // LLAMA-3.1-405B' },
  { id: 'DeepSeek-R1', label: 'DEEPSEEK-R1 // REASONING' },
];

function resolveOriginBadge(session: HermesSessionDto): {
  label: string;
  dotColor: string;
  tabColor: string;
} {
  const label = originLabel(session.origin);
  if (label === 'FRIEREN') {
    return {
      label: 'FRIEREN',
      dotColor: FUI_TOKENS.accentCyan,
      tabColor: FUI_TOKENS.accentCyan,
    };
  }
  if (label === 'KNIGHT_RUN') {
    return {
      label: 'KNIGHT_RUN',
      dotColor: FUI_TOKENS.accentPhosphor,
      tabColor: FUI_TOKENS.accentPhosphor,
    };
  }
  return {
    label: 'HERMES',
    dotColor: session.pinned ? FUI_TOKENS.accentOrange : FUI_TOKENS.accentAmber,
    tabColor: session.pinned ? FUI_TOKENS.accentOrange : FUI_TOKENS.accentAmber,
  };
}

export function SessionRail({
  sessions,
  activeSessionKey,
  searchQuery,
  onSearchQueryChange,
  showArchived,
  onToggleShowArchived,
  selectedProfileSlug,
  onSelectProfileSlug,
  selectedModel,
  onSelectModel,
  agents,
  onSelectSession,
  onCreateNewSession,
  onRenameSession,
  onTogglePinSession,
  onToggleArchiveSession,
  onForkSession,
  onDeleteSession,
}: SessionRailProps): React.ReactElement {
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const grouped = useMemo(() => {
    const groups = groupSessionsForRail(sessions, new Date());
    return groups.filter((g) => g.count > 0);
  }, [sessions]);

  const startRename = (s: HermesSessionDto) => {
    setRenamingKey(s.session_key);
    setRenameDraft(s.title || s.session_key);
  };

  const commitRename = async (sessionKey: string) => {
    const trimmed = renameDraft.trim();
    setRenamingKey(null);
    if (!trimmed) return;
    await onRenameSession(sessionKey, trimmed);
  };

  let figCounter = 0;

  const renderSessionRow = (s: HermesSessionDto) => {
    figCounter += 1;
    const isActive = s.session_key === activeSessionKey;
    const badge = resolveOriginBadge(s);
    const isRenaming = renamingKey === s.session_key;
    const msgCount =
      typeof s.message_count === 'number'
        ? s.message_count
        : Array.isArray(s.messages_json)
          ? s.messages_json.length
          : 0;

    return (
      <div
        key={s.session_key}
        data-testid={`hermes-session-item-${s.session_key}`}
        data-session-key={s.session_key}
        className="space-y-1"
      >
        {isRenaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void commitRename(s.session_key);
            }}
            className="flex items-center gap-1 border border-fui-cyan bg-fui-bg-carbon p-1.5"
          >
            <input
              type="text"
              data-testid={`hermes-rename-input-${s.session_key}`}
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              autoFocus
              className="min-w-0 flex-1 border border-fui-border bg-fui-bg-panel px-2 py-1 font-mono text-xs text-fui-text-primary focus:outline-none"
            />
            <button
              type="submit"
              data-testid={`hermes-rename-save-${s.session_key}`}
              onClick={(e) => {
                e.preventDefault();
                void commitRename(s.session_key);
              }}
              className="border border-fui-green px-2 py-1 font-mono text-xs text-fui-green"
            >
              SAVE
            </button>
            <button
              type="button"
              onClick={() => setRenamingKey(null)}
              className="border border-fui-border px-2 py-1 font-mono text-xs text-fui-text-secondary"
            >
              ESC
            </button>
          </form>
        ) : (
          <FuiFigureRow
            code={`[FIG 4.${figCounter}]`}
            title={s.title || s.session_key}
            subtitle={`${badge.label} · ${s.session_key} · ${msgCount} MSG`}
            active={isActive}
            tabColor={badge.tabColor}
            statusDotColor={badge.dotColor}
            phosphorSplitPct={isActive ? 68 : s.pinned ? 50 : 24}
            onSelect={() => onSelectSession(s.session_key)}
          />
        )}

        {/* Session Action Bar (Rename, Pin, Fork, Archive, Delete) */}
        <div className="flex flex-wrap items-center justify-between gap-1 border border-t-0 border-fui-border bg-fui-bg-carbon px-2 py-1 font-mono text-xs">
          <span className="text-fui-text-secondary">
            {badge.label}
            {s.high_level_mode ? ' · ORB_ON' : ''}
          </span>
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              data-testid={`hermes-session-pin-${s.session_key}`}
              onClick={() => void onTogglePinSession(s)}
              className="border border-fui-border bg-fui-bg-panel px-1.5 py-0.5 font-mono text-xs text-fui-text-secondary hover:border-fui-orange hover:text-fui-orange"
            >
              {s.pinned ? 'UNPIN' : 'PIN'}
            </button>
            <button
              type="button"
              data-testid={`hermes-session-rename-${s.session_key}`}
              onClick={() => startRename(s)}
              className="border border-fui-border bg-fui-bg-panel px-1.5 py-0.5 font-mono text-xs text-fui-text-secondary hover:border-fui-cyan hover:text-fui-cyan"
            >
              RENAME
            </button>
            <button
              type="button"
              data-testid={`hermes-session-fork-${s.session_key}`}
              onClick={() => void onForkSession(s.session_key)}
              className="border border-fui-border bg-fui-bg-panel px-1.5 py-0.5 font-mono text-xs text-fui-cyan hover:border-fui-cyan"
            >
              ⑂ FORK
            </button>
            <button
              type="button"
              data-testid={`hermes-session-archive-${s.session_key}`}
              onClick={() => void onToggleArchiveSession(s)}
              className="border border-fui-border bg-fui-bg-panel px-1.5 py-0.5 font-mono text-xs text-fui-text-secondary hover:border-fui-cyan"
            >
              {s.archived ? 'UNARCHIVE' : 'ARCHIVE'}
            </button>
            <button
              type="button"
              data-testid={`hermes-session-delete-${s.session_key}`}
              onClick={() => void onDeleteSession(s.session_key)}
              className="border border-fui-border bg-fui-bg-panel px-1.5 py-0.5 font-mono text-xs text-fui-red hover:border-fui-red"
            >
              DEL
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <aside
      aria-label="Hermes Sessions"
      data-testid="hermes-session-rail"
      className="flex flex-col gap-2.5 border border-fui-border bg-fui-bg-panel p-3 min-h-0 overflow-y-auto"
    >
      {/* Header + New Session CTA (Cmd+Shift+O) */}
      <div className="flex items-center justify-between gap-2 border-b border-fui-border pb-2">
        <div className="font-mono text-xs font-semibold uppercase tracking-wider text-fui-text-secondary">
          SESSION RAIL // [04]
        </div>
        <button
          type="button"
          data-testid="hermes-new-session"
          title="New Hermes Session (Cmd+Shift+O)"
          onClick={onCreateNewSession}
          className="border border-fui-orange bg-fui-bg-elevated px-2 py-1 font-mono text-xs font-semibold text-fui-orange hover:bg-fui-orange hover:text-fui-bg-carbon"
        >
          + NEW_SESSION
        </button>
      </div>

      {/* Full-Text Session Search (F25-R04) */}
      <div className="space-y-1.5">
        <input
          type="search"
          data-testid="hermes-session-search"
          aria-label="Search Hermes sessions"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Search sessions (/api/hermes/sessions?q=)..."
          className="w-full border border-fui-border bg-fui-bg-carbon px-2.5 py-1.5 font-mono text-xs text-fui-text-primary placeholder:text-fui-text-muted focus:border-fui-cyan focus:outline-none"
        />

        {/* Profile / Knight & Model Selector (F25-R19) */}
        <div className="grid grid-cols-1 gap-1.5">
          <select
            data-testid="hermes-profile-select"
            aria-label="Hermes Agent Profile"
            value={selectedProfileSlug}
            onChange={(e) => onSelectProfileSlug(e.target.value)}
            className="w-full border border-fui-border bg-fui-bg-carbon px-2 py-1 font-mono text-xs text-fui-text-primary focus:border-fui-cyan focus:outline-none"
          >
            <option value="default">PROFILE // HERMES_MASTERMIND (DEFAULT)</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.slug}>
                KNIGHT // {agent.name.toUpperCase()} ({agent.slug})
              </option>
            ))}
          </select>

          <select
            data-testid="hermes-model-select"
            aria-label="Hermes Model"
            value={selectedModel}
            onChange={(e) => onSelectModel(e.target.value)}
            className="w-full border border-fui-border bg-fui-bg-carbon px-2 py-1 font-mono text-xs text-fui-text-secondary focus:border-fui-cyan focus:outline-none"
          >
            {AVAILABLE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Active session key readout + Archived filter toggle */}
      <div className="flex items-center justify-between gap-2 border-y border-fui-border py-1.5 font-mono text-xs">
        <span
          data-testid="hermes-active-session-key"
          className="truncate text-fui-cyan"
          title={activeSessionKey}
        >
          KEY: {activeSessionKey}
        </span>
        <button
          type="button"
          data-testid="hermes-show-archived-toggle"
          onClick={onToggleShowArchived}
          className={`shrink-0 border px-1.5 py-0.5 font-mono text-xs ${
            showArchived
              ? 'border-fui-cyan text-fui-cyan'
              : 'border-fui-border text-fui-text-secondary'
          }`}
        >
          {showArchived ? '[HIDE ARCHIVED]' : '[ARCHIVED]'}
        </button>
      </div>

      {/* Grouped Session Strips (Pinned, Today, Previous 7 Days, Older, Archived / Folders) */}
      <div className="flex-1 space-y-3 overflow-y-auto pr-0.5">
        {grouped.length === 0 ? (
          <div
            data-testid="hermes-session-empty"
            className="border border-fui-border bg-fui-bg-carbon p-3 font-mono text-xs text-fui-text-secondary"
          >
            No sessions matching current query. Press{' '}
            <span className="text-fui-orange">+ NEW_SESSION</span> or{' '}
            <span className="text-fui-cyan">Cmd+Shift+O</span> to initialize a workspace thread.
          </div>
        ) : (
          grouped.map((group) => (
            <div
              key={group.id}
              data-testid={`hermes-session-group-${group.id}`}
              className="space-y-1.5"
            >
              <div className="flex items-center justify-between font-mono text-xs uppercase tracking-wider text-fui-text-secondary">
                <span>{group.label}</span>
                <span className="text-fui-text-muted">[{group.count}]</span>
              </div>

              {group.sessions.length > 0 && (
                <div className="space-y-1.5">{group.sessions.map(renderSessionRow)}</div>
              )}

              {group.folders.map((folder) => (
                <div key={folder.name} className="space-y-1.5 pl-1 border-l border-fui-border">
                  <div className="font-mono text-xs text-fui-cyan uppercase">
                    [{folder.kind === 'archived' ? 'ARCHIVED' : `FOLDER // ${folder.name}`}]
                  </div>
                  <div className="space-y-1.5">{folder.sessions.map(renderSessionRow)}</div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
