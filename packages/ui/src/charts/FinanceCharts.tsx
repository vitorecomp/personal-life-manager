import React, { useId, useMemo, useState } from 'react';
import { formatMaskedCurrency, usePrivacyMask } from '../privacy/PrivacyMask';
import { FuiBadge } from '../primitives/FuiBadge';
import { FUI_TOKENS } from '../tokens';
import {
  clamp,
  computeWaffleAllocation,
  sanitizeFinite,
  type WaffleSliceInput,
} from './math';

// ============================================================================
// 6. <WaffleGrid10x20 /> (REF-07 Exact 200 Square 0px Tiles — Zero Pie Charts!)
// ============================================================================
export interface WaffleGrid10x20Props {
  items: WaffleSliceInput[];
  preserveUnallocated?: boolean;
  currency?: 'BRL' | 'USD';
  totalValueCents?: number;
  privacyMasked?: boolean;
  showTargetDriftWarning?: boolean;
  title?: string;
  className?: string;
  'data-testid'?: string;
}

function formatCents(cents: number, currency: 'BRL' | 'USD' = 'BRL'): string {
  const major = (sanitizeFinite(cents, 0) / 100).toFixed(2);
  return currency === 'USD' ? `$ ${major}` : `R$ ${major}`;
}

export function WaffleGrid10x20({
  items,
  preserveUnallocated = false,
  currency = 'BRL',
  totalValueCents,
  privacyMasked,
  showTargetDriftWarning = true,
  title = 'PORTFOLIO_ALLOCATION // 10X20_WAFFLE',
  className,
  'data-testid': dataTestId,
}: WaffleGrid10x20Props) {
  const ctxPrivacy = usePrivacyMask();
  const isMasked = Boolean(privacyMasked ?? ctxPrivacy.isMasked);

  const result = useMemo(
    () => computeWaffleAllocation(items, { preserveUnallocated }),
    [items, preserveUnallocated],
  );

  return (
    <div
      data-testid={dataTestId ?? 'waffle-grid-10x20'}
      data-fui="waffle-grid-10x20"
      data-tile-count={result.tiles.length}
      data-privacy-masked={isMasked ? 'true' : 'false'}
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '10px',
        backgroundColor: FUI_TOKENS.bgPanel,
        border: `1px solid ${FUI_TOKENS.borderHairline}`,
        color: FUI_TOKENS.inkStark,
        fontFamily: FUI_TOKENS.fontMono,
        fontSize: '12px',
        borderRadius: '0px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '0px' }}>
        <span style={{ color: FUI_TOKENS.inkMuted }}>{title}</span>
        {totalValueCents !== undefined && (
          <span
            data-waffle-part="total-value"
            style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', borderRadius: '0px' }}
          >
            {isMasked ? formatMaskedCurrency(totalValueCents, currency) : formatCents(totalValueCents, currency)}
          </span>
        )}
      </div>

      {/* Exact 10x20 Grid of 200 0px Square Tiles */}
      <div
        data-waffle-part="grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(20, minmax(0, 1fr))',
          gridTemplateRows: 'repeat(10, minmax(0, 1fr))',
          gap: '2px',
          padding: '6px',
          backgroundColor: FUI_TOKENS.bgCarbon,
          border: `1px solid ${FUI_TOKENS.borderHairline}`,
          borderRadius: '0px',
        }}
      >
        {result.tiles.map((tile) => (
          <span
            key={tile.index}
            data-waffle-tile={tile.index}
            data-slice-id={tile.sliceId}
            data-row={tile.row}
            data-col={tile.col}
            style={{
              gridRow: tile.row + 1,
              gridColumn: tile.col + 1,
              display: 'block',
              width: '100%',
              minHeight: '8px',
              aspectRatio: '1 / 1',
              backgroundColor: tile.color,
              borderRadius: '0px',
            }}
          />
        ))}
      </div>

      {showTargetDriftWarning && preserveUnallocated && result.hasWeightDriftWarning && (
        <div
          data-waffle-part="drift-warning"
          style={{
            padding: '4px 8px',
            backgroundColor: FUI_TOKENS.bgCarbon,
            border: `1px solid ${FUI_TOKENS.accentAmber}`,
            color: FUI_TOKENS.accentAmber,
            fontSize: '12px',
            borderRadius: '0px',
          }}
        >
          Sum: {result.weightSumPct.toFixed(1)}% ({result.unallocatedTiles} tiles unallocated)
        </div>
      )}

      {/* Square-Swatch % Legend (percentages always remain visible under Privacy Mode!) */}
      <div
        data-waffle-part="legend"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px',
          borderRadius: '0px',
        }}
      >
        {result.slices.map((s) => (
          <div
            key={s.id}
            data-waffle-legend-item={s.id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              borderRadius: '0px',
            }}
          >
            <span
              style={{
                width: '10px',
                height: '10px',
                backgroundColor: s.color,
                borderRadius: '0px',
                flexShrink: 0,
              }}
            />
            <span>{s.label}</span>
            <span style={{ color: FUI_TOKENS.inkMuted, fontVariantNumeric: 'tabular-nums' }}>
              {s.normalizedPct.toFixed(1)}%
            </span>
            {s.valueCents !== undefined && (
              <span data-waffle-slice-value={s.id} style={{ fontVariantNumeric: 'tabular-nums' }}>
                ({isMasked ? formatMaskedCurrency(s.valueCents, currency) : formatCents(s.valueCents, currency)})
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// 7. <HatchedDonutGauge /> (REF-07 Annular Solid + 45° ///// Hatched FI Ring)
// ============================================================================
export interface DonutLegendItem {
  label: string;
  pct: number;
  variant: 'solid' | 'hatched' | 'track' | 'muted';
  amountCents?: number;
}

export interface HatchedDonutGaugeProps {
  solidPct: number;
  hatchedPct?: number;
  centerLabel?: string;
  centerSubLabel?: string;
  durationLabel?: string;
  legendItems?: DonutLegendItem[];
  currency?: 'BRL' | 'USD';
  privacyMasked?: boolean;
  size?: number;
  strokeWidth?: number;
  className?: string;
  'data-testid'?: string;
}

export function HatchedDonutGauge({
  solidPct,
  hatchedPct = 0,
  centerLabel,
  centerSubLabel = 'FI PROGRESS',
  durationLabel,
  legendItems,
  currency = 'BRL',
  privacyMasked,
  size = 168,
  strokeWidth = 16,
  className,
  'data-testid': dataTestId,
}: HatchedDonutGaugeProps) {
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const hatchPatternId = `fui-donut-hatch-${rawId}`;
  const hatchedMaskId = `fui-donut-mask-${rawId}`;

  const ctxPrivacy = usePrivacyMask();
  const isMasked = Boolean(privacyMasked ?? ctxPrivacy.isMasked);

  const clampedSolid = clamp(solidPct, 0, 100, 0);
  const clampedHatched = clamp(hatchedPct, 0, 100 - clampedSolid, 0);
  const resolvedCenter = centerLabel ?? `${Math.round(clampedSolid)}%`;

  const cx = 84;
  const cy = 84;
  const r = 64;
  const sw = clamp(strokeWidth, 6, 32, 16);
  const circumference = Number((2 * Math.PI * r).toFixed(2));
  const solidLen = Number(((clampedSolid / 100) * circumference).toFixed(2));
  const totalCombinedLen = Number((((clampedSolid + clampedHatched) / 100) * circumference).toFixed(2));

  return (
    <div
      data-testid={dataTestId ?? 'hatched-donut-gauge'}
      data-fui="hatched-donut-gauge"
      data-solid-pct={clampedSolid}
      data-hatched-pct={clampedHatched}
      data-privacy-masked={isMasked ? 'true' : 'false'}
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        padding: '10px',
        backgroundColor: FUI_TOKENS.bgPanel,
        border: `1px solid ${FUI_TOKENS.borderHairline}`,
        color: FUI_TOKENS.inkStark,
        fontFamily: FUI_TOKENS.fontMono,
        fontSize: '12px',
        borderRadius: '0px',
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 168 168"
        role="img"
        aria-label={`${centerSubLabel} ${resolvedCenter}`}
        style={{ display: 'block', borderRadius: '0px' }}
      >
        <defs>
          <pattern
            id={hatchPatternId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="2" height="6" fill={FUI_TOKENS.inkStark} />
          </pattern>
          <mask id={hatchedMaskId}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={sw}
              strokeDasharray={`${totalCombinedLen} ${circumference}`}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          </mask>
        </defs>

        {/* Remaining Track Ring */}
        <circle
          data-donut-part="track"
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={FUI_TOKENS.borderHairline}
          strokeWidth={sw}
        />

        {/* 45° ///// Diagonal-Hatched Arc */}
        {clampedHatched > 0 && (
          <rect
            data-donut-part="hatched-arc"
            x="0"
            y="0"
            width="168"
            height="168"
            fill={`url(#${hatchPatternId})`}
            mask={`url(#${hatchedMaskId})`}
          />
        )}

        {/* Primary Solid #F6F6F4 Arc */}
        {clampedSolid > 0 && (
          <circle
            data-donut-part="solid-arc"
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={FUI_TOKENS.inkStark}
            strokeWidth={sw}
            strokeDasharray={`${solidLen} ${circumference}`}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )}

        {/* Centered % & Duration (Always preserved visible under Privacy Mask!) */}
        <text
          data-donut-part="center-label"
          x={cx}
          y={durationLabel ? cy - 6 : cy + 4}
          textAnchor="middle"
          fill={FUI_TOKENS.inkStark}
          fontFamily={FUI_TOKENS.fontDisplay}
          fontSize="30"
          fontWeight="700"
        >
          {resolvedCenter}
        </text>
        <text
          data-donut-part="center-sublabel"
          x={cx}
          y={durationLabel ? cy + 12 : cy + 22}
          textAnchor="middle"
          fill={FUI_TOKENS.inkMuted}
          fontFamily={FUI_TOKENS.fontMono}
          fontSize="9.5"
        >
          {centerSubLabel}
        </text>
        {durationLabel && (
          <text
            data-donut-part="duration-label"
            x={cx}
            y={cy + 27}
            textAnchor="middle"
            fill={FUI_TOKENS.accentOrange}
            fontFamily={FUI_TOKENS.fontMono}
            fontSize="11"
            fontWeight="700"
          >
            {durationLabel}
          </text>
        )}
      </svg>

      {legendItems && legendItems.length > 0 && (
        <div
          data-donut-part="legend"
          style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', borderRadius: '0px' }}
        >
          {legendItems.map((item, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '12px',
                borderRadius: '0px',
              }}
            >
              <span>
                {item.label} ({sanitizeFinite(item.pct, 0).toFixed(1)}%)
              </span>
              {item.amountCents !== undefined && (
                <span data-donut-legend-amount={idx} style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {isMasked ? formatMaskedCurrency(item.amountCents, currency) : formatCents(item.amountCents, currency)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 8. <PairedHatchBarChart /> (REF-07 Planned ///// vs Actual Solid Bars)
// ============================================================================
export type MonthlyBarRange = '3M' | '6M' | '1Y' | 'ALL';

export interface PairedMonthDatum {
  month: string;
  label?: string;
  planned: number;
  actual: number | null;
  income?: number;
}

export interface PairedHatchBarChartProps {
  data: PairedMonthDatum[];
  range?: MonthlyBarRange;
  onRangeChange?: (range: MonthlyBarRange) => void;
  mode?: 'spend' | 'investment';
  currency?: 'BRL' | 'USD';
  isCurrency?: boolean;
  privacyMasked?: boolean;
  title?: string;
  height?: number;
  className?: string;
  'data-testid'?: string;
}

const MONTHLY_RANGES: readonly MonthlyBarRange[] = ['3M', '6M', '1Y', 'ALL'];

export function PairedHatchBarChart({
  data,
  range: controlledRange,
  onRangeChange,
  mode = 'spend',
  currency = 'BRL',
  isCurrency = true,
  privacyMasked,
  title = 'MONTHLY_CASHFLOW // PLANNED_VS_ACTUAL',
  height = 200,
  className,
  'data-testid': dataTestId,
}: PairedHatchBarChartProps) {
  const rawId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const hatchPatternId = `fui-bar-hatch-${rawId}`;

  const [internalRange, setInternalRange] = useState<MonthlyBarRange>('6M');
  const activeRange = controlledRange ?? internalRange;

  const ctxPrivacy = usePrivacyMask();
  const isMasked = Boolean((privacyMasked ?? ctxPrivacy.isMasked) && isCurrency);

  const visibleData = useMemo(() => {
    const safe = Array.isArray(data) ? data : [];
    const limit =
      activeRange === '3M' ? 3 : activeRange === '6M' ? 6 : activeRange === '1Y' ? 12 : safe.length;
    return safe.slice(-limit);
  }, [data, activeRange]);

  const maxVal = useMemo(() => {
    let m = 0;
    for (const d of visibleData) {
      m = Math.max(m, sanitizeFinite(d.planned, 0), sanitizeFinite(d.actual, 0));
    }
    return m > 0 ? m : 1;
  }, [visibleData]);

  const latestSavingsRatePct = useMemo(() => {
    const last = visibleData[visibleData.length - 1];
    if (!last || last.income === undefined || last.income <= 0) return null;
    const spend = last.actual !== null ? sanitizeFinite(last.actual, 0) : sanitizeFinite(last.planned, 0);
    return Number((((last.income - spend) / last.income) * 100).toFixed(1));
  }, [visibleData]);

  const svgW = 360;
  const svgH = Math.max(120, sanitizeFinite(height, 200));
  const padL = 44;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  const formatTick = (val: number): string => {
    if (isMasked) return '••••';
    return `${currency === 'USD' ? '$' : 'R$'}${Math.round(val)}`;
  };

  return (
    <div
      data-testid={dataTestId ?? 'paired-hatch-bar-chart'}
      data-fui="paired-hatch-bar-chart"
      data-range={activeRange}
      data-privacy-masked={isMasked ? 'true' : 'false'}
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '10px',
        backgroundColor: FUI_TOKENS.bgPanel,
        border: `1px solid ${FUI_TOKENS.borderHairline}`,
        color: FUI_TOKENS.inkStark,
        fontFamily: FUI_TOKENS.fontMono,
        fontSize: '12px',
        borderRadius: '0px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
          borderRadius: '0px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '0px' }}>
          <span style={{ color: FUI_TOKENS.inkMuted }}>{title}</span>
          {latestSavingsRatePct !== null && (
            <span
              data-bar-part="savings-rate"
              style={{ color: FUI_TOKENS.accentPhosphor, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
            >
              SAVINGS: {latestSavingsRatePct}%
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '2px', borderRadius: '0px' }}>
          {MONTHLY_RANGES.map((r) => {
            const active = r === activeRange;
            return (
              <button
                key={r}
                type="button"
                data-range-tab={r}
                data-active={active ? 'true' : 'false'}
                onClick={() => {
                  setInternalRange(r);
                  onRangeChange?.(r);
                }}
                style={{
                  padding: '2px 8px',
                  minHeight: '26px',
                  backgroundColor: active ? FUI_TOKENS.accentOrange : FUI_TOKENS.bgCarbon,
                  color: active ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkMuted,
                  border: `1px solid ${active ? FUI_TOKENS.accentOrange : FUI_TOKENS.borderHairline}`,
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  borderRadius: '0px',
                }}
              >
                {r}
              </button>
            );
          })}
        </div>
      </div>

      <svg
        width="100%"
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        role="img"
        aria-label={title}
        style={{ display: 'block', borderRadius: '0px' }}
      >
        <defs>
          <pattern
            id={hatchPatternId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="2" height="6" fill="#9CA3AF" />
          </pattern>
        </defs>

        {/* Y-Axis Gridlines & Labels */}
        {[0, 0.5, 1].map((frac, idx) => {
          const y = Number((padT + plotH * (1 - frac)).toFixed(2));
          const tickVal = maxVal * frac;
          return (
            <g key={idx}>
              <line x1={padL} y1={y} x2={padL + plotW} y2={y} stroke={FUI_TOKENS.borderHairline} strokeWidth="1" />
              <text
                data-bar-y-tick={idx}
                x={padL - 4}
                y={y + 3}
                textAnchor="end"
                fill={FUI_TOKENS.inkMuted}
                fontFamily={FUI_TOKENS.fontMono}
                fontSize="9"
              >
                {formatTick(tickVal)}
              </text>
            </g>
          );
        })}

        {/* Paired Monthly Bars */}
        {visibleData.map((d, idx) => {
          const groupW = plotW / Math.max(1, visibleData.length);
          const groupX = padL + idx * groupW;
          const barW = Math.max(4, Math.min(18, (groupW - 10) / 2));
          const leftX = Number((groupX + groupW / 2 - barW - 1.5).toFixed(2));
          const rightX = Number((groupX + groupW / 2 + 1.5).toFixed(2));

          const plannedVal = Math.max(0, sanitizeFinite(d.planned, 0));
          const plannedH = Number(((plannedVal / maxVal) * plotH).toFixed(2));
          const plannedY = Number((padT + plotH - plannedH).toFixed(2));

          const hasActual = d.actual !== null && d.actual !== undefined && Number.isFinite(d.actual);
          const actualVal = hasActual ? Math.max(0, sanitizeFinite(d.actual, 0)) : 0;
          const actualH = hasActual ? Number(((actualVal / maxVal) * plotH).toFixed(2)) : 4;
          const actualY = Number((padT + plotH - actualH).toFixed(2));
          const isOverspend = mode === 'spend' && hasActual && actualVal > plannedVal;

          return (
            <g key={d.month || idx} data-bar-group={d.month}>
              {/* Left Planned 45° ///// Hatched Bar */}
              <rect
                data-bar-planned={d.month}
                x={leftX}
                y={plannedY}
                width={barW}
                height={plannedH}
                fill={`url(#${hatchPatternId})`}
                stroke="#525866"
                strokeWidth="1"
              />

              {/* Right Actual #F6F6F4 Solid Bar (or Dashed Placeholder when null) */}
              {hasActual ? (
                <>
                  <rect
                    data-bar-actual={d.month}
                    x={rightX}
                    y={actualY}
                    width={barW}
                    height={actualH}
                    fill={FUI_TOKENS.inkStark}
                  />
                  {isOverspend && (
                    <rect
                      data-bar-overspend={d.month}
                      x={rightX}
                      y={actualY}
                      width={barW}
                      height="3"
                      fill={FUI_TOKENS.accentVermilion}
                    />
                  )}
                </>
              ) : (
                <rect
                  data-bar-actual-placeholder={d.month}
                  x={rightX}
                  y={padT + plotH - 4}
                  width={barW}
                  height="4"
                  fill="none"
                  stroke={FUI_TOKENS.borderHairline}
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
              )}

              <text
                x={Number((groupX + groupW / 2).toFixed(2))}
                y={svgH - 8}
                textAnchor="middle"
                fill={FUI_TOKENS.inkMuted}
                fontFamily={FUI_TOKENS.fontMono}
                fontSize="9.5"
              >
                {d.label ?? d.month}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ============================================================================
// 9. <CandlestickChart /> (REF-07 Hollow Bullish vs Solid Bearish OHLC Terminal)
// ============================================================================
export type CandleRange = '1D' | '7D' | '1M' | '1Y' | 'ALL';

export interface CandleDatum {
  timestamp: string | number;
  label?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface CandlestickChartProps {
  symbol: string;
  name?: string;
  candles: CandleDatum[];
  range?: CandleRange;
  onRangeChange?: (range: CandleRange) => void;
  livePrice?: number;
  currency?: 'BRL' | 'USD';
  quoteSource?: 'live' | 'cached';
  alertLow?: number | null;
  alertHigh?: number | null;
  privacyMasked?: boolean;
  maskPricesOnPrivacy?: boolean;
  height?: number;
  className?: string;
  'data-testid'?: string;
}

const CANDLE_RANGES: readonly CandleRange[] = ['1D', '7D', '1M', '1Y', 'ALL'];

export function CandlestickChart({
  symbol,
  name,
  candles,
  range: controlledRange,
  onRangeChange,
  livePrice,
  currency = 'BRL',
  quoteSource = 'live',
  privacyMasked,
  maskPricesOnPrivacy = true,
  height = 240,
  className,
  'data-testid': dataTestId,
}: CandlestickChartProps) {
  const [internalRange, setInternalRange] = useState<CandleRange>('1M');
  const activeRange = controlledRange ?? internalRange;

  const ctxPrivacy = usePrivacyMask();
  const isMasked = Boolean((privacyMasked ?? ctxPrivacy.isMasked) && maskPricesOnPrivacy);

  const sanitizedCandles = useMemo(() => {
    if (!Array.isArray(candles)) return [];
    return candles
      .filter(
        (c) =>
          c &&
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close),
      )
      .map((c) => {
        const hi = Math.max(c.high, c.open, c.close);
        const lo = Math.min(c.low, c.open, c.close);
        return {
          ...c,
          high: hi,
          low: lo,
        };
      });
  }, [candles]);

  const { domainMin, domainMax, peakIdx, resolvedLivePrice, deltaPct } = useMemo(() => {
    if (sanitizedCandles.length === 0) {
      return {
        domainMin: 0,
        domainMax: 100,
        peakIdx: -1,
        resolvedLivePrice: sanitizeFinite(livePrice, 0),
        deltaPct: 0,
      };
    }
    let minLo = Infinity;
    let maxHi = -Infinity;
    let pIdx = 0;
    sanitizedCandles.forEach((c, idx) => {
      if (c.low < minLo) minLo = c.low;
      if (c.high > maxHi) {
        maxHi = c.high;
        pIdx = idx;
      }
    });
    const lastClose = sanitizedCandles[sanitizedCandles.length - 1]!.close;
    const firstOpen = sanitizedCandles[0]!.open || 1;
    const live = livePrice !== undefined && Number.isFinite(livePrice) ? livePrice : lastClose;
    minLo = Math.min(minLo, live);
    maxHi = Math.max(maxHi, live);
    const rawSpan = maxHi - minLo;
    const span = rawSpan > 0 ? rawSpan : Math.max(1, Math.abs(maxHi) * 0.05);
    const pad = span * 0.08;
    const pct = Number((((live - firstOpen) / Math.abs(firstOpen)) * 100).toFixed(2));
    return {
      domainMin: minLo - pad,
      domainMax: maxHi + pad,
      peakIdx: pIdx,
      resolvedLivePrice: live,
      deltaPct: pct,
    };
  }, [sanitizedCandles, livePrice]);

  const svgW = 380;
  const svgH = Math.max(140, sanitizeFinite(height, 240));
  const padL = 12;
  const padR = 64;
  const padT = 22;
  const padB = 22;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;
  const domainSpan = domainMax - domainMin || 1;

  const yOf = (price: number): number =>
    Number((padT + plotH - ((price - domainMin) / domainSpan) * plotH).toFixed(2));

  const formatPrice = (price: number): string => {
    if (isMasked) return '••••••';
    return price.toFixed(2);
  };

  const liveY = yOf(resolvedLivePrice);

  return (
    <div
      data-testid={dataTestId ?? 'candlestick-chart'}
      data-fui="candlestick-chart"
      data-symbol={symbol}
      data-range={activeRange}
      data-privacy-masked={isMasked ? 'true' : 'false'}
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '10px',
        backgroundColor: FUI_TOKENS.bgCarbon,
        border: `1px solid ${FUI_TOKENS.borderHairline}`,
        color: FUI_TOKENS.inkStark,
        fontFamily: FUI_TOKENS.fontMono,
        fontSize: '12px',
        borderRadius: '0px',
      }}
    >
      {/* Header Bar: Symbol, % Delta (always visible!), Quote Source & Range Selector */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
          borderRadius: '0px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '0px' }}>
          <strong style={{ fontSize: '13px', color: FUI_TOKENS.inkStark }}>{symbol}</strong>
          {name && <span style={{ color: FUI_TOKENS.inkMuted }}>{name}</span>}
          <span
            data-candle-part="delta-pct"
            style={{
              color: deltaPct >= 0 ? FUI_TOKENS.accentPhosphor : FUI_TOKENS.accentVermilion,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {deltaPct >= 0 ? `+${deltaPct}%` : `${deltaPct}%`}
          </span>
          {quoteSource === 'cached' && <FuiBadge tone="amber">CACHED</FuiBadge>}
        </div>

        <div style={{ display: 'flex', gap: '2px', borderRadius: '0px' }}>
          {CANDLE_RANGES.map((r) => {
            const active = r === activeRange;
            return (
              <button
                key={r}
                type="button"
                data-candle-range={r}
                data-active={active ? 'true' : 'false'}
                onClick={() => {
                  setInternalRange(r);
                  onRangeChange?.(r);
                }}
                style={{
                  padding: '2px 8px',
                  minHeight: '26px',
                  backgroundColor: active ? FUI_TOKENS.inkStark : FUI_TOKENS.bgPanel,
                  color: active ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkMuted,
                  border: `1px solid ${active ? FUI_TOKENS.inkStark : FUI_TOKENS.borderHairline}`,
                  fontFamily: FUI_TOKENS.fontMono,
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  borderRadius: '0px',
                }}
              >
                {r}
              </button>
            );
          })}
        </div>
      </div>

      {sanitizedCandles.length === 0 ? (
        <div
          data-candle-part="empty-state"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: `${svgH}px`,
            border: `1px dashed ${FUI_TOKENS.borderHairline}`,
            color: FUI_TOKENS.inkMuted,
            borderRadius: '0px',
          }}
        >
          [NO_CANDLE_DATA // {symbol}]
        </div>
      ) : (
        <svg
          width="100%"
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          role="img"
          aria-label={`${symbol} Candlestick Chart`}
          style={{ display: 'block', borderRadius: '0px' }}
        >
          {/* Right Price Axis Ticks */}
          {[0, 0.5, 1].map((frac, idx) => {
            const p = domainMin + domainSpan * frac;
            const y = yOf(p);
            return (
              <g key={idx}>
                <line x1={padL} y1={y} x2={padL + plotW} y2={y} stroke="#191B22" strokeWidth="1" />
                <text
                  data-candle-axis-tick={idx}
                  x={padL + plotW + 6}
                  y={y + 3}
                  fill={FUI_TOKENS.inkMuted}
                  fontFamily={FUI_TOKENS.fontMono}
                  fontSize="9"
                >
                  {formatPrice(p)}
                </text>
              </g>
            );
          })}

          {/* OHLC Candles: Hollow Bullish (close >= open) vs Solid Bearish (close < open) */}
          {sanitizedCandles.map((c, idx) => {
            const slotW = plotW / sanitizedCandles.length;
            const cx = Number((padL + (idx + 0.5) * slotW).toFixed(2));
            const bodyW = Number(Math.max(3, Math.min(12, slotW * 0.62)).toFixed(2));
            const bodyX = Number((cx - bodyW / 2).toFixed(2));

            const yHi = yOf(c.high);
            const yLo = yOf(c.low);
            const yOpen = yOf(c.open);
            const yClose = yOf(c.close);

            const isBullish = c.close >= c.open;
            const bodyTop = Number(Math.min(yOpen, yClose).toFixed(2));
            const bodyH = Number(Math.max(1.5, Math.abs(yClose - yOpen)).toFixed(2));

            return (
              <g
                key={idx}
                data-candle={idx}
                data-candle-polarity={isBullish ? 'bullish' : 'bearish'}
              >
                <line
                  data-candle-wick={idx}
                  x1={cx}
                  y1={yHi}
                  x2={cx}
                  y2={yLo}
                  stroke={FUI_TOKENS.inkStark}
                  strokeWidth="1"
                />
                <rect
                  data-candle-body={idx}
                  x={bodyX}
                  y={bodyTop}
                  width={bodyW}
                  height={bodyH}
                  fill={isBullish ? FUI_TOKENS.bgCarbon : FUI_TOKENS.inkStark}
                  stroke={FUI_TOKENS.inkStark}
                  strokeWidth="1.25"
                />
              </g>
            );
          })}

          {/* 90° Peak High Orthogonal Leader Callout */}
          {peakIdx >= 0 && sanitizedCandles[peakIdx] && (
            <g data-candle-part="peak-callout">
              {(() => {
                const peak = sanitizedCandles[peakIdx]!;
                const slotW = plotW / sanitizedCandles.length;
                const px = Number((padL + (peakIdx + 0.5) * slotW).toFixed(2));
                const py = yOf(peak.high);
                const labelX = Number(Math.max(padL + 42, px - 28).toFixed(2));
                const labelY = Number(Math.max(12, py - 8).toFixed(2));
                return (
                  <>
                    <polyline
                      points={`${px},${py} ${px},${labelY} ${labelX},${labelY}`}
                      fill="none"
                      stroke={FUI_TOKENS.inkMuted}
                      strokeWidth="1"
                    />
                    <text
                      data-candle-peak-price="true"
                      x={labelX - 3}
                      y={labelY + 3}
                      textAnchor="end"
                      fill={FUI_TOKENS.inkStark}
                      fontFamily={FUI_TOKENS.fontMono}
                      fontSize="9.5"
                    >
                      {formatPrice(peak.high)}
                    </text>
                  </>
                );
              })()}
            </g>
          )}

          {/* Horizontal Dotted Live Price Line + Inverted #F6F6F4 Right-Axis Price Badge */}
          <g data-candle-part="live-price-line">
            <line
              x1={padL}
              y1={liveY}
              x2={padL + plotW}
              y2={liveY}
              stroke={FUI_TOKENS.inkMuted}
              strokeWidth="1"
              strokeDasharray="2 2"
            />
            <rect
              data-candle-part="live-price-badge"
              x={padL + plotW + 2}
              y={Number((liveY - 8).toFixed(2))}
              width={padR - 4}
              height="16"
              fill={FUI_TOKENS.inkStark}
            />
            <text
              data-candle-live-price="true"
              x={padL + plotW + padR / 2}
              y={Number((liveY + 3.5).toFixed(2))}
              textAnchor="middle"
              fill={FUI_TOKENS.bgCarbon}
              fontFamily={FUI_TOKENS.fontMono}
              fontSize="9.5"
              fontWeight="700"
            >
              {formatPrice(resolvedLivePrice)}
            </text>
          </g>
        </svg>
      )}
    </div>
  );
}
