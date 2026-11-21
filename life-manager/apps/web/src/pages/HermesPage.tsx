import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FuiPanel, FUI_TOKENS } from '@hermes/ui';
import {
  apiErrorStatus,
  approveMcpAction,
  createHermesSession,
  deleteHermesSession,
  describeApiError,
  distillToVault,
  forkHermesSession,
  getHermesGatewayHealth,
  getHermesSession,
  getVaultNote,
  listAgentProfiles,
  listHermesSessions,
  listMcpApprovals,
  listMcpUndoActions,
  listVaultNotes,
  rejectMcpAction,
  undoMcpAction,
  updateHermesSession,
  type DistillVaultResponseDto,
  type HermesSessionDto,
  type McpUndoActionDto,
  type PendingMcpApprovalDto,
} from '../api/hermes';
import { Composer } from '../components/hermes/Composer';
import {
  newHermesSessionKey,
  parseComposerDraft,
  readSessionMessages,
  transcriptToMarkdown,
} from '../components/hermes/hermesModel';
import { InspectorDrawer } from '../components/hermes/InspectorDrawer';
import { SessionRail } from '../components/hermes/SessionRail';
import { ThinkingOrbPanel } from '../components/hermes/ThinkingOrbPanel';
import { Transcript } from '../components/hermes/Transcript';
import { useHermesChat } from '../components/hermes/useHermesChat';
import { useAppStore } from '../store/appStore';

function readSessionParamFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const val = params.get('session')?.trim();
    return val || null;
  } catch {
    return null;
  }
}

function syncSessionParamToUrl(sessionKey: string): void {
  if (typeof window === 'undefined' || !sessionKey) return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('session') === sessionKey) return;
    url.searchParams.set('session', sessionKey);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Ignore history API restrictions in test harnesses
  }
}

