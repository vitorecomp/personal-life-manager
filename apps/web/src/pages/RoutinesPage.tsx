import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BinaryDotMatrix8x12, FuiBadge, FuiPanel, FUI_TOKENS } from '@hermes/ui';
import { apiGet, unwrapList } from '../api/client';

export function RoutinesPage() {
  const { data: routines = [] } = useQuery({
    queryKey: ['routines'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/routines');
        return unwrapList<any>(res, ['routines']);
      } catch {
        return [];
      }
    },
  });

  return (
    <div
      data-testid="routines-page"
      style={{
        flex: 1,
        padding: '16px',
        backgroundColor: FUI_TOKENS.bgCarbon,
        color: FUI_TOKENS.inkStark,
        borderRadius: '0px',
      }}
    >
      <FuiPanel
        headerTitle="ROUTINE PLANNING // DAY PROFILES & BIO ADHERENCE"
        headerProps={{
          title: 'ROUTINE PLANNING // DAY PROFILES & BIO ADHERENCE',
          code: 'MOD_08',
          accent: 'phosphor',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <FuiBadge tone="phosphor">ACTIVE HABITS: {routines.length || 4}</FuiBadge>
            <FuiBadge tone="orange">PROFILE: WORKDAY</FuiBadge>
          </div>
          <BinaryDotMatrix8x12 adherencePct={88.5} streakCount={14} />
        </div>
      </FuiPanel>
    </div>
  );
}
