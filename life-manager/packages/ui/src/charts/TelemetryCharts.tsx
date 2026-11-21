import React, { useMemo } from 'react';
import { formatMaskedCurrency, usePrivacyMask } from '../privacy/PrivacyMask';
import { FuiCalloutTag } from '../primitives/FuiBadge';
import { FUI_TOKENS } from '../tokens';
import { clamp, sanitizeFinite } from './math';

// ============================================================================
// 1. <LifeRadarReticle /> (REF-01 5-Pillar Dotted Radar + Composite 0..100)
// ============================================================================
export type LifePillarKey = 'focus' | 'routines' | 'goals' | 'learning' | 'wealth_fi';

export interface LifePillarDatum {
  key: LifePillarKey;
  label?: string;
  score: number;
  weight?: number;
}

export interface LifeRadarReticleProps {
  pillars?: LifePillarDatum[] | Partial<Record<LifePillarKey, number>>;
  compositeScore?: number;
  calloutTag?: string;
  size?: number;
  className?: string;
  'data-testid'?: string;
}

const PILLAR_ORDER: ReadonlyArray<{ key: LifePillarKey; label: string }> = [
  { key: 'focus', label: 'FOCUS' },
  { key: 'routines', label: 'ROUTINES' },
  { key: 'goals', label: 'GOALS' },
  { key: 'learning', label: 'LEARNING' },
  { key: 'wealth_fi', label: 'WEALTH_FI' },
];

