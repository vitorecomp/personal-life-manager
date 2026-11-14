import React from 'react';
import { FuiBadge, FuiPanel, FUI_TOKENS } from '@hermes/ui';

export function GoalsPage() {
  return (
    <div
      data-testid="goals-page"
      style={{
        flex: 1,
        padding: '16px',
        backgroundColor: FUI_TOKENS.bgBlueprint,
        color: FUI_TOKENS.inkStark,
        borderRadius: '0px',
      }}
    >
      <FuiPanel
        surface="blueprint"
        headerTitle="YEARLY GOALS // Q1-Q4 ORTHOGONAL BLUEPRINT (REF-03)"
        headerProps={{
          title: 'YEARLY GOALS // Q1-Q4 ORTHOGONAL BLUEPRINT (REF-03)',
          code: 'MOD_09',
          accent: 'vermilion',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <FuiBadge tone="vermilion">NORTH_STAR BEACONS // 90° ORTHOGONAL ROUTING</FuiBadge>
          </div>

          <svg
            data-fui-blueprint="true"
            width="600"
            height="160"
            viewBox="0 0 600 160"
            style={{
              maxWidth: '100%',
              backgroundColor: FUI_TOKENS.bgBlueprint,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
            }}
          >
            <path
              d="M 20 40 H 180 V 100 H 340 V 50 H 520"
              fill="none"
              stroke={FUI_TOKENS.accentOrange}
              strokeWidth="2"
            />
            <path
              d="M 180 100 H 420 V 130 H 560"
              fill="none"
              stroke={FUI_TOKENS.accentCyan}
              strokeWidth="1.5"
            />
            <rect
              x="14"
              y="34"
              width="12"
              height="12"
              rx="0"
              ry="0"
              fill={FUI_TOKENS.accentVermilion}
              data-fui-beacon="true"
            />
            <rect
              x="334"
              y="94"
              width="12"
              height="12"
              rx="0"
              ry="0"
              fill={FUI_TOKENS.accentVermilion}
              data-fui-beacon="true"
            />
            <rect
              x="514"
              y="44"
              width="12"
              height="12"
              rx="0"
              ry="0"
              fill={FUI_TOKENS.accentPhosphor}
              data-fui-beacon="true"
            />
          </svg>
        </div>
      </FuiPanel>
    </div>
  );
}
