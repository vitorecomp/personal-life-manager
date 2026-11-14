import React from 'react';
import { FUI_TOKENS } from '../tokens';
import { PixelSprite } from './PixelSprite';
import {
  clampSpriteScale,
  KNIGHTS_ISOMETRIC_SHEET_URL,
  KNIGHTS_ISOMETRIC_SPRITE,
} from './registry';
import type { IsometricKnightSpriteProps, KnightAnimState, KnightArchetype } from './types';

const VALID_ARCHETYPES: readonly KnightArchetype[] = [
  'paladin',
  'vanguard',
  'lore_warden',
  'inquisitor',
  'artificer',
];

const VALID_STATES: readonly KnightAnimState[] = ['idle', 'cast', 'alert', 'barracks_rest'];

export function IsometricKnightSprite({
  archetype,
  state = 'idle',
  scale = 2,
  name,
  crestColor = FUI_TOKENS.accentOrange,
  hpPct,
  epPct,
  hasAlert,
  active = false,
  selected = false,
  showHud,
  customSprite,
  onClick,
  className,
  'data-testid': dataTestId,
}: IsometricKnightSpriteProps) {
  const safeArchetype: KnightArchetype = VALID_ARCHETYPES.includes(archetype) ? archetype : 'paladin';
  const safeState: KnightAnimState = VALID_STATES.includes(state) ? state : 'idle';
  const intScale = clampSpriteScale(scale);
  const animKey = `${safeArchetype}_${safeState}`;

  const desc = customSprite?.descriptor ?? KNIGHTS_ISOMETRIC_SPRITE;
  const url = customSprite?.sheetUrl ?? KNIGHTS_ISOMETRIC_SHEET_URL;

  const shouldShowAlert = Boolean(hasAlert || safeState === 'alert');
  const shouldShowHud = showHud ?? Boolean(hpPct !== undefined || epPct !== undefined || name);
  const clampedHp = hpPct !== undefined && Number.isFinite(hpPct) ? Math.min(100, Math.max(0, Math.round(hpPct))) : 100;
  const clampedEp = epPct !== undefined && Number.isFinite(epPct) ? Math.min(100, Math.max(0, Math.round(epPct))) : 0;

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      data-testid={dataTestId}
      data-fui="isometric-knight-sprite"
      data-archetype={safeArchetype}
      data-state={safeState}
      data-active={active ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      className={className}
      style={{
        position: 'relative',
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '4px',
        fontFamily: FUI_TOKENS.fontMono,
        fontSize: '12px',
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: '0px',
      }}
    >
      {/* Active Turn Chevron or [!] Alert Bubble */}
      <div
        style={{
          minHeight: '18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          borderRadius: '0px',
        }}
      >
        {active && (
          <span
            data-knight-part="active-chevron"
            style={{
              padding: '0 4px',
              backgroundColor: FUI_TOKENS.accentOrange,
              color: FUI_TOKENS.bgCarbon,
              fontSize: '12px',
              fontWeight: 700,
              borderRadius: '0px',
            }}
          >
            ▼ ACTIVE
          </span>
        )}
        {shouldShowAlert && (
          <span
            data-knight-part="alert-bubble"
            style={{
              padding: '0 5px',
              backgroundColor: FUI_TOKENS.inkStark,
              color: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.bgCarbon}`,
              fontSize: '12px',
              fontWeight: 700,
              borderRadius: '0px',
            }}
          >
            [!]
          </span>
        )}
        {clampedHp === 0 && (
          <span
            data-knight-part="budget-exhausted"
            style={{
              padding: '0 4px',
              backgroundColor: FUI_TOKENS.accentVermilion,
              color: FUI_TOKENS.inkStark,
              fontSize: '12px',
              fontWeight: 700,
              borderRadius: '0px',
            }}
          >
            [BUDGET_0]
          </span>
        )}
      </div>

      {/* Isometric 2:1 Diamond Base Cursor + PixelSprite */}
      <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0, borderRadius: '0px' }}>
        {(active || selected) && (
          <svg
            data-knight-part="isometric-cursor"
            width={48 * intScale}
            height={24 * intScale}
            viewBox="0 0 96 48"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              bottom: '2px',
              pointerEvents: 'none',
              borderRadius: '0px',
            }}
          >
            <polygon
              points="48,4 90,24 48,44 6,24"
              fill="none"
              stroke={active ? FUI_TOKENS.inkStark : FUI_TOKENS.accentCyan}
              strokeWidth="2.5"
            />
          </svg>
        )}

        <PixelSprite
          descriptor={desc}
          sheetUrl={url}
          fallback={{ descriptor: KNIGHTS_ISOMETRIC_SPRITE, sheetUrl: KNIGHTS_ISOMETRIC_SHEET_URL }}
          animation={animKey}
          scale={intScale}
          alt={name ? `${name} (${safeArchetype})` : `Knight ${safeArchetype}`}
        />
      </div>

      {/* Knight HUD: Crest Badge + Name + HP/EP Bars */}
      {shouldShowHud && (
        <div
          data-knight-part="hud"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            width: '100%',
            minWidth: '88px',
            marginTop: '4px',
            padding: '4px 6px',
            backgroundColor: FUI_TOKENS.bgCarbon,
            border: `1px solid ${FUI_TOKENS.borderHairline}`,
            borderRadius: '0px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', borderRadius: '0px' }}>
            <span
              data-knight-part="crest-badge"
              style={{
                width: '8px',
                height: '8px',
                backgroundColor: crestColor,
                flexShrink: 0,
                borderRadius: '0px',
              }}
            />
            <span
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: FUI_TOKENS.inkStark,
                textTransform: 'uppercase',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                borderRadius: '0px',
              }}
            >
              {name ?? safeArchetype}
            </span>
          </div>

          {hpPct !== undefined && (
            <div
              data-knight-part="hp-bar"
              data-hp-pct={clampedHp}
              style={{
                height: '4px',
                width: '100%',
                backgroundColor: FUI_TOKENS.borderHairline,
                borderRadius: '0px',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${clampedHp}%`,
                  backgroundColor: FUI_TOKENS.accentVermilion,
                  borderRadius: '0px',
                }}
              />
            </div>
          )}

          {epPct !== undefined && (
            <div
              data-knight-part="ep-bar"
              data-ep-pct={clampedEp}
              style={{
                height: '4px',
                width: '100%',
                backgroundColor: FUI_TOKENS.borderHairline,
                borderRadius: '0px',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${clampedEp}%`,
                  backgroundColor: FUI_TOKENS.accentCyan,
                  borderRadius: '0px',
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