export function LifeRadarReticle({
  pillars,
  compositeScore,
  calloutTag = 'LIFE_TELEMETRY_INDEX',
  size = 240,
  className,
  'data-testid': dataTestId,
}: LifeRadarReticleProps) {
  const normalizedPillars = useMemo(() => {
    const map = new Map<LifePillarKey, { score: number; label: string; weight: number }>();
    for (const p of PILLAR_ORDER) {
      map.set(p.key, { score: 50, label: p.label, weight: 0.2 });
    }
    if (Array.isArray(pillars)) {
      for (const item of pillars) {
        if (item && map.has(item.key)) {
          const prev = map.get(item.key)!;
          map.set(item.key, {
            score: clamp(item.score, 0, 100, 50),
            label: item.label || prev.label,
            weight: sanitizeFinite(item.weight, 0.2),
          });
        }
      }
    } else if (pillars && typeof pillars === 'object') {
      for (const p of PILLAR_ORDER) {
        const raw = pillars[p.key];
        if (raw !== undefined) {
          map.set(p.key, {
            score: clamp(raw, 0, 100, 50),
            label: p.label,
            weight: 0.2,
          });
        }
      }
    }
    return PILLAR_ORDER.map((p) => ({
      key: p.key,
      ...map.get(p.key)!,
    }));
  }, [pillars]);

  const resolvedComposite = useMemo(() => {
    if (compositeScore !== undefined && Number.isFinite(compositeScore)) {
      return Math.round(clamp(compositeScore, 0, 100, 50));
    }
    const weightSum = normalizedPillars.reduce((acc, p) => acc + (p.weight > 0 ? p.weight : 0.2), 0) || 1;
    const weighted = normalizedPillars.reduce(
      (acc, p) => acc + p.score * (p.weight > 0 ? p.weight : 0.2),
      0,
    );
    return Math.round(clamp(weighted / weightSum, 0, 100, 50));
  }, [compositeScore, normalizedPillars]);

  const cx = 120;
  const cy = 124;
  const maxR = 76;

  const polygonPoints = normalizedPillars
    .map((p, idx) => {
      const theta = -Math.PI / 2 + (idx * 2 * Math.PI) / 5;
      const r = (p.score / 100) * maxR;
      const x = Number((cx + r * Math.cos(theta)).toFixed(2));
      const y = Number((cy + r * Math.sin(theta)).toFixed(2));
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div
      data-testid={dataTestId ?? 'life-radar-reticle'}
      data-fui="life-radar-reticle"
      data-composite-score={resolvedComposite}
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '10px',
        backgroundColor: FUI_TOKENS.bgPlum,
        border: `1px solid ${FUI_TOKENS.borderPlum}`,
        color: FUI_TOKENS.inkStark,
        borderRadius: '0px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '0px' }}>
        <FuiCalloutTag banner={calloutTag} coordinate="5_PILLAR // RADAR" />
        <div
          data-radar-part="composite-score"
          className="fui-display"
          style={{
            fontFamily: FUI_TOKENS.fontDisplay,
            fontSize: '32px',
            fontWeight: 700,
            lineHeight: 1,
            color: FUI_TOKENS.inkStark,
            fontVariantNumeric: 'tabular-nums',
            borderRadius: '0px',
          }}
        >
          {resolvedComposite}
        </div>
      </div>

      <svg
        width={size}
        height={size}
        viewBox="0 0 240 240"
        role="img"
        aria-label={`Life Telemetry Radar Score ${resolvedComposite}`}
        style={{ alignSelf: 'center', display: 'block', borderRadius: '0px' }}
      >
        {/* Background 4x4 Plum Coordinate Grid + Crosshairs */}
        {[60, 120, 180].map((pos) => (
          <g key={pos}>
            <line x1={pos} y1="0" x2={pos} y2="240" stroke={FUI_TOKENS.borderPlum} strokeWidth="1" />
            <line x1="0" y1={pos} x2="240" y2={pos} stroke={FUI_TOKENS.borderPlum} strokeWidth="1" />
          </g>
        ))}

        {/* Concentric Dotted Reticle Rings (33%, 66%, 100%) */}
        <circle
          cx={cx}
          cy={cy}
          r={maxR}
          fill="none"
          stroke={FUI_TOKENS.inkStark}
          strokeWidth="1"
          strokeDasharray="2 4"
          opacity="0.65"
        />
        <circle
          cx={cx}
          cy={cy}
          r={Number((maxR * 0.66).toFixed(2))}
          fill="none"
          stroke={FUI_TOKENS.inkMuted}
          strokeWidth="1"
          strokeDasharray="2 4"
          opacity="0.45"
        />
        <circle
          cx={cx}
          cy={cy}
          r={Number((maxR * 0.33).toFixed(2))}
          fill="none"
          stroke={FUI_TOKENS.inkMuted}
          strokeWidth="1"
          strokeDasharray="2 4"
          opacity="0.45"
        />

        {/* Central Hollow Bullseye */}
        <circle
          data-radar-part="bullseye"
          cx={cx}
          cy={cy}
          r="7"
          fill="none"
          stroke={FUI_TOKENS.inkMuted}
          strokeWidth="1.25"
        />

        {/* 5 Radial Spokes & Labels */}
        {normalizedPillars.map((p, idx) => {
          const theta = -Math.PI / 2 + (idx * 2 * Math.PI) / 5;
          const x1 = Number((cx + 7 * Math.cos(theta)).toFixed(2));
          const y1 = Number((cy + 7 * Math.sin(theta)).toFixed(2));
          const x2 = Number((cx + maxR * Math.cos(theta)).toFixed(2));
          const y2 = Number((cy + maxR * Math.sin(theta)).toFixed(2));
          const lx = Number((cx + (maxR + 18) * Math.cos(theta)).toFixed(2));
          const ly = Number((cy + (maxR + 14) * Math.sin(theta)).toFixed(2));
          return (
            <g key={p.key} data-radar-spoke={p.key}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={FUI_TOKENS.borderPlum} strokeWidth="1" />
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={FUI_TOKENS.inkMuted}
                fontFamily={FUI_TOKENS.fontMono}
                fontSize="8.5"
              >
                {p.label}
              </text>
            </g>
          );
        })}

        {/* 5-Pillar Polygon + Square Vertex Nodes */}
        <polygon
          data-radar-part="polygon"
          points={polygonPoints}
          fill="rgba(248, 124, 24, 0.20)"
          stroke={FUI_TOKENS.accentOrange}
          strokeWidth="1.5"
        />
        {normalizedPillars.map((p, idx) => {
          const theta = -Math.PI / 2 + (idx * 2 * Math.PI) / 5;
          const r = (p.score / 100) * maxR;
          const vx = Number((cx + r * Math.cos(theta) - 2).toFixed(2));
          const vy = Number((cy + r * Math.sin(theta) - 2).toFixed(2));
          return (
            <rect
              key={p.key}
              data-radar-vertex={p.key}
              data-score={p.score}
              x={vx}
              y={vy}
              width="4"
              height="4"
              fill={FUI_TOKENS.accentCyan}
            />
          );
        })}
      </svg>
    </div>
  );
}

// ============================================================================
// 2. <FocusBarcode24h /> (REF-06 Dual-Row 24h Variable-Width Barcode)
// ============================================================================
export interface FocusSessionInterval {
  startMinute: number;
  endMinute: number;
  intensity?: number;
  category?: 'deep_work' | 'learning' | 'pomodoro' | 'planned' | 'other';
}

export interface FocusBarcode24hProps {
  sessions?: FocusSessionInterval[];
  slotValues?: number[];
  plannedSessions?: FocusSessionInterval[];
  plannedSlotValues?: number[];
  slotCount?: 24 | 48 | 96;
  currentMinute?: number;
  title?: string;
  totalMinutesLabel?: string;
  className?: string;
  'data-testid'?: string;
}

function binIntervalsToSlots(
  sessions: FocusSessionInterval[] | undefined,
  slotValues: number[] | undefined,
  slotCount: number,
): number[] {
  const bins = new Array<number>(slotCount).fill(0);
  if (Array.isArray(slotValues) && slotValues.length > 0) {
    for (let i = 0; i < slotCount; i++) {
      bins[i] = clamp(slotValues[i], 0, 1, 0);
    }
    return bins;
  }
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return bins;
  }
  const minsPerSlot = 1440 / slotCount;
  for (const s of sessions) {
    const rawA = sanitizeFinite(s.startMinute, -1);
    const rawB = sanitizeFinite(s.endMinute, -1);
    if (rawA < 0 && rawB < 0) continue;
    const start = clamp(Math.min(rawA, rawB), 0, 1440, 0);
    const end = clamp(Math.max(rawA, rawB), 0, 1440, 0);
    if (end <= start) continue;
    const intensity = clamp(s.intensity ?? 1, 0, 1, 1);
    for (let i = 0; i < slotCount; i++) {
      const slotStart = i * minsPerSlot;
      const slotEnd = slotStart + minsPerSlot;
      const overlap = Math.max(0, Math.min(end, slotEnd) - Math.max(start, slotStart));
      if (overlap > 0) {
        const ratio = (overlap / minsPerSlot) * intensity;
        bins[i] = clamp((bins[i] ?? 0) + ratio, 0, 1, 0);
      }
    }
  }
  return bins;
}

