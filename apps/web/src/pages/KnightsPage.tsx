import React from 'react';
import { FuiPanel, FUI_TOKENS, IsometricKnightSprite } from '@hermes/ui';

const STARTER_KNIGHTS = [
  {
    id: 'librarian',
    name: 'SIR ALDRIC // LIBRARIAN',
    archetype: 'lore_warden' as const,
    state: 'idle' as const,
    hpPct: 96,
    epPct: 82,
  },
  {
    id: 'strategist',
    name: 'LADY VERA // STRATEGIST',
    archetype: 'paladin' as const,
    state: 'cast' as const,
    hpPct: 88,
    epPct: 74,
  },
  {
    id: 'sentry',
    name: 'VANGUARD Kael // SENTRY',
    archetype: 'vanguard' as const,
    state: 'alert' as const,
    hpPct: 91,
    epPct: 65,
  },
  {
    id: 'chronicler',
    name: 'INQUISITOR ORIN // CHRONICLER',
    archetype: 'inquisitor' as const,
    state: 'barracks_rest' as const,
    hpPct: 100,
    epPct: 40,
  },
];

export function KnightsPage() {
  return (
    <div
      data-testid="knights-page"
      style={{
        flex: 1,
        padding: '16px',
        backgroundColor: FUI_TOKENS.bgArena,
        color: FUI_TOKENS.inkStark,
        borderRadius: '0px',
      }}
    >
      <FuiPanel
        surface="arena"
        headerTitle="AGENT STUDIO // ISOMETRIC TACTICAL RPG ARENA (REF-13)"
        headerProps={{
          title: 'AGENT STUDIO // ISOMETRIC TACTICAL RPG ARENA (REF-13)',
          code: 'MOD_05',
          accent: 'orange',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '16px',
            padding: '12px',
          }}
        >
          {STARTER_KNIGHTS.map((knight, idx) => (
            <div
              key={knight.id}
              data-testid={`knight-unit-${knight.id}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                padding: '14px',
                backgroundColor: FUI_TOKENS.bgPanel,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
              }}
            >
              <IsometricKnightSprite
                archetype={knight.archetype}
                state={knight.state}
                scale={2}
                name={knight.name}
                hpPct={knight.hpPct}
                epPct={knight.epPct}
                active={idx === 0}
                showHud
              />
            </div>
          ))}
        </div>
      </FuiPanel>
    </div>
  );
}
