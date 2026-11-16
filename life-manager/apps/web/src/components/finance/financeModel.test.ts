import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STOCK_CYCLE_ASSETS,
  combineStockCandles,
  computeCombinedCandles,
  computeHoldingMetrics,
  convertCurrencyCents,
  deriveWaffleSlices,
  detectAllocationDrift,
  formatFireDurationLabel,
  normalizeAllocationResponse,
  normalizeAssetCandlesResponse,
  normalizeMonthlyPlan,
  normalizePortfolioAsset,
  resolveStockCycleAssets,
  sortMonthlyPlansChronologically,
  synthesizeClientCandles,
  toPairedMonthBarData,
} from './financeModel';

describe('financeModel (F32 Finance Operator)', () => {
  it('computes finite holding metrics, currency conversion, and price alert breaches with zero NaN', () => {
    const asset = normalizePortfolioAsset({
      id: '018f1234-0000-7000-8000-000000000001',
      symbol: 'petr4',
      name: 'Petrobras PN',
      asset_class: 'br_equity',
      currency: 'BRL',
      in_portfolio: true,
      quantity: '100.00',
      avg_cost_cents: 3250,
      current_price_cents: 3680,
      target_weight_pct: '25.00',
      alert_low_cents: 3000,
      alert_high_cents: 3600,
    });

    expect(asset.symbol).toBe('PETR4');
    const metrics = computeHoldingMetrics(asset, 5.0);
    expect(metrics.quantityNum).toBe(100);
    expect(metrics.valueCents).toBe(368000);
    expect(metrics.costBasisCents).toBe(325000);
    expect(metrics.unrealizedPnlCents).toBe(43000);
    expect(metrics.unrealizedPnlPct).toBeCloseTo(13.23, 2);
    expect(metrics.isAlertTriggered).toBe(true);
    expect(metrics.isAlertHighBreached).toBe(true);
    expect(metrics.isAlertLowBreached).toBe(false);

    // Zero cost basis guard
    const zeroCost = computeHoldingMetrics(
      normalizePortfolioAsset({
        symbol: 'CASH1',
        quantity: '0',
        avg_cost_cents: 0,
        current_price_cents: 0,
      }),
    );
    expect(Number.isFinite(zeroCost.unrealizedPnlPct)).toBe(true);
    expect(zeroCost.unrealizedPnlPct).toBe(0);
  });

  it('detects allocation drift > 5% on single-holding target_weight_pct=10% and multi-asset portfolios', () => {
    const singleHolding = [
      normalizePortfolioAsset({
        id: '1',
        symbol: 'DRFT4',
        name: 'High Drift Asset',
        asset_class: 'crypto',
        currency: 'USD',
        in_portfolio: true,
        quantity: '50',
        avg_cost_cents: 10000,
        current_price_cents: 10000,
        target_weight_pct: '10.00',
      }),
    ];

    const singleDrift = detectAllocationDrift(singleHolding, null, 5.0);
    expect(singleDrift.hasDrift).toBe(true);
    expect(singleDrift.driftingSymbols).toContain('DRFT4');
    expect(singleDrift.maxDriftPct).toBeGreaterThan(5);

    const balancedHoldings = [
      normalizePortfolioAsset({
        id: '1',
        symbol: 'A1',
        in_portfolio: true,
        quantity: '10',
        current_price_cents: 1000,
        target_weight_pct: '50.00',
      }),
      normalizePortfolioAsset({
        id: '2',
        symbol: 'A2',
        in_portfolio: true,
        quantity: '10',
        current_price_cents: 1000,
        target_weight_pct: '50.00',
      }),
    ];
    const balancedReport = detectAllocationDrift(balancedHoldings, null, 5.0);
    expect(balancedReport.hasDrift).toBe(false);
    expect(balancedReport.targetSumPct).toBe(100);
  });

  it('sorts monthly plans chronologically ascending so recent months (2026-04) remain in the active bar chart window', () => {
    const descPlans = [
      normalizeMonthlyPlan({
        month: '2026-06',
        salary_income_cents: 2000000,
        planned_spend_cents: 1000000,
        actual_spend_cents: 950000,
      }),
      normalizeMonthlyPlan({
        month: '2026-05',
        salary_income_cents: 2000000,
        planned_spend_cents: 1000000,
        actual_spend_cents: 980000,
      }),
      normalizeMonthlyPlan({
        month: '2026-04-01',
        salary_income_cents: 1500000,
        planned_spend_cents: 800000,
        actual_spend_cents: 1100000,
      }),
      normalizeMonthlyPlan({
        month: '2025-10',
        salary_income_cents: 1500000,
        planned_spend_cents: 800000,
        actual_spend_cents: 750000,
      }),
      normalizeMonthlyPlan({
        month: '2025-09',
        salary_income_cents: 1500000,
        planned_spend_cents: 800000,
        actual_spend_cents: 750000,
      }),
      normalizeMonthlyPlan({
        month: '2025-08',
        salary_income_cents: 1500000,
        planned_spend_cents: 800000,
        actual_spend_cents: 750000,
      }),
      normalizeMonthlyPlan({
        month: '2025-07',
        salary_income_cents: 1500000,
        planned_spend_cents: 800000,
        actual_spend_cents: 750000,
      }),
    ];

    const sorted = sortMonthlyPlansChronologically(descPlans);
    expect(sorted[0]?.month).toBe('2025-07');
    expect(sorted[sorted.length - 1]?.month).toBe('2026-06');

    const barData = toPairedMonthBarData(descPlans, 'spend');
    const lastSix = barData.slice(-6);
    expect(lastSix.some((d) => d.month === '2026-04')).toBe(true);
    const apr = lastSix.find((d) => d.month === '2026-04');
    expect(apr?.planned).toBe(8000);
    expect(apr?.actual).toBe(11000);
  });

  it('formats FIRE duration labels for Already FI (0Y 0M), UNREACHABLE, and standard projections', () => {
    expect(
      formatFireDurationLabel({
        months_to_fi: 0,
        fi_progress_pct: 112.5,
        unreachable: false,
      }),
    ).toBe('0Y 0M');

    expect(
      formatFireDurationLabel({
        months_to_fi: null,
        fi_progress_pct: 12.0,
        unreachable: true,
      }),
    ).toBe('UNREACHABLE');

    expect(
      formatFireDurationLabel({
        months_to_fi: 92,
        fi_progress_pct: 38.4,
        unreachable: false,
      }),
    ).toBe('7Y 8M');
  });

  it('clamps buy-only rebalancer recommendations to >= 0 and derives waffle slices', () => {
    const alloc = normalizeAllocationResponse({
      base_currency: 'BRL',
      total_brl_cents: 1000000,
      total_usd_cents: 200000,
      fx_usd_brl: '5.0000',
      new_contribution_cents: 500000,
      target_weight_sum_pct: '100.00',
      waffle_tiles: Array.from({ length: 200 }, (_, idx) => ({
        tile_index: idx,
        symbol: idx < 120 ? 'PETR4' : 'VWRA',
        asset_class: idx < 120 ? 'br_equity' : 'global_etf',
      })),
      recommendations: [
        {
          asset_id: 'a1',
          symbol: 'PETR4',
          current_weight_pct: '60.00',
          target_weight_pct: '40.00',
          post_buy_weight_pct: '40.00',
          recommended_buy_cents: -50000, // should clamp to 0
          recommended_units: '-10',
        },
        {
          asset_id: 'a2',
          symbol: 'VWRA',
          current_weight_pct: '40.00',
          target_weight_pct: '60.00',
          post_buy_weight_pct: '60.00',
          recommended_buy_cents: 500000,
          recommended_units: '25.0000',
        },
      ],
    });

    expect(alloc.recommendations[0]?.recommended_buy_cents).toBe(0);
    expect(Number(alloc.recommendations[0]?.recommended_units)).toBe(0);
    expect(alloc.recommendations[1]?.recommended_buy_cents).toBe(500000);

    const slices = deriveWaffleSlices(alloc);
    expect(slices).toHaveLength(2);
    expect(slices[0]?.label).toBe('PETR4');
    expect(slices[1]?.label).toBe('VWRA');
  });

  it('adv_normalizeAssetCandlesResponse_and_deriveWaffleSlices_and_fireDuration_edge_cases', () => {
    const candles = normalizeAssetCandlesResponse(
      {
        symbol: 'BTC',
        range_key: '90D',
        candles: [
          {
            timestamp: '2026-11-01',
            open_cents: 9000000,
            close_cents: 9200000,
            high_cents: 9100000,
            low_cents: 9300000,
          },
        ],
      },
      'BTC',
      '1M',
    );
    expect(candles.candles.length).toBe(1);
    expect(candles.candles[0]?.high_cents).toBe(9200000);
    expect(candles.candles[0]?.low_cents).toBe(9000000);

    const holding = computeHoldingMetrics(
      {
        quantity: '2',
        avg_cost_cents: 10000,
        current_price_cents: 15000,
        currency: 'USD',
        alert_low_cents: 12000,
        alert_high_cents: 14000,
      },
      5.0,
    );
    expect(holding.valueUsdCents).toBe(30000);
    expect(holding.valueBrlCents).toBe(150000);
    expect(holding.isAlertHighBreached).toBe(true);
    expect(holding.isAlertTriggered).toBe(true);

    expect(deriveWaffleSlices(null, [])).toEqual([]);
    expect(formatFireDurationLabel({ months_to_fi: 0, unreachable: false })).toBe('0Y 0M');
    expect(formatFireDurationLabel({ months_to_fi: 24, unreachable: false })).toBe('2Y 0M');
    expect(formatFireDurationLabel({ months_to_fi: null, unreachable: true })).toBe('UNREACHABLE');

    const zeroIncomePlan = normalizeMonthlyPlan({
      month: '2026-11',
      salary_income_cents: 0,
      planned_spend_cents: 50000,
    });
    expect(zeroIncomePlan.savings_rate_pct).toBe(0);
  });

  it('[F44/M9] resolves stock cycle assets and synthesizes deterministic OHLCV candles across 1D/7D/1M/1Y/ALL', () => {
    const fallback = resolveStockCycleAssets([]);
    expect(fallback.isFallbackSeed).toBe(true);
    expect(fallback.assets.length).toBe(DEFAULT_STOCK_CYCLE_ASSETS.length);
    expect(fallback.assets.map((a) => a.symbol)).toEqual([
      'PETR4',
      'WEGE3',
      'VALE3',
      'ITUB4',
      'VOO',
      'NVDA',
    ]);

    const liveAssets = [DEFAULT_STOCK_CYCLE_ASSETS[0]!];
    const resolvedLive = resolveStockCycleAssets(liveAssets);
    expect(resolvedLive.isFallbackSeed).toBe(false);
    expect(resolvedLive.assets).toHaveLength(1);

    const expectedCounts: Array<['1D' | '7D' | '1M' | '1Y' | 'ALL', number]> = [
      ['1D', 24],
      ['7D', 7],
      ['1M', 30],
      ['1Y', 52],
      ['ALL', 60],
    ];

    for (const [range, expectedLen] of expectedCounts) {
      const synth = synthesizeClientCandles(DEFAULT_STOCK_CYCLE_ASSETS[0]!, range);
      expect(synth.symbol).toBe('PETR4');
      expect(synth.range_key).toBe(range);
      expect(synth.candles).toHaveLength(expectedLen);
      for (const bar of synth.candles) {
        expect(bar.high_cents).toBeGreaterThanOrEqual(Math.max(bar.open_cents, bar.close_cents));
        expect(bar.low_cents).toBeLessThanOrEqual(Math.min(bar.open_cents, bar.close_cents));
        expect(bar.low_cents).toBeGreaterThan(0);
        expect(bar.volume).toBeGreaterThan(0);
      }
      expect(synth.candles[synth.candles.length - 1]?.close_cents).toBe(
        DEFAULT_STOCK_CYCLE_ASSETS[0]!.current_price_cents,
      );
    }
  });

  it('[F44/M9] computes single and multi-stock combined candles across PORTFOLIO_WEIGHTED, EQUAL_WEIGHT, and INDEX_100 with currency conversion and OHLC invariants', () => {
    expect(convertCurrencyCents(10000, 'USD', 'BRL', 5.0)).toBe(50000);
    expect(convertCurrencyCents(50000, 'BRL', 'USD', 5.0)).toBe(10000);
    expect(convertCurrencyCents(25000, 'BRL', 'BRL', 5.0)).toBe(25000);

    const petr4 = DEFAULT_STOCK_CYCLE_ASSETS[0]!; // BRL, qty 200
    const voo = DEFAULT_STOCK_CYCLE_ASSETS[4]!; // USD, qty 12

    // Single stock mode
    const singleResult = computeCombinedCandles({
      selectedAssets: [petr4],
      rangeKey: '1M',
      baseCurrency: 'BRL',
      fxUsdBrl: 5.0,
      weightingMode: 'PORTFOLIO_WEIGHTED',
    });
    expect(singleResult.metrics.isCombined).toBe(false);
    expect(singleResult.metrics.selectedCount).toBe(1);
    expect(singleResult.metrics.symbolLabel).toBe('PETR4');
    expect(singleResult.bars).toHaveLength(30);
    expect(singleResult.chartData).toHaveLength(30);

    // Multi-stock combined mode (2 stocks: BRL + USD)
    const combinedWeighted = combineStockCandles({
      selectedAssets: [petr4, voo],
      rangeKey: '1M',
      baseCurrency: 'BRL',
      fxUsdBrl: 5.0,
      weightingMode: 'PORTFOLIO_WEIGHTED',
    });
    expect(combinedWeighted.metrics.isCombined).toBe(true);
    expect(combinedWeighted.metrics.selectedCount).toBe(2);
    expect(combinedWeighted.metrics.symbolLabel).toBe('COMBINED (PETR4+VOO)');
    expect(combinedWeighted.metrics.currency).toBe('BRL');
    expect(combinedWeighted.bars).toHaveLength(30);
    for (const bar of combinedWeighted.bars) {
      expect(bar.high_cents).toBeGreaterThanOrEqual(Math.max(bar.open_cents, bar.close_cents));
      expect(bar.low_cents).toBeLessThanOrEqual(Math.min(bar.open_cents, bar.close_cents));
      expect(bar.low_cents).toBeGreaterThan(0);
    }

    // Equal weight & Index 100 across all 6 stocks
    const combinedIndex100 = computeCombinedCandles({
      selectedAssets: DEFAULT_STOCK_CYCLE_ASSETS,
      rangeKey: '7D',
      baseCurrency: 'USD',
      fxUsdBrl: 5.0,
      weightingMode: 'INDEX_100',
    });
    expect(combinedIndex100.metrics.isCombined).toBe(true);
    expect(combinedIndex100.metrics.selectedCount).toBe(6);
    expect(combinedIndex100.metrics.symbolLabel).toBe('COMBINED // 6 STOCKS');
    expect(combinedIndex100.bars).toHaveLength(7);
    expect(combinedIndex100.bars[0]?.open_cents).toBe(10000); // 100.00 index base
  });
});
