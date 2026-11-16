import { apiDelete, apiGet, apiPost, apiPut, unwrapList } from './client';
import {
  ASSET_CLASSES,
  ASSET_CLASS_LABELS,
  ASSET_CURRENCIES,
  CANDLE_RANGES,
  DEFAULT_STOCK_CYCLE_ASSETS,
  MONTHLY_BAR_RANGES,
  candlesToChartData,
  clampPercentage,
  combineStockCandles,
  computeCombinedCandles,
  computeHoldingMetrics,
  convertCurrencyCents,
  deriveWaffleSlices,
  detectAllocationDrift,
  formatFireDurationLabel,
  formatQuoteSourceBadge,
  isCachedOrManualQuoteSource,
  normalizeAllocationResponse,
  normalizeAssetCandlesResponse,
  normalizeAssetClass,
  normalizeAssetCurrency,
  normalizeCandleRange,
  normalizeFireProjection,
  normalizeMonthKey,
  normalizeMonthlyPlan,
  normalizePortfolioAsset,
  normalizePortfolioSnapshot,
  normalizeRetirementConfig,
  resolveStockCycleAssets,
  safeFiniteNumber,
  safeIntCents,
  sortMonthlyPlansChronologically,
  synthesizeClientCandles,
  toPairedMonthBarData,
  type AllocationDriftReport,
  type AllocationResponse,
  type AssetCandlesResponse,
  type AssetClass,
  type AssetCurrency,
  type CandleRangeKey,
  type CandlestickBarDto,
  type CombineCandlesInput,
  type CurrencyCode,
  type FireProjectionResponse,
  type FireTrajectoryPointDto,
  type HoldingMetrics,
  type MonthlyBarRangeKey,
  type MonthlyInvestmentPlanDto,
  type PortfolioAsset,
  type PortfolioSnapshotDto,
  type QuoteRefreshResponse,
  type RebalanceRecommendationDto,
  type RetirementConfigDto,
  type StockCycleMetrics,
  type StockCycleSelectionMode,
  type StockCycleWeightingMode,
  type WaffleTileDto,
} from '../components/finance/financeModel';

export {
  ASSET_CLASSES,
  ASSET_CLASS_LABELS,
  ASSET_CURRENCIES,
  CANDLE_RANGES,
  DEFAULT_STOCK_CYCLE_ASSETS,
  MONTHLY_BAR_RANGES,
  candlesToChartData,
  clampPercentage,
  combineStockCandles,
  computeCombinedCandles,
  computeHoldingMetrics,
  convertCurrencyCents,
  deriveWaffleSlices,
  detectAllocationDrift,
  formatFireDurationLabel,
  formatQuoteSourceBadge,
  isCachedOrManualQuoteSource,
  normalizeAllocationResponse,
  normalizeAssetCandlesResponse,
  normalizeAssetClass,
  normalizeAssetCurrency,
  normalizeCandleRange,
  normalizeFireProjection,
  normalizeMonthKey,
  normalizeMonthlyPlan,
  normalizePortfolioAsset,
  normalizePortfolioSnapshot,
  normalizeRetirementConfig,
  resolveStockCycleAssets,
  safeFiniteNumber,
  safeIntCents,
  sortMonthlyPlansChronologically,
  synthesizeClientCandles,
  toPairedMonthBarData,
  type AllocationDriftReport,
  type AllocationResponse,
  type AssetCandlesResponse,
  type AssetClass,
  type AssetCurrency,
  type CandleRangeKey,
  type CandlestickBarDto,
  type CombineCandlesInput,
  type CurrencyCode,
  type FireProjectionResponse,
  type FireTrajectoryPointDto,
  type HoldingMetrics,
  type MonthlyBarRangeKey,
  type MonthlyInvestmentPlanDto,
  type PortfolioAsset,
  type PortfolioSnapshotDto,
  type QuoteRefreshResponse,
  type RebalanceRecommendationDto,
  type RetirementConfigDto,
  type StockCycleMetrics,
  type StockCycleSelectionMode,
  type StockCycleWeightingMode,
  type WaffleTileDto,
};

