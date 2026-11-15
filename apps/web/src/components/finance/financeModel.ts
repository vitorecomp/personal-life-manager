import type { CandleDatum, CandleRange, MonthlyBarRange, PairedMonthDatum, WaffleSliceInput } from '@hermes/ui';

export type AssetClass =
  | 'br_equity'
  | 'br_fii'
  | 'br_fixed_income'
  | 'us_equity'
  | 'global_etf'
  | 'crypto'
  | 'cash';

export type AssetCurrency = 'BRL' | 'USD';

export type CandleRangeKey = CandleRange; // '1D' | '7D' | '1M' | '1Y' | 'ALL'

export type MonthlyBarRangeKey = MonthlyBarRange; // '3M' | '6M' | '1Y' | 'ALL'

export const ASSET_CLASSES: readonly AssetClass[] = [
  'br_equity',
  'br_fii',
  'br_fixed_income',
  'us_equity',
  'global_etf',
  'crypto',
  'cash',
];

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  br_equity: 'B3 EQUITY',
  br_fii: 'B3 FII',
  br_fixed_income: 'FIXED INCOME',
  us_equity: 'US EQUITY',
  global_etf: 'GLOBAL ETF',
  crypto: 'CRYPTO',
  cash: 'CASH RESERVE',
};

export const ASSET_CURRENCIES: readonly AssetCurrency[] = ['BRL', 'USD'];

export const CANDLE_RANGES: readonly CandleRangeKey[] = ['1D', '7D', '1M', '1Y', 'ALL'];

export const MONTHLY_BAR_RANGES: readonly MonthlyBarRangeKey[] = ['3M', '6M', '1Y', 'ALL'];

export interface PortfolioAsset {
  id: string;
  symbol: string;
  name: string;
  asset_class: AssetClass;
  currency: AssetCurrency;
  in_portfolio: boolean;
  quantity: string;
  avg_cost_cents: number;
  current_price_cents: number;
  previous_close_cents: number | null;
  dividend_yield_pct: string | null;
  target_weight_pct: string;
  alert_low_cents: number | null;
  alert_high_cents: number | null;
  thesis_md: string;
  quote_source: string;
  last_quote_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CandlestickBarDto {
  timestamp: string;
  open_cents: number;
  high_cents: number;
  low_cents: number;
  close_cents: number;
  volume: number;
}

export interface AssetCandlesResponse {
  symbol: string;
  range_key: CandleRangeKey;
  quote_source: string;
  candles: CandlestickBarDto[];
}

export interface QuoteRefreshResponse {
  refreshed_count: number;
  fx_usd_brl: string;
  fx_source: string;
  refreshed_at: string;
}

export interface WaffleTileDto {
  tile_index: number;
  symbol: string;
  asset_class: AssetClass;
}

export interface RebalanceRecommendationDto {
  asset_id: string;
  symbol: string;
  current_weight_pct: number;
  target_weight_pct: number;
  post_buy_weight_pct: number;
  recommended_buy_cents: number;
  recommended_units: string;
}

export interface AllocationResponse {
  base_currency: AssetCurrency;
  total_brl_cents: number;
  total_usd_cents: number;
  fx_usd_brl: string;
  new_contribution_cents: number;
  target_weight_sum_pct: string;
  waffle_tiles: WaffleTileDto[];
  recommendations: RebalanceRecommendationDto[];
}

export interface MonthlyInvestmentPlanDto {
  month: string;
  currency: AssetCurrency;
  fx_usd_brl: string;
  salary_income_cents: number;
  planned_spend_cents: number;
  actual_spend_cents: number | null;
  planned_investment_cents: number;
  actual_invested_cents: number;
  investable_surplus_cents: number;
  net_cashflow_cents: number;
  savings_rate_pct: number;
  notes_md: string;
  updated_at: string;
}

export interface RetirementConfigDto {
  id: number;
  expected_real_return_pct: string;
  safe_withdrawal_rate_pct: string;
  override_retirement_monthly_spend_cents: number | null;
  macro_class_targets_json: Record<string, number>;
  current_age: number | null;
  updated_at: string;
}

export interface FireTrajectoryPointDto {
  year_offset: number;
  calendar_year: number;
  age: number | null;
  projected_net_worth_cents: number;
  total_contributions_cents: number;
  fi_target_cents: number;
}

export interface FireProjectionResponse {
  current_net_worth_brl_cents: number;
  fi_target_brl_cents: number;
  fire_number_cents: number;
  coast_fire_cents: number;
  monthly_contribution_brl_cents: number;
  monthly_retirement_spend_brl_cents: number;
  years_to_fi: number;
  months_to_fi: number | null;
  projected_fi_date: string | null;
  progress_pct: number;
  fi_progress_pct: number;
  passive_income_coverage_pct: number;
  unreachable: boolean;
  trajectory: FireTrajectoryPointDto[];
  config: RetirementConfigDto;
}

export interface PortfolioSnapshotDto {
  snapshot_date: string;
  total_brl_cents: number;
  total_usd_cents: number;
  fx_usd_brl: string;
  fi_target_brl_cents: number;
  projected_years_to_fi: string | null;
  breakdown_json: Record<string, unknown>;
  created_at: string;
}

export interface HoldingMetrics {
  quantityNum: number;
  valueCents: number;
  costBasisCents: number;
  unrealizedPnlCents: number;
  unrealizedPnlPct: number;
  valueBrlCents: number;
  valueUsdCents: number;
  isAlertTriggered: boolean;
  isAlertLowBreached: boolean;
  isAlertHighBreached: boolean;
}

export interface AllocationDriftReport {
  hasDrift: boolean;
  maxDriftPct: number;
  driftingSymbols: string[];
  targetSumPct: number;
}

export function safeFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function safeIntCents(value: unknown, fallback = 0): number {
  return Math.round(safeFiniteNumber(value, fallback));
}

export function clampPercentage(value: unknown, fallback = 0): number {
  const n = safeFiniteNumber(value, fallback);
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Number(n.toFixed(2));
}

export function normalizeAssetClass(raw: unknown): AssetClass {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'br_equity' || s === 'br_equities' || s === 'b3') return 'br_equity';
  if (s === 'br_fii' || s === 'br_fiis' || s === 'fii') return 'br_fii';
  if (s === 'br_fixed_income' || s === 'fixed_income' || s === 'tesouro') return 'br_fixed_income';
  if (s === 'us_equity' || s === 'us_equities') return 'us_equity';
  if (s === 'global_etf' || s === 'global_etfs' || s === 'etf') return 'global_etf';
  if (s === 'crypto') return 'crypto';
  if (s === 'cash') return 'cash';
  return 'br_equity';
}

