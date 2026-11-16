import React from 'react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { FUI_TOKENS } from '../tokens';

export const MODULAR_HUD_LOADER_VARIANTS = [
  'proximity_scan',
  'fusion',
  'vector_array',
  'sonar_array',
] as const;

export type ModularHudLoaderVariant = (typeof MODULAR_HUD_LOADER_VARIANTS)[number];

export interface ModularHudLoaderProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: ModularHudLoaderVariant;
  size?: number;
  label?: string;
  sublabel?: string;
  value?: number | string;
  showCallout?: boolean;
}

const DEFAULT_META: Record<
  ModularHudLoaderVariant,
  { label: string; sublabel: string; value: string }
> = {
  proximity_scan: { label: 'proximity scan', sublabel: 'distance', value: '79' },
  fusion: { label: 'fusion', sublabel: 'pinpoint', value: '-46' },
  vector_array: { label: 'vector array', sublabel: 'left channel', value: '0.113' },
  sonar_array: { label: 'sonar array', sublabel: 'bearing', value: '58' },
};

const CX = 60;
const CY = 60;
const DEG = Math.PI / 180;

function polar(r: number, deg: number): [number, number] {
  const rad = deg * DEG;
  return [
    Number((CX + r * Math.cos(rad)).toFixed(2)),
    Number((CY + r * Math.sin(rad)).toFixed(2)),
  ];
}

