import React from 'react';
import { FUI_TOKENS } from '@hermes/ui';
import type { ArenaZone, UiSkillPolicyMode } from '../../api/agents';
import {
  ARENA_ZONES,
  ARCHETYPE_DESCRIPTORS,
  STANDARD_SKILL_SLOTS,
  resolveSkillSlotMode,
  type ComputedKnightTelemetry,
  type SkillSlotDescriptor,
} from './knightsModel';

export interface SkillSlotHudProps {
  selectedKnight: ComputedKnightTelemetry | null;
  onChangeSkillPolicy: (slot: SkillSlotDescriptor, nextMode: UiSkillPolicyMode) => void;
  onOpenForgeEdit: (knight: ComputedKnightTelemetry) => void;
  onQuickDeployZone: (knight: ComputedKnightTelemetry, zone: ArenaZone) => void;
  isSavingPolicy?: boolean;
}

const MODE_COLORS: Record<UiSkillPolicyMode, { border: string; bg: string; text: string; label: string }> = {
  READ: {
    border: FUI_TOKENS.accentCyan,
    bg: 'rgba(44, 229, 242, 0.14)',
    text: FUI_TOKENS.accentCyan,
    label: 'READ',
  },
  APPROVE: {
    border: FUI_TOKENS.accentAmber,
    bg: 'rgba(245, 158, 11, 0.16)',
    text: FUI_TOKENS.accentAmber,
    label: 'APPROVE',
  },
  AUTO: {
    border: FUI_TOKENS.accentOrange,
    bg: 'rgba(248, 124, 24, 0.18)',
    text: FUI_TOKENS.accentOrange,
    label: 'AUTO',
  },
  NONE: {
    border: FUI_TOKENS.borderHairline,
    bg: 'rgba(13, 14, 19, 0.85)',
    text: FUI_TOKENS.inkMuted,
    label: 'NONE',
  },
};

function cycleMode(current: UiSkillPolicyMode): UiSkillPolicyMode {
  if (current === 'READ') return 'APPROVE';
  if (current === 'APPROVE') return 'AUTO';
  if (current === 'AUTO') return 'READ';
  return 'READ';
}

function slotTestKey(slotKey: string): string {
  return slotKey.replace(/\.\*$/, '');
}