export function normalizeAssetCurrency(raw: unknown): AssetCurrency {
  const s = String(raw ?? '').trim().toUpperCase();
  return s === 'USD' ? 'USD' : 'BRL';
}

export function normalizeCandleRange(raw: unknown): CandleRangeKey {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s === '1D' || s === '24H') return '1D';
  if (s === '7D' || s === '1W') return '7D';
  if (s === '1M' || s === '30D' || s === '90D') return '1M';
  if (s === '1Y' || s === '12M' || s === '365D') return '1Y';
  if (s === 'ALL' || s === 'MAX') return 'ALL';
  return '1M';
}

export function normalizeMonthKey(raw: unknown): string {
  const s = String(raw ?? '').trim();
  const match = s.match(/^(\d{4}-\d{2})/);
  if (match && match[1]) return match[1];
  return s || '2026-01';
}

export function isCachedOrManualQuoteSource(rawQuoteSource: unknown): boolean {
  const s = String(rawQuoteSource ?? 'cached').trim().toLowerCase();
  return s !== 'live_api' && s !== 'live';
}

export function formatQuoteSourceBadge(rawQuoteSource: unknown): 'LIVE' | 'CACHED' | 'MANUAL' | 'SEEDED' {
  const s = String(rawQuoteSource ?? '').trim().toLowerCase();
  if (s === 'live_api' || s === 'live') return 'LIVE';
  if (s === 'manual') return 'MANUAL';
  if (s === 'seeded') return 'SEEDED';
  return 'CACHED';
}

