import {
  CompanionStage,
  type CompanionAnimationHint,
  type CompanionApprovalRequest,
  type CompanionChatMessage,
  type CompanionNudge,
  type CompanionOfflinePhrase,
  type CompanionUndoAction,
  FUI_TOKENS,
  FuiBadge,
  FuiButton,
  FuiInput,
  FuiPanel,
  FuiPanelHeader,
} from '@hermes/ui';
import React, { useMemo, useState } from 'react';
import type { MobileOfflinePhraseRow } from '../db/sqliteEngine';

export const OFFLINE_ANIMATION_LOOPS: ReadonlyArray<{
  canonicalLabel:
    | 'idle_breeze'
    | 'read_grimoire'
    | 'cast_spell'
    | 'drink_tea'
    | 'sleep_lean'
    | 'celebrate_sparkle';
  spriteHint: CompanionAnimationHint;
}> = [
  { canonicalLabel: 'read_grimoire', spriteHint: 'read_grimoire' },
  { canonicalLabel: 'idle_breeze', spriteHint: 'wind_blink_loop' },
  { canonicalLabel: 'cast_spell', spriteHint: 'cast_blue_flora' },
  { canonicalLabel: 'drink_tea', spriteHint: 'sip_tea' },
  { canonicalLabel: 'sleep_lean', spriteHint: 'cozy_nap' },
  { canonicalLabel: 'celebrate_sparkle', spriteHint: 'mimic_gag' },
];

const QUICK_MCP_PROMPTS: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: '⚡ Summarize Today Todos', prompt: 'Summarize my tasks scheduled for today via /mcp' },
  { label: '🔥 Check Routine Streaks', prompt: 'Check my current routine adherence and streaks' },
  { label: '📋 Complete Top Priority', prompt: 'Complete my top priority todo task' },
];

export interface CompanionSurfaceProps {
  isOnline: boolean;
  gatewayMode: 'online' | 'offline_mock';
  sessionKey: string;
  offlinePhrases: MobileOfflinePhraseRow[];
  queuedMutationsCount: number;
  offlineTriggerSignal: number;
  messages: CompanionChatMessage[];
  isStreaming: boolean;
  undoActions: CompanionUndoAction[];
  pendingApprovals: CompanionApprovalRequest[];
  nudges: CompanionNudge[];
  onSendMessage: (message: string) => void;
  onUndo: (undoId: string) => void;
  onApprove: (approvalId: string, payloadJson?: Record<string, unknown> | string) => void;
  onReject: (approvalId: string) => void;
  onDismissNudge: (nudgeId: string) => void;
  onAddOfflinePhrase: (phraseText: string, animationHint: string) => void;
  onDeleteOfflinePhrase: (id: string) => void;
  onTriggerOfflineMotivation: () => void;
}