export function FocusBarcode24h({
  sessions,
  slotValues,
  plannedSessions,
  plannedSlotValues,
  slotCount = 48,
  currentMinute,
  title = 'FOCUS_BARCODE_24H',
  totalMinutesLabel,
  className,
  'data-testid': dataTestId,
}: FocusBarcode24hProps) {
  const safeSlots = slotCount === 24 || slotCount === 48 || slotCount === 96 ? slotCount : 48;
  const actualBins = useMemo(
    () => binIntervalsToSlots(sessions, slotValues, safeSlots),
    [sessions, slotValues, safeSlots],
  );
  const plannedBins = useMemo(() => {
    if (
      (plannedSessions && plannedSessions.length > 0) ||
      (plannedSlotValues && plannedSlotValues.length > 0)
    ) {
      return binIntervalsToSlots(plannedSessions, plannedSlotValues, safeSlots);
    }
    // Deterministic rhythmic baseline ticks matching REF-06 lower band
    return actualBins.map((v, idx) => (v > 0 ? 0.8 : idx % 4 === 0 ? 0.35 : 0));
  }, [plannedSessions, plannedSlotValues, actualBins, safeSlots]);

  const computedMinutes = useMemo(() => {
    const minsPerSlot = 1440 / safeSlots;
    const total = actualBins.reduce((acc, d) => acc + d * minsPerSlot, 0);
    const h = Math.floor(total / 60);
    const m = Math.round(total % 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }, [actualBins, safeSlots]);

  const svgW = 288;
  const slotPitch = svgW / safeSlots;

  return (
    <div
      data-testid={dataTestId ?? 'focus-barcode-24h'}
      data-fui="focus-barcode-24h"
      data-slot-count={safeSlots}
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '8px 10px',
        backgroundColor: FUI_TOKENS.bgCarbon,
        border: `1px solid ${FUI_TOKENS.borderHairline}`,
        color: FUI_TOKENS.inkStark,
        fontFamily: FUI_TOKENS.fontMono,
        fontSize: '12px',
        borderRadius: '0px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '0px' }}>
        <span style={{ color: FUI_TOKENS.inkMuted }}>{title}</span>
        <span data-barcode-part="total-label" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {totalMinutesLabel ?? computedMinutes}
        </span>
      </div>

      <svg
        width="100%"
        height="34"
        viewBox={`0 0 ${svgW} 34`}
        role="img"
        aria-label={title}
        style={{ display: 'block', borderRadius: '0px' }}
      >
        {/* Row 1: Actual Focus Density Strip (y=2..18) */}
        <g data-barcode-row="actual">
          {actualBins.map((d, idx) => {
            const xCenter = (idx + 0.5) * slotPitch;
            if (d > 0) {
              const w = Number(Math.max(1.5, slotPitch * (0.35 + 0.5 * d)).toFixed(2));
              const x = Number((xCenter - w / 2).toFixed(2));
              return (
                <rect
                  key={idx}
                  data-barcode-bar={idx}
                  data-active="true"
                  x={x}
                  y="2"
                  width={w}
                  height="16"
                  fill={FUI_TOKENS.inkStark}
                />
              );
            }
            return (
              <rect
                key={idx}
                data-barcode-bar={idx}
                data-active="false"
                x={Number((xCenter - 0.5).toFixed(2))}
                y="7"
                width="1"
                height="6"
                fill="#1E212B"
              />
            );
          })}
        </g>

        {/* Row 2: Planned / Cadence Strip (y=21..30) */}
        <g data-barcode-row="planned">
          {plannedBins.map((d, idx) => {
            const xCenter = (idx + 0.5) * slotPitch;
            const w = d > 0 ? Number(Math.max(1.2, slotPitch * 0.45 * d).toFixed(2)) : 1;
            const x = Number((xCenter - w / 2).toFixed(2));
            return (
              <rect
                key={idx}
                x={x}
                y={d > 0 ? 21 : 24}
                width={w}
                height={d > 0 ? 9 : 3}
                fill={d > 0 ? '#9CA3AF' : '#1E212B'}
              />
            );
          })}
        </g>

        {/* Optional Current Minute Hairline */}
        {currentMinute !== undefined && Number.isFinite(currentMinute) && (
          <line
            data-barcode-part="current-minute"
            x1={Number(((clamp(currentMinute, 0, 1440, 0) / 1440) * svgW).toFixed(2))}
            y1="0"
            x2={Number(((clamp(currentMinute, 0, 1440, 0) / 1440) * svgW).toFixed(2))}
            y2="34"
            stroke={FUI_TOKENS.accentOrange}
            strokeWidth="1.2"
          />
        )}
      </svg>

      <div
        data-barcode-part="time-axis"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          color: FUI_TOKENS.inkMuted,
          fontSize: '12px',
          fontVariantNumeric: 'tabular-nums',
          borderRadius: '0px',
        }}
      >
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
    </div>
  );
}