export function normalizePortfolioAsset(raw: any): PortfolioAsset {
  const inPortfolio =
    typeof raw?.in_portfolio === 'boolean'
      ? raw.in_portfolio
      : typeof raw?.is_watchlist === 'boolean'
        ? !raw.is_watchlist
        : true;
  const qty = Math.max(0, safeFiniteNumber(raw?.quantity, inPortfolio ? 1 : 0));
  const targetWeight = Math.min(100, Math.max(0, safeFiniteNumber(raw?.target_weight_pct, 0)));
  const divYield =
    raw?.dividend_yield_pct !== null && raw?.dividend_yield_pct !== undefined
      ? String(Math.max(0, safeFiniteNumber(raw.dividend_yield_pct, 0)).toFixed(2))
      : null;

  return {
    id: String(raw?.id ?? ''),
    symbol: String(raw?.symbol ?? raw?.ticker ?? 'UNKNOWN')
      .trim()
      .toUpperCase(),
    name: String(raw?.name ?? raw?.symbol ?? 'Unnamed Asset').trim(),
    asset_class: normalizeAssetClass(raw?.asset_class),
    currency: normalizeAssetCurrency(raw?.currency),
    in_portfolio: inPortfolio,
    quantity: String(qty),
    avg_cost_cents: Math.max(0, safeIntCents(raw?.avg_cost_cents ?? raw?.average_cost_cents, 0)),
    current_price_cents: Math.max(
      0,
      safeIntCents(raw?.current_price_cents ?? raw?.last_price_cents, 0),
    ),
    previous_close_cents:
      raw?.previous_close_cents !== null && raw?.previous_close_cents !== undefined
        ? Math.max(0, safeIntCents(raw.previous_close_cents, 0))
        : null,
    dividend_yield_pct: divYield,
    target_weight_pct: String(targetWeight.toFixed(2)),
    alert_low_cents:
      raw?.alert_low_cents !== null && raw?.alert_low_cents !== undefined
        ? Math.max(0, safeIntCents(raw.alert_low_cents, 0))
        : null,
    alert_high_cents:
      raw?.alert_high_cents !== null && raw?.alert_high_cents !== undefined
        ? Math.max(0, safeIntCents(raw.alert_high_cents, 0))
        : null,
    thesis_md: String(raw?.thesis_md ?? ''),
    quote_source: String(raw?.quote_source ?? 'cached').trim() || 'cached',
    last_quote_at: raw?.last_quote_at ? String(raw.last_quote_at) : null,
    created_at: String(raw?.created_at ?? ''),
    updated_at: String(raw?.updated_at ?? ''),
  };
}

export function normalizeAssetCandlesResponse(
  raw: any,
  fallbackSymbol = 'NO_ASSETS',
  fallbackRange: CandleRangeKey = '1M',
): AssetCandlesResponse {
  const payload = raw?.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : raw;
  const rawCandles: any[] = Array.isArray(payload?.candles)
    ? payload.candles
    : Array.isArray(payload)
      ? payload
      : [];

  const candles: CandlestickBarDto[] = rawCandles
    .filter((c) => c && typeof c === 'object')
    .map((c) => {
      const openCents = Math.max(0, safeIntCents(c.open_cents ?? (safeFiniteNumber(c.open, 0) * 100), 0));
      const closeCents = Math.max(0, safeIntCents(c.close_cents ?? (safeFiniteNumber(c.close, 0) * 100), 0));
      const rawHigh = Math.max(0, safeIntCents(c.high_cents ?? (safeFiniteNumber(c.high, 0) * 100), 0));
      const rawLow = Math.max(0, safeIntCents(c.low_cents ?? (safeFiniteNumber(c.low, 0) * 100), 0));
      return {
        timestamp: String(c.timestamp ?? ''),
        open_cents: openCents,
        high_cents: Math.max(rawHigh, openCents, closeCents),
        low_cents: Math.min(rawLow > 0 ? rawLow : Math.min(openCents, closeCents), openCents, closeCents),
        close_cents: closeCents,
        volume: Math.max(0, safeIntCents(c.volume, 0)),
      };
    });

  return {
    symbol: String(payload?.symbol ?? fallbackSymbol).trim() || fallbackSymbol,
    range_key: normalizeCandleRange(payload?.range_key ?? fallbackRange),
    quote_source: String(payload?.quote_source ?? 'cached').trim() || 'cached',
    candles,
  };
}

export function candlesToChartData(candles: CandlestickBarDto[]): CandleDatum[] {
  if (!Array.isArray(candles)) return [];
  return candles.map((c) => ({
    timestamp: String(c.timestamp || ''),
    open: safeFiniteNumber(c.open_cents, 0) / 100,
    high: safeFiniteNumber(c.high_cents, 0) / 100,
    low: safeFiniteNumber(c.low_cents, 0) / 100,
    close: safeFiniteNumber(c.close_cents, 0) / 100,
    volume: safeFiniteNumber(c.volume, 0),
  }));
}