export interface CreatePortfolioAssetInput {
  symbol: string;
  name: string;
  asset_class: AssetClass;
  currency?: AssetCurrency;
  in_portfolio?: boolean;
  quantity?: string | number;
  avg_cost_cents?: number;
  current_price_cents?: number;
  previous_close_cents?: number | null;
  dividend_yield_pct?: string | number | null;
  target_weight_pct?: string | number;
  alert_low_cents?: number | null;
  alert_high_cents?: number | null;
  thesis_md?: string;
}

export interface UpdatePortfolioAssetInput {
  symbol?: string;
  name?: string;
  asset_class?: AssetClass;
  currency?: AssetCurrency;
  in_portfolio?: boolean;
  quantity?: string | number;
  avg_cost_cents?: number;
  current_price_cents?: number;
  previous_close_cents?: number | null;
  dividend_yield_pct?: string | number | null;
  target_weight_pct?: string | number;
  alert_low_cents?: number | null;
  alert_high_cents?: number | null;
  thesis_md?: string;
}

export interface UpsertMonthlyPlanInput {
  currency?: AssetCurrency;
  fx_usd_brl?: string | number;
  salary_income_cents: number;
  planned_spend_cents: number;
  actual_spend_cents?: number | null;
  planned_investment_cents: number;
  actual_invested_cents?: number;
  notes_md?: string;
}

export interface UpdateRetirementConfigInput {
  expected_real_return_pct?: string | number;
  safe_withdrawal_rate_pct?: string | number;
  override_retirement_monthly_spend_cents?: number | null;
  macro_class_targets_json?: Record<string, number>;
  current_age?: number | null;
}

export interface FireSimulationInput {
  current_net_worth_brl_cents?: number;
  monthly_contribution_brl_cents?: number;
  monthly_retirement_spend_brl_cents?: number;
  expected_real_return_pct?: string | number;
  safe_withdrawal_rate_pct?: string | number;
  current_age?: number | null;
}

