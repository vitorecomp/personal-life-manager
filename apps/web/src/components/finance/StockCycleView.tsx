import React, { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  CandlestickChart,
  FuiBadge,
  FuiPanel,
  FUI_TOKENS,
  PrivacyValue,
  usePrivacyMask,
} from '@hermes/ui';
import { formatBrlCents, formatUsdCents, UUID_RE } from '../../api/client';
import {
  ASSET_CLASS_LABELS,
  CANDLE_RANGES,
  computeCombinedCandles,
  computeHoldingMetrics,
  convertCurrencyCents,
  fetchAssetCandles,
  fetchFinanceAllocation,
  fetchFinanceAssets,
  resolveStockCycleAssets,
  safeFiniteNumber,
  type AssetCurrency,
  type CandleRangeKey,
  type CandlestickBarDto,
  type PortfolioAsset,
  type StockCycleSelectionMode,
  type StockCycleWeightingMode,
} from '../../api/finance';

function formatAssetMoney(cents: unknown, currency: AssetCurrency = 'BRL'): string {
  return currency === 'USD' ? formatUsdCents(cents) : formatBrlCents(cents);
}

const CONTROL_BUTTON_STYLE: React.CSSProperties = {
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
  boxSizing: 'border-box',
};

const ACTIVE_CONTROL_BUTTON_STYLE: React.CSSProperties = {
  ...CONTROL_BUTTON_STYLE,
  backgroundColor: FUI_TOKENS.accentOrange,
  color: FUI_TOKENS.bgCarbon,
  border: `1px solid ${FUI_TOKENS.accentOrange}`,
  fontWeight: 700,
};

