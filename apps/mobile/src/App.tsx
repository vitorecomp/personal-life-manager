import { FUI_TOKENS } from '@hermes/ui';
import { useState } from 'react';

export const ALLOWED_MOBILE_SURFACES = [
  'ROUTINES',
  'TODOS',
  'COMPANION',
  'UPLINK_CONFIG',
] as const;

export type MobileSurface = (typeof ALLOWED_MOBILE_SURFACES)[number];

export function App() {
  const [activeSurface, setActiveSurface] = useState<MobileSurface>('ROUTINES');

  return (
    <main
      data-testid="hermes-mobile-shell"
      style={{
        backgroundColor: FUI_TOKENS.bgCarbon,
        color: FUI_TOKENS.inkStark,
        minHeight: '100vh',
      }}
    >
      <header style={{ borderBottom: `1px solid ${FUI_TOKENS.accentOrange}`, padding: '12px 16px' }}>
        <span>HERMES COMPANION // {activeSurface}</span>
      </header>
      <nav aria-label="Mobile Navigation" style={{ display: 'flex', gap: '8px', padding: '12px 16px' }}>
        {ALLOWED_MOBILE_SURFACES.map((surface) => (
          <button
            key={surface}
            type="button"
            onClick={() => setActiveSurface(surface)}
            style={{ fontSize: '12px', padding: '8px 12px' }}
          >
            {surface}
          </button>
        ))}
      </nav>
    </main>
  );
}