export async function fetchFinanceAssets(params?: {
  in_portfolio?: boolean;
  asset_class?: AssetClass;
  currency?: AssetCurrency;
}): Promise<PortfolioAsset[]> {
  const qs = new URLSearchParams();
  if (params?.in_portfolio !== undefined) {
    qs.set('in_portfolio', String(params.in_portfolio));
  }
  if (params?.asset_class) {
    qs.set('asset_class', params.asset_class);
  }
  if (params?.currency) {
    qs.set('currency', params.currency);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await apiGet<any>(`/api/finance/assets${suffix}`);
  const rawList = unwrapList<any>(res, ['assets', 'items']);
  return rawList.map((item) => normalizePortfolioAsset(item));
}

export async function fetchFinanceAssetById(id: string): Promise<PortfolioAsset> {
  const res = await apiGet<any>(`/api/finance/assets/${encodeURIComponent(id)}`);
  return normalizePortfolioAsset(res?.asset ?? res?.data ?? res);
}

export async function createFinanceAsset(input: CreatePortfolioAssetInput): Promise<PortfolioAsset> {
  const body = {
    ...input,
    symbol: input.symbol.trim().toUpperCase(),
    name: input.name.trim(),
    quantity: input.quantity !== undefined ? String(input.quantity) : '0',
    target_weight_pct:
      input.target_weight_pct !== undefined ? String(input.target_weight_pct) : '0',
    dividend_yield_pct:
      input.dividend_yield_pct !== undefined && input.dividend_yield_pct !== null
        ? String(input.dividend_yield_pct)
        : null,
  };
  const res = await apiPost<any>('/api/finance/assets', body);
  return normalizePortfolioAsset(res?.asset ?? res?.data ?? res);
}

export async function updateFinanceAsset(
  id: string,
  input: UpdatePortfolioAssetInput,
): Promise<PortfolioAsset> {
  const body: Record<string, unknown> = { ...input };
  if (input.symbol !== undefined) {
    body.symbol = input.symbol.trim().toUpperCase();
  }
  if (input.name !== undefined) {
    body.name = input.name.trim();
  }
  if (input.quantity !== undefined) {
    body.quantity = String(input.quantity);
  }
  if (input.target_weight_pct !== undefined) {
    body.target_weight_pct = String(input.target_weight_pct);
  }
  if (input.dividend_yield_pct !== undefined && input.dividend_yield_pct !== null) {
    body.dividend_yield_pct = String(input.dividend_yield_pct);
  }
  const res = await apiPut<any>(`/api/finance/assets/${encodeURIComponent(id)}`, body);
  return normalizePortfolioAsset(res?.asset ?? res?.data ?? res);
}

export async function deleteFinanceAsset(id: string): Promise<{ id: string; deleted: boolean }> {
  const res = await apiDelete<any>(`/api/finance/assets/${encodeURIComponent(id)}`);
  return {
    id: String(res?.id ?? id),
    deleted: Boolean(res?.deleted ?? true),
  };
}

/**
 * Fetches OHLCV candles for an asset.
 * CRITICAL: Always passes `?range=${encodeURIComponent(safeRange)}` (default `'1M'`).
 */
export async function fetchAssetCandles(
  id: string,
  range: CandleRangeKey = '1M',
  fallbackSymbol = 'NO_ASSETS',
): Promise<AssetCandlesResponse> {
  const safeRange = normalizeCandleRange(range);
  const res = await apiGet<any>(
    `/api/finance/assets/${encodeURIComponent(id)}/candles?range=${encodeURIComponent(safeRange)}`,
  );
  return normalizeAssetCandlesResponse(res, fallbackSymbol, safeRange);
}

export async function refreshFinanceQuotes(): Promise<QuoteRefreshResponse> {
  const res = await apiPost<any>('/api/finance/quotes/refresh', {});
  const payload = res?.data && typeof res.data === 'object' ? res.data : res;
  return {
    refreshed_count: Math.max(0, safeIntCents(payload?.refreshed_count, 0)),
    fx_usd_brl: Math.max(0.01, safeFiniteNumber(payload?.fx_usd_brl, 5.0)).toFixed(4),
    fx_source: String(payload?.fx_source ?? 'cached').trim() || 'cached',
    refreshed_at: String(payload?.refreshed_at ?? new Date().toISOString()),
  };
}

export async function fetchFinanceAllocation(
  baseCurrency: AssetCurrency = 'BRL',
  investableSurplusCents?: number,
): Promise<AllocationResponse> {
  const qs = new URLSearchParams();
  qs.set('base_currency', normalizeAssetCurrency(baseCurrency));
  if (investableSurplusCents !== undefined && Number.isFinite(investableSurplusCents)) {
    const clampedSurplus = Math.max(0, Math.round(investableSurplusCents));
    qs.set('investable_surplus_cents', String(clampedSurplus));
  }
  const res = await apiGet<any>(`/api/finance/allocation?${qs.toString()}`);
  return normalizeAllocationResponse(res);
}

export async function fetchMonthlyPlans(limit = 24): Promise<MonthlyInvestmentPlanDto[]> {
  const res = await apiGet<any>(`/api/finance/monthly-plans?limit=${encodeURIComponent(String(limit))}`);
  const list = unwrapList<any>(res, ['plans', 'monthly_plans', 'sheets']);
  return list.map((item) => normalizeMonthlyPlan(item));
}

export async function fetchMonthlyPlan(month: string): Promise<MonthlyInvestmentPlanDto> {
  const cleanMonth = normalizeMonthKey(month);
  const res = await apiGet<any>(`/api/finance/monthly-plans/${encodeURIComponent(cleanMonth)}`);
  return normalizeMonthlyPlan(res);
}

export async function upsertMonthlyPlan(
  month: string,
  input: UpsertMonthlyPlanInput,
): Promise<MonthlyInvestmentPlanDto> {
  const cleanMonth = normalizeMonthKey(month);
  const body = {
    currency: normalizeAssetCurrency(input.currency),
    ...(input.fx_usd_brl !== undefined ? { fx_usd_brl: String(input.fx_usd_brl) } : {}),
    salary_income_cents: Math.max(0, safeIntCents(input.salary_income_cents, 0)),
    planned_spend_cents: Math.max(0, safeIntCents(input.planned_spend_cents, 0)),
    actual_spend_cents:
      input.actual_spend_cents !== undefined && input.actual_spend_cents !== null
        ? Math.max(0, safeIntCents(input.actual_spend_cents, 0))
        : null,
    planned_investment_cents: Math.max(0, safeIntCents(input.planned_investment_cents, 0)),
    actual_invested_cents: Math.max(0, safeIntCents(input.actual_invested_cents, 0)),
    notes_md: input.notes_md ?? '',
  };
  const res = await apiPut<any>(`/api/finance/monthly-plans/${encodeURIComponent(cleanMonth)}`, body);
  return normalizeMonthlyPlan(res);
}

export async function fetchRetirementProjection(): Promise<FireProjectionResponse> {
  const res = await apiGet<any>('/api/finance/retirement');
  return normalizeFireProjection(res);
}

export async function fetchRetirementConfig(): Promise<RetirementConfigDto> {
  const res = await apiGet<any>('/api/finance/retirement/config');
  return normalizeRetirementConfig(res);
}

export async function updateRetirementConfig(
  input: UpdateRetirementConfigInput,
): Promise<RetirementConfigDto> {
  const body: Record<string, unknown> = {};
  if (input.expected_real_return_pct !== undefined) {
    body.expected_real_return_pct = String(input.expected_real_return_pct);
  }
  if (input.safe_withdrawal_rate_pct !== undefined) {
    body.safe_withdrawal_rate_pct = String(input.safe_withdrawal_rate_pct);
  }
  if (input.override_retirement_monthly_spend_cents !== undefined) {
    body.override_retirement_monthly_spend_cents = input.override_retirement_monthly_spend_cents;
  }
  if (input.macro_class_targets_json !== undefined) {
    body.macro_class_targets_json = input.macro_class_targets_json;
  }
  if (input.current_age !== undefined) {
    body.current_age = input.current_age;
  }
  const res = await apiPut<any>('/api/finance/retirement/config', body);
  return normalizeRetirementConfig(res);
}

export async function simulateFireProjection(
  input: FireSimulationInput,
): Promise<FireProjectionResponse> {
  const body: Record<string, unknown> = {};
  if (input.current_net_worth_brl_cents !== undefined) {
    body.current_net_worth_brl_cents = Math.max(0, safeIntCents(input.current_net_worth_brl_cents, 0));
  }
  if (input.monthly_contribution_brl_cents !== undefined) {
    body.monthly_contribution_brl_cents = Math.max(
      0,
      safeIntCents(input.monthly_contribution_brl_cents, 0),
    );
  }
  if (input.monthly_retirement_spend_brl_cents !== undefined) {
    body.monthly_retirement_spend_brl_cents = Math.max(
      0,
      safeIntCents(input.monthly_retirement_spend_brl_cents, 0),
    );
  }
  if (input.expected_real_return_pct !== undefined) {
    body.expected_real_return_pct = String(input.expected_real_return_pct);
  }
  if (input.safe_withdrawal_rate_pct !== undefined) {
    body.safe_withdrawal_rate_pct = String(input.safe_withdrawal_rate_pct);
  }
  if (input.current_age !== undefined) {
    body.current_age = input.current_age;
  }
  const res = await apiPost<any>('/api/finance/retirement/simulate', body);
  return normalizeFireProjection(res);
}

export async function fetchPortfolioSnapshots(limit = 90): Promise<PortfolioSnapshotDto[]> {
  const res = await apiGet<any>(`/api/finance/snapshots?limit=${encodeURIComponent(String(limit))}`);
  const list = unwrapList<any>(res, ['snapshots', 'items']);
  return list.map((item) => normalizePortfolioSnapshot(item));
}

export async function createPortfolioSnapshot(
  snapshotDate?: string,
): Promise<PortfolioSnapshotDto> {
  const body = snapshotDate ? { snapshot_date: snapshotDate } : {};
  const res = await apiPost<any>('/api/finance/snapshots', body);
  return normalizePortfolioSnapshot(res);
}