// ============================================================================
// 3. <BinaryDotMatrix8x12 /> (REF-06 Exact 96-Dot Matrix)
// ============================================================================
export type MatrixCellState =
  | boolean
  | number
  | 'completed'
  | 'partial'
  | 'skipped'
  | 'empty'
  | null
  | undefined;

export interface BinaryDotMatrix8x12Props {
  values?: MatrixCellState[];
  rows?: number;
  cols?: number;
  title?: string;
  adherencePct?: number;
  streakCount?: number;
  className?: string;
  'data-testid'?: string;
}

type NormalizedCellKind = 'completed' | 'partial' | 'skipped' | 'empty';

function classifyCell(val: MatrixCellState): NormalizedCellKind {
  if (val === true || val === 'completed') return 'completed';
  if (val === 'partial') return 'partial';
  if (val === 'skipped') return 'skipped';
  if (typeof val === 'number' && Number.isFinite(val)) {
    if (val >= 1) return 'completed';
    if (val > 0) return 'partial';
  }
  return 'empty';
}

export function BinaryDotMatrix8x12({
  values,
  rows = 8,
  cols = 12,
  title = 'ROUTINE_MATRIX_8X12',
  adherencePct,
  streakCount,
  className,
  'data-testid': dataTestId,
}: BinaryDotMatrix8x12Props) {
  const safeRows = Math.max(1, Math.round(sanitizeFinite(rows, 8)));
  const safeCols = Math.max(1, Math.round(sanitizeFinite(cols, 12)));
  const totalCells = safeRows * safeCols;

  const cells = useMemo(() => {
    const raw = Array.isArray(values) ? values : [];
    const sliced = raw.length > totalCells ? raw.slice(-totalCells) : raw;
    const out: NormalizedCellKind[] = [];
    for (let i = 0; i < totalCells; i++) {
      out.push(classifyCell(sliced[i]));
    }
    return out;
  }, [values, totalCells]);

  const computedAdherence = useMemo(() => {
    if (adherencePct !== undefined && Number.isFinite(adherencePct)) {
      return Math.round(clamp(adherencePct, 0, 100, 0));
    }
    const completed = cells.filter((c) => c === 'completed' || c === 'partial').length;
    return Math.round((completed / totalCells) * 100);
  }, [adherencePct, cells, totalCells]);

  const pitch = 8;
  const dotSize = 4;
  const svgW = safeCols * pitch;
  const svgH = safeRows * pitch;

  return (
    <div
      data-testid={dataTestId ?? 'binary-dot-matrix-8x12'}
      data-fui="binary-dot-matrix"
      data-rows={safeRows}
      data-cols={safeCols}
      data-cell-count={cells.length}
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '8px 10px',
        backgroundColor: FUI_TOKENS.bgCarbon,
        border: `1px solid ${FUI_TOKENS.borderHairline}`,
        color: FUI_TOKENS.inkStark,
        fontFamily: FUI_TOKENS.fontMono,
        fontSize: '12px',
        borderRadius: '0px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '0px' }}>
        <span style={{ color: FUI_TOKENS.inkMuted }}>{title}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {computedAdherence}%{streakCount !== undefined ? ` // ${streakCount}D` : ''}
        </span>
      </div>

      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        role="img"
        aria-label={`${title} (${safeRows}x${safeCols})`}
        style={{ display: 'block', borderRadius: '0px' }}
      >
        {cells.map((kind, idx) => {
          const r = Math.floor(idx / safeCols);
          const c = idx % safeCols;
          const x = c * pitch + 2;
          const y = r * pitch + 2;
          if (kind === 'skipped') {
            return (
              <rect
                key={idx}
                data-matrix-cell={idx}
                data-cell-state="skipped"
                x={x}
                y={y}
                width={dotSize}
                height={dotSize}
                fill="none"
                stroke={FUI_TOKENS.accentVermilion}
                strokeWidth="1"
              />
            );
          }
          const fill =
            kind === 'completed'
              ? FUI_TOKENS.inkStark
              : kind === 'partial'
                ? FUI_TOKENS.accentOrange
                : FUI_TOKENS.borderHairline;
          return (
            <rect
              key={idx}
              data-matrix-cell={idx}
              data-cell-state={kind}
              x={x}
              y={y}
              width={dotSize}
              height={dotSize}
              fill={fill}
            />
          );
        })}
      </svg>
    </div>
  );
}