export function HermesPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const activeSessionKey = useAppStore((s) => s.activeSessionKey);
  const setActiveSessionKey = useAppStore((s) => s.setActiveSessionKey);

  // Local workspace UI states
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [selectedProfileSlug, setSelectedProfileSlug] = useState('default');
  const [selectedModel, setSelectedModel] = useState('hermes-3-llama-3.1-70b');
  const [draft, setDraft] = useState('');
  const [highLevelOverrides, setHighLevelOverrides] = useState<Record<string, boolean>>({});
  const [inspectorOpen, setInspectorOpen] = useState(true);

  // Inspector states
  const [vaultQuery, setVaultQuery] = useState('');
  const [selectedNotePath, setSelectedNotePath] = useState<string | null>(null);
  const [distillPending, setDistillPending] = useState(false);
  const [distillError, setDistillError] = useState<string | null>(null);
  const [lastDistilled, setLastDistilled] = useState<DistillVaultResponseDto | null>(null);

  // Undo & Approval per-item states
  const [busyUndoId, setBusyUndoId] = useState<string | null>(null);
  const [localUndoneIds, setLocalUndoneIds] = useState<Record<string, boolean>>({});
  const [undoErrors, setUndoErrors] = useState<Record<string, string>>({});
  const [undoNotes, setUndoNotes] = useState<Record<string, string>>({});
  const [busyApprovalId, setBusyApprovalId] = useState<string | null>(null);
  const [localApprovalStatus, setLocalApprovalStatus] = useState<
    Record<string, 'pending' | 'approved' | 'rejected'>
  >({});
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({});

  // Read `?session=<key>` on mount and popstate (F25-R03, F25-R18)
  useEffect(() => {
    const initialParam = readSessionParamFromUrl();
    if (initialParam && initialParam !== useAppStore.getState().activeSessionKey) {
      setActiveSessionKey(initialParam);
    }
    const handlePopState = () => {
      const nextParam = readSessionParamFromUrl();
      if (nextParam && nextParam !== useAppStore.getState().activeSessionKey) {
        setActiveSessionKey(nextParam);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [setActiveSessionKey]);

  const selectSession = useCallback(
    (nextKey: string) => {
      setActiveSessionKey(nextKey);
      syncSessionParamToUrl(nextKey);
    },
    [setActiveSessionKey],
  );

  // Queries
  const { data: sessions = [] } = useQuery({
    queryKey: ['hermes-sessions', { q: searchQuery.trim(), archived: showArchived }],
    queryFn: async () => {
      try {
        return await listHermesSessions({
          q: searchQuery.trim() || undefined,
          archived: showArchived ? undefined : false,
        });
      } catch {
        return [];
      }
    },
  });

  const { data: sessionDetail } = useQuery({
    queryKey: ['hermes-session', activeSessionKey],
    queryFn: async () => {
      try {
        return await getHermesSession(activeSessionKey);
      } catch {
        return null;
      }
    },
    enabled: Boolean(activeSessionKey),
  });

  const { data: gatewayHealth } = useQuery({
    queryKey: ['hermes-health'],
    queryFn: async () => {
      try {
        return await getHermesGatewayHealth();
      } catch {
        return { status: 'degraded', hermes_gateway: 'offline_mock' as const };
      }
    },
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      try {
        return await listAgentProfiles();
      } catch {
        return [];
      }
    },
  });

  const { data: serverApprovals = [] } = useQuery({
    queryKey: ['mcp-approvals', activeSessionKey],
    queryFn: async () => {
      try {
        return await listMcpApprovals({ sessionKey: activeSessionKey });
      } catch {
        return [];
      }
    },
    enabled: Boolean(activeSessionKey),
  });

  const { data: serverUndos = [] } = useQuery({
    queryKey: ['mcp-undo', activeSessionKey],
    queryFn: async () => {
      try {
        return await listMcpUndoActions(activeSessionKey);
      } catch {
        return [];
      }
    },
    enabled: Boolean(activeSessionKey),
  });

  const { data: vaultNotes = [] } = useQuery({
    queryKey: ['vault-notes', vaultQuery.trim()],
    queryFn: async () => {
      try {
        return await listVaultNotes({ q: vaultQuery.trim() || undefined, limit: 25 });
      } catch {
        return [];
      }
    },
  });

  const {
    data: selectedNote,
    isLoading: noteLoading,
    error: selectedNoteErrorObj,
  } = useQuery({
    queryKey: ['vault-note', selectedNotePath],
    queryFn: () => getVaultNote(selectedNotePath!),
    enabled: Boolean(selectedNotePath),
    retry: false,
  });

  const noteError = selectedNoteErrorObj
    ? describeApiError(selectedNoteErrorObj, 'Unable to read Vault note')
    : null;

  // Chat state machine hook
  const { turn, lastCompleted, isBusy, send, stop } = useHermesChat(activeSessionKey);
  const isStreaming = turn?.phase === 'waiting' || turn?.phase === 'streaming';

  // Messages normalized from active session
  const activeSessionSummary = useMemo(
    () =>
      sessionDetail ?? sessions.find((s) => s.session_key === activeSessionKey) ?? null,
    [sessionDetail, sessions, activeSessionKey],
  );

  const messages = useMemo(
    () => readSessionMessages(activeSessionSummary),
    [activeSessionSummary],
  );

  // Sync profile_slug from session when switching sessions
  useEffect(() => {
    if (activeSessionSummary?.profile_slug) {
      setSelectedProfileSlug(activeSessionSummary.profile_slug);
    }
  }, [activeSessionSummary?.profile_slug]);

  // Sticky high_level_mode resolution (default true on /hermes per 04:32 & M4A HermesPage baseline)
  const highLevelMode = useMemo(() => {
    if (activeSessionKey in highLevelOverrides) {
      return highLevelOverrides[activeSessionKey]!;
    }
    if (typeof activeSessionSummary?.high_level_mode === 'boolean') {
      return activeSessionSummary.high_level_mode;
    }
    return true;
  }, [activeSessionKey, highLevelOverrides, activeSessionSummary?.high_level_mode]);

  const parsedDraft = useMemo(() => parseComposerDraft(draft), [draft]);

  // Merge server undo entries with live SSE undo events
  const mergedUndoEntries = useMemo<Array<McpUndoActionDto & { undone?: boolean }>>(() => {
    const byId = new Map<string, McpUndoActionDto & { undone?: boolean }>();
    for (const u of serverUndos) {
      byId.set(u.id, {
        ...u,
        undone: Boolean(u.undone_at || localUndoneIds[u.id]),
      });
    }
    const streamUndos = [
      ...(turn?.undoEvents ?? []),
      ...(lastCompleted?.undoEvents ?? []),
    ];
    for (const ev of streamUndos) {
      if (!byId.has(ev.undoId)) {
        byId.set(ev.undoId, {
          id: ev.undoId,
          session_key: activeSessionKey,
          tool_name: ev.toolName,
          undo_kind: 'inverse',
          undo_payload: {},
          entity_table: ev.entityTable,
          entity_id: ev.entityId,
          expires_at: ev.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString(),
          undone_at: localUndoneIds[ev.undoId] ? new Date().toISOString() : null,
          created_at: new Date().toISOString(),
          undone: Boolean(localUndoneIds[ev.undoId]),
        });
      }
    }
    return [...byId.values()];
  }, [serverUndos, turn?.undoEvents, lastCompleted?.undoEvents, localUndoneIds, activeSessionKey]);

  // Merge server approval entries with live SSE approval events
  const mergedApprovals = useMemo<PendingMcpApprovalDto[]>(() => {
    const byId = new Map<string, PendingMcpApprovalDto>();
    for (const a of serverApprovals) {
      byId.set(a.id, {
        ...a,
        status: localApprovalStatus[a.id] ?? a.status,
      });
    }
    const streamApprovals = [
      ...(turn?.approvalEvents ?? []),
      ...(lastCompleted?.approvalEvents ?? []),
    ];
    for (const ev of streamApprovals) {
      if (!byId.has(ev.approvalId)) {
        const mappedStatus =
          localApprovalStatus[ev.approvalId] ??
          (ev.status === 'approved' || ev.status === 'rejected' ? ev.status : 'pending');
        byId.set(ev.approvalId, {
          id: ev.approvalId,
          session_key: activeSessionKey,
          tool_name: ev.toolName,
          payload_json: ev.payloadJson ?? {},
          status: mappedStatus,
          created_at: new Date().toISOString(),
        });
      }
    }
    return [...byId.values()];
  }, [
    serverApprovals,
    turn?.approvalEvents,
    lastCompleted?.approvalEvents,
    localApprovalStatus,
    activeSessionKey,
  ]);

  // Create a new session (button or Cmd+Shift+O)
  const handleCreateNewSession = useCallback(async () => {
    const freshKey = newHermesSessionKey();
    selectSession(freshKey);
    setDraft('');
    try {
      await createHermesSession({
        session_key: freshKey,
        title: 'New Hermes Session',
        origin: 'hermes_view',
        high_level_mode: true,
        profile_slug: selectedProfileSlug === 'default' ? null : selectedProfileSlug,
      });
      await queryClient.invalidateQueries({ queryKey: ['hermes-sessions'] });
      await queryClient.invalidateQueries({ queryKey: ['hermes-session', freshKey] });
    } catch {
      // Session will also be upserted on first chat turn if offline
    }
  }, [queryClient, selectSession, selectedProfileSlug]);

  // Cmd+Shift+O / Ctrl+Shift+O keyboard shortcut for New Session (04:20, F25-R18)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void handleCreateNewSession();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCreateNewSession]);

  // Toggle sticky high_level_mode (PATCH /api/hermes/sessions/{key})
  const handleToggleHighLevelMode = async () => {
    const next = !highLevelMode;
    setHighLevelOverrides((prev) => ({ ...prev, [activeSessionKey]: next }));
    if (activeSessionSummary) {
      try {
        await updateHermesSession(activeSessionKey, { high_level_mode: next });
        queryClient.invalidateQueries({ queryKey: ['hermes-session', activeSessionKey] });
        queryClient.invalidateQueries({ queryKey: ['hermes-sessions'] });
      } catch {
        // Keep local toggle state if session row doesn't exist yet
      }
    }
  };

  // Session CRUD actions
  const handleRenameSession = async (sessionKey: string, nextTitle: string) => {
    try {
      await updateHermesSession(sessionKey, { title: nextTitle });
      await queryClient.invalidateQueries({ queryKey: ['hermes-sessions'] });
      await queryClient.invalidateQueries({ queryKey: ['hermes-session', sessionKey] });
    } catch {
      // Ignore error
    }
  };

  const handleTogglePinSession = async (session: HermesSessionDto) => {
    try {
      await updateHermesSession(session.session_key, { pinned: !session.pinned });
      await queryClient.invalidateQueries({ queryKey: ['hermes-sessions'] });
      await queryClient.invalidateQueries({ queryKey: ['hermes-session', session.session_key] });
    } catch {
      // Ignore error
    }
  };

  const handleToggleArchiveSession = async (session: HermesSessionDto) => {
    try {
      await updateHermesSession(session.session_key, { archived: !session.archived });
      await queryClient.invalidateQueries({ queryKey: ['hermes-sessions'] });
      await queryClient.invalidateQueries({ queryKey: ['hermes-session', session.session_key] });
    } catch {
      // Ignore error
    }
  };

  const handleForkSession = async (sessionKey: string, turnIndex?: number) => {
    try {
      const forked = await forkHermesSession(sessionKey, {
        turn_index: turnIndex,
      });
      await queryClient.invalidateQueries({ queryKey: ['hermes-sessions'] });
      if (forked?.session_key) {
        selectSession(forked.session_key);
      }
    } catch {
      // Ignore error
    }
  };

  const handleDeleteSession = async (sessionKey: string) => {
    try {
      await deleteHermesSession(sessionKey);
      await queryClient.invalidateQueries({ queryKey: ['hermes-sessions'] });
      if (sessionKey === activeSessionKey) {
        const remaining = sessions.filter((s) => s.session_key !== sessionKey);
        const fallbackKey = remaining[0]?.session_key ?? newHermesSessionKey();
        selectSession(fallbackKey);
      }
    } catch {
      // Ignore error
    }
  };

  // Send chat turn
  const handleSend = async (rawMessage?: string) => {
    const text = (rawMessage ?? draft).trim();
    if (!text || isBusy) return;
    const parsed = parseComposerDraft(text);
    const effectiveOrb = highLevelMode || parsed.commandActivatesOrb;
    if (parsed.commandActivatesOrb && !highLevelMode) {
      setHighLevelOverrides((prev) => ({ ...prev, [activeSessionKey]: true }));
    }
    setDraft('');
    await send({
      sessionKey: activeSessionKey,
      text,
      highLevelMode: effectiveOrb,
      mentions: parsed.mentions,
      slashCommand: parsed.slashSpec?.sendAsSlashCommand ? parsed.slashCommand : null,
      profileSlug: selectedProfileSlug === 'default' ? null : selectedProfileSlug,
    });
  };

  // Undo handler with graceful 409 Conflict handling (F25-R10, F25-K03)
  const handleUndo = async (undoId: string) => {
    setBusyUndoId(undoId);
    setUndoErrors((prev) => {
      const next = { ...prev };
      delete next[undoId];
      return next;
    });
    try {
      await undoMcpAction(undoId);
      setLocalUndoneIds((prev) => ({ ...prev, [undoId]: true }));
      setUndoNotes((prev) => ({ ...prev, [undoId]: 'Action reverted' }));
      await queryClient.invalidateQueries({ queryKey: ['mcp-undo'] });
      await queryClient.invalidateQueries({ queryKey: ['hermes-session', activeSessionKey] });
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['routines'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    } catch (err) {
      const status = apiErrorStatus(err);
      if (status === 409) {
        // Already undone or window closed: mark reverted cleanly without unhandled error
        setLocalUndoneIds((prev) => ({ ...prev, [undoId]: true }));
        setUndoNotes((prev) => ({
          ...prev,
          [undoId]: describeApiError(err, 'Already undone'),
        }));
      } else {
        setUndoErrors((prev) => ({
          ...prev,
          [undoId]: describeApiError(err, 'Failed to undo action'),
        }));
      }
    } finally {
      setBusyUndoId(null);
    }
  };

  // Approve / Reject handlers (F25-R11)
  const handleApprove = async (approvalId: string, payloadOverride?: unknown) => {
    setBusyApprovalId(approvalId);
    setApprovalErrors((prev) => {
      const next = { ...prev };
      delete next[approvalId];
      return next;
    });
    try {
      await approveMcpAction(approvalId, payloadOverride);
      setLocalApprovalStatus((prev) => ({ ...prev, [approvalId]: 'approved' }));
      await queryClient.invalidateQueries({ queryKey: ['mcp-approvals'] });
      await queryClient.invalidateQueries({ queryKey: ['mcp-undo'] });
      await queryClient.invalidateQueries({ queryKey: ['hermes-session', activeSessionKey] });
    } catch (err) {
      setApprovalErrors((prev) => ({
        ...prev,
        [approvalId]: describeApiError(err, 'Approval execution failed'),
      }));
    } finally {
      setBusyApprovalId(null);
    }
  };

  const handleReject = async (approvalId: string) => {
    setBusyApprovalId(approvalId);
    setApprovalErrors((prev) => {
      const next = { ...prev };
      delete next[approvalId];
      return next;
    });
    try {
      await rejectMcpAction(approvalId);
      setLocalApprovalStatus((prev) => ({ ...prev, [approvalId]: 'rejected' }));
      await queryClient.invalidateQueries({ queryKey: ['mcp-approvals'] });
      await queryClient.invalidateQueries({ queryKey: ['hermes-session', activeSessionKey] });
    } catch (err) {
      setApprovalErrors((prev) => ({
        ...prev,
        [approvalId]: describeApiError(err, 'Failed to cancel approval'),
      }));
    } finally {
      setBusyApprovalId(null);
    }
  };

  // Distill to Vault Inbox handler (04:37, F25-R17)
  const handleDistillToVault = async (customTitle?: string) => {
    setDistillPending(true);
    setDistillError(null);
    try {
      const title =
        customTitle?.trim() ||
        activeSessionSummary?.title ||
        `Hermes Session ${activeSessionKey}`;
      const exportMessages =
        messages.length > 0
          ? messages
          : turn?.text
            ? [
                { role: 'user' as const, rawRole: 'user', content: turn.userText },
                { role: 'assistant' as const, rawRole: 'assistant', content: turn.text },
              ]
            : [{ role: 'assistant' as const, rawRole: 'assistant', content: draft || title }];
      const contentMd = transcriptToMarkdown(title, activeSessionKey, exportMessages);
      const result = await distillToVault({
        title,
        content_md: contentMd,
        session_key: activeSessionKey,
        tags: ['hermes', 'distilled'],
      });
      setLastDistilled(result);
      await queryClient.invalidateQueries({ queryKey: ['vault-notes'] });
    } catch (err) {
      setDistillError(describeApiError(err, 'Failed to distill insight to Vault Inbox'));
    } finally {
      setDistillPending(false);
    }
  };

  // Open citation in Inspector Drawer
  const handleSelectCitation = useCallback((notePath: string) => {
    setInspectorOpen(true);
    setSelectedNotePath(notePath);
  }, []);

  const gatewayMode =
    turn?.gatewayMode ??
    lastCompleted?.gatewayMode ??
    gatewayHealth?.hermes_gateway ??
    'offline_mock';
  const isGatewayOnline = gatewayMode === 'online';

  const orbVisible = highLevelMode || Boolean(turn?.orbActive);
  const latestThinkingText =
    turn?.thinkingText ||
    lastCompleted?.thinkingText ||
    messages[messages.length - 1]?.thinking ||
    '';
  const latestToolCalls =
    turn?.toolCalls && turn.toolCalls.length > 0
      ? turn.toolCalls
      : lastCompleted?.toolCalls && lastCompleted.toolCalls.length > 0
        ? lastCompleted.toolCalls
        : messages[messages.length - 1]?.toolCalls ?? [];

  return (
    <div
      data-testid="hermes-page"
      style={{
        backgroundColor: FUI_TOKENS.bgCarbon,
        color: FUI_TOKENS.inkStark,
        borderRadius: '0px',
      }}
      className={`flex-1 min-h-0 max-h-[calc(100vh-56px)] overflow-hidden p-3 grid gap-3 grid-cols-1 ${
        inspectorOpen
          ? 'xl:grid-cols-[280px_minmax(0,1fr)_320px] lg:grid-cols-[260px_minmax(0,1fr)]'
          : 'lg:grid-cols-[280px_minmax(0,1fr)]'
      }`}
    >
      {/* Left Region: Session Rail */}
      <SessionRail
        sessions={sessions}
        activeSessionKey={activeSessionKey}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        showArchived={showArchived}
        onToggleShowArchived={() => setShowArchived((v) => !v)}
        selectedProfileSlug={selectedProfileSlug}
        onSelectProfileSlug={setSelectedProfileSlug}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        agents={agents}
        onSelectSession={selectSession}
        onCreateNewSession={() => void handleCreateNewSession()}
        onRenameSession={handleRenameSession}
        onTogglePinSession={handleTogglePinSession}
        onToggleArchiveSession={handleToggleArchiveSession}
        onForkSession={(key) => handleForkSession(key)}
        onDeleteSession={handleDeleteSession}
      />

      {/* Center Region: Main Hermes Chat & Thinking Orb Workspace */}
      <FuiPanel
        className="flex flex-col min-h-0 overflow-hidden"
        headerTitle="HERMES // INTELLIGENCE WORKSPACE"
        headerProps={{
          title: 'HERMES // INTELLIGENCE WORKSPACE',
          code: 'MOD_04',
          accent: 'orange',
          actions: (
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-testid="hermes-gateway-status"
                data-gateway-mode={gatewayMode}
                className={`border px-2 py-1 font-mono text-xs font-semibold ${
                  isGatewayOnline
                    ? 'border-fui-green bg-fui-bg-carbon text-fui-green'
                    : 'border-fui-orange bg-fui-bg-carbon text-fui-orange'
                }`}
              >
                {isGatewayOnline ? 'GATEWAY: ONLINE' : 'GATEWAY: OFFLINE_MOCK'}
              </span>

              <button
                type="button"
                data-testid="high-level-plan-toggle"
                aria-label="Toggle High-Level Thinking Orb"
                aria-pressed={orbVisible}
                onClick={() => void handleToggleHighLevelMode()}
                style={{
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontFamily: FUI_TOKENS.fontMono,
                  fontWeight: 700,
                  backgroundColor: orbVisible ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgCarbon,
                  color: orbVisible ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                  border: `1px solid ${FUI_TOKENS.accentOrange}`,
                  cursor: 'pointer',
                  borderRadius: '0px',
                }}
              >
                HIGH_LEVEL_PLAN
              </button>

              <button
                type="button"
                data-testid="hermes-vault-drawer-toggle"
                aria-label="Toggle Vault Source and Tool Inspector"
                aria-expanded={inspectorOpen}
                onClick={() => setInspectorOpen((v) => !v)}
                className={`border px-2.5 py-1 font-mono text-xs font-semibold ${
                  inspectorOpen
                    ? 'border-fui-cyan bg-fui-bg-elevated text-fui-cyan'
                    : 'border-fui-border bg-fui-bg-carbon text-fui-text-secondary hover:border-fui-cyan'
                }`}
              >
                [VAULT & /MCP INSPECTOR]
              </button>
            </div>
          ),
        }}
      >
        <div className="flex flex-1 flex-col gap-3 min-h-0 overflow-y-auto">
          {orbVisible && (
            <ThinkingOrbPanel
              streaming={isStreaming}
              thinkingText={latestThinkingText}
              activeMentions={
                turn?.requestedMentions && turn.requestedMentions.length > 0
                  ? turn.requestedMentions
                  : parsedDraft.mentions
              }
              activeSlashCommand={turn?.slashCommand ?? parsedDraft.slashCommand}
              toolCalls={latestToolCalls}
              messageCount={messages.length}
              sessionOrigin={activeSessionSummary?.origin ?? 'hermes_view'}
              orbState={turn?.orbState ?? lastCompleted?.orbState ?? null}
            />
          )}

          <Transcript
            messages={messages}
            streaming={isStreaming}
            pendingUserText={turn ? turn.userText : null}
            thinkingText={turn?.thinkingText ?? ''}
            replyText={turn?.text ?? ''}
            liveToolCalls={turn?.toolCalls ?? []}
            errorText={turn?.error?.message ?? null}
            undoEntries={mergedUndoEntries}
            approvals={mergedApprovals}
            busyUndoId={busyUndoId}
            undoErrors={undoErrors}
            undoNotes={undoNotes}
            busyApprovalId={busyApprovalId}
            approvalErrors={approvalErrors}
            onUndo={handleUndo}
            onApprove={handleApprove}
            onReject={handleReject}
            onForkFromTurn={(turnIdx) => handleForkSession(activeSessionKey, turnIdx)}
            onSelectCitation={handleSelectCitation}
          />

          <Composer
            value={draft}
            onChange={setDraft}
            onSend={handleSend}
            onAbort={stop}
            streaming={isStreaming}
          />
        </div>
      </FuiPanel>

      {/* Right Region: Collapsible Source & Tool Inspector Drawer */}
      {inspectorOpen && (
        <InspectorDrawer
          sessionKey={activeSessionKey}
          sessionTitle={activeSessionSummary?.title ?? activeSessionKey}
          messages={messages}
          liveToolCalls={turn?.toolCalls ?? []}
          approvals={mergedApprovals}
          undoEntries={mergedUndoEntries}
          vaultQuery={vaultQuery}
          onVaultQueryChange={setVaultQuery}
          vaultNotes={vaultNotes}
          selectedNotePath={selectedNotePath}
          onSelectNotePath={setSelectedNotePath}
          selectedNote={selectedNote}
          noteLoading={noteLoading}
          noteError={noteError}
          distillPending={distillPending}
          distillError={distillError}
          lastDistilled={lastDistilled}
          onDistillToVault={handleDistillToVault}
        />
      )}
    </div>
  );
}