export function StockCycleView() {
  const { isMasked, toggleMask } = usePrivacyMask();

  const [selectionMode, setSelectionMode] = useState<StockCycleSelectionMode>('SINGLE');
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [weightingMode, setWeightingMode] =
    useState<StockCycleWeightingMode>('PORTFOLIO_WEIGHTED');
  const [baseCurrency, setBaseCurrency] = useState<AssetCurrency>('BRL');
  const [candleRange, setCandleRange] = useState<CandleRangeKey>('1M');
  const [filterQuery, setFilterQuery] = useState<string>('');

  const assetsQuery = useQuery({
    queryKey: ['finance-assets'],
    queryFn: () => fetchFinanceAssets(),
  });

  const allocationQuery = useQuery({
    queryKey: ['finance-allocation', baseCurrency],
    queryFn: () => fetchFinanceAllocation(baseCurrency),
  });

  const { assets, isFallbackSeed } = useMemo(
    () => resolveStockCycleAssets(assetsQuery.data),
    [assetsQuery.data],
  );

  const fxUsdBrl = useMemo(
    () => Math.max(0.01, safeFiniteNumber(allocationQuery.data?.fx_usd_brl, 5.0)),
    [allocationQuery.data?.fx_usd_brl],
  );

  // Ensure at least the first available stock is selected by default
  useEffect(() => {
    if (assets.length === 0) return;
    setSelectedSymbols((prev) => {
      const valid = prev.filter((sym) => assets.some((a) => a.symbol === sym));
      if (valid.length > 0) return valid;
      return [assets[0]!.symbol];
    });
  }, [assets]);

  const filteredAssets = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter(
      (a) =>
        a.symbol.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.asset_class.toLowerCase().includes(q),
    );
  }, [assets, filterQuery]);

  const selectedAssets = useMemo(() => {
    const matched = assets.filter((a) => selectedSymbols.includes(a.symbol));
    if (matched.length > 0) {
      return selectionMode === 'SINGLE' ? [matched[0]!] : matched;
    }
    return assets[0] ? [assets[0]] : [];
  }, [assets, selectedSymbols, selectionMode]);

  const candleQueries = useQueries({
    queries: selectedAssets.map((asset) => {
      const hasUuid = UUID_RE.test(asset.id);
      return {
        queryKey: ['finance-candles', asset.id, candleRange, asset.symbol],
        queryFn: () => fetchAssetCandles(asset.id, candleRange, asset.symbol),
        enabled: hasUuid,
      };
    }),
  });

  const candlesBySymbol = useMemo(() => {
    const map: Record<string, CandlestickBarDto[]> = {};
    selectedAssets.forEach((asset, idx) => {
      const data = candleQueries[idx]?.data;
      if (data && Array.isArray(data.candles) && data.candles.length > 0) {
        map[asset.symbol] = data.candles;
      }
    });
    return map;
  }, [selectedAssets, candleQueries]);

  const { chartData, metrics } = useMemo(
    () =>
      computeCombinedCandles({
        selectedAssets,
        candlesBySymbol,
        rangeKey: candleRange,
        baseCurrency,
        fxUsdBrl,
        weightingMode,
      }),
    [selectedAssets, candlesBySymbol, candleRange, baseCurrency, fxUsdBrl, weightingMode],
  );

  const handleSelectSingleStock = (symbol: string) => {
    setSelectionMode('SINGLE');
    setSelectedSymbols([symbol]);
  };

  const handleToggleStockInCombination = (symbol: string) => {
    setSelectedSymbols((prev) => {
      const exists = prev.includes(symbol);
      if (!exists) {
        const next = [...prev, symbol];
        if (next.length >= 2) {
          setSelectionMode('COMBINED');
        }
        return next;
      }
      if (prev.length <= 1) {
        setSelectionMode('COMBINED');
        return prev;
      }
      const next = prev.filter((s) => s !== symbol);
      if (next.length === 1) {
        setSelectionMode('SINGLE');
      } else {
        setSelectionMode('COMBINED');
      }
      return next;
    });
  };

  const handleActivateCombinedOption = () => {
    setSelectionMode('COMBINED');
    setSelectedSymbols((prev) => {
      const valid = prev.filter((sym) => assets.some((a) => a.symbol === sym));
      if (valid.length >= 2) return valid;
      return assets.map((a) => a.symbol);
    });
  };

  const handleCombineAllStocks = () => {
    setSelectionMode('COMBINED');
    setSelectedSymbols(assets.map((a) => a.symbol));
  };

  const handleCombineHoldingsOnly = () => {
    const holdings = assets.filter((a) => a.in_portfolio);
    const target = holdings.length >= 2 ? holdings : assets;
    setSelectionMode(target.length >= 2 ? 'COMBINED' : 'SINGLE');
    setSelectedSymbols(target.map((a) => a.symbol));
  };

  const handleSwitchSingleMode = () => {
    setSelectionMode('SINGLE');
    setSelectedSymbols((prev) => {
      const first = prev.find((sym) => assets.some((a) => a.symbol === sym));
      return [first ?? assets[0]?.symbol ?? 'PETR4'];
    });
  };

  const isCombinedActive = selectionMode === 'COMBINED' || selectedAssets.length > 1;

  return (
    <div
      data-testid="stock-cycle-page"
      data-fui="stock-cycle-view"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '16px',
        backgroundColor: FUI_TOKENS.bgCarbon,
        color: FUI_TOKENS.inkStark,
        fontFamily: FUI_TOKENS.fontMono,
        borderRadius: '0px',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        overflowX: 'hidden',
      }}
    >
      {/* Top Command Header */}
      <FuiPanel
        data-testid="stock-cycle-header"
        headerProps={{
          title: 'FINANCE // STOCK CYCLE & MULTI-ASSET CANDLESTICK SYNTHESIS',
          code: 'MOD_11B // CYCLE',
          accent: 'orange',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            borderRadius: '0px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '8px',
              borderRadius: '0px',
            }}
          >
            <FuiBadge tone={isCombinedActive ? 'orange' : 'cyan'}>
              {isCombinedActive
                ? `COMBINED CYCLE // ${selectedAssets.length} STOCKS`
                : `SINGLE STOCK // ${selectedAssets[0]?.symbol ?? 'NONE'}`}
            </FuiBadge>
            <FuiBadge tone={isFallbackSeed ? 'amber' : 'phosphor'}>
              {isFallbackSeed ? 'SEEDED ROSTER' : 'LIVE PORTFOLIO'}
            </FuiBadge>
            <span style={{ fontSize: '12px', color: FUI_TOKENS.inkMuted, borderRadius: '0px' }}>
              FX USD/BRL: {fxUsdBrl.toFixed(2)}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '0px',
            }}
          >
            {/* Mode Switcher */}
            <button
              type="button"
              data-testid="stock-cycle-mode-single"
              data-active={!isCombinedActive ? 'true' : 'false'}
              aria-pressed={!isCombinedActive}
              onClick={handleSwitchSingleMode}
              style={!isCombinedActive ? ACTIVE_CONTROL_BUTTON_STYLE : CONTROL_BUTTON_STYLE}
            >
              SINGLE STOCK
            </button>
            <button
              type="button"
              data-testid="stock-cycle-mode-combined"
              data-active={isCombinedActive ? 'true' : 'false'}
              aria-pressed={isCombinedActive}
              onClick={handleActivateCombinedOption}
              style={isCombinedActive ? ACTIVE_CONTROL_BUTTON_STYLE : CONTROL_BUTTON_STYLE}
            >
              COMBINED CYCLE
            </button>

            {/* Weighting Selector */}
            <button
              type="button"
              data-testid="stock-cycle-weight-portfolio"
              aria-pressed={weightingMode === 'PORTFOLIO_WEIGHTED'}
              onClick={() => setWeightingMode('PORTFOLIO_WEIGHTED')}
              style={
                weightingMode === 'PORTFOLIO_WEIGHTED'
                  ? ACTIVE_CONTROL_BUTTON_STYLE
                  : CONTROL_BUTTON_STYLE
              }
            >
              PORTFOLIO WEIGHTED
            </button>
            <button
              type="button"
              data-testid="stock-cycle-weight-equal"
              aria-pressed={weightingMode === 'EQUAL_WEIGHT'}
              onClick={() => setWeightingMode('EQUAL_WEIGHT')}
              style={
                weightingMode === 'EQUAL_WEIGHT'
                  ? ACTIVE_CONTROL_BUTTON_STYLE
                  : CONTROL_BUTTON_STYLE
              }
            >
              EQUAL WEIGHT
            </button>
            <button
              type="button"
              data-testid="stock-cycle-weight-index"
              aria-pressed={weightingMode === 'INDEX_100'}
              onClick={() => setWeightingMode('INDEX_100')}
              style={
                weightingMode === 'INDEX_100'
                  ? ACTIVE_CONTROL_BUTTON_STYLE
                  : CONTROL_BUTTON_STYLE
              }
            >
              INDEX 100
            </button>

            {/* Base Currency Toggle */}
            <button
              type="button"
              data-testid="stock-cycle-currency-brl"
              aria-pressed={baseCurrency === 'BRL'}
              onClick={() => setBaseCurrency('BRL')}
              style={
                baseCurrency === 'BRL' ? ACTIVE_CONTROL_BUTTON_STYLE : CONTROL_BUTTON_STYLE
              }
            >
              BRL
            </button>
            <button
              type="button"
              data-testid="stock-cycle-currency-usd"
              aria-pressed={baseCurrency === 'USD'}
              onClick={() => setBaseCurrency('USD')}
              style={
                baseCurrency === 'USD' ? ACTIVE_CONTROL_BUTTON_STYLE : CONTROL_BUTTON_STYLE
              }
            >
              USD
            </button>

            {/* Privacy Mask Toggle */}
            <button
              type="button"
              data-testid="finance-privacy-toggle"
              aria-pressed={isMasked}
              onClick={toggleMask}
              style={isMasked ? ACTIVE_CONTROL_BUTTON_STYLE : CONTROL_BUTTON_STYLE}
            >
              {isMasked ? '👁️ MASKED' : '👁️ PRIVACY'}
            </button>
          </div>
        </div>
      </FuiPanel>

      {/* Main 2-Column Layout: Left Stock Selector + Right Candlestick Graph */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(270px, 340px) minmax(0, 1fr)',
          gap: '16px',
          alignItems: 'start',
          minWidth: 0,
          maxWidth: '100%',
          borderRadius: '0px',
        }}
      >
        {/* Left Column — User's Stock Selector */}
        <aside
          data-testid="stock-cycle-sidebar"
          aria-label="User Stocks Selector"
          style={{
            minWidth: 0,
            borderRadius: '0px',
          }}
        >
          <FuiPanel
            headerProps={{
              title: 'STOCK ROSTER // LEFT SELECTOR',
              code: `${assets.length} TICKERS`,
              accent: 'cyan',
            }}
          >
            <div
              data-testid="stock-cycle-stock-list"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                borderRadius: '0px',
              }}
            >
              {/* Prominent Combination Option Button */}
              <button
                type="button"
                data-testid="stock-cycle-combine-option"
                data-active={isCombinedActive ? 'true' : 'false'}
                aria-pressed={isCombinedActive}
                onClick={handleActivateCombinedOption}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  width: '100%',
                  padding: '10px',
                  textAlign: 'left',
                  backgroundColor: isCombinedActive
                    ? FUI_TOKENS.bgPanel
                    : FUI_TOKENS.bgCarbon,
                  color: FUI_TOKENS.inkStark,
                  border: `1px solid ${
                    isCombinedActive ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                  }`,
                  borderLeft: `4px solid ${
                    isCombinedActive ? FUI_TOKENS.accentOrange : FUI_TOKENS.accentCyan
                  }`,
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  cursor: 'pointer',
                  borderRadius: '0px',
                  boxSizing: 'border-box',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '6px',
                    width: '100%',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: isCombinedActive ? FUI_TOKENS.accentOrange : FUI_TOKENS.inkStark,
                    borderRadius: '0px',
                  }}
                >
                  <span style={{ fontSize: '12px', borderRadius: '0px' }}>
                    [⊕ COMBINED STOCK CYCLE]
                  </span>
                  <span style={{ fontSize: '12px', borderRadius: '0px' }}>
                    [{selectedAssets.length}/{assets.length} ACTIVE]
                  </span>
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: FUI_TOKENS.inkMuted,
                    borderRadius: '0px',
                  }}
                >
                  Combine selected stocks into a unified OHLCV candlestick cycle
                </div>
              </button>

              {/* Quick Multi-Select Controls */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '6px',
                  borderRadius: '0px',
                }}
              >
                <button
                  type="button"
                  data-testid="stock-cycle-combine-all-btn"
                  onClick={handleCombineAllStocks}
                  style={CONTROL_BUTTON_STYLE}
                >
                  COMBINE ALL ({assets.length})
                </button>
                <button
                  type="button"
                  data-testid="stock-cycle-combine-holdings-btn"
                  onClick={handleCombineHoldingsOnly}
                  style={CONTROL_BUTTON_STYLE}
                >
                  HOLDINGS ONLY
                </button>
              </div>

              {/* Ticker Search Input */}
              <input
                type="text"
                data-testid="stock-cycle-filter-input"
                aria-label="Filter stocks by ticker or name"
                placeholder="FILTER TICKER // PETR4, WEGE3, VOO..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  minHeight: '32px',
                  backgroundColor: FUI_TOKENS.bgCarbon,
                  color: FUI_TOKENS.inkStark,
                  border: `1px solid ${FUI_TOKENS.borderHairline}`,
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  borderRadius: '0px',
                  boxSizing: 'border-box',
                }}
              />

              {/* Individual Stock Rows */}
              <div
                role="list"
                data-testid="stock-cycle-list"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  borderRadius: '0px',
                }}
              >
                {filteredAssets.map((asset: PortfolioAsset) => {
                  const isSelected = selectedAssets.some((a) => a.symbol === asset.symbol);
                  const holding = computeHoldingMetrics(asset, fxUsdBrl);
                  const pnlPositive = holding.unrealizedPnlPct >= 0;

                  return (
                    <div
                      key={asset.id || asset.symbol}
                      role="listitem"
                      data-testid={`stock-cycle-item-${asset.symbol}`}
                      data-symbol={asset.symbol}
                      data-selected={isSelected ? 'true' : 'false'}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        padding: '8px',
                        backgroundColor: isSelected
                          ? FUI_TOKENS.bgPanel
                          : FUI_TOKENS.bgCarbon,
                        border: `1px solid ${
                          isSelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                        }`,
                        borderLeft: `3px solid ${
                          isSelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                        }`,
                        borderRadius: '0px',
                        boxSizing: 'border-box',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '6px',
                          borderRadius: '0px',
                        }}
                      >
                        {/* Multi-select Checkbox Button */}
                        <button
                          type="button"
                          data-testid={`stock-cycle-check-${asset.symbol}`}
                          aria-label={`Toggle ${asset.symbol} in combined stock cycle`}
                          aria-pressed={isSelected}
                          onClick={() => handleToggleStockInCombination(asset.symbol)}
                          style={{
                            padding: '4px 8px',
                            minHeight: '28px',
                            backgroundColor: isSelected
                              ? FUI_TOKENS.accentOrange
                              : FUI_TOKENS.bgPanel,
                            color: isSelected ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark,
                            border: `1px solid ${
                              isSelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                            }`,
                            fontFamily: FUI_TOKENS.fontMono,
                            fontSize: '12px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            borderRadius: '0px',
                          }}
                        >
                          {isSelected ? '[✓]' : '[ ]'}
                        </button>

                        {/* Primary Single-Stock Select Button */}
                        <button
                          type="button"
                          data-testid={`stock-cycle-select-${asset.symbol}`}
                          aria-label={`Show ${asset.symbol} candlestick graph`}
                          aria-pressed={
                            !isCombinedActive && selectedAssets[0]?.symbol === asset.symbol
                          }
                          onClick={() => handleSelectSingleStock(asset.symbol)}
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '6px',
                            padding: '4px 8px',
                            minHeight: '28px',
                            textAlign: 'left',
                            backgroundColor: FUI_TOKENS.bgPanel,
                            color: FUI_TOKENS.inkStark,
                            border: `1px solid ${FUI_TOKENS.borderHairline}`,
                            fontFamily: FUI_TOKENS.fontMono,
                            fontSize: '12px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            borderRadius: '0px',
                          }}
                        >
                          <span style={{ fontSize: '12px', borderRadius: '0px' }}>
                            {asset.symbol}
                          </span>
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: 500,
                              color: FUI_TOKENS.inkMuted,
                              borderRadius: '0px',
                            }}
                          >
                            {asset.currency}
                          </span>
                        </button>

                        {/* Multi-select Toggle Button Alias */}
                        <button
                          type="button"
                          data-testid={`stock-cycle-toggle-${asset.symbol}`}
                          aria-label={`Combine ${asset.symbol}`}
                          aria-pressed={isSelected}
                          onClick={() => handleToggleStockInCombination(asset.symbol)}
                          style={{
                            padding: '4px 8px',
                            minHeight: '28px',
                            backgroundColor: isSelected
                              ? FUI_TOKENS.bgPanel
                              : FUI_TOKENS.bgCarbon,
                            color: isSelected
                              ? FUI_TOKENS.accentOrange
                              : FUI_TOKENS.inkMuted,
                            border: `1px solid ${
                              isSelected ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline
                            }`,
                            fontFamily: FUI_TOKENS.fontMono,
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            borderRadius: '0px',
                          }}
                        >
                          {isSelected ? '+ON' : '+ADD'}
                        </button>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          fontSize: '12px',
                          color: FUI_TOKENS.inkMuted,
                          borderRadius: '0px',
                        }}
                      >
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontSize: '12px',
                            borderRadius: '0px',
                          }}
                        >
                          {asset.name} · {ASSET_CLASS_LABELS[asset.asset_class] ?? asset.asset_class}
                        </span>
                        <span
                          style={{
                            fontSize: '12px',
                            color: FUI_TOKENS.inkStark,
                            fontVariantNumeric: 'tabular-nums',
                            borderRadius: '0px',
                          }}
                        >
                          <PrivacyValue
                            kind="currency"
                            currency={asset.currency}
                            value={formatAssetMoney(asset.current_price_cents, asset.currency)}
                          />
                        </span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          fontSize: '12px',
                          borderRadius: '0px',
                        }}
                      >
                        <span style={{ color: FUI_TOKENS.inkMuted, fontSize: '12px', borderRadius: '0px' }}>
                          QTY: {asset.quantity} {asset.in_portfolio ? '// HOLDING' : '// WATCHLIST'}
                        </span>
                        <span
                          style={{
                            fontSize: '12px',
                            fontWeight: 700,
                            color: pnlPositive
                              ? FUI_TOKENS.accentPhosphor
                              : FUI_TOKENS.accentVermilion,
                            fontVariantNumeric: 'tabular-nums',
                            borderRadius: '0px',
                          }}
                        >
                          {pnlPositive ? '+' : ''}
                          {holding.unrealizedPnlPct.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </FuiPanel>
        </aside>

        {/* Right Column — Candlestick Graph & Telemetry */}
        <section
          data-testid="stock-cycle-chart-panel"
          aria-label="Stock Cycle Candlestick Graph and Telemetry"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            minWidth: 0,
            borderRadius: '0px',
          }}
        >
          {/* KPI Summary Strip */}
          <div
            data-testid="stock-cycle-kpis"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: '12px',
              borderRadius: '0px',
            }}
          >
            <div
              style={{
                padding: '10px 12px',
                backgroundColor: FUI_TOKENS.bgPanel,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderLeft: `3px solid ${FUI_TOKENS.accentOrange}`,
                borderRadius: '0px',
              }}
            >
              <div style={{ fontSize: '12px', color: FUI_TOKENS.inkMuted, borderRadius: '0px' }}>
                ACTIVE SELECTION
              </div>
              <div
                data-testid="stock-cycle-active-symbol"
                style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  color: FUI_TOKENS.inkStark,
                  marginTop: '4px',
                  borderRadius: '0px',
                }}
              >
                {metrics.symbolLabel}
              </div>
              <div style={{ fontSize: '12px', color: FUI_TOKENS.accentCyan, marginTop: '2px', borderRadius: '0px' }}>
                {metrics.selectedCount === 1
                  ? '1 INDIVIDUAL STOCK'
                  : `${metrics.selectedCount} STOCKS COMBINED`}
              </div>
            </div>

            <div
              style={{
                padding: '10px 12px',
                backgroundColor: FUI_TOKENS.bgPanel,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderLeft: `3px solid ${FUI_TOKENS.accentCyan}`,
                borderRadius: '0px',
              }}
            >
              <div style={{ fontSize: '12px', color: FUI_TOKENS.inkMuted, borderRadius: '0px' }}>
                CYCLE CLOSE / LIVE ({metrics.currency})
              </div>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  color: FUI_TOKENS.inkStark,
                  marginTop: '4px',
                  fontVariantNumeric: 'tabular-nums',
                  borderRadius: '0px',
                }}
              >
                <PrivacyValue
                  kind="currency"
                  currency={metrics.currency}
                  value={formatAssetMoney(metrics.livePriceCents, metrics.currency)}
                />
              </div>
              <div style={{ fontSize: '12px', color: FUI_TOKENS.inkMuted, marginTop: '2px', borderRadius: '0px' }}>
                HIGH:{' '}
                <PrivacyValue
                  kind="currency"
                  currency={metrics.currency}
                  value={formatAssetMoney(metrics.periodHighCents, metrics.currency)}
                />{' '}
                · LOW:{' '}
                <PrivacyValue
                  kind="currency"
                  currency={metrics.currency}
                  value={formatAssetMoney(metrics.periodLowCents, metrics.currency)}
                />
              </div>
            </div>

            <div
              style={{
                padding: '10px 12px',
                backgroundColor: FUI_TOKENS.bgPanel,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderLeft: `3px solid ${
                  metrics.periodChangePct >= 0
                    ? FUI_TOKENS.accentPhosphor
                    : FUI_TOKENS.accentVermilion
                }`,
                borderRadius: '0px',
              }}
            >
              <div style={{ fontSize: '12px', color: FUI_TOKENS.inkMuted, borderRadius: '0px' }}>
                PERIOD DELTA ({candleRange})
              </div>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  color:
                    metrics.periodChangePct >= 0
                      ? FUI_TOKENS.accentPhosphor
                      : FUI_TOKENS.accentVermilion,
                  marginTop: '4px',
                  fontVariantNumeric: 'tabular-nums',
                  borderRadius: '0px',
                }}
              >
                {metrics.periodChangePct >= 0 ? '+' : ''}
                {metrics.periodChangePct.toFixed(2)}%
              </div>
              <div style={{ fontSize: '12px', color: FUI_TOKENS.inkMuted, marginTop: '2px', borderRadius: '0px' }}>
                VOL: {metrics.totalVolume.toLocaleString('en-US')}
              </div>
            </div>

            <div
              style={{
                padding: '10px 12px',
                backgroundColor: FUI_TOKENS.bgPanel,
                border: `1px solid ${FUI_TOKENS.borderHairline}`,
                borderLeft: `3px solid ${FUI_TOKENS.accentAmber}`,
                borderRadius: '0px',
              }}
            >
              <div style={{ fontSize: '12px', color: FUI_TOKENS.inkMuted, borderRadius: '0px' }}>
                CYCLE PHASE &amp; WEIGHTING
              </div>
              <div
                data-testid="stock-cycle-phase-badge"
                style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  color: FUI_TOKENS.accentAmber,
                  marginTop: '4px',
                  borderRadius: '0px',
                }}
              >
                {metrics.cyclePhase}
              </div>
              <div style={{ fontSize: '12px', color: FUI_TOKENS.inkMuted, marginTop: '2px', borderRadius: '0px' }}>
                MODE: {weightingMode}
              </div>
            </div>
          </div>

          {/* Primary Candlestick Chart Panel */}
          <FuiPanel
            headerProps={{
              title: `CANDLESTICK TELEMETRY // ${metrics.symbolLabel}`,
              code: `RANGE_${candleRange}`,
              accent: 'orange',
            }}
          >
            <div
              data-testid="stock-cycle-candlestick-panel"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                borderRadius: '0px',
              }}
            >
              {/* Explicit Timeframe Range Bar */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  borderRadius: '0px',
                }}
              >
                <div style={{ fontSize: '12px', color: FUI_TOKENS.inkMuted, borderRadius: '0px' }}>
                  {metrics.nameLabel}
                </div>
                <div style={{ display: 'flex', gap: '4px', borderRadius: '0px' }}>
                  {CANDLE_RANGES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      data-testid={`stock-cycle-range-${r}`}
                      aria-pressed={candleRange === r}
                      onClick={() => setCandleRange(r)}
                      style={
                        candleRange === r ? ACTIVE_CONTROL_BUTTON_STYLE : CONTROL_BUTTON_STYLE
                      }
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <CandlestickChart
                symbol={metrics.symbolLabel}
                name={metrics.nameLabel}
                candles={chartData}
                range={candleRange}
                onRangeChange={setCandleRange}
                livePrice={metrics.livePriceCents > 0 ? metrics.livePriceCents / 100 : undefined}
                currency={metrics.currency}
                quoteSource={metrics.quoteSource}
                privacyMasked={isMasked}
                height={320}
              />
            </div>
          </FuiPanel>

          {/* Selected Constituents Breakdown Table */}
          <FuiPanel
            headerProps={{
              title: 'SELECTED CYCLE CONSTITUENTS // WEIGHT & VALUATION MATRIX',
              code: `${selectedAssets.length} ACTIVE`,
              accent: 'cyan',
            }}
          >
            <div
              data-testid="stock-cycle-constituents"
              style={{
                overflowX: 'auto',
                borderRadius: '0px',
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  borderRadius: '0px',
                }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
                      color: FUI_TOKENS.inkMuted,
                      textAlign: 'left',
                      borderRadius: '0px',
                    }}
                  >
                    <th style={{ padding: '8px', fontSize: '12px', borderRadius: '0px' }}>TICKER</th>
                    <th style={{ padding: '8px', fontSize: '12px', borderRadius: '0px' }}>NAME</th>
                    <th style={{ padding: '8px', fontSize: '12px', borderRadius: '0px' }}>QTY</th>
                    <th style={{ padding: '8px', fontSize: '12px', borderRadius: '0px' }}>NATIVE PRICE</th>
                    <th style={{ padding: '8px', fontSize: '12px', borderRadius: '0px' }}>
                      VALUE ({baseCurrency})
                    </th>
                    <th style={{ padding: '8px', fontSize: '12px', borderRadius: '0px' }}>CYCLE WEIGHT</th>
                    <th style={{ padding: '8px', fontSize: '12px', borderRadius: '0px' }}>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const quantities = selectedAssets.map((a) =>
                      Math.max(0, safeFiniteNumber(a.quantity, 0)),
                    );
                    const totalQty = quantities.reduce((acc, q) => acc + q, 0);

                    return selectedAssets.map((asset, idx) => {
                      const holding = computeHoldingMetrics(asset, fxUsdBrl);
                      const convertedValueCents = convertCurrencyCents(
                        holding.valueCents,
                        asset.currency,
                        baseCurrency,
                        fxUsdBrl,
                      );
                      const weightPct =
                        weightingMode === 'PORTFOLIO_WEIGHTED' && totalQty > 0
                          ? ((quantities[idx] ?? 0) / totalQty) * 100
                          : 100 / Math.max(1, selectedAssets.length);

                      return (
                        <tr
                          key={asset.id || asset.symbol}
                          data-testid={`stock-cycle-constituent-${asset.symbol}`}
                          style={{
                            borderBottom: `1px solid ${FUI_TOKENS.borderHairline}`,
                            borderRadius: '0px',
                          }}
                        >
                          <td
                            style={{
                              padding: '8px',
                              fontWeight: 700,
                              color: FUI_TOKENS.accentOrange,
                              fontSize: '12px',
                              borderRadius: '0px',
                            }}
                          >
                            {asset.symbol}
                          </td>
                          <td style={{ padding: '8px', fontSize: '12px', borderRadius: '0px' }}>
                            {asset.name}
                          </td>
                          <td
                            style={{
                              padding: '8px',
                              fontVariantNumeric: 'tabular-nums',
                              fontSize: '12px',
                              borderRadius: '0px',
                            }}
                          >
                            {asset.quantity}
                          </td>
                          <td
                            style={{
                              padding: '8px',
                              fontVariantNumeric: 'tabular-nums',
                              fontSize: '12px',
                              borderRadius: '0px',
                            }}
                          >
                            <PrivacyValue
                              kind="currency"
                              currency={asset.currency}
                              value={formatAssetMoney(asset.current_price_cents, asset.currency)}
                            />
                          </td>
                          <td
                            style={{
                              padding: '8px',
                              fontVariantNumeric: 'tabular-nums',
                              fontSize: '12px',
                              borderRadius: '0px',
                            }}
                          >
                            <PrivacyValue
                              kind="currency"
                              currency={baseCurrency}
                              value={formatAssetMoney(convertedValueCents, baseCurrency)}
                            />
                          </td>
                          <td
                            style={{
                              padding: '8px',
                              fontVariantNumeric: 'tabular-nums',
                              color: FUI_TOKENS.accentCyan,
                              fontSize: '12px',
                              borderRadius: '0px',
                            }}
                          >
                            {weightPct.toFixed(1)}%
                          </td>
                          <td style={{ padding: '8px', fontSize: '12px', borderRadius: '0px' }}>
                            <button
                              type="button"
                              data-testid={`stock-cycle-solo-${asset.symbol}`}
                              onClick={() => handleSelectSingleStock(asset.symbol)}
                              style={CONTROL_BUTTON_STYLE}
                            >
                              SOLO VIEW
                            </button>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </FuiPanel>
        </section>
      </div>
    </div>
  );
}

export const StockCyclePage = StockCycleView;
export default StockCycleView;