export function SkillSlotHud({
  selectedKnight,
  onChangeSkillPolicy,
  onOpenForgeEdit,
  onQuickDeployZone,
  isSavingPolicy = false,
}: SkillSlotHudProps): React.ReactElement {
  if (!selectedKnight) {
    return (
      <section
        data-testid="knights-skill-hud"
        data-fui="knight-skill-hud"
        style={{
          backgroundColor: FUI_TOKENS.bgPanel,
          border: `1px solid ${FUI_TOKENS.borderHairline}`,
          borderRadius: '0px',
          padding: '12px 14px',
          color: FUI_TOKENS.inkMuted,
          fontFamily: FUI_TOKENS.fontMono,
          fontSize: '12px',
        }}
      >
        SELECT A KNIGHT ON THE ISOMETRIC ARENA BOARD TO INSPECT SKILL SLOTS &amp; AUTONOMY GATES.
      </section>
    );
  }

  const archetypeMeta =
    ARCHETYPE_DESCRIPTORS.find((a) => a.archetype === selectedKnight.archetype) ??
    ARCHETYPE_DESCRIPTORS[0];
  const zoneMeta =
    ARENA_ZONES.find((z) => z.zone === selectedKnight.zone) ?? ARENA_ZONES[0];

  const handleModeButtonClick = (
    slot: SkillSlotDescriptor,
    currentMode: UiSkillPolicyMode,
    clickedMode: UiSkillPolicyMode,
  ) => {
    const targetMode = currentMode === clickedMode ? cycleMode(currentMode) : clickedMode;
    onChangeSkillPolicy(slot, targetMode);
  };

  return (
    <section
      data-testid="knights-skill-hud"
      data-fui="knight-skill-hud"
      aria-label="Knight RPG Skill-Slot HUD"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(260px, 310px) 1fr',
        gap: '12px',
        backgroundColor: FUI_TOKENS.bgPanel,
        border: `1px solid ${FUI_TOKENS.borderHairline}`,
        borderRadius: '0px',
        padding: '12px 14px',
      }}
    >
      {/* Left Column: Selected Knight Unit Telemetry Card */}
      <div
        data-testid="selected-knight-card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '10px',
          padding: '10px 12px',
          backgroundColor: FUI_TOKENS.bgCarbon,
          border: `1px solid ${selectedKnight.crestColor || archetypeMeta.defaultCrest}`,
          borderRadius: '0px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                color: selectedKnight.crestColor || archetypeMeta.defaultCrest,
                textTransform: 'uppercase',
              }}
            >
              [{selectedKnight.archetype.toUpperCase()}] // {archetypeMeta.roleTitle}
            </span>
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: zoneMeta.accentHex,
                border: `1px solid ${zoneMeta.accentHex}`,
                padding: '1px 6px',
                borderRadius: '0px',
              }}
            >
              {zoneMeta.shortLabel} ({selectedKnight.gridX},{selectedKnight.gridY})
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
            <div
              data-testid="selected-knight-name"
              style={{
                fontFamily: FUI_TOKENS.fontSans,
                fontSize: '16px',
                fontWeight: 700,
                color: FUI_TOKENS.inkStark,
              }}
            >
              {selectedKnight.name}
            </div>
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkMuted,
              }}
            >
              {selectedKnight.model} · {selectedKnight.thinkingEffort.toUpperCase()}
            </span>
          </div>

          {/* HP Bar: Monthly Budget Remaining / Total */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '2px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  fontWeight: 600,
                  color: selectedKnight.isCircuitBroken
                    ? FUI_TOKENS.accentVermilion
                    : FUI_TOKENS.accentPhosphor,
                }}
              >
                HP // BUDGET
              </span>
              <span
                data-testid="selected-knight-hp-label"
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  fontWeight: 700,
                  color: FUI_TOKENS.inkStark,
                }}
              >
                {selectedKnight.hpLabel}
              </span>
            </div>
            <div
              style={{
                width: '100%',
                height: '8px',
                backgroundColor: FUI_TOKENS.bgPanel,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderRadius: '0px',
              }}
            >
              <div
                style={{
                  width: `${selectedKnight.hpPct}%`,
                  height: '100%',
                  backgroundColor: selectedKnight.isCircuitBroken
                    ? FUI_TOKENS.accentVermilion
                    : selectedKnight.hpPct < 25
                      ? FUI_TOKENS.accentAmber
                      : FUI_TOKENS.accentPhosphor,
                  borderRadius: '0px',
                }}
              />
            </div>
          </div>

          {/* EP Bar: Context Window Load */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  fontWeight: 600,
                  color: FUI_TOKENS.accentCyan,
                }}
              >
                EP // CONTEXT
              </span>
              <span
                data-testid="selected-knight-ep-label"
                style={{
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  fontWeight: 700,
                  color: FUI_TOKENS.inkStark,
                }}
              >
                {selectedKnight.epLabel}
              </span>
            </div>
            <div
              style={{
                width: '100%',
                height: '8px',
                backgroundColor: FUI_TOKENS.bgPanel,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderRadius: '0px',
              }}
            >
              <div
                style={{
                  width: `${selectedKnight.epPct}%`,
                  height: '100%',
                  backgroundColor: FUI_TOKENS.accentCyan,
                  borderRadius: '0px',
                }}
              />
            </div>
          </div>

          {/* Circuit Breaker or Barracks Status Notice */}
          {(selectedKnight.isCircuitBroken || selectedKnight.isPaused) && (
            <div
              data-testid="selected-knight-circuit-breaker"
              style={{
                padding: '4px 8px',
                backgroundColor: selectedKnight.isCircuitBroken
                  ? 'rgba(235, 69, 17, 0.16)'
                  : 'rgba(138, 144, 158, 0.14)',
                border: `1px solid ${
                  selectedKnight.isCircuitBroken
                    ? FUI_TOKENS.accentVermilion
                    : FUI_TOKENS.inkMuted
                }`,
                borderRadius: '0px',
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: selectedKnight.isCircuitBroken
                  ? FUI_TOKENS.accentVermilion
                  : FUI_TOKENS.inkMuted,
              }}
            >
              {selectedKnight.isCircuitBroken
                ? '⚡ CIRCUIT BREAKER TRIPPED // HP $0.00 — Background triggers halted until budget raise or reset.'
                : '💤 STANDBY BARRACKS // Paused — Zero tokens consumed; excluded from Turn-Order Queue.'}
            </div>
          )}

          {/* System Oath Preview */}
          <div
            data-testid="selected-knight-oath"
            style={{
              padding: '6px 8px',
              backgroundColor: FUI_TOKENS.bgPanel,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              borderRadius: '0px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              color: FUI_TOKENS.inkProse,
              maxHeight: '56px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            OATH: {selectedKnight.systemPrompt || 'Maintain Life Ops telemetry and execute assigned domain triggers.'}
          </div>
        </div>

        {/* Unit Action Buttons */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          <button
            type="button"
            data-testid="edit-knight-btn"
            onClick={() => onOpenForgeEdit(selectedKnight)}
            style={{
              flex: 1,
              padding: '6px 10px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              fontWeight: 700,
              color: FUI_TOKENS.inkStark,
              backgroundColor: 'rgba(248, 124, 24, 0.18)',
              border: `1px solid ${FUI_TOKENS.accentOrange}`,
              borderRadius: '0px',
              cursor: 'pointer',
            }}
          >
            [✎ OPEN FORGE]
          </button>

          <button
            type="button"
            data-testid="toggle-pause-knight-btn"
            onClick={() =>
              onQuickDeployZone(
                selectedKnight,
                selectedKnight.zone === 'standby_barracks' ? 'cron_watchtower' : 'standby_barracks',
              )
            }
            style={{
              padding: '6px 10px',
              fontFamily: FUI_TOKENS.fontMono,
              fontSize: '12px',
              fontWeight: 600,
              color:
                selectedKnight.zone === 'standby_barracks'
                  ? FUI_TOKENS.accentPhosphor
                  : FUI_TOKENS.inkMuted,
              backgroundColor: FUI_TOKENS.bgPanel,
              border: `1px solid ${
                selectedKnight.zone === 'standby_barracks'
                  ? FUI_TOKENS.accentPhosphor
                  : FUI_TOKENS.borderHairline
              }`,
              borderRadius: '0px',
              cursor: 'pointer',
            }}
          >
            {selectedKnight.zone === 'standby_barracks' ? '[⚡ MOBILIZE]' : '[💤 BARRACKS]'}
          </button>
        </div>
      </div>

      {/* Right Column: RPG Skill-Slot HUD Matrix */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
            borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
            paddingBottom: '6px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                fontWeight: 700,
                color: FUI_TOKENS.accentOrange,
              }}
            >
              RPG SKILL-SLOT HUD // /MCP TOOL AUTONOMY GATES
            </span>
            <span
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.inkMuted,
              }}
            >
              (Click slot or gate badge to toggle READ · APPROVE · AUTO)
            </span>
          </div>
          {isSavingPolicy && (
            <span
              data-testid="skill-hud-saving-indicator"
              style={{
                fontFamily: FUI_TOKENS.fontMono,
                fontSize: '12px',
                color: FUI_TOKENS.accentCyan,
              }}
            >
              SYNCING POLICY...
            </span>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(215px, 1fr))',
            gap: '8px',
          }}
        >
          {STANDARD_SKILL_SLOTS.map((slot, index) => {
            const currentMode = resolveSkillSlotMode(selectedKnight.toolsPolicy, slot);
            const modeStyle = MODE_COLORS[currentMode];
            const nextMode = cycleMode(currentMode);
            const shortKey = slotTestKey(slot.key);

            return (
              <div
                key={slot.key}
                data-testid={`skill-slot-${shortKey}`}
                data-skill-slot={slot.key}
                data-skill-mode={currentMode}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '6px',
                  padding: '8px 10px',
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  border: `1px solid ${modeStyle.border}`,
                  borderRadius: '0px',
                }}
              >
                {/* Primary Skill Slot Cycle Button */}
                <button
                  type="button"
                  data-testid={`skill-slot-cycle-${shortKey}`}
                  onClick={() => onChangeSkillPolicy(slot, nextMode)}
                  title={`Cycle ${slot.key} from ${currentMode} to ${nextMode}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '6px',
                    width: '100%',
                    padding: '4px 6px',
                    backgroundColor: modeStyle.bg,
                    border: `1px solid ${modeStyle.border}`,
                    borderRadius: '0px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: FUI_TOKENS.fontMono,
                    fontSize: '12px',
                    color: FUI_TOKENS.inkStark,
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: '12px' }}>
                    S{index + 1} {slot.label}
                  </span>
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: '12px',
                      color: modeStyle.text,
                    }}
                  >
                    [{modeStyle.label} ↻]
                  </span>
                </button>

                <div
                  style={{
                    fontFamily: FUI_TOKENS.fontSans,
                    fontSize: '12px',
                    color: FUI_TOKENS.inkMuted,
                  }}
                >
                  {slot.subtitle}
                </div>

                {/* Explicit Segmented Policy Mode Buttons */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                  {(['READ', 'APPROVE', 'AUTO', 'NONE'] as const).map((mode) => {
                    const active = currentMode === mode;
                    const styleMeta = MODE_COLORS[mode];
                    return (
                      <button
                        key={mode}
                        type="button"
                        data-testid={`skill-policy-${shortKey}-${mode.toLowerCase()}`}
                        aria-pressed={active}
                        onClick={() => handleModeButtonClick(slot, currentMode, mode)}
                        style={{
                          padding: '3px 4px',
                          fontFamily: FUI_TOKENS.fontMono,
                          fontSize: '12px',
                          fontWeight: active ? 700 : 500,
                          color: active ? styleMeta.text : FUI_TOKENS.inkMuted,
                          backgroundColor: active ? styleMeta.bg : FUI_TOKENS.bgPanel,
                          border: `1px solid ${active ? styleMeta.border : FUI_TOKENS.borderHairline}`,
                          borderRadius: '0px',
                          cursor: 'pointer',
                        }}
                      >
                        {mode}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