export function normalizeAllocationResponse(raw: any): AllocationResponse {
  const payload = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
  const fxNum = Math.max(0.01, safeFiniteNumber(payload?.fx_usd_brl, 5.0));
  const rawTiles: any[] = Array.isArray(payload?.waffle_tiles)
    ? payload.waffle_tiles
    : Array.isArray(payload?.tiles)
      ? payload.tiles
      : [];
  const rawRecs: any[] = Array.isArray(payload?.recommendations)
    ? payload.recommendations
    : Array.isArray(payload?.allocations)
      ? payload.allocations
      : [];

  return {
    base_currency: normalizeAssetCurrency(payload?.base_currency),
    total_brl_cents: Math.max(0, safeIntCents(payload?.total_brl_cents, 0)),
    total_usd_cents: Math.max(0, safeIntCents(payload?.total_usd_cents, 0)),
    fx_usd_brl: fxNum.toFixed(4),
    new_contribution_cents: Math.max(0, safeIntCents(payload?.new_contribution_cents, 0)),
    target_weight_sum_pct: safeFiniteNumber(payload?.target_weight_sum_pct, 0).toFixed(2),
    waffle_tiles: rawTiles
      .filter((t) => t && typeof t === 'object' && t.symbol)
      .map((t, idx) => ({
        tile_index: safeIntCents(t.tile_index, idx),
        symbol: String(t.symbol).trim().toUpperCase(),
        asset_class: normalizeAssetClass(t.asset_class),
      })),
    recommendations: rawRecs
      .filter((r) => r && typeof r === 'object' && r.symbol)
      .map((r) => ({
        asset_id: String(r.asset_id ?? r.id ?? ''),
        symbol: String(r.symbol).trim().toUpperCase(),
        current_weight_pct: Number(safeFiniteNumber(r.current_weight_pct, 0).toFixed(2)),
        target_weight_pct: Number(safeFiniteNumber(r.target_weight_pct, 0).toFixed(2)),
        post_buy_weight_pct: Number(safeFiniteNumber(r.post_buy_weight_pct, 0).toFixed(2)),
        // Strictly buy-only: never negative!
        recommended_buy_cents: Math.max(0, safeIntCents(r.recommended_buy_cents, 0)),
        recommended_units: String(Math.max(0, safeFiniteNumber(r.recommended_units, 0)).toFixed(4)),
      })),
  };
}

export function normalizeMonthlyPlan(raw: any): MonthlyInvestmentPlanDto {
  const payload = raw?.plan && typeof raw.plan === 'object' ? raw.plan : raw;
  const salaryCents = Math.max(0, safeIntCents(payload?.salary_income_cents, 0));
  const plannedSpendCents = Math.max(0, safeIntCents(payload?.planned_spend_cents, 0));
  const actualSpendCents =
    payload?.actual_spend_cents !== null && payload?.actual_spend_cents !== undefined
      ? Math.max(0, safeIntCents(payload.actual_spend_cents, 0))
      : null;
  const plannedInvestCents = Math.max(0, safeIntCents(payload?.planned_investment_cents, 0));
  const actualInvestedCents = Math.max(0, safeIntCents(payload?.actual_invested_cents, 0));

  const effectiveSpend = actualSpendCents !== null ? actualSpendCents : plannedSpendCents;
  const computedNetCashflow = salaryCents - effectiveSpend;
  const computedSurplus = Math.max(0, computedNetCashflow);
  const computedSavingsPct =
    salaryCents > 0 ? Number(((computedNetCashflow / salaryCents) * 100).toFixed(1)) : 0;

  return {
    month: normalizeMonthKey(payload?.month),
    currency: normalizeAssetCurrency(payload?.currency),
    fx_usd_brl: Math.max(0.01, safeFiniteNumber(payload?.fx_usd_brl, 5.0)).toFixed(4),
    salary_income_cents: salaryCents,
    planned_spend_cents: plannedSpendCents,
    actual_spend_cents: actualSpendCents,
    planned_investment_cents: plannedInvestCents,
    actual_invested_cents: actualInvestedCents,
    investable_surplus_cents:
      payload?.investable_surplus_cents !== undefined
        ? Math.max(0, safeIntCents(payload.investable_surplus_cents, computedSurplus))
        : computedSurplus,
    net_cashflow_cents:
      payload?.net_cashflow_cents !== undefined
        ? safeIntCents(payload.net_cashflow_cents, computedNetCashflow)
        : computedNetCashflow,
    savings_rate_pct:
      payload?.savings_rate_pct !== undefined
        ? safeFiniteNumber(payload.savings_rate_pct, computedSavingsPct)
        : computedSavingsPct,
    notes_md: String(payload?.notes_md ?? ''),
    updated_at: String(payload?.updated_at ?? ''),
  };
}

