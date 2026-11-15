import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FuiBadge } from '../primitives/FuiBadge';
import { FuiButton } from '../primitives/FuiButton';
import { FuiFigureRow } from '../primitives/FuiFigureRow';
import { FuiInput } from '../primitives/FuiInput';
import { FuiPanelHeader } from '../primitives/FuiPanel';
import { FUI_TOKENS } from '../tokens';
import { PixelSprite } from './PixelSprite';
import {
  clampSpriteScale,
  DEFAULT_COMPANION_OFFLINE_PHRASES,
  FRIEREN_MINI_SHEET_URL,
  FRIEREN_MINI_SPRITE,
  FRIEREN_PORTRAIT_SHEET_URL,
  FRIEREN_PORTRAIT_SPRITE,
  resolveCompanionAnimationKey,
} from './registry';
import type { CompanionAnimationName, CompanionOfflinePhrase, CompanionStageProps } from './types';

const OFFLINE_ROTATION_POOL: readonly CompanionAnimationName[] = [
  'read_grimoire',
  'wind_blink_loop',
  'cast_blue_flora',
  'sip_tea',
  'cozy_nap',
  'mimic_gag',
];

export function CompanionStage({
  mode,
  online = true,
  gatewayMode = 'online',
  animation,
  scale = 2,
  ledgePositionPct = 82,
  nudges = [],
  onDismissNudge,
  onSelectNudge,
  sessionKey,
  pageContext,
  open = true,
  onOpenChange,
  onExpandToHermes,
  messages = [],
  isStreaming = false,
  onSendMessage,
  undoActions = [],
  onUndo,
  pendingApprovals = [],
  onApprove,
  onReject,
  children,
  offlinePhrases,
  queuedMutationsCount = 0,
  offlineTriggerSignal,
  customMiniSprite,
  customPortraitSprite,
  className,
  'data-testid': dataTestId,
}: CompanionStageProps) {
  const intScale = clampSpriteScale(scale);
  const phraseBank: readonly CompanionOfflinePhrase[] =
    offlinePhrases && offlinePhrases.length > 0
      ? offlinePhrases
      : DEFAULT_COMPANION_OFFLINE_PHRASES;

  const [phraseIndex, setPhraseIndex] = useState<number>(0);
  const [offlineAnim, setOfflineAnim] = useState<CompanionAnimationName>('read_grimoire');
  const [draftMessage, setDraftMessage] = useState<string>('');
  const lastTriggerRef = useRef<number | string | undefined>(offlineTriggerSignal);

  const cycleOfflineMotivation = useCallback(() => {
    setPhraseIndex((prev) => {
      if (phraseBank.length <= 1) return 0;
      // Guaranteed non-repeating consecutive selection
      const offset = 1 + Math.floor(Math.random() * (phraseBank.length - 1));
      return (prev + offset) % phraseBank.length;
    });
    setOfflineAnim((prevAnim) => {
      const candidates = OFFLINE_ROTATION_POOL.filter((a) => a !== prevAnim);
      const next = candidates[Math.floor(Math.random() * candidates.length)];
      return next ?? 'read_grimoire';
    });
  }, [phraseBank.length]);

  useEffect(() => {
    if (offlineTriggerSignal !== undefined && offlineTriggerSignal !== lastTriggerRef.current) {
      lastTriggerRef.current = offlineTriggerSignal;
      cycleOfflineMotivation();
    }
  }, [offlineTriggerSignal, cycleOfflineMotivation]);

  // Cmd+J / Ctrl+J global shortcut for Web popover mode
  useEffect(() => {
    if (mode !== 'popover' || !onOpenChange) return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, open, onOpenChange]);

  const activePhrase: CompanionOfflinePhrase =
    phraseBank[phraseIndex % phraseBank.length] ?? DEFAULT_COMPANION_OFFLINE_PHRASES[0]!;

  const miniDesc = customMiniSprite?.descriptor ?? FRIEREN_MINI_SPRITE;
  const miniUrl = customMiniSprite?.sheetUrl ?? FRIEREN_MINI_SHEET_URL;
  const portraitDesc = customPortraitSprite?.descriptor ?? FRIEREN_PORTRAIT_SPRITE;
  const portraitUrl = customPortraitSprite?.sheetUrl ?? FRIEREN_PORTRAIT_SHEET_URL;

  // ==========================================================================
  // MODE 1: 'ledge' (Perched 32x32 mini-sprite atop 3px #F87C18 shelf)
  // ==========================================================================
  if (mode === 'ledge') {
    const resolvedMiniAnim = resolveCompanionAnimationKey(animation ?? 'idle_ledge_sit', 'mini');
    const clampedPos = Math.min(94, Math.max(4, ledgePositionPct));

    return (
      <div
        data-testid={dataTestId ?? 'companion-stage-ledge'}
        data-fui="companion-stage"
        data-mode="ledge"
        className={className}
        style={{
          position: 'relative',
          width: '100%',
          paddingTop: `${32 * intScale + 4}px`,
          borderRadius: '0px',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: `${clampedPos}%`,
            bottom: '3px',
            transform: 'translateX(-50%)',
            display: 'inline-flex',
            alignItems: 'flex-end',
            gap: '4px',
            lineHeight: 0,
            borderRadius: '0px',
          }}
        >
          {nudges.length > 0 && (
            <button
              type="button"
              data-testid="companion-ledge-nudge-badge"
              aria-label={`${nudges.length} proactive Frieren nudge`}
              onClick={() => {
                if (nudges[0]) onSelectNudge?.(nudges[0]);
                onOpenChange?.(true);
              }}
              style={{
                padding: '2px 6px',
                backgroundColor: FUI_TOKENS.accentOrange,
                color: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.bgCarbon}`,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                borderRadius: '0px',
              }}
            >
              ! {nudges.length}
            </button>
          )}

          <PixelSprite
            data-testid="companion-mini-sprite"
            descriptor={miniDesc}
            sheetUrl={miniUrl}
            fallback={{ descriptor: FRIEREN_MINI_SPRITE, sheetUrl: FRIEREN_MINI_SHEET_URL }}
            animation={resolvedMiniAnim}
            scale={intScale}
            alt="Frieren Perched Companion"
            onClick={() => onOpenChange?.(!open)}
          />
        </div>

        {/* 3px #F87C18 Horizontal Shelf */}
        <div
          data-companion-ledge="true"
          style={{
            width: '100%',
            height: '3px',
            backgroundColor: FUI_TOKENS.accentOrange,
            borderRadius: '0px',
          }}
        />
      </div>
    );
  }

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draftMessage.trim();
    if (!trimmed) return;
    onSendMessage?.(trimmed, pageContext);
    setDraftMessage('');
  };

  // ==========================================================================
  // MODE 2 & 3: 'popover' (Web Cmd+J) & 'mobile' (Capacitor COMPANION tab)
  // ==========================================================================
  if (mode === 'popover' && !open) {
    return null;
  }

  const isMobileOffline = mode === 'mobile' && !online;
  const effectiveHint =
    animation ?? (isMobileOffline ? (activePhrase.animationHint ?? offlineAnim) : 'wind_blink_loop');
  const resolvedPortraitAnim = resolveCompanionAnimationKey(effectiveHint, 'portrait');
  const resolvedOfflineMiniAnim = resolveCompanionAnimationKey(effectiveHint, 'mini');

  return (
    <section
      data-testid={dataTestId ?? `companion-stage-${mode}`}
      data-fui="companion-stage"
      data-mode={mode}
      data-online={online ? 'true' : 'false'}
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: FUI_TOKENS.bgPanel,
        border: `1px solid ${FUI_TOKENS.borderHairline}`,
        color: FUI_TOKENS.inkStark,
        borderRadius: '0px',
        ...(mode === 'popover'
          ? { maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' as const }
          : {}),
      }}
    >
      <div
        style={
          mode === 'popover'
            ? {
                position: 'sticky',
                top: 0,
                zIndex: 10,
                backgroundColor: FUI_TOKENS.bgPanel,
                borderRadius: '0px',
              }
            : { borderRadius: '0px' }
        }
      >
        <FuiPanelHeader
          title="FRIEREN // MASTERMIND COMPANION"
          code={sessionKey ? `SESSION:${sessionKey}` : mode === 'mobile' ? (online ? 'IN_RANGE' : 'OFFLINE') : 'CMD+J'}
          accent={online ? 'orange' : 'amber'}
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', borderRadius: '0px' }}>
              {gatewayMode === 'offline_mock' && (
                <FuiBadge tone="amber">GATEWAY // OFFLINE_MOCK</FuiBadge>
              )}
              {/* Strictly Web-only ('popover'): NEVER render /hermes expansion in 'mobile' mode per 02-companion-app.md */}
              {mode === 'popover' && onExpandToHermes && (
                <FuiButton
                  data-testid="companion-expand-hermes"
                  variant="secondary"
                  size="sm"
                  onClick={() => onExpandToHermes(sessionKey)}
                >
                  Expand in Full Hermes View ↗
                </FuiButton>
              )}
              {mode === 'popover' && onOpenChange && (
                <FuiButton
                  variant="secondary"
                  size="sm"
                  aria-label="Close companion popover"
                  onClick={() => onOpenChange(false)}
                >
                  ✕
                </FuiButton>
              )}
            </div>
          }
        />
      </div>

      {/* Page Context Chip */}
      {pageContext && (
        <div
          data-testid="companion-page-context"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 10px',
            backgroundColor: FUI_TOKENS.bgCarbon,
            borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
            fontFamily: FUI_TOKENS.fontMono,
            fontSize: '12px',
            color: FUI_TOKENS.accentCyan,
            borderRadius: '0px',
          }}
        >
          <span>CTX // {pageContext.activeRoute}</span>
          {pageContext.selectedEntityLabel && <span>[{pageContext.selectedEntityLabel}]</span>}
        </div>
      )}

      {/* Atmospheric REF-14 Portrait Stage */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '12px',
          backgroundColor: '#050814',
          borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
          borderRadius: '0px',
        }}
      >
        <PixelSprite
          data-testid="companion-portrait-sprite"
          descriptor={portraitDesc}
          sheetUrl={portraitUrl}
          fallback={{ descriptor: FRIEREN_PORTRAIT_SPRITE, sheetUrl: FRIEREN_PORTRAIT_SHEET_URL }}
          animation={resolvedPortraitAnim}
          scale={intScale}
          alt="Frieren Nocturnal Portrait"
          onClick={isMobileOffline ? cycleOfflineMotivation : undefined}
        />

        {isMobileOffline && (
          <div
            style={{
              position: 'absolute',
              right: '12px',
              bottom: '12px',
              borderRadius: '0px',
            }}
          >
            <PixelSprite
              data-testid="companion-offline-mini-sprite"
              descriptor={miniDesc}
              sheetUrl={miniUrl}
              fallback={{ descriptor: FRIEREN_MINI_SPRITE, sheetUrl: FRIEREN_MINI_SHEET_URL }}
              animation={resolvedOfflineMiniAnim}
              scale={2}
              alt="Frieren Action Mini Sprite"
              onClick={cycleOfflineMotivation}
            />
          </div>
        )}
      </div>

      {/* Proactive Nudges Strip */}
      {nudges.length > 0 && (
        <div
          data-testid="companion-nudges-list"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            padding: '8px 10px',
            backgroundColor: FUI_TOKENS.bgCarbon,
            borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
            borderRadius: '0px',
            ...(mode === 'popover' ? { maxHeight: '96px', overflowY: 'auto' as const } : {}),
          }}
        >
          {nudges.map((nudge) => (
            <div
              key={nudge.id}
              data-testid={`companion-nudge-${nudge.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                padding: '6px 8px',
                backgroundColor: FUI_TOKENS.bgPanel,
                border: `1px solid ${FUI_TOKENS.accentOrange}`,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              <div>
                <strong style={{ color: FUI_TOKENS.accentOrange }}>[! {nudge.title}]</strong>{' '}
                <span>{nudge.message}</span>
              </div>
              {onDismissNudge && (
                <FuiButton size="sm" variant="ghost" onClick={() => onDismissNudge(nudge.id)}>
                  DISMISS
                </FuiButton>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Mobile Offline Mode vs Online Chat & Autonomy Cards */}
      {isMobileOffline ? (
        <div
          data-testid="companion-mobile-offline"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '12px',
            borderRadius: '0px',
          }}
        >
          <div
            data-testid="companion-offline-banner"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 10px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.accentAmber}`,
              color: FUI_TOKENS.accentAmber,
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              fontWeight: 700,
              borderRadius: '0px',
            }}
          >
            <span>[◌ OFFLINE_MODE — TAP FRIEREN FOR FIELD MOTIVATION]</span>
            {queuedMutationsCount > 0 && <span>QUEUED:{queuedMutationsCount}</span>}
          </div>

          <FuiFigureRow
            data-testid="companion-offline-speech-bubble"
            code="FRIEREN // FIELD_NOTE"
            title={activePhrase.phraseText}
            subtitle={`ANIMATION_LOOP // ${resolvedOfflineMiniAnim.toUpperCase()}`}
            active
            onSelect={cycleOfflineMotivation}
          />
        </div>
      ) : (
        <div
          data-testid="companion-online-chat"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '12px',
            borderRadius: '0px',
            ...(mode === 'popover' ? { maxHeight: '220px', overflowY: 'auto' as const } : {}),
          }}
        >
          {/* Messages Feed */}
          {messages.length > 0 && (
            <div
              data-testid="companion-messages"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                maxHeight: mode === 'popover' ? '120px' : '220px',
                overflowY: 'auto',
                borderRadius: '0px',
              }}
            >
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  data-testid={`companion-msg-${msg.id}`}
                  style={{
                    padding: '8px 10px',
                    backgroundColor: msg.role === 'user' ? FUI_TOKENS.bgCarbon : FUI_TOKENS.bgPlum,
                    border: `1px solid ${msg.role === 'user' ? FUI_TOKENS.borderHairline : FUI_TOKENS.borderPlum}`,
                    fontFamily: FUI_TOKENS.fontSans,
                    fontSize: '13px',
                    borderRadius: '0px',
                  }}
                >
                  {msg.thinkingText && (
                    <div
                      style={{
                        fontFamily: FUI_TOKENS.fontMono,
                        fontSize: '12px',
                        color: FUI_TOKENS.accentCyan,
                        marginBottom: '4px',
                        borderRadius: '0px',
                      }}
                    >
                      [THINKING] {msg.thinkingText}
                    </div>
                  )}
                  <div>{msg.content}</div>
                </div>
              ))}
            </div>
          )}

          {/* Tier 2 Immediate-Undo Action Cards */}
          {undoActions.map((u) => (
            <div
              key={u.undoId}
              data-testid={`companion-undo-${u.undoId}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                padding: '6px 10px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.accentPhosphor}`,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              <span>
                [✓ {u.toolName}] {u.summary}
              </span>
              {!u.undone && onUndo && (
                <FuiButton size="sm" variant="secondary" onClick={() => onUndo(u.undoId)}>
                  [Undo]
                </FuiButton>
              )}
            </div>
          ))}

          {/* Tier 3 Require-Approval Action Cards */}
          {pendingApprovals.map((req) => (
            <div
              key={req.id}
              data-testid={`companion-approval-${req.id}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                padding: '8px 10px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.accentOrange}`,
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              <div style={{ color: FUI_TOKENS.accentOrange, fontWeight: 700 }}>
                [APPROVAL_REQUIRED // {req.toolName}]
              </div>
              {req.summary && <div>{req.summary}</div>}
              <div style={{ display: 'flex', gap: '8px', borderRadius: '0px' }}>
                {onApprove && (
                  <FuiButton
                    size="sm"
                    variant="primary"
                    onClick={() => onApprove(req.id, req.payloadJson)}
                  >
                    [Approve]
                  </FuiButton>
                )}
                {onReject && (
                  <FuiButton size="sm" variant="danger" onClick={() => onReject(req.id)}>
                    [Reject]
                  </FuiButton>
                )}
              </div>
            </div>
          ))}

          {children}

          {onSendMessage && (
            <form
              onSubmit={handleSend}
              style={{ display: 'flex', gap: '6px', alignItems: 'center', borderRadius: '0px' }}
            >
              <div style={{ flex: 1, borderRadius: '0px' }}>
                <FuiInput
                  aria-label="Message Frieren"
                  placeholder="Ask Frieren or issue an /mcp command..."
                  value={draftMessage}
                  onChange={(e) => setDraftMessage(e.target.value)}
                  disabled={isStreaming}
                />
              </div>
              <FuiButton type="submit" variant="primary" disabled={isStreaming}>
                SEND
              </FuiButton>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
