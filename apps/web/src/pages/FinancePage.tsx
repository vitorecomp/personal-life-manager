import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CandlestickChart,
  FuiBadge,
  FuiPanel,
  FUI_TOKENS,
  HatchedDonutGauge,
  PairedHatchBarChart,
  PrivacyValue,
  usePrivacyMask,
  WaffleGrid10x20,
} from '@hermes/ui';
import { formatBrlCents, formatUsdCents, UUID_RE } from '../api/client';
import {
  ASSET_CLASSES,
  ASSET_CLASS_LABELS,
  ASSET_CURRENCIES,
  candlesToChartData,
  computeHoldingMetrics,
  createFinanceAsset,
  createPortfolioSnapshot,
  deleteFinanceAsset,
  deriveWaffleSlices,
  detectAllocationDrift,
  fetchAssetCandles,
  fetchFinanceAllocation,
  fetchFinanceAssets,
  fetchMonthlyPlans,
  fetchPortfolioSnapshots,
  fetchRetirementProjection,
  formatFireDurationLabel,
  formatQuoteSourceBadge,
  isCachedOrManualQuoteSource,
  refreshFinanceQuotes,
  safeFiniteNumber,
  safeIntCents,
  simulateFireProjection,
  sortMonthlyPlansChronologically,
  toPairedMonthBarData,
  updateFinanceAsset,
  updateRetirementConfig,
  upsertMonthlyPlan,
  type AssetClass,
  type AssetCurrency,
  type CandleRangeKey,
  type FireProjectionResponse,
  type MonthlyBarRangeKey,
  type PortfolioAsset,
} from '../api/finance';

function formatNativeAssetCurrency(cents: unknown, currency: AssetCurrency = 'BRL'): string {
  return currency === 'USD' ? formatUsdCents(cents) : formatBrlCents(cents);
}

const INPUT_STYLE: React.CSSProperties = {
  padding: '6px 8px',
  minHeight: '32px',
  backgroundColor: FUI_TOKENS.bgCarbon,
  color: FUI_TOKENS.inkStark,
  border: `1px solid ${FUI_TOKENS.borderHairline}`,
  fontFamily: FUI_TOKENS.fontMono,
  fontSize: '12px',
  fontVariantNumeric: 'tabular-nums',
  borderRadius: '0px',
  boxSizing: 'border-box',
};

const BUTTON_STYLE: React.CSSProperties = {
  padding: '6px 10px',
  minHeight: '30px',
  backgroundColor: FUI_TOKENS.bgCarbon,
  color: FUI_TOKENS.inkStark,
  border: `1px solid ${FUI_TOKENS.borderHairline}`,
  fontFamily: FUI_TOKENS.fontMono,
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  borderRadius: '0px',
};

const PRIMARY_BUTTON_STYLE: React.CSSProperties = {
  ...BUTTON_STYLE,
  backgroundColor: FUI_TOKENS.accentOrange,
  color: FUI_TOKENS.bgCarbon,
  border: `1px solid ${FUI_TOKENS.accentOrange}`,
};