// ============================================================================
// 4. <WaveformSparkline /> (REF-06 Framed WAVEFORM_DATA Trace)
// ============================================================================
export interface WaveformSparklineProps {
  data: number[];
  title?: string;
  variant?: 'line' | 'impulse' | 'area';
  strokeColor?: string;
  unit?: string;
  isCurrency?: boolean;
  currencySymbol?: string;
  privacyMasked?: boolean;
  height?: number;
  footerMetrics?: Array<{ label: string; value: string | number }>;
  className?: string;
  'data-testid'?: string;
}

export function WaveformSparkline({
  data,
  title = 'WAVEFORM_DATA',
  variant = 'line',
  strokeColor = FUI_TOKENS.inkStark,
  unit = '',
  isCurrency = false,
  currencySymbol,
  privacyMasked,
  height = 84,
  footerMetrics,
  className,
  'data-testid': dataTestId,
}: WaveformSparklineProps) {
  const ctxPrivacy = usePrivacyMask();
  const isMasked = Boolean((privacyMasked ?? ctxPrivacy.isMasked) && isCurrency);

  const clean = useMemo(
    () => (Array.isArray(data) ? data.filter((v) => typeof v === 'number' && Number.isFinite(v)) : []),
    [data],
  );

  const svgW = 240;
  const svgH = Math.max(40, sanitizeFinite(height, 84));
  const padX = 8;
  const padY = 10;
  const plotW = svgW - padX * 2;
  const plotH = svgH - padY * 2;

  const { minVal, maxVal, latestVal, points } = useMemo(() => {
    if (clean.length === 0) {
      return { minVal: null, maxVal: null, latestVal: null, points: [] as Array<[number, number]> };
    }
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const latest = clean[clean.length - 1]!;
    if (clean.length === 1) {
      const midY = Number((padY + plotH / 2).toFixed(2));
      return {
        minVal: min,
        maxVal: max,
        latestVal: latest,
        points: [
          [padX, midY],
          [padX + plotW, midY],
        ] as Array<[number, number]>,
      };
    }
    const span = max - min;
    const pts: Array<[number, number]> = clean.map((v, idx) => {
      const x = Number((padX + (idx / (clean.length - 1)) * plotW).toFixed(2));
      const y =
        span === 0
          ? Number((padY + plotH / 2).toFixed(2))
          : Number((padY + plotH - ((v - min) / span) * plotH).toFixed(2));
      return [x, y];
    });
    return { minVal: min, maxVal: max, latestVal: latest, points: pts };
  }, [clean, padX, padY, plotW, plotH]);

  const formatNum = (val: number | null): string => {
    if (val === null) return '--';
    if (isMasked) return formatMaskedCurrency(val, currencySymbol);
    const formatted = Number(val.toFixed(2));
    return `${currencySymbol ? `${currencySymbol} ` : ''}${formatted}${unit ? ` ${unit}` : ''}`;
  };

  const polylineStr = points.map(([x, y]) => `${x},${y}`).join(' ');
  const midY = Number((padY + plotH / 2).toFixed(2));

  return (
    <div
      data-testid={dataTestId ?? 'waveform-sparkline'}
      data-fui="waveform-sparkline"
      data-variant={variant}
      data-privacy-masked={isMasked ? 'true' : 'false'}
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '8px 10px',
        backgroundColor: FUI_TOKENS.bgCarbon,
        border: `1px solid ${FUI_TOKENS.borderHairline}`,
        color: FUI_TOKENS.inkStark,
        fontFamily: FUI_TOKENS.fontMono,
        fontSize: '12px',
        borderRadius: '0px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '0px' }}>
        <span style={{ color: FUI_TOKENS.inkMuted }}>
          {title} // MIN:{formatNum(minVal)}
        </span>
        <span data-waveform-part="latest-value" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
          {formatNum(latestVal)}
        </span>
      </div>

      <svg
        width="100%"
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        role="img"
        aria-label={title}
        style={{ display: 'block', borderRadius: '0px' }}
      >
        {/* Dashed Center Reference Line */}
        <line
          x1={padX}
          y1={midY}
          x2={padX + plotW}
          y2={midY}
          stroke={FUI_TOKENS.borderHairline}
          strokeWidth="1"
          strokeDasharray="2 3"
        />

        {points.length > 0 && variant === 'impulse' && (
          <g data-waveform-part="impulses">
            {points.map(([x, y], idx) => (
              <line
                key={idx}
                data-waveform-stem={idx}
                x1={x}
                y1={padY + plotH}
                x2={x}
                y2={y}
                stroke={strokeColor}
                strokeWidth="2"
              />
            ))}
          </g>
        )}

        {points.length > 0 && variant === 'area' && (
          <polygon
            data-waveform-part="area"
            points={`${padX},${padY + plotH} ${polylineStr} ${padX + plotW},${padY + plotH}`}
            fill="rgba(246, 246, 244, 0.14)"
          />
        )}

        {points.length > 0 && (
          <>
            <polyline
              data-waveform-part="polyline"
              points={polylineStr}
              fill="none"
              stroke={strokeColor}
              strokeWidth="1.5"
            />
            {clean.length === 1 && (
              <rect
                data-waveform-part="single-point-marker"
                x={padX + plotW - 1.5}
                y={midY - 1.5}
                width="3"
                height="3"
                fill={strokeColor}
              />
            )}
          </>
        )}
      </svg>

      {footerMetrics && footerMetrics.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            borderTop: `1px solid ${FUI_TOKENS.borderHairline}`,
            paddingTop: '4px',
            color: FUI_TOKENS.inkMuted,
            borderRadius: '0px',
          }}
        >
          {footerMetrics.map((m, idx) => (
            <span key={idx}>
              {m.label}: {isMasked ? formatMaskedCurrency(m.value, currencySymbol) : m.value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 5. <ConstellationMesh /> (REF-06 3D Wireframe over Exact 16x16 Grid)
// ============================================================================
export interface ConstellationNode {
  id: string;
  label?: string;
  x?: number;
  y?: number;
  z?: number;
  cluster?: string;
  vaultPath?: string;
}

export interface ConstellationEdge {
  source: string;
  target: string;
  weight?: number;
}

export interface ConstellationMeshProps {
  nodes?: ConstellationNode[];
  edges?: ConstellationEdge[];
  yawDeg?: number;
  pitchDeg?: number;
  selectedNodeId?: string | null;
  onSelectNode?: (node: ConstellationNode) => void;
  title?: string;
  size?: number;
  className?: string;
  'data-testid'?: string;
}

function seededCoord(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (((h >>> 0) % 2000) / 1000) - 1;
}

export function ConstellationMesh({
  nodes = [],
  edges,
  yawDeg = 24,
  pitchDeg = -18,
  selectedNodeId,
  onSelectNode,
  title = 'SECOND_BRAIN // CONSTELLATION',
  size = 240,
  className,
  'data-testid': dataTestId,
}: ConstellationMeshProps) {
  const safeNodes = Array.isArray(nodes) ? nodes : [];
  const yaw = (sanitizeFinite(yawDeg, 24) * Math.PI) / 180;
  const pitch = (sanitizeFinite(pitchDeg, -18) * Math.PI) / 180;

  const projectedNodes = useMemo(() => {
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);

    return safeNodes.map((n, idx) => {
      const rx = clamp(n.x ?? seededCoord(n.id || String(idx), 1), -1, 1, 0);
      const ry = clamp(n.y ?? seededCoord(n.id || String(idx), 2), -1, 1, 0);
      const rz = clamp(n.z ?? seededCoord(n.id || String(idx), 3), -1, 1, 0);

      const x1 = rx * cosY + rz * sinY;
      const z1 = -rx * sinY + rz * cosY;
      const y2 = ry * cosP - z1 * sinP;
      const z2 = ry * sinP + z1 * cosP;
      const persp = 2.8 / (2.8 - z2);

      const sx = Number(clamp(120 + 78 * x1 * persp, 14, 226, 120).toFixed(2));
      const sy = Number(clamp(120 + 78 * y2 * persp, 14, 226, 120).toFixed(2));
      return { node: n, sx, sy, rx, ry, rz };
    });
  }, [safeNodes, yaw, pitch]);

  const resolvedEdges = useMemo(() => {
    const byId = new Map(projectedNodes.map((p) => [p.node.id, p]));
    if (Array.isArray(edges) && edges.length > 0) {
      return edges
        .map((e) => {
          const a = byId.get(e.source);
          const b = byId.get(e.target);
          return a && b ? ([a, b] as const) : null;
        })
        .filter((pair): pair is readonly [(typeof projectedNodes)[number], (typeof projectedNodes)[number]] =>
          Boolean(pair),
        );
    }

    // Auto-triangulate k=3 nearest 3D neighbors when edges omitted
    const pairs: Array<readonly [(typeof projectedNodes)[number], (typeof projectedNodes)[number]]> = [];
    const seen = new Set<string>();
    for (let i = 0; i < projectedNodes.length; i++) {
      const a = projectedNodes[i]!;
      const neighbors = projectedNodes
        .map((b, j) => ({
          b,
          j,
          dist: Math.hypot(a.rx - b.rx, a.ry - b.ry, a.rz - b.rz),
        }))
        .filter((item) => item.j !== i)
        .sort((u, v) => u.dist - v.dist)
        .slice(0, 3);

      for (const nb of neighbors) {
        const key = i < nb.j ? `${i}:${nb.j}` : `${nb.j}:${i}`;
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push([a, nb.b]);
        }
      }
    }
    return pairs;
  }, [projectedNodes, edges]);

  return (
    <div
      data-testid={dataTestId ?? 'constellation-mesh'}
      data-fui="constellation-mesh"
      data-node-count={projectedNodes.length}
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '8px 10px',
        backgroundColor: FUI_TOKENS.bgCarbon,
        border: `1px solid ${FUI_TOKENS.borderHairline}`,
        color: FUI_TOKENS.inkStark,
        fontFamily: FUI_TOKENS.fontMono,
        fontSize: '12px',
        borderRadius: '0px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '0px' }}>
        <span style={{ color: FUI_TOKENS.inkMuted }}>{title}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>GRID_16X16 // NODES:{projectedNodes.length}</span>
      </div>

      <svg
        width={size}
        height={size}
        viewBox="0 0 240 240"
        role="img"
        aria-label={title}
        style={{ alignSelf: 'center', display: 'block', borderRadius: '0px' }}
      >
        {/* Exact 16x16 Background Grid (17 horizontal + 17 vertical lines across 8..232, pitch=14) */}
        <g data-constellation-part="grid-16x16">
          {Array.from({ length: 17 }).map((_, idx) => {
            const pos = 8 + idx * 14;
            return (
              <React.Fragment key={idx}>
                <line
                  data-grid-line-h={idx}
                  x1="8"
                  y1={pos}
                  x2="232"
                  y2={pos}
                  stroke="#1B1E26"
                  strokeWidth="1"
                />
                <line
                  data-grid-line-v={idx}
                  x1={pos}
                  y1="8"
                  x2={pos}
                  y2="232"
                  stroke="#1B1E26"
                  strokeWidth="1"
                />
              </React.Fragment>
            );
          })}
        </g>

        {projectedNodes.length === 0 && (
          <circle
            data-constellation-part="idle-reticle"
            cx="120"
            cy="120"
            r="36"
            fill="none"
            stroke={FUI_TOKENS.inkMuted}
            strokeWidth="1"
            strokeDasharray="3 4"
          />
        )}

        {/* Wireframe Edges */}
        <g data-constellation-part="edges">
          {resolvedEdges.map(([a, b], idx) => (
            <line
              key={idx}
              data-constellation-edge={idx}
              x1={a.sx}
              y1={a.sy}
              x2={b.sx}
              y2={b.sy}
              stroke={FUI_TOKENS.inkStark}
              strokeWidth="0.9"
              opacity="0.55"
            />
          ))}
        </g>

        {/* 3x3 0px Square Vertex Nodes */}
        <g data-constellation-part="nodes">
          {projectedNodes.map((p) => {
            const selected = p.node.id === selectedNodeId;
            const box = selected ? 5 : 3;
            return (
              <rect
                key={p.node.id}
                data-constellation-node={p.node.id}
                data-selected={selected ? 'true' : 'false'}
                x={Number((p.sx - box / 2).toFixed(2))}
                y={Number((p.sy - box / 2).toFixed(2))}
                width={box}
                height={box}
                fill={selected ? FUI_TOKENS.accentOrange : FUI_TOKENS.inkStark}
                style={{ cursor: onSelectNode ? 'pointer' : undefined }}
                onClick={() => onSelectNode?.(p.node)}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