export function CompanionSurface({
  isOnline,
  gatewayMode,
  sessionKey,
  offlinePhrases,
  queuedMutationsCount,
  offlineTriggerSignal,
  messages,
  isStreaming,
  undoActions,
  pendingApprovals,
  nudges,
  onSendMessage,
  onUndo,
  onApprove,
  onReject,
  onDismissNudge,
  onAddOfflinePhrase,
  onDeleteOfflinePhrase,
  onTriggerOfflineMotivation,
}: CompanionSurfaceProps) {
  const [animLoopIndex, setAnimLoopIndex] = useState<number>(0);
  const [manualOverrideAnim, setManualOverrideAnim] = useState<boolean>(false);
  const [newPhraseInput, setNewPhraseInput] = useState<string>('');
  const [newPhraseAnim, setNewPhraseAnim] = useState<string>('grimoire');

  const mappedPhrases = useMemo<CompanionOfflinePhrase[]>(() => {
    return offlinePhrases.map((p) => ({
      id: p.id,
      phraseText: p.phrase_text,
      triggerContext: p.trigger_context,
      animationHint: (p.animation_hint as CompanionAnimationHint | null) ?? 'read_grimoire',
    }));
  }, [offlinePhrases]);

  const activeLoop =
    OFFLINE_ANIMATION_LOOPS[animLoopIndex % OFFLINE_ANIMATION_LOOPS.length] ??
    OFFLINE_ANIMATION_LOOPS[0]!;

  const handleCycleAnimation = () => {
    setManualOverrideAnim(true);
    setAnimLoopIndex((prev) => (prev + 1) % OFFLINE_ANIMATION_LOOPS.length);
  };

  const handleNextQuote = () => {
    setManualOverrideAnim(false);
    setAnimLoopIndex((prev) => (prev + 1) % OFFLINE_ANIMATION_LOOPS.length);
    onTriggerOfflineMotivation();
  };

  const handleAddPhraseSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPhraseInput.trim();
    if (!trimmed) return;
    onAddOfflinePhrase(trimmed, newPhraseAnim);
    setNewPhraseInput('');
  };

  return (
    <div
      data-testid="mobile-surface-companion"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        borderRadius: '0px',
      }}
    >
      {/* Shared @hermes/ui CompanionStage in strict 'mobile' mode (never passing onExpandToHermes) */}
      <CompanionStage
        mode="mobile"
        online={isOnline}
        gatewayMode={gatewayMode}
        animation={manualOverrideAnim ? activeLoop.spriteHint : undefined}
        scale={2}
        sessionKey={sessionKey}
        pageContext={{ activeRoute: '/companion' }}
        nudges={nudges}
        onDismissNudge={onDismissNudge}
        messages={messages}
        isStreaming={isStreaming}
        onSendMessage={(msg) => onSendMessage(msg)}
        undoActions={undoActions}
        onUndo={onUndo}
        pendingApprovals={pendingApprovals}
        onApprove={onApprove}
        onReject={onReject}
        offlinePhrases={mappedPhrases}
        queuedMutationsCount={queuedMutationsCount}
        offlineTriggerSignal={offlineTriggerSignal}
      >
        {isOnline && (
          <div
            data-testid="companion-mcp-quick-chips"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
              borderRadius: '0px',
            }}
          >
            {QUICK_MCP_PROMPTS.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => onSendMessage(chip.prompt)}
                disabled={isStreaming}
                style={{
                  padding: '6px 8px',
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  border: `1px solid ${FUI_TOKENS.accentCyan}`,
                  color: FUI_TOKENS.accentCyan,
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  cursor: 'pointer',
                  borderRadius: '0px',
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
      </CompanionStage>

      {/* Offline Animation & Quote Controls + Synced Phrase Bank */}
      {!isOnline && (
        <FuiPanel
          surface="panel"
          padding="sm"
          header={
            <FuiPanelHeader
              title="FIELD MOTIVATION // SPRITE & GRIMOIRE CONTROLS"
              code={`LOOP:${activeLoop.canonicalLabel.toUpperCase()}`}
              accent="amber"
            />
          }
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
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
              <FuiBadge tone="orange" data-testid="companion-active-loop-badge">
                LOOP // {activeLoop.canonicalLabel}
              </FuiBadge>
              <div style={{ display: 'flex', gap: '6px', borderRadius: '0px' }}>
                <FuiButton
                  size="sm"
                  variant="secondary"
                  data-testid="companion-cycle-anim-btn"
                  onClick={handleCycleAnimation}
                >
                  🎲 Cycle Animation
                </FuiButton>
                <FuiButton
                  size="sm"
                  variant="primary"
                  data-testid="companion-next-quote-btn"
                  onClick={handleNextQuote}
                >
                  💬 Next Quote
                </FuiButton>
              </div>
            </div>

            {/* Custom Offline Phrase Addition */}
            <form
              onSubmit={handleAddPhraseSubmit}
              style={{
                display: 'flex',
                gap: '6px',
                alignItems: 'center',
                borderRadius: '0px',
              }}
            >
              <div style={{ flex: 1, minWidth: 0, borderRadius: '0px' }}>
                <FuiInput
                  data-testid="companion-add-phrase-input"
                  aria-label="Add custom offline Frieren quote"
                  placeholder="Add custom field quote to grimoire..."
                  value={newPhraseInput}
                  onChange={(e) => setNewPhraseInput(e.target.value)}
                />
              </div>
              <select
                aria-label="Animation hint"
                data-testid="companion-add-phrase-anim"
                value={newPhraseAnim}
                onChange={(e) => setNewPhraseAnim(e.target.value)}
                style={{
                  height: '34px',
                  padding: '0 8px',
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  color: FUI_TOKENS.inkStark,
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  borderRadius: '0px',
                }}
              >
                <option value="grimoire">grimoire</option>
                <option value="stargazing">stargazing</option>
                <option value="blue_flower_spell">blue_flower_spell</option>
                <option value="tea">tea</option>
                <option value="nod_off">nod_off</option>
                <option value="mimic_gag">mimic_gag</option>
              </select>
              <FuiButton
                type="submit"
                size="sm"
                variant="secondary"
                data-testid="companion-add-phrase-btn"
              >
                + ADD
              </FuiButton>
            </form>

            {/* Custom Phrases List */}
            {offlinePhrases.filter((p) => !p.is_builtin).length > 0 && (
              <div
                data-testid="companion-custom-phrases-list"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  borderRadius: '0px',
                }}
              >
                {offlinePhrases
                  .filter((p) => !p.is_builtin)
                  .map((phrase) => (
                    <div
                      key={phrase.id}
                      data-testid={`companion-custom-phrase-${phrase.id}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        padding: '6px 8px',
                        backgroundColor: FUI_TOKENS.bgCarbon,
                        border: `1px solid ${FUI_TOKENS.borderHairline}`,
                        fontFamily: FUI_TOKENS.fontMono,
                        fontSize: '12px',
                        borderRadius: '0px',
                      }}
                    >
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          borderRadius: '0px',
                        }}
                      >
                        {phrase.phrase_text}
                      </span>
                      <button
                        type="button"
                        data-testid={`companion-delete-phrase-${phrase.id}`}
                        onClick={() => onDeleteOfflinePhrase(phrase.id)}
                        style={{
                          padding: '2px 6px',
                          backgroundColor: FUI_TOKENS.bgPanel,
                          border: `1px solid ${FUI_TOKENS.borderHairline}`,
                          color: FUI_TOKENS.inkMuted,
                          fontFamily: FUI_TOKENS.fontMono,
                          fontSize: '12px',
                          cursor: 'pointer',
                          borderRadius: '0px',
                        }}
                      >
                        DELETE
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </FuiPanel>
      )}
    </div>
  );
}