export function normalizeRetirementConfig(raw: any): RetirementConfigDto {
  const payload = raw?.config && typeof raw.config === 'object' ? raw.config : raw;
  return {
    id: safeIntCents(payload?.id, 1),
    expected_real_return_pct: safeFiniteNumber(payload?.expected_real_return_pct, 6.5).toFixed(2),
    safe_withdrawal_rate_pct: Math.max(
      0.1,
      safeFiniteNumber(payload?.safe_withdrawal_rate_pct, 4.0),
    ).toFixed(2),
    override_retirement_monthly_spend_cents:
      payload?.override_retirement_monthly_spend_cents !== null &&
      payload?.override_retirement_monthly_spend_cents !== undefined
        ? Math.max(0, safeIntCents(payload.override_retirement_monthly_spend_cents, 0))
        : null,
    macro_class_targets_json:
      payload?.macro_class_targets_json && typeof payload.macro_class_targets_json === 'object'
        ? (payload.macro_class_targets_json as Record<string, number>)
        : {},
    current_age:
      payload?.current_age !== null && payload?.current_age !== undefined
        ? safeIntCents(payload.current_age, 30)
        : 30,
    updated_at: String(payload?.updated_at ?? ''),
  };
}

export function normalizeFireProjection(raw: any): FireProjectionResponse {
  const payload = raw?.data && typeof raw.data === 'object' ? raw.data : raw;
  const currentNetWorthBrlCents = Math.max(
    0,
    safeIntCents(payload?.current_net_worth_brl_cents, 0),
  );
  const fiTargetBrlCents = Math.max(
    0,
    safeIntCents(payload?.fi_target_brl_cents ?? payload?.fire_number_cents, 0),
  );
  const fiProgressPct = safeFiniteNumber(
    payload?.fi_progress_pct ?? payload?.progress_pct,
    fiTargetBrlCents > 0 ? (currentNetWorthBrlCents / fiTargetBrlCents) * 100 : 0,
  );
  const unreachable = Boolean(payload?.unreachable);
  const monthsRaw =
    payload?.months_to_fi === null || payload?.months_to_fi === undefined
      ? null
      : Math.max(0, safeIntCents(payload.months_to_fi, 0));

  const rawTrajectory: any[] = Array.isArray(payload?.trajectory) ? payload.trajectory : [];

  return {
    current_net_worth_brl_cents: currentNetWorthBrlCents,
    fi_target_brl_cents: fiTargetBrlCents,
    fire_number_cents: Math.max(0, safeIntCents(payload?.fire_number_cents, fiTargetBrlCents)),
    coast_fire_cents: Math.max(0, safeIntCents(payload?.coast_fire_cents, 0)),
    monthly_contribution_brl_cents: Math.max(
      0,
      safeIntCents(payload?.monthly_contribution_brl_cents, 0),
    ),
    monthly_retirement_spend_brl_cents: Math.max(
      0,
      safeIntCents(payload?.monthly_retirement_spend_brl_cents, 0),
    ),
    years_to_fi: Math.max(0, safeFiniteNumber(payload?.years_to_fi, 0)),
    months_to_fi: unreachable ? null : monthsRaw,
    projected_fi_date: payload?.projected_fi_date ? String(payload.projected_fi_date) : null,
    progress_pct: Number(Math.max(0, fiProgressPct).toFixed(2)),
    fi_progress_pct: Number(Math.max(0, fiProgressPct).toFixed(2)),
    passive_income_coverage_pct: Number(
      Math.max(0, safeFiniteNumber(payload?.passive_income_coverage_pct, 0)).toFixed(2),
    ),
    unreachable,
    trajectory: rawTrajectory
      .filter((t) => t && typeof t === 'object')
      .map((t, idx) => ({
        year_offset: safeIntCents(t.year_offset, idx),
        calendar_year: safeIntCents(t.calendar_year, 2026 + idx),
        age: t.age !== null && t.age !== undefined ? safeIntCents(t.age, 30 + idx) : null,
        projected_net_worth_cents: Math.max(0, safeIntCents(t.projected_net_worth_cents, 0)),
        total_contributions_cents: Math.max(0, safeIntCents(t.total_contributions_cents, 0)),
        fi_target_cents: Math.max(0, safeIntCents(t.fi_target_cents, fiTargetBrlCents)),
      })),
    config: normalizeRetirementConfig(payload?.config ?? {}),
  };
}