function arcPath(r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(r, startDeg);
  const [x2, y2] = polar(r, endDeg);
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  const sweep = endDeg >= startDeg ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} ${sweep} ${x2} ${y2}`;
}

export function ModularHudLoader({
  variant = 'proximity_scan',
  size = 96,
  label,
  sublabel,
  value,
  showCallout = true,
  style,
  ...rest
}: ModularHudLoaderProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const meta = DEFAULT_META[variant] ?? DEFAULT_META.proximity_scan;
  const resolvedLabel = label ?? meta.label;
  const resolvedSublabel = sublabel ?? meta.sublabel;
  const resolvedValue = value !== undefined ? String(value) : meta.value;
  const widthPx = showCallout ? Math.round(size * 1.5) : size;

  return (
    <div
      {...rest}
      data-fui="modular-hud-loader"
      data-variant={variant}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        backgroundColor: FUI_TOKENS.bgCarbon,
        borderRadius: '0px',
        ...style,
      }}
    >
      <svg
        width={widthPx}
        height={size}
        viewBox={showCallout ? '0 0 180 120' : '0 0 120 120'}
        role="status"
        aria-label={`${resolvedLabel}: ${resolvedValue}`}
        style={{ display: 'block', borderRadius: '0px' }}
      >
        <g
          className={!prefersReducedMotion ? 'fui-motion-spin' : undefined}
          style={
            !prefersReducedMotion
              ? { transformOrigin: '60px 60px', animation: 'fui-spin-cw 8s linear infinite' }
              : undefined
          }
        >
          {variant === 'proximity_scan' && (
            <g data-loader-spinner="proximity_scan">
              <circle
                cx={CX}
                cy={CY}
                r="44"
                fill="none"
                stroke={FUI_TOKENS.inkStark}
                strokeWidth="2"
                strokeDasharray="36 14 12 14"
              />
              <circle
                cx={CX}
                cy={CY}
                r="34"
                fill="none"
                stroke={FUI_TOKENS.inkMuted}
                strokeWidth="1.5"
                strokeDasharray="24 12 8 12"
              />
              <circle
                cx={CX}
                cy={CY}
                r="22"
                fill="none"
                stroke={FUI_TOKENS.inkStark}
                strokeWidth="1.5"
                strokeDasharray="16 10"
              />
              {[0, 90, 180, 270].map((deg) => {
                const [px, py] = polar(11, deg);
                return (
                  <rect
                    key={deg}
                    x={px - 1.5}
                    y={py - 1.5}
                    width="3"
                    height="3"
                    fill={FUI_TOKENS.inkStark}
                  />
                );
              })}
            </g>
          )}

          {variant === 'fusion' && (
            <g data-loader-spinner="fusion">
              {Array.from({ length: 90 }).map((_, i) => {
                const deg = i * 4;
                const [x1, y1] = polar(36, deg);
                const [x2, y2] = polar(45, deg);
                return (
                  <line
                    key={i}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={FUI_TOKENS.inkStark}
                    strokeWidth="0.9"
                    opacity={i % 3 === 0 ? 0.95 : 0.45}
                  />
                );
              })}
              {[0, 120, 240].map((deg) => (
                <path
                  key={deg}
                  d={arcPath(22, deg, deg + 84)}
                  fill="none"
                  stroke={FUI_TOKENS.inkStark}
                  strokeWidth="5"
                />
              ))}
              <path
                d="M 60 52 L 62 58 L 68 60 L 62 62 L 60 68 L 58 62 L 52 60 L 58 58 Z"
                fill={FUI_TOKENS.inkStark}
              />
            </g>
          )}

          {variant === 'vector_array' && (
            <g data-loader-spinner="vector_array">
              <path
                d={arcPath(44, -140, 145)}
                fill="none"
                stroke={FUI_TOKENS.inkStark}
                strokeWidth="2.5"
              />
              {[0, 120, 240].map((deg) => (
                <path
                  key={deg}
                  d={arcPath(30, deg, deg + 72)}
                  fill="none"
                  stroke={FUI_TOKENS.inkMuted}
                  strokeWidth="3"
                />
              ))}
              <path
                d="M 60 48 Q 62 58 71 66 Q 60 62 49 66 Q 58 58 60 48 Z"
                fill={FUI_TOKENS.inkStark}
              />
            </g>
          )}

          {variant === 'sonar_array' && (
            <g data-loader-spinner="sonar_array">
              <circle cx={CX} cy={CY} r="44" fill="none" stroke={FUI_TOKENS.inkStark} strokeWidth="2" strokeDasharray="48 16" />
              <circle cx={CX} cy={CY} r="34" fill="none" stroke={FUI_TOKENS.inkMuted} strokeWidth="1" />
              <circle cx={CX} cy={CY} r="24" fill="none" stroke={FUI_TOKENS.inkMuted} strokeWidth="1" />
              <circle cx={CX} cy={CY} r="14" fill="none" stroke={FUI_TOKENS.inkMuted} strokeWidth="1" />
              <path
                d={`M ${CX} ${CY} L ${polar(42, -55)[0]} ${polar(42, -55)[1]} A 42 42 0 0 1 ${polar(42, 0)[0]} ${polar(42, 0)[1]} Z`}
                fill={FUI_TOKENS.inkStark}
                fillOpacity="0.2"
              />
              <path
                d={`M ${CX} ${CY} L ${polar(42, 125)[0]} ${polar(42, 125)[1]} A 42 42 0 0 1 ${polar(42, 180)[0]} ${polar(42, 180)[1]} Z`}
                fill={FUI_TOKENS.inkStark}
                fillOpacity="0.2"
              />
            </g>
          )}
        </g>

        {/* 45° Elbow Leader Callout */}
        {showCallout && (
          <g data-hud-callout="true">
            <polyline
              points="94,36 108,22 172,22"
              fill="none"
              stroke={FUI_TOKENS.inkMuted}
              strokeWidth="1"
            />
            <circle cx="94" cy="36" r="2" fill={FUI_TOKENS.inkStark} />
            <text
              x="110"
              y="17"
              fill={FUI_TOKENS.inkMuted}
              fontFamily={FUI_TOKENS.fontMono}
              fontSize="10"
            >
              {resolvedLabel}
            </text>
            <text
              x="110"
              y="35"
              fill={FUI_TOKENS.inkMuted}
              fontFamily={FUI_TOKENS.fontMono}
              fontSize="9"
            >
              {resolvedSublabel}
            </text>
            <text
              data-hud-telemetry-value="true"
              x="172"
              y="38"
              textAnchor="end"
              fill={FUI_TOKENS.inkStark}
              fontFamily={FUI_TOKENS.fontMono}
              fontSize="14"
              fontWeight="700"
            >
              {resolvedValue}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
