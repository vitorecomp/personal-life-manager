import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CompanionStage,
  type CompanionAnimationHint,
  type CompanionApprovalRequest,
  type CompanionChatMessage,
  type CompanionNudge,
  type CompanionUndoAction,
} from '@hermes/ui';
import {
  apiGet,
  apiPost,
  streamHermesChat,
  unwrapList,
  UUID_RE,
  type CompanionNudgeRecord,
  type HermesSessionRecord,
  type McpUndoRecord,
  type PendingApprovalRecord,
} from '../../api/client';
import { useAppStore } from '../../store/appStore';

export interface FrierenCompanionControllerProps {
  pathname: string;
  dbOnline?: boolean;
  gatewayMode?: 'online' | 'offline_mock';
  onNavigate: (to: string) => void;
  mode: 'ledge' | 'popover';
}

interface ScopedCompanionMessage extends CompanionChatMessage {
  sessionKey: string;
  isOptimisticTurn?: boolean;
}

export function FrierenCompanionController({
  pathname,
  dbOnline = true,
  gatewayMode = 'online',
  onNavigate,
  mode,
}: FrierenCompanionControllerProps) {
  const queryClient = useQueryClient();
  const companionOpen = useAppStore((s) => s.companionOpen);
  const setCompanionOpen = useAppStore((s) => s.setCompanionOpen);
  const activeSessionKey = useAppStore((s) => s.activeSessionKey);
  const setActiveSessionKey = useAppStore((s) => s.setActiveSessionKey);
  const activeDashboardId = useAppStore((s) => s.activeDashboardId);
  const selectedEntityId = useAppStore((s) => s.selectedEntityId);
  const selectedEntityLabel = useAppStore((s) => s.selectedEntityLabel);
  const isAssistantStreaming = useAppStore((s) => s.isAssistantStreaming);
  const setAssistantStreaming = useAppStore((s) => s.setAssistantStreaming);

  const [localMessages, setLocalMessages] = useState<ScopedCompanionMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const optimisticSeqRef = useRef(0);

  // Clear local optimistic messages immediately when activeSessionKey changes
  useEffect(() => {
    setLocalMessages([]);
  }, [activeSessionKey]);

  // Escape key closes the popover cleanly (Cmd+J / Ctrl+J is handled by CompanionStage mode="popover")
  useEffect(() => {
    if (mode !== 'popover' || !companionOpen) return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setCompanionOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, companionOpen, setCompanionOpen]);

  // Discover latest session from /api/hermes/sessions so API-initiated Frieren sessions are synced
  useQuery({
    queryKey: ['hermes-sessions-sync'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/hermes/sessions');
        const list = unwrapList<HermesSessionRecord>(res, ['sessions']);
        if (list.length > 0 && list[0]?.session_key) {
          const cur = useAppStore.getState();
          const storedExplicit =
            typeof window !== 'undefined'
              ? window.localStorage.getItem('hermes-active-session-key')
              : null;
          if (
            cur.activeSessionKey === 'hermes-primary-session' &&
            !cur.isAssistantStreaming &&
            !storedExplicit
          ) {
            setActiveSessionKey(list[0].session_key);
          }
        }
        return list;
      } catch {
        return [];
      }
    },
    enabled: mode === 'popover',
  });

  // Load current session history
  const { data: sessionDetail } = useQuery({
    queryKey: ['hermes-session', activeSessionKey],
    queryFn: async () => {
      try {
        const res = await apiGet<any>(
          `/api/hermes/sessions/${encodeURIComponent(activeSessionKey)}`,
        );
        return (res?.data ?? res) as HermesSessionRecord | null;
      } catch {
        return null;
      }
    },
    enabled: mode === 'popover' && Boolean(activeSessionKey),
  });

  // Proactive nudges
  const { data: rawNudges = [] } = useQuery({
    queryKey: ['companion-nudges'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/companion/nudges');
        return unwrapList<CompanionNudgeRecord>(res, ['nudges', 'active_nudges']);
      } catch {
        return [];
      }
    },
  });

  // Pending Tier 3 MCP approvals
  const { data: rawApprovals = [] } = useQuery({
    queryKey: ['mcp-approvals'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/mcp/approvals');
        return unwrapList<PendingApprovalRecord>(res, ['approvals']);
      } catch {
        return [];
      }
    },
    enabled: mode === 'popover',
  });

  // Tier 2 MCP Undo actions
  const { data: rawUndos = [] } = useQuery({
    queryKey: ['mcp-undo'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/mcp/undo');
        return unwrapList<McpUndoRecord>(res, ['undo_actions', 'undos', 'actions']);
      } catch {
        return [];
      }
    },
    enabled: mode === 'popover',
  });

  const dismissNudgeMutation = useMutation({
    mutationFn: async (nudgeId: string) =>
      apiPost(`/api/companion/nudges/${encodeURIComponent(nudgeId)}/dismiss`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companion-nudges'] });
    },
  });

  const undoMutation = useMutation({
    mutationFn: async (undoId: string) =>
      apiPost(`/api/mcp/undo/${encodeURIComponent(undoId)}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-undo'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({
      id,
      payloadJson,
    }: {
      id: string;
      payloadJson?: Record<string, unknown> | string;
    }) =>
      apiPost(`/api/mcp/approvals/${encodeURIComponent(id)}/approve`, {
        payload_json: payloadJson,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) =>
      apiPost(`/api/mcp/approvals/${encodeURIComponent(id)}/reject`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-approvals'] });
    },
  });

  const nudges: CompanionNudge[] = rawNudges.map((n) => ({
    id: String(n.id),
    title: String(n.title || 'TACTICAL_NUDGE'),
    message: String(n.message || ''),
    module: n.category || 'general',
  }));

  const pendingApprovals: CompanionApprovalRequest[] = rawApprovals
    .filter((a) => String(a.status || 'pending').toLowerCase() === 'pending')
    .map((a) => ({
      id: String(a.id),
      toolName: String(a.tool_name || 'mcp_tool'),
      summary: `Pending Tier-3 approval for ${a.tool_name}`,
      payloadJson: a.payload_json ?? {},
      status: 'pending',
    }));

  const nowMs = Date.now();
  const undoActions: CompanionUndoAction[] = rawUndos
    .filter((u) => {
      if (!u || u.reverted) return false;
      if (u.undone_at != null && String(u.undone_at).trim() !== '') return false;
      if (u.expires_at) {
        const expMs = Date.parse(String(u.expires_at));
        if (!Number.isNaN(expMs) && expMs <= nowMs) return false;
      }
      return true;
    })
    .map((u) => ({
      undoId: String(u.undo_id ?? u.id),
      toolName: String(u.tool_name || 'mcp_action'),
      summary: `${u.entity_table || 'entity'} modified`,
      undone: false,
    }));

  const serverMessages: CompanionChatMessage[] = (
    sessionDetail?.messages ??
    sessionDetail?.messages_json ??
    []
  ).map((m, idx) => ({
    id: String(m.id ?? `srv-${idx}`),
    role: m.role || 'assistant',
    content: String(m.content || ''),
    thinkingText: m.thinking,
  }));

  const scopedLocalMessages = localMessages
    .filter((m) => m.sessionKey === activeSessionKey)
    .filter((m) => {
      if (m.isStreaming || m.isOptimisticTurn) return true;
      return !serverMessages.some(
        (srv) => srv.role === m.role && srv.content.trim() === m.content.trim(),
      );
    });

  const combinedMessages: CompanionChatMessage[] =
    scopedLocalMessages.length > 0 ? [...serverMessages, ...scopedLocalMessages] : serverMessages;

  const isDashboardRoute =
    pathname === '/dashboard' || pathname.startsWith('/dashboard/') || pathname === '/monitor';
  const safeActiveDashboardId =
    isDashboardRoute && activeDashboardId && UUID_RE.test(activeDashboardId)
      ? activeDashboardId
      : null;

  const pageContext = {
    activeRoute: pathname,
    activeDashboardId: safeActiveDashboardId,
    selectedEntityId,
    selectedEntityLabel,
  };

  if (mode === 'ledge') {
    const ledgeAnimation: CompanionAnimationHint =
      isAssistantStreaming || isStreaming
        ? 'cast_blue_flora'
        : nudges.length > 0
          ? 'walk_ledge'
          : pathname.startsWith('/courses') ||
              pathname.startsWith('/goals') ||
              pathname.startsWith('/hermes')
            ? 'read_grimoire'
            : 'idle_ledge_sit';

    return (
      <CompanionStage
        mode="ledge"
        online={dbOnline}
        gatewayMode={gatewayMode}
        animation={ledgeAnimation}
        scale={2}
        nudges={nudges}
        open={companionOpen}
        onOpenChange={setCompanionOpen}
        onSelectNudge={() => setCompanionOpen(true)}
      />
    );
  }

  const handleSendMessage = async (text: string) => {
    const targetSessionKey = activeSessionKey;
    const prevPersistedRecord = queryClient.getQueryData<HermesSessionRecord | null>([
      'hermes-session',
      targetSessionKey,
    ]);
    const prevPersistedList =
      prevPersistedRecord?.messages ?? prevPersistedRecord?.messages_json ?? [];
    const prevPersistedCount = Array.isArray(prevPersistedList) ? prevPersistedList.length : 0;
    const prevLastPersistedId =
      prevPersistedCount > 0 ? prevPersistedList[prevPersistedCount - 1]?.id : undefined;

    const seq = ++optimisticSeqRef.current;
    const userMsg: ScopedCompanionMessage = {
      id: `usr-${Date.now()}-${seq}`,
      sessionKey: targetSessionKey,
      role: 'user',
      content: text,
      isOptimisticTurn: true,
    };
    const asstId = `asst-${Date.now()}-${seq}`;
    setLocalMessages((prev) => [
      ...prev.filter((m) => m.sessionKey === targetSessionKey),
      userMsg,
      {
        id: asstId,
        sessionKey: targetSessionKey,
        role: 'assistant',
        content: '...',
        isStreaming: true,
        isOptimisticTurn: true,
      },
    ]);
    setIsStreaming(true);
    setAssistantStreaming(true);

    try {
      let streamedText = '';
      let streamedThinking = '';
      await streamHermesChat(
        {
          sessionKey: targetSessionKey,
          message: text,
          origin: 'frieren_popover',
          pageContext: {
            active_route: pathname,
            active_dashboard_id: safeActiveDashboardId,
            selected_entity_id: selectedEntityId,
          },
        },
        {
          onThinking: (thinkingText) => {
            streamedThinking = thinkingText;
            setLocalMessages((prev) =>
              prev.map((m) =>
                m.id === asstId ? { ...m, thinkingText: streamedThinking } : m,
              ),
            );
          },
          onToken: (delta) => {
            streamedText += delta;
            setLocalMessages((prev) =>
              prev.map((m) => (m.id === asstId ? { ...m, content: streamedText } : m)),
            );
          },
          onUndoAvailable: () => {
            queryClient.invalidateQueries({ queryKey: ['mcp-undo'] });
          },
          onApprovalRequired: () => {
            queryClient.invalidateQueries({ queryKey: ['mcp-approvals'] });
          },
          onDone: (finalText) => {
            setLocalMessages((prev) =>
              prev.map((m) =>
                m.id === asstId
                  ? {
                      ...m,
                      content: finalText,
                      thinkingText: streamedThinking || m.thinkingText,
                      isStreaming: false,
                    }
                  : m,
              ),
            );
          },
        },
      );

      await queryClient.refetchQueries({ queryKey: ['hermes-session', targetSessionKey] });
      const refreshed = queryClient.getQueryData<HermesSessionRecord | null>([
        'hermes-session',
        targetSessionKey,
      ]);
      const persisted = refreshed?.messages ?? refreshed?.messages_json ?? [];
      const nextCount = Array.isArray(persisted) ? persisted.length : 0;
      const nextLastId = nextCount > 0 ? persisted[nextCount - 1]?.id : undefined;
      if (nextCount > prevPersistedCount || (nextCount > 0 && nextLastId !== prevLastPersistedId)) {
        setLocalMessages((prev) => prev.filter((m) => m.sessionKey !== targetSessionKey));
      }

      queryClient.invalidateQueries({ queryKey: ['mcp-undo'] });
      queryClient.invalidateQueries({ queryKey: ['mcp-approvals'] });
    } catch {
      setLocalMessages((prev) =>
        prev.map((m) =>
          m.id === asstId
            ? {
                ...m,
                content: `[OFFLINE_MOCK] Tactical note recorded on ${pathname}.`,
                isStreaming: false,
              }
            : m,
        ),
      );
    } finally {
      setIsStreaming(false);
      setAssistantStreaming(false);
    }
  };

  return (
    <CompanionStage
      mode="popover"
      className="fixed bottom-4 right-4 z-50 w-[420px] max-w-[95vw]"
      online={dbOnline}
      gatewayMode={gatewayMode}
      scale={2}
      sessionKey={activeSessionKey}
      pageContext={pageContext}
      open={companionOpen}
      onOpenChange={setCompanionOpen}
      onExpandToHermes={(key) => {
        if (key) setActiveSessionKey(key);
        setCompanionOpen(false);
        onNavigate('/hermes');
      }}
      nudges={nudges}
      onDismissNudge={(id) => dismissNudgeMutation.mutate(id)}
      messages={combinedMessages}
      isStreaming={isStreaming}
      onSendMessage={handleSendMessage}
      undoActions={undoActions}
      onUndo={(undoId) => undoMutation.mutate(undoId)}
      pendingApprovals={pendingApprovals}
      onApprove={(id, payloadJson) => approveMutation.mutate({ id, payloadJson })}
      onReject={(id) => rejectMutation.mutate(id)}
    />
  );
}