export function normalizePortfolioSnapshot(raw: any): PortfolioSnapshotDto {
  const payload = raw?.snapshot && typeof raw.snapshot === 'object' ? raw.snapshot : raw;
  return {
    snapshot_date: String(payload?.snapshot_date ?? '').slice(0, 10),
    total_brl_cents: Math.max(0, safeIntCents(payload?.total_brl_cents, 0)),
    total_usd_cents: Math.max(0, safeIntCents(payload?.total_usd_cents, 0)),
    fx_usd_brl: Math.max(0.01, safeFiniteNumber(payload?.fx_usd_brl, 5.0)).toFixed(4),
    fi_target_brl_cents: Math.max(0, safeIntCents(payload?.fi_target_brl_cents, 0)),
    projected_years_to_fi:
      payload?.projected_years_to_fi !== null && payload?.projected_years_to_fi !== undefined
        ? String(safeFiniteNumber(payload.projected_years_to_fi, 0).toFixed(1))
        : null,
    breakdown_json:
      payload?.breakdown_json && typeof payload.breakdown_json === 'object'
        ? (payload.breakdown_json as Record<string, unknown>)
        : {},
    created_at: String(payload?.created_at ?? ''),
  };
}

/**
 * Computes native & converted value, cost basis, unrealized P&L, and price-alert triggers
 * for a single holding or watchlist asset with zero NaN/Infinity risk.
 */
export function computeHoldingMetrics(
  asset: Pick<
    PortfolioAsset,
    | 'quantity'
    | 'avg_cost_cents'
    | 'current_price_cents'
    | 'currency'
    | 'alert_low_cents'
    | 'alert_high_cents'
  >,
  fxUsdBrl: unknown = 5.0,
): HoldingMetrics {
  const quantityNum = Math.max(0, safeFiniteNumber(asset.quantity, 0));
  const priceCents = Math.max(0, safeIntCents(asset.current_price_cents, 0));
  const avgCostCents = Math.max(0, safeIntCents(asset.avg_cost_cents, 0));
  const fx = Math.max(0.01, safeFiniteNumber(fxUsdBrl, 5.0));

  const valueCents = Math.round(quantityNum * priceCents);
  const costBasisCents = Math.round(quantityNum * avgCostCents);
  const unrealizedPnlCents = valueCents - costBasisCents;
  const unrealizedPnlPct =
    costBasisCents > 0
      ? Number((((valueCents - costBasisCents) / costBasisCents) * 100).toFixed(2))
      : 0;

  const isUsd = normalizeAssetCurrency(asset.currency) === 'USD';
  const valueBrlCents = isUsd ? Math.round(valueCents * fx) : valueCents;
  const valueUsdCents = isUsd ? valueCents : Math.round(valueCents / fx);

  const alertLow =
    asset.alert_low_cents !== null && asset.alert_low_cents !== undefined
      ? safeIntCents(asset.alert_low_cents, -1)
      : null;
  const alertHigh =
    asset.alert_high_cents !== null && asset.alert_high_cents !== undefined
      ? safeIntCents(asset.alert_high_cents, -1)
      : null;

  const isAlertLowBreached = alertLow !== null && alertLow >= 0 && priceCents <= alertLow;
  const isAlertHighBreached = alertHigh !== null && alertHigh >= 0 && priceCents >= alertHigh;

  return {
    quantityNum,
    valueCents,
    costBasisCents,
    unrealizedPnlCents,
    unrealizedPnlPct: Number.isFinite(unrealizedPnlPct) ? unrealizedPnlPct : 0,
    valueBrlCents,
    valueUsdCents,
    isAlertTriggered: isAlertLowBreached || isAlertHighBreached,
    isAlertLowBreached,
    isAlertHighBreached,
  };
}

