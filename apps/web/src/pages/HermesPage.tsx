import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FuiBadge,
  FuiButton,
  FuiPanel,
  FUI_TOKENS,
  GeodesicThinkingOrb,
} from '@hermes/ui';
import {
  apiGet,
  streamHermesChat,
  unwrapList,
  type HermesMessageRecord,
  type HermesSessionRecord,
} from '../api/client';
import { useAppStore } from '../store/appStore';

export function HermesPage() {
  const queryClient = useQueryClient();
  const activeSessionKey = useAppStore((s) => s.activeSessionKey);
  const setActiveSessionKey = useAppStore((s) => s.setActiveSessionKey);
  const setAssistantStreaming = useAppStore((s) => s.setAssistantStreaming);

  const [highLevelPlan, setHighLevelPlan] = useState(true);
  const [draft, setDraft] = useState('');
  const [localReply, setLocalReply] = useState<{ sessionKey: string; content: string } | null>(
    null,
  );
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    setLocalReply(null);
  }, [activeSessionKey]);

  const { data: sessions = [] } = useQuery({
    queryKey: ['hermes-sessions'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/hermes/sessions');
        return unwrapList<HermesSessionRecord>(res, ['sessions']);
      } catch {
        return [];
      }
    },
  });

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
    enabled: Boolean(activeSessionKey),
  });

  const messages: HermesMessageRecord[] =
    sessionDetail?.messages ?? sessionDetail?.messages_json ?? [];

  const visibleLocalReply =
    localReply &&
    localReply.sessionKey === activeSessionKey &&
    !messages.some((m) => m.role === 'assistant' && m.content.trim() === localReply.content.trim())
      ? localReply.content
      : null;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    const targetSessionKey = activeSessionKey;
    setDraft('');
    setIsStreaming(true);
    setAssistantStreaming(true);
    try {
      let liveAccumulated = '';
      const reply = await streamHermesChat(
        {
          sessionKey: targetSessionKey,
          message: trimmed,
          origin: 'hermes_view',
          highLevelMode: highLevelPlan,
          pageContext: { active_route: '/hermes' },
        },
        {
          onToken: (delta) => {
            liveAccumulated += delta;
            setLocalReply({ sessionKey: targetSessionKey, content: liveAccumulated });
          },
        },
      );
      setLocalReply({ sessionKey: targetSessionKey, content: reply });
      await queryClient.refetchQueries({ queryKey: ['hermes-session', targetSessionKey] });
      const refreshed = queryClient.getQueryData<HermesSessionRecord | null>([
        'hermes-session',
        targetSessionKey,
      ]);
      const persisted = refreshed?.messages ?? refreshed?.messages_json ?? [];
      if (Array.isArray(persisted) && persisted.length > 0) {
        setLocalReply((prev) => (prev?.sessionKey === targetSessionKey ? null : prev));
      }
      queryClient.invalidateQueries({ queryKey: ['hermes-sessions'] });
    } catch {
      setLocalReply({
        sessionKey: targetSessionKey,
        content: `[OFFLINE_MOCK] Processed "${trimmed}" under session ${targetSessionKey}.`,
      });
    } finally {
      setIsStreaming(false);
      setAssistantStreaming(false);
    }
  };

  return (
    <div
      data-testid="hermes-page"
      style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '280px minmax(0, 1fr)',
        gap: '12px',
        padding: '16px',
        backgroundColor: FUI_TOKENS.bgCarbon,
        color: FUI_TOKENS.inkStark,
        borderRadius: '0px',
      }}
    >
      {/* Unified X-Hermes-Session-Key Sidebar */}
      <aside
        aria-label="Hermes Sessions"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          backgroundColor: FUI_TOKENS.bgPanel,
          border: `1px solid ${FUI_TOKENS.borderHairline}`,
          padding: '12px',
          borderRadius: '0px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: '12px', color: FUI_TOKENS.accentOrange }}>
            SESSIONS // X-KEY
          </strong>
          <FuiBadge tone="cyan">{activeSessionKey}</FuiBadge>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {sessions.map((s) => (
            <button
              key={s.session_key}
              type="button"
              onClick={() => setActiveSessionKey(s.session_key)}
              style={{
                textAlign: 'left',
                padding: '6px 8px',
                fontSize: '12px',
                fontFamily: FUI_TOKENS.fontMono,
                backgroundColor:
                  s.session_key === activeSessionKey ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgCarbon,
                color:
                  s.session_key === activeSessionKey ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                cursor: 'pointer',
                borderRadius: '0px',
              }}
            >
              {s.title || s.session_key}
            </button>
          ))}
        </div>
      </aside>

      {/* Main Hermes Workspace & REF-08 Geodesic Thinking Orb */}
      <FuiPanel
        headerTitle="HERMES // INTELLIGENCE WORKSPACE"
        headerProps={{
          title: 'HERMES // INTELLIGENCE WORKSPACE',
          code: 'MOD_04',
          accent: 'orange',
          actions: (
            <button
              type="button"
              data-testid="high-level-plan-toggle"
              aria-label="Toggle High-Level Thinking Orb"
              onClick={() => setHighLevelPlan((prev) => !prev)}
              style={{
                padding: '4px 10px',
                fontSize: '12px',
                fontFamily: FUI_TOKENS.fontMono,
                fontWeight: 700,
                backgroundColor: highLevelPlan ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgCarbon,
                color: highLevelPlan ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                border: `1px solid ${FUI_TOKENS.accentOrange}`,
                cursor: 'pointer',
                borderRadius: '0px',
              }}
            >
              HIGH_LEVEL_PLAN
            </button>
          ),
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {highLevelPlan && (
            <div
              data-fui-orb="true"
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '12px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
              }}
            >
              <GeodesicThinkingOrb size={200} subdivisions={2} reasoningState="thinking" />
            </div>
          )}

          <div
            data-testid="hermes-transcript"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              minHeight: '140px',
              padding: '10px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
            }}
          >
            {messages.map((m, i) => (
              <div
                key={m.id ?? i}
                style={{
                  padding: '6px 8px',
                  backgroundColor: FUI_TOKENS.bgPanel,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  fontSize: '13px',
                }}
              >
                <strong style={{ color: FUI_TOKENS.accentOrange }}>
                  [{String(m.role || 'assistant').toUpperCase()}]
                </strong>{' '}
                <span>{m.content}</span>
              </div>
            ))}
            {visibleLocalReply && (
              <div
                style={{
                  padding: '6px 8px',
                  backgroundColor: FUI_TOKENS.bgPanel,
                  border: `1px solid ${FUI_TOKENS.accentCyan}`,
                  fontSize: '13px',
                }}
              >
                {visibleLocalReply}
              </div>
            )}
          </div>

          <form onSubmit={handleSend} style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <textarea
              data-testid="hermes-composer"
              aria-label="Hermes Command Composer"
              placeholder="Issue high-level directive or /mcp query..."
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{
                flex: 1,
                padding: '8px 10px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                color: FUI_TOKENS.inkStark,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '13px',
              }}
            />
            <FuiButton type="submit" variant="primary" disabled={isStreaming}>
              SEND
            </FuiButton>
          </form>
        </div>
      </FuiPanel>
    </div>
  );
}
