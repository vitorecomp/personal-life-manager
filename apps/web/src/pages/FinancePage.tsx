import React from 'react';
import {
  CandlestickChart,
  FuiPanel,
  FUI_TOKENS,
  HatchedDonutGauge,
  PairedHatchBarChart,
  PrivacyValue,
  WaffleGrid10x20,
} from '@hermes/ui';

export function FinancePage() {
  return (
    <div
      data-testid="finance-page"
      style={{
        flex: 1,
        padding: '16px',
        backgroundColor: FUI_TOKENS.bgCarbon,
        color: FUI_TOKENS.inkStark,
        borderRadius: '0px',
      }}
    >
      <FuiPanel
        headerTitle="FINANCE OPERATOR // MULTI-MARKET PORTFOLIO & FIRE ENGINE (REF-07)"
        headerProps={{
          title: 'FINANCE OPERATOR // MULTI-MARKET PORTFOLIO & FIRE ENGINE (REF-07)',
          code: 'MOD_11',
          accent: 'orange',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '16px',
              padding: '12px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              fontSize: '13px',
            }}
          >
            <div>
              BRL EQUITY:{' '}
              <PrivacyValue kind="currency" currency="BRL" value="R$ 142.500,00" />
            </div>
            <div>
              USD HOLDINGS: <PrivacyValue kind="currency" currency="USD" value="$ 28,400.00" />
            </div>
            <div>
              FI PROGRESS: <PrivacyValue kind="percent" value="64.2%" />
            </div>
            <div>
              YTD ALPHA: <PrivacyValue kind="percent" value="+12.4%" />
            </div>
            <div>
              TIME TO FIRE: <PrivacyValue kind="duration" value="7Y 4M" />
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '16px',
            }}
          >
            <WaffleGrid10x20
              items={[
                { id: 'br', label: 'B3 EQUITIES', weightPct: 40, targetWeightPct: 40 },
                { id: 'us', label: 'US ETF', weightPct: 35, targetWeightPct: 35 },
                { id: 'fi', label: 'FIXED INCOME', weightPct: 15, targetWeightPct: 15 },
                { id: 'cr', label: 'CRYPTO', weightPct: 10, targetWeightPct: 10 },
              ]}
            />
            <div data-fui-ring="true" style={{ display: 'flex', justifyContent: 'center' }}>
              <HatchedDonutGauge
                solidPct={64.2}
                hatchedPct={15.8}
                centerLabel="64.2%"
                durationLabel="7Y 4M"
              />
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '16px',
            }}
          >
            <PairedHatchBarChart
              data={[
                { month: '2026-09', planned: 8000, actual: 7600 },
                { month: '2026-10', planned: 8000, actual: 8300 },
                { month: '2026-11', planned: 8000, actual: 7400 },
              ]}
            />
            <CandlestickChart
              symbol="WEGE3"
              candles={[
                { timestamp: '01', open: 38, high: 41, low: 37, close: 40 },
                { timestamp: '02', open: 40, high: 43, low: 39, close: 42 },
              ]}
            />
          </div>
        </div>
      </FuiPanel>
    </div>
  );
}