/**
 * Detects whether the portfolio allocation has drifted > 5% from target weights
 * or if the sum of target weights differs from 100% by > 5%.
 */
export function detectAllocationDrift(
  assets: PortfolioAsset[],
  allocation?: AllocationResponse | null,
  fxUsdBrl: unknown = 5.0,
): AllocationDriftReport {
  const portfolioAssets = Array.isArray(assets)
    ? assets.filter((a) => a && a.in_portfolio)
    : [];

  const fx = Math.max(0.01, safeFiniteNumber(allocation?.fx_usd_brl ?? fxUsdBrl, 5.0));

  const assetTargetSum = portfolioAssets.reduce(
    (sum, a) => sum + Math.max(0, safeFiniteNumber(a.target_weight_pct, 0)),
    0,
  );
  const allocTargetSum =
    allocation?.target_weight_sum_pct !== undefined
      ? safeFiniteNumber(allocation.target_weight_sum_pct, assetTargetSum)
      : assetTargetSum;
  const targetSumPct = Number(
    (portfolioAssets.length > 0 ? assetTargetSum : allocTargetSum).toFixed(2),
  );

  const driftingSet = new Set<string>();
  let maxDriftPct = 0;

  if (Array.isArray(allocation?.recommendations) && allocation.recommendations.length > 0) {
    for (const rec of allocation.recommendations) {
      const currentW = safeFiniteNumber(rec.current_weight_pct, 0);
      const targetW = safeFiniteNumber(rec.target_weight_pct, 0);
      const diff = Math.abs(currentW - targetW);
      if (diff > maxDriftPct) maxDriftPct = diff;
      if (diff > 5 && rec.symbol) {
        driftingSet.add(rec.symbol);
      }
    }
  }

  if (portfolioAssets.length > 0) {
    const valuesBrl = portfolioAssets.map((a) => computeHoldingMetrics(a, fx).valueBrlCents);
    const totalBrl = valuesBrl.reduce((acc, v) => acc + v, 0);

    portfolioAssets.forEach((asset, idx) => {
      const val = valuesBrl[idx] ?? 0;
      const actualWeightPct =
        totalBrl > 0 ? (val / totalBrl) * 100 : 100 / portfolioAssets.length;
      const targetWeightPct = Math.max(0, safeFiniteNumber(asset.target_weight_pct, 0));
      const diff = Math.abs(actualWeightPct - targetWeightPct);
      if (diff > maxDriftPct) maxDriftPct = diff;
      if (diff > 5 && asset.symbol) {
        driftingSet.add(asset.symbol);
      }
    });
  }

  const hasHoldingsOrRecs =
    portfolioAssets.length > 0 || (allocation?.recommendations?.length ?? 0) > 0;
  const sumDrift = hasHoldingsOrRecs ? Math.abs(targetSumPct - 100) : 0;
  if (sumDrift > maxDriftPct) {
    maxDriftPct = sumDrift;
  }

  const hasDrift = hasHoldingsOrRecs && (maxDriftPct > 5 || driftingSet.size > 0);

  return {
    hasDrift,
    maxDriftPct: Number(maxDriftPct.toFixed(2)),
    driftingSymbols: Array.from(driftingSet),
    targetSumPct,
  };
}

/**
 * Converts backend AllocationResponse and/or PortfolioAsset list into WaffleSliceInput[]
 * for `<WaffleGrid10x20 />`.
 */
