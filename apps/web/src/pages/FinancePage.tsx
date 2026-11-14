import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CandlestickChart,
  FuiPanel,
  FUI_TOKENS,
  HatchedDonutGauge,
  PairedHatchBarChart,
  PrivacyValue,
  WaffleGrid10x20,
  type CandleDatum,
  type PairedMonthDatum,
  type WaffleSliceInput,
} from '@hermes/ui';
import {
  apiGet,
  formatBrlCents,
  formatFireDuration,
  formatUsdCents,
  unwrapList,
  UUID_RE,
  type AllocationRecord,
  type FireProjectionRecord,
  type MonthlyPlanRecord,
} from '../api/client';

function deriveWaffleSlices(allocation: AllocationRecord | null | undefined): WaffleSliceInput[] {
  if (!allocation) return [];
  if (Array.isArray(allocation.recommendations) && allocation.recommendations.length > 0) {
    return allocation.recommendations.map((rec) => ({
      id: rec.asset_id || rec.symbol,
      label: rec.symbol,
      weightPct: Number(rec.current_weight_pct ?? 0),
      targetWeightPct: Number(rec.target_weight_pct ?? 0),
    }));
  }
  if (Array.isArray(allocation.waffle_tiles) && allocation.waffle_tiles.length > 0) {
    const counts = new Map<string, number>();
    for (const tile of allocation.waffle_tiles) {
      if (!tile || !tile.symbol) continue;
      counts.set(tile.symbol, (counts.get(tile.symbol) ?? 0) + 1);
    }
    const totalTiles = Math.max(1, allocation.waffle_tiles.length);
    return Array.from(counts.entries()).map(([symbol, count]) => ({
      id: symbol,
      label: symbol,
      weightPct: (count / totalTiles) * 100,
    }));
  }
  return [];
}

export function FinancePage() {
  const { data: allocation } = useQuery({
    queryKey: ['finance-allocation'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/finance/allocation');
        return (res?.data ?? res) as AllocationRecord | null;
      } catch {
        return null;
      }
    },
  });

  const { data: retirement } = useQuery({
    queryKey: ['finance-retirement'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/finance/retirement');
        return (res?.data ?? res) as FireProjectionRecord | null;
      } catch {
        return null;
      }
    },
  });

  const { data: monthlyPlans = [] } = useQuery({
    queryKey: ['finance-monthly-plans'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/finance/monthly-plans');
        return unwrapList<MonthlyPlanRecord>(res, ['plans', 'monthly_plans']);
      } catch {
        return [];
      }
    },
  });

  const { data: assets = [] } = useQuery({
    queryKey: ['finance-assets'],
    queryFn: async () => {
      try {
        const res = await apiGet<any>('/api/finance/assets');
        return unwrapList<any>(res, ['assets']);
      } catch {
        return [];
      }
    },
  });

  const rawAssetId = String(assets[0]?.id || '').trim();
  const primaryAssetId = UUID_RE.test(rawAssetId) ? rawAssetId : '';
  const primarySymbol = String(assets[0]?.symbol || '').trim();

  const { data: candleData = [] } = useQuery({
    queryKey: ['finance-candles', primaryAssetId],
    queryFn: async () => {
      if (!primaryAssetId) return [];
      try {
        const res = await apiGet<any>(
          `/api/finance/assets/${encodeURIComponent(primaryAssetId)}/candles`,
        );
        const rawCandles = unwrapList<any>(res, ['candles']);
        return rawCandles.map(
          (c): CandleDatum => ({
            timestamp: String(c.timestamp || ''),
            open: Number(c.open_cents ?? 0) / 100,
            high: Number(c.high_cents ?? 0) / 100,
            low: Number(c.low_cents ?? 0) / 100,
            close: Number(c.close_cents ?? 0) / 100,
            volume: Number(c.volume ?? 0),
          }),
        );
      } catch {
        return [];
      }
    },
    enabled: Boolean(primaryAssetId),
  });

  const totalBrlCents = Number(
    allocation?.total_brl_cents ?? retirement?.current_net_worth_brl_cents ?? 0,
  );
  const totalUsdCents = Number(allocation?.total_usd_cents ?? 0);
  const fiProgressRaw = Number(retirement?.fi_progress_pct ?? retirement?.progress_pct ?? 0);
  const fiProgressPct = Number.isFinite(fiProgressRaw) ? fiProgressRaw : 0;
  const passiveCoverageRaw = Number(retirement?.passive_income_coverage_pct ?? 0);
  const passiveCoveragePct = Number.isFinite(passiveCoverageRaw) ? passiveCoverageRaw : 0;
  const durationLabel = formatFireDuration(retirement);

  const waffleSlices = useMemo(() => deriveWaffleSlices(allocation), [allocation]);

  const monthlyBarData: PairedMonthDatum[] = useMemo(
    () =>
      monthlyPlans
        .filter((p): p is MonthlyPlanRecord => Boolean(p && typeof p === 'object'))
        .map((p) => ({
          month: String(p.month || ''),
          planned: Number(p.planned_spend_cents ?? 0) / 100,
          actual: p.actual_spend_cents != null ? Number(p.actual_spend_cents) / 100 : null,
          income: Number(p.salary_income_cents ?? 0) / 100,
        })),
    [monthlyPlans],
  );

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
              <PrivacyValue
                kind="currency"
                currency="BRL"
                value={formatBrlCents(totalBrlCents)}
              />
            </div>
            <div>
              USD HOLDINGS:{' '}
              <PrivacyValue
                kind="currency"
                currency="USD"
                value={formatUsdCents(totalUsdCents)}
              />
            </div>
            <div>
              FI PROGRESS: <PrivacyValue kind="percent" value={`${fiProgressPct.toFixed(1)}%`} />
            </div>
            <div>
              PASSIVE COVERAGE:{' '}
              <PrivacyValue kind="percent" value={`${passiveCoveragePct.toFixed(1)}%`} />
            </div>
            <div>
              TIME TO FIRE: <PrivacyValue kind="duration" value={durationLabel} />
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
              items={waffleSlices}
              totalValueCents={totalBrlCents}
              preserveUnallocated={waffleSlices.length === 0}
            />
            <div data-fui-ring="true" style={{ display: 'flex', justifyContent: 'center' }}>
              <HatchedDonutGauge
                solidPct={fiProgressPct}
                hatchedPct={passiveCoveragePct}
                centerLabel={`${fiProgressPct.toFixed(1)}%`}
                durationLabel={durationLabel}
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
            <PairedHatchBarChart data={monthlyBarData} />
            <CandlestickChart symbol={primarySymbol || 'NO_ASSETS'} candles={candleData} />
          </div>
        </div>
      </FuiPanel>
    </div>
  );
}