export function FinancePage() {
  const queryClient = useQueryClient();
  const { isMasked, toggleMask } = usePrivacyMask();

  const [baseCurrency, setBaseCurrency] = useState<AssetCurrency>('BRL');
  const [surplusInputCents, setSurplusInputCents] = useState<number>(500000);
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [candleRange, setCandleRange] = useState<CandleRangeKey>('1M');
  const [barRange, setBarRange] = useState<MonthlyBarRangeKey>('6M');
  const [barMode, setBarMode] = useState<'spend' | 'investment'>('spend');

  // Asset CRUD state
  const [showAssetForm, setShowAssetForm] = useState<boolean>(false);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [assetSymbol, setAssetSymbol] = useState<string>('');
  const [assetName, setAssetName] = useState<string>('');
  const [assetClass, setAssetClass] = useState<AssetClass>('br_equity');
  const [assetCurrency, setAssetCurrency] = useState<AssetCurrency>('BRL');
  const [assetInPortfolio, setAssetInPortfolio] = useState<boolean>(true);
  const [assetQuantity, setAssetQuantity] = useState<string>('10');
  const [assetAvgCostCents, setAssetAvgCostCents] = useState<string>('3500');
  const [assetPriceCents, setAssetPriceCents] = useState<string>('3800');
  const [assetTargetWeightPct, setAssetTargetWeightPct] = useState<string>('20');
  const [assetAlertLowCents, setAssetAlertLowCents] = useState<string>('');
  const [assetAlertHighCents, setAssetAlertHighCents] = useState<string>('');
  const [assetThesisMd, setAssetThesisMd] = useState<string>('');

  // Selected Asset Thesis & Alert Drawer state
  const [drawerThesisMd, setDrawerThesisMd] = useState<string>('');
  const [drawerAlertLowCents, setDrawerAlertLowCents] = useState<string>('');
  const [drawerAlertHighCents, setDrawerAlertHighCents] = useState<string>('');

  // Monthly Macro Plan (REF-07) form state
  const [planMonth, setPlanMonth] = useState<string>('2026-04');
  const [planSalaryCents, setPlanSalaryCents] = useState<string>('2500000');
  const [planPlannedSpendCents, setPlanPlannedSpendCents] = useState<string>('1200000');
  const [planActualSpendCents, setPlanActualSpendCents] = useState<string>('1100000');
  const [planPlannedInvestCents, setPlanPlannedInvestCents] = useState<string>('1300000');
  const [planActualInvestedCents, setPlanActualInvestedCents] = useState<string>('1400000');
  const [planNotesMd, setPlanNotesMd] = useState<string>('');

  // FIRE What-If & Config state
  const [simMonthlySpendCents, setSimMonthlySpendCents] = useState<number>(1000000);
  const [simMonthlyContribCents, setSimMonthlyContribCents] = useState<number>(1400000);
  const [simRealReturnPct, setSimRealReturnPct] = useState<number>(6.5);
  const [simSwrPct, setSimSwrPct] = useState<number>(4.0);
  const [simCurrentAge, setSimCurrentAge] = useState<number>(32);
  const [simulatedFire, setSimulatedFire] = useState<FireProjectionResponse | null>(null);

  // Status / Error Banner
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [lastQuoteSource, setLastQuoteSource] = useState<string>('cached');

  // Queries
  const { data: assets = [] } = useQuery({
    queryKey: ['finance-assets'],
    queryFn: async () => {
      try {
        return await fetchFinanceAssets();
      } catch {
        return [];
      }
    },
  });

  const { data: allocation } = useQuery({
    queryKey: ['finance-allocation', baseCurrency, surplusInputCents],
    queryFn: async () => {
      try {
        return await fetchFinanceAllocation(baseCurrency, surplusInputCents);
      } catch {
        return null;
      }
    },
  });

  const { data: retirement } = useQuery({
    queryKey: ['finance-retirement'],
    queryFn: async () => {
      try {
        return await fetchRetirementProjection();
      } catch {
        return null;
      }
    },
  });

  const { data: monthlyPlans = [] } = useQuery({
    queryKey: ['finance-monthly-plans'],
    queryFn: async () => {
      try {
        return await fetchMonthlyPlans(24);
      } catch {
        return [];
      }
    },
  });

  const { data: snapshots = [] } = useQuery({
    queryKey: ['finance-snapshots'],
    queryFn: async () => {
      try {
        return await fetchPortfolioSnapshots(30);
      } catch {
        return [];
      }
    },
  });

  const holdings = useMemo(
    () => assets.filter((a) => a && a.in_portfolio),
    [assets],
  );
  const watchlist = useMemo(
    () => assets.filter((a) => a && !a.in_portfolio),
    [assets],
  );

  // Resolve active selected asset
  const resolvedSelectedAsset: PortfolioAsset | null = useMemo(() => {
    if (selectedAssetId) {
      const found = assets.find((a) => a.id === selectedAssetId || a.symbol === selectedAssetId);
      if (found) return found;
    }
    return holdings[0] ?? assets[0] ?? null;
  }, [assets, holdings, selectedAssetId]);

  const activeAssetUuid = useMemo(() => {
    const rawId = String(resolvedSelectedAsset?.id || '').trim();
    return UUID_RE.test(rawId) ? rawId : '';
  }, [resolvedSelectedAsset]);

  // Sync thesis & alert inputs when selected asset changes
  useEffect(() => {
    if (resolvedSelectedAsset) {
      setDrawerThesisMd(resolvedSelectedAsset.thesis_md ?? '');
      setDrawerAlertLowCents(
        resolvedSelectedAsset.alert_low_cents !== null
          ? String(resolvedSelectedAsset.alert_low_cents)
          : '',
      );
      setDrawerAlertHighCents(
        resolvedSelectedAsset.alert_high_cents !== null
          ? String(resolvedSelectedAsset.alert_high_cents)
          : '',
      );
    }
  }, [resolvedSelectedAsset?.id]);

  // Sync FIRE What-If defaults from retirement query
  useEffect(() => {
    if (retirement) {
      setSimMonthlySpendCents(
        safeIntCents(
          retirement.config?.override_retirement_monthly_spend_cents ??
            retirement.monthly_retirement_spend_brl_cents,
          1000000,
        ),
      );
      setSimMonthlyContribCents(
        safeIntCents(retirement.monthly_contribution_brl_cents, 1400000),
      );
      setSimRealReturnPct(
        safeFiniteNumber(retirement.config?.expected_real_return_pct, 6.5),
      );
      setSimSwrPct(
        Math.max(0.5, safeFiniteNumber(retirement.config?.safe_withdrawal_rate_pct, 4.0)),
      );
      setSimCurrentAge(safeIntCents(retirement.config?.current_age, 32));
    }
  }, [retirement?.config?.updated_at]);

  const { data: candlesResponse } = useQuery({
    queryKey: ['finance-candles', activeAssetUuid, candleRange],
    queryFn: async () => {
      if (!activeAssetUuid) return null;
      try {
        return await fetchAssetCandles(
          activeAssetUuid,
          candleRange,
          resolvedSelectedAsset?.symbol || 'NO_ASSETS',
        );
      } catch {
        return null;
      }
    },
    enabled: Boolean(activeAssetUuid),
  });

  const candleData = useMemo(
    () => candlesToChartData(candlesResponse?.candles ?? []),
    [candlesResponse],
  );

  // Determine quote source (LIVE vs CACHED/MANUAL/SEEDED)
  const isSelectedQuoteCached = useMemo(() => {
    if (candlesResponse?.quote_source) {
      return isCachedOrManualQuoteSource(candlesResponse.quote_source);
    }
    if (resolvedSelectedAsset?.quote_source) {
      return isCachedOrManualQuoteSource(resolvedSelectedAsset.quote_source);
    }
    return true;
  }, [candlesResponse?.quote_source, resolvedSelectedAsset?.quote_source]);

  const fxUsdBrl = useMemo(
    () => Math.max(0.01, safeFiniteNumber(allocation?.fx_usd_brl, 5.0)),
    [allocation?.fx_usd_brl],
  );

  const computedPortfolioTotals = useMemo(() => {
    let brlSum = 0;
    let usdSum = 0;
    for (const h of holdings) {
      const m = computeHoldingMetrics(h, fxUsdBrl);
      brlSum += m.valueBrlCents;
      usdSum += m.valueUsdCents;
    }
    return { brlSum, usdSum };
  }, [holdings, fxUsdBrl]);

  const totalBrlCents = safeIntCents(
    allocation?.total_brl_cents ??
      retirement?.current_net_worth_brl_cents ??
      computedPortfolioTotals.brlSum,
    0,
  );
  const totalUsdCents = safeIntCents(
    allocation?.total_usd_cents ?? computedPortfolioTotals.usdSum,
    0,
  );

  const activeFire = simulatedFire ?? retirement;
  const fiProgressPct = safeFiniteNumber(
    activeFire?.fi_progress_pct ?? activeFire?.progress_pct,
    0,
  );
  const passiveCoveragePct = safeFiniteNumber(
    activeFire?.passive_income_coverage_pct,
    0,
  );
  const fiTargetBrlCents = safeIntCents(
    activeFire?.fi_target_brl_cents ?? activeFire?.fire_number_cents,
    0,
  );
  const coastFireBrlCents = safeIntCents(activeFire?.coast_fire_cents, 0);
  const durationLabel = formatFireDurationLabel(activeFire);

  const waffleSlices = useMemo(
    () => deriveWaffleSlices(allocation, assets, fxUsdBrl),
    [allocation, assets, fxUsdBrl],
  );

  const driftReport = useMemo(
    () => detectAllocationDrift(assets, allocation, fxUsdBrl),
    [assets, allocation, fxUsdBrl],
  );

  const sortedMonthlyPlans = useMemo(
    () => sortMonthlyPlansChronologically(monthlyPlans),
    [monthlyPlans],
  );

  const monthlyBarData = useMemo(
    () => toPairedMonthBarData(monthlyPlans, barMode),
    [monthlyPlans, barMode],
  );

  const latestMonthlyPlan = useMemo(
    () =>
      sortedMonthlyPlans.length > 0
        ? sortedMonthlyPlans[sortedMonthlyPlans.length - 1]!
        : null,
    [sortedMonthlyPlans],
  );

  // Mutations (all wrapped in try/catch in handlers)
  const refreshQuotesMutation = useMutation({
    mutationFn: () => refreshFinanceQuotes(),
    onSuccess: (res) => {
      setLastQuoteSource(res.fx_source || 'cached');
      setStatusBanner(
        `QUOTES & FX REFRESHED (${res.refreshed_count} ASSETS // USD/BRL ${res.fx_usd_brl} // SOURCE: ${String(res.fx_source || 'cached').toUpperCase()})`,
      );
      setErrorBanner(null);
      queryClient.invalidateQueries({ queryKey: ['finance-assets'] });
      queryClient.invalidateQueries({ queryKey: ['finance-allocation'] });
      queryClient.invalidateQueries({ queryKey: ['finance-retirement'] });
      queryClient.invalidateQueries({ queryKey: ['finance-candles'] });
    },
  });

  const saveAssetMutation = useMutation({
    mutationFn: async () => {
      const symbolTrimmed = assetSymbol.trim().toUpperCase();
      const nameTrimmed = assetName.trim();
      if (!symbolTrimmed || !nameTrimmed) {
        throw new Error('Symbol and Name are required.');
      }
      const qtyNum = safeFiniteNumber(assetQuantity, 0);
      const avgCost = safeIntCents(assetAvgCostCents, 0);
      const currPrice = safeIntCents(assetPriceCents, 0);
      const targetWeight = safeFiniteNumber(assetTargetWeightPct, 0);

      if (qtyNum < 0 || avgCost < 0 || currPrice < 0) {
        throw new Error('Quantity, average cost, and price must be non-negative.');
      }
      if (targetWeight < 0 || targetWeight > 100) {
        throw new Error('Target weight percentage must be between 0 and 100.');
      }

      const alertLow =
        assetAlertLowCents.trim() !== '' ? safeIntCents(assetAlertLowCents, 0) : null;
      const alertHigh =
        assetAlertHighCents.trim() !== '' ? safeIntCents(assetAlertHighCents, 0) : null;
      if (alertLow !== null && alertHigh !== null && alertLow > alertHigh) {
        throw new Error('Alert low price cannot exceed alert high price.');
      }

      const payload = {
        symbol: symbolTrimmed,
        name: nameTrimmed,
        asset_class: assetClass,
        currency: assetCurrency,
        in_portfolio: assetInPortfolio,
        quantity: String(assetInPortfolio ? qtyNum : 0),
        avg_cost_cents: assetInPortfolio ? avgCost : 0,
        current_price_cents: currPrice,
        target_weight_pct: String(assetInPortfolio ? targetWeight : 0),
        alert_low_cents: alertLow,
        alert_high_cents: alertHigh,
        thesis_md: assetThesisMd,
      };

      if (editingAssetId) {
        return await updateFinanceAsset(editingAssetId, payload);
      }
      return await createFinanceAsset(payload);
    },
    onSuccess: (saved) => {
      setSelectedAssetId(saved.id);
      setShowAssetForm(false);
      setEditingAssetId(null);
      setErrorBanner(null);
      setStatusBanner(`SAVED ASSET ${saved.symbol} (${saved.in_portfolio ? 'HOLDING' : 'WATCHLIST'})`);
      queryClient.invalidateQueries({ queryKey: ['finance-assets'] });
      queryClient.invalidateQueries({ queryKey: ['finance-allocation'] });
      queryClient.invalidateQueries({ queryKey: ['finance-retirement'] });
    },
  });

  const promoteAssetMutation = useMutation({
    mutationFn: (asset: PortfolioAsset) =>
      updateFinanceAsset(asset.id, {
        in_portfolio: true,
        quantity: '1',
        avg_cost_cents: Math.max(0, safeIntCents(asset.current_price_cents, 0)),
      }),
    onSuccess: (updated) => {
      setSelectedAssetId(updated.id);
      setErrorBanner(null);
      setStatusBanner(`PROMOTED ${updated.symbol} FROM WATCHLIST TO ACTIVE HOLDINGS`);
      queryClient.invalidateQueries({ queryKey: ['finance-assets'] });
      queryClient.invalidateQueries({ queryKey: ['finance-allocation'] });
      queryClient.invalidateQueries({ queryKey: ['finance-retirement'] });
    },
  });

  const deleteAssetMutation = useMutation({
    mutationFn: (id: string) => deleteFinanceAsset(id),
    onSuccess: () => {
      setErrorBanner(null);
      setStatusBanner('ASSET REMOVED');
      queryClient.invalidateQueries({ queryKey: ['finance-assets'] });
      queryClient.invalidateQueries({ queryKey: ['finance-allocation'] });
      queryClient.invalidateQueries({ queryKey: ['finance-retirement'] });
    },
  });

  const saveThesisAndAlertsMutation = useMutation({
    mutationFn: async () => {
      if (!resolvedSelectedAsset) {
        throw new Error('Select an asset first.');
      }
      const alertLow =
        drawerAlertLowCents.trim() !== '' ? safeIntCents(drawerAlertLowCents, 0) : null;
      const alertHigh =
        drawerAlertHighCents.trim() !== '' ? safeIntCents(drawerAlertHighCents, 0) : null;
      if (alertLow !== null && alertHigh !== null && alertLow > alertHigh) {
        throw new Error('Alert low threshold cannot exceed alert high threshold.');
      }
      return await updateFinanceAsset(resolvedSelectedAsset.id, {
        thesis_md: drawerThesisMd,
        alert_low_cents: alertLow,
        alert_high_cents: alertHigh,
      });
    },
    onSuccess: (updated) => {
      setErrorBanner(null);
      setStatusBanner(`UPDATED THESIS & ALERTS FOR ${updated.symbol}`);
      queryClient.invalidateQueries({ queryKey: ['finance-assets'] });
    },
  });

  const saveMonthlyPlanMutation = useMutation({
    mutationFn: () =>
      upsertMonthlyPlan(planMonth, {
        currency: 'BRL',
        salary_income_cents: safeIntCents(planSalaryCents, 0),
        planned_spend_cents: safeIntCents(planPlannedSpendCents, 0),
        actual_spend_cents:
          planActualSpendCents.trim() !== '' ? safeIntCents(planActualSpendCents, 0) : null,
        planned_investment_cents: safeIntCents(planPlannedInvestCents, 0),
        actual_invested_cents: safeIntCents(planActualInvestedCents, 0),
        notes_md: planNotesMd,
      }),
    onSuccess: (saved) => {
      setSurplusInputCents(saved.investable_surplus_cents);
      setErrorBanner(null);
      setStatusBanner(`SAVED MACRO PLAN FOR ${saved.month}`);
      queryClient.invalidateQueries({ queryKey: ['finance-monthly-plans'] });
      queryClient.invalidateQueries({ queryKey: ['finance-allocation'] });
      queryClient.invalidateQueries({ queryKey: ['finance-retirement'] });
    },
  });

  const createSnapshotMutation = useMutation({
    mutationFn: () => createPortfolioSnapshot(),
    onSuccess: (snap) => {
      setErrorBanner(null);
      setStatusBanner(`CAPTURED NET WORTH SNAPSHOT (${snap.snapshot_date})`);
      queryClient.invalidateQueries({ queryKey: ['finance-snapshots'] });
    },
  });

  const simulateFireMutation = useMutation({
    mutationFn: () =>
      simulateFireProjection({
        current_net_worth_brl_cents: totalBrlCents,
        monthly_contribution_brl_cents: simMonthlyContribCents,
        monthly_retirement_spend_brl_cents: simMonthlySpendCents,
        expected_real_return_pct: simRealReturnPct.toFixed(2),
        safe_withdrawal_rate_pct: simSwrPct.toFixed(2),
        current_age: simCurrentAge,
      }),
    onSuccess: (simResult) => {
      setSimulatedFire(simResult);
      setErrorBanner(null);
      setStatusBanner('RAN STATELESS WHAT-IF FIRE SIMULATION');
    },
  });

  const saveRetirementConfigMutation = useMutation({
    mutationFn: () =>
      updateRetirementConfig({
        expected_real_return_pct: simRealReturnPct.toFixed(2),
        safe_withdrawal_rate_pct: simSwrPct.toFixed(2),
        override_retirement_monthly_spend_cents: simMonthlySpendCents,
        current_age: simCurrentAge,
      }),
    onSuccess: () => {
      setSimulatedFire(null);
      setErrorBanner(null);
      setStatusBanner('SAVED RETIREMENT CONFIGURATION');
      queryClient.invalidateQueries({ queryKey: ['finance-retirement'] });
    },
  });

  const handleSelectAsset = (assetId: string) => {
    setSelectedAssetId(assetId);
  };

  const handleOpenEditAsset = (asset: PortfolioAsset) => {
    setEditingAssetId(asset.id);
    setAssetSymbol(asset.symbol);
    setAssetName(asset.name);
    setAssetClass(asset.asset_class);
    setAssetCurrency(asset.currency);
    setAssetInPortfolio(asset.in_portfolio);
    setAssetQuantity(asset.quantity);
    setAssetAvgCostCents(String(asset.avg_cost_cents));
    setAssetPriceCents(String(asset.current_price_cents));
    setAssetTargetWeightPct(asset.target_weight_pct);
    setAssetAlertLowCents(asset.alert_low_cents !== null ? String(asset.alert_low_cents) : '');
    setAssetAlertHighCents(asset.alert_high_cents !== null ? String(asset.alert_high_cents) : '');
    setAssetThesisMd(asset.thesis_md ?? '');
    setShowAssetForm(true);
  };

  const handleRefreshQuotes = async () => {
    try {
      await refreshQuotesMutation.mutateAsync();
    } catch (err: any) {
      setErrorBanner(String(err?.message || 'Failed to refresh quotes.'));
    }
  };

  const handleSaveAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await saveAssetMutation.mutateAsync();
    } catch (err: any) {
      setErrorBanner(String(err?.message || 'Failed to save asset.'));
    }
  };

  const handlePromoteAsset = async (asset: PortfolioAsset) => {
    try {
      await promoteAssetMutation.mutateAsync(asset);
    } catch (err: any) {
      setErrorBanner(String(err?.message || 'Failed to promote watchlist item.'));
    }
  };

  const handleDeleteAsset = async (id: string) => {
    try {
      await deleteAssetMutation.mutateAsync(id);
    } catch (err: any) {
      setErrorBanner(String(err?.message || 'Failed to delete asset.'));
    }
  };

  const handleSaveThesisAndAlerts = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await saveThesisAndAlertsMutation.mutateAsync();
    } catch (err: any) {
      setErrorBanner(String(err?.message || 'Failed to update thesis & alerts.'));
    }
  };

  const handleSaveMonthlyPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await saveMonthlyPlanMutation.mutateAsync();
    } catch (err: any) {
      setErrorBanner(String(err?.message || 'Failed to save monthly macro plan.'));
    }
  };

  const handleCaptureSnapshot = async () => {
    try {
      await createSnapshotMutation.mutateAsync();
    } catch (err: any) {
      setErrorBanner(String(err?.message || 'Failed to capture snapshot.'));
    }
  };

  const handleRunSimulation = async () => {
    try {
      await simulateFireMutation.mutateAsync();
    } catch (err: any) {
      setErrorBanner(String(err?.message || 'Failed to run FIRE simulation.'));
    }
  };

  const handleSaveRetirementConfig = async () => {
    try {
      await saveRetirementConfigMutation.mutateAsync();
    } catch (err: any) {
      setErrorBanner(String(err?.message || 'Failed to save retirement config.'));
    }
  };

  return (
    <div
      data-testid="finance-page"
      style={{
        flex: 1,
        padding: '16px',
        backgroundColor: FUI_TOKENS.bgCarbon,
        color: FUI_TOKENS.inkStark,
        borderRadius: '0px',
        maxWidth: '100%',
        boxSizing: 'border-box',
        overflowX: 'hidden',
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderRadius: '0px' }}>
          {/* Command & Currency Bar */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
              padding: '10px 12px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              borderRadius: '0px',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', borderRadius: '0px' }}>
              <span style={{ fontSize: '12px', color: FUI_TOKENS.inkMuted }}>BASE CURRENCY:</span>
              {ASSET_CURRENCIES.map((curr) => {
                const active = baseCurrency === curr;
                return (
                  <button
                    key={curr}
                    type="button"
                    data-testid={`currency-toggle-${curr.toLowerCase()}`}
                    aria-pressed={active}
                    onClick={() => setBaseCurrency(curr)}
                    style={{
                      ...BUTTON_STYLE,
                      backgroundColor: active ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgCarbon,
                      color: active ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                      border: `1px solid ${active ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline}`,
                    }}
                  >
                    {curr}
                  </button>
                );
              })}

              <FuiBadge tone="amber">
                FX USD/BRL: {fxUsdBrl.toFixed(2)} ({formatQuoteSourceBadge(lastQuoteSource)})
              </FuiBadge>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', borderRadius: '0px' }}>
              <button
                type="button"
                data-testid="refresh-quotes-btn"
                onClick={() => void handleRefreshQuotes()}
                style={BUTTON_STYLE}
              >
                ↻ REFRESH QUOTES &amp; FX
              </button>
              <button
                type="button"
                data-testid="toggle-asset-form-btn"
                onClick={() => {
                  setEditingAssetId(null);
                  setShowAssetForm((prev) => !prev);
                }}
                style={PRIMARY_BUTTON_STYLE}
              >
                {showAssetForm ? '× CLOSE ASSET FORM' : '+ ADD ASSET / WATCHLIST'}
              </button>
              <button
                type="button"
                data-testid="finance-privacy-toggle"
                data-privacy-toggle="true"
                aria-pressed={isMasked}
                aria-label={isMasked ? 'Disable privacy mask' : 'Enable privacy mask'}
                onClick={toggleMask}
                style={{
                  ...BUTTON_STYLE,
                  backgroundColor: isMasked ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgCarbon,
                  color: isMasked ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                  border: `1px solid ${isMasked ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline}`,
                }}
              >
                {isMasked ? '👁 PRIVACY: MASKED' : '👁 PRIVACY'}
              </button>
            </div>
          </div>

          {/* Alerts / Status Feedback */}
          {errorBanner && (
            <div
              role="alert"
              data-testid="finance-error-banner"
              style={{
                padding: '8px 12px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.accentVermilion}`,
                color: FUI_TOKENS.accentVermilion,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              [ERROR // MOD_11]: {errorBanner}
            </div>
          )}

          {statusBanner && (
            <div
              data-testid="finance-status-banner"
              style={{
                padding: '8px 12px',
                backgroundColor: FUI_TOKENS.bgCarbon,
                border: `1px solid ${FUI_TOKENS.accentPhosphor}`,
                color: FUI_TOKENS.accentPhosphor,
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              [OK // MOD_11]: {statusBanner}
            </div>
          )}

          {/* Top 5-Metric KPI Strip */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '16px',
              padding: '12px',
              backgroundColor: FUI_TOKENS.bgCarbon,
              border: `1px solid ${FUI_TOKENS.borderHairline}`,
              fontSize: '13px',
              borderRadius: '0px',
            }}
          >
            <div style={{ borderRadius: '0px' }}>
              BRL EQUITY:{' '}
              <PrivacyValue
                kind="currency"
                currency="BRL"
                value={formatBrlCents(totalBrlCents)}
              />
            </div>
            <div style={{ borderRadius: '0px' }}>
              USD HOLDINGS:{' '}
              <PrivacyValue
                kind="currency"
                currency="USD"
                value={formatUsdCents(totalUsdCents)}
              />
            </div>
            <div style={{ borderRadius: '0px' }}>
              FI PROGRESS: <PrivacyValue kind="percent" value={`${fiProgressPct.toFixed(1)}%`} />
            </div>
            <div style={{ borderRadius: '0px' }}>
              PASSIVE COVERAGE:{' '}
              <PrivacyValue kind="percent" value={`${passiveCoveragePct.toFixed(1)}%`} />
            </div>
            <div style={{ borderRadius: '0px' }}>
              TIME TO FIRE: <PrivacyValue kind="duration" value={durationLabel} />
            </div>
            <div style={{ borderRadius: '0px' }}>
              FI TARGET:{' '}
              <PrivacyValue
                kind="currency"
                currency="BRL"
                value={formatBrlCents(fiTargetBrlCents)}
              />
            </div>
          </div>

          {/* Collapsible Add / Edit Asset Form */}
          {showAssetForm && (
            <form
              data-testid="finance-asset-form"
              onSubmit={(e) => void handleSaveAsset(e)}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '10px',
                padding: '12px',
                backgroundColor: FUI_TOKENS.bgPanel,
                border: `1px solid ${FUI_TOKENS.accentOrange}`,
                borderRadius: '0px',
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', borderRadius: '0px' }}>
                <span>SYMBOL (TICKER)</span>
                <input
                  type="text"
                  data-testid="asset-symbol-input"
                  value={assetSymbol}
                  onChange={(e) => setAssetSymbol(e.target.value)}
                  placeholder="PETR4 / VWRA / BTC"
                  style={INPUT_STYLE}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', borderRadius: '0px' }}>
                <span>ASSET NAME</span>
                <input
                  type="text"
                  data-testid="asset-name-input"
                  value={assetName}
                  onChange={(e) => setAssetName(e.target.value)}
                  placeholder="Petrobras PN"
                  style={INPUT_STYLE}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', borderRadius: '0px' }}>
                <span>ASSET CLASS</span>
                <select
                  data-testid="asset-class-select"
                  value={assetClass}
                  onChange={(e) => setAssetClass(e.target.value as AssetClass)}
                  style={INPUT_STYLE}
                >
                  {ASSET_CLASSES.map((cls) => (
                    <option key={cls} value={cls}>
                      {ASSET_CLASS_LABELS[cls]}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', borderRadius: '0px' }}>
                <span>CURRENCY</span>
                <select
                  data-testid="asset-currency-select"
                  value={assetCurrency}
                  onChange={(e) => setAssetCurrency(e.target.value as AssetCurrency)}
                  style={INPUT_STYLE}
                >
                  <option value="BRL">BRL</option>
                  <option value="USD">USD</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', borderRadius: '0px' }}>
                <span>PORTFOLIO MODE</span>
                <select
                  data-testid="asset-mode-select"
                  value={assetInPortfolio ? 'holding' : 'watchlist'}
                  onChange={(e) => setAssetInPortfolio(e.target.value === 'holding')}
                  style={INPUT_STYLE}
                >
                  <option value="holding">ACTIVE HOLDING</option>
                  <option value="watchlist">WATCHLIST ONLY</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', borderRadius: '0px' }}>
                <span>QUANTITY</span>
                <input
                  type="number"
                  step="any"
                  data-testid="asset-quantity-input"
                  value={assetQuantity}
                  onChange={(e) => setAssetQuantity(e.target.value)}
                  style={INPUT_STYLE}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', borderRadius: '0px' }}>
                <span>AVG COST (CENTS)</span>
                <input
                  type="number"
                  data-testid="asset-avg-cost-input"
                  value={assetAvgCostCents}
                  onChange={(e) => setAssetAvgCostCents(e.target.value)}
                  style={INPUT_STYLE}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', borderRadius: '0px' }}>
                <span>CURRENT PRICE (CENTS)</span>
                <input
                  type="number"
                  data-testid="asset-price-input"
                  value={assetPriceCents}
                  onChange={(e) => setAssetPriceCents(e.target.value)}
                  style={INPUT_STYLE}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', borderRadius: '0px' }}>
                <span>TARGET WEIGHT (%)</span>
                <input
                  type="number"
                  step="0.1"
                  data-testid="asset-target-weight-input"
                  value={assetTargetWeightPct}
                  onChange={(e) => setAssetTargetWeightPct(e.target.value)}
                  style={INPUT_STYLE}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', borderRadius: '0px' }}>
                <span>ALERT LOW (CENTS)</span>
                <input
                  type="number"
                  data-testid="asset-alert-low-input"
                  value={assetAlertLowCents}
                  onChange={(e) => setAssetAlertLowCents(e.target.value)}
                  style={INPUT_STYLE}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', borderRadius: '0px' }}>
                <span>ALERT HIGH (CENTS)</span>
                <input
                  type="number"
                  data-testid="asset-alert-high-input"
                  value={assetAlertHighCents}
                  onChange={(e) => setAssetAlertHighCents(e.target.value)}
                  style={INPUT_STYLE}
                />
              </label>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', borderRadius: '0px' }}>
                <button type="submit" data-testid="save-asset-btn" style={PRIMARY_BUTTON_STYLE}>
                  {editingAssetId ? 'UPDATE ASSET' : 'SAVE ASSET'}
                </button>
              </div>
            </form>
          )}

          {/* Multi-Market Holdings (in_portfolio = true) & Watchlist (in_portfolio = false) Tables */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '16px',
              borderRadius: '0px',
            }}
          >
            {/* Active Holdings Table */}
            <div
              data-testid="holdings-table-panel"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '12px',
                backgroundColor: FUI_TOKENS.bgPanel,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderRadius: '0px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '0px' }}>
                <strong style={{ fontSize: '12px', color: FUI_TOKENS.inkStark }}>
                  ACTIVE HOLDINGS // MULTI-MARKET BRL + USD ({holdings.length})
                </strong>
                <FuiBadge tone="amber">CACHED / LIVE QUOTES</FuiBadge>
              </div>

              {holdings.length === 0 ? (
                <div style={{ fontSize: '12px', color: FUI_TOKENS.inkMuted, padding: '8px 0', borderRadius: '0px' }}>
                  [NO ACTIVE HOLDINGS — ADD BRL OR USD ASSETS ABOVE]
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderRadius: '0px' }}>
                  {holdings.map((asset) => {
                    const metrics = computeHoldingMetrics(asset, fxUsdBrl);
                    const isSelected = resolvedSelectedAsset?.id === asset.id;
                    const quoteBadge = formatQuoteSourceBadge(asset.quote_source);

                    return (
                      <div
                        key={asset.id || asset.symbol}
                        data-testid={`holding-row-${asset.symbol}`}
                        onClick={() => handleSelectAsset(asset.id)}
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '8px 10px',
                          backgroundColor: FUI_TOKENS.bgCarbon,
                          border: `1px solid ${isSelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline}`,
                          cursor: 'pointer',
                          fontSize: '12px',
                          borderRadius: '0px',
                        }}
                      >
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', borderRadius: '0px' }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectAsset(asset.id);
                            }}
                            style={{
                              ...BUTTON_STYLE,
                              padding: '2px 8px',
                              minHeight: '26px',
                              borderColor: isSelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline,
                              color: isSelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.inkStark,
                            }}
                          >
                            {asset.symbol}
                          </button>
                          <span style={{ color: FUI_TOKENS.inkMuted }}>{asset.name}</span>
                          <FuiBadge tone="cyan">{ASSET_CLASS_LABELS[asset.asset_class]}</FuiBadge>
                          <FuiBadge tone="amber">{quoteBadge}</FuiBadge>
                          {metrics.isAlertTriggered && (
                            <FuiBadge tone="vermilion">ALERT TRIGGERED</FuiBadge>
                          )}
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: '10px',
                            fontVariantNumeric: 'tabular-nums',
                            borderRadius: '0px',
                          }}
                        >
                          <span>QTY: {metrics.quantityNum}</span>
                          <span>
                            PRICE:{' '}
                            <PrivacyValue
                              kind="currency"
                              currency={asset.currency}
                              value={formatNativeAssetCurrency(asset.current_price_cents, asset.currency)}
                            />
                          </span>
                          <span>
                            VAL:{' '}
                            <PrivacyValue
                              kind="currency"
                              currency={asset.currency}
                              value={formatNativeAssetCurrency(metrics.valueCents, asset.currency)}
                            />
                          </span>
                          <span>
                            P&amp;L:{' '}
                            <PrivacyValue
                              kind="percent"
                              value={`${metrics.unrealizedPnlPct >= 0 ? '+' : ''}${metrics.unrealizedPnlPct.toFixed(1)}%`}
                            />
                          </span>
                          <span>
                            TGT:{' '}
                            <PrivacyValue
                              kind="percent"
                              value={`${safeFiniteNumber(asset.target_weight_pct, 0).toFixed(1)}%`}
                            />
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEditAsset(asset);
                            }}
                            style={{ ...BUTTON_STYLE, padding: '2px 6px', minHeight: '26px' }}
                          >
                            EDIT
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteAsset(asset.id);
                            }}
                            style={{
                              ...BUTTON_STYLE,
                              padding: '2px 6px',
                              minHeight: '26px',
                              color: FUI_TOKENS.accentVermilion,
                            }}
                          >
                            DEL
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Watchlist & Price Alerts Table */}
            <div
              data-testid="watchlist-table-panel"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '12px',
                backgroundColor: FUI_TOKENS.bgPanel,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderRadius: '0px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '0px' }}>
                <strong style={{ fontSize: '12px', color: FUI_TOKENS.inkStark }}>
                  WATCHLIST &amp; TARGET ALERT BANDS ({watchlist.length})
                </strong>
                <FuiBadge tone="cyan">1-CLICK PROMOTE</FuiBadge>
              </div>

              {watchlist.length === 0 ? (
                <div style={{ fontSize: '12px', color: FUI_TOKENS.inkMuted, padding: '8px 0', borderRadius: '0px' }}>
                  [NO WATCHLIST TICKERS — ADD WATCHLIST ITEMS TO TRACK ENTRY ALERTS]
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderRadius: '0px' }}>
                  {watchlist.map((asset) => {
                    const metrics = computeHoldingMetrics(asset, fxUsdBrl);
                    const isSelected = resolvedSelectedAsset?.id === asset.id;
                    const quoteBadge = formatQuoteSourceBadge(asset.quote_source);

                    return (
                      <div
                        key={asset.id || asset.symbol}
                        data-testid={`watchlist-row-${asset.symbol}`}
                        onClick={() => handleSelectAsset(asset.id)}
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '8px 10px',
                          backgroundColor: FUI_TOKENS.bgCarbon,
                          border: `1px solid ${isSelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline}`,
                          cursor: 'pointer',
                          fontSize: '12px',
                          borderRadius: '0px',
                        }}
                      >
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', borderRadius: '0px' }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectAsset(asset.id);
                            }}
                            style={{
                              ...BUTTON_STYLE,
                              padding: '2px 8px',
                              minHeight: '26px',
                              borderColor: isSelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline,
                            }}
                          >
                            {asset.symbol}
                          </button>
                          <span style={{ color: FUI_TOKENS.inkMuted }}>{asset.name}</span>
                          <FuiBadge tone="amber">{quoteBadge}</FuiBadge>
                          {metrics.isAlertTriggered && (
                            <FuiBadge tone="vermilion">ALERT TRIGGERED</FuiBadge>
                          )}
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: '8px',
                            fontVariantNumeric: 'tabular-nums',
                            borderRadius: '0px',
                          }}
                        >
                          <span>
                            SPOT:{' '}
                            <PrivacyValue
                              kind="currency"
                              currency={asset.currency}
                              value={formatNativeAssetCurrency(asset.current_price_cents, asset.currency)}
                            />
                          </span>
                          {asset.alert_low_cents !== null && (
                            <span>
                              LOW:{' '}
                              <PrivacyValue
                                kind="currency"
                                currency={asset.currency}
                                value={formatNativeAssetCurrency(asset.alert_low_cents, asset.currency)}
                              />
                            </span>
                          )}
                          {asset.alert_high_cents !== null && (
                            <span>
                              HIGH:{' '}
                              <PrivacyValue
                                kind="currency"
                                currency={asset.currency}
                                value={formatNativeAssetCurrency(asset.alert_high_cents, asset.currency)}
                              />
                            </span>
                          )}
                          <button
                            type="button"
                            data-testid={`promote-watchlist-${asset.symbol}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handlePromoteAsset(asset);
                            }}
                            style={{
                              ...PRIMARY_BUTTON_STYLE,
                              padding: '2px 8px',
                              minHeight: '26px',
                            }}
                          >
                            ↑ PROMOTE TO HOLDINGS
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteAsset(asset.id);
                            }}
                            style={{
                              ...BUTTON_STYLE,
                              padding: '2px 6px',
                              minHeight: '26px',
                              color: FUI_TOKENS.accentVermilion,
                            }}
                          >
                            DEL
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 10x20 Waffle Grid + Drift Warning + HatchedDonutGauge + Smart Buy-Only Rebalancer */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '16px',
              borderRadius: '0px',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRadius: '0px' }}>
              {driftReport.hasDrift && (
                <div
                  data-waffle-part="drift-warning"
                  data-testid="allocation-drift-warning"
                  style={{
                    padding: '6px 10px',
                    backgroundColor: FUI_TOKENS.bgCarbon,
                    border: `1px solid ${FUI_TOKENS.accentAmber}`,
                    color: FUI_TOKENS.accentAmber,
                    fontSize: '12px',
                    fontVariantNumeric: 'tabular-nums',
                    borderRadius: '0px',
                  }}
                >
                  ⚠ ALLOCATION DRIFT &gt; 5% FROM TARGET (MAX DRIFT: {driftReport.maxDriftPct.toFixed(1)}% // TARGET SUM: {driftReport.targetSumPct.toFixed(1)}%)
                </div>
              )}

              <WaffleGrid10x20
                items={waffleSlices}
                currency={baseCurrency}
                totalValueCents={baseCurrency === 'USD' ? totalUsdCents : totalBrlCents}
                preserveUnallocated={waffleSlices.length === 0}
              />

              {/* Smart Buy-Only Rebalancer */}
              <div
                data-testid="buy-only-rebalancer-panel"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  padding: '10px',
                  backgroundColor: FUI_TOKENS.bgPanel,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  fontSize: '12px',
                  borderRadius: '0px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                    borderRadius: '0px',
                  }}
                >
                  <strong>SMART BUY-ONLY REBALANCER (ZERO SELLS)</strong>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', borderRadius: '0px' }}>
                    <span>SURPLUS (CENTS):</span>
                    <input
                      type="number"
                      data-testid="rebalancer-surplus-input"
                      value={surplusInputCents}
                      onChange={(e) => setSurplusInputCents(Math.max(0, safeIntCents(e.target.value, 0)))}
                      style={{ ...INPUT_STYLE, width: '120px' }}
                    />
                  </label>
                </div>

                {Array.isArray(allocation?.recommendations) && allocation.recommendations.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
                    {allocation.recommendations.map((rec) => {
                      const buyCents = Math.max(0, safeIntCents(rec.recommended_buy_cents, 0));
                      return (
                        <div
                          key={rec.asset_id || rec.symbol}
                          data-testid={`rebalance-row-${rec.symbol}`}
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 8px',
                            backgroundColor: FUI_TOKENS.bgCarbon,
                            border: `1px solid ${FUI_TOKENS.borderHairline}`,
                            fontVariantNumeric: 'tabular-nums',
                            borderRadius: '0px',
                          }}
                        >
                          <strong>{rec.symbol}</strong>
                          <span>
                            CUR: <PrivacyValue kind="percent" value={`${rec.current_weight_pct.toFixed(1)}%`} /> → TGT:{' '}
                            <PrivacyValue kind="percent" value={`${rec.target_weight_pct.toFixed(1)}%`} />
                          </span>
                          <span>
                            BUY:{' '}
                            <PrivacyValue
                              kind="currency"
                              currency={baseCurrency}
                              value={formatNativeAssetCurrency(buyCents, baseCurrency)}
                            />{' '}
                            ({rec.recommended_units} UNITS)
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ color: FUI_TOKENS.inkMuted, borderRadius: '0px' }}>
                    [ENTER INVESTABLE SURPLUS ABOVE TO COMPUTE BUY-ONLY ALLOCATIONS]
                  </div>
                )}
              </div>
            </div>

            {/* FIRE Gauge & Stateless What-If Simulator */}
            <div
              data-testid="fire-simulator-panel"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                padding: '12px',
                backgroundColor: FUI_TOKENS.bgPanel,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderRadius: '0px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '0px' }}>
                <strong style={{ fontSize: '12px' }}>FIRE &amp; RETIREMENT ENGINE (SWR TARGET)</strong>
                <span style={{ fontSize: '12px', color: FUI_TOKENS.accentOrange, fontVariantNumeric: 'tabular-nums' }}>
                  COAST FIRE:{' '}
                  <PrivacyValue
                    kind="currency"
                    currency="BRL"
                    value={formatBrlCents(coastFireBrlCents)}
                  />
                </span>
              </div>

              <div data-fui-ring="true" style={{ display: 'flex', justifyContent: 'center' }}>
                <HatchedDonutGauge
                  solidPct={fiProgressPct}
                  hatchedPct={passiveCoveragePct}
                  centerLabel={`${fiProgressPct.toFixed(1)}%`}
                  durationLabel={durationLabel}
                />
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: '8px',
                  fontSize: '12px',
                  borderRadius: '0px',
                }}
              >
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
                  <span>
                    RETIREMENT SPEND:{' '}
                    <PrivacyValue kind="currency" currency="BRL" value={formatBrlCents(simMonthlySpendCents)} />
                  </span>
                  <input
                    type="range"
                    min={200000}
                    max={5000000}
                    step={50000}
                    data-testid="fire-spend-slider"
                    value={simMonthlySpendCents}
                    onChange={(e) => setSimMonthlySpendCents(safeIntCents(e.target.value, 1000000))}
                    style={{ borderRadius: '0px', fontSize: '12px' }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
                  <span>
                    MONTHLY CONTRIBUTION:{' '}
                    <PrivacyValue kind="currency" currency="BRL" value={formatBrlCents(simMonthlyContribCents)} />
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={5000000}
                    step={50000}
                    data-testid="fire-contrib-slider"
                    value={simMonthlyContribCents}
                    onChange={(e) => setSimMonthlyContribCents(safeIntCents(e.target.value, 1000000))}
                    style={{ borderRadius: '0px', fontSize: '12px' }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
                  <span>
                    REAL RETURN: <PrivacyValue kind="percent" value={`${simRealReturnPct.toFixed(1)}%`} />
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={15}
                    step={0.5}
                    data-testid="fire-return-slider"
                    value={simRealReturnPct}
                    onChange={(e) => setSimRealReturnPct(safeFiniteNumber(e.target.value, 6.5))}
                    style={{ borderRadius: '0px', fontSize: '12px' }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
                  <span>
                    SWR RATE: <PrivacyValue kind="percent" value={`${simSwrPct.toFixed(1)}%`} />
                  </span>
                  <input
                    type="range"
                    min={2}
                    max={8}
                    step={0.25}
                    data-testid="fire-swr-slider"
                    value={simSwrPct}
                    onChange={(e) => setSimSwrPct(safeFiniteNumber(e.target.value, 4.0))}
                    style={{ borderRadius: '0px', fontSize: '12px' }}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', borderRadius: '0px' }}>
                <button
                  type="button"
                  data-testid="simulate-fire-btn"
                  onClick={() => void handleRunSimulation()}
                  style={PRIMARY_BUTTON_STYLE}
                >
                  ▶ SIMULATE WHAT-IF
                </button>
                <button
                  type="button"
                  data-testid="save-fire-config-btn"
                  onClick={() => void handleSaveRetirementConfig()}
                  style={BUTTON_STYLE}
                >
                  SAVE RETIREMENT CONFIG
                </button>
              </div>
            </div>
          </div>

          {/* PairedHatchBarChart + Single Macro YYYY-MM Monthly Plan Form & CandlestickChart + Thesis Drawer */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '16px',
              borderRadius: '0px',
            }}
          >
            {/* Left Column: PairedHatchBarChart + Single Macro YYYY-MM Planner */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderRadius: '0px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '0px' }}>
                <div style={{ display: 'flex', gap: '6px', borderRadius: '0px' }}>
                  <button
                    type="button"
                    onClick={() => setBarMode('spend')}
                    style={{
                      ...BUTTON_STYLE,
                      padding: '4px 8px',
                      backgroundColor: barMode === 'spend' ? FUI_TOKENS.inkStark : FUI_TOKENS.bgCarbon,
                      color: barMode === 'spend' ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                    }}
                  >
                    MACRO SPEND
                  </button>
                  <button
                    type="button"
                    onClick={() => setBarMode('investment')}
                    style={{
                      ...BUTTON_STYLE,
                      padding: '4px 8px',
                      backgroundColor: barMode === 'investment' ? FUI_TOKENS.inkStark : FUI_TOKENS.bgCarbon,
                      color: barMode === 'investment' ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                    }}
                  >
                    INVESTED
                  </button>
                </div>

                <button
                  type="button"
                  data-testid="capture-snapshot-btn"
                  onClick={() => void handleCaptureSnapshot()}
                  style={BUTTON_STYLE}
                >
                  + CAPTURE SNAPSHOT ({snapshots.length})
                </button>
              </div>

              <PairedHatchBarChart
                data={monthlyBarData}
                range={barRange}
                onRangeChange={setBarRange}
                mode={barMode}
              />

              {/* Single Macro YYYY-MM Salary vs Planned/Actual Spend Sheet */}
              <form
                data-testid="monthly-plan-form"
                onSubmit={(e) => void handleSaveMonthlyPlan(e)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  padding: '10px',
                  backgroundColor: FUI_TOKENS.bgPanel,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  fontSize: '12px',
                  borderRadius: '0px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '0px' }}>
                  <strong>SINGLE MACRO MONTHLY PLANNER (YYYY-MM)</strong>
                  {latestMonthlyPlan && (
                    <span>
                      SURPLUS:{' '}
                      <PrivacyValue
                        kind="currency"
                        currency="BRL"
                        value={formatBrlCents(latestMonthlyPlan.investable_surplus_cents)}
                      />{' '}
                      // SAVINGS:{' '}
                      <PrivacyValue
                        kind="percent"
                        value={`${safeFiniteNumber(latestMonthlyPlan.savings_rate_pct, 0).toFixed(1)}%`}
                      />
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                    gap: '8px',
                    borderRadius: '0px',
                  }}
                >
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
                    <span>MONTH (YYYY-MM)</span>
                    <input
                      type="text"
                      data-testid="plan-month-input"
                      value={planMonth}
                      onChange={(e) => setPlanMonth(e.target.value)}
                      style={INPUT_STYLE}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
                    <span>SALARY INCOME (CENTS)</span>
                    <input
                      type="number"
                      data-testid="plan-salary-input"
                      value={planSalaryCents}
                      onChange={(e) => setPlanSalaryCents(e.target.value)}
                      style={INPUT_STYLE}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
                    <span>PLANNED SPEND (CENTS)</span>
                    <input
                      type="number"
                      data-testid="plan-planned-spend-input"
                      value={planPlannedSpendCents}
                      onChange={(e) => setPlanPlannedSpendCents(e.target.value)}
                      style={INPUT_STYLE}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
                    <span>ACTUAL SPEND (CENTS)</span>
                    <input
                      type="number"
                      data-testid="plan-actual-spend-input"
                      value={planActualSpendCents}
                      onChange={(e) => setPlanActualSpendCents(e.target.value)}
                      style={INPUT_STYLE}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
                    <span>PLANNED INVEST (CENTS)</span>
                    <input
                      type="number"
                      data-testid="plan-planned-invest-input"
                      value={planPlannedInvestCents}
                      onChange={(e) => setPlanPlannedInvestCents(e.target.value)}
                      style={INPUT_STYLE}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
                    <span>ACTUAL INVESTED (CENTS)</span>
                    <input
                      type="number"
                      data-testid="plan-actual-invest-input"
                      value={planActualInvestedCents}
                      onChange={(e) => setPlanActualInvestedCents(e.target.value)}
                      style={INPUT_STYLE}
                    />
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', borderRadius: '0px' }}>
                  <button type="submit" data-testid="save-monthly-plan-btn" style={PRIMARY_BUTTON_STYLE}>
                    SAVE MACRO MONTHLY PLAN
                  </button>
                </div>
              </form>
            </div>

            {/* Right Column: CandlestickChart + Markdown Investment Thesis & Alerts Drawer */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderRadius: '0px' }}>
              <CandlestickChart
                symbol={resolvedSelectedAsset?.symbol || 'NO_ASSETS'}
                name={resolvedSelectedAsset?.name}
                candles={candleData}
                range={candleRange}
                onRangeChange={setCandleRange}
                currency={resolvedSelectedAsset?.currency ?? 'BRL'}
                quoteSource={isSelectedQuoteCached ? 'cached' : 'live'}
              />

              <form
                data-testid="asset-thesis-form"
                onSubmit={(e) => void handleSaveThesisAndAlerts(e)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  padding: '10px',
                  backgroundColor: FUI_TOKENS.bgPanel,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  fontSize: '12px',
                  borderRadius: '0px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '0px' }}>
                  <strong>
                    INVESTMENT THESIS &amp; ALERTS // {resolvedSelectedAsset?.symbol || 'NO_ASSET'}
                  </strong>
                  <FuiBadge tone="amber">
                    QUOTE: {isSelectedQuoteCached ? 'CACHED / MANUAL' : 'LIVE'}
                  </FuiBadge>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: '8px',
                    borderRadius: '0px',
                  }}
                >
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
                    <span>ALERT LOW (CENTS)</span>
                    <input
                      type="number"
                      data-testid="drawer-alert-low-input"
                      value={drawerAlertLowCents}
                      onChange={(e) => setDrawerAlertLowCents(e.target.value)}
                      style={INPUT_STYLE}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
                    <span>ALERT HIGH (CENTS)</span>
                    <input
                      type="number"
                      data-testid="drawer-alert-high-input"
                      value={drawerAlertHighCents}
                      onChange={(e) => setDrawerAlertHighCents(e.target.value)}
                      style={INPUT_STYLE}
                    />
                  </label>
                </div>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderRadius: '0px' }}>
                  <span>MARKDOWN INVESTMENT THESIS</span>
                  <textarea
                    rows={3}
                    data-testid="drawer-thesis-textarea"
                    value={drawerThesisMd}
                    onChange={(e) => setDrawerThesisMd(e.target.value)}
                    placeholder="Document bull case, valuation moat, and exit triggers..."
                    style={{ ...INPUT_STYLE, minHeight: '64px', resize: 'vertical' }}
                  />
                </label>

                <div style={{ display: 'flex', justifyContent: 'flex-end', borderRadius: '0px' }}>
                  <button
                    type="submit"
                    data-testid="save-thesis-btn"
                    disabled={!resolvedSelectedAsset}
                    style={PRIMARY_BUTTON_STYLE}
                  >
                    SAVE THESIS &amp; ALERTS
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </FuiPanel>
    </div>
  );
}

export const FinanceView = FinancePage;
export default FinancePage;