export function deriveWaffleSlices(
  allocation: AllocationResponse | null | undefined,
  assets: PortfolioAsset[] = [],
  fxUsdBrl: unknown = 5.0,
): WaffleSliceInput[] {
  if (allocation && Array.isArray(allocation.recommendations) && allocation.recommendations.length > 0) {
    const nonZeroRecs = allocation.recommendations.filter(
      (r) => safeFiniteNumber(r.current_weight_pct, 0) > 0 || safeFiniteNumber(r.target_weight_pct, 0) > 0,
    );
    if (nonZeroRecs.length > 0) {
      return nonZeroRecs.map((rec) => ({
        id: rec.asset_id || rec.symbol,
        label: rec.symbol,
        weightPct: safeFiniteNumber(rec.current_weight_pct, 0),
        targetWeightPct: safeFiniteNumber(rec.target_weight_pct, 0),
      }));
    }
  }

  if (allocation && Array.isArray(allocation.waffle_tiles) && allocation.waffle_tiles.length > 0) {
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

  const holdings = Array.isArray(assets) ? assets.filter((a) => a && a.in_portfolio) : [];
  if (holdings.length > 0) {
    const fx = Math.max(0.01, safeFiniteNumber(allocation?.fx_usd_brl ?? fxUsdBrl, 5.0));
    const vals = holdings.map((a) => computeHoldingMetrics(a, fx).valueBrlCents);
    const total = vals.reduce((acc, v) => acc + v, 0);
    if (total > 0) {
      return holdings.map((a, idx) => ({
        id: a.id || a.symbol,
        label: a.symbol,
        weightPct: ((vals[idx] ?? 0) / total) * 100,
        targetWeightPct: safeFiniteNumber(a.target_weight_pct, 0),
        valueCents: vals[idx] ?? 0,
      }));
    }
  }

  return [];
}

/**
 * Sorts monthly plans ascending chronologically (`YYYY-MM`) so `<PairedHatchBarChart />`
 * `.slice(-limit)` always includes the newest months (e.g. `2026-04`).
 */
export function sortMonthlyPlansChronologically(
  plans: MonthlyInvestmentPlanDto[],
): MonthlyInvestmentPlanDto[] {
  if (!Array.isArray(plans)) return [];
  return [...plans]
    .filter((p): p is MonthlyInvestmentPlanDto => Boolean(p && typeof p === 'object' && p.month))
    .map((p) => normalizeMonthlyPlan(p))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function toPairedMonthBarData(
  plans: MonthlyInvestmentPlanDto[],
  mode: 'spend' | 'investment' = 'spend',
): PairedMonthDatum[] {
  const sorted = sortMonthlyPlansChronologically(plans);
  return sorted.map((p) => {
    if (mode === 'investment') {
      return {
        month: p.month,
        planned: safeFiniteNumber(p.planned_investment_cents, 0) / 100,
        actual: safeFiniteNumber(p.actual_invested_cents, 0) / 100,
        income: safeFiniteNumber(p.salary_income_cents, 0) / 100,
      };
    }
    return {
      month: p.month,
      planned: safeFiniteNumber(p.planned_spend_cents, 0) / 100,
      actual:
        p.actual_spend_cents !== null && p.actual_spend_cents !== undefined
          ? safeFiniteNumber(p.actual_spend_cents, 0) / 100
          : null,
      income: safeFiniteNumber(p.salary_income_cents, 0) / 100,
    };
  });
}

/**
 * Formats FIRE duration label:
 * - `'0Y 0M'` when `months_to_fi === 0` or `fi_progress_pct >= 100` (Already FI)
 * - `'UNREACHABLE'` when `unreachable === true` or `months_to_fi === null`
 * - `${years}Y ${months}M` otherwise
 */
export function formatFireDurationLabel(
  retirement?: Partial<FireProjectionResponse> | null,
): string {
  if (!retirement) return '0Y 0M';
  const fiProgress = safeFiniteNumber(
    retirement.fi_progress_pct ?? retirement.progress_pct,
    0,
  );
  if (
    fiProgress >= 100 ||
    (retirement.months_to_fi === 0 && !retirement.unreachable)
  ) {
    return '0Y 0M';
  }
  if (retirement.unreachable === true || retirement.months_to_fi === null) {
    return 'UNREACHABLE';
  }
  const monthsRaw = Number(retirement.months_to_fi);
  if (Number.isFinite(monthsRaw) && monthsRaw >= 0) {
    const totalMonths = Math.round(monthsRaw);
    const years = Math.floor(totalMonths / 12);
    const remMonths = totalMonths % 12;
    return `${years}Y ${remMonths}M`;
  }
  const yearsRaw = Number(retirement.years_to_fi);
  if (Number.isFinite(yearsRaw) && yearsRaw >= 0) {
    const totalMonths = Math.round(yearsRaw * 12);
    const years = Math.floor(totalMonths / 12);
    const remMonths = totalMonths % 12;
    return `${years}Y ${remMonths}M`;
  }
  return '0Y 0M';
}
